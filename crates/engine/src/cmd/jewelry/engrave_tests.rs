//! Engraving, raised names and hallmarks on the band: the layout along the band, the groove
//! volume against an analytic reference, fits and refusals, the hallmark per metal, the sheet,
//! mesh and solid agreeing on the weight, propose and DXF, and properties over drawn text.

use cadcraft_geom::{PI, Vec2, Vec3};
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::engrave::{self, Feature, MAX_TEXT, Place, engravable, lettering, volume};
use super::hallmark::{self, PUNCH, RECESS};
use super::mesh::{Quality, piece_mesh};
use super::mesh_tests::{check as check_mesh, part};
use super::piece_params::PieceParams;
use super::solid::{solidify, verify};
use crate::Session;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("test", &v).unwrap_or_else(|e| panic!("{v}: {e}"))
}

fn mm_drawing() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s
}

fn piece(s: &mut Session, p: Value) -> Value {
    s.execute("piece", &p).unwrap_or_else(|e| panic!("PIECE {p}: {e}"))["piece"].clone()
}

fn refusal(p: Value) -> String {
    let mut s = mm_drawing();
    s.execute("piece", &p).map(|r| r.to_string()).expect_err("refused").to_string()
}

fn check_of<'a>(piece: &'a Value, id: &str) -> &'a Value {
    piece["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("no check {id} in {}", piece["checks"]))
}

fn grams(p: &Value) -> f64 {
    p["metal"]["grams"].as_f64().unwrap()
}

// ---------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------

#[test]
fn an_engraving_reads_back_and_defaults_are_said_as_null() {
    let p = params(json!({"kind": "band", "engrave": "Forever 14.02.2026"}));
    let j = p.json();
    assert_eq!(j["engrave"]["text"], "Forever 14.02.2026");
    assert_eq!(j["engrave"]["at"], "inside");
    assert_eq!(j["engrave"]["style"], "cut");
    assert_eq!(j["engrave"]["font"], "block");
    assert_eq!(j["engrave"]["depth"], Value::Null);
    assert_eq!(PieceParams::parse("test", &j).unwrap(), p);
    assert_eq!(params(json!({"kind": "band"})).json()["engrave"], false);
    assert_eq!(params(json!({"kind": "band"})).json()["hallmark"], false);
    let full = params(
        json!({"kind": "band", "engrave": {"text": "ANNA", "at": "outside", "style": "raised", "font": "script", "depth": 0.5, "height": 1.4, "stroke": 0.32}, "hallmark": {"maker": "CC"}}),
    );
    assert_eq!(PieceParams::parse("test", &full.json()).unwrap(), full);
}

#[test]
fn the_defaults_are_bench_sized() {
    // A 2.2 mm × 1.8 mm band: letters 1.1 mm high, a 0.2 mm groove 0.3 mm deep inside.
    let p = params(json!({"kind": "band", "engrave": "A"}));
    let e = p.engrave.clone().unwrap();
    assert!((e.height_on(&p) - 1.1).abs() < 1e-12);
    assert!((e.stroke_on(&p) - 0.2).abs() < 1e-12);
    assert!((e.depth_on(&p) - 0.3).abs() < 1e-12);
    // A name ring outside: 60 % of the width, raised 0.4 mm on a 0.3 mm wire at least.
    let q = params(json!({"kind": "band", "width": 3.0, "engrave": {"text": "ANNA", "at": "outside", "style": "raised"}}));
    let e = q.engrave.clone().unwrap();
    assert!((e.height_on(&q) - 1.8).abs() < 1e-12);
    assert!(e.stroke_on(&q) >= engrave::MIN_RAISED);
    assert!((e.depth_on(&q) - 0.4).abs() < 1e-12);
}

