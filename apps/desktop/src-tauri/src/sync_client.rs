use crate::{credentials::ensure_device, model::{PetStateEnvelope, Presence}, runtime::AppState};
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::time::{interval, sleep, Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::{http::Request, Message}};

pub async fn run(app: AppHandle, state: Arc<AppState>) {
    let mut disconnected_since = Instant::now();
    loop {
        let mut connection_established = false;
        let result = run_connection(&app, &state, &mut connection_established).await;
        if result.is_err() {
            if connection_established {
                disconnected_since = Instant::now();
            }
            let elapsed = disconnected_since.elapsed();
            {
                let mut data = state.runtime.lock().expect("runtime lock");
                data.friend.presence = if elapsed >= Duration::from_secs(60) { Presence::Offline } else { Presence::Reconnecting };
            }
            state.emit(&app);
            sleep(Duration::from_secs(3)).await;
        } else {
            disconnected_since = Instant::now();
        }
    }
}

async fn run_connection(
    app: &AppHandle,
    state: &Arc<AppState>,
    connection_established: &mut bool,
) -> Result<()> {
    let credentials = ensure_device(state).await?;
    refresh_pairing(state, &credentials.token).await?;
    let ws_url = state.server_url.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    let request = Request::builder()
        .uri(format!("{ws_url}/v1/realtime"))
        .header("Authorization", format!("Bearer {}", credentials.token))
        .header("Host", host_header(&ws_url))
        .body(())?;
    let (stream, _) = connect_async(request).await.context("connect realtime service")?;
    *connection_established = true;
    let (mut writer, mut reader) = stream.split();
    let mut tick = interval(Duration::from_secs(20));
    let mut changes = state.update_tx.subscribe();

    loop {
        tokio::select! {
            _ = tick.tick() => {
                writer.send(Message::Text(json!({"type":"heartbeat","sentAt":chrono::Utc::now().to_rfc3339()}).to_string().into())).await?;
                state.advance_heartbeat_sequence();
                send_state(&mut writer, state).await?;
            }
            changed = changes.changed() => {
                changed?;
                send_state(&mut writer, state).await?;
            }
            message = reader.next() => {
                let Some(message) = message else { anyhow::bail!("realtime connection closed"); };
                let message = message?;
                if let Message::Text(text) = message {
                    handle_message(app, state, &credentials.device_id, &text)?;
                }
            }
        }
    }
}

async fn send_state<S>(writer: &mut S, state: &Arc<AppState>) -> Result<()>
where
    S: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    if let Some(state) = state.outgoing_state() {
        writer.send(Message::Text(json!({"type":"pet.state","state":state}).to_string().into())).await?;
    }
    Ok(())
}

fn handle_message(app: &AppHandle, state: &Arc<AppState>, self_id: &str, text: &str) -> Result<()> {
    let value: Value = serde_json::from_str(text)?;
    match value.get("type").and_then(Value::as_str) {
        Some("pet.state") => {
            let friend: PetStateEnvelope = serde_json::from_value(value.get("state").cloned().unwrap_or(Value::Null))?;
            if friend.owner_device_id != self_id { state.apply_friend(app, friend); }
        }
        Some("snapshot") => {
            if let Some(states) = value.get("states").and_then(Value::as_array) {
                for raw in states {
                    let friend: PetStateEnvelope = serde_json::from_value(raw.clone())?;
                    if friend.owner_device_id != self_id { state.apply_friend(app, friend); }
                }
            }
        }
        Some("pair.created") => {
            state.runtime.lock().expect("runtime lock").paired = true;
            state.emit(app);
        }
        Some("pair.revoked") => {
            let mut data = state.runtime.lock().expect("runtime lock");
            data.paired = false;
            data.friend.presence = Presence::Offline;
            drop(data);
            state.emit(app);
        }
        _ => {}
    }
    Ok(())
}

async fn refresh_pairing(state: &Arc<AppState>, token: &str) -> Result<()> {
    let response = reqwest::Client::new()
        .get(format!("{}/v1/pairing", state.server_url))
        .bearer_auth(token)
        .send()
        .await?;
    if response.status().is_success() {
        let value: Value = response.json().await?;
        state.runtime.lock().expect("runtime lock").paired = value.get("paired").and_then(Value::as_bool).unwrap_or(false);
    }
    Ok(())
}

fn host_header(url: &str) -> String {
    url.split("//").nth(1).unwrap_or("127.0.0.1:8787").split('/').next().unwrap_or("127.0.0.1:8787").to_string()
}
