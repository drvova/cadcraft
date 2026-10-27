//! The design-system drift check (`docs/system/index.md`): a surface that paints a literal where
//! a token or a recipe constant already holds that value.
//!
//! `crates/ui-egui/src/theme.rs` is the token source: its `Tokens` fields and `pub const`
//! recipe values are read here, so the check follows the theme, never a copy of it. Every
//! finding is counted per rule; `scripts/check-system-ratchet.json` freezes the counts of the
//! drift that exists today, so an old literal warns and a new one fails. `--ratchet-update`
//! lowers the counts after a fix, and never raises one.
//!
//! `cargo xtask system-check --list-rules` prints the rules for `scripts/gen-docs.mjs`, and
//! `--list-blind-spots` prints what the check cannot see.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// The tree the check scans.
const SCAN_DIR: &str = "crates/ui-egui/src";
/// The token source, where raw values may sit.
const TOKEN_SOURCE: &str = "theme.rs";
/// The frozen counts of the drift that exists today.
const DEFAULT_RATCHET: &str = "scripts/check-system-ratchet.json";

/// One rule, its ID and the fix the finding names.
pub const RULES: &[(&str, &str)] = &[
    (
        "rule/raw-value",
        "A surface paints a colour literal. Fix: read the role from `theme::Tokens` (`let t = Tokens::get()`), and add a field there if none fits.",
    ),
    ("rule/raw-radius", "A surface passes a radius literal whose value a `theme::RADIUS_*` constant already holds. Fix: use the constant."),
    (
        "rule/raw-font",
        "A surface passes a font-size literal whose value a theme font constant or helper already holds. Fix: use `theme::FONT_*`, `theme::small()`, `theme::body()` or `theme::mono()`.",
    ),
    (
        "rule/raw-height",
        "A surface passes a control-height literal whose value a `theme::CONTROL_H_*` constant already holds. Fix: use the constant.",
    ),
    ("rule/raw-hairline", "A surface paints a `HAIRLINE` (1px) stroke as a literal. Fix: use `theme::HAIRLINE`."),
];

/// What the check cannot see, for `rules.md` and every report.
pub const BLIND_SPOTS: &[&str] = &[
    "the rendered result: contrast, optical size and spacing are not measured",
    "a control drawn by hand from tokens, with no literal left to see: the check reads values, not shapes",
    "a value that matches no token or constant today: the check freezes it in the ratchet, it does not bless it",
    "literals after a `//` on the same line, and code below a file's first `mod tests`",
    "files outside `crates/ui-egui/src`",
];

struct Finding {
    file: String,
    line: usize,
    rule: &'static str,
    value: String,
    token: String,
}

