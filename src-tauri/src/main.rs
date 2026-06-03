// Prevents an additional console window on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod commands;

use gists_client::db;
use commands::AppState;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::sync::Mutex;

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            token: Mutex::new(None),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            std::fs::create_dir_all(&app_dir)?;
            let dir_str = app_dir.to_string_lossy().to_string();

            db::init_db(&dir_str).map_err(|e| format!("Failed to initialize database: {e}"))?;

            let sentry_enabled = db::get_setting("error_reporting_enabled")
                .ok()
                .flatten()
                .map(|v| v == "true")
                .unwrap_or(false);
            gists_client::telemetry::init(sentry_enabled);

            // Migrate legacy single token → accounts table (one-time, idempotent).
            if let Ok(accounts) = gists_client::db::list_accounts() {
                if accounts.is_empty() {
                    let legacy_token = gists_client::auth::keyring_get()
                        .or_else(|| {
                            gists_client::db::get_setting("token")
                                .ok()
                                .flatten()
                                .filter(|t| !t.is_empty())
                                .and_then(|raw| gists_client::auth::decrypt_from_db(&raw))
                        });
                    if let Some(token) = legacy_token {
                        let login = gists_client::db::get_setting("gh_login")
                            .ok()
                            .flatten()
                            .filter(|v| !v.is_empty());
                        if let Ok(id) = gists_client::db::create_account(
                            "Personal",
                            login.as_deref(),
                            None,
                        ) {
                            let key = format!("gists_client_acct_{}", id);
                            // Prefer keychain; write encrypted DB entry as fallback.
                            if !gists_client::auth::keyring_set_for_checked(&key, &token) {
                                if let Ok(enc) = gists_client::auth::encrypt_for_db(&token) {
                                    let _ = gists_client::db::set_setting(
                                        &format!("token_acct_{}", id),
                                        &enc,
                                    );
                                }
                            } else {
                                let _ = gists_client::db::set_setting(
                                    &format!("token_acct_{}", id),
                                    "",
                                );
                            }
                            let _ = gists_client::db::set_active_account(id);
                        }
                    }
                }
            }

            let saved_token = commands::keyring_get().or_else(|| {
                db::get_setting("token")
                    .ok()
                    .flatten()
                    .filter(|t| !t.is_empty())
                    .and_then(|raw| gists_client::auth::decrypt_from_db(&raw))
            });
            if let Some(token) = saved_token {
                let state = app.state::<AppState>();
                tauri::async_runtime::block_on(async {
                    *state.token.lock().await = Some(token);
                });
            }

            // System tray menu
            let show_item = MenuItem::with_id(app, "show", "Show Gists Client", true, None::<&str>)?;
            let search_item = MenuItem::with_id(app, "search", "Quick Search  (Alt+Space)", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &search_item, &sep, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "search" => {
                        if let Some(w) = app.get_webview_window("quick-search") {
                            let _ = w.center();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => std::process::exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Build the quick-search floating window.
            #[cfg(debug_assertions)]
            let search_url = WebviewUrl::External(
                "http://localhost:1420/?window=quick-search"
                    .parse()
                    .unwrap(),
            );
            #[cfg(not(debug_assertions))]
            let search_url = WebviewUrl::App("index.html?window=quick-search".into());

            WebviewWindowBuilder::new(app, "quick-search", search_url)
                .title("Quick Search")
                .inner_size(620.0, 520.0)
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .visible(false)
                .skip_taskbar(true)
                .center()
                .build()?;

            // Alt+Space — toggle quick-search window.
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut("Alt+Space", move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(w) = handle.get_webview_window("quick-search") {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.hide();
                        } else {
                            let _ = w.center();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
            })?;

            // Alt+Shift+Space — open directly in Capture mode.
            let handle2 = app.handle().clone();
            app.global_shortcut()
                .on_shortcut("Alt+Shift+Space", move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(w) = handle2.get_webview_window("quick-search") {
                            let _ = w.center();
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("switch-to-capture", ());
                        }
                    }
                })
                .ok();

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
            commands::list_tag_counts,
            commands::set_gist_category,
            commands::toggle_pin,
            commands::compute_gist_diff,
            commands::get_gist_revisions,
            commands::fetch_rev_diff,
            commands::export_gists,
            commands::import_preview,
            commands::import_execute,
            commands::fetch_gist_at_rev,
            commands::get_ai_config,
            commands::save_ai_config,
            commands::ai_chat,
            commands::create_local_gist,
            commands::publish_local_gist,
            commands::list_templates,
            commands::create_template,
            commands::update_template,
            commands::delete_template,
            commands::save_gist_as_template,
            commands::vscode_snippets_default_path,
            commands::vscode_snippets_preview,
            commands::vscode_snippets_import,
            commands::run_code,
            commands::kill_run,
            commands::list_gist_tag_pairs,
            commands::get_embedding_status,
            commands::semantic_search,
            commands::start_embedding_indexer,
            commands::ai_complete,
            commands::find_duplicate_gists,
            commands::local_embedding_status,
            commands::download_local_embedding_model,
            commands::list_collections,
            commands::list_collection_counts,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::add_gist_to_collection,
            commands::remove_gist_from_collection,
            commands::list_collection_gists,
            commands::get_gist_collections,
            commands::get_backlinks,
            commands::resolve_wiki_link,
            commands::capture_error,
            commands::merge_gist_conflict,
            commands::list_accounts,
            commands::add_account,
            commands::remove_account,
            commands::switch_account,
            commands::list_run_history,
            commands::diff_runs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
