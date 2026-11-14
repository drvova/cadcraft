//! Text on the band: an engraving cut into the inside, a name raised on or cut into the outside,
//! and (with [`super::hallmark`]) the fineness mark inside the shank.
//!
//! A Rhino jeweller orients text on the band's surface (often with a Grasshopper definition); here
//! it is a parameter of the piece: `engrave: {text, at?: inside|outside, style?: cut|raised,
//! font?: block|script, depth?, height?, stroke?, side?: bottom|top}`.
//!
//! The letters are CADCraft's own single-stroke drafting font (`cadcraft-fonts`), whose glyphs
//! are centrelines. Each stroke is a groove of round section swept along its centreline (a
//! capsule swept along it, run out past the surface): cut grooves take metal away, raised strokes
//! (a round-topped wire standing on the outside) add it. The optional craft-fonts outlines are
//! not used: they are outline (filled) faces for other scripts, and an engraving is cut along
//! centrelines; the feature never needs them.
//!
//! The letters are laid out flat — `u` along the band (centred on the text's middle), `v` across
//! it (the middle of the width is 0) — and wrapped onto the surface they are cut into, at the
//! band's local surface across a domed or eased section. Inside, the text reads from the finger's
//! side; outside, from outside.
//!
//! Approximations (stated): the groove volume is integrated over the flat layout (depth at each
//! point of the footprint, the union of the strokes), which leaves out the surface's curvature (a
//! relative error of about depth / (2 × radius), under 2 % of the groove); the 3D grooves are
//! swept straight between points no more than [`SEG`] apart.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Map, Value, json};

use super::piece_params::{PieceKind, PieceParams, Section};
use super::*;

/// The most characters an engraving or a maker's mark may have.
pub(super) const MAX_TEXT: usize = 48;
/// The finest groove a casting keeps, mm (an approximation for a lost-wax cast: finer lines fill
/// in or blur).
pub(super) const MIN_FEATURE: f64 = 0.2;
/// The finest raised stroke a casting fills, mm.
pub(super) const MIN_RAISED: f64 = 0.3;
/// The most of the wall a cut may take.
pub(super) const MAX_DEPTH_SHARE: f64 = 1.0 / 3.0;
/// The metal kept between the letters and the band's edges, mm.
pub(super) const EDGE: f64 = 0.3;
/// The most of the way round the band text may go.
pub(super) const MAX_ARC_SHARE: f64 = 0.92;
/// The longest straight piece a wrapped stroke is cut into, mm.
pub(super) const SEG: f64 = 0.2;
/// How far a groove runs on past the surface it is cut from, mm.
const OVER: f64 = 0.3;
/// The most points one stroke is wrapped through, and the most strokes a mark draws.
const MAX_STROKE_POINTS: usize = 2_000;
const MAX_STROKES: usize = 4_000;
/// The most cells the groove volume is integrated over.
const MAX_CELLS: f64 = 4.0e6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Place {
    Inside,
    Outside,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Style {
    Cut,
    Raised,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Font {
    Block,
    Script,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Side {
    Bottom,
    Top,
}

impl Place {
    pub(super) fn name(self) -> &'static str {
        match self {
            Place::Inside => "inside",
            Place::Outside => "outside",
        }
    }
}
impl Style {
    pub(super) fn name(self) -> &'static str {
        match self {
            Style::Cut => "cut",
            Style::Raised => "raised",
        }
    }
}
impl Font {
    pub(super) fn name(self) -> &'static str {
        match self {
            Font::Block => "block",
            Font::Script => "script",
        }
    }
    /// The stroke font's width factor and obliquing for this style of letter.
    fn shape(self) -> (f64, f64) {
        match self {
            Font::Block => (1.0, 0.0),
            Font::Script => (0.9, 15f64.to_radians()),
        }
    }
}
impl Side {
    fn name(self) -> &'static str {
        match self {
            Side::Bottom => "bottom",
            Side::Top => "top",
        }
    }
    fn angle(self) -> f64 {
        match self {
            Side::Bottom => -PI / 2.0,
            Side::Top => PI / 2.0,
        }
    }
}

/// The engraving a piece is asked for.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct EngraveSpec {
    pub text: String,
    pub place: Place,
    pub style: Style,
    pub font: Font,
    /// Where round the band its middle is, or `None` for the usual place (inside: the bottom;
    /// outside: the top of a plain band, else the bottom).
    pub side: Option<Side>,
    /// Cut: the groove's depth; raised: the letters' height off the band. `None`: the default.
    pub depth: Option<f64>,
    /// The capital letters' height, or `None` for the default.
    pub height: Option<f64>,
    /// The stroke's width (the groove's or the raised wire's), or `None` for the default.
    pub stroke: Option<f64>,
}

