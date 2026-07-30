use anyhow::{Context, Result};
use chrono::Utc;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::PathBuf,
};

#[derive(Deserialize)]
struct HookInput {
    session_id: String,
    turn_id: Option<String>,
    hook_event_name: String,
    #[serde(flatten)]
    _ignored: std::collections::HashMap<String, Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HookEvent {
    session_id: String,
    turn_id: Option<String>,
    event_name: String,
    occurred_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HookMessage {
    auth_token: String,
    event: HookEvent,
}

fn main() {
    let _ = send();
    println!("{{}}");
}

fn send() -> Result<()> {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw)?;
    let input: HookInput = serde_json::from_str(&raw)?;
    anyhow::ensure!(
        matches!(
            input.hook_event_name.as_str(),
            "UserPromptSubmit" | "PermissionRequest" | "PostToolUse" | "Stop" | "SessionEnd"
        ),
        "unsupported event"
    );
    let secret = std::fs::read_to_string(secret_path()?).context("read hook secret")?;
    let message = HookMessage {
        auth_token: secret.trim().to_owned(),
        event: HookEvent {
            session_id: input.session_id,
            turn_id: input.turn_id,
            event_name: input.hook_event_name,
            occurred_at: Utc::now().to_rfc3339(),
        },
    };
    write_message(&serde_json::to_string(&message)?)?;
    Ok(())
}

#[cfg(unix)]
fn write_message(message: &str) -> Result<()> {
    use std::os::unix::net::UnixStream;
    let mut stream = UnixStream::connect(socket_path()?)?;
    writeln!(stream, "{message}")?;
    Ok(())
}

#[cfg(windows)]
fn write_message(message: &str) -> Result<()> {
    let mut pipe = std::fs::OpenOptions::new()
        .write(true)
        .open(r"\\.\pipe\codex-pet-link")?;
    writeln!(pipe, "{message}")?;
    Ok(())
}

fn secret_path() -> Result<PathBuf> {
    if let Ok(path) = std::env::var("PETLINK_HOOK_SECRET_FILE") {
        return Ok(path.into());
    }
    Ok(app_data_dir()?.join("hook-secret"))
}

fn socket_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join("hook.sock"))
}

fn app_data_dir() -> Result<PathBuf> {
    #[cfg(target_os = "windows")]
    if let Ok(path) = std::env::var("APPDATA") {
        return Ok(PathBuf::from(path).join("com.codexpetlink.app"));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = directories::BaseDirs::new() {
        return Ok(home
            .home_dir()
            .join("Library")
            .join("Application Support")
            .join("com.codexpetlink.app"));
    }
    let dirs = ProjectDirs::from("com", "codexpetlink", "app")
        .context("resolve app data directory")?;
    Ok(dirs.data_dir().to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_ignores_sensitive_fields() {
        let input: HookInput = serde_json::from_value(serde_json::json!({
            "session_id": "thr_1",
            "turn_id": "turn_1",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "secret",
            "cwd": "/secret",
            "last_assistant_message": "private"
        }))
        .unwrap();
        let serialized = serde_json::to_string(&HookEvent {
            session_id: input.session_id,
            turn_id: input.turn_id,
            event_name: input.hook_event_name,
            occurred_at: "now".into(),
        })
        .unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("private"));
    }
}