/// `cargo xtask system-check [--root <dir>] [--ratchet <file>] [--ratchet-update] [--warn]
/// [--no-ratchet] [--list-rules] [--list-blind-spots]`.
pub fn run(root: &Path, args: &[String]) -> Result<(), String> {
    let mut scan_root = root.to_path_buf();
    let mut ratchet_given: Option<PathBuf> = None;
    let mut update = false;
    let mut warn = false;
    let mut use_ratchet = true;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--list-rules" => {
                for (id, text) in RULES {
                    println!("{id}\t{text}");
                }
                return Ok(());
            }
            "--list-blind-spots" => {
                for text in BLIND_SPOTS {
                    println!("{text}");
                }
                return Ok(());
            }
            "--explain" => {
                i += 1;
                let id = args.get(i).ok_or("--explain needs a rule id")?;
                let Some((_, text)) = RULES.iter().find(|(rule, _)| rule == id) else {
                    return Err(format!("no rule `{id}`; --list-rules lists them"));
                };
                println!("{id}: {text}");
                return Ok(());
            }
            "--root" => {
                i += 1;
                let dir = args.get(i).ok_or("--root needs a directory")?;
                scan_root = PathBuf::from(dir);
            }
            "--ratchet" => {
                i += 1;
                ratchet_given = Some(PathBuf::from(args.get(i).ok_or("--ratchet needs a file")?));
            }
            "--ratchet-update" => update = true,
            "--warn" => warn = true,
            "--no-ratchet" => use_ratchet = false,
            other => return Err(format!("unknown flag `{other}`; `cargo xtask system-check --help` lists them")),
        }
        i += 1;
    }
    let ratchet = ratchet_given.unwrap_or_else(|| scan_root.join(DEFAULT_RATCHET));

    let theme = scan_root.join(SCAN_DIR).join(TOKEN_SOURCE);
    let theme_text = fs::read_to_string(&theme).map_err(|e| format!("{}: {e}", theme.display()))?;
    let constants = parse_constants(&theme_text)?;
    let fonts = font_helpers(&theme_text, &constants);

    let dir = scan_root.join(SCAN_DIR);
    let mut files = Vec::new();
    collect(&dir, &mut files)?;
    files.sort();
    let mut findings = Vec::new();
    for file in &files {
        let name = file.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        if name == TOKEN_SOURCE {
            continue;
        }
        let text = fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
        let rel = file.strip_prefix(&scan_root).unwrap_or(file);
        scan_file(&rel.to_string_lossy().replace('\\', "/"), &text, &constants, &fonts, &mut findings);
    }

    let mut found: BTreeMap<&'static str, usize> = BTreeMap::new();
    for f in &findings {
        *found.entry(f.rule).or_default() += 1;
    }
    findings.sort_by(|a, b| (&a.file, a.line, a.rule).cmp(&(&b.file, b.line, b.rule)));

    // The ratchet: the counts of the drift that already exists. Missing on the first run, which
    // writes it and passes, so the repo goes green from its own numbers.
    let mut allowed: BTreeMap<String, usize> = BTreeMap::new();
    if use_ratchet {
        match fs::read_to_string(&ratchet) {
            Ok(text) => {
                let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", ratchet.display()))?;
                let obj = value.as_object().ok_or_else(|| format!("{}: expected an object", ratchet.display()))?;
                for (k, v) in obj {
                    let n = v.as_u64().ok_or_else(|| format!("{}: {k} is not a count", ratchet.display()))?;
                    allowed.insert(k.clone(), usize::try_from(n).map_err(|_| format!("{}: {k} is too large", ratchet.display()))?);
                }
            }
            Err(_) => {
                write_ratchet(&ratchet, &found)?;
                println!("system-check: wrote {} with today's counts ({})", ratchet.display(), counts_line(&found));
                println!("system-check: {RULES_LEN} rules, {} findings held by the ratchet", findings.len());
                return Ok(());
            }
        }
    }

    if update {
        write_ratchet(&ratchet, &found)?;
        println!("system-check: ratchet lowered to what is found now ({})", counts_line(&found));
    }

    let mut risen: Vec<&'static str> = Vec::new();
    for (rule, total) in &found {
        let held = allowed.get(*rule).copied().unwrap_or(0);
        if *total > held {
            risen.push(rule);
        }
    }
    risen.sort_unstable();
    // The number of new findings: the rise of each rule's count.
    let new_count: usize =
        risen.iter().map(|rule| found.get(*rule).copied().unwrap_or(0).saturating_sub(allowed.get(*rule).copied().unwrap_or(0))).sum();

    if !risen.is_empty() {
        // Every finding of a risen rule, so the new one is in the list whoever wrote it.
        for rule in &risen {
            println!("{rule}:");
            for f in findings.iter().filter(|f| f.rule == *rule) {
                println!("  {}:{} {} -> {}", f.file, f.line, f.value, f.token);
            }
        }
        println!();
        println!("system-check: new drift, {new_count} finding(s) past the ratchet:");
        for rule in &risen {
            println!(
                "  {rule}: {} found, {} held by {}",
                found.get(rule).copied().unwrap_or(0),
                allowed.get(*rule).copied().unwrap_or(0),
                ratchet.display()
            );
        }
        println!(
            "Fix the finding, or, when the value is right and the token is not, add the role to theme.rs and use it. After a fix, `--ratchet-update` lowers the file."
        );
        if warn {
            println!("system-check: --warn, so this run exits 0");
            return Ok(());
        }
        return Err(format!("{new_count} new design-system finding(s)"));
    }

    println!("system-check: no new drift ({} findings held by {})", findings.len(), ratchet.display());
    if std::env::var_os("CADCRAFT_SYSTEM_CHECK_VERBOSE").is_some() {
        for f in &findings {
            println!("  {}:{} {} {} -> {}", f.file, f.line, f.rule, f.value, f.token);
        }
    }
    Ok(())
}

