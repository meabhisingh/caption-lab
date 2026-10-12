use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::path::Path;

const SERVICE: &str = "CaptionLab";
const ACCOUNT: &str = "groq-api-key";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSnapshot {
    pub configured: bool,
    pub state: String,
    pub error: Option<String>,
    pub saved_fields: SavedFields,
    pub values: SnapshotValues,
}

#[derive(Clone, Serialize)]
pub struct SavedFields {
    #[serde(rename = "GROQ_API_KEY")]
    pub groq_api_key: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotValues {
    #[serde(rename = "GPU_FRAME_ACCELERATION")]
    pub gpu_frame_acceleration: bool,
    pub data_dir: String,
}

#[derive(Deserialize)]
pub struct SettingsInput {
    #[serde(rename = "GROQ_API_KEY")]
    pub groq_api_key: Option<String>,
    #[serde(rename = "GPU_FRAME_ACCELERATION")]
    pub gpu_frame_acceleration: Option<bool>,
}

#[derive(Deserialize)]
struct Preferences {
    #[serde(rename = "gpuFrameAcceleration", default)]
    gpu_frame_acceleration: bool,
}

pub fn read_groq_key() -> Option<String> {
    let entry = Entry::new(SERVICE, ACCOUNT).ok()?;
    let value = entry.get_password().ok()?;
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn read_gpu(data_dir: &Path) -> bool {
    let path = data_dir.join("preferences.json");
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    serde_json::from_slice::<Preferences>(&bytes)
        .map(|preferences| preferences.gpu_frame_acceleration)
        .unwrap_or(false)
}

pub fn save_settings(data_dir: &Path, input: SettingsInput) -> Result<(), String> {
    let current_key = read_groq_key();
    let next_key = input
        .groq_api_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(current_key);
    let Some(key) = next_key else {
        return Err("Enter a Groq API key.".into());
    };
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|error| error.to_string())?;
    entry.set_password(&key).map_err(|error| {
        format!("Could not store the Groq API key in the operating system credential manager: {error}")
    })?;
    if read_groq_key().as_deref() != Some(key.as_str()) {
        return Err(
            "The operating system credential manager did not keep the Groq API key.".into(),
        );
    }

    let gpu = input
        .gpu_frame_acceleration
        .unwrap_or_else(|| read_gpu(data_dir));
    let path = data_dir.join("preferences.json");
    let body = serde_json::json!({ "gpuFrameAcceleration": gpu });
    std::fs::write(path, serde_json::to_vec_pretty(&body).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn snapshot(
    data_dir: &Path,
    state: &str,
    error: Option<String>,
) -> ServiceSnapshot {
    let configured = read_groq_key().is_some();
    ServiceSnapshot {
        configured,
        state: state.to_string(),
        error,
        saved_fields: SavedFields {
            groq_api_key: configured,
        },
        values: SnapshotValues {
            gpu_frame_acceleration: read_gpu(data_dir),
            data_dir: data_dir.display().to_string(),
        },
    }
}
