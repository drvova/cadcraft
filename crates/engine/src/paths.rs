//! Where the per-user files live: the settings directory, and the assistant's kept definitions.
//!
//! One implementation, used by the app (its logs and autosave), the CLI and the MCP server, so a
//! user's directory is the same whichever way CADCraft is started. `CADCRAFT_CONFIG_DIR` moves it
//! whole (tests use it); an empty variable counts as unset, so a blank value never means the
//! working directory.

use std::path::PathBuf;

/// The per-user settings directory: `CADCRAFT_CONFIG_DIR` if set, else
/// `$XDG_CONFIG_HOME/cadcraft` or `~/.config/cadcraft` on Linux and the BSDs,
/// `~/Library/Application Support/CADCraft` on macOS, `%APPDATA%\CADCraft` on Windows. `None`
/// when no variable it needs is set.
pub fn config_dir() -> Option<PathBuf> {
    config_dir_from(|k| std::env::var_os(k))
}

/// [`config_dir`] with the environment passed in (`var` looks a variable up).
pub fn config_dir_from(var: impl Fn(&str) -> Option<std::ffi::OsString>) -> Option<PathBuf> {
    let set = |k: &str| var(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if let Some(dir) = set("CADCRAFT_CONFIG_DIR") {
        return Some(dir);
    }
    if cfg!(target_os = "macos") {
        set("HOME").map(|h| h.join("Library/Application Support/CADCraft"))
    } else if cfg!(windows) {
        set("APPDATA").map(|a| a.join("CADCraft"))
    } else {
        // The XDG spec ignores a relative XDG_CONFIG_HOME.
        set("XDG_CONFIG_HOME").filter(|p| p.is_absolute()).or_else(|| set("HOME").map(|h| h.join(".config"))).map(|c| c.join("cadcraft"))
    }
}

/// The directory the assistant's kept definitions live in: `CADCRAFT_DEFINITIONS` if set, else
/// `definitions/` inside [`config_dir`], else a per-process directory under the system temp
/// directory — never the working directory, so a missing environment cannot scatter `.lsp` files
/// into a project.
///
/// **Tests never touch a real user directory**: a test build resolves to a throwaway directory
/// per test process (still shared by every `Session` in it, so loading a definition a previous
/// run kept is tested for real), unless a test asked for its own with `CADCRAFT_DEFINITIONS`.
pub fn definitions_dir() -> PathBuf {
    #[cfg(target_arch = "wasm32")]
    {
        // The browser build has no filesystem and no environment: the path is only ever
        // formatted, never read or written (`lisp::agent` gates persistence on `persistent()`),
        // so a fixed value keeps callers working without touching `temp_dir`.
        PathBuf::from("/cadcraft-definitions")
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        if let Some(dir) = std::env::var_os("CADCRAFT_DEFINITIONS").filter(|v| !v.is_empty()) {
            return PathBuf::from(dir);
        }
        #[cfg(test)]
        return std::env::temp_dir().join(format!("cadcraft-definitions-test-{}", std::process::id()));
        #[cfg(not(test))]
        match config_dir() {
            Some(dir) => dir.join("definitions"),
            None => std::env::temp_dir().join(format!("cadcraft-definitions-{}", std::process::id())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |k| vars.iter().find(|(n, _)| *n == k).map(|(_, v)| OsString::from(v))
    }

    #[test]
    fn the_override_variable_wins_and_empty_values_are_unset() {
        let vars = [("CADCRAFT_CONFIG_DIR", "/tmp/cc"), ("HOME", "/home/u"), ("XDG_CONFIG_HOME", "/x"), ("APPDATA", "C:\\a")];
        assert_eq!(config_dir_from(env(&vars)), Some(PathBuf::from("/tmp/cc")));
        let empty = [("CADCRAFT_CONFIG_DIR", ""), ("HOME", ""), ("XDG_CONFIG_HOME", ""), ("APPDATA", "")];
        assert_eq!(config_dir_from(env(&empty)), None, "no usable variable means no directory, not the working directory");
        assert_eq!(config_dir_from(env(&[])), None);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn linux_and_bsd_follow_xdg_config_home() {
        assert_eq!(config_dir_from(env(&[("XDG_CONFIG_HOME", "/x"), ("HOME", "/home/u")])), Some(PathBuf::from("/x/cadcraft")));
        assert_eq!(config_dir_from(env(&[("HOME", "/home/u")])), Some(PathBuf::from("/home/u/.config/cadcraft")));
        // The XDG spec says a relative XDG_CONFIG_HOME is ignored.
        assert_eq!(config_dir_from(env(&[("XDG_CONFIG_HOME", "rel"), ("HOME", "/home/u")])), Some(PathBuf::from("/home/u/.config/cadcraft")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_uses_application_support() {
        assert_eq!(config_dir_from(env(&[("HOME", "/Users/u")])), Some(PathBuf::from("/Users/u/Library/Application Support/CADCraft")));
    }

    #[cfg(windows)]
    #[test]
    fn windows_uses_appdata() {
        assert_eq!(
            config_dir_from(env(&[("APPDATA", "C:\\Users\\u\\AppData\\Roaming")])),
            Some(PathBuf::from("C:\\Users\\u\\AppData\\Roaming\\CADCraft"))
        );
    }

    #[test]
    fn the_definitions_directory_is_a_real_path_and_never_the_working_directory() {
        let d = definitions_dir();
        assert!(d.is_absolute(), "{d:?}");
        // In a test build it is the throwaway directory, so a test can never write into a real
        // user profile.
        assert!(d.to_string_lossy().contains("cadcraft-definitions-test-"), "{d:?}");
    }
}
