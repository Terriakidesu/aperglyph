use std::fs::{self, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aperglyph_desktop_storage::{
    DocumentSnapshot, DocumentSummary, LocalTemplate, RecoverySnapshot, StoredDocument,
    WorkspaceDb, WorkspaceExportSnapshot,
};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Emitter, Manager, State};

struct AppState {
    database: Option<Arc<WorkspaceDb>>,
    initialization_error: Option<String>,
    data_dir: Option<PathBuf>,
    startup_wdiag: std::sync::Mutex<Option<PathBuf>>,
}

impl AppState {
    fn db(&self) -> Result<Arc<WorkspaceDb>, String> {
        self.database.clone().ok_or_else(|| {
            self.initialization_error
                .clone()
                .unwrap_or_else(|| "Native workspace storage is unavailable.".to_owned())
        })
    }
}

const MAX_NATIVE_FILE_BYTES: u64 = 50 * 1024 * 1024;

fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> {
    async move {
        tauri::async_runtime::spawn_blocking(job)
            .await
            .map_err(|error| format!("Native storage worker failed: {error}"))?
    }
}

#[tauri::command]
async fn save_document(
    state: State<'_, AppState>,
    document: Value,
    thumbnail: Option<String>,
    clear_thumbnail: bool,
) -> Result<StoredDocument, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .save_document_with_thumbnail(document, thumbnail.as_deref(), clear_thumbnail)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn save_document_thumbnail(
    state: State<'_, AppState>,
    id: String,
    revision: i64,
    thumbnail: String,
) -> Result<bool, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .save_document_thumbnail(&id, revision, &thumbnail)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn load_document(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<StoredDocument>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .load_document(&id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_documents(
    state: State<'_, AppState>,
    include_trashed: bool,
) -> Result<Vec<StoredDocument>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .list_documents(include_trashed)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_document_summaries(
    state: State<'_, AppState>,
    include_trashed: bool,
) -> Result<Vec<DocumentSummary>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .list_document_summaries_with_trash(include_trashed)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn update_document_metadata(
    state: State<'_, AppState>,
    id: String,
    changes: Value,
) -> Result<(), String> {
    let favorite = changes.get("favorite").and_then(Value::as_bool);
    let trashed_at = changes.get("trashedAt").map(|value| value.as_i64());
    let database = state.db()?;
    blocking(move || {
        database
            .update_document_metadata(&id, favorite, trashed_at)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn rename_document(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Option<StoredDocument>, String> {
    if name.trim().is_empty() || name.len() > 256 {
        return Err("Diagram names must contain 1 to 256 characters.".into());
    }
    let database = state.db()?;
    blocking(move || {
        database
            .rename_document(&id, &name, now_millis())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn duplicate_document(
    state: State<'_, AppState>,
    id: String,
    new_id: String,
) -> Result<Option<StoredDocument>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .duplicate_document(&id, &new_id, now_millis())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn delete_document(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .delete_document(&id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn clear_all_documents(state: State<'_, AppState>) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .clear_documents_and_history()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn restore_workspace_data(
    state: State<'_, AppState>,
    documents: Vec<StoredDocument>,
    snapshots: Vec<DocumentSnapshot>,
    recovery: Vec<RecoverySnapshot>,
    templates: Vec<LocalTemplate>,
    preferences: Vec<(String, String)>,
    replace: bool,
) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .restore_workspace_data(
                documents,
                snapshots,
                recovery,
                templates,
                preferences,
                replace,
            )
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn export_workspace_snapshot(
    state: State<'_, AppState>,
) -> Result<WorkspaceExportSnapshot, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .export_workspace_snapshot()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_snapshots(
    state: State<'_, AppState>,
    document_id: Option<String>,
) -> Result<Vec<DocumentSnapshot>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .list_snapshots(document_id.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn save_snapshot(
    state: State<'_, AppState>,
    snapshot: DocumentSnapshot,
    limit: usize,
) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .save_snapshot(&snapshot, limit)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn load_snapshot(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<DocumentSnapshot>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .load_snapshot(&id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn delete_snapshot(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .delete_snapshot(&id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn clear_snapshots(state: State<'_, AppState>) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .clear_snapshots()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn save_recovery(
    state: State<'_, AppState>,
    document: Value,
    saved_at: i64,
) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .save_recovery(document, saved_at)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_recovery(
    state: State<'_, AppState>,
    document_id: Option<String>,
) -> Result<Option<RecoverySnapshot>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .get_recovery(document_id.as_deref())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_recovery(state: State<'_, AppState>) -> Result<Vec<RecoverySnapshot>, String> {
    let database = state.db()?;
    blocking(move || database.list_recovery().map_err(|error| error.to_string())).await
}

#[tauri::command]
async fn clear_recovery(
    state: State<'_, AppState>,
    document_id: Option<String>,
    saved_before_or_at: Option<i64>,
) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .clear_recovery_before(document_id.as_deref(), saved_before_or_at)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_templates(state: State<'_, AppState>) -> Result<Vec<LocalTemplate>, String> {
    let database = state.db()?;
    blocking(move || database.list_templates().map_err(|error| error.to_string())).await
}

#[tauri::command]
async fn save_template(state: State<'_, AppState>, template: LocalTemplate) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .save_template(&template)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn delete_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .delete_template(&id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn set_preference(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    if !key.starts_with("aperglyph.")
        || key.starts_with("aperglyph.mcp.")
        || key == "aperglyph.local-templates"
        || key.len() > 256
        || value.len() > 200_000
    {
        return Err("Invalid preference key or value size.".into());
    }
    let database = state.db()?;
    blocking(move || {
        database
            .set_preference(&key, &value)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_preference(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .get_preference(&key)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_preferences(state: State<'_, AppState>) -> Result<Vec<(String, String)>, String> {
    let database = state.db()?;
    blocking(move || {
        database
            .list_preferences()
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn delete_preference(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || {
        database
            .delete_preference(&key)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn get_storage_usage(state: State<'_, AppState>) -> Result<u64, String> {
    let database = state.db()?;
    blocking(move || database.storage_usage().map_err(|error| error.to_string())).await
}

#[tauri::command]
async fn get_data_directory(state: State<'_, AppState>) -> Result<String, String> {
    state
        .data_dir
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| {
            state
                .initialization_error
                .clone()
                .unwrap_or_else(|| "The native workspace directory is unavailable.".to_owned())
        })
}

#[tauri::command]
async fn take_startup_wdiag(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let path = state
        .startup_wdiag
        .lock()
        .map(|mut file| file.take())
        .map_err(|_| "Unable to read the startup diagram.".to_owned())?;
    match path {
        Some(path) => blocking(move || read_limited_text(&path, &["wdiag"], "diagram"))
            .await
            .map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
async fn read_wdiag_file(path: String) -> Result<String, String> {
    blocking(move || {
        let path = validate_wdiag_path(Path::new(&path), false)?;
        read_limited_text(&path, &["wdiag"], "diagram")
    })
    .await
}

#[tauri::command]
async fn write_wdiag_file(path: String, contents: String) -> Result<(), String> {
    blocking(move || {
        if contents.len() as u64 > MAX_NATIVE_FILE_BYTES {
            return Err("This .wdiag export is too large to save safely.".into());
        }
        let value: Value = serde_json::from_str(&contents)
            .map_err(|error| format!("The .wdiag export is not valid JSON: {error}"))?;
        if value.get("format").and_then(Value::as_str) != Some("aperglyph")
            || value.get("formatVersion").and_then(Value::as_i64) != Some(1)
            || !value.get("document").is_some_and(Value::is_object)
        {
            return Err("The .wdiag export does not contain a supported AperGlyph project.".into());
        }
        let path = validate_wdiag_path(Path::new(&path), true)?;
        write_atomic_text(&path, &contents, &["wdiag"], "diagram")
    })
    .await
}

#[tauri::command]
async fn read_workspace_backup_file(path: String) -> Result<String, String> {
    blocking(move || read_limited_text(Path::new(&path), &["json", "wbackup"], "workspace backup"))
        .await
}

#[tauri::command]
async fn write_workspace_backup_file(path: String, contents: String) -> Result<(), String> {
    blocking(move || {
        if contents.len() as u64 > MAX_NATIVE_FILE_BYTES {
            return Err("This workspace backup is too large to save safely.".into());
        }
        write_atomic_text(
            Path::new(&path),
            &contents,
            &["json", "wbackup"],
            "workspace backup",
        )
    })
    .await
}

fn validate_wdiag_path(path: &Path, allow_new: bool) -> Result<PathBuf, String> {
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("wdiag"))
    {
        return Err("Only .wdiag diagram files are supported by this native file action.".into());
    }
    if allow_new {
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        if !parent.is_dir() {
            return Err("The selected .wdiag folder does not exist.".into());
        }
        Ok(path.to_path_buf())
    } else {
        fs::canonicalize(path)
            .map_err(|error| format!("Unable to open the selected .wdiag file: {error}"))
    }
}

fn validate_extension(path: &Path, extensions: &[&str], label: &str) -> Result<(), String> {
    let matches = path.extension().is_some_and(|extension| {
        extensions
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    });
    if matches {
        Ok(())
    } else {
        Err(format!("Only supported {label} files can be used here."))
    }
}

fn read_limited_text(path: &Path, extensions: &[&str], label: &str) -> Result<String, String> {
    validate_extension(path, extensions, label)?;
    let path = fs::canonicalize(path)
        .map_err(|error| format!("Unable to open the selected {label}: {error}"))?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_NATIVE_FILE_BYTES {
        return Err(format!("This {label} is too large to open safely."));
    }
    fs::read_to_string(path)
        .map_err(|error| format!("Unable to read the selected {label}: {error}"))
}

fn write_atomic_text(
    path: &Path,
    contents: &str,
    extensions: &[&str],
    label: &str,
) -> Result<(), String> {
    validate_extension(path, extensions, label)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(format!("The selected {label} folder does not exist."));
    }
    let name = path
        .file_name()
        .ok_or_else(|| format!("The selected {label} path is invalid."))?
        .to_string_lossy();
    let mut temporary = None;
    for attempt in 0..8 {
        let candidate = parent.join(format!(
            ".{name}.{}.{}.tmp",
            std::process::id(),
            now_millis().saturating_add(attempt)
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                if let Err(error) = file
                    .write_all(contents.as_bytes())
                    .and_then(|_| file.sync_all())
                {
                    let _ = fs::remove_file(&candidate);
                    return Err(format!("Unable to write the temporary {label}: {error}"));
                }
                temporary = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Unable to create the temporary {label}: {error}")),
        }
    }
    let temporary =
        temporary.ok_or_else(|| format!("Unable to reserve a temporary {label} file."))?;
    if let Err(error) = atomic_replace(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Unable to atomically replace the {label}: {error}"));
    }
    if let Ok(directory) = OpenOptions::new().read(true).open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn flush_storage(state: State<'_, AppState>) -> Result<(), String> {
    let database = state.db()?;
    blocking(move || database.checkpoint().map_err(|error| error.to_string())).await
}

#[tauri::command]
async fn capture_app_window_screenshot() -> Result<String, String> {
    let process_id = std::process::id();
    blocking(move || {
        use base64::Engine;

        let windows = xcap::Window::all().map_err(|error| error.to_string())?;
        let mut candidates = windows.into_iter().filter(|window| {
            window.pid().ok() == Some(process_id) && !window.is_minimized().unwrap_or(true)
        });
        let window = candidates
            .find(|window| window.title().is_ok_and(|title| title == "AperGlyph"))
            .or_else(|| candidates.next())
            .ok_or_else(|| {
                "The AperGlyph application window is not available for capture.".to_owned()
            })?;
        let frame = window.capture_image().map_err(|error| error.to_string())?;
        let mut output = Cursor::new(Vec::new());
        xcap::image::DynamicImage::ImageRgba8(frame)
            .write_to(&mut output, xcap::image::ImageFormat::Png)
            .map_err(|error| format!("Unable to encode the AperGlyph screenshot: {error}"))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(output.into_inner()))
    })
    .await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = args.iter().skip(1).map(PathBuf::from).find(|path| {
                path.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("wdiag"))
            }) {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut pending) = state.startup_wdiag.lock() {
                        *pending = Some(path);
                    }
                }
                let _ = app.emit("wdiag-open-pending", ());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }
        }))
        .setup(|app| {
            install_application_menu(app)?;
            let data_dir = app.path().app_data_dir().ok();
            let database_result = match data_dir.as_ref() {
                Some(directory) => std::fs::create_dir_all(directory)
                    .map_err(|error| {
                        format!(
                            "Unable to create the AperGlyph workspace folder {}: {error}",
                            directory.display()
                        )
                    })
                    .and_then(|()| {
                        WorkspaceDb::open(directory.join("workspace.sqlite3"))
                            .map(Arc::new)
                            .map_err(|error| {
                                format!("Unable to open the AperGlyph workspace database: {error}")
                            })
                    }),
                None => Err("Unable to locate the AperGlyph workspace folder.".to_owned()),
            };
            let initialization_error = database_result.as_ref().err().cloned();
            let database = database_result.ok();
            let startup_wdiag = std::env::args_os()
                .skip(1)
                .map(PathBuf::from)
                .find(|path| {
                    path.extension()
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("wdiag"))
                })
                .filter(|path| path.is_file());
            app.manage(AppState {
                database,
                initialization_error,
                data_dir,
                startup_wdiag: std::sync::Mutex::new(startup_wdiag),
            });
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("native-menu-action", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            save_document,
            save_document_thumbnail,
            load_document,
            list_documents,
            list_document_summaries,
            update_document_metadata,
            rename_document,
            duplicate_document,
            delete_document,
            clear_all_documents,
            restore_workspace_data,
            export_workspace_snapshot,
            list_snapshots,
            save_snapshot,
            load_snapshot,
            delete_snapshot,
            clear_snapshots,
            save_recovery,
            get_recovery,
            list_recovery,
            clear_recovery,
            take_startup_wdiag,
            read_wdiag_file,
            write_wdiag_file,
            read_workspace_backup_file,
            write_workspace_backup_file,
            list_templates,
            save_template,
            delete_template,
            set_preference,
            get_preference,
            list_preferences,
            delete_preference,
            get_storage_usage,
            get_data_directory,
            flush_storage,
            capture_app_window_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AperGlyph desktop");
}

fn install_application_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let new_document = MenuItem::with_id(
        app,
        "new-document",
        "New Diagram",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let open_diagram = MenuItem::with_id(
        app,
        "open-diagram",
        "Open Diagram…",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let save_as = MenuItem::with_id(
        app,
        "save-as",
        "Export Diagram As…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let backup = MenuItem::with_id(
        app,
        "workspace-backup",
        "Export Workspace Backup…",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit AperGlyph", true, None::<&str>)?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[&new_document, &open_diagram, &save_as, &backup, &quit],
    )?;

    let undo = MenuItem::with_id(app, "undo", "Undo", true, None::<&str>)?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, None::<&str>)?;
    let edit = Submenu::with_items(app, "Edit", true, &[&undo, &redo])?;
    let menu = Menu::with_items(app, &[&file, &edit])?;
    app.set_menu(menu)?;
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_export_replaces_an_existing_file() {
        let directory = std::env::temp_dir().join(format!(
            "aperglyph-native-file-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("diagram.wdiag");
        fs::write(&path, "old data").unwrap();

        write_atomic_text(&path, "new data", &["wdiag"], "diagram").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new data");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_file_actions_reject_unapproved_extensions() {
        let path = std::env::temp_dir().join("aperglyph-not-a-diagram.txt");
        assert!(validate_wdiag_path(&path, true).is_err());
    }
}
