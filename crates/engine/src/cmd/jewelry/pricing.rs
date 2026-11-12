//! Pricing: a per-drawing price book, and the cost a bench sheet totals from it.
//!
//! A jeweler wants to know what a piece will cost in metal and stones. There are **no market
//! prices in the code** — a price is only ever what the caller supplied. `PRICEBOOK` stores a
//! price book in the drawing (metal per gram per alloy, stones per carat per material, and a
//! single labor figure), and `TECHSHEET` totals a `cost` from it when one is set (or when prices
//! are passed in the call). Everything the cost reports is an **estimate from the user's own
//! prices, not a market quote**.
//!
//! The book is kept as the group `JEWELRY_PRICEBOOK` (no members, its description one line of
//! JSON), the same way `PIECE` keeps its parameters: a group is part of the drawing, so a DXF
//! save and open carries the book with it.
//!
//! The price model, kept simple and honest:
//! - **metal** — a price per gram for each alloy (`gold18`, `platinum`, …), summed over the
//!   drawing's bands: `grams × price/gram`.
//! - **stone** — a price per carat for each material (`diamond`, `sapphire`, …), summed over the
//!   stones: `Σ carats × price/carat`. A `default` price, if the book gives one, prices a stone
//!   whose material the book does not name; without it such a stone is listed **unpriced** and
//!   left out of the total — never guessed.
//! - **labor** — one figure, `flat` (a sum for the piece), `perStone` (× the stone count) or
//!   `perGram` (× the metal weight).
//!
//! Every number is validated (finite, in `[0, MAX_PRICE]`), the currency is a short code, unknown
//! keys are ignored, and hostile input is refused, never acted on and never a panic. Amounts are
//! rounded to the currency's minor unit (2 decimal places for USD) and reported as a decimal.

use serde_json::{Map, Value, json};

use super::super::*;
use super::bench::JewelryFacts;
use super::*;
use super::{gem, sizes};

/// The block a drawing's price book is kept as: a definition with no geometry, its description one
/// line of JSON. A block (unlike a group, which the engine prunes when it has no members) is kept
/// in the drawing with nothing inserting it, and its description round-trips through DXF.
const BLOCK: &str = "JEWELRY_PRICEBOOK";
/// The largest price (per gram, per carat, or a labor figure) the book accepts. A number above it
/// is refused as hostile rather than stored, so nothing downstream can overflow.
const MAX_PRICE: f64 = 1.0e12;
/// The most entries one metal or stone map keeps (a hostile payload cannot flood the book).
const MAX_ENTRIES: usize = 512;

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("pricebook", "Price Book", run_pricebook)
            .menu(&["Inquiry", "Price Book"])
            .params(concat!(
                "{set?: {currency?: short code (default USD), metal?: {gold18|platinum|…: price per gram}, ",
                "stone?: {diamond|sapphire|…|default: price per carat}, labor?: number (flat) | {flat|perStone|perGram: amount}}, ",
                "query?: bool, clear?: bool} → {book: {currency, metal, stone, labor?}, message}. ",
                "Stored in the drawing and carried through DXF. `set` merges into the stored book; `clear` empties it; ",
                "`{}`/`query` reads it back. Every price is validated and the prices are the caller's own, never a market quote"
            ))
            .noundo(),
    ]
}

// ---------------------------------------------------------------------------------------------
// The stored book
// ---------------------------------------------------------------------------------------------

/// Read the stored price book as a canonical object (`{currency?, metal, stone, labor?}`). A
/// missing, foreign or unreadable group reads as an empty book, never an error.
pub(crate) fn stored_book(d: &cadcraft_doc::Drawing) -> Value {
    let empty = || json!({ "metal": {}, "stone": {} });
    let Some(b) = d.block(BLOCK) else { return empty() };
    let Ok(v) = serde_json::from_str::<Value>(&b.description) else { return empty() };
    // Re-canonicalise what was stored, so a hand-edited or hostile description never reaches the
    // costing with bad numbers in it.
    canonical(&v)
}

