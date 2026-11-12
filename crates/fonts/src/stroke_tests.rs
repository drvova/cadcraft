//! Coverage, composition, fallback and hostile-input tests of the stroke font.

use crate::{char_advance, decode_controls, line_width, shape_stroke, stroke, substitute_glyph, ttf};

/// What ordinary Western drawings need beyond ASCII (the Latin-1 block is pinned separately).
const DRAFTING: &str = "¹²³⁰⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉°±Øø⌀×÷µ½¼¾⅓⅔⅛⅜⅝⅞’‘“”‚„′″–—−…•\u{A0}€™≤≥≠≈ΔΩŒœŁłŠšŽžŸıČčĚěŘřŐőŰűĄąĘęŞşĞğİ";

/// Number of characters the font draws: 95 ASCII, 95 of Latin-1 (all but the soft hyphen,
/// which is invisible), and 172 beyond.
const COVERED: usize = 362;

fn covered() -> Vec<char> {
    (0..=u32::from(char::MAX)).filter_map(char::from_u32).filter(|c| stroke::glyph(*c).is_some()).collect()
}

/// A missing-glyph box: a closed five-point rectangle from the baseline to the text height.
fn has_box(sh: &crate::Shaped, h: f64) -> bool {
    sh.strokes.iter().any(|s| {
        s.len() == 5
            && s.first() == s.last()
            && s.iter().all(|p| p.y.abs() < 1e-9 || (p.y - h).abs() < 1e-9)
            && s.iter().any(|p| (p.y - h).abs() < 1e-9)
    })
}

#[test]
fn coverage_is_pinned() {
    let all = covered();
    let listing: String = all.iter().filter(|c| !c.is_ascii()).collect();
    println!("{} glyphs; beyond ASCII: {listing}", all.len());
    for c in DRAFTING.chars() {
        assert!(stroke::glyph(c).is_some(), "no glyph for {c:?} (U+{:04X})", u32::from(c));
    }
    for c in '\u{A0}'..='\u{FF}' {
        assert!(stroke::glyph(c).is_some() || c == '\u{AD}', "no glyph for Latin-1 {c:?} (U+{:04X})", u32::from(c));
    }
    assert!(stroke::is_invisible('\u{AD}'), "the soft hyphen draws nothing");
    assert_eq!(all.len(), COVERED, "coverage changed: update COVERED");
}

#[test]
fn control_codes_map_to_glyphs() {
    for (c, _, _) in decode_controls("%%c %%d %%p %%% %%C%%D%%P") {
        assert!(stroke::glyph(c).is_some(), "control code decodes to {c:?}, which has no glyph");
    }
}

#[test]
fn every_glyph_stays_in_its_cell() {
    for c in covered() {
        let Some(g) = stroke::glyph(c) else { continue };
        assert!(g.width.is_finite() && g.width > 0.0 && g.width <= 6.0, "{c:?} width {}", g.width);
        for (x, y) in g.strokes().into_iter().flatten() {
            assert!((-1e-9..=g.width + 1e-9).contains(&x), "{c:?} x={x} outside 0..{}", g.width);
            assert!((-2.0..=8.0 + 1e-9).contains(&y), "{c:?} y={y}");
        }
        // Only the spaces are empty; every stroke has at least two points.
        let strokes = g.strokes();
        assert_eq!(strokes.is_empty(), c.is_whitespace(), "{c:?}");
        assert!(strokes.iter().all(|s| s.len() >= 2), "{c:?} has a one-point stroke");
    }
}

/// The apartment example labels its rooms "34.6 m²": every character the file uses is drawn by
/// the stroke font itself, so the web build (no installed fonts) shows no missing-glyph box.
#[test]
fn apartment_labels_have_no_missing_glyph() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/apartment.dxf");
    let text = std::fs::read_to_string(path).unwrap();
    let mut used: Vec<char> = text.chars().filter(|c| !c.is_ascii()).collect();
    // DXF also writes a character as `\U+XXXX`.
    used.extend(text.split("\\U+").skip(1).filter_map(|s| char::from_u32(u32::from_str_radix(s.get(..4)?, 16).ok()?)));
    used.sort_unstable();
    used.dedup();
    assert!(used.contains(&'²'), "the example no longer uses the superscript: {used:?}");
    for c in &used {
        assert!(stroke::glyph(*c).is_some(), "apartment.dxf uses {c:?} (U+{:04X}), which the stroke font lacks", u32::from(*c));
    }
    for label in ["34.6 m²", "16.4 m²", "7.7 m²", "58.7 m²"] {
        let sh = shape_stroke(label, 2.5, 1.0, 0.0);
        assert!(!has_box(&sh, 2.5), "{label:?} draws a missing-glyph box");
        assert!(sh.glyphs.is_empty(), "{label:?} takes a glyph from another font");
        assert!((line_width(label, 2.5, 1.0) - sh.width).abs() < 1e-9);
    }
}

