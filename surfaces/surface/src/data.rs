//! What a surface shows, read from the engine's own replies.
//!
//! Two commands are asked, and only asked — `piece {query: true}` and `techsheet {}` change
//! nothing — and their replies are turned into the words a surface prints. Nothing is worked out
//! here: no weight, carat, count, verdict or price is derived, summed or re-measured. A number is
//! printed to the precision the engine's own messages use (grams to two places, carats to three),
//! a check's `ok` becomes the word PASS or FAIL, and that is all.
//!
//! The replies come from a drawing, and a drawing can be hostile: every string is stripped of
//! control characters and cut to a length a row can hold, every list is capped, and a number that
//! is missing or not finite prints as a dash.

use cadcraft_engine::Session;
use serde_json::{Value, json};

/// The most rows of each kind a surface shows. A drawing with more says how many were left out.
pub const MAX_STONE_ROWS: usize = 24;
/// See [`MAX_STONE_ROWS`].
pub const MAX_BAND_ROWS: usize = 12;
/// See [`MAX_STONE_ROWS`].
pub const MAX_CHECK_ROWS: usize = 12;
/// See [`MAX_STONE_ROWS`].
pub const MAX_COST_ROWS: usize = 24;
/// See [`MAX_STONE_ROWS`].
pub const MAX_WARNING_ROWS: usize = 8;
/// See [`MAX_STONE_ROWS`].
pub const MAX_BENCH_LINES: usize = 24;
/// The longest a name or a figure is printed, in characters.
pub const MAX_LABEL: usize = 64;
/// The longest a sentence (a check's message, a warning) is printed, in characters.
pub const MAX_SENTENCE: usize = 240;

/// The dash a missing figure prints as.
pub const NONE: &str = "—";

/// One of the piece's checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    /// The engine's id (`wall`, `stone-seat`, `spacing`, `calibrated`, `size`).
    pub id: String,
    /// The id as a label (`Stone seat`).
    pub name: String,
    /// The engine's verdict.
    pub ok: bool,
    /// What the engine said about it.
    pub message: String,
}

impl Check {
    /// The verdict as the word a surface prints.
    pub fn verdict(&self) -> &'static str {
        if self.ok { "PASS" } else { "FAIL" }
    }
}

/// A line of the stone table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stone {
    /// Cut and size (`round 6.5 mm`).
    pub what: String,
    /// How many.
    pub pcs: String,
    /// Carats each.
    pub each_ct: String,
    /// Carats in all.
    pub ct: String,
}

/// A band on the bench sheet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Band {
    /// Its size (`US 6`).
    pub size: String,
    /// Its inside diameter (`16.51 mm`).
    pub inside: String,
    /// Its alloy.
    pub metal: String,
    /// Its width along the finger.
    pub width: String,
    /// Its wall.
    pub wall: String,
    /// Its weight (`3.53 g`).
    pub grams: String,
}

/// A line of the cost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostLine {
    /// What is priced.
    pub what: String,
    /// How much of it (`3.53 g`, `1.031 ct`).
    pub qty: String,
    /// The rate, or a dash when there is no price for it.
    pub rate: String,
    /// The amount, or why there is none.
    pub amount: String,
}

/// The cost the bench sheet totals from the drawing's price book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cost {
    /// The currency code.
    pub currency: String,
    /// The total, as a figure (`5390.23`).
    pub total: String,
    /// The engine's own caveat.
    pub note: String,
    /// The lines.
    pub lines: Vec<CostLine>,
}

