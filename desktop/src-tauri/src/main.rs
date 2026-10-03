//! AncesTree's desktop shell: one window, an icon by the clock,
//! start at sign-in, updates, and the engine it starts, watches and stops.
//!
//! The engine (desktop/engine) serves the app and its API on its own Neo4j. It tells the
//! shell how it's getting on, one JSON line at a time, and stops when its input closes. Each
//! start, the shell makes a secret that only the window gets, so nothing else on this
//! computer, a web page included, can reach the engine (ancestree/desktop/guard.py).
//!
//! The engine opens one family of those on the computer (0.4.0). Opening another, from the
//! app, it says "restart": the shell shows the loading page, stops it, and starts it again,
//! on the other family's folders. Each round with the family folder, it says how things stand,
//! for the icon's tooltip; and the icon's menu has Sync now.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{
    AppHandle, Emitter, Listener, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

/// Measures the 2,000-person sample in this system's web view; only when asked for.
const BENCH: &str = include_str!("bench.js");

/// How the app starts at sign-in: to the icon by the clock, with no window.
const HIDDEN: &str = "--hidden";

/// The engine while it runs: its input (closing it stops the engine), the process, the
/// secret the window enters with, and where the window finds it once it's ready. Each start is
/// counted, so what an engine stopping for another family says last is heard as old news.
#[derive(Default)]
struct Engine {
    input: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    #[cfg(windows)]
    job: Mutex<Option<job::Job>>,
    secret: String,
    origin: Mutex<Option<String>>,
    started: AtomicU64,
}

/// The loading page's address, as the window first had it: shown again while the engine
/// starts on another family.
#[derive(Default)]
struct LoadingPage(Mutex<Option<Url>>);

/// 32 random bytes, made afresh at each start, as hex. The tests give their own, in
/// ANCESTREE_SESSION, to reach the engine as the window does.
fn session_secret() -> String {
    if let Ok(secret) = std::env::var("ANCESTREE_SESSION") {
        if secret.len() >= 32 {
            return secret;
        }
    }
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("randomness from the system");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn bench_mode() -> bool {
    std::env::var("ANCESTREE_BENCH").is_ok_and(|value| value == "1")
}

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .expect("the app's data folder")
}

