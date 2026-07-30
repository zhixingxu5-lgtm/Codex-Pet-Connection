use crate::db::LocalDb;
use crate::model::{
    aggregate_sessions, DesktopSnapshot, EnergyState, EventSource, PetStateEnvelope, PetViewState,
    Presence, RuntimeData, SessionState, SettingsPatch, TaskState,
};
use anyhow::Result;
use chrono::{DateTime, Local, TimeZone, Utc};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

pub struct AppState {
    pub runtime: Mutex<RuntimeData>,
    pub db: Mutex<LocalDb>,
    pub server_url: String,
    pub device_id: Mutex<Option<String>>,
    pub update_tx: watch::Sender<u64>,
}

impl AppState {
    pub fn new(db: LocalDb, server_url: String) -> Result<Arc<Self>> {
        let persisted = db.load()?;
        let initial_energy = energy_for_seconds(persisted.accumulated_seconds);
        let (update_tx, _) = watch::channel(0);
        Ok(Arc::new(Self {
            runtime: Mutex::new(RuntimeData {
                sessions: Default::default(),
                last_app_server_event: Default::default(),
                self_task: TaskState::Idle,
                friend: PetViewState {
                    owner: "friend".into(),
                    presence: Presence::Offline,
                    task_state: Some(TaskState::Idle),
                    energy_state: Some(EnergyState::Relaxed),
                    limited_detection: false,
                    updated_at: Utc::now(),
                },
                friend_sequence: 0,
                accumulated_seconds: persisted.accumulated_seconds,
                // Running work is checkpointed into accumulated_seconds every 10 seconds.
                // A previous process cannot prove the task stayed active after it exited.
                running_since: None,
                workload_local_date: persisted.workload_local_date,
                share_energy: persisted.share_energy,
                privacy_paused: persisted.privacy_paused,
                reduce_motion: persisted.reduce_motion,
                paired: false,
                pairing_code: None,
                pairing_expires_at: None,
                app_server_connected: false,
                hook_connected: false,
                sequence: persisted.sequence,
                current_event_id: None,
                last_energy: initial_energy,
            }),
            db: Mutex::new(db),
            server_url,
            device_id: Mutex::new(persisted.device_id),
            update_tx,
        }))
    }

    pub fn snapshot(&self) -> DesktopSnapshot {
        let now = Utc::now();
        let mut data = self.runtime.lock().expect("runtime lock");
        if normalize_local_day(&mut data, now) {
            persist_runtime(&self.db, &data);
        }
        DesktopSnapshot {
            self_pet: PetViewState {
                owner: "self".into(),
                presence: if data.privacy_paused { Presence::PrivacyHidden } else { Presence::Online },
                task_state: if data.privacy_paused { None } else { Some(data.self_task) },
                energy_state: Some(data.energy(now)),
                limited_detection: !data.app_server_connected,
                updated_at: now,
            },
            friend_pet: data.friend.clone(),
            paired: data.paired,
            pairing_code: data.pairing_code.clone(),
            pairing_expires_at: data.pairing_expires_at,
            share_energy: data.share_energy,
            privacy_paused: data.privacy_paused,
            reduce_motion: data.reduce_motion,
            server_url: self.server_url.clone(),
            app_server_connected: data.app_server_connected,
            hook_connected: data.hook_connected,
        }
    }

    pub fn apply_session(&self, app: &AppHandle, session_id: String, state: TaskState, source: EventSource) {
        let now = Utc::now();
        {
            let mut data = self.runtime.lock().expect("runtime lock");
            if source == EventSource::Hook {
                if let Some(last) = data.last_app_server_event.get(&session_id) {
                    if (now - *last).num_seconds() <= 5 {
                        return;
                    }
                }
            }
            if source == EventSource::AppServer {
                data.last_app_server_event.insert(session_id.clone(), now);
                data.app_server_connected = true;
            }
            if source == EventSource::Hook {
                data.hook_connected = true;
            }
            data.sessions.insert(session_id, SessionState { state, updated_at: now, source });
            let previous = data.self_task;
            let next = aggregate_sessions(&data.sessions, now);
            settle_running(&mut data, previous, next, now);
            data.self_task = next;
            update_one_shot_event(&mut data, previous, next);
            data.sequence += 1;
            persist_runtime(&self.db, &data);
        }
        self.emit(app);
    }