/// Everything the surfaces show about the open drawing.
#[derive(Debug, Clone, PartialEq)]
pub struct PieceData {
    /// The drawing's title.
    pub drawing: String,
    /// Whether the drawing holds a parametric piece.
    pub has_piece: bool,
    /// What the piece is (`Solitaire ring`), or that there is none.
    pub title: String,
    /// The piece's band and stone, in a sentence.
    pub subtitle: String,
    /// The size in the piece's own system (`US 6`).
    pub size_a: String,
    /// The size in a second system and the inside diameter (`EU 52 · 16.51 mm inside`).
    pub size_b: String,
    /// The metal's weight (`3.53 g`).
    pub metal: String,
    /// The alloy.
    pub metal_note: String,
    /// How many stones the bench sheet counts.
    pub stone_count: String,
    /// Their carats (`1.188 ct`).
    pub carat: String,
    /// The checks, in the engine's order.
    pub checks: Vec<Check>,
    /// The stone table.
    pub stones: Vec<Stone>,
    /// Stone lines left out by the cap.
    pub stones_left_out: usize,
    /// The bands.
    pub bands: Vec<Band>,
    /// The cost, when the drawing has a price book that prices something.
    pub cost: Option<Cost>,
    /// What the bench sheet warns about.
    pub warnings: Vec<String>,
    /// The bench sheet's own lines.
    pub bench: Vec<String>,
    /// The replies themselves: `{piece: P | null, sheet: S | null}`, without the handle lists.
    pub json: Value,
}

impl PieceData {
    /// A drawing with nothing to show, and why.
    pub fn empty(why: &str) -> PieceData {
        PieceData {
            drawing: String::new(),
            has_piece: false,
            title: sentence(why),
            subtitle: String::new(),
            size_a: NONE.into(),
            size_b: String::new(),
            metal: NONE.into(),
            metal_note: String::new(),
            stone_count: "0".into(),
            carat: String::new(),
            checks: Vec::new(),
            stones: Vec::new(),
            stones_left_out: 0,
            bands: Vec::new(),
            cost: None,
            warnings: Vec::new(),
            bench: Vec::new(),
            json: json!({ "piece": null, "sheet": null }),
        }
    }

    /// Ask the engine about the open drawing. A session with no drawing, or a command the engine
    /// refuses, gives the empty state rather than an error: a surface always has something to
    /// show.
    pub fn gather(session: &mut Session) -> PieceData {
        let Ok(state) = session.state() else {
            return PieceData::empty("No drawing is open");
        };
        let drawing = label(&state.title);
        let piece = session.execute("piece", &json!({ "query": true })).ok().and_then(|r| r.get("piece").cloned()).filter(Value::is_object);
        let sheet = session.execute("techsheet", &json!({})).ok().filter(Value::is_object);
        let mut data = PieceData::from_replies(piece.as_ref(), sheet.as_ref());
        data.drawing = drawing;
        data
    }