/// A canonical book built from any value, keeping only valid, in-range prices.
fn canonical(v: &Value) -> Value {
    let mut book = Map::new();
    let mut metal = Map::new();
    let mut stone = Map::new();
    if let Some(obj) = v.as_object() {
        if let Some(c) = obj.get("currency").and_then(|c| currency(c).ok().flatten()) {
            book.insert("currency".into(), json!(c));
        }
        read_prices(obj.get("metal"), is_metal_key, &mut metal);
        read_prices(obj.get("stone"), is_stone_key, &mut stone);
        if let Some(Ok(Some(l))) = obj.get("labor").map(labor_value) {
            book.insert("labor".into(), l);
        }
    }
    book.insert("metal".into(), Value::Object(metal));
    book.insert("stone".into(), Value::Object(stone));
    Value::Object(book)
}

/// Copy the valid prices of a `{key: number}` map into `out`, normalising keys and ignoring any
/// key this book does not understand (unknown keys are dropped, never stored).
fn read_prices(v: Option<&Value>, keep: impl Fn(&str) -> Option<String>, out: &mut Map<String, Value>) {
    let Some(obj) = v.and_then(Value::as_object) else { return };
    for (k, val) in obj.iter().take(MAX_ENTRIES) {
        let (Some(key), Some(price)) = (keep(k), price(val)) else { continue };
        out.insert(key, json!(price));
    }
}

/// A metal map key kept when it names an alloy the bench knows, normalised to that alloy's name.
fn is_metal_key(k: &str) -> Option<String> {
    let n = k.trim().to_ascii_lowercase();
    sizes::density_of(&n).map(|_| n)
}

/// A stone map key kept when it names a material the bench knows (or the `default` fall-back).
fn is_stone_key(k: &str) -> Option<String> {
    let n = k.trim().to_ascii_lowercase();
    if n == "default" || gem::sg_of(&n).is_some() { Some(n) } else { None }
}

/// A validated price: finite and in `[0, MAX_PRICE]`, else `None`.
fn price(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite() && *x >= 0.0 && *x <= MAX_PRICE)
}

/// A currency code: a short run of letters/digits, upper-cased. `Ok(None)` for an absent value,
/// `Err` for anything that is present but not a short code.
fn currency(v: &Value) -> Result<Option<String>> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) => {
            let t = s.trim();
            if !t.is_empty() && t.len() <= 8 && t.chars().all(|c| c.is_ascii_alphanumeric()) {
                Ok(Some(t.to_ascii_uppercase()))
            } else {
                Err(bad("pricebook", "`currency` must be a short code such as \"USD\""))
            }
        }
        _ => Err(bad("pricebook", "`currency` must be a short code such as \"USD\"")),
    }
}

/// A labor figure from `set`: a bare number is a flat sum; an object names `flat`, `perStone` or
/// `perGram`. `Ok(None)` when nothing recognisable is given.
fn labor_value(v: &Value) -> Result<Option<Value>> {
    match v {
        Value::Null => Ok(None),
        Value::Number(_) => match price(v) {
            Some(amount) => Ok(Some(json!({ "mode": "flat", "amount": amount }))),
            None => Err(bad("pricebook", "`labor` must be a number from 0 to a sane maximum")),
        },
        Value::Object(obj) => {
            // The canonical stored form, `{mode, amount}` — so a book re-read from the drawing
            // keeps its labor.
            if let (Some(mode), Some(amount)) = (obj.get("mode").and_then(Value::as_str), obj.get("amount").and_then(price))
                && matches!(mode, "flat" | "perStone" | "perGram")
            {
                return Ok(Some(json!({ "mode": mode, "amount": amount })));
            }
            // The `set` form, `{flat|perStone|perGram: amount}`.
            for mode in ["flat", "perStone", "perGram"] {
                if let Some(val) = obj.get(mode).filter(|v| !v.is_null()) {
                    let amount = price(val).ok_or_else(|| bad("pricebook", format!("`labor.{mode}` must be a number from 0 to a sane maximum")))?;
                    return Ok(Some(json!({ "mode": mode, "amount": amount })));
                }
            }
            Ok(None)
        }
        _ => Err(bad("pricebook", "`labor` must be a number, or {flat|perStone|perGram: amount}")),
    }
}

