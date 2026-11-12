//! "CADCraft Stroke": an original single-stroke drafting font, designed for CADCraft on a
//! small grid (public domain / CC0 as part of this codebase).
//!
//! A drawn glyph is `(width, strokes)`. A stroke is a run of points; each point is two
//! characters: an x digit `0..=6` and a y letter where `a` = -2, `c` = 0 (baseline), `g` = 4
//! (x-height), `i` = 6 (cap height). Strokes are separated by spaces.
//!
//! Characters with no drawing of their own are composed from the drawn ones, so they stay in
//! family: superscripts, subscripts and fractions are scaled digits, an accented letter is its
//! base letter with one of the accent marks of [`Accent`] placed above or below it. A [`Glyph`]
//! is therefore up to three drawn parts, each scaled and moved.

pub(crate) const CAP: f64 = 6.0;
pub(crate) const GAP: f64 = 1.6;

/// Scale of a superscript or subscript, relative to the full-size glyph.
const SMALL: f64 = 0.6;
/// Rise of a superscript drawn from a cap-height glyph: its top sits just above the cap height.
const SUPERSCRIPT_RISE: f64 = 2.8;
/// Rise of a superscript drawn from an x-height letter (the ordinal indicators).
const SUPERSCRIPT_RISE_SHORT: f64 = 4.0;
/// Drop of a subscript: it hangs below the baseline by a fifth of the cap height.
const SUBSCRIPT_DROP: f64 = -1.2;
/// Scale of the digits of a fraction, and of the letter inside a circled sign.
const HALF: f64 = 0.5;
/// Vertical scale of an accent mark above a letter (marks are drawn two units tall).
const ACCENT_SCALE: f64 = 0.6;
/// Where an accent mark starts above an x-height letter, and above a cap-height letter.
const ACCENT_LOW: f64 = 4.8;
const ACCENT_HIGH: f64 = 6.8;

/// One drawn part of a glyph: a stroke string, scaled then moved (in font units).
#[derive(Clone, Copy, Debug, PartialEq)]
struct Part {
    spec: &'static str,
    sx: f64,
    sy: f64,
    dx: f64,
    dy: f64,
}

const NO_PART: Part = Part { spec: "", sx: 1.0, sy: 1.0, dx: 0.0, dy: 0.0 };

impl Part {
    const fn plain(spec: &'static str) -> Part {
        Part { spec, ..NO_PART }
    }
    /// `spec` scaled uniformly by `k`, its origin moved to `(dx, dy)`.
    const fn scaled(spec: &'static str, k: f64, dx: f64, dy: f64) -> Part {
        Part { spec, sx: k, sy: k, dx, dy }
    }
}

/// A glyph of the stroke font: its width (the advance is `width + GAP`) and its parts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Glyph {
    pub(crate) width: f64,
    parts: [Part; 3],
}

impl Glyph {
    const fn new(width: f64, a: Part, b: Part, c: Part) -> Glyph {
        Glyph { width, parts: [a, b, c] }
    }
    /// The glyph's strokes as point lists in font units.
    pub(crate) fn strokes(&self) -> Vec<Vec<(f64, f64)>> {
        let mut out = Vec::new();
        for p in &self.parts {
            for stroke in decode(p.spec) {
                out.push(stroke.into_iter().map(|(x, y)| (x * p.sx + p.dx, y * p.sy + p.dy)).collect());
            }
        }
        out
    }
}

/// The glyph of `c`: drawn, or composed from drawn glyphs. `None` when the font lacks it.
pub(crate) fn glyph(c: char) -> Option<Glyph> {
    if let Some((w, spec)) = drawn(c) {
        return Some(Glyph::new(w, Part::plain(spec), NO_PART, NO_PART));
    }
    if c.is_ascii() {
        return None;
    }
    composed(c)
}

/// A character the font lacks, as the nearest one it has: a letter without the mark or stroke
/// the font cannot compose, a punctuation mark as its plain form. A reader sees the right
/// letter rather than a missing-glyph box.
pub(crate) fn substitute(c: char) -> Option<char> {
    const LETTERS: (&str, &str) = ("ĢģĶķĻļŅņŖŗŢţĦħĿŀŊŋŦŧſĸŉĲĳ", "GgKkLlNnRrTtHhLlNnTtsknJj");
    let plain = match c {
        '‹' => '<',
        '›' => '>',
        '‛' => '’',
        '‟' => '”',
        '‒' | '―' => '-',
        '⁄' | '∕' => '/',
        '∗' => '*',
        '∼' => '~',
        '∙' | '‧' => '·',
        '∆' => 'Δ',
        _ => return LETTERS.0.chars().zip(LETTERS.1.chars()).find(|(k, _)| *k == c).map(|(_, base)| base),
    };
    Some(plain)
}

