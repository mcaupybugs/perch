use serde::{Deserialize, Serialize};
mod capture;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// Items older than this are dropped automatically — Perch is a scratchpad, not an archive.
const TTL_MS: u64 = 24 * 60 * 60 * 1000;
/// How long to wait for the front app to put the selection on the clipboard after the copy keystroke.
const COPY_WAIT: Duration = Duration::from_millis(450);
/// The Accessibility prompt is shown at most once per launch.
static ASKED_PERMISSION: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize, Deserialize)]
pub struct Item {
    id: String,
    title: String,
    created_at: u64,
    text: String,
    html: Option<String>,
    /// Pinned items survive the 24h cleanup and "Clear".
    #[serde(default)]
    pinned: bool,
    /// Per-row review state written by the card (statuses, notes, order, progress).
    #[serde(default)]
    review: Option<serde_json::Value>,
}

struct Store {
    items: Mutex<Vec<Item>>,
    path: PathBuf,
}

impl Store {
    fn load(path: PathBuf) -> Self {
        let items: Vec<Item> = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let store = Store { items: Mutex::new(items), path };
        store.prune();
        store
    }

    fn prune(&self) {
        let cutoff = now_ms().saturating_sub(TTL_MS);
        self.items.lock().unwrap().retain(|i| i.pinned || i.created_at >= cutoff);
    }

    fn save(&self) {
        let items = self.items.lock().unwrap();
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec(&*items) {
            let _ = std::fs::write(&self.path, json);
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Builds a short title from the first meaningful line of the copied text.
fn make_title(text: &str) -> String {
    let is_rule = |l: &str| l.chars().all(|c| "|-:+=─━│┃┌┐└┘├┤┬┴┼╭╮╰╯ \t".contains(c));
    let first = text.lines().map(str::trim).find(|l| !l.is_empty() && !is_rule(l));
    let Some(line) = first else {
        return "Untitled".into();
    };
    let looks_like_table = line.starts_with('|') || line.starts_with('│') || line.starts_with('┃');
    let cleaned: String = if looks_like_table {
        let cells: Vec<&str> = line
            .split(|c| c == '|' || c == '│' || c == '┃')
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .collect();
        format!("Table: {}", cells.join(", "))
    } else {
        line.trim_start_matches(|c| c == '#' || c == '>' || c == '*' || c == '-' || c == ' ')
            .to_string()
    };
    let mut title: String = cleaned.chars().take(60).collect();
    if cleaned.chars().count() > 60 {
        title.push('…');
    }
    title
}

fn add(app: &AppHandle, store: &Store, text: String, html: Option<String>) -> Option<Item> {
    if text.trim().is_empty() && html.as_deref().map_or(true, |h| h.trim().is_empty()) {
        return None;
    }
    let created_at = now_ms();
    let item = Item {
        id: format!("{created_at}"),
        title: make_title(&text),
        created_at,
        text,
        html: html.filter(|h| !h.trim().is_empty()),
        pinned: false,
        review: None,
    };
    store.prune();
    store.items.lock().unwrap().insert(0, item.clone());
    store.save();
    let _ = app.emit("items-changed", ());
    Some(item)
}

/// Reads both the plain-text and HTML flavours of the system clipboard.
fn read_clipboard() -> Option<(String, Option<String>)> {
    let mut cb = arboard::Clipboard::new().ok()?;
    let text = cb.get_text().unwrap_or_default();
    let html = cb.get().html().ok();
    Some((text, html))
}

/// Copies the selection in the front app, waits for it to reach the clipboard, then saves it.
/// With nothing selected the clipboard doesn't change, so whatever was already copied is saved.
fn capture_selection(app: AppHandle) {
    std::thread::spawn(move || {
        let before = read_clipboard();
        match capture::send_copy() {
            Ok(()) => {
                let deadline = Instant::now() + COPY_WAIT;
                while Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(25));
                    if read_clipboard() != before {
                        // Let the app finish writing every flavour (HTML lands just after text).
                        std::thread::sleep(Duration::from_millis(40));
                        break;
                    }
                }
            }
            Err(capture::CopyError::NeedsPermission) => {
                if !ASKED_PERMISSION.swap(true, Ordering::Relaxed) {
                    capture::request_permission();
                }
                let _ = app.emit("copy-permission-needed", ());
            }
            Err(capture::CopyError::Failed) => {}
        }
        let store = app.state::<Store>();
        if let Some((text, html)) = read_clipboard() {
            if let Some(item) = add(&app, &store, text, html) {
                let _ = app.emit("item-saved", item);
            }
        }
    });
}

#[tauri::command]
fn list_items(store: State<Store>) -> Vec<Item> {
    store.prune();
    store.items.lock().unwrap().clone()
}

#[tauri::command]
fn get_item(store: State<Store>, id: String) -> Option<Item> {
    store.items.lock().unwrap().iter().find(|i| i.id == id).cloned()
}

#[tauri::command]
fn add_item(app: AppHandle, store: State<Store>, text: String, html: Option<String>) -> Option<Item> {
    add(&app, &store, text, html)
}

#[tauri::command]
fn save_clipboard(app: AppHandle, store: State<Store>) -> Option<Item> {
    let (text, html) = read_clipboard()?;
    add(&app, &store, text, html)
}

#[tauri::command]
fn delete_item(app: AppHandle, store: State<Store>, id: String) {
    store.items.lock().unwrap().retain(|i| i.id != id);
    store.save();
    let _ = app.emit("items-changed", ());
}

/// Applies `f` to one item, then persists and notifies every window.
fn update_item(app: &AppHandle, store: &Store, id: &str, f: impl FnOnce(&mut Item)) {
    if let Some(item) = store.items.lock().unwrap().iter_mut().find(|i| i.id == id) {
        f(item);
    }
    store.save();
    let _ = app.emit("items-changed", ());
}

#[tauri::command]
fn set_pinned(app: AppHandle, store: State<Store>, id: String, pinned: bool) {
    update_item(&app, &store, &id, |i| i.pinned = pinned);
}

#[tauri::command]
fn set_review(app: AppHandle, store: State<Store>, id: String, review: serde_json::Value) {
    update_item(&app, &store, &id, |i| i.review = Some(review));
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut cb| cb.set_text(text))
        .map_err(|e| e.to_string())
}