    /// The same from replies already in hand: `piece` is the `piece` member of
    /// `piece {query: true}`'s reply, `sheet` is `techsheet {}`'s reply.
    pub fn from_replies(piece: Option<&Value>, sheet: Option<&Value>) -> PieceData {
        let mut data = PieceData::empty("No piece in this drawing");
        data.json = json!({ "piece": piece.map(without_handles), "sheet": sheet.map(without_handles) });

        if let Some(sheet) = sheet {
            let stones = sheet.get("stones");
            if let Some(n) = stones.and_then(|s| s.get("count")).and_then(Value::as_u64) {
                data.stone_count = n.to_string();
            }
            if let Some(ct) = stones.and_then(|s| number(s.get("carat"))) {
                data.carat = format!("{ct:.3} ct");
            }
            let groups = stones.and_then(|s| s.get("groups")).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
            data.stones_left_out = groups.len().saturating_sub(MAX_STONE_ROWS);
            data.stones = groups.iter().take(MAX_STONE_ROWS).map(stone).collect();
            data.bands = array(sheet.get("bands")).iter().take(MAX_BAND_ROWS).map(band).collect();
            data.warnings = array(sheet.get("warnings")).iter().take(MAX_WARNING_ROWS).filter_map(Value::as_str).map(sentence).collect();
            data.bench = sheet.get("message").and_then(Value::as_str).unwrap_or_default().lines().take(MAX_BENCH_LINES).map(sentence).collect();
            data.cost = sheet.get("cost").filter(|c| c.is_object()).map(cost);
            // With no piece, one band on the sheet is the ring: its size and weight head the
            // surface. More than one is a set, and the table says which is which.
            if let [only] = data.bands.as_slice() {
                data.size_a = only.size.clone();
                data.size_b = if only.inside == NONE { String::new() } else { format!("{} inside", only.inside) };
                data.metal = only.grams.clone();
                data.metal_note = only.metal.clone();
            }
            if !data.bands.is_empty() || !data.stones.is_empty() {
                data.title = "Bench sheet".into();
                data.subtitle = "No parametric piece: the figures are the drawing's bands and stones.".into();
            }
        }

        if let Some(piece) = piece {
            data.has_piece = true;
            let params = piece.get("params");
            let text = |key: &str| params.and_then(|p| p.get(key)).and_then(Value::as_str).map(label).unwrap_or_default();
            let figure = |key: &str| number(params.and_then(|p| p.get(key))).map(plain);
            let kind = text("kind");
            data.title = match kind.as_str() {
                "band" => "Band".into(),
                "solitaire" => "Solitaire ring".into(),
                "threestone" => "Three-stone ring".into(),
                "eternity" => "Eternity band".into(),
                "" => "Piece".into(),
                _ => kind.clone(),
            };
            let mut parts: Vec<String> = Vec::new();
            if let (Some(width), Some(wall)) = (figure("width"), figure("wall")) {
                parts.push(format!("{} band, {width} mm wide, {wall} mm wall", text("profile")).trim_start().to_string());
            }
            match kind.as_str() {
                "solitaire" | "threestone" => {
                    if let Some(w) = figure("stoneWidth") {
                        let l = figure("stoneLength").unwrap_or_else(|| w.clone());
                        let size = if l == w { format!("{w} mm") } else { format!("{l}×{w} mm") };
                        let prongs =
                            params.and_then(|p| p.get("prongs")).and_then(Value::as_u64).map(|n| format!(", {n} prongs")).unwrap_or_default();
                        parts.push(format!("{} {} {size}{prongs}", text("cut"), text("stone")).trim_start().to_string());
                    }
                    if let Some(halo) = figure("halo") {
                        parts.push(format!("halo of {halo} mm stones"));
                    }
                }
                "eternity" => {
                    if let Some(melee) = figure("melee") {
                        parts.push(format!("{} {} {melee} mm all round", text("cut"), text("stone")).trim_start().to_string());
                    }
                }
                _ => {}
            }
            data.subtitle = sentence(&parts.join(" · "));

            // The size, in the system the piece was given in and one other.
            let size = piece.get("size");
            let system = text("sizeSystem");
            let in_system = |sys: &str| -> Option<String> {
                let v = size.and_then(|s| s.get(if sys == "us" { "usText" } else { sys }))?;
                let shown = match v {
                    Value::String(s) => label(s),
                    other => plain(number(Some(other))?),
                };
                (!shown.is_empty()).then(|| format!("{} {shown}", sys.to_ascii_uppercase()))
            };
            let first = if matches!(system.as_str(), "us" | "uk" | "eu" | "jp" | "cn") { system.as_str() } else { "us" };
            let second = if first == "eu" { "us" } else { "eu" };
            data.size_a = in_system(first).unwrap_or_else(|| NONE.into());
            let mut second_line: Vec<String> = in_system(second).into_iter().collect();
            if let Some(mm) = size.and_then(|s| number(s.get("mm"))) {
                second_line.push(format!("{mm:.2} mm inside"));
            }
            data.size_b = second_line.join(" · ");

            let metal = piece.get("metal");
            data.metal = metal.and_then(|m| number(m.get("grams"))).map_or_else(|| NONE.into(), |g| format!("{g:.2} g"));
            data.metal_note = metal.and_then(|m| m.get("name")).and_then(Value::as_str).map(label).unwrap_or_default();

            // With no bench sheet to count the drawing's stones, the piece's own count stands.
            if sheet.is_none() {
                let stones = piece.get("stones");
                if let Some(n) = stones.and_then(|s| s.get("count")).and_then(Value::as_u64) {
                    data.stone_count = n.to_string();
                }
                if let Some(ct) = stones.and_then(|s| number(s.get("carat"))) {
                    data.carat = format!("{ct:.3} ct");
                }
            }
            data.checks = array(piece.get("checks")).iter().take(MAX_CHECK_ROWS).map(check).collect();
        }
        data
    }