// ---------------------------------------------------------------------------------------------
// PRICEBOOK
// ---------------------------------------------------------------------------------------------

fn run_pricebook(s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "pricebook";
    // A read when nothing is asked for, or `query` is set.
    let query = bool_param(cmd, p, "query")?;
    let clear = bool_param(cmd, p, "clear")?;
    let set = p.get("set").filter(|v| !v.is_null());
    if clear && set.is_some() {
        return Err(bad(cmd, "give `set` or `clear`, not both"));
    }

    if clear {
        s.doc_mut()?.blocks.remove(BLOCK);
        s.touch();
        return Ok(reply(&json!({ "metal": {}, "stone": {} }), "Price book cleared."));
    }

    if let Some(raw) = set {
        // Validate the whole patch before touching the drawing: all or nothing.
        let patch = validate_set(cmd, raw)?;
        let mut book = stored_book(s.doc()?);
        merge(&mut book, &patch);
        let desc = serde_json::to_string(&book).map_err(|e| bad(cmd, format!("cannot store the price book: {e}")))?;
        let mut b = cadcraft_doc::Block::new(BLOCK);
        b.description = desc;
        s.doc_mut()?.blocks.insert(BLOCK.to_string(), std::sync::Arc::new(b));
        s.touch();
        return Ok(reply(&book, "Price book updated."));
    }

    let _ = query;
    let book = stored_book(s.doc()?);
    let message = if is_empty(&book) { "No prices set yet." } else { "Price book." };
    Ok(reply(&book, message))
}

/// A book for a `TECHSHEET` call: the stored book, with any prices passed inline (`price`)
/// validated and merged over it. Hostile inline prices are refused.
pub(crate) fn with_inline(cmd: &str, mut book: Value, inline: Option<&Value>) -> Result<Value> {
    if let Some(raw) = inline.filter(|v| !v.is_null()) {
        let patch = validate_set(cmd, raw)?;
        merge(&mut book, &patch);
    }
    Ok(book)
}

/// Validate a `set` payload into a canonical patch, refusing hostile input rather than storing it.
fn validate_set(cmd: &str, raw: &Value) -> Result<Value> {
    let Some(obj) = raw.as_object() else { return Err(bad(cmd, "`set` must be an object of prices")) };
    let mut patch = Map::new();
    if let Some(c) = currency(obj.get("currency").unwrap_or(&Value::Null))? {
        patch.insert("currency".into(), json!(c));
    }
    patch.insert("metal".into(), prices_of(cmd, obj.get("metal"), "metal", is_metal_key)?);
    patch.insert("stone".into(), prices_of(cmd, obj.get("stone"), "stone", is_stone_key)?);
    if let Some(l) = labor_value(obj.get("labor").unwrap_or(&Value::Null))? {
        patch.insert("labor".into(), l);
    }
    Ok(Value::Object(patch))
}

/// The validated prices of one `set` sub-map. A value present but not a valid price is refused
/// (so a NaN, a negative, a huge number or a wrong type never slips in); an unknown key is
/// ignored.
fn prices_of(cmd: &str, v: Option<&Value>, what: &str, keep: impl Fn(&str) -> Option<String>) -> Result<Value> {
    let mut out = Map::new();
    match v {
        None | Some(Value::Null) => {}
        Some(Value::Object(obj)) => {
            for (k, val) in obj.iter().take(MAX_ENTRIES) {
                let Some(key) = keep(k) else { continue };
                let p = price(val).ok_or_else(|| bad(cmd, format!("`{what}.{k}` must be a price from 0 to a sane maximum")))?;
                out.insert(key, json!(p));
            }
        }
        Some(_) => return Err(bad(cmd, format!("`{what}` must be an object of prices"))),
    }
    Ok(Value::Object(out))
}