const RULES_LEN: usize = RULES.len();

fn counts_line(found: &BTreeMap<&'static str, usize>) -> String {
    if found.is_empty() {
        return "no findings".into();
    }
    found.iter().map(|(k, v)| format!("{k} {v}")).collect::<Vec<_>>().join(", ")
}

fn write_ratchet(path: &Path, found: &BTreeMap<&'static str, usize>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let mut text = String::from("{\n");
    let entries: Vec<String> = found.iter().map(|(k, v)| format!("  {k:?}: {v}")).collect();
    text.push_str(&entries.join(",\n"));
    text.push_str("\n}\n");
    fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("{}: {e}", dir.display()))?;
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out)?;
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
    Ok(())
}

/// The `pub const NAME: f32 = VALUE;` lines of the token source, by name.
fn parse_constants(theme: &str) -> Result<BTreeMap<String, f32>, String> {
    let mut out = BTreeMap::new();
    for line in theme.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("pub const ") else { continue };
        let Some((name, rest)) = rest.split_once(": f32 = ") else { continue };
        let value = rest.trim_end_matches(';').trim();
        let Ok(value) = value.parse::<f32>() else { continue };
        out.insert(name.to_string(), value);
    }
    if out.is_empty() {
        return Err("theme.rs: no `pub const NAME: f32 = VALUE;` lines found".into());
    }
    Ok(out)
}

