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
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    apply_schema(&conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| anyhow::anyhow!("DB already initialized"))?;
    Ok(())
}

/// Create every table and run all idempotent migrations on `conn`.
///
/// Extracted from [`init_db`] so the migration logic can be exercised against an
/// in-memory connection in tests without touching the global [`DB`] handle or a
/// file on disk. Safe to call repeatedly on the same connection — every
/// statement is `CREATE TABLE IF NOT EXISTS` / additive `ALTER` (errors ignored)
/// or a version-guarded migration.
pub(crate) fn apply_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

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
    // Added after initial release: flags rows whose output was clipped at 100 KB.
    let _ = conn.execute(
        "ALTER TABLE run_history ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0",
        [],
    );

    // ── FTS v2 migration ──────────────────────────────────────────────────────
    // Upgrades the contentless FTS5 table to a full-content table with
    // `content_text` (file bodies) and the unicode61 tokenizer (CJK support).
    migrate_fts_v2(conn)?;

    // ── Wiki-links backfill ─────────────────────────────────────────────────
    // One-time scan of existing gists so backlinks work for content created
    // before this feature shipped. Idempotent: version tracked in `settings`.
    migrate_links_v1(conn)?;

    Ok(())
}

/// Test-only: initialise the global [`DB`] with a shared in-memory database the
/// first time it is called. Subsequent calls are no-ops, so every test in the
/// binary safely shares one schema-complete connection (serialised by the
/// `Mutex`). Tests must use unique ids/keys to avoid interfering with each other.
#[cfg(test)]
pub(crate) fn ensure_test_db() {
    DB.get_or_init(|| {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        apply_schema(&conn).expect("apply schema");
        Mutex::new(conn)
    });
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

// On lock poisoning (a previous holder panicked) we recover the guard via
// `into_inner()` instead of propagating an error forever. The SQLite connection
// remains valid after a panic — incomplete statements are simply dropped — so
// bricking every subsequent DB call would be worse than continuing. The lock is
// never held across an `.await`, so poisoning is rare to begin with.
pub fn with_db<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let guard = DB
        .get()
        .ok_or_else(|| anyhow::anyhow!("DB not initialized"))?
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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
        .unwrap_or_else(|e| e.into_inner());
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
    truncated: bool,
) -> Result<i64> {
    with_db_mut(|conn| {
        conn.execute(
            "INSERT INTO run_history
             (gist_id, filename, exit_code, stdout, stderr, duration_ms, timed_out, killed, truncated)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                gist_id, filename, exit_code,
                stdout, stderr, duration_ms,
                timed_out as i64, killed as i64, truncated as i64,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

pub fn list_run_history(gist_id: &str, filename: &str, limit: usize) -> Result<Vec<RunRecord>> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, gist_id, filename, ran_at, exit_code, stdout, stderr,
                    duration_ms, timed_out, killed, truncated
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
                truncated:   row.get::<_, i64>(10)? != 0,
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
                    duration_ms, timed_out, killed, truncated
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
                truncated:   row.get::<_, i64>(10)? != 0,
            }),
        ).map_err(Into::into)
    })
}

// ── Factory reset ─────────────────────────────────────────────────────────────

/// Drop every table on `conn` and recreate an empty schema. Extracted from
/// [`wipe_all`] so it can be exercised against an isolated in-memory
/// connection in tests, the same way [`apply_schema`] is.
fn wipe_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys=OFF;
         DROP TABLE IF EXISTS gist_links;
         DROP TABLE IF EXISTS collection_gists;
         DROP TABLE IF EXISTS collections;
         DROP TABLE IF EXISTS template_files;
         DROP TABLE IF EXISTS templates;
         DROP TABLE IF EXISTS gist_embeddings;
         DROP TABLE IF EXISTS files_remote_snapshot;
         DROP TABLE IF EXISTS gist_tags;
         DROP TABLE IF EXISTS tags;
         DROP TABLE IF EXISTS gists_fts;
         DROP TABLE IF EXISTS run_history;
         DROP TABLE IF EXISTS files;
         DROP TABLE IF EXISTS accounts;
         DROP TABLE IF EXISTS settings;
         DROP TABLE IF EXISTS gists;",
    )?;
    apply_schema(conn)
}

