use crate::runtime::AppState;
use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::sync::Arc;

const KEYRING_SERVICE: &str = "com.codexpetlink.app";
const KEYRING_ACCOUNT: &str = "device-token";

#[derive(Clone, Debug)]
pub struct Credentials {
    pub device_id: String,
    pub token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterResponse {
    device_id: String,
    device_token: String,
}

pub async fn ensure_device(state: &Arc<AppState>) -> Result<Credentials> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).context("open operating-system credential store")?;
    let existing_id = state.device_id.lock().expect("device lock").clone();
    if let (Some(device_id), Ok(token)) = (existing_id, entry.get_password()) {
        return Ok(Credentials { device_id, token });
    }

    let response = reqwest::Client::new()
        .post(format!("{}/v1/devices/register", state.server_url))
        .send()
        .await
        .context("register device")?;
    if !response.status().is_success() {
        return Err(anyhow!("device registration failed: {}", response.status()));
    }
    let registered: RegisterResponse = response.json().await.context("decode device registration")?;
    entry.set_password(&registered.device_token).context("store device token")?;
    state
        .db
        .lock()
        .expect("db lock")
        .save_setting("device_id", &registered.device_id)?;
    *state.device_id.lock().expect("device lock") = Some(registered.device_id.clone());
    Ok(Credentials { device_id: registered.device_id, token: registered.device_token })
}
