use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Presence {
    Online,
    Reconnecting,
    Offline,
    PrivacyHidden,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Idle,
    Running,
    NeedsInput,
    Ready,
    Blocked,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnergyState {
    Relaxed,
    Focused,
    Tired,
    Exhausted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventSource {
    AppServer,
    Hook,
    Manual,
}

#[derive(Clone, Debug)]
pub struct SessionState {
    pub state: TaskState,
    pub updated_at: DateTime<Utc>,
    pub source: EventSource,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetStateEnvelope {
    pub schema_version: u8,
    pub owner_device_id: String,
    pub sequence: u64,
    pub presence: Presence,
    pub task_state: Option<TaskState>,
    pub energy_state: Option<EnergyState>,
    pub event_id: Option<String>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetViewState {
    pub owner: String,
    pub presence: Presence,
    pub task_state: Option<TaskState>,
    pub energy_state: Option<EnergyState>,
    pub limited_detection: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshot {
    pub self_pet: PetViewState,
    pub friend_pet: PetViewState,
    pub paired: bool,
    pub pairing_code: Option<String>,
    pub pairing_expires_at: Option<DateTime<Utc>>,
    pub share_energy: bool,
    pub privacy_paused: bool,
    pub reduce_motion: bool,
    pub server_url: String,
    pub app_server_connected: bool,
    pub hook_connected: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub share_energy: Option<bool>,
    pub privacy_paused: Option<bool>,
    pub reduce_motion: Option<bool>,
}

#[derive(Debug)]
pub struct RuntimeData {
    pub sessions: HashMap<String, SessionState>,
    pub last_app_server_event: HashMap<String, DateTime<Utc>>,
    pub self_task: TaskState,
    pub friend: PetViewState,
    pub friend_sequence: u64,
    pub accumulated_seconds: i64,
    pub running_since: Option<DateTime<Utc>>,
    pub workload_local_date: String,
    pub share_energy: bool,
    pub privacy_paused: bool,
    pub reduce_motion: bool,
    pub paired: bool,
    pub pairing_code: Option<String>,
    pub pairing_expires_at: Option<DateTime<Utc>>,
    pub app_server_connected: bool,
    pub hook_connected: bool,
    pub sequence: u64,
    pub current_event_id: Option<String>,
    pub last_energy: EnergyState,
}

impl RuntimeData {
    pub fn energy(&self, now: DateTime<Utc>) -> EnergyState {
        let mut seconds = self.accumulated_seconds;
        if let Some(started) = self.running_since {
            seconds += (now - started).num_seconds().max(0);
        }
        match seconds {
            0..=1199 => EnergyState::Relaxed,
            1200..=3599 => EnergyState::Focused,
            3600..=7199 => EnergyState::Tired,
            _ => EnergyState::Exhausted,
        }
    }
}

pub fn aggregate_sessions(sessions: &HashMap<String, SessionState>, now: DateTime<Utc>) -> TaskState {
    fn priority(state: TaskState) -> u8 {
        match state {
            TaskState::Idle => 0,
            TaskState::Running => 1,
            TaskState::Ready => 2,
            TaskState::Blocked => 3,
            TaskState::NeedsInput => 4,
        }
    }
    sessions
        .values()
        .map(|session| {
            let age = (now - session.updated_at).num_seconds();
            match session.state {
                TaskState::Ready if age >= 30 => TaskState::Idle,
                TaskState::Blocked if age >= 300 => TaskState::Idle,
                state => state,
            }
        })
        .max_by_key(|state| priority(*state))
        .unwrap_or(TaskState::Idle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(seconds: i64) -> RuntimeData {
        RuntimeData {
            sessions: HashMap::new(),
            last_app_server_event: HashMap::new(),
            self_task: TaskState::Idle,
            friend: PetViewState {
                owner: "friend".into(),
                presence: Presence::Offline,
                task_state: None,
                energy_state: None,
                limited_detection: false,
                updated_at: Utc::now(),
            },
            friend_sequence: 0,
            accumulated_seconds: seconds,
            running_since: None,
            workload_local_date: "2026-07-30".into(),
            share_energy: true,
            privacy_paused: false,
            reduce_motion: false,
            paired: false,
            pairing_code: None,
            pairing_expires_at: None,
            app_server_connected: false,
            hook_connected: false,
            sequence: 0,
            current_event_id: None,
            last_energy: EnergyState::Relaxed,
        }
    }

    #[test]
    fn energy_threshold_boundaries_are_exact() {
        let now = Utc::now();
        for (seconds, expected) in [
            (1199, EnergyState::Relaxed),
            (1200, EnergyState::Focused),
            (3599, EnergyState::Focused),
            (3600, EnergyState::Tired),
            (7199, EnergyState::Tired),
            (7200, EnergyState::Exhausted),
        ] {
            assert_eq!(runtime(seconds).energy(now), expected);
        }
    }

    #[test]
    fn session_priority_and_transient_expiry_match_the_contract() {
        let now = Utc::now();
        let mut sessions = HashMap::new();
        sessions.insert(
            "running".into(),
            SessionState { state: TaskState::Running, updated_at: now, source: EventSource::Hook },
        );
        sessions.insert(
            "approval".into(),
            SessionState { state: TaskState::NeedsInput, updated_at: now, source: EventSource::AppServer },
        );
        assert_eq!(aggregate_sessions(&sessions, now), TaskState::NeedsInput);
        sessions.clear();
        sessions.insert(
            "ready".into(),
            SessionState {
                state: TaskState::Ready,
                updated_at: now - chrono::Duration::seconds(30),
                source: EventSource::Hook,
            },
        );
        assert_eq!(aggregate_sessions(&sessions, now), TaskState::Idle);
    }
}
