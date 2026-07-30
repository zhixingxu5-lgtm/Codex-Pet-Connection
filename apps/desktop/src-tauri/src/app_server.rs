use crate::model::{EventSource, TaskState};
use crate::runtime::AppState;
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{collections::HashMap, process::Stdio, sync::{Arc, Mutex}};
use tauri::AppHandle;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::mpsc,
    time::{interval, Duration},
};

pub async fn run(app: AppHandle, state: Arc<AppState>) -> Result<()> {
    let mut child = Command::new("codex")
        .args(["app-server", "proxy"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("start codex app-server proxy")?;
    let stdin = child.stdin.take().context("app-server stdin")?;
    let stdout = child.stdout.take().context("app-server stdout")?;
    let (tx, mut rx) = mpsc::channel::<String>(128);
    let pending_reads = Arc::new(Mutex::new(HashMap::<u64, String>::new()));

    tokio::spawn(async move {
        let mut writer = stdin;
        while let Some(message) = rx.recv().await {
            if writer.write_all(message.as_bytes()).await.is_err() { break; }
            if writer.write_all(b"\n").await.is_err() { break; }
        }
    });

    tx.send(json!({"method":"initialize","id":1,"params":{"clientInfo":{"name":"codex_pet_link","title":"Codex Pet Link","version":"0.1.0"}}}).to_string()).await?;
    tx.send(json!({"method":"initialized","params":{}}).to_string()).await?;

    let poll_tx = tx.clone();
    tokio::spawn(async move {
        let mut id = 1000_u64;
        let mut tick = interval(Duration::from_secs(3));
        loop {
            tick.tick().await;
            id += 1;
            if poll_tx.send(json!({"method":"thread/loaded/list","id":id}).to_string()).await.is_err() { break; }
        }
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut read_id = 10_000_u64;
    while let Some(line) = lines.next_line().await? {
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue; };
        if let Some(method) = value.get("method").and_then(Value::as_str) {
            handle_notification(&app, &state, method, value.get("params"));
            continue;
        }
        if value.get("id").and_then(Value::as_u64) == Some(1) && value.get("result").is_some() {
            state.runtime.lock().expect("runtime lock").app_server_connected = true;
            state.emit(&app);
            continue;
        }
        let Some(result) = value.get("result") else { continue; };
        if let Some(ids) = result.get("data").and_then(Value::as_array) {
            for thread in ids.iter().filter_map(Value::as_str) {
                read_id += 1;
                pending_reads.lock().expect("pending reads").insert(read_id, thread.to_string());
                tx.send(json!({"method":"thread/read","id":read_id,"params":{"threadId":thread,"includeTurns":true}}).to_string()).await?;
            }
            continue;
        }
        let Some(id) = value.get("id").and_then(Value::as_u64) else { continue; };
        let Some(thread_id) = pending_reads.lock().expect("pending reads").remove(&id) else { continue; };
        if let Some(task) = task_from_thread(result.get("thread")) {
            state.apply_session(&app, thread_id, task, EventSource::AppServer);
        }
    }
    let _ = child.kill().await;
    state.runtime.lock().expect("runtime lock").app_server_connected = false;
    state.emit(&app);
    Ok(())
}

fn handle_notification(app: &AppHandle, state: &Arc<AppState>, method: &str, params: Option<&Value>) {
    let Some((thread, task)) = task_from_notification(method, params) else {
        return;
    };
    state.apply_session(app, thread, task, EventSource::AppServer);
}

fn task_from_notification(method: &str, params: Option<&Value>) -> Option<(String, TaskState)> {
    let thread = params
        .and_then(|p| p.get("threadId"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let task = match method {
        "turn/started" => Some(TaskState::Running),
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/tool/requestUserInput" | "item/permissions/requestApproval" => Some(TaskState::NeedsInput),
        "serverRequest/resolved" => Some(TaskState::Running),
        "turn/completed" => params.and_then(|p| p.get("turn")).and_then(|turn| turn.get("status")).and_then(Value::as_str).map(|status| match status {
            "failed" => TaskState::Blocked,
            "interrupted" => TaskState::Idle,
            _ => TaskState::Ready,
        }),
        _ => None,
    };
    task.map(|task| (thread, task))
}

fn task_from_thread(thread: Option<&Value>) -> Option<TaskState> {
    let thread = thread?;
    if let Some(status) = thread.get("status") {
        if status.get("type").and_then(Value::as_str) == Some("active") {
            let waiting = status
                .get("activeFlags")
                .and_then(Value::as_array)
                .is_some_and(|flags| flags.iter().any(|flag| flag.as_str() == Some("waitingOnApproval")));
            return Some(if waiting { TaskState::NeedsInput } else { TaskState::Running });
        }
    }
    let last = thread.get("turns").and_then(Value::as_array)?.last()?;
    match last.get("status").and_then(Value::as_str) {
        Some("failed") => Some(TaskState::Blocked),
        Some("completed") => Some(TaskState::Ready),
        Some("interrupted") => Some(TaskState::Idle),
        Some("inProgress") => Some(TaskState::Running),
        _ => Some(TaskState::Idle),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_official_turn_statuses() {
        for (status, expected) in [
            ("completed", TaskState::Ready),
            ("failed", TaskState::Blocked),
            ("interrupted", TaskState::Idle),
        ] {
            let params = json!({"threadId":"thread-1","turn":{"status":status}});
            assert_eq!(
                task_from_notification("turn/completed", Some(&params)),
                Some(("thread-1".into(), expected))
            );
        }
    }

    #[test]
    fn maps_approval_and_resolution_without_reading_payload_content() {
        let request = json!({
            "threadId":"thread-1",
            "turnId":"turn-1",
            "command":"private command that must be ignored"
        });
        assert_eq!(
            task_from_notification("item/commandExecution/requestApproval", Some(&request)),
            Some(("thread-1".into(), TaskState::NeedsInput))
        );
        assert_eq!(
            task_from_notification("serverRequest/resolved", Some(&request)),
            Some(("thread-1".into(), TaskState::Running))
        );
    }

    #[test]
    fn reads_loaded_thread_state_and_tolerates_unknown_fields() {
        let thread = json!({
            "status":{"type":"active","activeFlags":["waitingOnApproval"]},
            "unknownFutureField":{"nested":true}
        });
        assert_eq!(task_from_thread(Some(&thread)), Some(TaskState::NeedsInput));
        assert_eq!(task_from_notification("future/event", Some(&thread)), None);
    }
}
