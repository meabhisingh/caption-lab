// The packaged editor is served from http://127.0.0.1:43110, which Tauri treats
// as a remote origin. App commands are only reachable from there when they are
// declared here and allowed in capabilities/default.json.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_settings",
            "save_settings",
            "download_export",
        ]),
    ))
    .expect("failed to run tauri-build");
}
