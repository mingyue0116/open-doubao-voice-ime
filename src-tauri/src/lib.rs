#![allow(unused_variables)]
use std::io::{BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{
    LogicalSize,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl,
};

// OpenLess IME IPC module (simplified)
pub mod windows_ime_ipc;
pub mod windows_ime_protocol;

struct EngineState {
    child: Option<Child>,
    stdin: Option<Box<dyn Write + Send>>,
    is_recording: bool,
}

impl EngineState {
    fn new() -> Self { Self { child: None, stdin: None, is_recording: false } }
    fn send(&mut self, json: &str) {
        if let Some(stdin) = &mut self.stdin {
            let _ = writeln!(stdin, "{}", json);
            let _ = stdin.flush();
        }
    }
    fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.stdin = None;
    }
}

struct ConfigPath(std::path::PathBuf);
struct HotkeyState(String);

/* ───────── IME paste 去重(防 stop 时同文本被粘贴两次) ───────── */
struct PasteDedup {
    last_text: String,
    last_time: std::time::Instant,
}

static PASTE_DEDUP: std::sync::OnceLock<Mutex<PasteDedup>> = std::sync::OnceLock::new();

fn dedup_check_and_record(text: &str) -> bool {
    let m = PASTE_DEDUP.get_or_init(|| {
        Mutex::new(PasteDedup {
            last_text: String::new(),
            last_time: std::time::Instant::now()
                - std::time::Duration::from_secs(10),
        })
    });
    let mut g = m.lock().unwrap();
    let now = std::time::Instant::now();
    // 2 秒内相同文本视为重复,丢弃
    if g.last_text == text
        && now.duration_since(g.last_time) < std::time::Duration::from_millis(2000)
    {
        log::info!("IME paste dedup: skip duplicate text");
        return false;
    }
    g.last_text = text.to_string();
    g.last_time = now;
    true
}

fn resolve_config_path(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(cargo_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = std::path::PathBuf::from(&cargo_dir).parent().unwrap().join("config.json");
        if p.exists() { return p; }
    }
    if let Ok(exe) = std::env::current_exe() {
        let p = exe.parent().unwrap_or(std::path::Path::new(".")).join("config.json");
        if p.exists() { return p; }
    }
    std::path::PathBuf::from("config.json")
}

fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    // 每次 open 都先 close 旧窗口,再重建 — React 重新挂载,settingsIn 动画必播放
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.close().ok();
        std::thread::sleep(std::time::Duration::from_millis(150)); // 等窗口完全释放
    }

    // 拿主窗口位置和屏幕尺寸
    let main_pos = app.get_webview_window("main")
        .and_then(|m| m.outer_position().ok());
    let monitor = app.primary_monitor().ok().flatten();
    let (screen_w, screen_h, screen_x, screen_y) = monitor
        .map(|m| (
            m.size().width as f64,
            m.size().height as f64,
            m.position().x as f64,
            m.position().y as f64,
        ))
        .unwrap_or((1920.0, 1080.0, 0.0, 0.0));

    // 默认: settings 出现在 main 窗口**上方**,水平居中于 main
    // 这样视觉上"小球展开成面板",跟用户预期一致
    let (mut x, mut y) = if let Some(p) = main_pos {
        // 水平: 让 main 中心对齐 settings 中心
        // main 中心 = p.x + 24,settings 中心 = x + 220,  → x = p.x + 24 - 220 = p.x - 196
        let x0 = p.x as f64 - 196.0;
        // 垂直: 在 main 上方 8px
        let y0 = p.y as f64 - 300.0 - 8.0;
        (x0, y0)
    } else {
        (screen_x + (screen_w - 440.0) / 2.0, screen_y + (screen_h - 300.0) / 2.0)
    };

    // 垂直: 上方空间不够 -> 改成 main 下方
    if y < screen_y {
        if let Some(p) = main_pos {
            y = p.y as f64 + 48.0 + 8.0;
        }
    }
    // 水平: 左边超出 -> 贴屏幕左边
    if x < screen_x {
        x = screen_x + 8.0;
    }
    // 水平: 右边超出 -> 贴屏幕右边
    if x + 440.0 > screen_x + screen_w {
        x = screen_x + screen_w - 440.0 - 8.0;
    }
    // 垂直: 下边超出 -> 上移(贴 main 底部)
    if y + 300.0 > screen_y + screen_h {
        y = screen_y + screen_h - 300.0 - 8.0;
    }

    log::info!(
        "open_settings: main_pos={:?} screen=({},{},{},{}) -> settings pos=({},{})",
        main_pos.map(|p| (p.x, p.y)),
        screen_x, screen_y, screen_w, screen_h,
        x, y
    );

    tauri::WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(440.0, 300.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .position(x, y)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> { open_settings_window(&app) }

#[tauri::command]
async fn close_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") { let _ = win.close().ok(); }
    // 主窗口没被 hide 过,无需重新 show
    // 但把焦点还给主窗口,这样下次按快捷键能立即响应
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus().ok();
    }
    Ok(())
}