/// The font-size helpers of the token source (`small`, `body`, `mono`) and their sizes.
fn font_helpers(theme: &str, constants: &BTreeMap<String, f32>) -> Vec<(String, f32)> {
    let mut out: Vec<(String, f32)> = Vec::new();
    for name in ["small", "body", "mono"] {
        let needle = format!("pub fn {name}()");
        let Some(at) = theme.find(&needle) else { continue };
        let Some(open) = theme[at..].find("FontId::new(") else { continue };
        let args = args_at(theme, at + open + "FontId::new".len());
        if let Some(first) = args.first()
            && let Ok(v) = theme[first.0..first.1].trim().parse::<f32>()
        {
            out.push((format!("theme::{name}()"), v));
        }
    }
    for (name, value) in constants {
        if let Some(suffix) = name.strip_prefix("FONT_") {
            out.push((format!("theme::{name}"), *value));
            let _ = suffix;
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn scan_file(file: &str, text: &str, constants: &BTreeMap<String, f32>, fonts: &[(String, f32)], out: &mut Vec<Finding>) {
    // Test code is not interface code; the repo keeps tests below a `mod tests`.
    let text = match text.find("mod tests") {
        Some(at) => &text[..at],
        None => text,
    };
    // Comment text after `//` is not code. A `//` inside a string cuts the line short; noted as a
    // blind spot.
    let mut clean = String::with_capacity(text.len());
    for line in text.lines() {
        let end = line.find("//").unwrap_or(line.len());
        clean.push_str(&line[..end]);
        clean.push('\n');
    }
    let text = clean.as_str();

    let radius: Vec<(String, f32)> = constants.iter().filter(|(k, _)| k.starts_with("RADIUS_")).map(|(k, v)| (format!("theme::{k}"), *v)).collect();
    let height: Vec<(String, f32)> =
        constants.iter().filter(|(k, _)| k.starts_with("CONTROL_H_")).map(|(k, v)| (format!("theme::{k}"), *v)).collect();
    let hairline = constants.get("HAIRLINE").copied();

    // Colours: any raw colour constructor outside the token source.
    for name in [
        "Color32::from_rgb(",
        "Color32::from_rgba_unmultiplied(",
        "Color32::from_rgba_premultiplied(",
        "Color32::from_rgba_unmultiplied_const(",
        "Color32::from_gray(",
    ] {
        let at = name.trim_end_matches('(');
        for (start, args) in calls(text, at) {
            let value: String = args.iter().map(|(a, b)| text[*a..*b].trim()).collect::<Vec<_>>().join(", ");
            out.push(Finding {
                file: file.to_string(),
                line: line_of(text, start),
                rule: "rule/raw-value",
                value: format!("{at}({value})"),
                token: "Tokens::get()".into(),
            });
        }
    }

    // Radii.
    for call in ["rect_filled", "rect_stroke"] {
        for (start, args) in calls(text, call) {
            let Some(arg) = args.get(1) else { continue };
            let value = text[arg.0..arg.1].trim();
            if let Some((token, _)) = match_number(value, &radius) {
                out.push(Finding { file: file.to_string(), line: line_of(text, start), rule: "rule/raw-radius", value: value.into(), token });
            }
        }
    }
    for call in ["corner_radius", "CornerRadius::same"] {
        for (start, args) in calls(text, call) {
            let Some(arg) = args.first() else { continue };
            let value = text[arg.0..arg.1].trim();
            if let Some((token, _)) = match_number(value, &radius) {
                out.push(Finding { file: file.to_string(), line: line_of(text, start), rule: "rule/raw-radius", value: value.into(), token });
            }
        }
    }

    // Fonts.
    for call in ["FontId::proportional", "FontId::monospace", "FontId::new"] {
        for (start, args) in calls(text, call) {
            let Some(arg) = args.first() else { continue };
            let value = text[arg.0..arg.1].trim();
            if let Some((token, _)) = match_number(value, fonts) {
                out.push(Finding { file: file.to_string(), line: line_of(text, start), rule: "rule/raw-font", value: value.into(), token });
            }
        }
    }

    // Control heights: the second component of a `vec2`/array size.
    for call in ["allocate_exact_size", "add_sized"] {
        for (start, args) in calls(text, call) {
            let Some(arg) = args.first() else { continue };
            let size = text[arg.0..arg.1].trim();
            let Some(inner) = size.strip_prefix("vec2(").or_else(|| size.strip_prefix('[')) else { continue };
            let inner = inner.trim_end_matches(')').trim_end_matches(']');
            let mut parts = inner.split(',');
            let _w = parts.next();
            let Some(h) = parts.next() else { continue };
            let value = h.trim();
            if let Some((token, _)) = match_number(value, &height) {
                out.push(Finding { file: file.to_string(), line: line_of(text, start), rule: "rule/raw-height", value: value.into(), token });
            }
        }
    }

    // Hairlines.
    if let Some(hairline) = hairline {
        for (start, args) in calls(text, "Stroke::new") {
            let Some(arg) = args.first() else { continue };
            let value = text[arg.0..arg.1].trim();
            if value.parse::<f32>().ok() == Some(hairline) {
                out.push(Finding {
                    file: file.to_string(),
                    line: line_of(text, start),
                    rule: "rule/raw-hairline",
                    value: value.into(),
                    token: "theme::HAIRLINE".into(),
                });
            }
        }
    }
}

/// The token a literal's value equals, if any.
fn match_number(value: &str, table: &[(String, f32)]) -> Option<(String, f32)> {
    let v: f32 = value.parse().ok()?;
    table.iter().find(|(_, n)| (*n - v).abs() < 0.001).map(|(name, n)| (name.clone(), *n))
}

/// Every call to `name(` in `text`, with the byte spans of its top-level arguments.
fn calls(text: &str, name: &str) -> Vec<(usize, Vec<(usize, usize)>)> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = text[from..].find(name) {
        let at = from + rel;
        let after = at + name.len();
        let mut i = after;
        while i < text.len() && text.as_bytes()[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < text.len() && text.as_bytes()[i] == b'(' {
            let args = args_at(text, i);
            let end = args.last().map(|(_, b)| *b).unwrap_or(i) + 1;
            out.push((at, args));
            from = end;
        } else {
            from = after;
        }
    }
    out
}

/// The top-level argument spans of the call whose `(` is at `open`.
fn args_at(text: &str, open: usize) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut depth = 0i32;
    let mut start = open + 1;
    let mut j = open;
    while j < bytes.len() {
        match bytes[j] {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => {
                depth -= 1;
                if depth == 0 {
                    let arg = &text[start..j];
                    if !arg.trim().is_empty() {
                        spans.push((start, j));
                    }
                    break;
                }
            }
            b',' if depth == 1 => {
                spans.push((start, j));
                start = j + 1;
            }
            _ => {}
        }
        j += 1;
    }
    spans
}

fn line_of(text: &str, offset: usize) -> usize {
    text[..offset].matches('\n').count() + 1
}
