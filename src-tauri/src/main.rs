#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;
mod server;

use std::{net::TcpListener, path::PathBuf};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let listener = match TcpListener::bind(("127.0.0.1", server::PORT)) {
                Ok(listener) => listener,
                Err(error) => {
                    app.dialog()
                        .message("本機 Companion 無法啟動：連接埠 3838 已被其他程式使用。請關閉佔用該連接埠的程式後重試。")
                        .title("Lyrics Everywhere 無法啟動")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    return Err(Box::new(error));
                }
            };
            listener.set_nonblocking(true)?;

            let resource_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
            let asset_dir = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
            } else {
                resource_dir.join("dist")
            };
            let profile_path = app.path().app_config_dir()?.join("profile.json");
            let state = server::AppState::new(profile_path);
            let app_handle = app.handle().clone();
            let app_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = server::serve(listener, app_state, asset_dir).await {
                    eprintln!("Companion server stopped: {error}");
                    app_handle.exit(1);
                }
            });
            let app_state = state.clone();
            tauri::async_runtime::spawn(async move { runtime::poll(app_state).await; });
            app.manage(state);

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(format!("http://127.0.0.1:{}", server::PORT).parse()?),
            )
            .title("Lyrics Everywhere")
            .inner_size(1080.0, 760.0)
            .min_inner_size(700.0, 560.0)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lyrics Everywhere");
}