#[tauri::command]
async fn start_engine(app: AppHandle) -> Result<(), String> {
    // 第一次按快捷键才启动 Python 引擎(避免冷启动慢)
    let need_spawn = {
        let state = app.state::<Mutex<EngineState>>();
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.child.is_none()
    };

    if need_spawn {
        spawn_engine(&app)?;
        // 把 config 推给刚启动的引擎
        {
            let cfg_state = app.state::<ConfigPath>();
            let cfg_content = std::fs::read_to_string(&cfg_state.0).unwrap_or_default();
            if let Ok(cfg_value) = serde_json::from_str::<serde_json::Value>(&cfg_content) {
                if let Ok(mut guard) = app.state::<Mutex<EngineState>>().lock() {
                    let msg = serde_json::json!({"cmd": "config_batch", "config": cfg_value}).to_string();
                    guard.send(&msg);
                }
            }
        }
    }

    let state = app.state::<Mutex<EngineState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.is_recording = true;
    guard.send(r#"{"cmd":"start"}"#);
    Ok(())
}

#[tauri::command]
async fn stop_engine(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<EngineState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.is_recording = false;
    guard.send(r#"{"cmd":"stop"}"#);
    Ok(())
}

#[tauri::command]
async fn send_config(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let state = app.state::<Mutex<EngineState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let msg = serde_json::json!({"cmd": "config", "key": key, "value": value}).to_string();
    guard.send(&msg);
    Ok(())
}

#[tauri::command]
async fn get_config(app: AppHandle) -> Result<serde_json::Value, String> {
    let cfg_path = app.state::<ConfigPath>();
    let path = &cfg_path.0;
    if !path.exists() { return Ok(serde_json::json!({})); }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_config(app: AppHandle, config: serde_json::Value) -> Result<(), String> {
    let cfg_path = app.state::<ConfigPath>();
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&cfg_path.0, &content).map_err(|e| e.to_string())?;
    let state = app.state::<Mutex<EngineState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let msg = serde_json::json!({"cmd": "config_batch", "config": config}).to_string();
    guard.send(&msg);
    Ok(())
}

/// 内部函数: 注册全局快捷键(失败时回滚旧的,并返回错误)
fn do_register_hotkey(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let hk_state = app.state::<Mutex<HotkeyState>>();

    // 先解绑旧的
    {
        let guard = hk_state.lock().map_err(|e| e.to_string())?;
        if !guard.0.is_empty() {
            let _ = app.global_shortcut().unregister(guard.0.as_str());
        }
    }

    // 尝试注册新快捷键
    match app.global_shortcut().register(shortcut) {
        Ok(()) => {
            let mut guard = hk_state.lock().map_err(|e| e.to_string())?;
            guard.0 = shortcut.to_string();
            log::info!("hotkey registered: {}", shortcut);
            Ok(())
        }
        Err(e) => {
            log::error!("hotkey register failed for '{}': {}", shortcut, e);
            // 失败: 把旧快捷键重新注册回来
            let old = {
                let g = hk_state.lock().ok();
                g.map(|x| x.0.clone()).unwrap_or_default()
            };
            if !old.is_empty() && old != shortcut {
                let _ = app.global_shortcut().register(old.as_str());
            }
            Err(format!("快捷键 \"{}\" 注册失败: {}", shortcut, e))
        }
    }
}

#[tauri::command]
async fn register_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    do_register_hotkey(&app, &shortcut)
}

#[tauri::command]
async fn set_capsule_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        // 记录旧的中心点(防止窗口"跳动")
        let old_center = match (win.outer_position(), win.outer_size()) {
            (Ok(pos), Ok(sz)) => Some((pos.x + sz.width as i32 / 2, pos.y + sz.height as i32 / 2)),
            _ => None,
        };
        // 改大小
        let _ = win.set_size(LogicalSize::new(width, height));
        // 把中心移回原位
        if let Some((cx, cy)) = old_center {
            let scale = win.scale_factor().unwrap_or(1.0);
            let pw = (width * scale) as i32;
            let ph = (height * scale) as i32;
            let _ = win.set_position(tauri::PhysicalPosition::new(cx - pw / 2, cy - ph / 2));
        }
    }
    Ok(())
}

