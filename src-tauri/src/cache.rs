/// Local SQLite cache layer for Gists.
/// All reads are offline-capable; writes go to DB first, then sync to GitHub.
use anyhow::{bail, Result};
use rusqlite::{Connection, params};
use std::collections::HashMap;

use crate::db::with_db;
use crate::models::{CategoryCount, Gist, GistFile, Tag};

// ── Internal helpers ──────────────────────────────────────────────────────────

/// SELECT list aligned with `row_to_gist` column order (no table prefix).
const GIST_ROW: &str = "id, description, public, html_url, created_at, updated_at, \
    COALESCE(pending_push,0), COALESCE(category,'gist'), COALESCE(lang_group,'other'), \
    COALESCE(pinned,0)";

/// Same columns with `g.` prefix (search / joins).
const GIST_ROW_G: &str = "g.id, g.description, g.public, g.html_url, g.created_at, g.updated_at, \
    COALESCE(g.pending_push,0), COALESCE(g.category,'gist'), COALESCE(g.lang_group,'other'), \
    COALESCE(g.pinned,0)";

fn classify_and_persist(conn: &Connection, gist: &Gist) -> Result<()> {
    let user_set: i32 = match conn.query_row(
        "SELECT COALESCE(category_user_set,0) FROM gists WHERE id=?1",
        params![gist.id],
        |r| r.get::<_, i32>(0),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    if user_set != 0 {
        return Ok(());
    }
    let (cat, lg) = crate::classifier::classify(gist);
    conn.execute(
        "UPDATE gists SET category=?1, lang_group=?2 WHERE id=?3",
        params![cat, lg, gist.id],
    )?;
    Ok(())
}

fn gist_pending_push(conn: &Connection, gist_id: &str) -> Result<bool> {
    match conn.query_row(
        "SELECT COALESCE(pending_push,0) FROM gists WHERE id=?1",
        params![gist_id],
        |r| r.get::<_, i32>(0),
    ) {
        Ok(v) => Ok(v != 0),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// When a local draft exists, only refresh GitHub metadata so conflict detection
/// can compare remote `updated_at` without overwriting editor content.
fn apply_remote_metadata_only(conn: &Connection, gist: &Gist) -> Result<()> {
    conn.execute(
        "UPDATE gists
         SET updated_at=?1, html_url=?2, public=?3,
             synced_at=datetime('now'), remote_etag=NULL
         WHERE id=?4",
        params![gist.updated_at, gist.html_url, gist.public as i32, gist.id],
    )?;
    Ok(())
}

/// Replace the remote snapshot for a gist with the files just received from GitHub.
/// Called only when GitHub content replaces local state (not for draft saves).
fn save_remote_snapshot(conn: &Connection, gist_id: &str, files: &[GistFile]) -> Result<()> {
    conn.execute(
        "DELETE FROM files_remote_snapshot WHERE gist_id = ?1",
        params![gist_id],
    )?;
    for f in files {
        conn.execute(
            "INSERT INTO files_remote_snapshot(gist_id, filename, content)
             VALUES(?1, ?2, ?3)",
            params![gist_id, f.filename, f.content],
        )?;
    }
    Ok(())
}

fn upsert_gist_replace_all(conn: &Connection, gist: &Gist) -> Result<()> {
    conn.execute(
        "INSERT INTO gists(id, description, public, html_url, created_at, updated_at, synced_at, pending_push)
         VALUES(?1,?2,?3,?4,?5,?6,datetime('now'),0)
         ON CONFLICT(id) DO UPDATE SET
           description=excluded.description,
           public=excluded.public,
           html_url=excluded.html_url,
           updated_at=excluded.updated_at,
           synced_at=excluded.synced_at,
           pending_push=0",
        params![
            gist.id, gist.description, gist.public as i32,
            gist.html_url, gist.created_at, gist.updated_at,
        ],
    )?;

    conn.execute("DELETE FROM files WHERE gist_id = ?1", params![gist.id])?;
    for f in &gist.files {
        conn.execute(
            "INSERT INTO files(gist_id, filename, language, content, size, raw_url)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![gist.id, f.filename, f.language, f.content, f.size, f.raw_url],
        )?;
    }

    // Keep remote snapshot in sync so diff (Phase 5) has a clean baseline.
    save_remote_snapshot(conn, &gist.id, &gist.files)?;

    conn.execute("DELETE FROM gists_fts WHERE gist_id = ?1", params![gist.id])?;
    let filenames: String = gist.files.iter().map(|f| f.filename.as_str()).collect::<Vec<_>>().join(" ");
    let content_text: String = gist.files.iter().map(|f| f.content.as_str()).collect::<Vec<_>>().join("\n");
    conn.execute(
        "INSERT INTO gists_fts(gist_id, description, filenames, content_text)
         VALUES(?1,?2,?3,?4)",
        params![gist.id, gist.description, filenames, content_text],
    )?;

    classify_and_persist(conn, gist)?;
    Ok(())
}

// ── ETag helpers ──────────────────────────────────────────────────────────────

/// Last successful `GET /gists/:id` entity tag (for `If-None-Match`).
pub fn get_remote_etag(gist_id: &str) -> Result<Option<String>> {
    with_db(|conn| {
        let r: std::result::Result<String, rusqlite::Error> = conn.query_row(
            "SELECT remote_etag FROM gists
             WHERE id=?1 AND remote_etag IS NOT NULL AND TRIM(remote_etag) != ''",
            params![gist_id],
            |row| row.get(0),
        );
        match r {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
}

pub fn set_remote_etag(gist_id: &str, etag: Option<&str>) -> Result<()> {
    with_db(|conn| {
        conn.execute(
            "UPDATE gists SET remote_etag=?1 WHERE id=?2",
            params![etag, gist_id],
        )?;
        Ok(())
    })
}

// ── Write ─────────────────────────────────────────────────────────────────────

/// Replace local cache with a gist from GitHub (after a successful API push or
/// explicit pull). Stores the associated ETag for future conditional GETs.
pub fn upsert_gist_from_remote_with_etag(gist: &Gist, remote_etag: Option<&str>) -> Result<()> {
    with_db(|conn| {
        upsert_gist_replace_all(conn, gist)?;
        if let Some(e) = remote_etag {
            conn.execute(
                "UPDATE gists SET remote_etag=?1 WHERE id=?2",
                params![e, gist.id],
            )?;
        }
        Ok(())
    })
}

/// Bulk upsert with optional per-gist ETag.
/// If a gist has `pending_push=1` (local draft), only refreshes GitHub metadata
/// without overwriting editor content.
pub fn upsert_gists_with_etags(items: &[(Gist, Option<String>)]) -> Result<()> {
    with_db(|conn| {
        // transaction() auto-rollbacks on drop if commit() is never called,
        // preventing a half-written batch from persisting on any mid-loop error.
        let tx = conn.unchecked_transaction()?;
        for (gist, etag) in items {
            if gist_pending_push(&tx, &gist.id)? {
                apply_remote_metadata_only(&tx, gist)?;
                continue;
            }
            upsert_gist_replace_all(&tx, gist)?;
            if let Some(e) = etag {
                tx.execute(
                    "UPDATE gists SET remote_etag=?1 WHERE id=?2",
                    params![e, gist.id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// Save editor buffer to SQLite only (`pending_push=1`).
/// Does not change `updated_at` (still shows last GitHub timestamp).
pub fn save_gist_draft(
    gist_id: &str,
    description: &str,
    pairs: &[(String, String)],
) -> Result<Gist> {
    with_db(|conn| {
        let (id, public, html_url, created_at, updated_at): (
            String, i32, String, String, String,
        ) = conn.query_row(
            "SELECT id, public, html_url, created_at, updated_at FROM gists WHERE id=?1",
            params![gist_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;

        let old_files = load_files(conn, gist_id)?;
        let old_map: HashMap<String, &GistFile> =
            old_files.iter().map(|f| (f.filename.clone(), f)).collect();

        let files: Vec<GistFile> = pairs
            .iter()
            .map(|(name, content)| {
                let size = content.len() as i64;
                if let Some(prev) = old_map.get(name) {
                    GistFile {
                        filename: name.clone(),
                        language: prev.language.clone(),
                        content: content.clone(),
                        size,
                        raw_url: prev.raw_url.clone(),
                    }
                } else {
                    GistFile {
                        filename: name.clone(),
                        language: None,
                        content: content.clone(),
                        size,
                        raw_url: None,
                    }
                }
            })
            .collect();

        conn.execute(
            "UPDATE gists SET description=?1, pending_push=1 WHERE id=?2",
            params![description, gist_id],
        )?;

        conn.execute("DELETE FROM files WHERE gist_id = ?1", params![gist_id])?;
        for f in &files {
            conn.execute(
                "INSERT INTO files(gist_id, filename, language, content, size, raw_url)
                 VALUES(?1,?2,?3,?4,?5,?6)",
                params![gist_id, f.filename, f.language, f.content, f.size, f.raw_url],
            )?;
        }

        conn.execute("DELETE FROM gists_fts WHERE gist_id = ?1", params![gist_id])?;
        let filenames: String = files.iter().map(|f| f.filename.as_str()).collect::<Vec<_>>().join(" ");
        let content_text: String = files.iter().map(|f| f.content.as_str()).collect::<Vec<_>>().join("\n");
        conn.execute(
            "INSERT INTO gists_fts(gist_id, description, filenames, content_text)
             VALUES(?1,?2,?3,?4)",
            params![gist_id, description, filenames, content_text],
        )?;

        let mut g = Gist {
            id,
            description: description.to_string(),
            public: public != 0,
            html_url,
            created_at,
            updated_at,
            files: files.clone(),
            pending_push: true,
            category: "gist".into(),
            lang_group: "other".into(),
            pinned: false,
        };
        classify_and_persist(conn, &g)?;
        let (cat, lg): (String, String) = conn.query_row(
            "SELECT COALESCE(category,'gist'), COALESCE(lang_group,'other') FROM gists WHERE id=?1",
            params![gist_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        g.category = cat;
        g.lang_group = lg;
        Ok(g)
    })
}

pub fn delete_gist_cache(gist_id: &str) -> Result<()> {
    with_db(|conn| {
        // gist_tags, files, files_remote_snapshot cascade on gists delete.
        conn.execute("DELETE FROM gists WHERE id = ?1", params![gist_id])?;
        conn.execute("DELETE FROM gists_fts WHERE gist_id = ?1", params![gist_id])?;
        Ok(())
    })
}

// ── Remote snapshot helpers ───────────────────────────────────────────────────

/// Returns the last-synced remote content for every file in a gist.
/// Keys are filenames; value is the raw content string from GitHub.
/// Used by the diff engine (Phase 5) as the "original" baseline.
pub fn get_remote_snapshot(gist_id: &str) -> Result<HashMap<String, String>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT filename, content FROM files_remote_snapshot WHERE gist_id = ?1",
        )?;
        let map = stmt
            .query_map(params![gist_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<HashMap<_, _>, _>>()?;
        Ok(map)
    })
}

// ── Sync-time helpers ─────────────────────────────────────────────────────────

pub fn get_last_sync_time() -> Result<Option<String>> {
    crate::db::get_setting("last_sync")
}

pub fn set_last_sync_time(time: &str) -> Result<()> {
    crate::db::set_setting("last_sync", time)
}

pub fn count_gists() -> Result<usize> {
    with_db(|conn| {
        let n: usize = conn.query_row("SELECT COUNT(*) FROM gists", [], |row| row.get(0))?;
        Ok(n)
    })
}

// ── Read ──────────────────────────────────────────────────────────────────────

fn load_files(conn: &rusqlite::Connection, gist_id: &str) -> Result<Vec<GistFile>> {
    let mut stmt = conn.prepare(
        "SELECT filename, language, content, size, raw_url FROM files WHERE gist_id = ?1",
    )?;
    let files = stmt
        .query_map(params![gist_id], |row| {
            Ok(GistFile {
                filename: row.get(0)?,
                language: row.get(1)?,
                content: row.get(2)?,
                size: row.get(3)?,
                raw_url: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(files)
}

fn row_to_gist(
    _conn: &rusqlite::Connection,
    row: &rusqlite::Row,
) -> std::result::Result<Gist, rusqlite::Error> {
    Ok(Gist {
        id: row.get(0)?,
        description: row.get(1)?,
        public: row.get::<_, i32>(2)? != 0,
        html_url: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        files: vec![],
        pending_push: row.get::<_, i32>(6)? != 0,
        category: row.get(7)?,
        lang_group: row.get(8)?,
        pinned: row.get::<_, i32>(9)? != 0,
    })
}

/// List all cached gists ordered by most recently updated.
pub fn list_gists() -> Result<Vec<Gist>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {GIST_ROW} FROM gists ORDER BY pinned DESC, updated_at DESC"
        ))?;
        let mut gists = stmt
            .query_map([], |row| row_to_gist(conn, row))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for g in &mut gists {
            g.files = load_files(conn, &g.id)?;
        }
        Ok(gists)
    })
}

/// Full-text search with optional structured filters.
///
/// Supports `tag:X`, `lang:Y`, `is:public`/`is:secret` tokens alongside
/// free-text keywords.  Keywords are matched via FTS5 and results are ranked
/// by BM25 relevance.  Structured-only queries (no keywords) return results
/// ordered by `updated_at DESC`.
pub fn search_gists(query: &str) -> Result<Vec<Gist>> {
    use crate::search_parser;
    use rusqlite::types::Value;

    let pq = search_parser::parse(query);
    if pq.is_empty() {
        return list_gists();
    }

    with_db(|conn| {
        let mut params: Vec<Value> = Vec::new();
        let mut where_parts: Vec<String> = Vec::new();
        let has_keywords = !pq.keywords.is_empty();

        // Tag filters via IN subquery — avoids JOIN fan-out, AND semantics
        for tag_name in &pq.tags {
            where_parts.push(
                "g.id IN (SELECT gt.gist_id FROM gist_tags gt \
                  JOIN tags t ON t.id = gt.tag_id WHERE LOWER(t.name) = ?)"
                    .to_string(),
            );
            params.push(Value::Text(tag_name.to_lowercase()));
        }

        // Lang filters via IN subquery
        for lang in &pq.langs {
            where_parts.push(
                "g.id IN (SELECT gist_id FROM files \
                  WHERE LOWER(COALESCE(language,'')) = ?)"
                    .to_string(),
            );
            params.push(Value::Text(lang.to_lowercase()));
        }

        // is:public / is:secret
        if let Some(is_pub) = pq.is_public {
            where_parts.push("g.public = ?".to_string());
            params.push(Value::Integer(is_pub as i64));
        }

        let sql = if has_keywords {
            // bm25() only works when gists_fts is the primary (first) table.
            // Put the MATCH condition first so SQLite can use the FTS index.
            let fts_match = pq
                .keywords
                .iter()
                .filter_map(|w| {
                    // Whitelist: only alphanumeric, hyphen, underscore, dot.
                    // Strips everything else to prevent FTS5 MATCH syntax injection.
                    let safe: String = w
                        .chars()
                        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
                        .collect();
                    if safe.is_empty() {
                        None
                    } else {
                        Some(format!("\"{}\"", safe))
                    }
                })
                .collect::<Vec<_>>()
                .join(" AND ");

            // Build WHERE: MATCH always first, then structured filters on g.*
            let mut fts_where = vec!["gists_fts MATCH ?".to_string()];
            fts_where.extend(where_parts);
            let where_clause = fts_where.join(" AND ");

            // Prepend fts_match param before tag/lang/public params
            params.insert(0, Value::Text(fts_match));

            format!(
                "SELECT {GIST_ROW_G} \
                 FROM gists_fts JOIN gists g ON g.id = gists_fts.gist_id \
                 WHERE {where_clause} \
                 ORDER BY bm25(gists_fts) LIMIT 200"
            )
        } else {
            // Structured-only query — gists is the primary table
            let where_clause = if where_parts.is_empty() {
                String::new()
            } else {
                format!("WHERE {}", where_parts.join(" AND "))
            };
            format!(
                "SELECT {GIST_ROW_G} FROM gists g {where_clause} \
                 ORDER BY g.pinned DESC, g.updated_at DESC LIMIT 200"
            )
        };

        let mut stmt = conn.prepare(&sql)?;
        let mut gists = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                row_to_gist(conn, row)
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        for g in &mut gists {
            g.files = load_files(conn, &g.id)?;
        }
        Ok(gists)
    })
}

/// Get single gist by id.
pub fn get_gist(gist_id: &str) -> Result<Option<Gist>> {
    with_db(|conn| {
        let result = conn
            .prepare(&format!("SELECT {GIST_ROW} FROM gists WHERE id = ?1"))?
            .query_row(params![gist_id], |row| row_to_gist(conn, row));
        match result {
            Ok(mut g) => {
                g.files = load_files(conn, &g.id)?;
                Ok(Some(g))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
}

// ── Tags ──────────────────────────────────────────────────────────────────────

pub fn list_tags() -> Result<Vec<Tag>> {
    with_db(|conn| {
        let mut stmt =
            conn.prepare("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE ASC")?;
        let tags = stmt
            .query_map([], |row| {
                Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(tags)
    })
}

pub fn create_tag(name: &str, color: &str) -> Result<Tag> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO tags(name, color) VALUES(?1, ?2)
             ON CONFLICT(name) DO UPDATE SET color = excluded.color",
            params![name, color],
        )?;
        let tag = conn.query_row(
            "SELECT id, name, color FROM tags WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |row| Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? }),
        )?;
        Ok(tag)
    })
}

pub fn delete_tag(tag_id: i64) -> Result<()> {
    with_db(|conn| {
        conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])?;
        Ok(())
    })
}

pub fn get_gist_tags(gist_id: &str) -> Result<Vec<Tag>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color
             FROM tags t JOIN gist_tags gt ON gt.tag_id = t.id
             WHERE gt.gist_id = ?1
             ORDER BY t.name COLLATE NOCASE ASC",
        )?;
        let tags = stmt
            .query_map(params![gist_id], |row| {
                Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(tags)
    })
}

pub fn set_gist_tags(gist_id: &str, tag_ids: &[i64]) -> Result<()> {
    with_db(|conn| {
        conn.execute("DELETE FROM gist_tags WHERE gist_id = ?1", params![gist_id])?;
        for &tag_id in tag_ids {
            conn.execute(
                "INSERT OR IGNORE INTO gist_tags(gist_id, tag_id) VALUES(?1, ?2)",
                params![gist_id, tag_id],
            )?;
        }
        Ok(())
    })
}

pub fn list_gists_by_tag(tag_id: i64) -> Result<Vec<Gist>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {GIST_ROW_G} FROM gists g
             JOIN gist_tags gt ON gt.gist_id = g.id
             WHERE gt.tag_id = ?1
             ORDER BY g.pinned DESC, g.updated_at DESC",
        ))?;
        let mut gists = stmt
            .query_map(params![tag_id], |row| row_to_gist(conn, row))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for g in &mut gists {
            g.files = load_files(conn, &g.id)?;
        }
        Ok(gists)
    })
}

/// Gists whose `category` matches (user overrides share the same column).
pub fn list_gists_by_category(category: &str) -> Result<Vec<Gist>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {GIST_ROW} FROM gists WHERE COALESCE(category,'gist') = ?1
             ORDER BY pinned DESC, updated_at DESC",
        ))?;
        let mut gists = stmt
            .query_map(params![category], |row| row_to_gist(conn, row))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for g in &mut gists {
            g.files = load_files(conn, &g.id)?;
        }
        Ok(gists)
    })
}

/// Per-category gist counts for the sidebar.
pub fn list_category_counts() -> Result<Vec<CategoryCount>> {
    with_db(|conn| {
        let mut stmt =
            conn.prepare("SELECT COALESCE(category,'gist') AS c, COUNT(*) FROM gists GROUP BY c")?;
        let mut rows: Vec<CategoryCount> = stmt
            .query_map([], |row| {
                Ok(CategoryCount {
                    category: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        const ORDER: &[&str] = &[
            "config",
            "script",
            "document",
            "media",
            "data",
            "multi",
            "snippet",
            "library",
            "test",
            "gist",
        ];
        rows.sort_by_key(|r| {
            ORDER
                .iter()
                .position(|&c| c == r.category.as_str())
                .unwrap_or(ORDER.len())
        });
        Ok(rows)
    })
}

/// Set `category` and lock auto-reclassification for this gist.
pub fn set_gist_category(gist_id: &str, category: &str) -> Result<()> {
    with_db(|conn| {
        conn.execute(
            "UPDATE gists SET category=?1, category_user_set=1 WHERE id=?2",
            params![category, gist_id],
        )?;
        Ok(())
    })
}

/// Toggle pinned state. Returns the new value.
pub fn toggle_pin(gist_id: &str) -> Result<bool> {
    with_db(|conn| {
        let affected = conn.execute(
            "UPDATE gists SET pinned = 1 - COALESCE(pinned,0) WHERE id = ?1",
            params![gist_id],
        )?;
        if affected == 0 {
            bail!("gist not found: {}", gist_id);
        }
        let pinned: i32 = conn.query_row(
            "SELECT COALESCE(pinned,0) FROM gists WHERE id = ?1",
            params![gist_id],
            |row| row.get(0),
        )?;
        Ok(pinned != 0)
    })
}
