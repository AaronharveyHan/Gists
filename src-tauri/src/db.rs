use anyhow::Result;
use once_cell::sync::OnceCell;
use rusqlite::{Connection, params};
use std::sync::Mutex;

pub static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

/// Initialize SQLite database with WAL mode for performance.
/// Tables use TEXT for IDs (GitHub returns string IDs).
pub fn init_db(app_dir: &str) -> Result<()> {
    let path = format!("{}/gists.db", app_dir);
    let conn = Connection::open(&path)?;

    // WAL mode: much faster concurrent reads, non-blocking writes
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gists (
            id          TEXT PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            public      INTEGER NOT NULL DEFAULT 0,  -- 0=secret,1=public
            html_url    TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            synced_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS files (
            gist_id   TEXT NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
            filename  TEXT NOT NULL,
            language  TEXT,
            content   TEXT NOT NULL DEFAULT '',
            size      INTEGER NOT NULL DEFAULT 0,
            raw_url   TEXT,
            PRIMARY KEY (gist_id, filename)
        );

        -- Full-text search virtual table over gist description + file content
        CREATE VIRTUAL TABLE IF NOT EXISTS gists_fts USING fts5(
            gist_id UNINDEXED,
            description,
            filenames,
            content=''
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Tags: user-defined labels with a display color
        CREATE TABLE IF NOT EXISTS tags (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
            color TEXT NOT NULL DEFAULT '#8b949e'
        );

        -- Many-to-many: gist ↔ tag
        CREATE TABLE IF NOT EXISTS gist_tags (
            gist_id TEXT    NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
            PRIMARY KEY (gist_id, tag_id)
        );

        -- Last-known remote content per file (written on every GitHub pull).
        -- Used as the diff baseline in Phase 5/6 without requiring git.
        CREATE TABLE IF NOT EXISTS files_remote_snapshot (
            gist_id   TEXT NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
            filename  TEXT NOT NULL,
            content   TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (gist_id, filename)
        );",
    )?;

    // Additive migrations (silently ignored if column already exists)
    let _ = conn.execute("ALTER TABLE gists ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE gists ADD COLUMN pending_push INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE gists ADD COLUMN remote_etag TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE gists ADD COLUMN category TEXT NOT NULL DEFAULT 'gist'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE gists ADD COLUMN lang_group TEXT NOT NULL DEFAULT 'other'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE gists ADD COLUMN category_user_set INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE gists ADD COLUMN local_only INTEGER NOT NULL DEFAULT 0", []);

    // Semantic search embeddings table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gist_embeddings (
            gist_id     TEXT PRIMARY KEY REFERENCES gists(id) ON DELETE CASCADE,
            version_key TEXT NOT NULL,
            model       TEXT NOT NULL,
            embedding   BLOB NOT NULL
        );",
    )?;

    // Template system tables
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS templates (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            is_public   INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS template_files (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
            filename    TEXT NOT NULL,
            content     TEXT NOT NULL DEFAULT '',
            sort_order  INTEGER NOT NULL DEFAULT 0
        );",
    )?;

    // Collections (workspaces): user-defined named groups of gists
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS collections (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            color       TEXT NOT NULL DEFAULT '#8b949e',
            icon        TEXT NOT NULL DEFAULT 'folder',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS collection_gists (
            collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            gist_id       TEXT NOT NULL REFERENCES gists(id)       ON DELETE CASCADE,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            added_at      TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (collection_id, gist_id)
        );",
    )?;

    // Wiki-links (Obsidian-style [[gist-name]] references). A row records that
    // `source_id` contains a `[[link_text]]` reference; the target is resolved
    // dynamically by name at query time (see cache::get_backlinks), so newly
    // created gists automatically gain backlinks without re-indexing sources.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gist_links (
            source_id TEXT NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
            link_text TEXT NOT NULL,
            PRIMARY KEY (source_id, link_text)
        );
        CREATE INDEX IF NOT EXISTS idx_gist_links_text ON gist_links(link_text);",
    )?;

    // Multi-account support: named GitHub accounts
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS accounts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE,
            login      TEXT,
            avatar_url TEXT,
            token_key  TEXT NOT NULL DEFAULT '',
            is_active  INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );",
    )?;

    // Run-result archive: persists stdout/stderr for every code execution
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS run_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            gist_id     TEXT NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
            filename    TEXT NOT NULL,
            ran_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            exit_code   INTEGER NOT NULL DEFAULT -1,
            stdout      TEXT NOT NULL DEFAULT '',
            stderr      TEXT NOT NULL DEFAULT '',
            duration_ms INTEGER NOT NULL DEFAULT 0,
            timed_out   INTEGER NOT NULL DEFAULT 0,
            killed      INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_run_history_gist
            ON run_history(gist_id, filename, ran_at DESC);",
    )?;

    // ── FTS v2 migration ──────────────────────────────────────────────────────
    // Upgrades the contentless FTS5 table to a full-content table with
    // `content_text` (file bodies) and the unicode61 tokenizer (CJK support).
    migrate_fts_v2(&conn)?;

    // ── Wiki-links backfill ─────────────────────────────────────────────────
    // One-time scan of existing gists so backlinks work for content created
    // before this feature shipped. Idempotent: version tracked in `settings`.
    migrate_links_v1(&conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| anyhow::anyhow!("DB already initialized"))?;
    Ok(())
}