    /// Whether every check passed (true with no checks: there is nothing failing).
    pub fn all_ok(&self) -> bool {
        self.checks.iter().all(|c| c.ok)
    }

    /// The verdict a surface heads the checks with.
    pub fn verdict(&self) -> &'static str {
        if !self.has_piece {
            ""
        } else if self.all_ok() {
            "ALL CHECKS PASS"
        } else {
            "A CHECK FAILS"
        }
    }

    /// The note under the stone table when the cap left lines out.
    pub fn stones_more(&self) -> String {
        match self.stones_left_out {
            0 => String::new(),
            1 => "and 1 more line on the bench sheet (TECHSHEET lists every one)".into(),
            n => format!("and {n} more lines on the bench sheet (TECHSHEET lists every one)"),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Reading a reply
// ---------------------------------------------------------------------------------------------

fn array(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

/// The largest magnitude printed as a figure. Nothing on a bench sheet is a trillion of
/// anything; a number beyond it is damage, and prints as a dash instead of three hundred digits.
const MAX_FIGURE: f64 = 1e12;

/// A finite number of a size a sheet can print, or nothing.
fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite() && n.abs() < MAX_FIGURE)
}

/// A number as the engine wrote it, without a trailing `.0`: `6.5`, `19`, `0.008`.
fn plain(n: f64) -> String {
    let text = format!("{n}");
    // A float prints in full; anything long is noise from arithmetic, not a figure.
    if text.len() > 12 { format!("{n:.3}") } else { text }
}

/// A figure with its unit, or a dash.
fn with_unit(v: Option<&Value>, unit: &str) -> String {
    number(v).map_or_else(|| NONE.into(), |n| format!("{} {unit}", plain(n)))
}

/// A string made safe to print on one row: control characters and bidirectional overrides
/// become spaces, runs of spaces close up, and the rest is cut to `max` characters.
fn clean(text: &str, max: usize) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    let mut space = false;
    for c in text.chars() {
        let hidden = c.is_control() || matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200B}'..='\u{200F}' | '\u{FEFF}');
        if hidden || c.is_whitespace() {
            space = !out.is_empty();
            continue;
        }
        if count + usize::from(space) >= max {
            out.push('…');
            return out;
        }
        if space {
            out.push(' ');
            count += 1;
            space = false;
        }
        out.push(c);
        count += 1;
    }
    out
}

/// A name or a figure.
fn label(text: &str) -> String {
    clean(text, MAX_LABEL)
}

/// A sentence.
fn sentence(text: &str) -> String {
    clean(text, MAX_SENTENCE)
}

/// The most values (numbers, strings, members) the JSON beside a surface carries, the longest a
/// string in it is, and the most items of one list. A real piece's replies are a few hundred
/// values; a hostile drawing's are cut here rather than sent whole to a model.
const JSON_BUDGET: usize = 4000;
const JSON_STRING: usize = 400;
const JSON_ITEMS: usize = 64;

/// A reply as a surface hands it on: without its `handles` lists (a piece's can hold thousands;
/// the handles stay with the commands), and bounded in every direction.
fn without_handles(v: &Value) -> Value {
    fn strip(v: &Value, depth: usize, budget: &mut usize) -> Value {
        if *budget == 0 {
            return Value::Null;
        }
        *budget -= 1;
        match v {
            Value::Object(m) if depth < 8 => Value::Object(
                m.iter()
                    .filter(|(k, _)| k.as_str() != "handles")
                    .take(JSON_ITEMS)
                    .map(|(k, x)| (clean(k, MAX_LABEL), strip(x, depth + 1, budget)))
                    .collect(),
            ),
            Value::Array(a) if depth < 8 => Value::Array(a.iter().take(JSON_ITEMS).map(|x| strip(x, depth + 1, budget)).collect()),
            Value::Object(_) | Value::Array(_) => Value::Null,
            Value::String(text) => Value::String(clean(text, JSON_STRING)),
            other => other.clone(),
        }
    }
    let mut budget = JSON_BUDGET;
    strip(v, 0, &mut budget)
}