/// Whether CADCraft's engraving font draws `c`: printable ASCII and the Latin-1 letters.
pub(super) fn engravable(c: char) -> bool {
    (' '..='~').contains(&c) || (('À'..='ÿ').contains(&c) && c != '×' && c != '÷')
}

/// Read text to be cut: at most [`MAX_TEXT`] characters, each one the font draws.
pub(super) fn read_text(cmd: &str, key: &str, v: Option<&Value>, max: usize) -> Result<String> {
    let Some(s) = v.and_then(Value::as_str) else {
        return Err(bad(cmd, format!("`{key}` must be text")));
    };
    let count = s.chars().take(max + 1).count();
    if count > max {
        return Err(bad(cmd, format!("`{key}` is at most {max} characters; shorten the text")));
    }
    let t = s.trim();
    if t.is_empty() {
        return Err(bad(cmd, format!("`{key}` is empty: give the words to engrave")));
    }
    let mut missing: Vec<char> = Vec::new();
    for c in t.chars().filter(|c| !engravable(*c)) {
        if !missing.contains(&c) && missing.len() < 12 {
            missing.push(c);
        }
    }
    if !missing.is_empty() {
        let list: Vec<String> = missing.iter().map(|c| if c.is_control() { format!("U+{:04X}", u32::from(*c)) } else { format!("“{c}”") }).collect();
        return Err(bad(
            cmd,
            format!("the engraving font cannot cut {}: use letters (A–Z, accented Latin letters), digits and common punctuation", list.join(", ")),
        ));
    }
    Ok(t.to_string())
}

fn word<T: Copy>(cmd: &str, o: &Map<String, Value>, key: &str, choices: &[(&str, T)]) -> Result<Option<T>> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => {
            let s = v.as_str().map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
            match choices.iter().find(|(n, _)| *n == s) {
                Some((_, t)) => Ok(Some(*t)),
                None => {
                    let names: Vec<&str> = choices.iter().map(|(n, _)| *n).collect();
                    Err(bad(cmd, format!("`engrave.{key}` must be {}", names.join(" or "))))
                }
            }
        }
    }
}

/// An optional number of millimetres in `min..=max` under `what`.
pub(super) fn mm_opt(cmd: &str, o: &Map<String, Value>, what: &str, key: &str, min: f64, max: f64) -> Result<Option<f64>> {
    match o.get(key).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(v) => match v.as_f64().filter(|x| x.is_finite() && *x >= min && *x <= max) {
            Some(x) => Ok(Some(x)),
            None => Err(bad(cmd, format!("`{what}.{key}` must be a number of millimetres from {min} to {max}"))),
        },
    }
}

