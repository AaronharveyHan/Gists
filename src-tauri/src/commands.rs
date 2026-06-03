/// Tauri commands — the IPC bridge between the frontend and Rust backend.
/// Each command is async and returns a JSON-serializable result.
use std::collections::HashMap;
use tauri::{Emitter, State};
use tokio::sync::Mutex;

pub use crate::ai::AiMessage;

const AI_DEFAULT_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const AI_DEFAULT_MODEL: &str = "qwen-turbo";
const AI_DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-v3";

use chrono::Utc;

use gists_client::{cache, db, github, models::*, templates, vscode_snippets};
use gists_client::github::FetchGistOutcome;

// Keychain helpers live in `gists_client::auth` so the desktop app and the `gist`
// CLI share one keychain entry. Re-export `keyring_get` for `main.rs`.
use gists_client::auth::{
    decrypt_from_db, encrypt_for_db,
    keyring_delete, keyring_delete_for,
    keyring_get_for,
    keyring_set_checked, keyring_set_for_checked,
};
pub use gists_client::auth::keyring_get;

// ── App state ─────────────────────────────────────────────────────────────────

pub struct AppState {
    pub token: Mutex<Option<String>>,
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_token(
    token: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Fast local check — avoids wasting an API call on clearly invalid input.
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token cannot be empty".into());
    }
    let known_prefix = token.starts_with("ghp_")
        || token.starts_with("ghu_")
        || token.starts_with("gho_")
        || token.starts_with("ghs_")
        || token.starts_with("github_pat_");
    if !known_prefix || token.len() < 20 {
        return Err(
            "Invalid token format — expected ghp_…, ghu_…, gho_…, or github_pat_…".into(),
        );
    }

    let login = github::validate_token(&token)
        .await
        .map_err(|e| e.to_string())?;

    // Prefer OS keychain. If unavailable (headless Linux, no GNOME/KDE session),
    // write an AES-256-GCM encrypted copy to SQLite instead of plaintext.
    if keyring_set_checked(&token) {
        // Keychain accepted — clear any stale DB copy so there is no plaintext.
        let _ = db::set_setting("token", "");
    } else {
        let enc = encrypt_for_db(&token).map_err(|e| e.to_string())?;
        db::set_setting("token", &enc).map_err(|e| e.to_string())?;
    }
    db::set_setting("gh_login", &login).map_err(|e| e.to_string())?;
    *state.token.lock().await = Some(token);
    Ok(login)
}

#[tauri::command]
pub async fn get_token(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.token.lock().await.is_some())
}

#[tauri::command]
pub async fn get_current_login(state: State<'_, AppState>) -> Result<String, String> {
    if let Ok(Some(login)) = db::get_setting("gh_login") {
        if !login.is_empty() {
            return Ok(login);
        }
    }
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    let login = github::validate_token(&token).await.map_err(|e| e.to_string())?;
    db::set_setting("gh_login", &login).map_err(|e| e.to_string())?;
    Ok(login)
}