#[test]
fn superscript_is_a_small_raised_digit() {
    for (sup, digit) in [('¹', '1'), ('²', '2'), ('³', '3'), ('⁴', '4'), ('⁰', '0'), ('⁹', '9')] {
        let (s, d) = (stroke::glyph(sup).unwrap(), stroke::glyph(digit).unwrap());
        assert!(s.width < d.width, "{sup:?} is not narrower than {digit:?}");
        assert!(char_advance(sup) < char_advance(digit));
        let (pts, full): (Vec<_>, Vec<_>) = (s.strokes().into_iter().flatten().collect(), d.strokes().into_iter().flatten().collect());
        // The same drawing, scaled: it stays in family with the digits beside it.
        assert_eq!(pts.len(), full.len());
        let k = s.width / d.width;
        for ((x, y), (fx, fy)) in pts.iter().zip(&full) {
            assert!((x - fx * k).abs() < 1e-9 && (y - (fy * k + 2.8)).abs() < 1e-9, "{sup:?} is not {digit:?} scaled");
        }
        let (lo, hi) = pts.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p.1), hi.max(p.1)));
        assert!(lo > 2.0, "{sup:?} reaches down to {lo}: not above the baseline");
        assert!(hi > stroke::CAP && hi < stroke::CAP * 1.1, "{sup:?} top at {hi}");
    }
    // Shaped: "m²" is narrower than "m2" and the superscript's ink is in the upper half.
    let (sq, two) = (shape_stroke("m²", 1.0, 1.0, 0.0), shape_stroke("m2", 1.0, 1.0, 0.0));
    assert!(sq.width < two.width);
    let m = shape_stroke("m", 1.0, 1.0, 0.0);
    let sup: Vec<_> = sq.strokes.iter().skip(m.strokes.len()).flatten().collect();
    assert!(!sup.is_empty() && sup.iter().all(|p| p.y > 0.4 && p.x > m.width), "superscript ink: {sup:?}");
    // A subscript hangs below the baseline and stays under the x-height.
    let sub: Vec<_> = stroke::glyph('₂').unwrap().strokes().into_iter().flatten().collect();
    assert!(sub.iter().any(|p| p.1 < 0.0) && sub.iter().all(|p| p.1 < 4.0));
}

#[test]
fn accented_letters_are_the_base_letter_with_a_mark() {
    for (c, base, cap) in [('é', 'e', false), ('É', 'E', true), ('ñ', 'n', false), ('Ü', 'U', true), ('å', 'a', false), ('ž', 'z', false)] {
        let (g, b) = (stroke::glyph(c).unwrap(), stroke::glyph(base).unwrap());
        assert_eq!(g.width, b.width, "{c:?} keeps the advance of {base:?}");
        let (gs, bs) = (g.strokes(), b.strokes());
        assert_eq!(gs.get(..bs.len()), Some(bs.as_slice()), "{c:?} starts with the strokes of {base:?}");
        let top = if cap { stroke::CAP } else { 4.0 };
        let mark: Vec<_> = gs.iter().skip(bs.len()).flatten().collect();
        assert!(!mark.is_empty() && mark.iter().all(|p| p.1 > top + 0.5), "{c:?} mark is not above the letter: {mark:?}");
    }
    // A mark below hangs from the baseline; a mark on i replaces its dot.
    let cedilla: Vec<_> = stroke::glyph('ç').unwrap().strokes().into_iter().skip(1).flatten().collect();
    assert!(cedilla.iter().all(|p| p.1 <= 0.0) && cedilla.iter().any(|p| p.1 < -1.0));
    assert_eq!(stroke::glyph('í').unwrap().strokes().len(), 2, "stem and acute, no dot");
    assert_eq!(stroke::glyph('ø').unwrap().strokes().iter().flatten().map(|p| p.1).fold(f64::MIN, f64::max), 4.0, "the lower-case ø is x-height");
}