// IME text submission via named pipe
#[tauri::command]
async fn ime_submit_text(app: AppHandle, text: String, session_id: String) -> Result<String, String> {
    if !dedup_check_and_record(&text) {
        return Ok("Duplicate".to_string());
    }
    let state = app.state::<Mutex<windows_ime_ipc::WindowsImeIpcServer>>();
    let guard = state.lock().map_err(|e| e.to_string())?;
    let req = windows_ime_ipc::ImeSubmitRequest {
        session_id,
        text,
        created_at: chrono::Utc::now().to_rfc3339(),
        target: None,
    };
    let status = guard.submit_text(&req).map_err(|e| e.to_string())?;
    Ok(format!("{:?}", status))
}

// 用系统默认浏览器打开 URL
#[tauri::command]
async fn open_url(_app: AppHandle, url: String) -> Result<(), String> {
    // Windows: 用 rundll32 调用 url.dll,这是最稳的"系统默认浏览器打开 URL"方法
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    Err("当前平台不支持打开链接".to_string())
}

fn spawn_engine(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<EngineState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.kill();

    let engine_path = {
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(cargo_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let p = std::path::PathBuf::from(&cargo_dir).parent().unwrap().join("engine/voice_engine.py");
            candidates.push(p);
        }
        if let Ok(exe) = std::env::current_exe() {
            let p = exe.parent().unwrap_or(std::path::Path::new(".")).join("engine/voice_engine.py");
            if !candidates.contains(&p) { candidates.push(p); }
        }
        let p = std::path::PathBuf::from("engine/voice_engine.py");
        if !candidates.contains(&p) { candidates.push(p); }
        candidates.into_iter().find(|p| p.exists())
            .unwrap_or_else(|| std::path::PathBuf::from("engine/voice_engine.py"))
    };

    if !engine_path.exists() {
        log::error!("engine not found: {:?}", engine_path);
        return Err(format!("engine not found: {:?}", engine_path));
    }
    log::info!("spawning engine: {:?}", engine_path);

    let mut cmd = Command::new("python");
    cmd.arg(&engine_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null()).env("PYTHONIOENCODING", "utf-8");

    // Windows: 禁止 Python 弹出控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("spawn: {}", e))?;

    let stdin = child.stdin.take().map(|s| Box::new(s) as Box<dyn Write + Send>);
    let stdout = child.stdout.take();

    if let Some(stdout) = stdout {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let mut reader = BufReader::new(stdout);
            let ime_server = windows_ime_ipc::WindowsImeIpcServer::new();
            let mut buf = Vec::<u8>::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break, // EOF
                    Ok(_) => {}
                    Err(e) => {
                        log::warn!("engine stdout read error: {}", e);
                        continue;
                    }
                }
                let line = match String::from_utf8(buf.clone()) {
                    Ok(s) => s.trim().to_string(),
                    Err(_) => {
                        log::warn!("engine stdout: invalid UTF-8, skipping");
                        continue;
                    }
                };
                if line.is_empty() { continue; }
                
                // Check for IME paste messages from Python
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                    if msg.get("type").and_then(|v| v.as_str()) == Some("paste") {
                        if let Some(text) = msg.get("text").and_then(|v| v.as_str()) {
                            if !dedup_check_and_record(text) {
                                continue; // 2s 内同文本已提交过,跳过
                            }
                            let req = windows_ime_ipc::ImeSubmitRequest {
                                session_id: uuid::Uuid::new_v4().to_string(),
                                text: text.to_string(),
                                created_at: chrono::Utc::now().to_rfc3339(),
                                target: None,
                            };
                            match ime_server.submit_text(&req) {
                                Ok(status) => log::info!("IME submit: {:?}", status),
                                Err(e) => log::error!("IME submit failed: {}", e),
                            }
                            continue;
                        }
                    }
                }
                
                let _ = app_handle.emit("engine-message", &line);
            }
            log::info!("engine stdout reader exited");
        });
    }

    guard.child = Some(child);
    guard.stdin = stdin;
    log::info!("engine spawned");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(EngineState::new()))
        .manage(Mutex::new(HotkeyState(String::new())))
        .manage(Mutex::new(windows_ime_ipc::WindowsImeIpcServer::new()))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, e| {
                    if e.state != tauri_plugin_global_shortcut::ShortcutState::Pressed { return; }

                    // 关键: Python 引擎是延迟启动的,首次按快捷键时 stdin 是 None
                    // 先 spawn engine 并推 config,再 send start/stop
                    {
                        let state = app.state::<Mutex<EngineState>>();
                        let guard = match state.lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        if guard.child.is_none() {
                            drop(guard);
                            if let Err(err) = spawn_engine(app) {
                                log::error!("hotkey: spawn_engine failed: {}", err);
                                let _ = app.emit("engine-error", &format!("启动引擎失败: {}", err));
                                return;
                            }
                            // 推 config 给新启动的引擎
                            let cfg_state = app.state::<ConfigPath>();
                            let cfg_content = std::fs::read_to_string(&cfg_state.0).unwrap_or_default();
                            if let Ok(cfg_value) = serde_json::from_str::<serde_json::Value>(&cfg_content) {
                                if let Ok(mut g) = state.lock() {
                                    let msg = serde_json::json!({"cmd": "config_batch", "config": cfg_value}).to_string();
                                    g.send(&msg);
                                }
                            }
                        }
                    }

                    let state2 = app.state::<Mutex<EngineState>>();
                    let mut guard2 = state2.lock().unwrap();
                    if guard2.is_recording {
                        guard2.is_recording = false;
                        guard2.send(r#"{"cmd":"stop"}"#);
                    } else {
                        guard2.is_recording = true;
                        guard2.send(r#"{"cmd":"start"}"#);
                    }
                    drop(guard2);
                    let _ = app.emit("toggle-recording", ());
                })
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                let _ = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                );
            }

            let cfg_path = resolve_config_path(app.handle());
            log::info!("config path: {:?}", cfg_path);
            app.manage(ConfigPath(cfg_path));

            let m = MenuBuilder::new(app)
                .item(&MenuItemBuilder::with_id("show", "Show Capsule").build(app)?)
                .item(&MenuItemBuilder::with_id("settings", "Settings").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&m)
                .tooltip("开源豆包语音输入法")
                .on_menu_event(|a, e| match e.id().as_ref() {
                    "show" => {
                        if let Some(w) = a.get_webview_window("main") {
                            let _ = w.show().ok();
                            let _ = w.set_focus().ok();
                        }
                    }
                    "settings" => { let _ = open_settings_window(a); }
                    "quit" => std::process::exit(0),
                    _ => {}
                })
                .build(app)?;

            // 注: do_register_hotkey 内部自己 use GlobalShortcutExt,这里不用再 import
            let cfg_state = app.state::<ConfigPath>();
            let hotkey_str = std::fs::read_to_string(&cfg_state.0)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("hotkey")?.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Ctrl+Shift+F8".to_string());
            log::info!("registering hotkey: {}", hotkey_str);
            // 启动时也用统一的 do_register_hotkey(失败时回滚旧快捷键 + emit 事件给前端)
            if let Err(e) = do_register_hotkey(app.handle(), &hotkey_str) {
                log::error!("initial hotkey register failed: {}", e);
                let _ = app.handle().emit("hotkey-error", &e);
            }

            // 注意: Python 引擎改为延迟启动(首次按快捷键才 spawn)
            // 这样能省掉冷启动时 import numpy/sounddevice/websockets 的 2-3 秒

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_settings,
            close_settings,
            start_engine,
            stop_engine,
            send_config,
            get_config,
            save_config,
            register_hotkey,
            set_capsule_size,
            ime_submit_text,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