/// A line in the shell's log, beside the engine's.
fn log(app: &AppHandle, message: &str) {
    let folder = data_dir(app).join("logs");
    let _ = fs::create_dir_all(&folder);
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(folder.join("shell.log"))
    {
        let _ = writeln!(file, "{seconds} {message}");
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn engine_program(app: &AppHandle) -> PathBuf {
    if let Ok(path) = std::env::var("ANCESTREE_ENGINE") {
        return PathBuf::from(path); // for trying an engine built elsewhere
    }
    let name = if cfg!(windows) {
        "ancestree-engine.exe"
    } else {
        "ancestree-engine"
    };
    // The AppImage keeps the engine in usr/share (tauri.linux.conf.json). In usr/lib, with the
    // app's other resources, linuxdeploy, which makes the AppImage, takes the engine's own
    // libraries for the app's and fails to place them.
    #[cfg(target_os = "linux")]
    if let Some(appdir) = std::env::var_os("APPDIR") {
        return PathBuf::from(appdir)
            .join("usr/share/AncesTree/engine")
            .join(name);
    }
    app.path()
        .resource_dir()
        .expect("the app's resources")
        .join("engine")
        .join(name)
}

fn start_engine(app: &AppHandle) -> std::io::Result<()> {
    let data = data_dir(app);
    fs::create_dir_all(data.join("logs"))?;
    let errors = File::create(data.join("logs").join("engine.log"))?;
    let engine = app.state::<Engine>();
    let mut command = Command::new(engine_program(app));
    command
        .arg("--data")
        .arg(&data)
        .arg("--managed")
        .env("ANCESTREE_SESSION", &engine.secret)
        .env(
            "ANCESTREE_APP_VERSION",
            app.package_info().version.to_string(),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(errors));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0); // the engine and Neo4j, stopped together if need be
    }
    let mut child = command.spawn()?;
    let start = engine.started.fetch_add(1, Ordering::SeqCst) + 1;
    #[cfg(windows)]
    {
        // Whatever happens to the shell, Windows ends the engine and Neo4j with it.
        let job = job::Job::kill_on_close()?;
        job.assign(&child)?;
        *engine.job.lock().unwrap() = Some(job);
    }
    let output = child.stdout.take().expect("the engine's output");
    *engine.input.lock().unwrap() = child.stdin.take();
    *engine.child.lock().unwrap() = Some(child);

    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if !line.contains("\"stage\": \"download\"") {
                log(&app, &format!("engine: {line}"));
            }
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if app.state::<Engine>().started.load(Ordering::SeqCst) != start {
                continue; // an engine that stopped for another family: old news
            }
            tell_page(&app, event.clone());
            match event["stage"].as_str() {
                Some("ready") => {
                    let port = event["port"].as_u64().unwrap_or_default();
                    let origin = format!("http://127.0.0.1:{port}");
                    let page = if bench_mode() {
                        "/sample?people=2000"
                    } else {
                        "/"
                    };
                    let engine = app.state::<Engine>();
                    *engine.origin.lock().unwrap() = Some(origin.clone());
                    // The window enters with the secret, and is given it as a cookie.
                    let enter = Url::parse_with_params(
                        &format!("{origin}/desktop/enter"),
                        &[("secret", engine.secret.as_str()), ("to", page)],
                    );
                    if let (Some(window), Ok(url)) = (app.get_webview_window("main"), enter) {
                        let _ = window.navigate(url);
                    }
                }
                Some("bench") if bench_mode() => {
                    log(&app, "bench finished: quitting");
                    quit(&app);
                }
                // From the app's pages, through the engine.
                Some("check-updates") => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move { check_now(&app).await });
                }
                Some("restart-to-update") => {
                    let waiting = app.state::<Pending>().0.lock().unwrap().take();
                    if let Some((update, bytes)) = waiting {
                        // Not from this thread, which reads the engine's output while it stops.
                        let app = app.clone();
                        std::thread::spawn(move || install(&app, &update, &bytes));
                    }
                }
                // Another family, opened in the app (0.4.0).
                Some("restart") => {
                    let family = event["family"].as_str().unwrap_or_default().to_owned();
                    let app = app.clone();
                    std::thread::spawn(move || restart_engine(&app, &family));
                }
                // How the family stands with its family folder, each round (0.4.0).
                Some("in-step") => {
                    let text = event["text"].as_str();
                    if let (Some(tray), Some(text)) = (app.tray_by_id("main"), text) {
                        let _ = tray.set_tooltip(Some(text));
                    }
                }
                _ => {}
            }
        }
        log(&app, "engine: output closed");
        if app.state::<Engine>().started.load(Ordering::SeqCst) == start {
            tell_page(&app, serde_json::json!({ "stage": "exited" }));
        }
    });
    Ok(())
}

/// Another family, opened in the app (0.4.0): the loading page while the engine stops, then
/// the engine again, which opens the family the families list now names.
fn restart_engine(app: &AppHandle, family: &str) {
    log(app, "another family opened: the engine starts again");
    tell_page(
        app,
        serde_json::json!({ "stage": "opening", "family": family }),
    );
    let loading = app.state::<LoadingPage>().0.lock().unwrap().clone();
    if let (Some(window), Some(url)) = (app.get_webview_window("main"), loading) {
        let _ = window.navigate(url);
    }
    *app.state::<Engine>().origin.lock().unwrap() = None;
    // What the stopping engine says from now on, its end above all, is old news.
    app.state::<Engine>().started.fetch_add(1, Ordering::SeqCst);
    stop_engine(app);
    if let Err(error) = start_engine(app) {
        log(app, &format!("the engine couldn't start again: {error}"));
        tell_page(app, serde_json::json!({ "stage": "exited" }));
    }
}

