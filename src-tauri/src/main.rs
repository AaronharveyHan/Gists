// Prevents an additional console window on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use gists_client::db;
use commands::AppState;
use tauri::Manager;
use tokio::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            token: Mutex::new(None),
        })
        .setup(|app| {
            // Resolve the app data directory for this platform
            let app_dir = app
                .path_resolver()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            std::fs::create_dir_all(&app_dir)?;
            let dir_str = app_dir.to_string_lossy().to_string();

            db::init_db(&dir_str).map_err(|e| format!("Failed to initialize database: {e}"))?;

            // Restore token: prefer OS keychain, fall back to DB.
            let saved_token = commands::keyring_get().or_else(|| {
                db::get_setting("token").ok().flatten().filter(|t| !t.is_empty())
            });
            if let Some(token) = saved_token {
                let state = app.state::<AppState>();
                tauri::async_runtime::block_on(async {
                    *state.token.lock().await = Some(token);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_token,
            commands::get_token,
            commands::get_current_login,
            commands::clear_token,
            commands::sync_gists,
            commands::list_gists,
            commands::search_gists,
            commands::get_gist,
            commands::create_gist,
            commands::save_gist_draft,
            commands::fetch_gist_from_github,
            commands::pull_gist_remote,
            commands::update_gist,
            commands::delete_gist,
            commands::get_setting,
            commands::save_setting,
            commands::list_tags,
            commands::create_tag,
            commands::delete_tag,
            commands::get_gist_tags,
            commands::set_gist_tags,
            commands::list_gists_by_tag,
            commands::list_gists_by_category,
            commands::list_category_counts,
            commands::set_gist_category,
            commands::toggle_pin,
            commands::compute_gist_diff,
            commands::get_gist_revisions,
            commands::fetch_rev_diff,
            commands::export_gists,
            commands::import_preview,
            commands::import_execute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