#[tauri::command]
pub async fn clear_token(state: State<'_, AppState>) -> Result<(), String> {
    keyring_delete();
    db::set_setting("token", "").map_err(|e| e.to_string())?;
    db::set_setting("gh_login", "").map_err(|e| e.to_string())?;
    *state.token.lock().await = None;
    Ok(())
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/// `force === true` (literal bool) → full sync; anything else → incremental.
/// Guard exists because Tauri can pass a SyntheticEvent when used as onClick handler.
#[tauri::command]
pub async fn sync_gists(force: bool, state: State<'_, AppState>) -> Result<SyncResult, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;

    // Only literal `true` means full sync
    let full_sync = force;
    let since = if full_sync {
        None
    } else {
        cache::get_last_sync_time().ok().flatten().filter(|s| !s.is_empty())
    };
    let incremental = since.is_some();

    let pairs = github::fetch_gists_sync_pairs(&token, since.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    let updated = pairs.len();
    cache::upsert_gists_with_etags(&pairs).map_err(|e| e.to_string())?;

    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let _ = cache::set_last_sync_time(&now);

    let total = cache::count_gists().map_err(|e| e.to_string())?;
    Ok(SyncResult { updated, total, incremental })
}

// ── List / Search ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_gists() -> Result<Vec<Gist>, String> {
    cache::list_gists().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_gists(query: String) -> Result<Vec<Gist>, String> {
    if query.trim().is_empty() {
        cache::list_gists().map_err(|e| e.to_string())
    } else {
        cache::search_gists(&query).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_gist(gist_id: String) -> Result<Option<Gist>, String> {
    cache::get_gist(&gist_id).map_err(|e| e.to_string())
}

// ── Create ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_gist(
    description: String,
    public: bool,
    files: Vec<(String, String)>,
    state: State<'_, AppState>,
) -> Result<Gist, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    let (gist, etag) = github::create_gist(&token, &description, public, files)
        .await
        .map_err(|e| e.to_string())?;
    cache::upsert_gist_from_remote_with_etag(&gist, etag.as_deref())
        .map_err(|e| e.to_string())?;
    cache::get_gist(&gist.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to read gist after create".to_string())
}

// ── Draft save ────────────────────────────────────────────────────────────────

/// Save current editor state to SQLite only (`pending_push=1`).
/// Does NOT push to GitHub.
#[tauri::command]
pub fn save_gist_draft(
    gist_id: String,
    description: String,
    files: Vec<(String, String)>,
) -> Result<Gist, String> {
    cache::save_gist_draft(&gist_id, &description, &files).map_err(|e| e.to_string())
}

// ── Remote fetch ──────────────────────────────────────────────────────────────

/// Fetch latest from GitHub (using ETag), return local cache on 304.
#[tauri::command]
pub async fn fetch_gist_from_github(
    gist_id: String,
    state: State<'_, AppState>,
) -> Result<Gist, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    let etag = cache::get_remote_etag(&gist_id).map_err(|e| e.to_string())?;
    match github::fetch_gist_conditional(&token, &gist_id, etag.as_deref())
        .await
        .map_err(|e| e.to_string())?
    {
        FetchGistOutcome::Modified { gist, etag: new_etag } => {
            if let Some(ref e) = new_etag {
                let _ = cache::set_remote_etag(&gist_id, Some(e.as_str()));
            }
            Ok(gist)
        }
        FetchGistOutcome::NotModified => cache::get_gist(&gist_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No local gist — run Sync first.".to_string()),
    }
}

/// Fetch latest from GitHub and replace local cache (clears `pending_push`).
#[tauri::command]
pub async fn pull_gist_remote(
    gist_id: String,
    state: State<'_, AppState>,
) -> Result<Gist, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    let etag = cache::get_remote_etag(&gist_id).map_err(|e| e.to_string())?;
    match github::fetch_gist_conditional(&token, &gist_id, etag.as_deref())
        .await
        .map_err(|e| e.to_string())?
    {
        FetchGistOutcome::Modified { gist, etag: new_etag } => {
            cache::upsert_gist_from_remote_with_etag(&gist, new_etag.as_deref())
                .map_err(|e| e.to_string())?;
            cache::get_gist(&gist.id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "No local gist after pull.".to_string())
        }
        FetchGistOutcome::NotModified => cache::get_gist(&gist_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No local gist — run Sync first.".to_string()),
    }
}

// ── Update ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_gist(
    gist_id: String,
    description: String,
    files: HashMap<String, Option<(String, Option<String>)>>,
    state: State<'_, AppState>,
) -> Result<Gist, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    let api_files: HashMap<String, Option<UpdateGistFile>> = files
        .into_iter()
        .map(|(name, val)| {
            let v = val.map(|(content, new_name)| UpdateGistFile { content, filename: new_name });
            (name, v)
        })
        .collect();
    let (gist, etag) = github::update_gist(&token, &gist_id, &description, api_files)
        .await
        .map_err(|e| e.to_string())?;
    cache::upsert_gist_from_remote_with_etag(&gist, etag.as_deref())
        .map_err(|e| e.to_string())?;
    cache::get_gist(&gist.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Failed to read gist after update".to_string())
}

// ── Delete ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn delete_gist(
    gist_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let is_local = cache::is_local_only(&gist_id).map_err(|e| e.to_string())?;
    if !is_local {
        let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
        github::delete_gist(&token, &gist_id).await.map_err(|e| e.to_string())?;
    }
    cache::delete_gist_cache(&gist_id).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Tags ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_tags() -> Result<Vec<Tag>, String> {
    cache::list_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tag(name: String, color: String) -> Result<Tag, String> {
    cache::create_tag(&name, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(tag_id: i64) -> Result<(), String> {
    cache::delete_tag(tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_gist_tags(gist_id: String) -> Result<Vec<Tag>, String> {
    cache::get_gist_tags(&gist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_gist_tags(gist_id: String, tag_ids: Vec<i64>) -> Result<(), String> {
    cache::set_gist_tags(&gist_id, &tag_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_gists_by_tag(tag_id: i64) -> Result<Vec<Gist>, String> {
    cache::list_gists_by_tag(tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_gists_by_category(category: String) -> Result<Vec<Gist>, String> {
    cache::list_gists_by_category(&category).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_category_counts() -> Result<Vec<CategoryCount>, String> {
    cache::list_category_counts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tag_counts() -> Result<Vec<cache::TagCount>, String> {
    cache::list_tag_counts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_gist_category(gist_id: String, category: String) -> Result<(), String> {
    cache::set_gist_category(&gist_id, &category).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_pin(gist_id: String) -> Result<bool, String> {
    cache::toggle_pin(&gist_id).map_err(|e| e.to_string())
}

// ── Settings ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_setting(key: String) -> Result<Option<String>, String> {
    db::get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_setting(key: String, value: String) -> Result<(), String> {
    db::set_setting(&key, &value).map_err(|e| e.to_string())
}

// ── Error reporting command ───────────────────────────────────────────────────

/// Forward a frontend error message to Sentry (backend side).
/// Fire-and-forget: always succeeds even if reporting is disabled.
#[tauri::command]
pub fn capture_error(message: String, context: Option<String>) -> Result<(), String> {
    let full = match context {
        Some(ctx) => format!("{message} | {ctx}"),
        None => message,
    };
    gists_client::telemetry::capture_message(&full);
    Ok(())
}

// ── Multi-account ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_accounts() -> Result<Vec<gists_client::models::Account>, String> {
    db::list_accounts().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_account(
    name: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<gists_client::models::Account, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token cannot be empty".into());
    }
    let known_prefix = token.starts_with("ghp_")
        || token.starts_with("ghu_")
        || token.starts_with("gho_")
        || token.starts_with("ghs_")
        || token.starts_with("github_pat_");
    if !known_prefix || token.len() < 20 {
        return Err("Invalid token format".into());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Account name cannot be empty".into());
    }

    let (login, avatar_url) = github::get_user_profile(&token)
        .await
        .map_err(|e| e.to_string())?;

    let id = db::create_account(&name, Some(&login), avatar_url.as_deref())
        .map_err(|e| e.to_string())?;
    let token_key = format!("gists_client_acct_{}", id);

    // Prefer OS keychain; fall back to AES-256-GCM encrypted DB entry.
    if !keyring_set_for_checked(&token_key, &token) {
        if let Ok(enc) = encrypt_for_db(&token) {
            let _ = db::set_setting(&format!("token_acct_{}", id), &enc);
        }
    } else {
        let _ = db::set_setting(&format!("token_acct_{}", id), "");
    }

    // If this is the first account, make it active and load into AppState.
    let accounts = db::list_accounts().map_err(|e| e.to_string())?;
    if accounts.len() == 1 {
        let _ = db::set_active_account(id);
        *state.token.lock().await = Some(token.clone());
        let _ = db::set_setting("gh_login", &login);
    }

    db::list_accounts()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "Account not found after creation".to_string())
}

#[tauri::command]
pub async fn remove_account(id: i64) -> Result<(), String> {
    let accounts = db::list_accounts().map_err(|e| e.to_string())?;
    if accounts.len() <= 1 {
        return Err("Cannot remove the last account".into());
    }
    if let Some(acc) = accounts.iter().find(|a| a.id == id) {
        keyring_delete_for(&acc.token_key);
        let _ = db::set_setting(&format!("token_acct_{}", id), "");
    }
    db::delete_account(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn switch_account(
    id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let accounts = db::list_accounts().map_err(|e| e.to_string())?;
    let acc = accounts
        .iter()
        .find(|a| a.id == id)
        .ok_or("Account not found")?;

    let token = keyring_get_for(&acc.token_key)
        .or_else(|| {
            db::get_setting(&format!("token_acct_{}", id))
                .ok()
                .flatten()
                .filter(|t| !t.is_empty())
                .and_then(|raw| decrypt_from_db(&raw))
        })
        .ok_or("No token found for this account — please re-add it")?;

    *state.token.lock().await = Some(token.clone());
    db::set_active_account(id).map_err(|e| e.to_string())?;

    // Keep the primary keychain entry + legacy `token` setting in sync so the
    // rest of the app (and the next startup) picks up the active account.
    // Mirror set_token's policy: keychain success → clear the DB copy so no
    // token (even encrypted) lingers in SQLite; keychain failure → store an
    // AES-256-GCM encrypted fallback.
    if keyring_set_checked(&token) {
        let _ = db::set_setting("token", "");
    } else if let Ok(enc) = encrypt_for_db(&token) {
        let _ = db::set_setting("token", &enc);
    }
    if let Some(login) = &acc.login {
        let _ = db::set_setting("gh_login", login);
    }
    Ok(())
}

// ── Three-way merge ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn merge_gist_conflict(
    gist_id: String,
    local_files: Vec<(String, String)>,
    remote_files: Vec<(String, String)>,
) -> Result<gists_client::models::MergeOutcome, String> {
    use gists_client::diff::three_way_merge;
    use gists_client::models::{MergedFile, MergeOutcome};
    use std::collections::HashMap;

    let base = gists_client::cache::get_remote_snapshot(&gist_id)
        .map_err(|e| e.to_string())?;

    let local_map: HashMap<String, String> = local_files.into_iter().collect();
    let remote_map: HashMap<String, String> = remote_files.into_iter().collect();

    // Union of all filenames across base, local, remote.
    let mut all_names: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    all_names.extend(base.keys().cloned());
    all_names.extend(local_map.keys().cloned());
    all_names.extend(remote_map.keys().cloned());

    let mut files: Vec<MergedFile> = Vec::new();
    let mut any_conflict = false;

    for name in all_names {
        let b = base.get(&name).map(|s| s.as_str()).unwrap_or("");
        let l = local_map.get(&name).map(|s| s.as_str());
        let r = remote_map.get(&name).map(|s| s.as_str());

        let (content, had_conflict) = match (l, r) {
            (Some(lc), Some(rc)) => {
                let result = three_way_merge(b, lc, rc);
                (result.content, result.had_conflict)
            }
            // File only in local — keep it (new local file).
            (Some(lc), None) if b.is_empty() => (lc.to_string(), false),
            // Remote deleted, local still has it — keep local, flag conflict.
            (Some(lc), None) => (lc.to_string(), true),
            // Only in remote — take it.
            (None, Some(rc)) => (rc.to_string(), false),
            // Only in base (deleted by both?) — omit.
            (None, None) => continue,
        };

        if had_conflict {
            any_conflict = true;
        }
        files.push(MergedFile { filename: name, content, had_conflict });
    }

    Ok(MergeOutcome { files, any_conflict })
}

// ── Diff commands ─────────────────────────────────────────────────────────────

/// Diff the current editor snapshot against the last-synced remote baseline
/// stored in `files_remote_snapshot`.  Returns a unified diff string; empty
/// string means no changes vs the remote.
#[tauri::command]
pub fn compute_gist_diff(
    gist_id: String,
    files: Vec<(String, String)>,
) -> Result<String, String> {
    gists_client::diff::compute_gist_diff(&gist_id, &files).map_err(|e| e.to_string())
}

/// Fetch the commit history for a gist from the GitHub API and return it as
/// a list of `GistRevisionView` rows (metadata only, no diff content).
#[tauri::command]
pub async fn get_gist_revisions(
    gist_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<GistRevisionView>, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    github::fetch_gist_commits(&token, &gist_id)
        .await
        .map_err(|e| e.to_string())
}

/// Fetch a gist at `sha` and its predecessor `prev_sha` (or empty content for
/// the initial commit) then return the unified diff between them.
#[tauri::command]
pub async fn fetch_rev_diff(
    gist_id: String,
    sha: String,
    prev_sha: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;

    // Fetch the revision at `sha`.
    let gist = github::fetch_gist_at_sha(&token, &gist_id, &sha)
        .await
        .map_err(|e| e.to_string())?;

    // Fetch the predecessor (empty map for initial commit / no prev_sha).
    let prev_files: HashMap<String, String> = match prev_sha.as_deref() {
        Some(p) if !p.is_empty() => {
            let prev_gist = github::fetch_gist_at_sha(&token, &gist_id, p)
                .await
                .map_err(|e| e.to_string())?;
            prev_gist
                .files
                .into_iter()
                .map(|f| (f.filename, f.content))
                .collect()
        }
        _ => HashMap::new(),
    };

    let mut parts: Vec<String> = Vec::new();

    // Modified + new files (present in this revision).
    let mut cur_files = gist.files;
    cur_files.sort_unstable_by(|a, b| a.filename.cmp(&b.filename));
    for f in &cur_files {
        let prev_content = prev_files.get(&f.filename).map(|s| s.as_str()).unwrap_or("");
        let chunk = gists_client::diff::unified_diff(prev_content, &f.content, &f.filename);
        if !chunk.is_empty() {
            parts.push(chunk);
        }
    }

    // Deleted files (in prev but absent in this revision).
    let cur_names: std::collections::HashSet<&str> =
        cur_files.iter().map(|f| f.filename.as_str()).collect();
    let mut deleted: Vec<(&String, &String)> = prev_files
        .iter()
        .filter(|(n, _)| !cur_names.contains(n.as_str()))
        .collect();
    deleted.sort_unstable_by_key(|(n, _)| n.as_str());
    for (filename, content) in deleted {
        let chunk = gists_client::diff::unified_diff(content, "", filename);
        if !chunk.is_empty() {
            parts.push(chunk);
        }
    }

    Ok(parts.join("\n"))
}

/// Fetch the full gist snapshot at a specific revision SHA from GitHub.
/// Returns the complete Gist (including file contents at that commit) so the
/// frontend can restore the editor to that state.
#[tauri::command]
pub async fn fetch_gist_at_rev(
    gist_id: String,
    sha: String,
    state: State<'_, AppState>,
) -> Result<Gist, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    github::fetch_gist_at_sha(&token, &gist_id, &sha)
        .await
        .map_err(|e| e.to_string())
}

// ── Export / Import ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportFileEntry {
    filename: String,
    language: Option<String>,
    content: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportGistEntry {
    id: String,
    description: String,
    public: bool,
    created_at: String,
    updated_at: String,
    pinned: bool,
    category: String,
    tags: Vec<String>,
    files: Vec<ExportFileEntry>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportBundle {
    version: u32,
    exported_at: String,
    account: Option<String>,
    gists: Vec<ExportGistEntry>,
}

/// Export all cached gists (with tags, pins, categories) to a single JSON file.
/// Returns the number of gists exported.
#[tauri::command]
pub fn export_gists(dest_path: String) -> Result<usize, String> {
    let gists = cache::list_gists().map_err(|e| e.to_string())?;
    let all_tags = cache::list_tags().map_err(|e| e.to_string())?;

    let mut entries: Vec<ExportGistEntry> = Vec::new();
    for g in &gists {
        let gist_tags = cache::get_gist_tags(&g.id).unwrap_or_default();
        let tag_names: Vec<String> = gist_tags.iter().map(|t| t.name.clone()).collect();
        entries.push(ExportGistEntry {
            id: g.id.clone(),
            description: g.description.clone(),
            public: g.public,
            created_at: g.created_at.clone(),
            updated_at: g.updated_at.clone(),
            pinned: g.pinned,
            category: g.category.clone(),
            tags: tag_names,
            files: g.files.iter().map(|f| ExportFileEntry {
                filename: f.filename.clone(),
                language: f.language.clone(),
                content: f.content.clone(),
            }).collect(),
        });
    }

    let _ = all_tags;
    let login = db::get_setting("github_login").ok().flatten();
    let bundle = ExportBundle {
        version: 1,
        exported_at: Utc::now().to_rfc3339(),
        account: login,
        gists: entries,
    };

    let json = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    std::fs::write(&dest_path, json).map_err(|e| e.to_string())?;
    Ok(gists.len())
}

/// Preview what an import would do: for each gist in the backup file, report
/// whether it already exists locally or would be created new.
#[derive(serde::Serialize)]
pub struct ImportPreviewItem {
    id: String,
    description: String,
    file_count: usize,
    primary_filename: String,
    public: bool,
    pinned: bool,
    tags: Vec<String>,
    /// "new" — will create via GitHub API; "exists" — already in local cache
    status: String,
}

#[tauri::command]
pub fn import_preview(file_path: String) -> Result<Vec<ImportPreviewItem>, String> {
    let data = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let bundle: ExportBundle = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if bundle.version != 1 {
        return Err(format!("Unsupported backup version: {}", bundle.version));
    }

    let mut items = Vec::new();
    for g in &bundle.gists {
        let exists = cache::get_gist(&g.id).ok().flatten().is_some();
        items.push(ImportPreviewItem {
            id: g.id.clone(),
            description: g.description.clone(),
            file_count: g.files.len(),
            primary_filename: g.files.first()
                .map(|f| f.filename.clone())
                .unwrap_or_else(|| "untitled".into()),
            public: g.public,
            pinned: g.pinned,
            tags: g.tags.clone(),
            status: if exists { "exists".into() } else { "new".into() },
        });
    }
    Ok(items)
}

/// Execute the import: create new gists via GitHub API, then restore local
/// metadata (tags, pins, categories) for both new and existing gists.
/// `gist_ids`: the subset of IDs the user chose to import (from the preview).
#[tauri::command]
pub async fn import_execute(
    file_path: String,
    gist_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    let data = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let bundle: ExportBundle = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let id_set: std::collections::HashSet<&str> = gist_ids.iter().map(|s| s.as_str()).collect();
    let selected: Vec<&ExportGistEntry> = bundle.gists.iter()
        .filter(|g| id_set.contains(g.id.as_str()))
        .collect();

    let mut imported = 0usize;
    for entry in &selected {
        let exists = cache::get_gist(&entry.id).ok().flatten().is_some();

        if !exists {
            // Create via GitHub API
            let files: Vec<(String, String)> = entry.files.iter()
                .map(|f| (f.filename.clone(), f.content.clone()))
                .collect();
            let result = github::create_gist(&token, &entry.description, entry.public, files).await;
            match result {
                Ok((gist, etag)) => {
                    let _ = cache::upsert_gist_from_remote_with_etag(&gist, etag.as_deref());
                }
                Err(e) => {
                    eprintln!("[import] failed to create gist '{}': {e:#}", entry.description);
                    continue;
                }
            }
        }

        // Restore local metadata: pinned state + category
        // (For newly created gists, the ID differs from the backup, so we
        //  find the gist by looking at what was just upserted. For existing
        //  gists we apply metadata directly.)
        let target_id = if exists {
            entry.id.clone()
        } else {
            // The just-created gist has a different ID. Find it by matching
            // the primary filename + description from the most recent gists.
            let gists = cache::list_gists().unwrap_or_default();
            gists.iter()
                .find(|g| {
                    g.description == entry.description
                        && g.files.first().map(|f| f.filename.as_str()) == entry.files.first().map(|f| f.filename.as_str())
                })
                .map(|g| g.id.clone())
                .unwrap_or_default()
        };

        if target_id.is_empty() { continue; }

        // Restore pinned
        if entry.pinned {
            let currently_pinned = cache::get_gist(&target_id)
                .ok().flatten()
                .map(|g| g.pinned)
                .unwrap_or(false);
            if !currently_pinned {
                let _ = cache::toggle_pin(&target_id);
            }
        }

        // Restore category
        let _ = cache::set_gist_category(&target_id, &entry.category);

        // Restore tags: ensure each tag exists, then assign
        let mut tag_ids: Vec<i64> = Vec::new();
        for tag_name in &entry.tags {
            let existing_tags = cache::list_tags().unwrap_or_default();
            let tag = existing_tags.iter().find(|t| t.name == *tag_name);
            let tag_id = if let Some(t) = tag {
                t.id as i64
            } else {
                // Create tag with a default color
                match cache::create_tag(tag_name, "#8b949e") {
                    Ok(t) => t.id as i64,
                    Err(_) => continue,
                }
            };
            tag_ids.push(tag_id);
        }
        if !tag_ids.is_empty() {
            let _ = cache::set_gist_tags(&target_id, &tag_ids);
        }

        imported += 1;
    }

    Ok(imported)
}

// ── AI integration ────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct AiConfig {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub embedding_model: String,
    /// Separate base URL for embedding API; empty string means "same as base_url".
    pub embedding_base_url: String,
}

#[tauri::command]
pub fn get_ai_config() -> Result<AiConfig, String> {
    Ok(AiConfig {
        base_url: db::get_setting("ai_base_url")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| AI_DEFAULT_BASE_URL.to_string()),
        model: db::get_setting("ai_model")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| AI_DEFAULT_MODEL.to_string()),
        has_key: db::get_setting("ai_api_key")
            .ok()
            .flatten()
            .map(|k| !k.is_empty())
            .unwrap_or(false),
        embedding_model: db::get_setting("ai_embedding_model")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| AI_DEFAULT_EMBEDDING_MODEL.to_string()),
        embedding_base_url: db::get_setting("ai_embedding_base_url")
            .ok()
            .flatten()
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub fn save_ai_config(
    base_url: String,
    api_key: String,
    model: String,
    embedding_model: String,
    embedding_base_url: String,
) -> Result<(), String> {
    db::set_setting("ai_base_url", &base_url).map_err(|e: anyhow::Error| e.to_string())?;
    db::set_setting("ai_model", &model).map_err(|e: anyhow::Error| e.to_string())?;
    db::set_setting("ai_embedding_model", &embedding_model)
        .map_err(|e: anyhow::Error| e.to_string())?;
    db::set_setting("ai_embedding_base_url", &embedding_base_url)
        .map_err(|e: anyhow::Error| e.to_string())?;
    if !api_key.is_empty() {
        db::set_setting("ai_api_key", &api_key).map_err(|e: anyhow::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_chat(
    window: tauri::Window,
    stream_id: String,
    messages: Vec<AiMessage>,
) -> Result<(), String> {
    let base_url = db::get_setting("ai_base_url")
        .ok()
        .flatten()
        .unwrap_or_else(|| AI_DEFAULT_BASE_URL.to_string());
    let api_key = db::get_setting("ai_api_key")
        .ok()
        .flatten()
        .unwrap_or_default();
    let model = db::get_setting("ai_model")
        .ok()
        .flatten()
        .unwrap_or_else(|| AI_DEFAULT_MODEL.to_string());

    if api_key.is_empty() {
        return Err(
            "AI API key not configured. Open Settings → AI tab to add your key.".to_string(),
        );
    }

    crate::ai::stream_chat(&window, &stream_id, &base_url, &api_key, &model, &messages)
        .await
        .map_err(|e| e.to_string())
}

// ── Semantic search / embedding indexer ──────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct EmbeddingProgress {
    pub indexed: usize,
    pub total: usize,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Current embedding index status (indexed / total, not running).
#[tauri::command]
pub fn get_embedding_status() -> Result<EmbeddingProgress, String> {
    let model = resolve_embed_provider().model_id();
    let (indexed, total) = cache::embedding_counts(&model).map_err(|e| e.to_string())?;
    Ok(EmbeddingProgress { indexed, total, running: false, error: None })
}

/// Returns the effective base URL for embedding calls.
/// Uses `ai_embedding_base_url` if set, otherwise falls back to `ai_base_url`.
/// Strips any trailing "/embeddings" suffix so callers can safely append it.
fn effective_embedding_base_url() -> String {
    let raw = {
        let explicit = db::get_setting("ai_embedding_base_url")
            .ok()
            .flatten()
            .unwrap_or_default();
        if !explicit.trim().is_empty() {
            explicit
        } else {
            db::get_setting("ai_base_url")
                .ok()
                .flatten()
                .unwrap_or_else(|| AI_DEFAULT_BASE_URL.to_string())
        }
    };
    // Guard against users who stored the full endpoint path (e.g. ".../v1/embeddings")
    let trimmed = raw.trim_end_matches('/');
    if trimmed.ends_with("/embeddings") {
        trimmed[..trimmed.len() - "/embeddings".len()].to_string()
    } else {
        trimmed.to_string()
    }
}

// ── Embedding provider abstraction ───────────────────────────────────────────
//
// Two backends produce embeddings: the remote OpenAI-compatible API (default)
// and the optional, offline local ONNX model. Both the query path and the
// indexer path go through this abstraction so the *same* model-id partition
// key is used consistently for storage and retrieval.

enum EmbedProvider {
    Remote { base_url: String, api_key: String, model: String },
    Local { dir: String },
}

impl EmbedProvider {
    /// The string stored in `gist_embeddings.model`. Partitions the vector
    /// space so cosine similarity never compares across incompatible models.
    fn model_id(&self) -> String {
        match self {
            EmbedProvider::Remote { model, .. } => model.clone(),
            EmbedProvider::Local { .. } => {
                gists_client::local_embedding::LOCAL_MODEL_ID.to_string()
            }
        }
    }
}

/// Default on-disk location for the local model when the user hasn't set one:
/// `<app-data>/models`.
fn default_local_embedding_dir() -> String {
    gists_client::auth::app_data_dir()
        .map(|d| d.join("models").to_string_lossy().into_owned())
        .unwrap_or_else(|| "models".to_string())
}

/// Resolve the configured directory for local model storage.
fn local_embedding_dir() -> String {
    db::get_setting("local_embedding_dir")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(default_local_embedding_dir)
}

/// Read the active embedding provider from settings. Defaults to remote so the
/// behaviour is unchanged for users who never opt into local embeddings.
fn resolve_embed_provider() -> EmbedProvider {
    let provider = db::get_setting("embedding_provider")
        .ok()
        .flatten()
        .unwrap_or_default();
    if provider == "local" {
        EmbedProvider::Local { dir: local_embedding_dir() }
    } else {
        let model = db::get_setting("ai_embedding_model")
            .ok()
            .flatten()
            .unwrap_or_else(|| AI_DEFAULT_EMBEDDING_MODEL.to_string());
        EmbedProvider::Remote {
            base_url: effective_embedding_base_url(),
            api_key: db::get_setting("ai_api_key").ok().flatten().unwrap_or_default(),
            model,
        }
    }
}

/// Generate an embedding for `text` using the active provider. The local
/// backend runs ONNX inference on a blocking thread so the async runtime is
/// never stalled; the remote backend awaits an HTTP request.
async fn embed_with(provider: &EmbedProvider, text: &str) -> Result<Vec<f32>, String> {
    match provider {
        EmbedProvider::Remote { base_url, api_key, model } => {
            if api_key.is_empty() {
                return Err("AI API key not configured. Open Settings → AI tab.".into());
            }
            gists_client::embedding::generate_embedding(text, base_url, api_key, model)
                .await
                .map_err(|e| e.to_string())
        }
        EmbedProvider::Local { dir } => {
            let dir = dir.clone();
            let text = text.to_string();
            tokio::task::spawn_blocking(move || {
                gists_client::local_embedding::embed_local(&text, &dir)
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())
        }
    }
}

/// Generate a query embedding then return top-N results by cosine similarity.
#[tauri::command]
pub async fn semantic_search(
    query: String,
    limit: usize,
) -> Result<Vec<cache::SemanticResult>, String> {
    let provider = resolve_embed_provider();
    let model_id = provider.model_id();
    let embedding = embed_with(&provider, &query).await?;
    cache::semantic_search_by_embedding(&embedding, &model_id, limit)
        .map_err(|e| e.to_string())
}

/// One-shot AI completion (non-streaming) — used by the library organizer to
/// generate descriptions/tags in batch.
#[tauri::command]
pub async fn ai_complete(messages: Vec<AiMessage>) -> Result<String, String> {
    let base_url = db::get_setting("ai_base_url")
        .ok()
        .flatten()
        .unwrap_or_else(|| AI_DEFAULT_BASE_URL.to_string());
    let api_key = db::get_setting("ai_api_key")
        .ok()
        .flatten()
        .unwrap_or_default();
    let model = db::get_setting("ai_model")
        .ok()
        .flatten()
        .unwrap_or_else(|| AI_DEFAULT_MODEL.to_string());

    if api_key.is_empty() {
        return Err("AI API key not configured. Open Settings → AI tab.".to_string());
    }

    crate::ai::complete(&base_url, &api_key, &model, &messages)
        .await
        .map_err(|e| e.to_string())
}

/// Find near-duplicate gists using the stored embeddings (cosine ≥ threshold).
#[tauri::command]
pub fn find_duplicate_gists(threshold: f32) -> Result<Vec<cache::SimilarPair>, String> {
    let model = resolve_embed_provider().model_id();
    cache::find_similar_pairs(&model, threshold, 100).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct LocalEmbeddingStatus {
    /// Resolved directory where the model is/will be stored.
    pub dir: String,
    /// Whether the model files already exist on disk.
    pub downloaded: bool,
    /// Whether the model is loaded into memory this session.
    pub loaded: bool,
}

/// Report whether the local embedding model is downloaded/loaded, plus the
/// directory it lives in. Used by Settings to decide whether to offer a
/// "download model" action before local semantic search can be used.
#[tauri::command]
pub fn local_embedding_status() -> Result<LocalEmbeddingStatus, String> {
    let dir = local_embedding_dir();
    Ok(LocalEmbeddingStatus {
        downloaded: gists_client::local_embedding::is_downloaded(&dir),
        loaded: gists_client::local_embedding::is_loaded(),
        dir,
    })
}

/// Download (if needed) and initialise the local embedding model. Runs the
/// blocking download/load on a worker thread. Returns once the model is ready
/// or with an error string if the download/initialisation failed.
#[tauri::command]
pub async fn download_local_embedding_model() -> Result<(), String> {
    let dir = local_embedding_dir();
    tokio::task::spawn_blocking(move || {
        gists_client::local_embedding::ensure_ready(&dir)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Spawn a background task that generates and stores embeddings for all
/// stale gists. Emits `embedding-progress` events to the window.
/// No-op if AI key is not configured.
#[tauri::command]
pub async fn start_embedding_indexer(window: tauri::Window) -> Result<(), String> {
    let provider = resolve_embed_provider();
    // The remote backend needs an API key; the local backend does not.
    if let EmbedProvider::Remote { api_key, .. } = &provider {
        if api_key.is_empty() {
            return Ok(());
        }
    }

    tauri::async_runtime::spawn(async move {
        run_indexer(window, provider).await;
    });
    Ok(())
}

async fn run_indexer(window: tauri::Window, provider: EmbedProvider) {
    let model = provider.model_id();
    let stale = match cache::get_stale_gist_ids(&model) {
        Ok(v) => v,
        Err(_) => return,
    };
    let total_stale = stale.len();
    if total_stale == 0 {
        return;
    }

    let _ = window.emit(
        "embedding-progress",
        EmbeddingProgress { indexed: 0, total: total_stale, running: true, error: None },
    );

    let mut done = 0usize;
    let mut stop_error: Option<String> = None;
    for (gist_id, version_key) in stale {
        let text = match cache::build_embed_text_for_gist(&gist_id) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if text.trim().is_empty() {
            continue;
        }
        match embed_with(&provider, &text).await {
            Ok(emb) => {
                let _ = cache::store_embedding(&gist_id, &version_key, &model, &emb);
                done += 1;
            }
            Err(e) => {
                let msg = e.to_string();
                eprintln!("[embedding indexer] stopped: {msg}");
                stop_error = Some(msg);
                break;
            }
        }
        let _ = window.emit(
            "embedding-progress",
            EmbeddingProgress { indexed: done, total: total_stale, running: true, error: None },
        );
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    }

    let (indexed, total) = cache::embedding_counts(&model).unwrap_or((done, done));
    let _ = window.emit(
        "embedding-progress",
        EmbeddingProgress { indexed, total, running: false, error: stop_error },
    );
}

// ── Local draft / offline-first ──────────────────────────────────────────────

#[tauri::command]
pub fn create_local_gist(
    description: String,
    public: bool,
    files: Vec<(String, String)>,
) -> Result<Gist, String> {
    cache::create_local_draft(&description, public, &files).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn publish_local_gist(
    local_id: String,
    state: State<'_, AppState>,
) -> Result<Gist, String> {
    let gist = cache::get_gist(&local_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Local gist not found".to_string())?;

    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    let files: Vec<(String, String)> = gist
        .files
        .iter()
        .map(|f| (f.filename.clone(), f.content.clone()))
        .collect();

    let (new_gist, _etag) = github::create_gist(&token, &gist.description, gist.public, files)
        .await
        .map_err(|e| e.to_string())?;

    cache::promote_local_to_remote(&local_id, &new_gist).map_err(|e| e.to_string())?;

    cache::get_gist(&new_gist.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Gist not found after publish".to_string())
}

// ── Templates ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_templates() -> Result<Vec<templates::Template>, String> {
    templates::list_templates().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_template(
    name: String,
    description: String,
    is_public: bool,
    files: Vec<(String, String)>,
) -> Result<templates::Template, String> {
    templates::create_template(&name, &description, is_public, &files)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_template(
    id: i32,
    name: String,
    description: String,
    is_public: bool,
    files: Vec<(String, String)>,
) -> Result<templates::Template, String> {
    templates::update_template(id, &name, &description, is_public, &files)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_template(id: i32) -> Result<(), String> {
    templates::delete_template(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_gist_as_template(gist_id: String, name: String) -> Result<templates::Template, String> {
    templates::save_gist_as_template(&gist_id, &name).map_err(|e| e.to_string())
}

// ── VS Code snippets import ───────────────────────────────────────────────────

#[tauri::command]
pub fn vscode_snippets_default_path() -> Option<String> {
    vscode_snippets::default_snippets_dir()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn vscode_snippets_preview(
    path: Option<String>,
) -> Result<Vec<vscode_snippets::VscodeSnippet>, String> {
    vscode_snippets::preview(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vscode_snippets_import(
    items: Vec<vscode_snippets::VscodeSnippet>,
) -> Result<i32, String> {
    let mut imported = 0;
    for s in items {
        let files = vec![(s.filename.clone(), s.body.clone())];
        templates::create_template(&s.name, &s.description, false, &files)
            .map_err(|e| e.to_string())?;
        imported += 1;
    }
    Ok(imported)
}

// ── Code runner ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn run_code(
    run_id: String,
    gist_id: String,
    filename: String,
    content: String,
    window: tauri::Window,
) -> Result<(), String> {
    // Spawn as a background task so the command returns immediately
    // and the frontend receives output via events.
    tokio::spawn(async move {
        let done = match gists_client::runner::run_code(
            window.clone(), run_id.clone(), filename.clone(), content,
        ).await {
            Ok(d) => d,
            Err(e) => {
                let _ = window.emit(
                    &format!("run-line-{}", run_id),
                    gists_client::runner::RunLine { text: e.to_string(), stream: "stderr".into() },
                );
                gists_client::runner::RunDone {
                    exit_code: -1, timed_out: false, killed: false,
                    stdout: String::new(), stderr: e.to_string(), duration_ms: 0,
                    truncated: false,
                }
            }
        };

        // Persist run to DB (best-effort: skip for local-only / unknown gists).
        if !gist_id.is_empty() {
            let _ = gists_client::db::insert_run(
                &gist_id, &filename,
                done.exit_code, &done.stdout, &done.stderr,
                done.duration_ms, done.timed_out, done.killed, done.truncated,
            );
            let _ = gists_client::db::delete_old_runs(&gist_id, &filename, 50);
        }

        // Emit run-done after DB write so the frontend can immediately fetch history.
        let _ = window.emit(&format!("run-done-{}", run_id), &done);
    });
    Ok(())
}

#[tauri::command]
pub fn list_run_history(
    gist_id: String,
    filename: String,
) -> Result<Vec<gists_client::models::RunRecord>, String> {
    gists_client::db::list_run_history(&gist_id, &filename, 20)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn diff_runs(id_a: i64, id_b: i64) -> Result<String, String> {
    let a = gists_client::db::get_run(id_a).map_err(|e| e.to_string())?;
    let b = gists_client::db::get_run(id_b).map_err(|e| e.to_string())?;
    // b is older run, a is newer — diff(older→newer) so additions show as green.
    let diff = gists_client::diff::unified_diff(&b.stdout, &a.stdout, &a.filename);
    Ok(diff)
}

#[tauri::command]
pub fn kill_run(run_id: String) -> Result<(), String> {
    gists_client::runner::kill_run(&run_id);
    Ok(())
}

// ── Relation graph ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_gist_tag_pairs() -> Result<Vec<(String, i32)>, String> {
    cache::list_gist_tag_pairs().map_err(|e| e.to_string())
}

// ── Collections ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_collections() -> Result<Vec<Collection>, String> {
    cache::list_collections().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collection_counts() -> Result<Vec<CollectionCount>, String> {
    cache::list_collection_counts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(
    name: String,
    description: String,
    color: String,
    icon: String,
) -> Result<Collection, String> {
    cache::create_collection(&name, &description, &color, &icon)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_collection(
    id: String,
    name: String,
    description: String,
    color: String,
    icon: String,
) -> Result<Collection, String> {
    cache::update_collection(&id, &name, &description, &color, &icon)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_collection(id: String) -> Result<(), String> {
    cache::delete_collection(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_gist_to_collection(collection_id: String, gist_id: String) -> Result<(), String> {
    cache::add_gist_to_collection(&collection_id, &gist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_gist_from_collection(collection_id: String, gist_id: String) -> Result<(), String> {
    cache::remove_gist_from_collection(&collection_id, &gist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collection_gists(collection_id: String) -> Result<Vec<Gist>, String> {
    cache::list_collection_gists(&collection_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_gist_collections(gist_id: String) -> Result<Vec<Collection>, String> {
    cache::get_gist_collections(&gist_id).map_err(|e| e.to_string())
}

// ── Wiki-links ────────────────────────────────────────────────────────────────

/// Return gists that contain [[link_text]] matching this gist's description or filenames.
#[tauri::command]
pub fn get_backlinks(gist_id: String) -> Result<Vec<Gist>, String> {
    cache::get_backlinks(&gist_id).map_err(|e| e.to_string())
}

/// Resolve a [[link_text]] to the gist it refers to (by description or filename).
#[tauri::command]
pub fn resolve_wiki_link(link_text: String) -> Result<Option<Gist>, String> {
    cache::resolve_wiki_link(&link_text).map_err(|e| e.to_string())
}
