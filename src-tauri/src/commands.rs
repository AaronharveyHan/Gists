/// Tauri commands — the IPC bridge between the frontend and Rust backend.
/// Each command is async and returns a JSON-serializable result.
use std::collections::HashMap;
use tauri::State;
use tokio::sync::Mutex;

use chrono::Utc;

use gists_client::{cache, db, github, models::*};
use gists_client::github::FetchGistOutcome;

// ── Keychain helpers ──────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "com.gists-client.app";
const KEYRING_ACCOUNT: &str = "github_token";

/// Store token in OS keychain. Falls back silently if unavailable (e.g. headless Linux).
fn keyring_set(token: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.set_password(token);
    }
}

/// Read token from OS keychain. Returns None if unavailable or not set.
pub fn keyring_get() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|t| !t.is_empty())
}

/// Remove token from OS keychain.
fn keyring_delete() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.delete_password();
    }
}

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
    // Store in OS keychain (preferred); also persist to DB as fallback.
    keyring_set(&token);
    db::set_setting("token", &token).map_err(|e| e.to_string())?;
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
    let token = state.token.lock().await.clone().ok_or("Not authenticated")?;
    github::delete_gist(&token, &gist_id).await.map_err(|e| e.to_string())?;
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