#[test]
fn refusals_are_plain_sentences() {
    let e = refusal(json!({"kind": "band", "engrave": "Love ♥ you ☃"}));
    assert!(e.contains("“♥”") && e.contains("“☃”") && e.contains("cannot cut"), "{e}");
    let e = refusal(json!({"kind": "band", "engrave": "x".repeat(MAX_TEXT + 1)}));
    assert!(e.contains("at most 48 characters"), "{e}");
    let e = refusal(json!({"kind": "band", "engrave": {"text": "Hi", "style": "raised"}}));
    assert!(e.contains("press into the finger"), "{e}");
    let e = refusal(json!({"kind": "band", "engrave": {"text": "Hi", "at": "middle"}}));
    assert!(e.contains("`engrave.at` must be inside or outside"), "{e}");
    let e = refusal(json!({"kind": "band", "engrave": "   "}));
    assert!(e.contains("empty"), "{e}");
    let e = refusal(json!({"kind": "band", "engrave": {"text": "Hi", "depth": -1}}));
    assert!(e.contains("`engrave.depth`"), "{e}");
    // Too long for the band: said with the numbers.
    let e = refusal(json!({"kind": "band", "size": 3, "engrave": {"text": "With all my love for ever and ever, always", "height": 2}}));
    assert!(e.contains("too long for the band") && e.contains("mm round"), "{e}");
    let e = refusal(json!({"kind": "eternity", "engrave": {"text": "Hi", "at": "outside"}}));
    assert!(e.contains("all stones"), "{e}");
    let e = refusal(json!({"kind": "solitaire", "engrave": {"text": "Hi", "at": "outside", "side": "top"}}));
    assert!(e.contains("carries its stones"), "{e}");
    let e = refusal(json!({"kind": "band", "metal": "steel", "hallmark": true}));
    assert!(e.contains("no fineness mark"), "{e}");
    // A refusal leaves the drawing as it was.
    let mut s = mm_drawing();
    let before = piece(&mut s, json!({"kind": "band"}));
    assert!(s.execute("piece", &json!({"engrave": "x".repeat(60)})).is_err());
    assert_eq!(s.execute("piece", &json!({"query": true})).unwrap()["piece"]["params"], before["params"]);
}

/// Every character the engraving takes is one the stroke font draws itself (no fallback face, no
/// missing-glyph box), so the engraving is the same on every machine and on the web.
#[test]
fn every_engravable_character_is_drawn_by_the_stroke_font() {
    let all: Vec<char> = (' '..='ÿ').filter(|c| engravable(*c) && !c.is_whitespace()).collect();
    assert!(all.len() > 150);
    for c in all {
        let sh = cadcraft_fonts::shape_stroke(&c.to_string().replace('%', "%%%"), 1.0, 1.0, 0.0);
        assert!(sh.glyphs.is_empty(), "{c:?} comes from a fallback font");
        assert!(!sh.strokes.is_empty(), "{c:?} draws nothing");
        // A missing-glyph box is one closed rectangle, 4 units wide.
        let boxed = sh.strokes.len() == 1 && sh.strokes[0].len() == 5 && sh.strokes[0][0] == sh.strokes[0][4] && c != 'O' && c != 'D' && c != '0';
        assert!(!boxed || "#[]|_".contains(c), "{c:?} is a missing-glyph box");
    }
}

// ---------------------------------------------------------------------------------------------
// Layout and volume
// ---------------------------------------------------------------------------------------------

/// A straight groove `l` long with a round bottom: a box with a half-round floor, and two ends
/// that make a revolved cap — `l(2r(d−r) + πr²/2) + πr²(d−r) + ⅔πr³`.
#[test]
fn the_groove_volume_is_the_analytic_one() {
    for (l, r, d) in [(3.0, 0.1, 0.3), (5.0, 0.15, 0.15), (2.0, 0.25, 0.6)] {
        let f = Feature { strokes: vec![vec![Vec2::new(0.0, 0.0), Vec2::new(l, 0.0)]], r, depth: d, flat: false, outline: false };
        let want = l * (2.0 * r * (d - r) + PI * r * r / 2.0) + PI * r * r * (d - r) + 2.0 / 3.0 * PI * r.powi(3);
        let got = volume(&[f]);
        assert!(((got - want) / want).abs() < 0.01, "{l} {r} {d}: {got} vs {want}");
        // Flat-bottomed: the stadium's area by the depth.
        let f = Feature { strokes: vec![vec![Vec2::new(0.0, 0.0), Vec2::new(l, 0.0)]], r, depth: d, flat: true, outline: false };
        let want = (2.0 * r * l + PI * r * r) * d;
        assert!(((volume(&[f]) - want) / want).abs() < 0.01);
    }
    // Two strokes crossing are their union, not their sum.
    let a = Feature { strokes: vec![vec![Vec2::new(-1.0, 0.0), Vec2::new(1.0, 0.0)]], r: 0.1, depth: 0.2, flat: true, outline: false };
    let b = Feature { strokes: vec![vec![Vec2::new(0.0, -1.0), Vec2::new(0.0, 1.0)]], ..a.clone() };
    let one = volume(std::slice::from_ref(&a));
    let both = volume(&[a, b]);
    let overlap = 0.2 * 0.2 * 0.2;
    assert!((both - (2.0 * one - overlap)).abs() < 0.02 * one, "{both} vs {}", 2.0 * one - overlap);
}