/// Characters that draw nothing and take no room: control characters that are not spacing,
/// the soft hyphen, the grapheme joiner and variation selectors.
pub(crate) fn is_invisible(c: char) -> bool {
    (c.is_control() && !c.is_whitespace()) || matches!(u32::from(c), 0xAD | 0x034F | 0xFE00..=0xFE0F | 0xE0100..=0xE01EF)
}

/// A combining diacritical mark. The stroke font does not place one on the letter before it:
/// with no installed font to draw it, a decomposed accented letter keeps its base letter.
pub(crate) fn is_combining(c: char) -> bool {
    matches!(u32::from(c), 0x0300..=0x034E | 0x0350..=0x036F)
}

/// An accent mark. Each is drawn in a cell four units wide, centred on x = 2: marks above a
/// letter are two units tall from `c` and are flattened by [`ACCENT_SCALE`]; marks below hang
/// from the baseline at full size.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Accent {
    Grave,
    Acute,
    Circumflex,
    Tilde,
    Diaeresis,
    Ring,
    Caron,
    Macron,
    Breve,
    Dot,
    DoubleAcute,
    Cedilla,
    Ogonek,
}

impl Accent {
    fn spec(self) -> &'static str {
        match self {
            Accent::Grave => "1e3c",
            Accent::Acute => "1c3e",
            Accent::Circumflex => "1c2e3c",
            Accent::Tilde => "0d1e3c4d",
            Accent::Diaeresis => "1d1e 3d3e",
            // A small diamond, as the degree sign is.
            Accent::Ring => "2c1d2e3d2c",
            Accent::Caron => "1e2c3e",
            Accent::Macron => "1d3d",
            Accent::Breve => "1e1d2c3d3e",
            Accent::Dot => "2d2e",
            Accent::DoubleAcute => "1c2e 2c3e",
            // A hook from the middle of the baseline.
            Accent::Cedilla => "2c3b2a1a",
            // A hook from the right foot.
            Accent::Ogonek => "4c3b4a",
        }
    }
    fn is_above(self) -> bool {
        !matches!(self, Accent::Cedilla | Accent::Ogonek)
    }
    /// The mark for a letter `width` wide whose marks centre on `cx`; `tall` letters (capitals,
    /// ascenders) carry it above the cap height.
    fn part(self, width: f64, cx: f64, tall: bool) -> Part {
        let sx = (width / 4.0).clamp(0.5, 1.0);
        let spec = self.spec();
        match self {
            Accent::Ogonek => Part { spec, sx, sy: 1.0, dx: width - 4.0 * sx, dy: 0.0 },
            Accent::Cedilla => Part { spec, sx, sy: 1.0, dx: cx - 2.0 * sx, dy: 0.0 },
            _ => Part { spec, sx, sy: ACCENT_SCALE, dx: cx - 2.0 * sx, dy: if tall { ACCENT_HIGH } else { ACCENT_LOW } },
        }
    }
}

/// Accented letters of Latin-1 and Latin Extended-A: per accent, the letters and their bases.
const ACCENTED: &[(Accent, &str, &str)] = &[
    (Accent::Grave, "ÀÈÌÒÙàèìòù", "AEIOUaeiou"),
    (Accent::Acute, "ÁÉÍÓÚÝáéíóúýĆćĹĺŃńŔŕŚśŹź", "AEIOUYaeiouyCcLlNnRrSsZz"),
    (Accent::Circumflex, "ÂÊÎÔÛâêîôûĈĉĜĝĤĥĴĵŜŝŴŵŶŷ", "AEIOUaeiouCcGgHhJjSsWwYy"),
    (Accent::Tilde, "ÃÑÕãñõĨĩŨũ", "ANOanoIiUu"),
    (Accent::Diaeresis, "ÄËÏÖÜäëïöüÿŸ", "AEIOUaeiouyY"),
    (Accent::Ring, "ÅåŮů", "AaUu"),
    (Accent::Caron, "ČčĎďĚěĽľŇňŘřŠšŤťŽž", "CcDdEeLlNnRrSsTtZz"),
    (Accent::Macron, "ĀāĒēĪīŌōŪū", "AaEeIiOoUu"),
    (Accent::Breve, "ĂăĔĕĞğĬĭŎŏŬŭ", "AaEeGgIiOoUu"),
    (Accent::Dot, "ĊċĖėĠġİŻż", "CcEeGgIZz"),
    (Accent::DoubleAcute, "ŐőŰű", "OoUu"),
    (Accent::Cedilla, "ÇçŞş", "CcSs"),
    (Accent::Ogonek, "ĄąĘęĮįŲų", "AaEeIiUu"),
];