/// Merge a canonical patch over a canonical book: metal and stone prices merge key by key,
/// currency and labor replace.
fn merge(book: &mut Value, patch: &Value) {
    let (Some(book), Some(patch)) = (book.as_object_mut(), patch.as_object()) else { return };
    if let Some(c) = patch.get("currency") {
        book.insert("currency".into(), c.clone());
    }
    if let Some(l) = patch.get("labor") {
        book.insert("labor".into(), l.clone());
    }
    for map in ["metal", "stone"] {
        let into = book.entry(map).or_insert_with(|| json!({}));
        if let (Some(into), Some(from)) = (into.as_object_mut(), patch.get(map).and_then(Value::as_object)) {
            for (k, v) in from {
                into.insert(k.clone(), v.clone());
            }
        }
    }
}

/// Whether a book holds no prices at all.
fn is_empty(book: &Value) -> bool {
    let metal_empty = book.get("metal").and_then(Value::as_object).is_none_or(Map::is_empty);
    let stone_empty = book.get("stone").and_then(Value::as_object).is_none_or(Map::is_empty);
    metal_empty && stone_empty && book.get("labor").is_none()
}

/// The command's reply: the book under `book`, and a line.
fn reply(book: &Value, message: &str) -> Value {
    json!({ "book": book, "message": message })
}

// ---------------------------------------------------------------------------------------------
// The cost a bench sheet totals
// ---------------------------------------------------------------------------------------------

/// The number of decimal places a currency's minor unit has (2 for most; a few have 0 or 3).
fn minor_digits(currency: &str) -> i32 {
    match currency {
        "JPY" | "KRW" | "VND" | "CLP" | "ISK" | "XOF" | "XAF" => 0,
        "BHD" | "KWD" | "OMR" | "JOD" | "TND" | "IQD" => 3,
        _ => 2,
    }
}

/// Round an amount to a currency's minor unit, expressed in whole minor units (cents).
fn to_minor(amount: f64, scale: f64) -> f64 {
    (amount * scale).round()
}

