//! Shared auth + app-data-dir resolution.
//!
//! Used by both the desktop app (`commands.rs` / `main.rs`) and the `gist` CLI
//! binary so they agree on a single keychain entry and a single SQLite database.

use std::path::PathBuf;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use rand::{rngs::OsRng, RngCore};

/// Bundle identifier — must match `tauri.conf.json`'s `identifier`, and is also
/// used as the keychain service name and the app-data subdirectory name.
pub const APP_IDENTIFIER: &str = "com.gists-client.app";

const KEYRING_ACCOUNT: &str = "github_token";

/// Encrypted-DB entries are prefixed so we can distinguish them from legacy
/// plaintext values written by older versions of the app.
const ENC_PREFIX: &str = "enc:v1:";

// ── App-data dir ──────────────────────────────────────────────────────────────

/// Resolve the per-user application data directory.
///
/// Mirrors Tauri v2's `app.path().app_data_dir()`:
///   - macOS:   `~/Library/Application Support/com.gists-client.app`
///   - Linux:   `~/.local/share/com.gists-client.app`
///   - Windows: `%APPDATA%\com.gists-client.app`
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(APP_IDENTIFIER))
}

// ── OS Keychain ───────────────────────────────────────────────────────────────

/// Store token in the OS keychain. Falls back silently if unavailable.
pub fn keyring_set(token: &str) {
    if let Ok(entry) = keyring::Entry::new(APP_IDENTIFIER, KEYRING_ACCOUNT) {
        let _ = entry.set_password(token);
    }
}

/// Like `keyring_set` but returns `true` if the keychain accepted the token.
/// Use this when you need to know whether a DB encrypted fallback is required.
pub fn keyring_set_checked(token: &str) -> bool {
    keyring::Entry::new(APP_IDENTIFIER, KEYRING_ACCOUNT)
        .map(|e| e.set_password(token).is_ok())
        .unwrap_or(false)
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

/// Like `keyring_set_for` but returns `true` if the keychain accepted the token.
pub fn keyring_set_for_checked(account_key: &str, token: &str) -> bool {
    keyring::Entry::new(APP_IDENTIFIER, account_key)
        .map(|e| e.set_password(token).is_ok())
        .unwrap_or(false)
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

// ── Encrypted DB fallback ─────────────────────────────────────────────────────
//
// When the OS keychain is unavailable (headless Linux, CI, non-GNOME/KDE
// desktops) we fall back to storing tokens in the SQLite `settings` table.
// To avoid plaintext secrets at rest, we use AES-256-GCM with a random
// 32-byte key stored in `<app-data>/vault.key` (mode 0600).
//
// Threat model: protects against DB-file exfiltration in isolation.
// An attacker who has read access to both the DB and the key file can still
// recover tokens, but that scenario is equivalent to full user-session
// compromise, which is outside the scope of this control.

/// Load the vault key from disk, generating and persisting it on first use.
fn vault_key() -> anyhow::Result<[u8; 32]> {
    let path = app_data_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot resolve app data dir for vault key"))?
        .join("vault.key");

    if path.exists() {
        let bytes = std::fs::read(&path)?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
        // Corrupt / wrong-length file — regenerate.
    }

    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    write_key_file(&path, &key)?;

    Ok(key)
}

/// Write `key` to `path` with owner-only permissions, atomically on Unix.
///
/// Unix: removes any stale file first, then opens with O_CREAT|O_EXCL and
/// mode 0600 in a single syscall — no window where the file is world-readable.
///
/// Windows: writes the file then restricts the DACL to the current user via
/// icacls, removing inherited entries.
fn write_key_file(path: &std::path::Path, key: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        // Remove stale/corrupt file; ignore "not found" errors.
        let _ = std::fs::remove_file(path);
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true) // O_EXCL — safe even if something races us
            .mode(0o600) // set in the same open() call; no race window
            .open(path)?;
        f.write_all(key)?;
    }

    #[cfg(windows)]
    {
        std::fs::write(path, key)?;
        // Strip inherited ACEs and grant only the current user full control.
        // USERNAME is always set in a normal Windows user session.
        if let Ok(username) = std::env::var("USERNAME") {
            let path_str = path.to_string_lossy().to_string();
            let _ = std::process::Command::new("icacls")
                .args([path_str.as_str(), "/inheritance:r", "/grant"])
                .arg(format!("{username}:(F)"))
                .output();
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        std::fs::write(path, key)?;
    }

    Ok(())
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Encrypt `plaintext` with AES-256-GCM and return an `enc:v1:<hex>` string
/// suitable for storage in the SQLite `settings` table.
pub fn encrypt_for_db(plaintext: &str) -> anyhow::Result<String> {
    let key_bytes = vault_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("AES-GCM encrypt failed: {e}"))?;

    Ok(format!(
        "{ENC_PREFIX}{}{}",
        to_hex(&nonce_bytes),
        to_hex(&ciphertext)
    ))
}

/// Decrypt a value previously produced by `encrypt_for_db`.
///
/// If the value does not start with `enc:v1:` it is treated as a legacy
/// plaintext entry (written by an older version of the app) and returned as-is,
/// allowing a seamless upgrade path for existing users.
pub fn decrypt_from_db(encoded: &str) -> Option<String> {
    if encoded.is_empty() {
        return None;
    }
    if !encoded.starts_with(ENC_PREFIX) {
        // Legacy plaintext — return as-is so the caller can migrate it.
        return Some(encoded.to_string());
    }

    let hex_data = &encoded[ENC_PREFIX.len()..];
    let bytes = from_hex(hex_data)?;
    if bytes.len() < 13 {
        // 12-byte nonce + at least 1 byte of ciphertext (+ 16-byte GCM tag).
        return None;
    }
    let (nonce_bytes, ciphertext) = bytes.split_at(12);

    let key_bytes = vault_key().ok()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;
    String::from_utf8(plaintext).ok()
}

// ── Token load (keychain → encrypted DB) ─────────────────────────────────────

/// Load the saved GitHub token: OS keychain first, then the SQLite `settings`
/// fallback (decrypting if the value carries the `enc:v1:` prefix).
/// The DB must be initialized (`db::init_db`) for the fallback to work.
pub fn load_token() -> Option<String> {
    keyring_get().or_else(|| {
        crate::db::get_setting("token")
            .ok()
            .flatten()
            .filter(|t| !t.is_empty())
            .and_then(|raw| decrypt_from_db(&raw))
    })
}