/// The base letter and accent of an accented letter the font composes.
fn decompose(c: char) -> Option<(char, Accent)> {
    if !('\u{C0}'..='\u{17F}').contains(&c) {
        return None;
    }
    ACCENTED.iter().find_map(|(accent, letters, bases)| letters.chars().zip(bases.chars()).find(|(k, _)| *k == c).map(|(_, base)| (base, *accent)))
}

/// An accent mark on its own (the spacing forms).
fn spacing_accent(c: char) -> Option<Accent> {
    Some(match c {
        '´' => Accent::Acute,
        '¨' => Accent::Diaeresis,
        '¯' => Accent::Macron,
        '¸' => Accent::Cedilla,
        'ˆ' => Accent::Circumflex,
        'ˇ' => Accent::Caron,
        '˘' => Accent::Breve,
        '˙' => Accent::Dot,
        '˚' => Accent::Ring,
        '˛' => Accent::Ogonek,
        '˜' => Accent::Tilde,
        '˝' => Accent::DoubleAcute,
        _ => return None,
    })
}

/// A superscript or subscript: the full-size character it is drawn from and its rise.
fn raised(c: char) -> Option<(char, f64)> {
    let digit = |zero: char| char::from_digit(u32::from(c).checked_sub(u32::from(zero))?, 10);
    Some(match c {
        '¹' => ('1', SUPERSCRIPT_RISE),
        '²' => ('2', SUPERSCRIPT_RISE),
        '³' => ('3', SUPERSCRIPT_RISE),
        '⁰' | '⁴'..='⁹' => (digit('⁰')?, SUPERSCRIPT_RISE),
        '⁺' => ('+', SUPERSCRIPT_RISE),
        '⁻' => ('-', SUPERSCRIPT_RISE),
        '⁼' => ('=', SUPERSCRIPT_RISE),
        '⁽' => ('(', SUPERSCRIPT_RISE),
        '⁾' => (')', SUPERSCRIPT_RISE),
        'ⁿ' => ('n', SUPERSCRIPT_RISE_SHORT),
        'ª' => ('a', SUPERSCRIPT_RISE_SHORT),
        'º' => ('o', SUPERSCRIPT_RISE_SHORT),
        '₀'..='₉' => (digit('₀')?, SUBSCRIPT_DROP),
        '₊' => ('+', SUBSCRIPT_DROP),
        '₋' => ('-', SUBSCRIPT_DROP),
        '₌' => ('=', SUBSCRIPT_DROP),
        '₍' => ('(', SUBSCRIPT_DROP),
        '₎' => (')', SUBSCRIPT_DROP),
        _ => return None,
    })
}

/// Numerator and denominator of a vulgar fraction.
fn fraction(c: char) -> Option<(char, char)> {
    Some(match c {
        '½' => ('1', '2'),
        '¼' => ('1', '4'),
        '¾' => ('3', '4'),
        '⅓' => ('1', '3'),
        '⅔' => ('2', '3'),
        '⅛' => ('1', '8'),
        '⅜' => ('3', '8'),
        '⅝' => ('5', '8'),
        '⅞' => ('7', '8'),
        _ => return None,
    })
}

/// The letter inside a circled sign.
fn circled(c: char) -> Option<char> {
    match c {
        '©' => Some('C'),
        '®' => Some('R'),
        _ => None,
    }
}