impl EngraveSpec {
    /// `engrave`: absent, `null` or `false` for none; text for an engraving inside with every
    /// default; or an object.
    pub(super) fn parse(cmd: &str, p: &Value) -> Result<Option<EngraveSpec>> {
        let o = match p.get("engrave") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
            Some(Value::String(s)) => {
                let mut o = Map::new();
                o.insert("text".into(), json!(s));
                o
            }
            Some(Value::Object(o)) => o.clone(),
            Some(_) => return Err(bad(cmd, "`engrave` must be false, the text, or {text, at?, style?, font?, depth?, height?, stroke?}")),
        };
        let text = read_text(cmd, "engrave.text", o.get("text"), MAX_TEXT)?;
        let place = word(cmd, &o, "at", &[("inside", Place::Inside), ("outside", Place::Outside)])?.unwrap_or(Place::Inside);
        let style = word(cmd, &o, "style", &[("cut", Style::Cut), ("raised", Style::Raised)])?.unwrap_or(Style::Cut);
        let font = word(cmd, &o, "font", &[("block", Font::Block), ("script", Font::Script)])?.unwrap_or(Font::Block);
        let side = word(cmd, &o, "side", &[("bottom", Side::Bottom), ("top", Side::Top)])?;
        if place == Place::Inside && style == Style::Raised {
            return Err(bad(cmd, "raised letters inside the band would press into the finger: cut them (`style: cut`) or put them outside"));
        }
        Ok(Some(EngraveSpec {
            text,
            place,
            style,
            font,
            side,
            depth: mm_opt(cmd, &o, "engrave", "depth", 0.05, 2.0)?,
            height: mm_opt(cmd, &o, "engrave", "height", 0.3, 10.0)?,
            stroke: mm_opt(cmd, &o, "engrave", "stroke", 0.05, 2.0)?,
        }))
    }

    pub(super) fn json(&self) -> Value {
        json!({
            "text": self.text,
            "at": self.place.name(),
            "style": self.style.name(),
            "font": self.font.name(),
            "side": self.side.map(Side::name),
            "depth": self.depth,
            "height": self.height,
            "stroke": self.stroke,
        })
    }

    /// The capital height: inside, half the band's width up to 1.2 mm; outside, 60 % of it up to
    /// 3 mm; never under 0.5 mm.
    pub(super) fn height_on(&self, p: &PieceParams) -> f64 {
        // Letters reaching under the line (g, j, p, q, y) take a third more room across the band.
        let reach = if self.text.chars().any(|c| "gjpqyQ,;()[]{}|_".contains(c)) { 0.7 } else { 1.0 };
        self.height.unwrap_or(match self.place {
            Place::Inside => (0.5 * p.width * reach).clamp(0.5, 1.2),
            Place::Outside => (0.6 * p.width * reach).clamp(0.5, 3.0),
        })
    }
    /// The stroke: 15 % of the height for a cut (at least [`MIN_FEATURE`]), 18 % for raised
    /// letters (at least [`MIN_RAISED`]).
    pub(super) fn stroke_on(&self, p: &PieceParams) -> f64 {
        let h = self.height_on(p);
        self.stroke.unwrap_or(match self.style {
            Style::Cut => (0.15 * h).max(MIN_FEATURE),
            Style::Raised => (0.18 * h).max(MIN_RAISED),
        })
    }
    /// The depth: a cut takes a fifth of the wall, from 0.1 to 0.3 mm; raised letters stand
    /// 0.4 mm (and at least their stroke's half-width) off the band.
    pub(super) fn depth_on(&self, p: &PieceParams) -> f64 {
        self.depth.unwrap_or(match self.style {
            Style::Cut => (0.2 * p.wall).clamp(0.1, 0.3),
            Style::Raised => (0.4f64).max(self.stroke_on(p) / 2.0),
        })
    }
    /// Where round the band the text's middle is.
    pub(super) fn side_on(&self, p: &PieceParams) -> Side {
        self.side.unwrap_or(match (self.place, p.kind) {
            (Place::Outside, PieceKind::Band) => Side::Top,
            _ => Side::Bottom,
        })
    }
}

/// Merge a change to `engrave` over the stored one, key by key (text alone stays an object).
pub(super) fn merge(stored: Option<&Value>, given: &Value) -> Value {
    match (stored.and_then(Value::as_object), given) {
        (Some(old), Value::Object(new)) => {
            let mut out = old.clone();
            for (k, v) in new {
                out.insert(k.clone(), v.clone());
            }
            Value::Object(out)
        }
        (Some(old), Value::String(s)) => {
            let mut out = old.clone();
            out.insert("text".into(), json!(s));
            Value::Object(out)
        }
        _ => given.clone(),
    }
}

// ---------------------------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------------------------

/// Grooves (or raised strokes) of one width and depth, laid out flat: `u` along the band, `v`
/// across it.
#[derive(Clone, Debug)]
pub(super) struct Feature {
    pub strokes: Vec<Vec<Vec2>>,
    /// Half the stroke's width.
    pub r: f64,
    /// Cut: the depth under the surface; raised: the height over it.
    pub depth: f64,
    /// A flat bottom (a hallmark's punch) rather than a round one.
    pub flat: bool,
    /// The sheet draws its outline (a cartouche) rather than its centrelines.
    pub outline: bool,
}

/// One piece of text on the band: where it is and what it is cut as.
#[derive(Clone, Debug)]
pub(super) struct Mark {
    pub place: Place,
    pub raised: bool,
    /// The angle round the band of the layout's `u = 0` (−90° is the bottom).
    pub centre: f64,
    /// The radius `u` is measured along.
    pub r_ref: f64,
    /// The layout's length along the band and its height across it, strokes' width included.
    pub length: f64,
    pub height: f64,
    pub features: Vec<Feature>,
}

impl Mark {
    /// The angle of a layout point `u` along the band: inside text reads from the finger's side,
    /// so it runs the other way round.
    pub(super) fn angle(&self, u: f64) -> f64 {
        let r = self.r_ref.max(1e-6);
        match self.place {
            Place::Inside => self.centre + u / r,
            Place::Outside => self.centre - u / r,
        }
    }
}

