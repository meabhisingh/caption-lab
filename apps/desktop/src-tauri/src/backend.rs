use crate::settings::{read_gpu, read_groq_key};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

pub const WEB_ORIGIN: &str = "http://127.0.0.1:43110";
pub const API_ORIGIN: &str = "http://127.0.0.1:43111";

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn stop_child(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

pub fn bundled_root(resource_dir: &Path) -> Option<PathBuf> {
    if resource_dir.join("web/server.js").is_file() {
        return Some(resource_dir.to_path_buf());
    }
    let nested = resource_dir.join("resources");
    if nested.join("web/server.js").is_file() {
        return Some(nested);
    }
    None
}

fn log_stdio(data_dir: &Path, name: &str) -> Result<(Stdio, Stdio), String> {
    let logs = data_dir.join("logs");
    std::fs::create_dir_all(&logs).map_err(|error| error.to_string())?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join(format!("{name}.log")))
        .map_err(|error| error.to_string())?;
    let stderr = file.try_clone().map_err(|error| error.to_string())?;
    Ok((Stdio::from(file), Stdio::from(stderr)))
}

fn command(program: &str) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

fn apply_runtime_env(command: &mut Command, data_dir: &Path, groq_key: &str, gpu: bool) {
    command
        .env("CAPTIONLAB_RUNTIME", "desktop")
        .env("CAPTIONLAB_DATA_DIR", data_dir)
        .env("GROQ_API_KEY", groq_key)
        .env("PORT", "43111")
        .env("CORS_ORIGIN", WEB_ORIGIN)
        .env("WORKER_CONCURRENCY", "1")
        .env(
            "NODE_ENV",
            if cfg!(debug_assertions) {
                "development"
            } else {
                "production"
            },
        );
    if gpu {
        command.env("REMOTION_GL", "angle");
    } else {
        command.env_remove("REMOTION_GL");
    }
}

#[derive(Deserialize)]
struct RuntimeManifest {
    #[serde(rename = "browserExecutable")]
    browser_executable: String,
}

fn apply_packaged_remotion_env(command: &mut Command, backend_dir: &Path) {
    let manifest_path = backend_dir.join("captionlab-runtime.json");
    let Ok(text) = std::fs::read_to_string(manifest_path) else {
        return;
    };
    let Ok(manifest) = serde_json::from_str::<RuntimeManifest>(&text) else {
        return;
    };
    let browser = backend_dir.join(&manifest.browser_executable);
    let entry = backend_dir.join(
        "node_modules/@caption-generator/captions/src/remotion-entry.tsx",
    );
    command
        .env("REMOTION_BROWSER_EXECUTABLE", browser)
        .env("REMOTION_ENTRY_POINT", entry);
}

pub fn spawn_api(data_dir: &Path, resource_dir: Option<&Path>) -> Result<Child, String> {
    let groq_key = read_groq_key().ok_or_else(|| "Enter a Groq API key.".to_string())?;
    let gpu = read_gpu(data_dir);
    let (stdout, stderr) = log_stdio(data_dir, "backend")?;
    let mut command = if cfg!(debug_assertions) {
        let mut command = command("pnpm");
        command
            .args(["--filter", "server", "start"])
            .current_dir(repo_root());
        command
    } else {
        let root = resource_dir
            .and_then(bundled_root)
            .ok_or_else(|| {
                "The desktop bundle is missing the local API. Run pnpm desktop:dist on this platform."
                    .to_string()
            })?;
        let backend = root.join("backend");
        let mut command = command("node");
        command
            .arg("node_modules/tsx/dist/cli.mjs")
            .arg("src/index.ts")
            .current_dir(&backend);
        apply_packaged_remotion_env(&mut command, &backend);
        command
    };
    apply_runtime_env(&mut command, data_dir, &groq_key, gpu);
    command
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|error| format!("Could not start the local API: {error}"))
}

pub fn spawn_web(data_dir: &Path, resource_dir: &Path) -> Result<Child, String> {
    let root = bundled_root(resource_dir).ok_or_else(|| {
        "The desktop bundle is missing the local UI. Run pnpm desktop:dist on this platform."
            .to_string()
    })?;
    let (stdout, stderr) = log_stdio(data_dir, "web")?;
    let mut command = command("node");
    command
        .arg("server.js")
        .current_dir(root.join("web"))
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", "43110")
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|error| format!("Could not start the local UI: {error}"))
}

pub async fn wait_for_ok(url: &str, timeout: Duration) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if let Ok(response) = client.get(url).send().await {
            if response.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
    }
    false
}
