use crate::{credentials::ensure_device, model::{DesktopSnapshot, EventSource, SettingsPatch, TaskState}, runtime::AppState};
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::{path::PathBuf, process::Command, sync::Arc};
use tauri::{AppHandle, Manager, State};

type CommandResult<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingResponse {
    code: String,
    expires_at: DateTime<Utc>,
}

#[tauri::command]
pub fn get_snapshot(state: State<'_, Arc<AppState>>) -> DesktopSnapshot {
    state.snapshot()
}

#[tauri::command]
pub fn update_settings(app: AppHandle, state: State<'_, Arc<AppState>>, settings: SettingsPatch) -> DesktopSnapshot {
    state.update_settings(&app, settings);
    state.snapshot()
}

#[tauri::command]
pub fn simulate_state(app: AppHandle, state: State<'_, Arc<AppState>>, task_state: TaskState) -> DesktopSnapshot {
    state.apply_session(&app, "manual-preview".into(), task_state, EventSource::Manual);
    state.snapshot()
}

#[tauri::command]
pub fn set_pet_windows_visible(app: AppHandle, visible: bool) {
    for label in ["self-pet", "friend-pet"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = if visible { window.show() } else { window.hide() };
        }
    }
}

#[tauri::command]
pub async fn create_pairing(state: State<'_, Arc<AppState>>) -> CommandResult<DesktopSnapshot> {
    async fn execute(state: &Arc<AppState>) -> Result<DesktopSnapshot> {
        let credentials = ensure_device(state).await?;
        let response = reqwest::Client::new()
            .post(format!("{}/v1/pairings", state.server_url))
            .bearer_auth(credentials.token)
            .send()
            .await?;
        if !response.status().is_success() { return Err(anyhow!("生成配对码失败：{}", response.status())); }
        let pairing: PairingResponse = response.json().await?;
        let mut data = state.runtime.lock().expect("runtime lock");
        data.pairing_code = Some(pairing.code);
        data.pairing_expires_at = Some(pairing.expires_at);
        drop(data);
        Ok(state.snapshot())
    }
    execute(&state).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn claim_pairing(state: State<'_, Arc<AppState>>, code: String) -> CommandResult<DesktopSnapshot> {
    async fn execute(state: &Arc<AppState>, code: String) -> Result<DesktopSnapshot> {
        let credentials = ensure_device(state).await?;
        let response = reqwest::Client::new()
            .post(format!("{}/v1/pairings/claim", state.server_url))
            .bearer_auth(credentials.token)
            .json(&serde_json::json!({"code": code.trim().to_uppercase()}))
            .send()
            .await?;
        if !response.status().is_success() { return Err(anyhow!("配对失败：{}", response.status())); }
        state.runtime.lock().expect("runtime lock").paired = true;
        Ok(state.snapshot())
    }
    execute(&state, code).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn unpair(state: State<'_, Arc<AppState>>) -> CommandResult<DesktopSnapshot> {
    unpair_device(&state).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn install_codex_plugin(app: AppHandle) -> CommandResult<String> {
    install_plugin(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn uninstall_codex_plugin() -> CommandResult<String> {
    uninstall_plugin().map_err(|error| error.to_string())
}

pub(crate) async fn unpair_device(state: &Arc<AppState>) -> Result<DesktopSnapshot> {
    let credentials = ensure_device(state).await?;
    let response = reqwest::Client::new()
        .delete(format!("{}/v1/pairing", state.server_url))
        .bearer_auth(credentials.token)
        .send()
        .await?;
    if !response.status().is_success() && response.status().as_u16() != 404 {
        return Err(anyhow!("解除配对失败：{}", response.status()));
    }
    let mut data = state.runtime.lock().expect("runtime lock");
    data.paired = false;
    data.pairing_code = None;
    data.pairing_expires_at = None;
    data.friend.presence = crate::model::Presence::Offline;
    drop(data);
    Ok(state.snapshot())
}

fn install_plugin(app: &AppHandle) -> Result<String> {
    let marketplace = marketplace_dir(app)?;
    let add_marketplace = Command::new("codex")
        .args(["plugin", "marketplace", "add"])
        .arg(&marketplace)
        .arg("--json")
        .output()
        .context("运行 codex plugin marketplace add")?;
    if !add_marketplace.status.success() {
        let stderr = String::from_utf8_lossy(&add_marketplace.stderr);
        if !stderr.to_lowercase().contains("already") {
            return Err(anyhow!("添加插件市场失败：{stderr}"));
        }
    }
    let install = Command::new("codex")
        .args(["plugin", "add", "codex-pet-link@petlink-local", "--json"])
        .output()
        .context("运行 codex plugin add")?;
    if !install.status.success() {
        let stderr = String::from_utf8_lossy(&install.stderr);
        if !stderr.to_lowercase().contains("already") {
            return Err(anyhow!("安装插件失败：{stderr}"));
        }
    }
    Ok("插件已安装。请在 Codex 中输入 /hooks，审阅并信任 Codex Pet Link Hook。".into())
}

fn uninstall_plugin() -> Result<String> {
    let remove = Command::new("codex")
        .args(["plugin", "remove", "codex-pet-link@petlink-local", "--json"])
        .output()
        .context("运行 codex plugin remove")?;
    if !remove.status.success() {
        return Err(anyhow!(
            "卸载插件失败：{}",
            String::from_utf8_lossy(&remove.stderr)
        ));
    }
    Ok("Codex Pet Link 插件已卸载；本地桌宠数据和配对关系未删除。".into())
}

fn marketplace_dir(app: &AppHandle) -> Result<PathBuf> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../integrations/codex-marketplace"));
    }
    Ok(app.path().resource_dir()?.join("codex-marketplace"))
}