// ── FTS migration ─────────────────────────────────────────────────────────────

/// Upgrades the FTS5 table from the original contentless schema to a
/// full-content schema that includes file body text and uses the unicode61
/// tokenizer for CJK support.  Idempotent: version tracked in `settings`.
fn migrate_fts_v2(conn: &Connection) -> Result<()> {
    let ver: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'fts_version'",
            [],
            |r| r.get(0),
        )
        .ok();

    if ver.as_deref() == Some("2") {
        return Ok(());
    }

    // Drop old table (contentless) and create the full-content version.
    conn.execute_batch(
        "DROP TABLE IF EXISTS gists_fts;
         CREATE VIRTUAL TABLE gists_fts USING fts5(
             gist_id      UNINDEXED,
             description,
             filenames,
             content_text,
             tokenize = 'unicode61'
         );",
    )?;

    // Re-populate from the existing cache so search works immediately.
    let gist_rows: Vec<(String, String)> = conn
        .prepare("SELECT id, COALESCE(description, '') FROM gists")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<_, _>>()?;

    for (gid, desc) in &gist_rows {
        let file_rows: Vec<(String, String)> = conn
            .prepare(
                "SELECT filename, COALESCE(content, '') FROM files WHERE gist_id = ?1",
            )?
            .query_map(params![gid], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;

        let filenames: String = file_rows
            .iter()
            .map(|(n, _)| n.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let content_text: String = file_rows
            .iter()
            .map(|(_, c)| c.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        conn.execute(
            "INSERT INTO gists_fts(gist_id, description, filenames, content_text)
             VALUES(?1, ?2, ?3, ?4)",
            params![gid, desc, filenames, content_text],
        )?;
    }

    conn.execute(
        "INSERT INTO settings(key, value) VALUES('fts_version', '2')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )?;

    Ok(()
    )
}

/// Backfill the `gist_links` table from existing gist content. Runs once; the
/// `links_version` setting guards against re-scanning on every launch.
fn migrate_links_v1(conn: &Connection) -> Result<()> {
    let ver: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'links_version'",
            [],
            |r| r.get(0),
        )
        .ok();

    if ver.as_deref() == Some("1") {
        return Ok(());
    }

    let ids: Vec<String> = conn
        .prepare("SELECT id FROM gists")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;

    for id in &ids {
        let desc: String = conn.query_row(
            "SELECT COALESCE(description, '') FROM gists WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        let contents: Vec<String> = conn
            .prepare("SELECT COALESCE(content, '') FROM files WHERE gist_id = ?1")?
            .query_map(params![id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;

        conn.execute("DELETE FROM gist_links WHERE source_id = ?1", params![id])?;
        let mut seen = std::collections::HashSet::new();
        for text in std::iter::once(&desc).chain(contents.iter()) {
            for link in crate::cache::extract_wiki_links(text) {
                if seen.insert(link.to_lowercase()) {
                    conn.execute(
                        "INSERT OR IGNORE INTO gist_links(source_id, link_text) VALUES(?1, ?2)",
                        params![id, link],
                    )?;
                }
            }
        }
    }

    conn.execute(
        "INSERT INTO settings(key, value) VALUES('links_version', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )?;

    Ok(())
}

// ── helpers ──────────────────────────────────────────────────────────────────

pub fn with_db<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let guard = DB
        .get()
        .ok_or_else(|| anyhow::anyhow!("DB not initialized"))?
        .lock()
        .map_err(|_| anyhow::anyhow!("DB lock poisoned"))?;
    f(&*guard)
}

pub fn with_db_mut<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&mut Connection) -> Result<T>,
{
    let mut guard = DB
        .get()
        .ok_or_else(|| anyhow::anyhow!("DB not initialized"))?
        .lock()
        .map_err(|_| anyhow::anyhow!("DB lock poisoned"))?;
    f(&mut *guard)
}

// ── settings ─────────────────────────────────────────────────────────────────

pub fn get_setting(key: &str) -> Result<Option<String>> {
    with_db(|conn| {
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let result = stmt.query_row(params![key], |row| row.get(0));
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
}

pub fn set_setting(key: &str, value: &str) -> Result<()> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    })
}

// ── accounts ─────────────────────────────────────────────────────────────────

use crate::models::Account;

pub fn list_accounts() -> Result<Vec<Account>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, login, avatar_url, token_key, is_active FROM accounts ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                login: row.get(2)?,
                avatar_url: row.get(3)?,
                token_key: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    })
}