/// Drop every table and recreate an empty schema in place. Used by the
/// "reset app" flow to erase all local gist data, settings, and account
/// records in one step. Operates on the existing open connection rather than
/// deleting the on-disk file, which avoids file-lock issues (esp. on Windows)
/// since the singleton `DB` connection stays open for the process lifetime.
pub fn wipe_all() -> Result<()> {
    with_db(wipe_schema)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Insert a minimal gists row so run_history's FK constraint is satisfied.
    fn seed_gist(id: &str) {
        with_db(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO gists(id, description, created_at, updated_at)
                 VALUES(?1, '', datetime('now'), datetime('now'))",
                params![id],
            )?;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn apply_schema_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        // Running the full schema + migrations twice must not error.
        apply_schema(&conn).unwrap();
        apply_schema(&conn).unwrap();

        // Migrations record their version so they never re-run.
        let fts: String = conn
            .query_row("SELECT value FROM settings WHERE key='fts_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts, "2");
        let links: String = conn
            .query_row("SELECT value FROM settings WHERE key='links_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(links, "1");
    }

    #[test]
    fn wipe_schema_erases_data_and_leaves_a_usable_empty_db() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO gists(id, description, created_at, updated_at)
             VALUES('g1', 'hi', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('token', 'ghp_secret')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts(name, token_key) VALUES('acct', 'k')",
            [],
        )
        .unwrap();

        wipe_schema(&conn).unwrap();

        let gists: i64 = conn.query_row("SELECT COUNT(*) FROM gists", [], |r| r.get(0)).unwrap();
        let settings: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0)).unwrap();
        let accounts: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0)).unwrap();
        assert_eq!((gists, settings, accounts), (0, 0, 0));

        // Schema must still be fully usable afterwards (apply_schema reran).
        conn.execute(
            "INSERT INTO gists(id, description, created_at, updated_at)
             VALUES('g2', 'hi again', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
    }

    #[test]
    fn fts_v2_table_accepts_content_text() {
        // The v2 migration replaces the original contentless FTS table with a
        // full-content one; inserting into content_text must succeed.
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO gists_fts(gist_id, description, filenames, content_text)
             VALUES('g1', 'desc', 'a.txt', 'hello world')",
            [],
        )
        .unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM gists_fts WHERE gists_fts MATCH 'hello'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn links_v1_backfills_existing_gists() {
        // Simulate an upgrade: a gist already exists, then the links migration
        // runs and should extract its [[wiki-link]] references.
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO gists(id, description, created_at, updated_at)
             VALUES('src', 'see [[Target Gist]] for more', 'x', 'x')",
            [],
        )
        .unwrap();
        // Clear the version guard so the migration re-runs over the new row.
        conn.execute("DELETE FROM settings WHERE key='links_version'", [])
            .unwrap();
        migrate_links_v1(&conn).unwrap();

        let link: String = conn
            .query_row(
                "SELECT link_text FROM gist_links WHERE source_id='src'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(link, "Target Gist");
    }

    #[test]
    fn settings_roundtrip() {
        ensure_test_db();
        let key = "test_settings_roundtrip_key";
        assert_eq!(get_setting(key).unwrap(), None);
        set_setting(key, "v1").unwrap();
        assert_eq!(get_setting(key).unwrap().as_deref(), Some("v1"));
        // Upsert overwrites rather than duplicating.
        set_setting(key, "v2").unwrap();
        assert_eq!(get_setting(key).unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn accounts_create_activate_delete() {
        ensure_test_db();
        let id = create_account("acct-test-1", Some("octocat"), None).unwrap();
        set_active_account(id).unwrap();

        let active = get_active_account().unwrap().expect("an active account");
        assert_eq!(active.id, id);
        // token_key is derived from the row id after insert.
        assert_eq!(active.token_key, format!("gists_client_acct_{}", id));

        delete_account(id).unwrap();
        assert!(list_accounts().unwrap().iter().all(|a| a.id != id));
    }

    #[test]
    fn run_history_insert_list_and_prune() {
        ensure_test_db();
        let gid = "rh-gist-1";
        let file = "main.py";
        seed_gist(gid);

        for i in 0..5 {
            insert_run(gid, file, i, "out", "err", 10, false, false, false).unwrap();
        }
        let rows = list_run_history(gid, file, 10).unwrap();
        assert_eq!(rows.len(), 5);

        // Keep only the 2 most recent runs for this (gist, file).
        delete_old_runs(gid, file, 2).unwrap();
        assert_eq!(list_run_history(gid, file, 10).unwrap().len(), 2);
    }

    // ── migration chain ───────────────────────────────────────────────────────

    #[test]
    fn migrate_fts_v2_repopulates_from_existing_content() {
        // Simulate an upgrade: gist + files exist in the DB before the FTS v2
        // migration runs.  After the migration the content_text column must be
        // searchable for the pre-existing data.
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        // Seed a gist directly into the base tables (bypassing gists_fts to
        // simulate the pre-migration state).
        conn.execute(
            "INSERT INTO gists(id, description, created_at, updated_at)
             VALUES('fts-up-1', 'upgrade test', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO files(gist_id, filename, content)
             VALUES('fts-up-1', 'a.py', 'unique_upgrade_token_9823')",
            [],
        )
        .unwrap();

        // Reset the version guard and clear the FTS entry so the migration
        // re-runs and must re-populate from the base tables.
        conn.execute("DELETE FROM gists_fts WHERE gist_id='fts-up-1'", []).unwrap();
        conn.execute("DELETE FROM settings WHERE key='fts_version'", []).unwrap();

        migrate_fts_v2(&conn).unwrap();

        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM gists_fts WHERE gists_fts MATCH 'unique_upgrade_token_9823'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "FTS must be populated from pre-existing file content after migration");

        let ver: String = conn
            .query_row("SELECT value FROM settings WHERE key='fts_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, "2");
    }

    #[test]
    fn migrate_fts_v2_is_skipped_when_guard_is_set() {
        // Once the version guard is present the migration must be a no-op.
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        // Mark v2 done (apply_schema already does this, so calling it twice is fine)
        migrate_fts_v2(&conn).unwrap();

        let ver: String = conn
            .query_row("SELECT value FROM settings WHERE key='fts_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, "2", "guard must survive a second run");
    }

    #[test]
    fn migrate_links_v1_extracts_links_from_file_content() {
        // The backfill must scan file bodies, not just gist descriptions.
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO gists(id, description, created_at, updated_at)
             VALUES('ln-fc', 'plain description', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO files(gist_id, filename, content)
             VALUES('ln-fc', 'notes.md', 'see [[FileTarget]] for details')",
            [],
        )
        .unwrap();

        // Reset guard so migration re-runs over the new row.
        conn.execute("DELETE FROM settings WHERE key='links_version'", []).unwrap();
        conn.execute("DELETE FROM gist_links WHERE source_id='ln-fc'", []).unwrap();

        migrate_links_v1(&conn).unwrap();

        let link: String = conn
            .query_row(
                "SELECT link_text FROM gist_links WHERE source_id='ln-fc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(link, "FileTarget");
    }

    #[test]
    fn migrate_links_v1_guard_prevents_duplicate_insertion() {
        // Running migrate_links_v1 a second time (guard says "1") must not
        // insert duplicate rows.
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO gists(id, description, created_at, updated_at)
             VALUES('ln-dup', 'see [[Thing]]', 'x', 'x')",
            [],
        )
        .unwrap();

        // First run (reset guard to force it)
        conn.execute("DELETE FROM settings WHERE key='links_version'", []).unwrap();
        migrate_links_v1(&conn).unwrap();
        let count1: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM gist_links WHERE source_id='ln-dup'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count1, 1);

        // Second run — guard is now "1", must be a no-op
        migrate_links_v1(&conn).unwrap();
        let count2: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM gist_links WHERE source_id='ln-dup'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count2, 1, "version guard must prevent re-scanning and duplicate links");
    }

    #[test]
    fn migrate_fts_v2_description_column_is_searchable() {
        // Verifies that the description column (not just content_text) is
        // indexed by FTS5 after the v2 migration.
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO gists(id, description, created_at, updated_at)
             VALUES('fts-desc-up', 'quokka_migration_desc', 'x', 'x')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM gists_fts WHERE gist_id='fts-desc-up'", []).unwrap();
        conn.execute("DELETE FROM settings WHERE key='fts_version'", []).unwrap();
        migrate_fts_v2(&conn).unwrap();

        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM gists_fts WHERE gists_fts MATCH 'quokka_migration_desc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "description must be indexed after FTS v2 migration");
    }
}