/// Glyphs built from drawn ones.
fn composed(c: char) -> Option<Glyph> {
    if let Some((base, rise)) = raised(c) {
        let (w, spec) = drawn(base)?;
        return Some(Glyph::new(w * SMALL, Part::scaled(spec, SMALL, 0.0, rise), NO_PART, NO_PART));
    }
    if let Some((n, d)) = fraction(c) {
        // The numerator in the upper left, the denominator in the lower right, a bar between.
        let ((_, num), (_, den)) = (drawn(n)?, drawn(d)?);
        return Some(Glyph::new(6.0, Part::scaled(num, HALF, 0.0, 3.0), Part::plain("2c4i"), Part::scaled(den, HALF, 4.0, 0.0)));
    }
    if let Some(letter) = circled(c) {
        // The letter at half size in an octagon six units wide.
        let (_, spec) = drawn(letter)?;
        return Some(Glyph::new(6.0, Part::plain("2c0e0g2i4i6g6e4c2c"), Part::scaled(spec, HALF, 2.0, 1.5), NO_PART));
    }
    if c == '™' {
        let ((_, t), (_, m)) = (drawn('T')?, drawn('M')?);
        return Some(Glyph::new(4.6, Part::scaled(t, HALF, 0.0, 3.4), Part::scaled(m, HALF, 2.6, 3.4), NO_PART));
    }
    if let Some(accent) = spacing_accent(c) {
        return Some(Glyph::new(4.0, accent.part(4.0, 2.0, false), NO_PART, NO_PART));
    }
    let (base, accent) = decompose(c)?;
    // A mark above replaces the dot of i and j; the narrow i gets room for it.
    let (width, spec, dx, cx) = match (base, accent.is_above()) {
        ('i', true) => (2.0, "0c0g", 1.0, 1.0),
        ('j', true) => (3.0, "2g2b1a0a", 0.0, 2.0),
        _ => {
            let (w, spec) = drawn(base)?;
            (w, spec, 0.0, w / 2.0)
        }
    };
    let tall = base.is_uppercase() || matches!(base, 'b' | 'd' | 'f' | 'h' | 'k' | 'l' | 't');
    Some(Glyph::new(width, Part { dx, ..Part::plain(spec) }, accent.part(width, cx, tall), NO_PART))
}