pub fn create_account(
    name: &str,
    login: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<i64> {
    with_db_mut(|conn| {
        let placeholder = format!("pending_{}", chrono::Utc::now().timestamp_millis());
        conn.execute(
            "INSERT INTO accounts(name, login, avatar_url, token_key) VALUES(?1,?2,?3,?4)",
            params![name, login, avatar_url, placeholder],
        )?;
        let id = conn.last_insert_rowid();
        let token_key = format!("gists_client_acct_{}", id);
        conn.execute(
            "UPDATE accounts SET token_key=?1 WHERE id=?2",
            params![token_key, id],
        )?;
        Ok(id)
    })
}

pub fn delete_account(id: i64) -> Result<()> {
    with_db_mut(|conn| {
        conn.execute("DELETE FROM accounts WHERE id=?1", params![id])?;
        Ok(())
    })
}

pub fn set_active_account(id: i64) -> Result<()> {
    with_db_mut(|conn| {
        conn.execute("UPDATE accounts SET is_active=0", [])?;
        conn.execute("UPDATE accounts SET is_active=1 WHERE id=?1", params![id])?;
        Ok(())
    })
}

pub fn get_active_account() -> Result<Option<Account>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, login, avatar_url, token_key, is_active FROM accounts WHERE is_active=1 LIMIT 1",
        )?;
        let result = stmt.query_row([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                login: row.get(2)?,
                avatar_url: row.get(3)?,
                token_key: row.get(4)?,
                is_active: true,
            })
        });
        match result {
            Ok(a) => Ok(Some(a)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
}

// ── run history ───────────────────────────────────────────────────────────────

use crate::models::RunRecord;

pub fn insert_run(
    gist_id: &str,
    filename: &str,
    exit_code: i32,
    stdout: &str,
    stderr: &str,
    duration_ms: i64,
    timed_out: bool,
    killed: bool,
) -> Result<i64> {
    with_db_mut(|conn| {
        conn.execute(
            "INSERT INTO run_history
             (gist_id, filename, exit_code, stdout, stderr, duration_ms, timed_out, killed)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                gist_id, filename, exit_code,
                stdout, stderr, duration_ms,
                timed_out as i64, killed as i64,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

pub fn list_run_history(gist_id: &str, filename: &str, limit: usize) -> Result<Vec<RunRecord>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, gist_id, filename, ran_at, exit_code, stdout, stderr,
                    duration_ms, timed_out, killed
             FROM run_history
             WHERE gist_id=?1 AND filename=?2
             ORDER BY ran_at DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![gist_id, filename, limit as i64], |row| {
            Ok(RunRecord {
                id:          row.get(0)?,
                gist_id:     row.get(1)?,
                filename:    row.get(2)?,
                ran_at:      row.get(3)?,
                exit_code:   row.get(4)?,
                stdout:      row.get(5)?,
                stderr:      row.get(6)?,
                duration_ms: row.get(7)?,
                timed_out:   row.get::<_, i64>(8)? != 0,
                killed:      row.get::<_, i64>(9)? != 0,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    })
}

pub fn delete_old_runs(gist_id: &str, filename: &str, keep: usize) -> Result<()> {
    with_db_mut(|conn| {
        conn.execute(
            "DELETE FROM run_history
             WHERE gist_id=?1 AND filename=?2
               AND id NOT IN (
                   SELECT id FROM run_history
                   WHERE gist_id=?1 AND filename=?2
                   ORDER BY ran_at DESC LIMIT ?3
               )",
            params![gist_id, filename, keep as i64],
        )?;
        Ok(())
    })
}

pub fn get_run(id: i64) -> Result<RunRecord> {
    with_db(|conn| {
        conn.query_row(
            "SELECT id, gist_id, filename, ran_at, exit_code, stdout, stderr,
                    duration_ms, timed_out, killed
             FROM run_history WHERE id=?1",
            params![id],
            |row| Ok(RunRecord {
                id:          row.get(0)?,
                gist_id:     row.get(1)?,
                filename:    row.get(2)?,
                ran_at:      row.get(3)?,
                exit_code:   row.get(4)?,
                stdout:      row.get(5)?,
                stderr:      row.get(6)?,
                duration_ms: row.get(7)?,
                timed_out:   row.get::<_, i64>(8)? != 0,
                killed:      row.get::<_, i64>(9)? != 0,
            }),
        ).map_err(Into::into)
    })
}
