use anyhow::{Context, Result};
use chrono::{DateTime, Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub struct LocalDb {
    connection: Connection,
}

#[derive(Debug)]
pub struct PersistedState {
    pub share_energy: bool,
    pub privacy_paused: bool,
    pub reduce_motion: bool,
    pub workload_local_date: String,
    pub accumulated_seconds: i64,
    pub device_id: Option<String>,
    pub sequence: u64,
}

impl LocalDb {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("create app data directory")?;
        }
        let connection = Connection::open(path).context("open local database")?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS daily_workload (
               local_date TEXT PRIMARY KEY,
               accumulated_seconds INTEGER NOT NULL,
               running_since TEXT
             );
             CREATE TABLE IF NOT EXISTS window_positions (
               label TEXT PRIMARY KEY,
               x INTEGER NOT NULL,
               y INTEGER NOT NULL
             );",
        )?;
        Ok(Self { connection })
    }

    pub fn load(&self) -> Result<PersistedState> {
        let today = Local::now().format("%Y-%m-%d").to_string();
        self.connection.execute("DELETE FROM daily_workload WHERE local_date <> ?1", [&today])?;
        let accumulated_seconds = self
            .connection
            .query_row(
                "SELECT accumulated_seconds FROM daily_workload WHERE local_date = ?1",
                [&today],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        Ok(PersistedState {
            share_energy: self.setting_bool("share_energy")?.unwrap_or(true),
            privacy_paused: self.setting_bool("privacy_paused")?.unwrap_or(false),
            reduce_motion: self.setting_bool("reduce_motion")?.unwrap_or(false),
            workload_local_date: today,
            accumulated_seconds,
            device_id: self.setting("device_id")?,
            sequence: self
                .setting("sequence")?
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
        })
    }

    pub fn save_bool(&self, key: &str, value: bool) -> Result<()> {
        self.save_setting(key, if value { "true" } else { "false" })
    }

    pub fn save_setting(&self, key: &str, value: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn save_workload(&self, local_date: &str, seconds: i64, running_since: Option<DateTime<Utc>>) -> Result<()> {
        self.connection
            .execute("DELETE FROM daily_workload WHERE local_date <> ?1", [local_date])?;
        self.connection.execute(
            "INSERT INTO daily_workload (local_date, accumulated_seconds, running_since) VALUES (?1, ?2, ?3)
             ON CONFLICT(local_date) DO UPDATE SET accumulated_seconds = excluded.accumulated_seconds, running_since = excluded.running_since",
            params![local_date, seconds, running_since.map(|value| value.to_rfc3339())],
        )?;
        Ok(())
    }

    pub fn save_window_position(&self, label: &str, x: i32, y: i32) -> Result<()> {
        self.connection.execute(
            "INSERT INTO window_positions (label, x, y) VALUES (?1, ?2, ?3)
             ON CONFLICT(label) DO UPDATE SET x = excluded.x, y = excluded.y",
            params![label, x, y],
        )?;
        Ok(())
    }

    pub fn window_position(&self, label: &str) -> Result<Option<(i32, i32)>> {
        Ok(self
            .connection
            .query_row("SELECT x, y FROM window_positions WHERE label = ?1", [label], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?)
    }

    fn setting_bool(&self, key: &str) -> Result<Option<bool>> {
        Ok(self.setting(key)?.map(|value| value == "true"))
    }

    fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
            .optional()?)
    }
}