#[test]
fn inside_text_is_centred_at_the_bottom_and_reads_from_the_finger() {
    let p = params(json!({"kind": "band", "engrave": "Forever 14.02.2026"}));
    let l = lettering(&p).unwrap().unwrap();
    let m = &l.marks[0];
    assert_eq!(m.place, Place::Inside);
    assert!((m.angle(0.0) + PI / 2.0).abs() < 1e-12, "the middle is at the bottom");
    // Seen from the finger (looking down −Y, the band's axis up), the text runs to −X.
    let section = p.section();
    let start = engrave::wrap(&p, &section, m, Vec2::new(-m.length / 2.0, 0.0), 0.0);
    let end = engrave::wrap(&p, &section, m, Vec2::new(m.length / 2.0, 0.0), 0.0);
    assert!(start.x > 0.0 && end.x < 0.0, "{start:?} → {end:?}");
    // On the inside surface, within the band's width.
    let ri = p.inner() / 2.0;
    for s in &m.features[0].strokes {
        for q in s {
            let w = engrave::wrap(&p, &section, m, *q, 0.0);
            assert!((Vec2::new(w.x, w.y).len() - ri).abs() < 1e-9);
            assert!(w.z.abs() < p.width / 2.0, "{w:?}");
        }
    }
    // Its length round the band is the stroke font's.
    let h = p.engrave.as_ref().unwrap().height_on(&p);
    let w = cadcraft_fonts::line_width("Forever 14.02.2026", h, 1.0);
    assert!((m.length - (w + 0.2)).abs() < 1e-9, "{} vs {w}", m.length);
    assert!(check_of(&piece(&mut mm_drawing(), json!({"kind": "band", "engrave": "Forever 14.02.2026"})), "engrave-fit")["ok"] == true);
}

#[test]
fn outside_text_on_a_name_ring_is_at_the_top_reading_from_outside() {
    let p = params(json!({"kind": "band", "width": 3, "engrave": {"text": "ANNA", "at": "outside", "style": "raised"}}));
    let l = lettering(&p).unwrap().unwrap();
    let m = &l.marks[0];
    assert!((m.angle(0.0) - PI / 2.0).abs() < 1e-12);
    // Seen from above (looking down −Y), the text runs to −X.
    assert!(m.angle(1.0) > m.angle(0.0));
    let s = p.section();
    let a = engrave::wrap(&p, &s, m, Vec2::new(-1.0, 0.0), 0.0);
    assert!(a.x > 0.0 && a.y > 0.0);
    // On a solitaire it goes to the bottom.
    let q = params(json!({"kind": "solitaire", "engrave": {"text": "ANNA", "at": "outside"}}));
    assert!((lettering(&q).unwrap().unwrap().marks[0].angle(0.0) + PI / 2.0).abs() < 1e-12);
}

// ---------------------------------------------------------------------------------------------
// Weight and checks
// ---------------------------------------------------------------------------------------------

#[test]
fn the_bench_weight_changes_by_the_groove_volume() {
    let mut s = mm_drawing();
    let plain = piece(&mut s, json!({"kind": "band", "width": 3, "metal": "gold18"}));
    let cut = piece(&mut s, json!({"engrave": "Forever 14.02.2026"}));
    let p = params(cut["params"].clone());
    let groove = lettering(&p).unwrap().unwrap().volume;
    assert!(groove < -1.0, "{groove} mm³");
    let want = grams(&plain) + groove / 1000.0 * 15.5;
    assert!((grams(&cut) - want).abs() < 0.006, "{} vs {want}", grams(&cut));
    // Raised on the outside adds; cut on the outside takes away.
    let raised = piece(&mut s, json!({"engrave": {"text": "ANNA", "at": "outside", "style": "raised"}}));
    let outside = piece(&mut s, json!({"engrave": {"style": "cut"}}));
    assert!(grams(&raised) > grams(&plain) && grams(&plain) > grams(&outside), "{} {} {}", grams(&raised), grams(&plain), grams(&outside));
    // The bench sheet reads the same grams off the band's record.
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    let bench = sheet["bands"][0]["grams"].as_f64().unwrap();
    assert!((bench - grams(&outside)).abs() < 0.006, "{bench} vs {}", grams(&outside));
}