fn check(v: &Value) -> Check {
    let id = v.get("id").and_then(Value::as_str).map(label).unwrap_or_default();
    let name = match id.as_str() {
        "wall" => "Wall".to_string(),
        "stone-seat" => "Stone seat".to_string(),
        "spacing" => "Spacing".to_string(),
        "calibrated" => "Calibrated".to_string(),
        "size" => "Size".to_string(),
        "" => "Check".to_string(),
        other => other.to_string(),
    };
    Check {
        id,
        name,
        // A check that does not say it passed did not pass.
        ok: v.get("ok").and_then(Value::as_bool).unwrap_or(false),
        message: v.get("message").and_then(Value::as_str).map(sentence).unwrap_or_default(),
    }
}

/// A stone group's cut and size, as the bench sheet's own lines put it.
fn stone(v: &Value) -> Stone {
    let cut = v.get("cut").and_then(Value::as_str).map(label).unwrap_or_else(|| "stone".into());
    let width = number(v.get("width"));
    let length = number(v.get("length")).or(width);
    let size = match (length, width) {
        (Some(l), Some(w)) if (l - w).abs() < 1e-6 => format!(" {} mm", plain(w)),
        (Some(l), Some(w)) => format!(" {}×{} mm", plain(l), plain(w)),
        _ => String::new(),
    };
    Stone {
        what: label(&format!("{cut}{size}")),
        pcs: v.get("count").and_then(Value::as_u64).map_or_else(|| NONE.into(), |n| n.to_string()),
        each_ct: number(v.get("caratEach")).map_or_else(|| NONE.into(), |c| format!("{c:.3}")),
        ct: number(v.get("carat")).map_or_else(|| NONE.into(), |c| format!("{c:.3}")),
    }
}

fn band(v: &Value) -> Band {
    Band {
        size: v.get("size").and_then(Value::as_str).map(label).filter(|s| !s.is_empty()).unwrap_or_else(|| NONE.into()),
        inside: number(v.get("mm")).map_or_else(|| NONE.into(), |mm| format!("{mm:.2} mm")),
        metal: v.get("metal").and_then(Value::as_str).map(label).unwrap_or_default(),
        width: with_unit(v.get("width"), "mm"),
        wall: with_unit(v.get("wall"), "mm"),
        grams: number(v.get("grams")).map_or_else(|| NONE.into(), |g| format!("{g:.2} g")),
    }
}

/// How many decimal places the engine's amounts carry (0 for yen, 2 for most, 3 for a few): the
/// most any amount in the reply shows, so every amount prints to the same place.
fn decimals(cost: &Value) -> usize {
    let places = |v: Option<&Value>| -> usize {
        let Some(n) = number(v) else { return 0 };
        (0..=3usize).find(|d| ((n * 10f64.powi(*d as i32)).round() / 10f64.powi(*d as i32) - n).abs() < 1e-9).unwrap_or(3)
    };
    let lines = array(cost.get("lines"));
    lines.iter().take(MAX_COST_ROWS).map(|l| places(l.get("amount"))).chain([places(cost.get("total"))]).max().unwrap_or(0)
}