/// A string set in the stroke font at capital height `h`, centred on the origin (the capitals'
/// middle at `v = 0`), with its length.
pub(super) fn lay_text(text: &str, h: f64, font: Font) -> (Vec<Vec<Vec2>>, f64) {
    // `%` starts a control code in the stroke font; `%%%` is a percent sign.
    let escaped = text.replace('%', "%%%");
    let (wf, oblique) = font.shape();
    let sh = cadcraft_fonts::shape_stroke(&escaped, h, wf, oblique);
    let width = sh.width;
    let mut strokes = sh.strokes;
    strokes.extend(sh.glyphs.into_iter().flatten());
    let shift = Vec2::new(-width / 2.0, -h / 2.0);
    let strokes = strokes
        .into_iter()
        .take(MAX_STROKES)
        .map(|s| s.into_iter().filter(|q| q.is_finite()).map(|q| q + shift).collect::<Vec<_>>())
        .filter(|s| !s.is_empty())
        .collect();
    (strokes, if width.is_finite() { width } else { 0.0 })
}

/// A stroke cut into pieces no longer than `seg` (at most [`MAX_STROKE_POINTS`] points).
pub(super) fn densify(pts: &[Vec2], seg: f64) -> Vec<Vec2> {
    let mut out: Vec<Vec2> = Vec::with_capacity(pts.len() * 2);
    let Some(first) = pts.first() else { return out };
    out.push(*first);
    for w in pts.windows(2) {
        let (Some(a), Some(b)) = (w.first(), w.get(1)) else { continue };
        let n = (((*b - *a).len() / seg.max(1e-3)).ceil() as usize).clamp(1, MAX_STROKE_POINTS);
        for k in 1..=n {
            if out.len() >= MAX_STROKE_POINTS {
                return out;
            }
            out.push(*a + (*b - *a) * (k as f64 / n as f64));
        }
    }
    out
}

/// The extent of a feature set's strokes (without their width).
fn extent(features: &[Feature]) -> (Vec2, Vec2) {
    let mut lo = Vec2::new(f64::INFINITY, f64::INFINITY);
    let mut hi = Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
    for f in features {
        for q in f.strokes.iter().flatten() {
            lo = lo.min(*q - Vec2::new(f.r, f.r));
            hi = hi.max(*q + Vec2::new(f.r, f.r));
        }
    }
    (lo, hi)
}

/// The engraving's mark on a piece (nothing when it has none), refusing one that cannot go on.
fn engraving_mark(p: &PieceParams, e: &EngraveSpec) -> std::result::Result<Mark, String> {
    if e.place == Place::Outside {
        match p.kind {
            PieceKind::Eternity => return Err("an eternity band's outside is all stones: engrave it inside".into()),
            PieceKind::Dome | PieceKind::Signet => {
                return Err("text on the outside of a dome ring's or a signet's tapered shank is not available yet: engrave it inside".into());
            }
            _ => {}
        }
        let side = e.side_on(p);
        if side == Side::Top && !matches!(p.kind, PieceKind::Band) {
            return Err(format!("the top of a {} carries its stones: put the text at the bottom (`side: bottom`)", kind_words(p.kind)));
        }
        if side == Side::Top && p.pave.is_some() {
            return Err("the pavé is on the band's outside at the top: put the text at the bottom (`side: bottom`) or inside".into());
        }
    }
    let h = e.height_on(p);
    let stroke = e.stroke_on(p);
    let (strokes, width) = lay_text(&e.text, h, e.font);
    let features = vec![Feature { strokes, r: stroke / 2.0, depth: e.depth_on(p), flat: false, outline: false }];
    let ri = p.inner() / 2.0;
    let r_ref = match e.place {
        Place::Inside => ri,
        Place::Outside => p.crown(),
    };
    let (lo, hi) = extent(&features);
    let height = if hi.y > lo.y { hi.y - lo.y } else { h + stroke };
    let mark =
        Mark { place: e.place, raised: e.style == Style::Raised, centre: e.side_on(p).angle(), r_ref, length: width + stroke, height, features };
    let round = TAU * r_ref;
    if mark.length > MAX_ARC_SHARE * round {
        return Err(format!(
            "“{}” is too long for the band: at {} mm high it runs {} mm, and the band's {} is {} mm round (at most {} mm of it takes text). Shorten the text or lower `engrave.height`",
            e.text,
            fmt_mm(h),
            fmt_mm(mark.length),
            e.place.name(),
            fmt_mm(round),
            fmt_mm(MAX_ARC_SHARE * round)
        ));
    }
    Ok(mark)
}