#[test]
fn the_checks_say_what_is_wrong() {
    let mut s = mm_drawing();
    let ok = piece(&mut s, json!({"kind": "band", "engrave": "Forever"}));
    for id in ["engrave-fit", "engrave-depth", "engrave-stroke"] {
        assert_eq!(check_of(&ok, id)["ok"], true, "{id}: {}", check_of(&ok, id));
    }
    let tall = piece(&mut s, json!({"engrave": {"height": 2.0}}));
    assert_eq!(check_of(&tall, "engrave-fit")["ok"], false);
    assert!(check_of(&tall, "engrave-fit")["message"].as_str().unwrap().contains("band is 2.2 mm wide"));
    let deep = piece(&mut s, json!({"engrave": {"height": 1.0, "depth": 0.8}}));
    assert_eq!(check_of(&deep, "engrave-depth")["ok"], false);
    let fine = piece(&mut s, json!({"engrave": {"depth": 0.3, "stroke": 0.1}}));
    assert_eq!(check_of(&fine, "engrave-stroke")["ok"], false);
    assert!(check_of(&fine, "engrave-stroke")["message"].as_str().unwrap().contains("finer than the 0.2 mm"));
    let line = s.execute("piece", &json!({"engrave": {"stroke": null}})).unwrap()["message"].as_str().unwrap().to_string();
    assert!(line.contains("“Forever” cut inside"), "{line}");
}

// ---------------------------------------------------------------------------------------------
// The hallmark
// ---------------------------------------------------------------------------------------------

#[test]
fn the_hallmark_says_the_metal_s_fineness() {
    for (metal, mark) in
        [("gold18", "750"), ("gold14", "585"), ("gold9", "375"), ("gold22", "916"), ("platinum", "PT950"), ("palladium", "PD950"), ("silver", "925")]
    {
        let p = params(json!({"kind": "band", "metal": metal, "hallmark": true}));
        assert_eq!(p.hallmark.as_ref().unwrap().text(&p).as_deref(), Some(mark), "{metal}");
        assert_eq!(hallmark::fineness(metal), Some(mark));
    }
    for metal in ["steel", "titanium", "brass", "copper", "wax"] {
        assert_eq!(hallmark::fineness(metal), None);
    }
    let p = params(json!({"kind": "band", "metal": "platinum", "hallmark": {"maker": "CC"}}));
    assert_eq!(p.hallmark.as_ref().unwrap().text(&p).as_deref(), Some("PT950 CC"));
    let e = refusal(json!({"kind": "band", "hallmark": {"maker": "ABCDEFGHIJ"}}));
    assert!(e.contains("at most 8"), "{e}");
}