    pub fn remove_session(&self, app: &AppHandle, session_id: &str) {
        let now = Utc::now();
        {
            let mut data = self.runtime.lock().expect("runtime lock");
            data.sessions.remove(session_id);
            let previous = data.self_task;
            let next = aggregate_sessions(&data.sessions, now);
            settle_running(&mut data, previous, next, now);
            data.self_task = next;
            update_one_shot_event(&mut data, previous, next);
            data.sequence += 1;
            persist_runtime(&self.db, &data);
        }
        self.emit(app);
    }

    pub fn update_settings(&self, app: &AppHandle, patch: SettingsPatch) {
        {
            let mut data = self.runtime.lock().expect("runtime lock");
            let db = self.db.lock().expect("db lock");
            if let Some(value) = patch.share_energy {
                data.share_energy = value;
                let _ = db.save_bool("share_energy", value);
            }
            if let Some(value) = patch.privacy_paused {
                data.privacy_paused = value;
                let _ = db.save_bool("privacy_paused", value);
            }
            if let Some(value) = patch.reduce_motion {
                data.reduce_motion = value;
                let _ = db.save_bool("reduce_motion", value);
            }
            data.sequence += 1;
            drop(db);
            persist_runtime(&self.db, &data);
        }
        self.emit(app);
    }

    pub fn outgoing_state(&self) -> Option<PetStateEnvelope> {
        let device_id = self.device_id.lock().expect("device lock").clone()?;
        let now = Utc::now();
        let data = self.runtime.lock().expect("runtime lock");
        let hidden = data.privacy_paused;
        Some(PetStateEnvelope {
            schema_version: 1,
            owner_device_id: device_id,
            sequence: data.sequence,
            presence: if hidden { Presence::PrivacyHidden } else { Presence::Online },
            task_state: if hidden { None } else { Some(data.self_task) },
            energy_state: if hidden || !data.share_energy { None } else { Some(data.energy(now)) },
            event_id: data.current_event_id.clone(),
            updated_at: now,
            expires_at: now + chrono::Duration::seconds(60),
        })
    }

    pub fn advance_heartbeat_sequence(&self) {
        let mut data = self.runtime.lock().expect("runtime lock");
        data.sequence += 1;
        persist_runtime(&self.db, &data);
    }

    pub fn apply_friend(&self, app: &AppHandle, state: PetStateEnvelope) {
        {
            let mut data = self.runtime.lock().expect("runtime lock");
            if state.sequence <= data.friend_sequence {
                return;
            }
            data.friend_sequence = state.sequence;
            data.friend = PetViewState {
                owner: "friend".into(),
                presence: state.presence,
                task_state: state.task_state,
                energy_state: state.energy_state,
                limited_detection: false,
                updated_at: state.updated_at,
            };
            data.paired = true;
        }
        self.emit(app);
    }

    pub fn emit(&self, app: &AppHandle) {
        let snapshot = self.snapshot();
        let _ = app.emit("desktop-snapshot", &snapshot);
        let _ = app.emit("pet-state", &snapshot.self_pet);
        let _ = app.emit("pet-state", &snapshot.friend_pet);
        let current = *self.update_tx.borrow();
        let _ = self.update_tx.send(current.wrapping_add(1));
    }