/// The glyphs drawn stroke by stroke.
fn drawn(c: char) -> Option<(f64, &'static str)> {
    let g: (f64, &str) = match c {
        ' ' | '\u{A0}' => (2.4, ""),
        'A' => (4.0, "0c2i4c 1f3f"),
        'B' => (4.0, "0c0i3i4h4g3f0f 3f4e4d3c0c"),
        'C' => (4.0, "4h3i1i0h0d1c3c4d"),
        'D' => (4.0, "0c0i3i4h4d3c0c"),
        'E' => (4.0, "4i0i0c4c 0f3f"),
        'F' => (4.0, "4i0i0c 0f3f"),
        'G' => (4.0, "4h3i1i0h0d1c3c4d4f2f"),
        'H' => (4.0, "0c0i 4c4i 0f4f"),
        'I' => (2.0, "0i2i 1i1c 0c2c"),
        'J' => (4.0, "4i4d3c1c0d0e"),
        'K' => (4.0, "0c0i 4i0e 1f4c"),
        'L' => (4.0, "0i0c4c"),
        'M' => (4.0, "0c0i2f4i4c"),
        'N' => (4.0, "0c0i4c4i"),
        'O' => (4.0, "1c0d0h1i3i4h4d3c1c"),
        'P' => (4.0, "0c0i3i4h4g3f0f"),
        'Q' => (4.0, "1c0d0h1i3i4h4d3c1c 2e4b"),
        'R' => (4.0, "0c0i3i4h4g3f0f 2f4c"),
        'S' => (4.0, "4h3i1i0h0g1f3f4e4d3c1c0d"),
        'T' => (4.0, "0i4i 2i2c"),
        'U' => (4.0, "0i0d1c3c4d4i"),
        'V' => (4.0, "0i2c4i"),
        'W' => (4.0, "0i1c2f3c4i"),
        'X' => (4.0, "0i4c 0c4i"),
        'Y' => (4.0, "0i2f4i 2f2c"),
        'Z' => (4.0, "0i4i0c4c"),
        '0' => (4.0, "1c0d0h1i3i4h4d3c1c"),
        '1' => (4.0, "1h2i2c 1c3c"),
        '2' => (4.0, "0h1i3i4h4g0c4c"),
        '3' => (4.0, "0h1i3i4h4g3f2f 3f4e4d3c1c0d"),
        '4' => (4.0, "3c3i0e4e"),
        '5' => (4.0, "4i0i0f3f4e4d3c1c0d"),
        '6' => (4.0, "4h3i1i0h0d1c3c4d4e3f1f0e"),
        '7' => (4.0, "0i4i1c"),
        '8' => (4.0, "1f0g0h1i3i4h4g3f1f0e0d1c3c4d4e3f"),
        '9' => (4.0, "4f1f0g0h1i3i4h4d3c1c0d"),
        'a' => (4.0, "4g4c 4f3g1g0f0d1c3c4d"),
        'b' => (4.0, "0i0c 0d1c3c4d4f3g1g0f"),
        'c' => (4.0, "4f3g1g0f0d1c3c4d"),
        'd' => (4.0, "4i4c 4d3c1c0d0f1g3g4f"),
        'e' => (4.0, "0e4e4f3g1g0f0d1c3c4d"),
        'f' => (3.0, "3i2i1h1c 0g3g"),
        'g' => (4.0, "4g4b3a1a0b 4f3g1g0f0d1c3c4d"),
        'h' => (4.0, "0i0c 0f1g3g4f4c"),
        'i' => (1.0, "0c0g 0h0i"),
        'j' => (2.0, "2g2b1a0a 2h2i"),
        'k' => (4.0, "0i0c 3g0d 1e3c"),
        'l' => (2.0, "1i1d2c"),
        'm' => (4.0, "0c0g 0f1g2f2c 2f3g4f4c"),
        'n' => (4.0, "0c0g 0f1g3g4f4c"),
        'o' => (4.0, "1c0d0f1g3g4f4d3c1c"),
        'p' => (4.0, "0g0a 0f1g3g4f4d3c1c0d"),
        'q' => (4.0, "4g4a 4f3g1g0f0d1c3c4d"),
        'r' => (3.0, "0c0g 0e2g3g"),
        's' => (4.0, "4f3g1g0f1e3e4d3c1c0d"),
        't' => (3.0, "1i1d2c3c 0g3g"),
        'u' => (4.0, "0g0d1c3c4d 4g4c"),
        'v' => (4.0, "0g2c4g"),
        'w' => (4.0, "0g1c2f3c4g"),
        'x' => (4.0, "0g4c 0c4g"),
        'y' => (4.0, "0g2c 4g1a0a"),
        'z' => (4.0, "0g4g0c4c"),
        '!' => (1.0, "0i0e 0d0c"),
        '"' => (2.0, "0i0g 2i2g"),
        '#' => (4.0, "1c1i 3c3i 0e4e 0g4g"),
        '$' => (4.0, "4h3i1i0h0g1f3f4e4d3c1c0d 2i2c"),
        '%' => (4.0, "0c4i 0i0h1h1i0i 3c3d4d4c3c"),
        '&' => (4.0, "4c1h1i2i3h0e0d1c2c4e"),
        '\'' => (1.0, "0i0g"),
        '(' => (2.0, "2i1h0f0e1d2c"),
        ')' => (2.0, "0i1h2f2e1d0c"),
        '*' => (4.0, "2h2d 0g4e 0e4g"),
        '+' => (4.0, "2d2h 0f4f"),
        ',' => (1.0, "1d1c0b"),
        '-' => (4.0, "0f4f"),
        '.' => (1.0, "0c0d"),
        '/' => (4.0, "0c4i"),
        ':' => (1.0, "0c0d 0g0h"),
        ';' => (1.0, "1d1c0b 1g1h"),
        '<' => (4.0, "4h0f4d"),
        '=' => (4.0, "0e4e 0g4g"),
        '>' => (4.0, "0h4f0d"),
        '?' => (4.0, "0h1i3i4h4g2f2e 2d2c"),
        '@' => (4.0, "3e3g1g1e3e4f4h3i1i0h0d1c4c"),
        '[' => (2.0, "2i0i0c2c"),
        '\\' => (4.0, "0i4c"),
        ']' => (2.0, "0i2i2c0c"),
        '^' => (4.0, "0g2i4g"),
        '_' => (4.0, "0b4b"),
        '`' => (1.0, "0i1h"),
        '{' => (2.0, "2i1h1g0f1e1d2c"),
        '|' => (1.0, "0i0a"),
        '}' => (2.0, "0i1h1g2f1e1d0c"),
        '~' => (4.0, "0g1h3f4g"),
        '°' => (2.0, "1i0h1g2h1i"),
        '±' => (4.0, "2e2i 0g4g 0d4d"),
        // The diameter sign is the capital's shape; the empty-set sign is often typed for it.
        'Ø' | '⌀' | '∅' => (4.0, "1c0d0h1i3i4h4d3c1c 0c4i"),
        'ø' => (4.0, "1c0d0f1g3g4f4d3c1c 0c4g"),
        // List bullet: a small crossed diamond at mid x-height.
        '•' => (2.0, "1d0e1f2e1d 0e2e 1d1f"),
        // Latin-1 punctuation and signs.
        '¡' => (1.0, "0g0f 0e0a"),
        '¢' => (4.0, "4f3g1g0f0d1c3c4d 2h2b"),
        '£' => (4.0, "4h3i2i1h1c 0c4c 0f3f"),
        '¤' => (4.0, "1e1g3g3e1e 0d1e 3g4h 0h1g 3e4d"),
        '¥' => (4.0, "0i2f4i 2f2c 1e3e 1d3d"),
        '¦' => (1.0, "0i0f 0d0a"),
        '§' => (4.0, "4h3i1i0h0f4c4b3a1a0b 0g4d4c"),
        '«' => (4.0, "2g0e2c 4g2e4c"),
        '»' => (4.0, "0g2e0c 2g4e2c"),
        '¬' => (4.0, "0f4f4d"),
        'µ' | 'μ' => (4.0, "0g0a 0d1c3c4d 4g4c"),
        '¶' => (4.0, "4c4i1i0h0g1f2f 2i2c"),
        '·' => (1.0, "0e0f"),
        '¿' => (4.0, "4b3a1a0b0c2d2e 2f2g"),
        '×' => (4.0, "0d4h 0h4d"),
        '÷' => (4.0, "0f4f 2g2h 2d2e"),
        // Letters that are not a base letter with a mark.
        'Æ' => (6.0, "0c3i6i 3i3c6c 3f5f 1e3e"),
        'æ' => (6.0, "3g3c 3f2g1g0f0d1c2c3d 3e6e6f5g4g3f 3d4c5c6d"),
        'Œ' => (6.0, "3c1c0d0h1i3i 6i3i3c6c 3f5f"),
        'œ' => (6.0, "3d2c1c0d0f1g2g3f3d 3e6e6f5g4g3f 3d4c5c6d"),
        'Ð' | 'Đ' => (4.0, "0c0i3i4h4d3c0c 0f2f"),
        'ð' => (4.0, "1c0d0f1g3g4f4d3c1c 4f3h1i 1h3i"),
        'đ' => (4.0, "4i4c 4d3c1c0d0f1g3g4f 2h4h"),
        'Þ' => (4.0, "0c0i 0h3h4g4f3e0e"),
        'þ' => (4.0, "0i0a 0f1g3g4f4d3c1c0d"),
        'ß' => (4.0, "0c0h1i2i3h3g2f4e4d3c2c"),
        'ı' => (1.0, "0c0g"),
        'Ł' => (4.0, "1i1c4c 0e2g"),
        'ł' => (2.0, "1i1d2c 0e2g"),
        // Typographic punctuation: the quotes are the comma, raised and turned.
        '‘' => (1.0, "0g0h1i"),
        '’' => (1.0, "1i1h0g"),
        '‚' => (1.0, "1d1c0b"),
        '“' => (3.0, "0g0h1i 2g2h3i"),
        '”' => (3.0, "1i1h0g 3i3h2g"),
        '„' => (3.0, "1d1c0b 3d3c2b"),
        '′' => (1.0, "1i0g"),
        '″' => (3.0, "1i0g 3i2g"),
        '‐' | '‑' | '–' | '−' => (4.0, "0f4f"),
        '—' => (6.0, "0f6f"),
        '…' => (4.0, "0c0d 2c2d 4c4d"),
        '€' => (4.0, "4h3i2i1h1d2c3c4d 0g3g 0e3e"),
        // The signs a drafter's symbol list offers.
        '≤' => (4.0, "4h0f4d 0c4c"),
        '≥' => (4.0, "0h4f0d 0c4c"),
        '≠' => (4.0, "0e4e 0g4g 1d3h"),
        '≈' => (4.0, "0e1f3d4e 0g1h3f4g"),
        'Δ' => (4.0, "0c2i4c0c"),
        'Ω' | '\u{2126}' => (4.0, "0c1c1d0e0h1i3i4h4e3d3c4c"),
        _ => return None,
    };
    Some(g)
}

/// Decode one stroke string into point lists in font units.
fn decode(spec: &str) -> Vec<Vec<(f64, f64)>> {
    spec.split(' ')
        .filter(|s| !s.is_empty())
        .map(|s| {
            let b = s.as_bytes();
            b.chunks(2)
                .filter_map(|p| {
                    let x = f64::from(p.first()?.checked_sub(b'0')?);
                    let y = f64::from(p.get(1)?.checked_sub(b'a')?) - 2.0;
                    Some((x, y))
                })
                .collect()
        })
        .collect()
}