/// The cost a bench sheet reports for `facts` priced by `book`, or `None` when nothing can be
/// costed. `section_metal` is the band weighed from a cross-section in this `TECHSHEET` call, if
/// any, so the metal it found is costed too.
pub(crate) fn cost_for(book: &Value, facts: &JewelryFacts, section_metal: Option<(String, f64)>) -> Option<Value> {
    let metal_prices = book.get("metal").and_then(Value::as_object);
    let stone_prices = book.get("stone").and_then(Value::as_object);
    let labor = book.get("labor");
    let has_any = metal_prices.is_some_and(|m| !m.is_empty()) || stone_prices.is_some_and(|m| !m.is_empty()) || labor.is_some();
    if !has_any {
        return None;
    }

    let currency = book.get("currency").and_then(Value::as_str).unwrap_or("USD").to_string();
    let scale = 10f64.powi(minor_digits(&currency).max(0));
    let decimal = |minor: f64| (minor / scale * 1000.0).round() / 1000.0;

    let mut lines: Vec<Value> = Vec::new();
    let mut metal_minor = 0.0f64;
    let mut stone_minor = 0.0f64;
    let mut total_stones = 0u64;
    let mut total_grams = 0.0f64;
    let mut unpriced = 0usize;

    // Metal: every band, plus the cross-section band this call weighed.
    let mut metal_entries: Vec<(String, String, f64)> = Vec::new();
    for b in &facts.bands {
        let alloy = b.get("metal").and_then(Value::as_str).unwrap_or("?").to_string();
        let grams = b.get("grams").and_then(Value::as_f64).filter(|g| g.is_finite() && *g >= 0.0).unwrap_or(0.0);
        let size = b.get("size").and_then(Value::as_str).unwrap_or("band");
        metal_entries.push((format!("{alloy} band ({size})"), alloy, grams));
    }
    if let Some((alloy, grams)) = section_metal.filter(|(_, g)| g.is_finite() && *g >= 0.0) {
        metal_entries.push((format!("{alloy} band (cross-section)"), alloy, grams));
    }
    for (what, alloy, grams) in metal_entries {
        total_grams += grams;
        let qty = size_json(grams);
        match metal_prices.and_then(|m| m.get(&alloy.to_ascii_lowercase())).and_then(Value::as_f64) {
            Some(rate) => {
                let minor = to_minor(grams * rate, scale);
                metal_minor += minor;
                lines.push(json!({ "what": what, "metal": alloy, "qty": qty, "unit": "g", "rate": rate, "amount": decimal(minor) }));
            }
            None => {
                unpriced += 1;
                lines.push(json!({ "what": what, "metal": alloy, "qty": qty, "unit": "g", "note": format!("no metal price for {alloy}") }));
            }
        }
    }

    // Stones: every group, by its material (diamond when the stone carries none).
    for (g, material) in facts.groups.iter().zip(&facts.materials) {
        let cut = g.get("cut").and_then(Value::as_str).unwrap_or("stone");
        let w = g.get("width").and_then(Value::as_f64).unwrap_or(0.0);
        let l = g.get("length").and_then(Value::as_f64).unwrap_or(w);
        let count = g.get("count").and_then(Value::as_u64).unwrap_or(0);
        let carat = g.get("carat").and_then(Value::as_f64).filter(|c| c.is_finite() && *c >= 0.0).unwrap_or(0.0);
        let size = if (l - w).abs() < 1e-6 { format!("{} mm", size_json(w)) } else { format!("{}×{} mm", size_json(l), size_json(w)) };
        let mat_label = material.clone().unwrap_or_else(|| "unspecified".to_string());
        let what = format!("{mat_label} {cut} {size}");
        total_stones += count;
        let carat = (carat * 1000.0).round() / 1000.0;
        let rate = material
            .as_deref()
            .and_then(|m| stone_prices.and_then(|s| s.get(m)))
            .or_else(|| stone_prices.and_then(|s| s.get("default")))
            .and_then(Value::as_f64);
        match rate {
            Some(rate) => {
                let minor = to_minor(carat * rate, scale);
                stone_minor += minor;
                lines.push(
                    json!({ "what": what, "material": material, "qty": count, "carat": carat, "unit": "ct", "rate": rate, "amount": decimal(minor) }),
                );
            }
            None => {
                unpriced += 1;
                let why = match material {
                    Some(m) => format!("no stone price for {m}"),
                    None => "no stone price (material unspecified)".to_string(),
                };
                lines.push(json!({ "what": what, "material": material, "qty": count, "carat": carat, "unit": "ct", "note": why }));
            }
        }
    }

    // Labor: one figure in the chosen model.
    let mut labor_minor = 0.0f64;
    let mut labor_json = Value::Null;
    if let Some(l) = labor.and_then(Value::as_object) {
        let mode = l.get("mode").and_then(Value::as_str).unwrap_or("flat");
        let amount = l.get("amount").and_then(Value::as_f64).filter(|a| a.is_finite() && *a >= 0.0).unwrap_or(0.0);
        let (figure, qty, unit) = match mode {
            "perStone" => (amount * total_stones as f64, json!(total_stones), "pc"),
            "perGram" => (amount * total_grams, json!(size_json(total_grams)), "g"),
            _ => (amount, json!(1), "flat"),
        };
        labor_minor = to_minor(figure, scale);
        let amt = decimal(labor_minor);
        lines.push(json!({ "what": format!("labor ({mode})"), "qty": qty, "unit": unit, "rate": amount, "amount": amt }));
        labor_json = json!(amt);
    }

    // Nothing to show (prices set, but the drawing holds no metal, no stones and no labor).
    if lines.is_empty() {
        return None;
    }

    let total = metal_minor + stone_minor + labor_minor;
    let mut cost = json!({
        "currency": currency,
        "metal": decimal(metal_minor),
        "stones": decimal(stone_minor),
        "total": decimal(total),
        "lines": lines,
        "unpriced": unpriced,
        "note": "Estimate from the prices you set, not a market quote.",
    });
    if let (Some(obj), Value::Number(_)) = (cost.as_object_mut(), &labor_json) {
        obj.insert("labor".into(), labor_json);
    }
    Some(cost)
}

