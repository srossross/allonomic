use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

const CLOSE_TAB_MENU_ID: &str = "close-tab";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                ])
                .level(log::LevelFilter::Debug)
                .level_for("tauri_plugin_shell", log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .menu(|app| {
            let pkg_name = app.package_info().name.clone();
            let close_tab =
                MenuItem::with_id(app, CLOSE_TAB_MENU_ID, "Close Tab", true, Some("CmdOrCtrl+W"))?;
            Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        &pkg_name,
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::services(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::hide_others(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::quit(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(app, "File", true, &[&close_tab])?,
                    &Submenu::with_items(
                        app,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(app, None)?,
                            &PredefinedMenuItem::redo(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        app,
                        "Window",
                        true,
                        &[
                            &PredefinedMenuItem::minimize(app, None)?,
                            &PredefinedMenuItem::maximize(app, None)?,
                            &PredefinedMenuItem::fullscreen(app, None)?,
                        ],
                    )?,
                ],
            )
        })
        .on_menu_event(|app, event| {
            if event.id() == CLOSE_TAB_MENU_ID {
                if let Err(error) = app.emit(CLOSE_TAB_MENU_ID, ()) {
                    log::error!("close-tab emit failed: {error}");
                }
            }
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                log::warn!("window {} close requested", window.label())
            }
            tauri::WindowEvent::Destroyed => log::warn!("window {} destroyed", window.label()),
            _ => {}
        })
        .on_page_load(|webview, payload| {
            log::info!(
                "webview {} page load {:?} {}",
                webview.label(),
                payload.event(),
                payload.url()
            );
        })
        .setup(|_| {
            let default_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                log::error!("panic: {info}");
                default_hook(info);
            }));
            log::info!("app setup pid={}", std::process::id());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| match event {
            tauri::RunEvent::ExitRequested { code, .. } => {
                log::warn!("exit requested code={code:?}")
            }
            tauri::RunEvent::Exit => log::warn!("app exit"),
            _ => {}
        });
}
