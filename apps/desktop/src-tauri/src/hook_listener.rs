use crate::model::{EventSource, TaskState};
use crate::runtime::AppState;
use anyhow::{Context, Result};
use serde::Deserialize;
use std::{path::PathBuf, sync::Arc};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};

#[cfg(windows)]
const WINDOWS_PIPE: &str = r"\\.\pipe\codex-pet-link";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookMessage {
    auth_token: String,
    event: HookEvent,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookEvent {
    session_id: String,
    #[allow(dead_code)]
    turn_id: Option<String>,
    event_name: String,
}

#[cfg(unix)]
pub async fn run(
    app: AppHandle,
    state: Arc<AppState>,
    secret: String,
    socket_path: PathBuf,
) -> Result<()> {
    use tokio::net::UnixListener;

    if socket_path.exists() {
        std::fs::remove_file(&socket_path).context("remove stale pet-link socket")?;
    }
    let listener = UnixListener::bind(&socket_path).context("bind pet-link unix socket")?;
    loop {
        let (stream, _) = listener.accept().await?;
        spawn_handler(stream, app.clone(), state.clone(), secret.clone());
    }
}

#[cfg(windows)]
pub async fn run(
    app: AppHandle,
    state: Arc<AppState>,
    secret: String,
    _socket_path: PathBuf,
) -> Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    loop {
        let server = ServerOptions::new()
            .create(WINDOWS_PIPE)
            .context("create pet-link named pipe")?;
        server.connect().await.context("accept pet-link named pipe")?;
        spawn_handler(server, app.clone(), state.clone(), secret.clone());
    }
}

fn spawn_handler<S>(stream: S, app: AppHandle, state: Arc<AppState>, secret: String)
where
    S: tokio::io::AsyncRead + AsyncWrite + Send + Unpin + 'static,
{
    tokio::spawn(async move {
        let (reader, mut writer) = tokio::io::split(stream);
        let mut line = String::new();
        if BufReader::new(reader).read_line(&mut line).await.is_err() {
            return;
        }
        let Ok(message) = serde_json::from_str::<HookMessage>(&line) else {
            return;
        };
        if message.auth_token != secret {
            return;
        }
        let state_value = match message.event.event_name.as_str() {
            "UserPromptSubmit" | "PostToolUse" => Some(TaskState::Running),
            "PermissionRequest" => Some(TaskState::NeedsInput),
            "Stop" => Some(TaskState::Ready),
            "SessionEnd" => None,
            _ => return,
        };
        if let Some(value) = state_value {
            state.apply_session(&app, message.event.session_id, value, EventSource::Hook);
        } else {
            state.remove_session(&app, &message.event.session_id);
        }
        let _ = writer.write_all(b"ok\n").await;
    });
}