#[test]
fn a_missing_character_degrades_before_it_boxes() {
    // The nearest character the font has, chosen without regard to installed fonts.
    for (c, base) in [('ħ', 'h'), ('Ŧ', 'T'), ('ķ', 'k'), ('‹', '<'), ('⁄', '/'), ('∆', 'Δ')] {
        assert!(stroke::glyph(c).is_none(), "{c:?} has its own glyph now: drop it from `substitute`");
        assert_eq!(substitute_glyph(c), stroke::glyph(base), "{c:?} should fall back to {base:?}");
    }
    // Every substitute is a character the font draws.
    for c in (0..=u32::from(char::MAX)).filter_map(char::from_u32) {
        if let Some(s) = stroke::substitute(c) {
            assert!(stroke::glyph(s).is_some(), "{c:?} substitutes {s:?}, which has no glyph");
        }
    }
    // Shaped, where no installed font draws it (always so on the web): the base letter, no box.
    for (c, base) in [('ħ', 'h'), ('ķ', 'k')] {
        if ttf::fallback_glyph(c).is_none() {
            let (sh, want) = (shape_stroke(&c.to_string(), 1.0, 1.0, 0.0), shape_stroke(&base.to_string(), 1.0, 1.0, 0.0));
            assert_eq!(sh, want, "{c:?} draws as {base:?}");
            assert!((line_width(&c.to_string(), 1.0, 1.0) - want.width).abs() < 1e-9);
        }
    }
    // A decomposed accent no font draws leaves the base letter; controls take no room.
    if ttf::fallback_glyph('\u{0301}').is_none() {
        assert_eq!(shape_stroke("e\u{0301}", 1.0, 1.0, 0.0), shape_stroke("e", 1.0, 1.0, 0.0));
        assert!((line_width("e\u{0301}", 1.0, 1.0) - line_width("e", 1.0, 1.0)).abs() < 1e-9);
    }
    let plain = shape_stroke("AB", 1.0, 1.0, 0.0);
    for hidden in ["A\u{0}B", "A\u{AD}B", "A\u{7F}\u{1B}B\u{FE0F}", "\u{200B}A\u{200D}B\u{FEFF}"] {
        let sh = shape_stroke(hidden, 1.0, 1.0, 0.0);
        assert_eq!(sh, plain, "{hidden:?}");
        assert!((line_width(hidden, 1.0, 1.0) - plain.width).abs() < 1e-9, "{hidden:?}");
    }
    // A character nothing can draw still shows: a drafter must see that something is missing.
    assert!(has_box(&shape_stroke("m\u{E000}", 1.0, 1.0, 0.0), 1.0));
    assert!(!has_box(&shape_stroke("m²", 1.0, 1.0, 0.0), 1.0));
}

#[test]
fn hostile_text_never_panics() {
    // Every scalar value through the font's own tables.
    for c in (0..=u32::from(char::MAX)).filter_map(char::from_u32) {
        let adv = char_advance(c);
        assert!(adv.is_finite() && (0.0..=2.0).contains(&adv), "{c:?} advance {adv}");
        if let Some(g) = stroke::glyph(c).or_else(|| substitute_glyph(c)) {
            assert!(g.strokes().iter().flatten().all(|p| p.0.is_finite() && p.1.is_finite()), "{c:?}");
        }
    }
    let finite = |sh: &crate::Shaped| sh.width.is_finite() && sh.outlines().iter().flatten().all(|p| p.x.is_finite() && p.y.is_finite());
    // Every character the font covers, in one line; and a long line.
    let all: String = covered().into_iter().collect();
    let long = "A²é\u{E000}\u{0}".repeat(40_000);
    // Only missing characters, only invisible ones, only controls and spaces.
    let missing = "\u{E000}\u{F8FF}\u{10FFFF}".repeat(2_000);
    let hidden = "\u{0}\u{1B}\u{7F}\u{9F}\u{AD}\u{200B}\u{200D}\u{2060}\u{FEFF}\u{FE0F}\u{E0100}".repeat(500);
    let blank = "\t\n\r\u{B}\u{C}\u{85}\u{A0}\u{2028}\u{3000} ".repeat(500);
    for s in [all.as_str(), long.as_str(), missing.as_str(), hidden.as_str(), blank.as_str(), "", "%%", "%%u%%o%%999999%%c"] {
        for (h, wf, oblique) in [(1.0, 1.0, 0.0), (0.0, 0.0, f64::NAN), (f64::INFINITY, -1.0, std::f64::consts::FRAC_PI_2), (1e-300, 1e300, -9.0)] {
            let sh = shape_stroke(s, h, wf, oblique);
            assert!(sh.width.is_finite() || !wf.is_finite() || wf.abs() > 1e100, "width {} at {h} x {wf}", sh.width);
            let _ = line_width(s, h, wf);
        }
        let sh = shape_stroke(s, 1.0, 1.0, 0.0);
        assert!(finite(&sh));
        assert!((line_width(s, 1.0, 1.0) - sh.width).abs() < 1e-6 * sh.width.max(1.0), "line_width disagrees with shape_stroke");
    }
    assert_eq!(shape_stroke(&hidden, 1.0, 1.0, 0.0).width, 0.0);
    assert!(shape_stroke(&hidden, 1.0, 1.0, 0.0).is_empty());
    // Every scalar value outside the scripts an installed font may draw (those go through the
    // font-file reader, which has its own hostile tests), in lines of 4096.
    let scalars: Vec<char> =
        (0..=0x2FFF_u32).chain(0xE000..=0xF8FF).chain(0xFFF0..=0xFFFF).chain(0x10_FF00..=0x10_FFFF).filter_map(char::from_u32).collect();
    for line in scalars.chunks(4096) {
        let s: String = line.iter().collect();
        assert!(finite(&shape_stroke(&s, 2.5, 0.8, 0.3)));
        assert!(line_width(&s, 2.5, 0.8).is_finite());
    }
}