#[test]
fn the_hallmark_is_a_shallow_flat_cartouche_past_the_engraving() {
    let p = params(json!({"kind": "band", "hallmark": true}));
    let l = lettering(&p).unwrap().unwrap();
    let m = &l.marks[0];
    assert!((m.angle(0.0) + PI / 2.0).abs() < 1e-12, "alone, it is at the bottom");
    assert!(m.features.iter().all(|f| f.flat));
    assert_eq!(m.features[0].depth, RECESS);
    assert!((m.features[1].depth - (RECESS + PUNCH)).abs() < 1e-12);
    // It takes the recess and the punched characters: more than the bare recess, less than
    // the recess at the characters' depth.
    let recess = volume(&m.features[..1]);
    assert!(-l.volume > recess && -l.volume < recess / RECESS * (RECESS + PUNCH), "{} {recess}", l.volume);
    // With an engraving inside, it moves past the engraving's end, clear of it.
    let q = params(json!({"kind": "band", "engrave": "Forever", "hallmark": true}));
    let l = lettering(&q).unwrap().unwrap();
    let (e, h) = (&l.marks[0], &l.marks[1]);
    let apart = (e.angle(0.0) - h.angle(0.0)).abs() * e.r_ref;
    assert!(apart >= e.length / 2.0 + h.length / 2.0 + 0.99, "{apart}");
    let mut s = mm_drawing();
    let r = piece(&mut s, json!({"kind": "band", "engrave": "Forever", "hallmark": true}));
    assert_eq!(check_of(&r, "hallmark")["ok"], true, "{}", check_of(&r, "hallmark"));
    // An engraving that just fits leaves no room for the hallmark.
    let text = "Forever and ever, my love, always yours";
    let refused = (0..40).map(|k| 0.6 + 0.02 * f64::from(k)).find_map(|h| {
        let alone = mm_drawing().execute("piece", &json!({"kind": "band", "size": 3, "engrave": {"text": text, "height": h}}));
        let with = mm_drawing().execute("piece", &json!({"kind": "band", "size": 3, "engrave": {"text": text, "height": h}, "hallmark": true}));
        match (alone, with) {
            (Ok(_), Err(e)) => Some(e.to_string()),
            _ => None,
        }
    });
    let e = refused.expect("some height fits alone but not with the hallmark");
    assert!(e.contains("no room inside for the hallmark"), "{e}");
}

// ---------------------------------------------------------------------------------------------
// The sheet, the mesh, the solid
// ---------------------------------------------------------------------------------------------

#[test]
fn the_sheet_draws_the_developed_band_with_the_text() {
    let mut s = mm_drawing();
    let plain = piece(&mut s, json!({"kind": "band"}));
    let cut = piece(&mut s, json!({"engrave": "Forever 14.02.2026", "hallmark": true}));
    let n = |p: &Value| p["handles"].as_array().unwrap().len();
    let strokes = lettering(&params(cut["params"].clone()))
        .unwrap()
        .unwrap()
        .marks
        .iter()
        .flat_map(|m| m.features.iter())
        .map(|f| f.strokes.len())
        .sum::<usize>();
    assert_eq!(n(&cut), n(&plain) + 1 + strokes, "a strip and every stroke");
    // Both inside and outside: two strips.
    let both = piece(&mut s, json!({"hallmark": false, "engrave": {"at": "outside"}}));
    assert!(n(&both) > n(&plain));
}

#[test]
fn the_view_shows_the_lettering_within_the_budget() {
    for build in [
        json!({"kind": "band", "engrave": "Forever 14.02.2026"}),
        json!({"kind": "band", "width": 3, "engrave": {"text": "ANNA", "at": "outside", "style": "raised"}}),
        json!({"kind": "band", "engrave": {"text": "Sophie", "at": "outside", "font": "script"}, "hallmark": {"maker": "CC"}}),
        json!({"kind": "solitaire", "engrave": "x".repeat(40), "hallmark": true}),
    ] {
        let p = params(build.clone());
        for q in [Quality::Draft, Quality::Fine] {
            let mesh = piece_mesh(&p, q);
            check_mesh(&mesh, false, &build.to_string());
            assert!(mesh.notes.iter().all(|n| !n.contains("lettering")), "{:?}", mesh.notes);
        }
        let mesh = piece_mesh(&p, Quality::Draft);
        let raised = p.engrave.as_ref().is_some_and(|e| e.style == engrave::Style::Raised);
        assert!(mesh.meshes.iter().any(|m| m.name == if raised { "lettering" } else { "engraving" }), "{build}");
    }
    // The dark wires sit in the inside surface, sunk to half their radius.
    let p = params(json!({"kind": "band", "engrave": "Hi"}));
    let mesh = piece_mesh(&p, Quality::Draft);
    let e = part(&mesh, "engraving");
    let ri = p.inner() / 2.0;
    for v in &e.positions {
        let r = Vec2::new(v.x, v.y).len();
        assert!(r > ri - 0.11 && r < ri + 0.21, "{r} vs {ri}");
    }
}

