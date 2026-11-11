//! CADCraft's desktop app: one native window whose content is the web interface (`apps/ui`),
//! drawn by the system webview. The interface and the engine it drives (the wasm facade) are the
//! same ones the browser runs; this binary only gives them a window, an origin and a place to
//! keep their settings.
//!
//! `cadcraft` serves the interface embedded at build time. `cadcraft --dev [URL]`
//! shows a running dev server instead (default `http://127.0.0.1:5187`, `bun run dev` in
//! `apps/ui`), so the interface can be changed and looked at live.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod assets;

use std::error::Error;
use std::path::PathBuf;
use std::process::ExitCode;

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::http::header::CONTENT_TYPE;
use wry::http::{Request, Response};
use wry::{WebContext, WebViewBuilder};

/// The custom scheme the embedded interface is served on.
const SCHEME: &str = "cadcraft";
/// Where `bun run dev` listens (`apps/ui/vite.config.ts`).
const DEV_URL: &str = "http://127.0.0.1:5187";

const USAGE: &str = "CADCraft desktop\n\n  cadcraft              the interface built into this binary\n  cadcraft --dev [URL]  a running dev server (default http://127.0.0.1:5187)\n";

/// What the command line asked for.
#[derive(Debug, PartialEq, Eq)]
enum Start {
    Embedded,
    Dev(String),
    Help,
}

fn parse_args(args: &[String]) -> Result<Start, String> {
    match args.first().map(String::as_str) {
        None => Ok(Start::Embedded),
        Some("--help" | "-h") => Ok(Start::Help),
        Some("--dev") => {
            let url = args.get(1).map_or(DEV_URL, String::as_str);
            if url.starts_with("http://") || url.starts_with("https://") {
                Ok(Start::Dev(url.to_string()))
            } else {
                Err(format!("--dev takes an http:// or https:// URL, not `{url}`"))
            }
        }
        Some(other) => Err(format!("unknown argument `{other}`")),
    }
}

/// The URL the embedded interface is opened at. WebView2 has no custom schemes of its own, so
/// wry maps one to `http://<scheme>.localhost`; the other webviews use the scheme directly.
fn embedded_url() -> String {
    if cfg!(any(windows, target_os = "android")) { format!("http://{SCHEME}.localhost/") } else { format!("{SCHEME}://localhost/") }
}

/// The folder the webview keeps its storage in (the interface's settings live in
/// `localStorage`), under the user's own data folder. `None` leaves the webview's default.
fn data_dir() -> Option<PathBuf> {
    let var = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    let base = if cfg!(windows) {
        var("LOCALAPPDATA")
    } else if cfg!(target_os = "macos") {
        var("HOME").map(|home| home.join("Library").join("Application Support"))
    } else {
        var("XDG_DATA_HOME").or_else(|| var("HOME").map(|home| home.join(".local").join("share")))
    };
    base.map(|base| base.join("CADCraft").join("webview"))
}

fn serve(request: &Request<Vec<u8>>) -> Response<std::borrow::Cow<'static, [u8]>> {
    let reply = assets::respond(request.uri().path());
    Response::builder()
        .status(reply.status)
        .header(CONTENT_TYPE, reply.mime)
        .body(reply.body)
        .unwrap_or_else(|_| Response::new(std::borrow::Cow::Borrowed(b"".as_slice())))
}

fn run(start: Start) -> Result<(), Box<dyn Error>> {
    let url = match start {
        Start::Help => {
            print!("{USAGE}");
            return Ok(());
        }
        Start::Embedded => embedded_url(),
        Start::Dev(url) => url,
    };

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("CADCraft")
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .with_min_inner_size(LogicalSize::new(480.0, 360.0))
        .build(&event_loop)?;

    let mut context = WebContext::new(data_dir());
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_custom_protocol(SCHEME.to_string(), |_webview, request| serve(&request))
        .with_url(url)
        .with_devtools(cfg!(debug_assertions));

    #[cfg(not(any(target_os = "linux", target_os = "dragonfly", target_os = "freebsd", target_os = "netbsd", target_os = "openbsd")))]
    let webview = builder.build(&window)?;
    #[cfg(any(target_os = "linux", target_os = "dragonfly", target_os = "freebsd", target_os = "netbsd", target_os = "openbsd"))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(window.default_vbox().ok_or("the window has no GTK container for the webview")?)?
    };

    event_loop.run(move |event, _, control_flow| {
        // The webview lives as long as the loop that owns its window.
        let _keep = &webview;
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            *control_flow = ControlFlow::Exit;
        }
    })
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let start = match parse_args(&args) {
        Ok(start) => start,
        Err(message) => {
            eprintln!("cadcraft: {message}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(start) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("cadcraft: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn the_command_line_picks_the_interface() {
        assert_eq!(parse_args(&args(&[])), Ok(Start::Embedded));
        assert_eq!(parse_args(&args(&["--dev"])), Ok(Start::Dev(DEV_URL.to_string())));
        assert_eq!(parse_args(&args(&["--dev", "http://localhost:3000"])), Ok(Start::Dev("http://localhost:3000".to_string())));
        assert_eq!(parse_args(&args(&["-h"])), Ok(Start::Help));
    }

    #[test]
    fn a_bad_command_line_is_an_error_not_a_crash() {
        assert!(parse_args(&args(&["--dev", "file:///etc/passwd"])).is_err());
        assert!(parse_args(&args(&["--frobnicate"])).is_err());
    }

    #[test]
    fn a_request_is_served_from_the_table() {
        let request = Request::builder().uri("http://cadcraft.localhost/").body(Vec::new());
        let Ok(request) = request else { return };
        let reply = serve(&request);
        assert_eq!(reply.status(), 200);
        assert_eq!(reply.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()), Some("text/html; charset=utf-8"));
    }
}