/// A boolean parameter, refused when present but not a boolean.
fn bool_param(cmd: &str, p: &Value, key: &str) -> Result<bool> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(bad(cmd, format!("`{key}` must be true or false"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Session;

    fn mm() -> Session {
        let mut s = Session::new();
        s.execute("setvar", &json!({ "name": "INSUNITS", "value": 4 })).unwrap();
        s
    }

    fn book(s: &mut Session) -> Value {
        s.execute("pricebook", &json!({})).unwrap()["book"].clone()
    }

    #[test]
    fn a_book_round_trips_through_set_query_and_clear() {
        let mut s = mm();
        // Empty to start.
        assert!(is_empty(&book(&mut s)));
        // Set merges in prices.
        let r = s
            .execute(
                "pricebook",
                &json!({ "set": { "currency": "usd", "metal": { "gold18": 62.5 }, "stone": { "diamond": 1200.0 }, "labor": 80.0 } }),
            )
            .unwrap();
        assert_eq!(r["book"]["currency"], "USD", "currency is upper-cased");
        assert_eq!(r["book"]["metal"]["gold18"], 62.5);
        assert_eq!(r["book"]["stone"]["diamond"], 1200.0);
        assert_eq!(r["book"]["labor"], json!({ "mode": "flat", "amount": 80.0 }));
        // A second set merges, keeping what it does not mention.
        s.execute("pricebook", &json!({ "set": { "metal": { "platinum": 70.0 }, "labor": { "perStone": 5.0 } } })).unwrap();
        let b = book(&mut s);
        assert_eq!(b["metal"]["gold18"], 62.5, "earlier metal price kept");
        assert_eq!(b["metal"]["platinum"], 70.0, "new metal price added");
        assert_eq!(b["labor"], json!({ "mode": "perStone", "amount": 5.0 }), "labor replaced");
        // Query changes nothing.
        assert_eq!(book(&mut s), b);
        // Clear empties it.
        let c = s.execute("pricebook", &json!({ "clear": true })).unwrap();
        assert!(is_empty(&c["book"]));
        assert!(is_empty(&book(&mut s)));
    }

    #[test]
    fn a_book_round_trips_through_dxf() {
        let mut s = mm();
        s.execute("pricebook", &json!({ "set": { "currency": "EUR", "metal": { "gold14": 40.0 }, "stone": { "sapphire": 300.0, "default": 25.0 }, "labor": { "perGram": 9.0 } } }))
            .unwrap();
        let before = book(&mut s);
        let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
        let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
        let mut t = Session::new();
        t.open_drawing(read, "reopened", None);
        assert_eq!(book(&mut t), before, "the price book survives a DXF save and open");
    }

    #[test]
    fn metal_and_stone_costs_are_correct_for_a_worked_example() {
        let mut s = mm();
        // A size-6 band in 18k gold: RING records grams=3.22 in its description.
        s.execute("ring", &json!({ "at": [0, 0], "size": 6, "wall": 1.8, "width": 2.0 })).unwrap();
        // Two 7×5 emerald-cut diamonds.
        s.execute("gem", &json!({ "at": [20, 0], "cut": "emerald", "length": 7, "width": 5 })).unwrap();
        s.execute("gem", &json!({ "at": [30, 0], "cut": "emerald", "length": 7, "width": 5 })).unwrap();
        // The bare sheet gives the grams and carats the cost is built from.
        let plain = s.execute("techsheet", &json!({})).unwrap();
        assert!(plain.get("cost").is_none(), "no prices, no cost");
        let grams = plain["bands"][0]["grams"].as_f64().unwrap();
        assert!((grams - 3.22).abs() < 1e-9, "band grams: {grams}");
        let carat = plain["stones"]["carat"].as_f64().unwrap();
        // Price the book: gold18 at $50/g, diamond at $500/ct, flat $100 labor.
        s.execute("pricebook", &json!({ "set": { "metal": { "gold18": 50.0 }, "stone": { "diamond": 500.0 }, "labor": 100.0 } })).unwrap();
        let sheet = s.execute("techsheet", &json!({})).unwrap();
        let cost = &sheet["cost"];
        assert_eq!(cost["currency"], "USD");
        // Metal: 3.22 g × $50 = $161.00.
        assert_eq!(cost["metal"], json!(161.0), "metal cost");
        // Stones: carat × $500, rounded to the cent.
        let expect_stones = (carat * 500.0 * 100.0).round() / 100.0;
        assert_eq!(cost["stones"].as_f64().unwrap(), expect_stones, "stone cost from {carat} ct");
        assert_eq!(cost["labor"], json!(100.0), "flat labor");
        let total = 161.0 + expect_stones + 100.0;
        assert!((cost["total"].as_f64().unwrap() - total).abs() < 1e-9, "total");
        assert_eq!(cost["unpriced"], json!(0));
    }

    #[test]
    fn labor_models_each_apply() {
        let mut s = mm();
        s.execute("ring", &json!({ "at": [0, 0], "size": 6, "wall": 1.8, "width": 2.0 })).unwrap();
        s.execute("gem", &json!({ "at": [20, 0], "cut": "round", "width": 3 })).unwrap();
        s.execute("gem", &json!({ "at": [26, 0], "cut": "round", "width": 3 })).unwrap();
        let plain = s.execute("techsheet", &json!({})).unwrap();
        let grams = plain["bands"][0]["grams"].as_f64().unwrap();
        // perStone: $7 × 2 stones = $14.
        s.execute("pricebook", &json!({ "set": { "labor": { "perStone": 7.0 } } })).unwrap();
        let per_stone = s.execute("techsheet", &json!({})).unwrap();
        assert_eq!(per_stone["cost"]["labor"], json!(14.0));
        // perGram: $10 × grams.
        s.execute("pricebook", &json!({ "set": { "labor": { "perGram": 10.0 } } })).unwrap();
        let per_gram = s.execute("techsheet", &json!({})).unwrap();
        let expect = (grams * 10.0 * 100.0).round() / 100.0;
        assert_eq!(per_gram["cost"]["labor"].as_f64().unwrap(), expect);
    }

    #[test]
    fn a_stone_with_no_price_is_unpriced_never_guessed() {
        let mut s = mm();
        s.execute("gem", &json!({ "at": [0, 0], "cut": "round", "width": 3, "stone": "sapphire" })).unwrap();
        s.execute("pricebook", &json!({ "set": { "stone": { "diamond": 500.0 } } })).unwrap();
        let sheet = s.execute("techsheet", &json!({})).unwrap();
        let cost = &sheet["cost"];
        assert_eq!(cost["stones"], json!(0.0), "the sapphire adds nothing to the total");
        assert_eq!(cost["total"], json!(0.0));
        assert_eq!(cost["unpriced"], json!(1));
        let line = &cost["lines"][0];
        assert!(line.get("amount").is_none(), "an unpriced line carries no amount");
        assert_eq!(line["qty"], json!(1), "but keeps the quantity");
        assert!(line["carat"].as_f64().unwrap() > 0.0, "and the carats");
        assert!(line["note"].as_str().unwrap().contains("sapphire"));
    }

    #[test]
    fn a_default_price_covers_a_stone_the_book_does_not_name() {
        let mut s = mm();
        s.execute("gem", &json!({ "at": [0, 0], "cut": "round", "width": 3, "stone": "ruby" })).unwrap();
        s.execute("pricebook", &json!({ "set": { "stone": { "default": 30.0 } } })).unwrap();
        let cost = s.execute("techsheet", &json!({})).unwrap()["cost"].clone();
        assert!(cost["stones"].as_f64().unwrap() > 0.0, "the default prices the ruby");
        assert_eq!(cost["unpriced"], json!(0));
    }

    #[test]
    fn prices_can_be_passed_in_the_call_without_a_stored_book() {
        let mut s = mm();
        s.execute("ring", &json!({ "at": [0, 0], "size": 6, "wall": 1.8, "width": 2.0 })).unwrap();
        let sheet = s.execute("techsheet", &json!({ "price": { "metal": { "gold18": 50.0 } } })).unwrap();
        assert_eq!(sheet["cost"]["metal"], json!(161.0));
        // No book was stored by passing a price inline.
        assert!(is_empty(&book(&mut s)));
    }

    #[test]
    fn the_plain_sheet_is_unchanged_when_no_book_is_set() {
        let mut s = mm();
        s.execute("ring", &json!({ "at": [0, 0], "size": 6, "wall": 1.8, "width": 2.0 })).unwrap();
        s.execute("gem", &json!({ "at": [20, 0], "cut": "round", "width": 3 })).unwrap();
        let sheet = s.execute("techsheet", &json!({})).unwrap();
        assert!(sheet.get("cost").is_none(), "no `cost` field with no prices");
        // The fields the sheet has always reported are all present and unchanged in shape.
        for key in ["stones", "bands", "warnings", "metal", "table", "message"] {
            assert!(sheet.get(key).is_some(), "{key} is still reported");
        }
        assert!(sheet["stones"].get("count").is_some());
        assert!(sheet["stones"].get("carat").is_some());
        assert!(sheet["stones"].get("groups").is_some());
    }

    #[test]
    fn hostile_prices_never_panic_and_are_refused() {
        let mut s = mm();
        let hostile = [
            json!({ "set": { "metal": { "gold18": f64::NAN } } }),
            json!({ "set": { "metal": { "gold18": -5.0 } } }),
            json!({ "set": { "metal": { "gold18": 1.0e300 } } }),
            json!({ "set": { "stone": { "diamond": "lots" } } }),
            json!({ "set": { "stone": { "diamond": [1, 2, 3] } } }),
            json!({ "set": { "labor": "cheap" } }),
            json!({ "set": { "labor": { "perStone": -1.0 } } }),
            json!({ "set": { "currency": "US DOLLARS PLEASE" } }),
            json!({ "set": { "currency": 42 } }),
            json!({ "set": "not an object" }),
            json!({ "set": { "metal": "not an object" } }),
            json!({ "query": "yes" }),
            json!({ "clear": 1 }),
        ];
        for h in hostile {
            assert!(s.execute("pricebook", &h).is_err(), "refused: {h}");
        }
        // Each refusal left the drawing's book untouched (empty, no stray block).
        assert!(is_empty(&book(&mut s)));
        assert!(s.doc().unwrap().block(BLOCK).is_none());
        // A hostile inline price on techsheet is refused, and the sheet is not produced.
        assert!(s.execute("techsheet", &json!({ "price": { "metal": { "gold18": f64::NAN } } })).is_err());
        // NaN as JSON null is simply ignored (serde cannot carry NaN); a wrong type is refused.
        assert!(s.execute("pricebook", &json!({ "set": { "metal": { "gold18": { "x": 1 } } } })).is_err());
    }

    #[test]
    fn unknown_keys_are_ignored() {
        let mut s = mm();
        s.execute("pricebook", &json!({ "set": { "metal": { "unobtanium": 5.0, "gold18": 50.0 }, "stone": { "kryptonite": 9.0 }, "mystery": 1 } }))
            .unwrap();
        let b = book(&mut s);
        assert_eq!(b["metal"]["gold18"], 50.0);
        assert!(b["metal"].get("unobtanium").is_none(), "an unknown alloy is dropped");
        assert!(b["stone"].get("kryptonite").is_none(), "an unknown material is dropped");
        assert!(b.get("mystery").is_none());
    }
}
