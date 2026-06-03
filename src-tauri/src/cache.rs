/// Local SQLite cache layer for Gists.
/// All reads are offline-capable; writes go to DB first, then sync to GitHub.
use anyhow::{bail, Result};
use rusqlite::{Connection, params};
use std::collections::HashMap;

use crate::db::with_db;
use crate::models::{CategoryCount, Gist, GistFile, Tag};

// ── Wiki-links ([[gist-name]]) ──────────────────────────────────────────────

/// Extract `[[...]]` wiki-link targets from a block of text.
///
/// Pure (no DB). Inner text may not span lines or contain nested brackets.
/// Whitespace is trimmed, empties skipped, and results are returned in order
/// of first appearance (callers dedupe case-insensitively).
pub fn extract_wiki_links(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 1 < chars.len() {
        if chars[i] == '[' && chars[i + 1] == '[' {
            let mut j = i + 2;
            let mut buf = String::new();
            let mut closed = false;
            while j < chars.len() {
                let c = chars[j];
                if c == ']' && j + 1 < chars.len() && chars[j + 1] == ']' {
                    closed = true;
                    break;
                }
                // Reject runaway/invalid spans (newlines or stray brackets).
                if c == '\n' || c == '[' || c == ']' {
                    break;
                }
                buf.push(c);
                j += 1;
            }
            if closed {
                let t = buf.trim();
                if !t.is_empty() && t.chars().count() <= 200 {
                    out.push(t.to_string());
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Replace the stored link set for `source_id` by re-scanning its description
/// and file contents. Operates on the caller's connection (inside a write).
fn reindex_links(
    conn: &Connection,
    source_id: &str,
    description: &str,
    contents: &[&str],
) -> Result<()> {
    conn.execute("DELETE FROM gist_links WHERE source_id = ?1", params![source_id])?;
    let mut seen = std::collections::HashSet::new();
    for text in std::iter::once(description).chain(contents.iter().copied()) {
        for link in extract_wiki_links(text) {
            if seen.insert(link.to_lowercase()) {
                conn.execute(
                    "INSERT OR IGNORE INTO gist_links(source_id, link_text) VALUES(?1, ?2)",
                    params![source_id, link],
                )?;
            }
        }
    }
    Ok(())
}

/// Gists that reference `gist_id` via `[[...]]`, resolved dynamically by name.
///
/// A source backlinks to this gist when its stored `link_text` matches (case-
/// insensitively) the gist's description or any of its filenames. Self-links
/// are excluded. Results are ordered most-recently-updated first.
pub fn get_backlinks(gist_id: &str) -> Result<Vec<Gist>> {
    use rusqlite::types::Value;
    with_db(|conn| {
        let desc: String = conn.query_row(
            "SELECT COALESCE(description, '') FROM gists WHERE id = ?1",
            params![gist_id],
            |r| r.get(0),
        )?;

        let mut names: Vec<String> = Vec::new();
        if !desc.trim().is_empty() {
            names.push(desc.trim().to_lowercase());
        }
        for f in load_files(conn, gist_id)? {
            names.push(f.filename.to_lowercase());
        }
        names.sort();
        names.dedup();
        if names.is_empty() {
            return Ok(vec![]);
        }

        let placeholders = names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT DISTINCT source_id FROM gist_links \
             WHERE LOWER(link_text) IN ({placeholders}) AND source_id != ?"
        );
        let mut params_vec: Vec<Value> =
            names.iter().map(|n| Value::Text(n.clone())).collect();
        params_vec.push(Value::Text(gist_id.to_string()));

        let source_ids: Vec<String> = conn
            .prepare(&sql)?
            .query_map(rusqlite::params_from_iter(params_vec.iter()), |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;

        let mut out = Vec::new();
        for sid in source_ids {
            let mut stmt =
                conn.prepare(&format!("SELECT {GIST_ROW} FROM gists WHERE id = ?1"))?;
            let mut g = stmt.query_row(params![sid], |row| row_to_gist(conn, row))?;
            g.files = load_files(conn, &g.id)?;
            out.push(g);
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    })
}

/// Resolve a `[[link_text]]` to the gist it refers to. Matches (case-insensitive)
/// against description first, then any filename. Returns the first match or None.
pub fn resolve_wiki_link(link_text: &str) -> Result<Option<Gist>> {
    let lc = link_text.trim().to_lowercase();
    with_db(|conn| {
        let id = resolve_wiki_id(conn, &lc)?;
        let Some(id) = id else { return Ok(None) };
        let mut stmt =
            conn.prepare(&format!("SELECT {GIST_ROW} FROM gists WHERE id = ?1"))?;
        let mut g = stmt.query_row(params![id], |row| row_to_gist(conn, row))?;
        g.files = load_files(conn, &g.id)?;
        Ok(Some(g))
    })
}

/// Resolve a lowercased wiki-link string to a gist ID using a cascade of
/// increasingly-fuzzy strategies so that [[My gist]], [[my gist]], and
/// [[my]] all find "My Gist" when no exact match exists.
fn resolve_wiki_id(conn: &Connection, lc: &str) -> Result<Option<String>> {
    if lc.is_empty() {
        return Ok(None);
    }

    // 1. Exact case-insensitive match on description or filename.
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM gists WHERE LOWER(TRIM(description)) = ?1
             UNION ALL
             SELECT gist_id FROM files WHERE LOWER(filename) = ?1
             LIMIT 1",
            params![lc],
            |r| r.get::<_, String>(0),
        )
        .ok()
    {
        return Ok(Some(id));
    }

    // 2. Description starts-with (avoids LIKE wildcard escaping issues).
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM gists \
             WHERE SUBSTR(LOWER(TRIM(description)), 1, LENGTH(?1)) = ?1 LIMIT 1",
            params![lc],
            |r| r.get::<_, String>(0),
        )
        .ok()
    {
        return Ok(Some(id));
    }

    // 3. Description contains the full link text.
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM gists WHERE INSTR(LOWER(description), ?1) > 0 LIMIT 1",
            params![lc],
            |r| r.get::<_, String>(0),
        )
        .ok()
    {
        return Ok(Some(id));
    }

    // 4. Filename contains the full link text.
    if let Some(id) = conn
        .query_row(
            "SELECT gist_id FROM files WHERE INSTR(LOWER(filename), ?1) > 0 LIMIT 1",
            params![lc],
            |r| r.get::<_, String>(0),
        )
        .ok()
    {
        return Ok(Some(id));
    }

    // 5. Word-overlap fuzzy match: every query token appears somewhere in the
    //    description.  Returns the gist with the most token matches (ties broken
    //    by fewest extra words in the description — i.e. the shortest description
    //    that satisfies the query).
    let query_words: Vec<&str> = lc.split_whitespace().collect();
    if query_words.is_empty() {
        return Ok(None);
    }

    let mut stmt =
        conn.prepare("SELECT id, LOWER(COALESCE(description,'')) FROM gists")?;
    let candidates: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    let best = candidates
        .iter()
        .filter_map(|(id, desc)| {
            let hits = query_words.iter().filter(|w| desc.contains(*w)).count();
            // Require at least half the query tokens to match.
            if hits * 2 >= query_words.len() {
                Some((hits, desc.split_whitespace().count(), id))
            } else {
                None
            }
        })
        // Most hits first; among equal hits prefer the shortest description.
        .max_by_key(|&(hits, desc_words, _)| (hits, usize::MAX - desc_words))
        .map(|(_, _, id)| id.clone());

    Ok(best)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// SELECT list aligned with `row_to_gist` column order (no table prefix).
const GIST_ROW: &str = "id, description, public, html_url, created_at, updated_at, \
    COALESCE(pending_push,0), COALESCE(category,'gist'), COALESCE(lang_group,'other'), \
    COALESCE(pinned,0), COALESCE(local_only,0)";

/// Same columns with `g.` prefix (search / joins).
const GIST_ROW_G: &str = "g.id, g.description, g.public, g.html_url, g.created_at, g.updated_at, \
    COALESCE(g.pending_push,0), COALESCE(g.category,'gist'), COALESCE(g.lang_group,'other'), \
    COALESCE(g.pinned,0), COALESCE(g.local_only,0)";

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

    let contents: Vec<&str> = gist.files.iter().map(|f| f.content.as_str()).collect();
    reindex_links(conn, &gist.id, &gist.description, &contents)?;

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

        let contents: Vec<&str> = files.iter().map(|f| f.content.as_str()).collect();
        reindex_links(conn, gist_id, description, &contents)?;

        let mut g = Gist {
            id,
            description: description.to_string(),
            public: public != 0,
            html_url,
            created_at,
            updated_at,
            files: files.clone(),
            pending_push: true,
            local_only: false,
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

fn new_local_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("local-{:x}{:05x}", d.as_secs(), d.subsec_micros())
}

/// Create a gist that lives only in local SQLite (never sent to GitHub).
pub fn create_local_draft(
    description: &str,
    public: bool,
    files: &[(String, String)],
) -> Result<Gist> {
    use crate::db::with_db;
    with_db(|conn| {
        let id = new_local_id();
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

        conn.execute(
            "INSERT INTO gists(id, description, public, html_url, created_at, updated_at, \
             synced_at, pending_push, local_only) \
             VALUES(?1,?2,?3,'',?4,?4,?4,1,1)",
            params![id, description, public as i32, now],
        )?;

        for (filename, content) in files {
            conn.execute(
                "INSERT OR REPLACE INTO files(gist_id, filename, content, size) \
                 VALUES(?1,?2,?3,?4)",
                params![id, filename, content, content.len() as i64],
            )?;
        }

        // FTS index
        let fnames = files.iter().map(|(f, _)| f.as_str()).collect::<Vec<_>>().join(" ");
        let fc = files.iter().map(|(_, c)| c.as_str()).collect::<Vec<_>>().join("\n");
        let _ = conn.execute(
            "INSERT INTO gists_fts(gist_id, description, filenames, content_text) \
             VALUES(?1,?2,?3,?4)",
            params![id, description, fnames, fc],
        );

        let gist_files: Vec<GistFile> = files
            .iter()
            .map(|(filename, content)| GistFile {
                filename: filename.clone(),
                language: None,
                content: content.clone(),
                size: content.len() as i64,
                raw_url: None,
            })
            .collect();

        let mut g = Gist {
            id: id.clone(),
            description: description.to_string(),
            public,
            html_url: String::new(),
            created_at: now.clone(),
            updated_at: now,
            files: gist_files,
            pending_push: true,
            local_only: true,
            category: "gist".into(),
            lang_group: "other".into(),
            pinned: false,
        };
        let fc_refs: Vec<&str> = files.iter().map(|(_, c)| c.as_str()).collect();
        reindex_links(conn, &id, description, &fc_refs)?;

        classify_and_persist(conn, &g)?;
        if let Ok((cat, lg)) = conn.query_row(
            "SELECT COALESCE(category,'gist'), COALESCE(lang_group,'other') FROM gists WHERE id=?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            g.category = cat;
            g.lang_group = lg;
        }
        Ok(g)
    })
}

/// Atomically promote a local draft to a real GitHub gist.
/// Updates the local placeholder ID to the GitHub-assigned ID in all tables.
pub fn promote_local_to_remote(local_id: &str, new_gist: &Gist) -> Result<()> {
    use crate::db::with_db_mut;
    with_db_mut(|conn| {
        let tx = conn.transaction()?;
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

        // Copy gist row with GitHub ID, cleared local_only + pending_push flags.
        tx.execute(
            "INSERT INTO gists(id, description, public, html_url, created_at, updated_at, \
             synced_at, pending_push, local_only, pinned, category, lang_group) \
             SELECT ?1, description, public, ?2, created_at, ?3, ?4, 0, 0, \
             pinned, category, lang_group \
             FROM gists WHERE id = ?5",
            params![new_gist.id, new_gist.html_url, new_gist.updated_at, now, local_id],
        )?;

        // Migrate all FK references.
        tx.execute("UPDATE files SET gist_id=?1 WHERE gist_id=?2", params![new_gist.id, local_id])?;
        tx.execute("UPDATE gist_tags SET gist_id=?1 WHERE gist_id=?2", params![new_gist.id, local_id])?;
        tx.execute("UPDATE files_remote_snapshot SET gist_id=?1 WHERE gist_id=?2", params![new_gist.id, local_id])?;
        tx.execute("DELETE FROM gists_fts WHERE gist_id=?1", params![local_id])?;
        tx.execute("DELETE FROM gists WHERE id=?1", params![local_id])?;

        tx.commit()?;
        Ok(())
    })
}

pub fn is_local_only(gist_id: &str) -> Result<bool> {
    with_db(|conn| {
        let v: i32 = conn.query_row(
            "SELECT COALESCE(local_only,0) FROM gists WHERE id=?1",
            params![gist_id],
            |r| r.get(0),
        ).unwrap_or(0);
        Ok(v != 0)
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
        local_only: row.get::<_, i32>(10)? != 0,
    })
}

/// List all cached gists ordered by most recently updated.
/// Return all (gist_id, tag_id) pairs — used to build the relation graph.
pub fn list_gist_tag_pairs() -> Result<Vec<(String, i32)>> {
    with_db(|conn| {
        let pairs: Vec<(String, i32)> = conn
            .prepare("SELECT gist_id, tag_id FROM gist_tags")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(pairs)
    })
}

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

/// Tag usage counts for the stats panel.
#[derive(serde::Serialize, Clone)]
pub struct TagCount {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub count: i64,
}

pub fn list_tag_counts() -> Result<Vec<TagCount>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color, COUNT(gt.gist_id) AS cnt \
             FROM tags t \
             LEFT JOIN gist_tags gt ON t.id = gt.tag_id \
             GROUP BY t.id \
             ORDER BY cnt DESC, t.name ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TagCount {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    count: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
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

// ── Semantic search / embeddings ──────────────────────────────────────────────

use crate::embedding::{bytes_to_vec, cosine_similarity, vec_to_bytes};

#[derive(Debug, Clone, serde::Serialize)]
pub struct SemanticResult {
    pub gist_id: String,
    pub score: f32,
}

/// Upsert an embedding for a gist.
pub fn store_embedding(
    gist_id: &str,
    version_key: &str,
    model: &str,
    embedding: &[f32],
) -> Result<()> {
    let bytes = vec_to_bytes(embedding);
    with_db(|conn| {
        conn.execute(
            "INSERT INTO gist_embeddings(gist_id, version_key, model, embedding)
             VALUES(?1,?2,?3,?4)
             ON CONFLICT(gist_id) DO UPDATE SET
                 version_key=excluded.version_key,
                 model=excluded.model,
                 embedding=excluded.embedding",
            params![gist_id, version_key, model, bytes],
        )?;
        Ok(())
    })
}

/// Gists whose stored embedding is missing or stale for the given model.
/// Returns (gist_id, updated_at) pairs ordered newest-first.
pub fn get_stale_gist_ids(model: &str) -> Result<Vec<(String, String)>> {
    with_db(|conn| {
        conn.prepare(
            "SELECT g.id, g.updated_at
             FROM gists g
             LEFT JOIN gist_embeddings e
               ON e.gist_id = g.id AND e.model = ?1
             WHERE e.gist_id IS NULL OR e.version_key != g.updated_at
             ORDER BY g.updated_at DESC",
        )?
        .query_map(params![model], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
    })
}

/// Fetch description + file content for a gist and build the embed text.
pub fn build_embed_text_for_gist(gist_id: &str) -> Result<String> {
    with_db(|conn| {
        let description: String = conn.query_row(
            "SELECT COALESCE(description,'') FROM gists WHERE id=?1",
            params![gist_id],
            |r| r.get(0),
        )?;
        let files: Vec<(String, String)> = conn
            .prepare(
                "SELECT filename, COALESCE(content,'')
                 FROM files WHERE gist_id=?1 ORDER BY filename",
            )?
            .query_map(params![gist_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(crate::embedding::build_embed_text(&description, &files))
    })
}

/// Return (indexed_count, total_gist_count) for the given model.
pub fn embedding_counts(model: &str) -> Result<(usize, usize)> {
    with_db(|conn| {
        let total: usize =
            conn.query_row("SELECT COUNT(*) FROM gists", [], |r| r.get(0))?;
        let indexed: usize = conn.query_row(
            "SELECT COUNT(*) FROM gist_embeddings WHERE model=?1",
            params![model],
            |r| r.get(0),
        )?;
        Ok((indexed, total))
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SimilarPair {
    pub a: String,
    pub b: String,
    pub score: f32,
}

/// All gist pairs whose cosine similarity ≥ `threshold`, sorted descending and
/// capped at `max_pairs`. O(n²) over stored vectors — fine for the typical
/// few-hundred gists; callers should keep `max_pairs` modest.
pub fn find_similar_pairs(
    model: &str,
    threshold: f32,
    max_pairs: usize,
) -> Result<Vec<SimilarPair>> {
    let raw: Vec<(String, Vec<u8>)> = with_db(|conn| {
        conn.prepare("SELECT gist_id, embedding FROM gist_embeddings WHERE model=?1")?
            .query_map(params![model], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    })?;

    let vecs: Vec<(String, Vec<f32>)> = raw
        .into_iter()
        .map(|(id, bytes)| (id, bytes_to_vec(&bytes)))
        .collect();

    let mut pairs: Vec<SimilarPair> = Vec::new();
    for i in 0..vecs.len() {
        for j in (i + 1)..vecs.len() {
            let score = cosine_similarity(&vecs[i].1, &vecs[j].1);
            if score >= threshold {
                pairs.push(SimilarPair {
                    a: vecs[i].0.clone(),
                    b: vecs[j].0.clone(),
                    score,
                });
            }
        }
    }
    pairs.sort_by(|x, y| y.score.partial_cmp(&x.score).unwrap_or(std::cmp::Ordering::Equal));
    pairs.truncate(max_pairs);
    Ok(pairs)
}

/// Cosine similarity search. Returns top-N gist IDs with score > 0.10.
pub fn semantic_search_by_embedding(
    query: &[f32],
    model: &str,
    limit: usize,
) -> Result<Vec<SemanticResult>> {
    let rows: Vec<(String, Vec<u8>)> = with_db(|conn| {
        conn.prepare("SELECT gist_id, embedding FROM gist_embeddings WHERE model=?1")?
            .query_map(params![model], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    })?;

    let mut scored: Vec<SemanticResult> = rows
        .into_iter()
        .map(|(id, bytes)| {
            let score = cosine_similarity(query, &bytes_to_vec(&bytes));
            SemanticResult { gist_id: id, score }
        })
        .collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    Ok(scored
        .into_iter()
        .take(limit)
        .filter(|r| r.score > 0.10)
        .collect())
}

// ── Collections ───────────────────────────────────────────────────────────────

use crate::models::{Collection, CollectionCount};

/// Generate a unique collection ID from the current nanosecond timestamp.
fn gen_collection_id() -> String {
    let nanos = chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis() * 1_000_000);
    format!("col-{nanos:x}")
}

pub fn list_collections() -> Result<Vec<Collection>> {
    with_db(|conn| {
        conn.prepare(
            "SELECT id, name, description, color, icon, created_at, updated_at
             FROM collections ORDER BY name COLLATE NOCASE ASC",
        )?
        .query_map([], |r| {
            Ok(Collection {
                id:          r.get(0)?,
                name:        r.get(1)?,
                description: r.get(2)?,
                color:       r.get(3)?,
                icon:        r.get(4)?,
                created_at:  r.get(5)?,
                updated_at:  r.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
    })
}

pub fn list_collection_counts() -> Result<Vec<CollectionCount>> {
    with_db(|conn| {
        conn.prepare(
            "SELECT c.id, c.name, c.color, c.icon, COUNT(cg.gist_id) as cnt
             FROM collections c
             LEFT JOIN collection_gists cg ON cg.collection_id = c.id
             GROUP BY c.id ORDER BY c.name COLLATE NOCASE ASC",
        )?
        .query_map([], |r| {
            Ok(CollectionCount {
                id:    r.get(0)?,
                name:  r.get(1)?,
                color: r.get(2)?,
                icon:  r.get(3)?,
                count: r.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
    })
}

pub fn create_collection(
    name: &str,
    description: &str,
    color: &str,
    icon: &str,
) -> Result<Collection> {
    let id = gen_collection_id();
    with_db(|conn| {
        conn.execute(
            "INSERT INTO collections(id, name, description, color, icon)
             VALUES(?1, ?2, ?3, ?4, ?5)",
            params![id, name, description, color, icon],
        )?;
        let c = conn.query_row(
            "SELECT id, name, description, color, icon, created_at, updated_at
             FROM collections WHERE id = ?1",
            params![id],
            |r| Ok(Collection {
                id:          r.get(0)?,
                name:        r.get(1)?,
                description: r.get(2)?,
                color:       r.get(3)?,
                icon:        r.get(4)?,
                created_at:  r.get(5)?,
                updated_at:  r.get(6)?,
            }),
        )?;
        Ok(c)
    })
}

pub fn update_collection(
    id: &str,
    name: &str,
    description: &str,
    color: &str,
    icon: &str,
) -> Result<Collection> {
    with_db(|conn| {
        conn.execute(
            "UPDATE collections SET name=?2, description=?3, color=?4, icon=?5,
             updated_at=datetime('now') WHERE id=?1",
            params![id, name, description, color, icon],
        )?;
        let c = conn.query_row(
            "SELECT id, name, description, color, icon, created_at, updated_at
             FROM collections WHERE id = ?1",
            params![id],
            |r| Ok(Collection {
                id:          r.get(0)?,
                name:        r.get(1)?,
                description: r.get(2)?,
                color:       r.get(3)?,
                icon:        r.get(4)?,
                created_at:  r.get(5)?,
                updated_at:  r.get(6)?,
            }),
        )?;
        Ok(c)
    })
}

pub fn delete_collection(id: &str) -> Result<()> {
    with_db(|conn| {
        conn.execute("DELETE FROM collections WHERE id=?1", params![id])?;
        Ok(())
    })
}

pub fn add_gist_to_collection(collection_id: &str, gist_id: &str) -> Result<()> {
    with_db(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO collection_gists(collection_id, gist_id) VALUES(?1,?2)",
            params![collection_id, gist_id],
        )?;
        Ok(())
    })
}

pub fn remove_gist_from_collection(collection_id: &str, gist_id: &str) -> Result<()> {
    with_db(|conn| {
        conn.execute(
            "DELETE FROM collection_gists WHERE collection_id=?1 AND gist_id=?2",
            params![collection_id, gist_id],
        )?;
        Ok(())
    })
}

pub fn list_collection_gists(collection_id: &str) -> Result<Vec<Gist>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {GIST_ROW_G} FROM gists g
             JOIN collection_gists cg ON cg.gist_id = g.id
             WHERE cg.collection_id = ?1
             ORDER BY g.pinned DESC, cg.added_at DESC",
        ))?;
        let mut gists = stmt
            .query_map(params![collection_id], |row| row_to_gist(conn, row))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for g in &mut gists {
            g.files = load_files(conn, &g.id)?;
        }
        Ok(gists)
    })
}

pub fn get_gist_collections(gist_id: &str) -> Result<Vec<Collection>> {
    with_db(|conn| {
        conn.prepare(
            "SELECT c.id, c.name, c.description, c.color, c.icon, c.created_at, c.updated_at
             FROM collections c
             JOIN collection_gists cg ON cg.collection_id = c.id
             WHERE cg.gist_id = ?1
             ORDER BY c.name COLLATE NOCASE ASC",
        )?
        .query_map(params![gist_id], |r| {
            Ok(Collection {
                id:          r.get(0)?,
                name:        r.get(1)?,
                description: r.get(2)?,
                color:       r.get(3)?,
                icon:        r.get(4)?,
                created_at:  r.get(5)?,
                updated_at:  r.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
    })
}
