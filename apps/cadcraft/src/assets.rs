//! The interface's files, as the webview asks for them: a request path in, a status, a media
//! type and the bytes out. The table is `apps/ui/dist`, embedded by `build.rs`; when that build
//! was absent the table is empty and every page request answers with [`NOT_BUILT`].
//!
//! Request paths come from the webview and are treated as hostile: no `..`, no backslashes, no
//! absolute forms, and a lookup is a table match, never a filesystem read.

use std::borrow::Cow;

include!(concat!(env!("OUT_DIR"), "/embedded.rs"));

/// The page shown when the binary was built without the interface.
pub const NOT_BUILT: &str = "<!doctype html><meta charset=utf-8><title>CADCraft</title>\
<body style=\"font:14px system-ui;background:#141414;color:#f0f0f0;padding:32px\">\
<h1 style=\"font-size:18px\">The interface is not in this build</h1>\
<p>Build it, then build the desktop app again:</p>\
<pre>cd apps/ui\nbun install\nbun run build:wasm\nbun run build\ncargo build -p cadcraft</pre>\
<p>Or run the interface's dev server and start the app with <code>--dev</code>.</p>";

/// What a request is answered with.
pub struct Reply {
    pub status: u16,
    pub mime: &'static str,
    pub body: Cow<'static, [u8]>,
}

/// The table key for a request path: no query or fragment, no leading slash, `index.html` for
/// the root. `None` for a path that tries to leave the table.
pub fn normalize(path: &str) -> Option<&str> {
    let path = path.split(['?', '#']).next().unwrap_or_default().trim_start_matches('/');
    if path.is_empty() {
        return Some("index.html");
    }
    let hostile = path.contains('\\') || path.contains(':') || path.split('/').any(|part| part.is_empty() || part == "." || part == "..");
    if hostile { None } else { Some(path) }
}

/// The media type for a file name (what a Vite build holds; anything else is opaque bytes).
/// `.wasm` must be `application/wasm` or the browser refuses to compile it while streaming.
pub fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "wasm" => "application/wasm",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Look a request path up in `files`.
pub fn respond_from(files: &'static [(&'static str, &'static [u8])], path: &str) -> Reply {
    let not_found = Reply { status: 404, mime: "text/plain; charset=utf-8", body: Cow::Borrowed(b"not found") };
    let Some(key) = normalize(path) else { return not_found };
    if let Some((name, bytes)) = files.iter().find(|(name, _)| *name == key) {
        return Reply { status: 200, mime: mime(name), body: Cow::Borrowed(bytes) };
    }
    if key == "index.html" {
        return Reply { status: 200, mime: mime(key), body: Cow::Borrowed(NOT_BUILT.as_bytes()) };
    }
    not_found
}

/// Answer a request from the embedded interface.
pub fn respond(path: &str) -> Reply {
    respond_from(FILES, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    static SAMPLE: &[(&str, &[u8])] = &[("index.html", b"<html>"), ("assets/app.js", b"js"), ("assets/engine.wasm", b"\0asm")];

    #[test]
    fn the_root_is_the_index() {
        assert_eq!(normalize("/"), Some("index.html"));
        assert_eq!(normalize(""), Some("index.html"));
        assert_eq!(normalize("/?mock=1"), Some("index.html"));
        let r = respond_from(SAMPLE, "/");
        assert_eq!((r.status, r.mime, r.body.as_ref()), (200, "text/html; charset=utf-8", b"<html>".as_slice()));
    }

    #[test]
    fn files_answer_with_their_media_type() {
        let js = respond_from(SAMPLE, "/assets/app.js?v=3");
        assert_eq!((js.status, js.mime), (200, "text/javascript; charset=utf-8"));
        let wasm = respond_from(SAMPLE, "/assets/engine.wasm");
        assert_eq!((wasm.status, wasm.mime), (200, "application/wasm"));
        assert_eq!(mime("X.PNG"), "image/png");
        assert_eq!(mime("noextension"), "application/octet-stream");
    }

    #[test]
    fn hostile_paths_never_leave_the_table() {
        for path in ["/../Cargo.toml", "/assets/../../secret", "/assets//app.js", "/./index.html", "/C:/Windows/win.ini", "/assets\\app.js", "/a/.."]
        {
            assert_eq!(normalize(path), None, "{path}");
            assert_eq!(respond_from(SAMPLE, path).status, 404, "{path}");
        }
    }

    #[test]
    fn a_missing_file_is_not_found_but_a_missing_build_still_shows_a_page() {
        assert_eq!(respond_from(SAMPLE, "/assets/nope.js").status, 404);
        let empty = respond_from(&[], "/");
        assert_eq!(empty.status, 200);
        assert!(empty.body.as_ref().starts_with(b"<!doctype html>"));
        assert_eq!(respond_from(&[], "/assets/app.js").status, 404);
    }
}