    pub fn tick(&self, app: &AppHandle) {
        let now = Utc::now();
        let changed = {
            let mut data = self.runtime.lock().expect("runtime lock");
            let previous_task = data.self_task;
            let previous_energy = data.last_energy;
            let day_changed = normalize_local_day(&mut data, now);
            let friend_went_offline = should_mark_friend_offline(
                data.paired,
                data.friend.presence,
                data.friend.updated_at,
                now,
            );
            if friend_went_offline {
                data.friend.presence = Presence::Offline;
                data.friend.task_state = None;
                data.friend.energy_state = None;
            }
            let next = aggregate_sessions(&data.sessions, now);
            settle_running(&mut data, previous_task, next, now);
            data.self_task = next;
            update_one_shot_event(&mut data, previous_task, next);
            let checkpoint_due = checkpoint_running(&mut data, now);
            let next_energy = data.energy(now);
            data.last_energy = next_energy;
            let changed = day_changed
                || friend_went_offline
                || previous_task != next
                || previous_energy != next_energy;
            if changed {
                data.sequence += 1;
            }
            if changed || checkpoint_due {
                persist_runtime(&self.db, &data);
            }
            changed
        };
        if changed {
            self.emit(app);
        }
    }
}

fn checkpoint_running(data: &mut RuntimeData, now: DateTime<Utc>) -> bool {
    let Some(started) = data.running_since else {
        return false;
    };
    if (now - started).num_seconds() < 10 {
        return false;
    }
    data.accumulated_seconds += (now - started).num_seconds().max(0);
    data.running_since = Some(now);
    true
}

fn should_mark_friend_offline(
    paired: bool,
    presence: Presence,
    updated_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> bool {
    paired && presence != Presence::Offline && (now - updated_at).num_seconds() >= 60
}

fn settle_running(data: &mut RuntimeData, previous: TaskState, next: TaskState, now: DateTime<Utc>) {
    normalize_local_day(data, now);
    if previous == TaskState::Running && next != TaskState::Running {
        if let Some(started) = data.running_since.take() {
            data.accumulated_seconds += (now - started).num_seconds().max(0);
        }
    }
    if previous != TaskState::Running && next == TaskState::Running && data.running_since.is_none() {
        data.running_since = Some(now);
    }
}

fn normalize_local_day(data: &mut RuntimeData, now: DateTime<Utc>) -> bool {
    let local_now = now.with_timezone(&Local);
    let today = local_now.format("%Y-%m-%d").to_string();
    if data.workload_local_date == today {
        return false;
    }
    data.workload_local_date = today;
    data.accumulated_seconds = 0;
    data.running_since = if data.self_task == TaskState::Running {
        let midnight = local_now.date_naive().and_hms_opt(0, 0, 0);
        midnight
            .and_then(|value| Local.from_local_datetime(&value).earliest())
            .map(|value| value.with_timezone(&Utc))
            .or(Some(now))
    } else {
        None
    };
    true
}

fn update_one_shot_event(data: &mut RuntimeData, previous: TaskState, next: TaskState) {
    if previous == next {
        return;
    }
    data.current_event_id = if matches!(next, TaskState::Ready | TaskState::Blocked) {
        Some(uuid::Uuid::new_v4().to_string())
    } else {
        None
    };
}

fn energy_for_seconds(seconds: i64) -> EnergyState {
    match seconds {
        0..=1199 => EnergyState::Relaxed,
        1200..=3599 => EnergyState::Focused,
        3600..=7199 => EnergyState::Tired,
        _ => EnergyState::Exhausted,
    }
}

fn persist_runtime(db: &Mutex<LocalDb>, data: &RuntimeData) {
    let db = db.lock().expect("db lock");
    let _ = db.save_workload(
        &data.workload_local_date,
        data.accumulated_seconds,
        data.running_since,
    );
    let _ = db.save_setting("sequence", &data.sequence.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friend_goes_offline_at_sixty_seconds_only_when_paired() {
        let now = Utc::now();
        assert!(!should_mark_friend_offline(
            true,
            Presence::Online,
            now - chrono::Duration::seconds(59),
            now,
        ));
        assert!(should_mark_friend_offline(
            true,
            Presence::PrivacyHidden,
            now - chrono::Duration::seconds(60),
            now,
        ));
        assert!(!should_mark_friend_offline(
            false,
            Presence::Online,
            now - chrono::Duration::minutes(10),
            now,
        ));
    }
}
