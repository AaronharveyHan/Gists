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

    // ── FTS v2 migration ──────────────────────────────────────────────────────
    // Upgrades the contentless FTS5 table to a full-content table with
    // `content_text` (file bodies) and the unicode61 tokenizer (CJK support).
    migrate_fts_v2(&conn)?;

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