/// Clears everything except pinned items.
#[tauri::command]
fn clear_items(app: AppHandle, store: State<Store>) {
    store.items.lock().unwrap().retain(|i| i.pinned);
    store.save();
    let _ = app.emit("items-changed", ());
}

/// Cursor position relative to the calling window, in logical px — lets Pip's eyes follow it.
#[tauri::command]
fn cursor_in_window(window: tauri::WebviewWindow) -> Option<(f64, f64)> {
    let cursor = window.cursor_position().ok()?;
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(((cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale))
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Lifts the pill above the menu bar so it can sit in the notch, and keeps it on every Space.
#[cfg(target_os = "macos")]
fn float_over_menu_bar(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};
    let Ok(ptr) = window.ns_window() else { return };
    // NSMainMenuWindowLevel (24) + 1 = NSStatusWindowLevel.
    const STATUS_WINDOW_LEVEL: isize = 25;
    // canJoinAllSpaces | stationary | fullScreenAuxiliary
    const BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 8);
    unsafe {
        let ns_window = &*(ptr as *const AnyObject);
        let _: () = msg_send![ns_window, setLevel: STATUS_WINDOW_LEVEL];
        let _: () = msg_send![ns_window, setCollectionBehavior: BEHAVIOR];
        let _: () = msg_send![ns_window, setHasShadow: false];
    }
}

/// What the top of the pill's screen looks like, so the pill can stay out of the way of tabs.
#[derive(Serialize)]
struct ScreenInfo {
    /// The screen has a camera notch the pill can hide around (MacBooks since 2021).
    notch: bool,
    /// Height of the macOS menu bar on this screen in points; 0 where there isn't one (Windows).
    menu_bar: f64,
}

#[tauri::command]
fn screen_info(window: tauri::WebviewWindow) -> ScreenInfo {
    #[cfg(target_os = "macos")]
    return mac_screen_info(&window);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        ScreenInfo { notch: false, menu_bar: 0.0 }
    }
}

#[cfg(target_os = "macos")]
fn mac_screen_info(window: &tauri::WebviewWindow) -> ScreenInfo {
    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{msg_send, sel};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct EdgeInsets {
        top: f64,
        left: f64,
        bottom: f64,
        right: f64,
    }
    unsafe impl Encode for EdgeInsets {
        const ENCODING: Encoding =
            Encoding::Struct("NSEdgeInsets", &[f64::ENCODING, f64::ENCODING, f64::ENCODING, f64::ENCODING]);
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct(
            "CGRect",
            &[
                Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]),
                Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]),
            ],
        );
    }

    const FALLBACK: ScreenInfo = ScreenInfo { notch: false, menu_bar: 24.0 };
    let Ok(ptr) = window.ns_window() else { return FALLBACK };
    unsafe {
        let ns_window = &*(ptr as *const AnyObject);
        let mut screen: *const AnyObject = msg_send![ns_window, screen];
        if screen.is_null() {
            let Some(cls) = AnyClass::get(c"NSScreen") else { return FALLBACK };
            screen = msg_send![cls, mainScreen];
        }
        let Some(screen) = screen.as_ref() else { return FALLBACK };

        // safeAreaInsets (macOS 12+) is non-zero at the top only on screens with a notch.
        let has_insets: Bool = msg_send![screen, respondsToSelector: sel!(safeAreaInsets)];
        let notch = has_insets.as_bool() && {
            let insets: EdgeInsets = msg_send![screen, safeAreaInsets];
            insets.top > 0.0
        };
        // The menu bar is the strip between the screen's top and the top of its usable area.
        let frame: Rect = msg_send![screen, frame];
        let visible: Rect = msg_send![screen, visibleFrame];
        let menu_bar = (frame.y + frame.height) - (visible.y + visible.height);
        ScreenInfo { notch, menu_bar: if menu_bar > 0.0 { menu_bar } else { FALLBACK.menu_bar } }
    }
}

/// Copies the current selection and saves it (or saves the clipboard if nothing is selected).
fn capture_shortcut() -> Shortcut {
    // Cmd+Ctrl+V on macOS, Ctrl+Alt+V elsewhere — avoids "paste as plain text" bindings.
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::CONTROL;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL | Modifiers::ALT;
    Shortcut::new(Some(mods), Code::KeyV)
}

/// Brings see-through (click-through) cards back, since they can't be clicked.
fn solid_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::CONTROL;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL | Modifiers::ALT;
    Shortcut::new(Some(mods), Code::KeyT)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([capture_shortcut(), solid_shortcut()])
                .expect("valid shortcuts")
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if *shortcut == solid_shortcut() {
                        let _ = app.emit("solid-cards", ());
                        return;
                    }
                    capture_selection(app.clone());
                })
                .build(),
        )
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("items.json");
            app.manage(Store::load(path));

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(pill) = app.get_webview_window("pill") {
                #[cfg(target_os = "macos")]
                float_over_menu_bar(&pill);
                let _ = pill.set_visible_on_all_workspaces(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_items,
            get_item,
            add_item,
            save_clipboard,
            delete_item,
            clear_items,
            set_pinned,
            set_review,
            copy_text,
            cursor_in_window,
            screen_info,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