/// Close the engine's input, which tells it to stop Neo4j and go; kill it only if it hangs.
fn stop_engine(app: &AppHandle) {
    let engine = app.state::<Engine>();
    if let Some(mut input) = engine.input.lock().unwrap().take() {
        let _ = input.write_all(b"stop\n");
    }
    let Some(mut child) = engine.child.lock().unwrap().take() else {
        return;
    };
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(45) {
        if let Ok(Some(status)) = child.try_wait() {
            log(
                app,
                &format!(
                    "engine stopped in {:.1}s ({status})",
                    started.elapsed().as_secs_f32()
                ),
            );
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    log(app, "engine didn't stop within 45s: killed");
}

/// The window and the icon go at once; Neo4j takes some seconds more to close its connections.
fn quit(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_visible(false);
    }
    stop_engine(app);
    app.exit(0);
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// A new version, downloaded and checked against its signature, waiting for a restart.
#[derive(Default)]
struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

/// The updater, asking the public repository (tauri.conf.json), or the tests' own server in
/// ANCESTREE_UPDATE_URL. It installs nothing that isn't signed with the key the app knows.
fn updater(app: &AppHandle, timeout: Duration) -> Result<Updater, BoxError> {
    let before_exit = app.clone();
    let mut builder = app
        .updater_builder()
        .timeout(timeout)
        .on_before_exit(move || {
            // Windows installs by running the installer, which needs the engine gone.
            log(
                &before_exit,
                "installing an update: stopping the engine first",
            );
            stop_engine(&before_exit);
        });
    if let Ok(address) = std::env::var("ANCESTREE_UPDATE_URL") {
        builder = builder.endpoints(vec![Url::parse(&address)?])?;
    }
    Ok(builder.build()?)
}

/// A new version, if there is one: asked for quickly, so an offline start isn't held up, then
/// fetched with time to spare. The updater refuses it unless its signature holds.
async fn fetch_update(app: &AppHandle) -> Result<Option<(Update, Vec<u8>)>, BoxError> {
    if updater(app, Duration::from_secs(8))?
        .check()
        .await?
        .is_none()
    {
        return Ok(None);
    }
    let Some(update) = updater(app, Duration::from_secs(600))?.check().await? else {
        return Ok(None);
    };
    let bytes = update.download(|_, _| {}, || {}).await?;
    Ok(Some((update, bytes)))
}

/// Install a downloaded version and start it. On Windows the installer takes over and ends
/// this app; elsewhere the app is replaced where it stands, and starts again.
fn install(app: &AppHandle, update: &Update, bytes: &[u8]) {
    log(app, &format!("installing {}", update.version));
    if let Err(error) = update.install(bytes) {
        log(app, &format!("the update couldn't be installed: {error}"));
        return;
    }
    log(app, "update installed: restarting");
    stop_engine(app);
    app.restart();
}

/// Updating on restart: at each start, before the engine, a new version is installed.
/// Offline, or with nothing new, the app starts as it is.
async fn update_at_start(app: &AppHandle) {
    let found = async {
        let Some(update) = updater(app, Duration::from_secs(8))?.check().await? else {
            return Ok::<_, BoxError>(None);
        };
        tell_page(
            app,
            serde_json::json!({ "stage": "updating", "version": update.version }),
        );
        let bytes =
            updater(app, Duration::from_secs(600))?
                .check()
                .await?
                .map(|update| async move {
                    let bytes = update.download(|_, _| {}, || {}).await?;
                    Ok::<_, BoxError>((update, bytes))
                });
        match bytes {
            Some(fetching) => Ok(Some(fetching.await?)),
            None => Ok(None),
        }
    }
    .await;
    match found {
        Ok(Some((update, bytes))) => install(app, &update, &bytes),
        Ok(None) => log(app, "no update"),
        Err(error) => log(app, &format!("update check failed: {error}")),
    }
}

/// While the app runs, now and then or when asked: a new version is fetched in the
/// background, and the engine tells the app's pages, which offer to restart into it.
async fn check_now(app: &AppHandle) {
    let waiting = app
        .state::<Pending>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|(update, _)| offer(update));
    if let Some(line) = waiting {
        tell_engine(app, &line); // already here: say so again
        return;
    }
    match fetch_update(app).await {
        Ok(Some((update, bytes))) => {
            log(
                app,
                &format!("update {} fetched: offered in the app", update.version),
            );
            let line = offer(&update);
            *app.state::<Pending>().0.lock().unwrap() = Some((update, bytes));
            tell_engine(app, &line);
        }
        Ok(None) => {
            log(app, "no update");
            tell_engine(app, "update-none");
        }
        Err(error) => {
            log(app, &format!("update check failed: {error}"));
            tell_engine(app, &format!("update-failed {error}"));
        }
    }
}

fn offer(update: &Update) -> String {
    let notes = update.body.clone().unwrap_or_default();
    format!(
        "update {}",
        serde_json::json!({ "version": update.version, "notes": notes })
    )
}

/// The latest word for the starting page, said again once the page listens: a word sent
/// before that is otherwise lost, and "Updating…" may be the only one it gets.
#[derive(Default)]
struct Latest(Mutex<Option<Value>>);

fn tell_page(app: &AppHandle, event: Value) {
    *app.state::<Latest>().0.lock().unwrap() = Some(event.clone());
    let _ = app.emit("engine", event);
}

/// A line on the engine's input, for it to pass on to the app's pages.
fn tell_engine(app: &AppHandle, line: &str) {
    if let Some(input) = app.state::<Engine>().input.lock().unwrap().as_mut() {
        let _ = writeln!(input, "{line}");
        let _ = input.flush();
    }
}

/// The first look ten minutes after the start, then one a day.
fn keep_checking(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(10 * 60));
        loop {
            tauri::async_runtime::block_on(check_now(&app));
            std::thread::sleep(Duration::from_secs(24 * 60 * 60));
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let starts = app.autolaunch().is_enabled().unwrap_or(false);
    let open = MenuItem::with_id(app, "open", "Open AncesTree", true, None::<&str>)?;
    let at_sign_in = CheckMenuItem::with_id(
        app,
        "sign-in",
        "Start when I sign in",
        true,
        starts,
        None::<&str>,
    )?;
    let sync = MenuItem::with_id(app, "sync", "Sync now", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit AncesTree", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&open, &sync, &at_sign_in, &updates, &separator, &quit_item],
    )?;
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("the app's icon").clone())
        .tooltip("AncesTree")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "sign-in" => {
                let wanted = !app.autolaunch().is_enabled().unwrap_or(false);
                let done = start_at_sign_in(app, wanted);
                log(app, &format!("start at sign-in: {wanted} ({done:?})"));
                let _ = at_sign_in.set_checked(app.autolaunch().is_enabled().unwrap_or(false));
            }
            // The family folder, in step now rather than within the minute (0.4.0).
            "sync" => tell_engine(app, "sync"),
            "updates" => {
                show_main(app); // where the answer shows
                let app = app.clone();
                tauri::async_runtime::spawn(async move { check_now(&app).await });
            }
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn start_at_sign_in(app: &AppHandle, on: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if !on {
        return autolaunch.disable().map_err(|error| error.to_string());
    }
    autolaunch.enable().map_err(|error| error.to_string())?;
    #[cfg(windows)]
    quote_run_entry(app).map_err(|error| error.to_string())?;
    Ok(())
}

/// Windows reads the entry as a command line: unless the program's path is in quotes, a
/// space in it (in a user's name, say) keeps the app from starting. Done at every start too,
/// so the entry always names this copy of the app.
#[cfg(windows)]
fn quote_run_entry(app: &AppHandle) -> std::io::Result<()> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
    let run = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_QUERY_VALUE | KEY_SET_VALUE,
    )?;
    let name = &app.package_info().name;
    if run.get_raw_value(name).is_err() {
        return Ok(()); // start at sign-in is off
    }
    let program = std::env::current_exe()?;
    run.set_value(name, &format!("\"{}\" {HIDDEN}", program.display()))
}