/// The sheet's grams, the solid's volume and the band's analytic volume agree once the grooves
/// are cut (the grooves are resolved at 0.1 mm, so the merged solid is within the usual band
/// tolerance), and the solid has less metal than the plain band by about the groove volume.
#[test]
fn sheet_mesh_and_solid_agree_on_the_weight() {
    for build in [
        json!({"kind": "band", "width": 3, "engrave": "Forever 14.02.2026", "hallmark": true}),
        json!({"kind": "band", "width": 3, "engrave": {"text": "ANNA", "at": "outside", "style": "raised"}}),
    ] {
        let mut s = mm_drawing();
        let sheet = piece(&mut s, build.clone());
        let p = params(build.clone());
        let mesh = piece_mesh(&p, Quality::Fine);
        let solid = solidify(&mesh.csg, 0.1, 2_000_000).unwrap().0;
        verify(&solid.positions, &solid.indices).unwrap();
        assert_eq!(solid.bodies, 1, "{build}");
        let (v, b) = (solid.volume(), p.band_volume());
        assert!(((v - b) / b).abs() < 0.01, "{build}: solid {v} vs analytic {b}");
        assert!((grams(&sheet) - b / 1000.0 * p.density).abs() < 0.006);
        let reply = s.execute("piecemesh", &build).unwrap();
        assert!((reply["metal"]["grams"].as_f64().unwrap() - grams(&sheet)).abs() < 0.002);
        // Against the plain band's solid, the grooves' metal.
        let mut plain = build.clone();
        plain["engrave"] = json!(false);
        plain["hallmark"] = json!(false);
        let pp = params(plain);
        let bare = solidify(&piece_mesh(&pp, Quality::Fine).csg, 0.1, 2_000_000).unwrap().0;
        let (got, want) = (solid.volume() - bare.volume(), b - pp.band_volume());
        println!("{build}: solid change {got:.3} mm³, analytic {want:.3} mm³");
        assert!(got.signum() == want.signum() && ((got - want) / want).abs() < 0.1, "{build}: {got} vs {want}");
    }
}

// ---------------------------------------------------------------------------------------------
// Propose, DXF
// ---------------------------------------------------------------------------------------------

#[test]
fn proposing_an_engraving_is_running_it() {
    let mut s = mm_drawing();
    piece(&mut s, json!({"kind": "band"}));
    let r = s
        .execute(
            "propose",
            &json!({"steps": [{"command": "piece", "params": {"engrave": "Forever 14.02.2026", "hallmark": true}}], "title": "Engrave"}),
        )
        .unwrap();
    let id = r["proposals"][0]["id"].as_u64().unwrap();
    s.execute("accept", &json!({"id": id})).unwrap();
    let mut direct = mm_drawing();
    piece(&mut direct, json!({"kind": "band"}));
    piece(&mut direct, json!({"engrave": "Forever 14.02.2026", "hallmark": true}));
    assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted and run directly are the same drawing");
}

