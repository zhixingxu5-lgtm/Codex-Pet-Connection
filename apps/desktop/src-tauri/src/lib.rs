mod app_server;
mod commands;
mod credentials;
mod db;
mod hook_listener;
mod model;
mod runtime;
mod sync_client;

use anyhow::Context;
use commands::*;
use runtime::AppState;
use std::sync::Arc;
use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir().context("resolve app data directory")?;
            let db = db::LocalDb::open(&app_data.join("petlink.db"))?;
            let bundled_server_url = option_env!("PETLINK_SERVER_URL")
                .unwrap_or("http://127.0.0.1:8787");
            let server_url = std::env::var("PETLINK_SERVER_URL")
                .unwrap_or_else(|_| bundled_server_url.to_string());
            let state = AppState::new(db, server_url)?;
            app.manage(state.clone());

            create_pet_window(app, &state, "self-pet", "我的企鹅", 80.0, 500.0)?;
            create_pet_window(app, &state, "friend-pet", "好友企鹅", 330.0, 500.0)?;
            create_tray(app)?;

            let secret = uuid::Uuid::new_v4().to_string();
            let secret_path = app_data.join("hook-secret");
            let socket_path = app_data.join("hook.sock");
            std::fs::write(&secret_path, &secret)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&secret_path, std::fs::Permissions::from_mode(0o600))?;
            }
            let app_handle = app.handle().clone();
            let hook_state = state.clone();
            tauri::async_runtime::spawn(async move {
                let _ = hook_listener::run(app_handle, hook_state, secret, socket_path).await;
            });
            let app_handle = app.handle().clone();
            let app_server_state = state.clone();
            tauri::async_runtime::spawn(async move {
                let _ = app_server::run(app_handle, app_server_state).await;
            });
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(sync_client::run(app_handle, state));
            let app_handle = app.handle().clone();
            let maintenance_state = app.state::<Arc<AppState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
                loop {
                    tick.tick().await;
                    maintenance_state.tick(&app_handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Moved(position) = event {
                if let Some(state) = window.app_handle().try_state::<Arc<AppState>>() {
                    let _ = state.db.lock().expect("db lock").save_window_position(window.label(), position.x, position.y);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            update_settings,
            simulate_state,
            set_pet_windows_visible,
            create_pairing,
            claim_pairing,
            unpair,
            install_codex_plugin,
            uninstall_codex_plugin
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Pet Link");
}

fn create_pet_window(app: &mut tauri::App, state: &Arc<AppState>, label: &str, title: &str, x: f64, y: f64) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(240.0, 280.0)
        .min_inner_size(160.0, 180.0)
        .max_inner_size(480.0, 560.0)
        .position(x, y)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .build()?;
    if let Ok(Some((saved_x, saved_y))) = state.db.lock().expect("db lock").window_position(label) {
        let (corrected_x, corrected_y) = corrected_position(&window, saved_x, saved_y);
        let _ = window.set_position(PhysicalPosition::new(corrected_x, corrected_y));
    }
    Ok(())
}

fn corrected_position(window: &tauri::WebviewWindow, x: i32, y: i32) -> (i32, i32) {
    let Ok(monitors) = window.available_monitors() else {
        return (x, y);
    };
    if monitors.is_empty() {
        return (x, y);
    }
    let selected = monitors
        .iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            x >= position.x
                && y >= position.y
                && x < position.x + size.width as i32
                && y < position.y + size.height as i32
        })
        .unwrap_or(&monitors[0]);
    let position = selected.position();
    let size = selected.size();
    let window_size = window.outer_size().ok();
    let width = window_size.as_ref().map_or(240, |value| value.width as i32);
    let height = window_size.as_ref().map_or(280, |value| value.height as i32);
    let max_x = position.x + size.width as i32 - width.min(size.width as i32);
    let max_y = position.y + size.height as i32 - height.min(size.height as i32);
    (x.clamp(position.x, max_x), y.clamp(position.y, max_y))
}

fn create_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示设置", true, None::<&str>)?;
    let show_pets = MenuItem::with_id(app, "show-pets", "显示桌宠", true, None::<&str>)?;
    let hide_pets = MenuItem::with_id(app, "hide-pets", "隐藏桌宠", true, None::<&str>)?;
    let pair = MenuItem::with_id(app, "pair", "配对好友…", true, None::<&str>)?;
    let unpair = MenuItem::with_id(app, "unpair", "解除配对", true, None::<&str>)?;
    let share_energy = MenuItem::with_id(app, "share-energy", "切换精力共享", true, None::<&str>)?;
    let privacy = MenuItem::with_id(app, "privacy", "切换隐私暂停", true, None::<&str>)?;
    let reduce_motion = MenuItem::with_id(app, "reduce-motion", "切换减少动态", true, None::<&str>)?;
    let diagnostics = MenuItem::with_id(app, "diagnostics", "Codex 接入诊断…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &show_pets, &hide_pets, &pair, &unpair, &share_energy, &privacy, &reduce_motion, &diagnostics, &quit])?;
    let mut builder = TrayIconBuilder::new().tooltip("Codex Pet Link").menu(&menu);
    if let Some(icon) = app.default_window_icon() { builder = builder.icon(icon.clone()); }
    builder.on_menu_event(|app, event| match event.id.as_ref() {
        "show" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } }
        "show-pets" => for label in ["self-pet", "friend-pet"] { if let Some(window) = app.get_webview_window(label) { let _ = window.show(); } },
        "hide-pets" => for label in ["self-pet", "friend-pet"] { if let Some(window) = app.get_webview_window(label) { let _ = window.hide(); } },
        "pair" | "diagnostics" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } },
        "unpair" => {
            let app_handle = app.clone();
            let state = app.state::<Arc<AppState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = commands::unpair_device(&state).await;
                state.emit(&app_handle);
            });
        }
        "share-energy" | "privacy" | "reduce-motion" => {
            let state = app.state::<Arc<AppState>>().inner().clone();
            let patch = {
                let data = state.runtime.lock().expect("runtime lock");
                match event.id.as_ref() {
                    "share-energy" => model::SettingsPatch { share_energy: Some(!data.share_energy), ..Default::default() },
                    "privacy" => model::SettingsPatch { privacy_paused: Some(!data.privacy_paused), ..Default::default() },
                    _ => model::SettingsPatch { reduce_motion: Some(!data.reduce_motion), ..Default::default() },
                }
            };
            state.update_settings(app, patch);
        }
        "quit" => app.exit(0),
        _ => {}
    }).build(app)?;
    Ok(())
}