/// The first time, start at sign-in is switched on (the study's "on unless unticked").
fn first_run(app: &AppHandle) {
    let marker = data_dir(app).join("first-run-done");
    if marker.exists() || bench_mode() {
        return;
    }
    let done = start_at_sign_in(app, true);
    log(app, &format!("first run: start at sign-in on ({done:?})"));
    let _ = fs::create_dir_all(data_dir(app));
    let _ = fs::write(marker, b"");
}

/// Whether the window may go to `url`: its own pages, from the app or from the engine. The
/// web, mail and the phone open in their own apps instead, and anything else goes nowhere.
fn stays_in_window(app: &AppHandle, url: &Url) -> bool {
    if matches!(url.scheme(), "tauri" | "about" | "blob")
        || url.host_str() == Some("tauri.localhost")
        || from_engine(app, url)
    {
        return true;
    }
    open_elsewhere(app, url);
    false
}

/// Whether `url` is one of the engine's own pages.
fn from_engine(app: &AppHandle, url: &Url) -> bool {
    let origin = app.state::<Engine>().origin.lock().unwrap().clone();
    origin.is_some_and(|origin| url.origin().ascii_serialization() == origin)
}

/// A link for a new window: the app's own pages open in its one window, the rest outside.
fn open_new_window(app: &AppHandle, url: &Url) {
    if from_engine(app, url) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.navigate(url.clone());
        }
    } else {
        open_elsewhere(app, url);
    }
}

fn open_elsewhere(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        let opened = app.opener().open_url(url.as_str(), None::<&str>);
        log(
            app,
            &format!(
                "a {} link, opened in its own app ({opened:?})",
                url.scheme()
            ),
        );
    }
}