#[test]
fn an_engraving_survives_a_dxf_round_trip() {
    let mut s = mm_drawing();
    let p = piece(
        &mut s,
        json!({"kind": "band", "metal": "platinum", "engrave": {"text": "Für Anna - 2026", "font": "script"}, "hallmark": {"maker": "CC"}}),
    );
    let dxf = cadcraft_io::write_dxf(s.doc().unwrap());
    let read = cadcraft_io::read_dxf(dxf.as_bytes()).unwrap();
    let mut t = Session::new();
    t.open_drawing(read, "reopened", None);
    let q = t.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    for key in ["params", "metal", "checks"] {
        assert_eq!(q[key], p[key], "{key}");
    }
    // A change keeps the rest of the engraving.
    let r = piece(&mut t, json!({"engrave": {"depth": 0.2}}));
    assert_eq!(r["params"]["engrave"]["text"], "Für Anna - 2026");
    assert_eq!(r["params"]["engrave"]["font"], "script");
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

fn drawn_text(tc: &TestCase) -> String {
    let chars: Vec<char> = (' '..='ÿ').filter(|c| engravable(*c)).collect();
    let n = tc.draw(gs::integers::<usize>().min_value(1).max_value(MAX_TEXT));
    let mut s: String = (0..n).map(|_| chars[tc.draw(gs::integers::<usize>().min_value(0).max_value(chars.len() - 1))]).collect();
    if s.trim().is_empty() {
        s.push('A');
    }
    s
}

fn drawn_engraving(tc: &TestCase) -> Value {
    let text = drawn_text(tc);
    let outside = tc.draw(gs::booleans());
    let mut e = json!({"text": text, "at": if outside { "outside" } else { "inside" }});
    if outside && tc.draw(gs::booleans()) {
        e["style"] = json!("raised");
    }
    if tc.draw(gs::booleans()) {
        e["font"] = json!("script");
    }
    if tc.draw(gs::booleans()) {
        e["height"] = json!(tc.draw(gs::floats::<f64>().min_value(0.3).max_value(3.0)));
    }
    if tc.draw(gs::booleans()) {
        e["depth"] = json!(tc.draw(gs::floats::<f64>().min_value(0.05).max_value(1.0)));
    }
    let kinds = ["band", "solitaire", "threestone", "halfeternity", "dome", "signet", "eternity"];
    let kind = kinds[tc.draw(gs::integers::<usize>().min_value(0).max_value(kinds.len() - 1))];
    let profiles = ["flat", "dome", "comfort", "court", "knife", "bevel", "concave"];
    json!({
        "kind": kind,
        "size": tc.draw(gs::floats::<f64>().min_value(3.0).max_value(13.0)),
        "width": tc.draw(gs::floats::<f64>().min_value(1.5).max_value(8.0)),
        "profile": profiles[tc.draw(gs::integers::<usize>().min_value(0).max_value(profiles.len() - 1))],
        "engrave": e,
        "hallmark": tc.draw(gs::booleans()),
    })
}

/// Rule: any printable text within the limits never panics the sheet, the mesh or the solid; it
/// is drawn or refused in a sentence.
#[hegel::test(test_cases = 60)]
fn any_printable_engraving_is_drawn_or_refused(tc: TestCase) {
    let build = drawn_engraving(&tc);
    tc.note(&build.to_string());
    let mut s = mm_drawing();
    if let Err(e) = s.execute("piece", &build) {
        assert!(!matches!(e, crate::EngineError::Internal(..)), "{build} panicked: {e}");
    }
    match s.execute("piecemesh", &build) {
        Ok(r) => assert!(r["triangles"].as_u64().unwrap() as usize <= super::mesh::MAX_TRIANGLES),
        Err(e) => assert!(!matches!(e, crate::EngineError::Internal(..)), "{build} panicked: {e}"),
    }
}

/// Rule: a cut takes metal away and raised letters add it, by the groove volume.
#[hegel::test(test_cases = 40)]
fn the_weight_moves_the_right_way(tc: TestCase) {
    let build = drawn_engraving(&tc);
    tc.note(&build.to_string());
    let Ok(p) = PieceParams::parse("test", &build) else { return };
    let Ok(Some(l)) = lettering(&p) else { return };
    let mut plain = build.clone();
    plain["engrave"] = json!(false);
    plain["hallmark"] = json!(false);
    let bare = params(plain).band_volume();
    let raised = l.marks.iter().any(|m| m.raised);
    let cut = l.marks.iter().any(|m| !m.raised);
    let v = p.band_volume();
    if raised && !cut {
        assert!(v > bare, "{v} {bare}");
    }
    if cut && !raised {
        assert!(v < bare, "{v} {bare}");
    }
    assert!((v - bare - l.volume).abs() < 1e-9);
}

/// Rule: the cast solid of an engraved band stays one closed, watertight shell.
#[hegel::test(test_cases = 6)]
fn an_engraved_solid_stays_watertight(tc: TestCase) {
    let text = drawn_text(&tc).chars().take(12).collect::<String>();
    let outside = tc.draw(gs::booleans());
    let build = json!({"kind": "band", "width": 3, "engrave": {"text": text, "at": if outside { "outside" } else { "inside" }, "style": if outside && tc.draw(gs::booleans()) { "raised" } else { "cut" }}, "hallmark": tc.draw(gs::booleans())});
    tc.note(&build.to_string());
    let p = params(build);
    let mesh = piece_mesh(&p, Quality::Draft);
    let solid = solidify(&mesh.csg, 0.2, 1_000_000).unwrap().0;
    verify(&solid.positions, &solid.indices).unwrap();
    assert!(solid.volume() > 0.0);
    let _ = Vec3::ZERO;
}