fn kind_words(k: PieceKind) -> &'static str {
    match k {
        PieceKind::Band => "band",
        PieceKind::Solitaire => "solitaire",
        PieceKind::ThreeStone => "three-stone ring",
        PieceKind::Eternity => "eternity band",
        PieceKind::HalfEternity => "half eternity band",
        PieceKind::Dome => "dome ring",
        PieceKind::Signet => "signet",
    }
}

/// Everything the piece carries as text: the marks, their checks, the metal they take or add.
#[derive(Clone, Debug, Default)]
pub(super) struct Lettering {
    pub marks: Vec<Mark>,
    pub checks: Vec<(&'static str, bool, String)>,
    /// The metal the marks add (raised) less what they cut, mm³.
    pub volume: f64,
}

/// The piece's lettering, or `None` when it has neither an engraving nor a hallmark; refused
/// (`Err`, a sentence) when it cannot go on the band.
pub(super) fn lettering(p: &PieceParams) -> std::result::Result<Option<Lettering>, String> {
    if p.engrave.is_none() && p.hallmark.is_none() {
        return Ok(None);
    }
    let mut out = Lettering::default();
    if let Some(e) = &p.engrave {
        let mark = engraving_mark(p, e)?;
        out.checks.extend(engraving_checks(p, e, &mark));
        out.marks.push(mark);
    }
    if let Some(h) = &p.hallmark {
        let inside = out.marks.iter().find(|m| m.place == Place::Inside).cloned();
        let (mark, checks) = super::hallmark::mark(p, h, inside.as_ref())?;
        out.checks.extend(checks);
        out.marks.push(mark);
    }
    out.volume = out.marks.iter().map(|m| if m.raised { volume(&m.features) } else { -volume(&m.features) }).sum();
    if !out.volume.is_finite() {
        out.volume = 0.0;
    }
    Ok(Some(out))
}

/// The metal the lettering adds (positive) or cuts (negative), mm³; nothing for lettering that
/// cannot go on.
pub(super) fn volume_delta(p: &PieceParams) -> f64 {
    match lettering(p) {
        Ok(Some(l)) => l.volume,
        _ => 0.0,
    }
}

fn engraving_checks(p: &PieceParams, e: &EngraveSpec, m: &Mark) -> Vec<(&'static str, bool, String)> {
    let mut v = Vec::new();
    let room = p.width - 2.0 * EDGE;
    v.push((
        "engrave-fit",
        m.height <= room + 1e-9,
        if m.height <= room + 1e-9 {
            format!(
                "“{}” is {} mm high and {} mm long: it fits the {} mm band with {} mm of metal to each edge",
                e.text,
                fmt_mm(m.height),
                fmt_mm(m.length),
                fmt_mm(p.width),
                fmt_mm((p.width - m.height) / 2.0)
            )
        } else {
            format!(
                "“{}” is {} mm high but the band is {} mm wide: keep the letters at most {} mm high ({EDGE} mm from each edge), or widen the band",
                e.text,
                fmt_mm(m.height),
                fmt_mm(p.width),
                fmt_mm(room.max(0.0))
            )
        },
    ));
    let d = e.depth_on(p);
    match e.style {
        Style::Cut => {
            let most = MAX_DEPTH_SHARE * p.wall;
            v.push((
                "engrave-depth",
                d <= most + 1e-9,
                if d <= most + 1e-9 {
                    format!("The letters are cut {} mm deep, within a third of the {} mm wall", fmt_mm(d), fmt_mm(p.wall))
                } else {
                    format!(
                        "The letters are cut {} mm deep, more than a third of the {} mm wall ({} mm): cut them shallower or thicken the wall",
                        fmt_mm(d),
                        fmt_mm(p.wall),
                        fmt_mm(most)
                    )
                },
            ));
        }
        Style::Raised => v.push(("engrave-depth", true, format!("The letters stand {} mm off the band, adding metal", fmt_mm(d)))),
    }
    let s = e.stroke_on(p);
    let (least, what) = match e.style {
        Style::Cut => (MIN_FEATURE, "groove"),
        Style::Raised => (MIN_RAISED, "raised stroke"),
    };
    let h = e.height_on(p);
    let heavy = s > 0.3 * h + 1e-9;
    v.push((
        "engrave-stroke",
        s + 1e-9 >= least && !heavy,
        if s + 1e-9 < least {
            format!("The letters' {} mm {what} is finer than the {least} mm a casting keeps: make the stroke wider or the letters larger", fmt_mm(s))
        } else if heavy {
            format!(
                "The letters' {} mm stroke is heavy for {} mm letters (over 30 % of their height): their insides close up; make the stroke finer or the letters larger",
                fmt_mm(s),
                fmt_mm(h)
            )
        } else {
            format!("The letters' {} mm {what} is at or over the {least} mm a casting keeps", fmt_mm(s))
        },
    ));
    v
}

// ---------------------------------------------------------------------------------------------
// The metal the letters take
// ---------------------------------------------------------------------------------------------

/// The depth of a stroke's groove at `l` from its centreline (half-width `r`, depth `d`): a
/// round bottom `d − r` under the surface, or a flat one.
pub(super) fn depth_at(l: f64, r: f64, d: f64, flat: bool) -> f64 {
    if l >= r {
        0.0
    } else if flat {
        d
    } else {
        (d - r + (r * r - l * l).max(0.0).sqrt()).max(0.0)
    }
}

fn segment_distance(q: Vec2, a: Vec2, b: Vec2) -> f64 {
    let e = b - a;
    let l2 = e.dot(e);
    let t = if l2 > 1e-300 { ((q - a).dot(e) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (q - (a + e * t)).len()
}

/// The volume of the union of a set of features' grooves (or raised strokes), mm³, integrated
/// over the flat layout: at each point the deepest groove there.
pub(super) fn volume(features: &[Feature]) -> f64 {
    let (lo, hi) = extent(features);
    if !(lo.is_finite() && hi.is_finite()) || hi.x <= lo.x || hi.y <= lo.y {
        return 0.0;
    }
    let least_r = features.iter().map(|f| f.r).fold(f64::INFINITY, f64::min);
    let (w, h) = (hi.x - lo.x, hi.y - lo.y);
    let cell = (least_r / 8.0).max((w * h / MAX_CELLS).sqrt()).max(1e-4);
    let (nx, ny) = (((w / cell).ceil() as usize).max(1), ((h / cell).ceil() as usize).max(1));
    let mut depth = vec![0f32; nx.saturating_mul(ny)];
    for f in features {
        let r = f.r;
        for s in &f.strokes {
            let pts: Vec<Vec2> = if s.len() == 1 { vec![s.first().copied().unwrap_or(Vec2::ZERO); 2] } else { s.clone() };
            for pair in pts.windows(2) {
                let (Some(a), Some(b)) = (pair.first().copied(), pair.get(1).copied()) else { continue };
                let (blo, bhi) = (a.min(b) - Vec2::new(r, r), a.max(b) + Vec2::new(r, r));
                let i0 = (((blo.x - lo.x) / cell).floor().max(0.0) as usize).min(nx);
                let i1 = (((bhi.x - lo.x) / cell).ceil().max(0.0) as usize).min(nx);
                let j0 = (((blo.y - lo.y) / cell).floor().max(0.0) as usize).min(ny);
                let j1 = (((bhi.y - lo.y) / cell).ceil().max(0.0) as usize).min(ny);
                for j in j0..j1 {
                    let y = lo.y + (j as f64 + 0.5) * cell;
                    for i in i0..i1 {
                        let x = lo.x + (i as f64 + 0.5) * cell;
                        let d = depth_at(segment_distance(Vec2::new(x, y), a, b), r, f.depth, f.flat) as f32;
                        if let Some(c) = depth.get_mut(j * nx + i)
                            && d > *c
                        {
                            *c = d;
                        }
                    }
                }
            }
        }
    }
    depth.iter().map(|d| f64::from(*d)).sum::<f64>() * cell * cell
}

// ---------------------------------------------------------------------------------------------
// On the band, in 3D
// ---------------------------------------------------------------------------------------------

/// The surface a mark is on at `v` across the band: its radius.
fn surface(p: &PieceParams, section: &Section, place: Place, v: f64) -> f64 {
    let ri = p.inner() / 2.0;
    match place {
        Place::Inside => ri + section.inside_at(v),
        Place::Outside => ri + section.height_at(v),
    }
}

/// A layout point of a mark on the band, `into` millimetres into the metal (negative: out of it).
pub(super) fn wrap(p: &PieceParams, section: &Section, m: &Mark, q: Vec2, into: f64) -> Vec3 {
    let rs = surface(p, section, m.place, -q.y);
    let r = match m.place {
        Place::Inside => rs + into,
        Place::Outside => rs - into,
    };
    let a = m.angle(q.x);
    Vec3::new(r * a.cos(), r * a.sin(), -q.y)
}

/// The way out of the metal at a point of the band's surface.
fn out_of_metal(place: Place, at: Vec3) -> Vec3 {
    let radial = Vec3::new(at.x, at.y, 0.0).normalized();
    match place {
        Place::Inside => -radial,
        Place::Outside => radial,
    }
}

/// One straight piece of a groove: its bottom from `a` along `e` for `len`, swept along `n` (square
/// to `e`) for `reach`.
#[derive(Clone, Debug)]
struct Seg {
    a: Vec3,
    e: Vec3,
    len: f64,
    n: Vec3,
    reach: f64,
}

/// A stroke's groove (or raised wire) in 3D: a ball of radius `r` (a flat-bottomed punch with
/// `flat`) swept along the stroke's bottom and on out along `n` past the surface. Its distance is
/// the least of its pieces', each exact (a point to a rectangle, less `r`), so the field is a
/// 1-Lipschitz bound, as the solid wants.
#[derive(Clone, Debug)]
pub(crate) struct Groove {
    segs: Vec<Seg>,
    r: f64,
    flat: bool,
    lo: Vec3,
    hi: Vec3,
}

impl Groove {
    /// A groove through 3D bottom points `pts`, swept along `outs` (one per point) for `reach`.
    fn new(pts: &[Vec3], outs: &[Vec3], reach: f64, r: f64, flat: bool) -> Option<Groove> {
        let mut segs = Vec::with_capacity(pts.len());
        let mut lo = Vec3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
        let mut hi = Vec3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        let pairs: Vec<(Vec3, Vec3, Vec3)> = if pts.len() == 1 {
            let (a, o) = (pts.first().copied()?, outs.first().copied()?);
            vec![(a, a, o)]
        } else {
            pts.windows(2)
                .zip(outs.windows(2))
                .filter_map(|(p, o)| Some((*p.first()?, *p.get(1)?, (*o.first()? + *o.get(1)?).normalized())))
                .collect()
        };
        for (a, b, out) in pairs {
            let d = b - a;
            let len = d.len();
            let e = if len > 1e-9 { d * (1.0 / len) } else { any_square(out) };
            let n = (out - e * out.dot(e)).normalized();
            if !(n.is_finite() && e.is_finite() && a.is_finite()) || n.len() < 0.5 {
                continue;
            }
            for c in [a, b, a + n * reach, b + n * reach] {
                lo = Vec3::new(lo.x.min(c.x - r), lo.y.min(c.y - r), lo.z.min(c.z - r));
                hi = Vec3::new(hi.x.max(c.x + r), hi.y.max(c.y + r), hi.z.max(c.z + r));
            }
            segs.push(Seg { a, e, len, n, reach });
        }
        (!segs.is_empty() && r > 0.0 && r.is_finite()).then_some(Groove { segs, r, flat, lo, hi })
    }

    pub(crate) fn distance(&self, p: Vec3) -> f64 {
        let mut best = f64::INFINITY;
        for s in &self.segs {
            let q = p - s.a;
            let x = q.dot(s.e).clamp(0.0, s.len);
            let y = q.dot(s.n);
            let d = if self.flat {
                let lateral = (q - s.e * x - s.n * y).len();
                (lateral - self.r).max(-y).max(y - s.reach)
            } else {
                (q - s.e * x - s.n * y.clamp(0.0, s.reach)).len() - self.r
            };
            best = best.min(d);
        }
        best
    }

    pub(crate) fn bounds(&self) -> (Vec3, Vec3) {
        (self.lo, self.hi)
    }
}

fn any_square(t: Vec3) -> Vec3 {
    let axis = if t.x.abs() < 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 1.0, 0.0) };
    t.cross(axis).normalized()
}

/// The lettering as grooves for the cast solid: what it adds (raised letters) and what it cuts.
pub(super) fn grooves(p: &PieceParams) -> (Vec<Groove>, Vec<Groove>) {
    let (mut add, mut cut) = (Vec::new(), Vec::new());
    let Ok(Some(l)) = lettering(p) else { return (add, cut) };
    let section = p.section();
    for m in &l.marks {
        for f in &m.features {
            for s in &f.strokes {
                let flat = densify(s, SEG);
                // Cut: the bottom under the surface, swept out of the metal past it. Raised: the
                // top over it, swept into the metal.
                let (into, reach) = match (m.raised, f.flat) {
                    (true, _) => (-(f.depth - f.r).max(0.0), (f.depth - f.r).max(0.0) + OVER),
                    (false, true) => (f.depth, f.depth + OVER),
                    (false, false) => (f.depth - f.r, (f.depth - f.r).max(0.0) + OVER),
                };
                let pts: Vec<Vec3> = flat.iter().map(|q| wrap(p, &section, m, *q, into)).collect();
                let outs: Vec<Vec3> = pts.iter().map(|q| if m.raised { -out_of_metal(m.place, *q) } else { out_of_metal(m.place, *q) }).collect();
                if let Some(g) = Groove::new(&pts, &outs, reach, f.r, f.flat) {
                    if m.raised { add.push(g) } else { cut.push(g) }
                }
            }
        }
    }
    (add, cut)
}

/// A path the 3D view draws as a round wire: its points, radius and how much of the metal's
/// colour it keeps (1 for raised metal, less for the shadow of a cut).
pub(super) struct ViewPath {
    pub pts: Vec<Vec3>,
    pub r: f64,
    pub raised: bool,
}

/// The lettering for the 3D view. A cut is shown as a dark wire sunk to half its radius in the
/// surface, its width the groove's; raised letters as the metal standing on the band.
pub(super) fn view_paths(p: &PieceParams) -> Vec<ViewPath> {
    let mut out = Vec::new();
    let Ok(Some(l)) = lettering(p) else { return out };
    let section = p.section();
    for m in &l.marks {
        for f in &m.features {
            let strokes: Vec<Vec<Vec2>> = if f.outline { f.strokes.iter().map(|s| stadium(s, f.r, 24)).collect() } else { f.strokes.clone() };
            let r = if f.outline { 0.04 } else { f.r };
            for s in &strokes {
                let flat = densify(s, SEG);
                if m.raised {
                    // Wires from the surface up to the letters' top, a radius apart.
                    let top = (f.depth - f.r).max(0.0);
                    let n = ((top / f.r.max(1e-3)).ceil() as usize).clamp(1, 8);
                    for k in 0..=n {
                        let lift = top * k as f64 / n as f64;
                        out.push(ViewPath { pts: flat.iter().map(|q| wrap(p, &section, m, *q, -lift)).collect(), r, raised: true });
                    }
                } else {
                    out.push(ViewPath { pts: flat.iter().map(|q| wrap(p, &section, m, *q, 0.5 * r)).collect(), r, raised: false });
                }
            }
        }
    }
    out
}

/// The outline of a stroke's footprint when it is a straight centreline (a cartouche): a stadium.
pub(super) fn stadium(s: &[Vec2], r: f64, n: usize) -> Vec<Vec2> {
    let (Some(a), Some(b)) = (s.first().copied(), s.last().copied()) else { return Vec::new() };
    let d = b - a;
    let e = if d.len() > 1e-9 { d * (1.0 / d.len()) } else { Vec2::new(1.0, 0.0) };
    let nrm = Vec2::new(-e.y, e.x);
    let mut out = Vec::with_capacity(2 * n + 3);
    for (c, from) in [(b, -PI / 2.0), (a, PI / 2.0)] {
        for k in 0..=n {
            let t = from + PI * k as f64 / n as f64;
            out.push(c + (e * t.cos() + nrm * t.sin()) * r);
        }
    }
    if let Some(f) = out.first().copied() {
        out.push(f);
    }
    out
}

// ---------------------------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------------------------

/// A developed view of one surface: the band unrolled, `length` round by its `width`, centred on
/// its own middle (the bottom inside; the text's middle outside), with the lettering on it.
pub(super) struct Strip {
    pub length: f64,
    pub width: f64,
    pub lines: Vec<Vec<Vec2>>,
}

/// The developed views the sheet draws for the piece's lettering.
pub(super) fn strips(p: &PieceParams, l: &Lettering) -> Vec<Strip> {
    let mut out: Vec<Strip> = Vec::new();
    for place in [Place::Inside, Place::Outside] {
        let marks: Vec<&Mark> = l.marks.iter().filter(|m| m.place == place).collect();
        let Some(first) = marks.first() else { continue };
        let r_ref = first.r_ref;
        // Inside: the strip's middle is the bottom; outside, the first mark's middle.
        let middle = match place {
            Place::Inside => -PI / 2.0,
            Place::Outside => first.centre,
        };
        let mut lines = Vec::new();
        for m in &marks {
            // The mark's `u = 0` along the strip, read the way the mark reads.
            let shift = match place {
                Place::Inside => (m.centre - middle) * r_ref,
                Place::Outside => (middle - m.centre) * r_ref,
            };
            for f in &m.features {
                for s in &f.strokes {
                    let line: Vec<Vec2> = if f.outline { stadium(s, f.r, 12) } else { s.clone() };
                    if line.len() >= 2 {
                        lines.push(line.into_iter().map(|q| q + Vec2::new(shift, 0.0)).collect());
                    }
                }
            }
        }
        out.push(Strip { length: TAU * r_ref, width: p.width, lines });
    }
    out
}