fn cost(v: &Value) -> Cost {
    let places = decimals(v);
    let money = |n: f64| format!("{n:.places$}");
    let lines = array(v.get("lines"))
        .iter()
        .take(MAX_COST_ROWS)
        .map(|l| {
            let unit = l.get("unit").and_then(Value::as_str).unwrap_or_default();
            let qty = match unit {
                // A stone line is priced by the carat: that is the quantity the rate applies to.
                "ct" => with_unit(l.get("carat"), "ct"),
                "g" => with_unit(l.get("qty"), "g"),
                "pc" => with_unit(l.get("qty"), "pc"),
                _ => String::new(),
            };
            CostLine {
                what: l.get("what").and_then(Value::as_str).map(label).unwrap_or_default(),
                qty,
                rate: number(l.get("rate"))
                    .map_or_else(|| NONE.into(), |r| format!("{}/{}", plain(r), if unit.is_empty() || unit == "flat" { "job" } else { unit })),
                amount: match number(l.get("amount")) {
                    Some(a) => money(a),
                    None => l.get("note").and_then(Value::as_str).map(label).unwrap_or_else(|| NONE.into()),
                },
            }
        })
        .collect();
    Cost {
        currency: v.get("currency").and_then(Value::as_str).map(|c| clean(c, 8)).unwrap_or_default(),
        total: number(v.get("total")).map_or_else(|| NONE.into(), money),
        note: v.get("note").and_then(Value::as_str).map(sentence).unwrap_or_default(),
        lines,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_made_safe_for_one_row() {
        assert_eq!(clean("  a\tb\n\u{1b}[31mc\u{202e}d  ", 40), "a b [31mc d");
        assert_eq!(clean(&"x".repeat(500), 10), format!("{}…", "x".repeat(10)));
        assert_eq!(clean("", 10), "");
        assert_eq!(clean("\u{0}\u{7}", 10), "");
        // Counted in characters, never cut inside one.
        assert_eq!(clean(&"é".repeat(20), 5), format!("{}…", "é".repeat(5)));
    }

    #[test]
    fn numbers_print_as_the_engine_wrote_them() {
        assert_eq!(plain(6.5), "6.5");
        assert_eq!(plain(19.0), "19");
        assert_eq!(plain(0.008), "0.008");
        assert_eq!(plain(1.0 / 3.0), "0.333");
        assert_eq!(number(Some(&json!("6"))), None);
        assert_eq!(with_unit(None, "mm"), NONE);
    }

    #[test]
    fn amounts_share_the_places_the_engine_used() {
        let usd = json!({"currency": "USD", "total": 5390.23, "lines": [{"what": "labor (flat)", "unit": "flat", "qty": 1, "rate": 180.0, "amount": 180.0}]});
        let c = cost(&usd);
        assert_eq!(c.total, "5390.23");
        assert_eq!(c.lines[0].amount, "180.00");
        assert_eq!(c.lines[0].rate, "180/job");
        let jpy = json!({"currency": "JPY", "total": 812000.0, "lines": [{"what": "gold18 band", "unit": "g", "qty": 3.53, "rate": 9800.0, "amount": 34594.0}]});
        let c = cost(&jpy);
        assert_eq!(c.total, "812000");
        assert_eq!(c.lines[0].amount, "34594");
        assert_eq!(c.lines[0].qty, "3.53 g");
        // A line with no price says why, in place of an amount.
        let unpriced = json!({"currency": "USD", "total": 0.0, "lines": [{"what": "ruby round 3 mm", "unit": "ct", "qty": 2, "carat": 0.2, "note": "no stone price for ruby"}]});
        let c = cost(&unpriced);
        assert_eq!(c.lines[0].amount, "no stone price for ruby");
        assert_eq!(c.lines[0].rate, NONE);
        assert_eq!(c.lines[0].qty, "0.2 ct");
    }

    #[test]
    fn a_reply_that_is_not_what_it_should_be_gives_the_empty_state() {
        for junk in [json!(null), json!(7), json!("piece"), json!([1, 2]), json!({"params": 5, "checks": "no", "size": [], "metal": 1})] {
            let d = PieceData::from_replies(Some(&junk), Some(&junk));
            assert!(d.checks.is_empty() && d.stones.is_empty(), "{junk}");
            assert_eq!(d.stone_count, "0");
        }
        let d = PieceData::from_replies(None, None);
        assert!(!d.has_piece);
        assert_eq!(d.title, "No piece in this drawing");
        assert_eq!(d.verdict(), "");
    }

    #[test]
    fn handles_are_left_out_of_the_json() {
        let piece = json!({"handles": ["1", "2"], "params": {"kind": "band"}, "stones": {"groups": [{"handles": ["3"], "cut": "round"}]}});
        let d = PieceData::from_replies(Some(&piece), None);
        let text = d.json.to_string();
        assert!(!text.contains("handles"), "{text}");
        assert!(text.contains("\"kind\":\"band\""), "{text}");
    }
}
