// Prevents an additional console window on Windows in release mode.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod commands;

use gists_client::db;
use commands::AppState;
use tauri::{
    CustomMenuItem, GlobalShortcutManager, Manager, SystemTray, SystemTrayEvent,
    SystemTrayMenu, SystemTrayMenuItem,
};
use tokio::sync::Mutex;

fn main() {
    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "Show Gists Client"))
        .add_item(CustomMenuItem::new("search", "Quick Search  (Alt+Space)"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "Quit"));

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(AppState {
            token: Mutex::new(None),
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                if window.is_visible().unwrap_or(false) {
                    window.hide().unwrap();
                } else {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    let window = app.get_window("main").unwrap();
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
                "search" => {
                    if let Some(w) = app.get_window("quick-search") {
                        w.center().unwrap();
                        w.show().unwrap();
                        w.set_focus().unwrap();
                    }
                }
                "quit" => std::process::exit(0),
                _ => {}
            },
            _ => {}
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                if event.window().label() == "main" {
                    // Hide to tray instead of quitting.
                    api.prevent_close();
                    event.window().hide().unwrap();
                }
            }
        })
        .setup(|app| {
            let app_dir = app
                .path_resolver()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            std::fs::create_dir_all(&app_dir)?;
            let dir_str = app_dir.to_string_lossy().to_string();

            db::init_db(&dir_str).map_err(|e| format!("Failed to initialize database: {e}"))?;

            let saved_token = commands::keyring_get().or_else(|| {
                db::get_setting("token").ok().flatten().filter(|t| !t.is_empty())
            });
            if let Some(token) = saved_token {
                let state = app.state::<AppState>();
                tauri::async_runtime::block_on(async {
                    *state.token.lock().await = Some(token);
                });
            }

            // Build the quick-search floating window.
            // Dev: point at Vite dev server with query param.
            // Prod: load from dist with query param via custom-protocol.
            #[cfg(debug_assertions)]
            let search_url = tauri::WindowUrl::External(
                "http://localhost:1420/?window=quick-search"
                    .parse()
                    .unwrap(),
            );
            #[cfg(not(debug_assertions))]
            let search_url = tauri::WindowUrl::App("index.html?window=quick-search".into());

            tauri::WindowBuilder::new(app, "quick-search", search_url)
                .title("Quick Search")
                .inner_size(620.0, 520.0)
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .visible(false)
                .skip_taskbar(true)
                .center()
                .build()?;

            // Alt+Space — toggle window in Search mode (default).
            let handle = app.handle();
            app.global_shortcut_manager()
                .register("Alt+Space", move || {
                    if let Some(w) = handle.get_window("quick-search") {
                        if w.is_visible().unwrap_or(false) {
                            w.hide().unwrap();
                        } else {
                            w.center().unwrap();
                            w.show().unwrap();
                            w.set_focus().unwrap();
                        }
                    }
                })
                .expect("Failed to register Alt+Space global shortcut");

            // Alt+Shift+Space — open directly in Capture mode.
            let handle2 = app.handle();
            app.global_shortcut_manager()
                .register("Alt+Shift+Space", move || {
                    if let Some(w) = handle2.get_window("quick-search") {
                        w.center().unwrap();
                        w.show().unwrap();
                        w.set_focus().unwrap();
                        let _ = w.emit("switch-to-capture", ());
                    }
                })
                .ok(); // best-effort; some OSes may not support this combo

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
            commands::run_code,
            commands::kill_run,
            commands::list_gist_tag_pairs,
            commands::get_embedding_status,
            commands::semantic_search,
            commands::start_embedding_indexer,
            commands::list_collections,
            commands::list_collection_counts,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::add_gist_to_collection,
            commands::remove_gist_from_collection,
            commands::list_collection_gists,
            commands::get_gist_collections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