/// Downloads go to the Downloads folder, never over a file already there.
fn download_to(app: &AppHandle, url: &Url, suggested: &std::path::Path) -> PathBuf {
    let folder = std::env::var("ANCESTREE_DOWNLOADS")
        .map(PathBuf::from)
        .or_else(|_| app.path().download_dir())
        .unwrap_or_else(|_| data_dir(app));
    let name = suggested
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .or_else(|| url.path_segments()?.next_back().map(str::to_owned))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "AncesTree download".to_owned());
    let path = std::path::Path::new(&name);
    let stem = path
        .file_stem()
        .map_or(name.clone(), |s| s.to_string_lossy().into_owned());
    let extension = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()));
    let mut candidate = folder.join(&name);
    let mut number = 2;
    while candidate.exists() {
        let numbered = format!("{stem} ({number}){}", extension.as_deref().unwrap_or(""));
        candidate = folder.join(numbered);
        number += 1;
    }
    candidate
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        // The shell decides where links go (stays_in_window, open_new_window). The plugin's
        // own script for links would ask the shell from the page, which the app's pages,
        // served by the engine, may not do: its links would do nothing.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(Pending::default())
        .manage(Latest::default())
        .manage(LoadingPage::default())
        .manage(Engine {
            secret: session_secret(),
            ..Engine::default()
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let hidden = std::env::args().any(|arg| arg == HIDDEN);
            log(
                &handle,
                &format!(
                    "starting {} (hidden: {hidden}, bench: {})",
                    app.package_info().version,
                    bench_mode()
                ),
            );
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("AncesTree")
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(900.0, 600.0)
                    .visible(!hidden);
            let (going, opening, saving) = (handle.clone(), handle.clone(), handle.clone());
            window = window
                .on_navigation(move |url| stays_in_window(&going, url))
                .on_new_window(move |url, _| {
                    open_new_window(&opening, &url);
                    NewWindowResponse::Deny
                })
                .on_download(move |_, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            *destination = download_to(&saving, &url, destination);
                            log(
                                &saving,
                                &format!("saving a download to {}", destination.display()),
                            );
                        }
                        DownloadEvent::Finished { success, .. } => {
                            log(&saving, &format!("download finished (saved: {success})"));
                        }
                        _ => {}
                    }
                    true
                });
            if bench_mode() {
                window = window.initialization_script(BENCH);
            }
            let window = window.build()?;
            if let Ok(url) = window.url() {
                *app.state::<LoadingPage>().0.lock().unwrap() = Some(url);
            }
            let keep = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close(); // closing hides; Quit is in the icon's menu
                    let _ = keep.hide();
                }
            });
            #[cfg(windows)]
            if let Err(error) = quote_run_entry(&handle) {
                log(
                    &handle,
                    &format!("start at sign-in couldn't be checked: {error}"),
                );
            }
            first_run(&handle);
            build_tray(&handle)?;
            let again = handle.clone();
            handle.listen_any("loading-page-ready", move |_| {
                let latest = again.state::<Latest>().0.lock().unwrap().clone();
                if let Some(event) = latest {
                    let _ = again.emit("engine", event);
                }
            });
            let starting = handle.clone();
            tauri::async_runtime::spawn(async move {
                update_at_start(&starting).await; // returns only if nothing was installed
                if let Err(error) = start_engine(&starting) {
                    log(&starting, &format!("the engine couldn't start: {error}"));
                    tell_page(&starting, serde_json::json!({ "stage": "exited" }));
                }
            });
            keep_checking(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("AncesTree couldn't start")
        .run(|app, event| match event {
            RunEvent::ExitRequested {
                code: None, api, ..
            } => api.prevent_exit(),
            RunEvent::Exit => stop_engine(app),
            // On a Mac, choosing AncesTree in the Dock with its window closed opens it again.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(app),
            _ => {}
        });
}

#[cfg(windows)]
mod job {
    //! A Windows job object that ends every process in it when the shell goes, crash or not.

    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // The handle is only used to assign processes and to close it.
    unsafe impl Send for Job {}

    impl Job {
        pub fn kill_on_close() -> std::io::Result<Job> {
            // SAFETY: plain Win32 calls; the handle is checked and owned by the Job.
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let job = Job(handle);
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    std::ptr::from_ref(&limits).cast(),
                    u32::try_from(std::mem::size_of_val(&limits)).unwrap_or(u32::MAX),
                );
                if set == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(job)
            }
        }

        pub fn assign(&self, child: &Child) -> std::io::Result<()> {
            // SAFETY: both handles are valid while `self` and `child` live.
            let assigned =
                unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle().cast()) };
            if assigned == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle is ours and closed once.
            unsafe { CloseHandle(self.0) };
        }
    }
}
