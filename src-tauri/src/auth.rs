//! Shared auth + app-data-dir resolution.
//!
//! Used by both the desktop app (`commands.rs` / `main.rs`) and the `gist` CLI
//! binary so they agree on a single keychain entry and a single SQLite database.

use std::path::PathBuf;

/// Bundle identifier — must match `tauri.conf.json`'s `identifier`, and is also
/// used as the keychain service name and the app-data subdirectory name.
pub const APP_IDENTIFIER: &str = "com.gists-client.app";

const KEYRING_ACCOUNT: &str = "github_token";

/// Resolve the per-user application data directory.
///
/// Mirrors Tauri v2's `app.path().app_data_dir()`:
///   - macOS:   `~/Library/Application Support/com.gists-client.app`
///   - Linux:   `~/.local/share/com.gists-client.app`
///   - Windows: `%APPDATA%\com.gists-client.app`
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(APP_IDENTIFIER))
}

/// Store token in the OS keychain. Falls back silently if unavailable.
pub fn keyring_set(token: &str) {
    if let Ok(entry) = keyring::Entry::new(APP_IDENTIFIER, KEYRING_ACCOUNT) {
        let _ = entry.set_password(token);
    }
}

/// Read token from the OS keychain. Returns None if unavailable or not set.
pub fn keyring_get() -> Option<String> {
    keyring::Entry::new(APP_IDENTIFIER, KEYRING_ACCOUNT)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|t| !t.is_empty())
}

/// Remove token from the OS keychain.
pub fn keyring_delete() {
    if let Ok(entry) = keyring::Entry::new(APP_IDENTIFIER, KEYRING_ACCOUNT) {
        let _ = entry.delete_password();
    }
}

/// Store a token under an arbitrary keychain key (for multi-account support).
pub fn keyring_set_for(account_key: &str, token: &str) {
    if let Ok(entry) = keyring::Entry::new(APP_IDENTIFIER, account_key) {
        let _ = entry.set_password(token);
    }
}

/// Read a token by arbitrary keychain key.
pub fn keyring_get_for(account_key: &str) -> Option<String> {
    keyring::Entry::new(APP_IDENTIFIER, account_key)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|t| !t.is_empty())
}

/// Delete a token by arbitrary keychain key.
pub fn keyring_delete_for(account_key: &str) {
    if let Ok(entry) = keyring::Entry::new(APP_IDENTIFIER, account_key) {
        let _ = entry.delete_password();
    }
}

/// Load the saved GitHub token: OS keychain first, then the SQLite `settings`
/// fallback. The DB must be initialized (`db::init_db`) for the fallback to work.
pub fn load_token() -> Option<String> {
    keyring_get().or_else(|| {
        crate::db::get_setting("token")
            .ok()
            .flatten()
            .filter(|t| !t.is_empty())
    })
}
