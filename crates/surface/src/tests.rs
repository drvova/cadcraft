//! The surfaces against the engine: the documents compile clean, the pictures carry the engine's
//! own figures, the output is deterministic, and hostile data draws an empty state.
//!
//! No font is shipped, so a PNG is drawn with a face of the machine the tests run on and refused
//! where there is none: every test of a PNG goes through [`png!`], which accepts either.

use cadcraft_engine::Session;
use serde_json::{Value, json};

use super::*;

/// The solitaire sample, open in a session.
fn sample() -> Session {
    let mut s = Session::empty();
    s.open_drawing(cadcraft_engine::sample::solitaire(), "Solitaire", None);
    s
}

/// A metric drawing holding one haloed solitaire piece.
fn haloed() -> Session {
    let mut s = Session::empty();
    s.new_drawing(true);
    s.execute("piece", &json!({"kind": "solitaire", "halo": true})).unwrap();
    s
}

/// The sample with a haloed solitaire piece built beside it: a piece and stones that are not the
/// piece's on one bench sheet.
fn sample_with_piece() -> Session {
    let mut s = sample();
    s.execute("piece", &json!({"kind": "solitaire", "halo": true, "at": [60, 0]})).unwrap();
    s
}

fn priced(s: &mut Session) {
    s.execute("pricebook", &json!({"set": {"currency": "USD", "metal": {"gold18": 62.5}, "stone": {"diamond": 4200}, "labor": {"flat": 180}}}))
        .unwrap();
}

/// The words of an SVG, run by run and as one text (a wrapped sentence is several runs).
fn words(svg: &str) -> (Vec<String>, String) {
    let runs = svg_text(svg);
    let all = runs.join(" ");
    (runs, all)
}

fn decode(png: &[u8]) -> tiny_skia::Pixmap {
    tiny_skia::Pixmap::decode_png(png).expect("a PNG")
}

/// A PNG, or the end of the test on a machine with no font: there the surface must have refused
/// in the sentence that says an SVG needs none.
macro_rules! png {
    ($drawn:expr) => {
        match $drawn {
            Ok(drawn) => drawn,
            Err(SurfaceError::NoFont(message)) => {
                assert!(png_font().is_none() && message.contains(".svg"), "{message}");
                return;
            }
            Err(other) => panic!("{other}"),
        }
    };
}

/// How many different colours a picture holds: a blank one has one.
fn colours(p: &tiny_skia::Pixmap) -> usize {
    p.pixels().iter().map(|c| (c.red(), c.green(), c.blue(), c.alpha())).collect::<std::collections::HashSet<_>>().len()
}

// ---------------------------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------------------------

#[test]
fn every_document_passes_slab_check_with_no_diagnostic() {
    for document in Document::ALL {
        let checked = check(document).unwrap();
        assert!(checked.clean(), "{}: {:#?}", document.file(), checked);
    }
}

#[test]
fn slab_check_reports_a_broken_document() {
    let checked = check_source("broken.slab", "import \"tokens.slab\"\ncol { text \"x\" color=color.nosuch }\n").unwrap();
    assert!(checked.errors.iter().any(|e| e.contains("broken.slab:2") && e.contains("error[ref]")), "{checked:#?}");
    assert!(compile("broken.slab", "col {").is_err());
}

#[test]
fn the_embedded_document_is_what_its_source_compiles_to() {
    // The build compiled the documents; compiling them again here must give the same bytes, or
    // the compiler is not deterministic and nothing downstream can be.
    for document in Document::ALL {
        let again = compile(document.file(), document.source()).unwrap();
        assert!(again == document.slir_bytes(), "{} compiles differently at run time", document.file());
        assert!(document.slir().is_ok());
    }
}

#[test]
fn the_documents_declare_the_dark_and_light_pair() {
    for document in Document::ALL {
        let slir = document.slir().unwrap();
        let themes: Vec<&str> = slir.themes.iter().map(|t| slir.str_at(*t)).collect();
        assert_eq!(themes, vec!["dark", "light"], "{}", document.file());
    }
}

// ---------------------------------------------------------------------------------------------
// The piece card
// ---------------------------------------------------------------------------------------------

#[test]
fn the_card_carries_the_engines_numbers_exactly() {
    let mut s = sample_with_piece();
    let piece = s.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    let data = PieceData::gather(&mut s);
    let (runs, all) = words(&card_svg(&data, &CardOptions::default()).unwrap());
    let has = |text: &str| runs.iter().any(|r| r == text);

    // The stones are the bench sheet's: the sample's own and the piece's, counted by the engine.
    let count = sheet["stones"]["count"].as_u64().unwrap();
    assert_eq!(count, 52, "the sample's 32 stones and the haloed solitaire's 20");
    assert!(has(&count.to_string()), "{runs:?}");
    assert!(has(&format!("{:.3} ct", sheet["stones"]["carat"].as_f64().unwrap())), "{runs:?}");
    // The metal is the piece's.
    let grams = piece["metal"]["grams"].as_f64().unwrap();
    assert!(has(&format!("{grams:.2} g")), "{runs:?}");
    assert!(has(piece["metal"]["name"].as_str().unwrap()), "{runs:?}");
    // The size, in two systems.
    assert!(has(&format!("US {}", piece["size"]["usText"].as_str().unwrap())), "{runs:?}");
    assert!(all.contains(&format!("EU {}", piece["size"]["eu"])), "{all}");
    // Each check: its verdict word, and the engine's sentence.
    let checks = piece["checks"].as_array().unwrap();
    assert_eq!(checks.len(), 5);
    assert_eq!(runs.iter().filter(|r| *r == "PASS" || *r == "FAIL").count(), 5, "{runs:?}");
    for (c, shown) in checks.iter().zip(&data.checks) {
        assert_eq!(shown.verdict(), if c["ok"] == json!(true) { "PASS" } else { "FAIL" });
        assert_eq!(shown.ok, c["ok"].as_bool().unwrap());
        assert!(all.contains(c["message"].as_str().unwrap()), "{}: {all}", c["id"]);
    }
    assert_eq!(runs.iter().filter(|r| *r == "PASS").count(), checks.iter().filter(|c| c["ok"] == json!(true)).count());
    // Every stone line of the sheet.
    for g in sheet["stones"]["groups"].as_array().unwrap() {
        assert!(has(&format!("{:.3}", g["carat"].as_f64().unwrap())), "{g}: {runs:?}");
    }
    assert!(has("Solitaire ring") && has("SOLITAIRE"), "{runs:?}");
    // No price book: no cost on the card.
    assert!(!has("COST") && data.cost.is_none());
}

#[test]
fn a_failed_check_reads_fail() {
    let mut s = Session::empty();
    s.new_drawing(true);
    // A wall under what a bench casts: the engine builds it and fails the check.
    s.execute("piece", &json!({"kind": "band", "wall": 0.4})).unwrap();
    let piece = s.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    let failed = piece["checks"].as_array().unwrap().iter().filter(|c| c["ok"] == json!(false)).count();
    assert!(failed >= 1, "{piece}");
    let data = PieceData::gather(&mut s);
    let (runs, _) = words(&card_svg(&data, &CardOptions::default()).unwrap());
    assert_eq!(runs.iter().filter(|r| *r == "FAIL").count(), failed, "{runs:?}");
    assert!(runs.iter().any(|r| r == "A CHECK FAILS"), "{runs:?}");
    assert!(!runs.iter().any(|r| r == "ALL CHECKS PASS"));
}

#[test]
fn the_cost_is_on_the_card_when_the_drawing_has_a_price_book() {
    let mut s = haloed();
    priced(&mut s);
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    let data = PieceData::gather(&mut s);
    let (runs, all) = words(&card_svg(&data, &CardOptions::default()).unwrap());
    let total = sheet["cost"]["total"].as_f64().unwrap();
    assert!(runs.iter().any(|r| *r == format!("{total:.2}")), "{runs:?}");
    assert!(runs.iter().any(|r| *r == format!("USD {total:.2}")), "{runs:?}");
    assert!(all.contains(sheet["cost"]["note"].as_str().unwrap()), "{all}");
    for line in sheet["cost"]["lines"].as_array().unwrap() {
        assert!(runs.iter().any(|r| r == line["what"].as_str().unwrap()), "{line}: {runs:?}");
        assert!(runs.iter().any(|r| *r == format!("{:.2}", line["amount"].as_f64().unwrap())), "{line}: {runs:?}");
    }
}

#[test]
fn the_card_png_has_the_width_asked_for_and_is_not_blank() {
    let mut s = haloed();
    let card = png!(piece_card(&mut s, &CardOptions::default()));
    assert_eq!(card.picture.width, 1280, "640 units at two pixels a unit");
    let pixmap = decode(&card.picture.png);
    assert_eq!((pixmap.width(), pixmap.height()), (card.picture.width, card.picture.height));
    assert!(pixmap.height() > 600, "a card with five checks is taller than this: {}", pixmap.height());
    assert!(colours(&pixmap) > 50, "text, tiles and status inks: {}", colours(&pixmap));
    assert!((card.picture.png.len() as u64) < MAX_PNG_BYTES);

    let narrow = png!(card_png(&card.data, &CardOptions { width: 400, scale: 1.0, theme: Theme::Light }));
    assert_eq!(narrow.width, 400);
    // The two palettes are different pictures: the page is dark in one and light in the other.
    let corner = |p: &tiny_skia::Pixmap| p.pixel(2, 2).map(|c| c.red()).unwrap();
    assert!(corner(&pixmap) < 40 && corner(&decode(&narrow.png)) > 200);
}

#[test]
fn sizes_are_clamped_not_trusted() {
    let data = PieceData::from_replies(None, None);
    for (width, scale) in [(0, 0.0), (u32::MAX, 1e9), (640, f64::NAN), (640, f64::NEG_INFINITY), (1, -3.0)] {
        let p = png!(card_png(&data, &CardOptions { width, scale, theme: Theme::Dark }));
        assert!((160..=4800).contains(&p.width), "{width} at {scale}: {}", p.width);
    }
}

// ---------------------------------------------------------------------------------------------
// The bench sheet
// ---------------------------------------------------------------------------------------------

#[test]
fn the_sheet_is_byte_identical_for_the_same_drawing() {
    let options = SheetOptions::default();
    let first = tech_sheet_svg(&mut sample_with_piece(), &options).unwrap();
    let second = tech_sheet_svg(&mut sample_with_piece(), &options).unwrap();
    assert!(first == second, "the same drawing gave two different sheets");
    assert!(first.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
    let card = |s: &mut Session| card_svg(&PieceData::gather(s), &CardOptions::default()).unwrap();
    assert!(card(&mut haloed()) == card(&mut haloed()));
    // And the pictures too, on the machine that draws them.
    let a = png!(tech_sheet_png(&mut sample_with_piece(), &options));
    let b = png!(tech_sheet_png(&mut sample_with_piece(), &options));
    assert!(a == b);
    let first = png!(piece_card(&mut haloed(), &CardOptions::default())).picture;
    let second = png!(piece_card(&mut haloed(), &CardOptions::default())).picture;
    assert!(first == second);
}

#[test]
fn the_sheet_shows_the_views_the_bands_the_stones_and_their_totals() {
    let mut s = sample_with_piece();
    priced(&mut s);
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    let svg = tech_sheet_svg(&mut s, &SheetOptions::default()).unwrap();
    let (runs, all) = words(&svg);
    let has = |text: &str| runs.iter().any(|r| r == text);
    // The views: the engine's picture of the drawing, embedded.
    assert_eq!(svg.matches("<image").count(), 1, "one picture of the drawing");
    assert!(svg.contains("data:image/png;base64,"));
    // The page names a generic family and embeds no face.
    assert!(!svg.contains("@font-face") && !svg.contains("font/ttf"));
    assert!(!svg.contains("font-family=\", "), "no font list opens with an empty name");
    assert!(svg.contains("font-family=\"Helvetica, Arial, sans-serif\""));
    for heading in ["BENCH SHEET", "METAL", "STONES", "CHECKS", "COST"] {
        assert!(has(heading), "{heading}: {runs:?}");
    }
    let bands = sheet["bands"].as_array().unwrap();
    assert_eq!(bands.len(), 2, "the sample's ring and the piece's");
    for b in bands {
        assert!(has(&format!("{:.2} g", b["grams"].as_f64().unwrap())), "{b}: {runs:?}");
    }
    // The totals row is the engine's count and carat.
    let count = sheet["stones"]["count"].to_string();
    assert!(runs.iter().filter(|r| **r == count).count() >= 2, "in the figure and in the total: {runs:?}");
    assert!(has(&format!("{:.3}", sheet["stones"]["carat"].as_f64().unwrap())), "{runs:?}");
    assert!(all.contains(&format!("USD {:.2}", sheet["cost"]["total"].as_f64().unwrap())), "{all}");
    assert!((svg.len() as u64) < 600_000, "a page, not a font file: {} bytes", svg.len());
}

#[test]
fn the_sheet_png_is_a_page() {
    let mut s = sample();
    let page = png!(tech_sheet_png(&mut s, &SheetOptions::default()));
    assert_eq!(page.width, 794 * 2);
    let pixmap = decode(&page.png);
    assert!(colours(&pixmap) > 100, "{}", colours(&pixmap));
    // Without the views it is shorter, and still a page.
    let plain = png!(tech_sheet_png(&mut s, &SheetOptions { views: false, ..SheetOptions::default() }));
    assert!(plain.height + 500 < page.height, "{} against {}", plain.height, page.height);
}

// ---------------------------------------------------------------------------------------------
// Fonts: none is shipped
// ---------------------------------------------------------------------------------------------

#[test]
fn slab_is_linked_without_its_bundled_faces() {
    // The patched Slab of `third_party/slab`, built with `default-features = false`.
    assert_eq!(slab_fonts::FONT_ASSETS.len(), 0, "this build of Slab carries font bytes");
    assert!(slab_fonts::asset(slab_fonts::CLASS_SANS, 400).is_none() && slab_fonts::asset(slab_fonts::CLASS_MONO, 400).is_none());
    // So every document's tables are the built-in default advances, with no face behind them.
    for document in Document::ALL {
        let slir = document.slir().unwrap();
        assert!(!slir.fonts.is_empty());
        for table in &slir.fonts {
            assert!(table.data.is_empty(), "{}: a face is embedded", document.file());
            assert_eq!(table.upem, slab_fonts::DEFAULT_UPEM, "{}", document.file());
        }
        let bytes = document.slir_bytes();
        for name in [&b"Inter"[..], b"JetBrains"] {
            assert!(!bytes.windows(name.len()).any(|w| w == name), "{} names a face", document.file());
        }
    }
}

#[test]
fn an_svg_needs_no_font_and_names_a_generic_family() {
    let data = PieceData::gather(&mut haloed());
    for svg in [sheet_svg(&data, None, &SheetOptions::default()).unwrap(), card_svg(&data, &CardOptions::default()).unwrap()] {
        assert!(svg.len() < 60_000, "{}", svg.len());
        assert!(!svg.contains("@font-face") && !svg.contains("font/ttf") && !svg.contains("Inter") && !svg.contains("JetBrains"));
        // Every run is written with the width it was laid out at, so a viewer's own face fits it.
        let (runs, fitted) = (svg.matches("<text").count(), svg.matches("textLength=").count());
        assert!(runs > 20 && fitted * 10 >= runs * 9, "{fitted} of {runs} runs carry their width");
        let families: std::collections::BTreeSet<&str> = svg.split("font-family=\"").skip(1).filter_map(|rest| rest.split('"').next()).collect();
        assert_eq!(families.into_iter().collect::<Vec<_>>(), vec!["Helvetica, Arial, sans-serif"]);
    }
}

#[test]
fn a_png_without_a_font_is_refused_in_a_sentence() {
    // What a machine with no font gets, whatever this one has.
    let data = PieceData::gather(&mut haloed());
    let mut d = crate::card::filled_for_tests(&data).unwrap();
    let images = std::mem::take(&mut d.imgs);
    let refused = crate::render::png_with(Document::PieceCard, &mut d.inst, &images, 640, 2.0, Theme::Dark, None).unwrap_err();
    assert!(matches!(refused, SurfaceError::NoFont(_)), "{refused:?}");
    let sentence = refused.to_string();
    assert!(sentence.starts_with("a PNG surface needs a font") && sentence.contains("Inter") && sentence.contains(".svg"), "{sentence}");
    // And the public door says the same where there is none.
    match card_png(&data, &CardOptions::default()) {
        Ok(picture) => assert!(png_font().is_some() && picture.width == 1280),
        Err(e) => assert!(png_font().is_none() && matches!(e, SurfaceError::NoFont(_)), "{e}"),
    }
}

#[test]
fn a_png_is_set_in_the_machines_face() {
    let Some(face) = png_font() else { return };
    assert!(!face.is_empty());
    // The text is ink: the card with its words differs from the card without them by far more
    // than the tiles alone.
    let data = PieceData::gather(&mut haloed());
    let card = png!(card_png(&data, &CardOptions { width: 640, scale: 1.0, theme: Theme::Light }));
    let pixmap = decode(&card.png);
    let dark = pixmap.pixels().iter().filter(|c| c.alpha() > 0 && u32::from(c.red()) + u32::from(c.green()) + u32::from(c.blue()) < 200).count();
    assert!(dark > 1_500, "the ink of the card's text: {dark} dark pixels");
}

// ---------------------------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------------------------

#[test]
fn the_dashboard_prints_the_engines_numbers_as_text() {
    let mut s = sample_with_piece();
    let piece = s.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    let sheet = s.execute("techsheet", &json!({})).unwrap();
    let text = dashboard_text(&mut s, 120, 40, Theme::Dark, true).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 40, "one line a row:\n{text}");
    assert!(lines.iter().all(|l| l.chars().count() <= 120), "{text}");
    assert!(lines[0].starts_with("CADCRAFT") && lines[0].ends_with("ALL CHECKS PASS"), "{}", lines[0]);
    assert!(text.contains(&format!("{:.2} g gold18", piece["metal"]["grams"].as_f64().unwrap())), "{text}");
    assert!(text.contains(&format!("{} · {:.3} ct", sheet["stones"]["count"], sheet["stones"]["carat"].as_f64().unwrap())), "{text}");
    assert_eq!(text.matches("PASS ").count(), 5, "{text}");
    for name in ["Wall", "Stone seat", "Spacing", "Calibrated", "Size"] {
        assert!(text.contains(name), "{name}:\n{text}");
    }
    // The bench sheet's own lines, as the engine wrote them.
    let first = sheet["message"].as_str().unwrap().lines().next().unwrap();
    assert!(text.contains(first), "{first}:\n{text}");
    // No colour in the plain form; the other form is the same grid with escapes.
    assert!(!text.contains('\u{1b}'));
    let ansi = dashboard_text(&mut s, 120, 40, Theme::Dark, false).unwrap();
    assert!(ansi.contains("\u{1b}[") && ansi.contains("CADCRAFT"));
}

#[test]
fn a_small_terminal_keeps_the_piece_and_drops_the_bench_lines() {
    let mut s = haloed();
    let text = dashboard_text(&mut s, 80, 24, Theme::Dark, true).unwrap();
    assert_eq!(text.lines().count(), 24, "{text}");
    assert!(text.contains("PIECE") && text.contains("CHECKS") && text.contains("LOG"), "{text}");
    assert!(!text.contains("BENCH SHEET"), "{text}");
    // A size no terminal has is clamped to one the dashboard can be read at.
    let tiny = dashboard_text(&mut s, 1, 1, Theme::Dark, true).unwrap();
    assert_eq!(tiny.lines().count(), usize::from(MIN_ROWS), "{tiny}");
    let huge = dashboard_text(&mut s, u16::MAX, u16::MAX, Theme::Light, true).unwrap();
    assert_eq!(huge.lines().count(), usize::from(MAX_ROWS));
}

#[test]
fn a_line_typed_at_the_dashboard_runs_at_the_engines_command_line() {
    let mut s = Session::empty();
    s.new_drawing(true);
    let mut dashboard = Dashboard::new(Theme::Dark).unwrap();
    dashboard.refresh(&mut s).unwrap();
    let before = dashboard.text(100, 30, true).unwrap();
    assert!(before.contains("No piece in this drawing"), "{before}");

    // Typed through the kernel, as a terminal's keys arrive: text, then Enter.
    dashboard.type_line(&mut s, "circle 0,0 5").unwrap();
    assert_eq!(s.doc().unwrap().model.iter().count(), 1, "the circle is in the drawing");
    assert!(dashboard.log().iter().any(|l| l == "> circle 0,0 5"), "{:?}", dashboard.log());
    let after = dashboard.text(100, 30, true).unwrap();
    assert!(after.contains("> circle 0,0 5"), "{after}");
    // The command line is empty again, ready for the next line.
    assert!(after.lines().any(|l| l.starts_with('>') && !l.chars().any(char::is_alphanumeric)), "{after}");
    assert!(after.contains("BENCH SHEET") && after.find("BENCH SHEET") < after.find("LOG"), "the bench lines sit above the log:\n{after}");

    // A line the engine refuses is logged, and the dashboard goes on.
    dashboard.type_line(&mut s, "nosuchcommand").unwrap();
    assert!(dashboard.log().len() >= 3, "{:?}", dashboard.log());
    assert!(dashboard.text(100, 30, true).is_ok());

    // A piece built from the command line shows in the panels: the same engine, the same door.
    dashboard.run_line(&mut s, "(cmd \"piece\" '((KIND . \"band\")))").unwrap();
    let built = dashboard.text(100, 30, true).unwrap();
    assert!(built.contains("Band") && built.contains("PASS"), "{built}");
}

#[test]
fn hostile_command_lines_are_refused_not_run() {
    let mut s = Session::empty();
    s.new_drawing(true);
    let mut dashboard = Dashboard::new(Theme::Dark).unwrap();
    for line in ["\u{1b}[2Jline 0,0 1,1", &"x".repeat(100_000), "a\u{0}b", "\n\n"] {
        dashboard.run_line(&mut s, line).unwrap();
    }
    assert_eq!(s.doc().unwrap().model.iter().count(), 0, "nothing was drawn");
    assert!(dashboard.log().iter().all(|l| l.chars().count() <= data::MAX_SENTENCE && !l.contains('\u{1b}')), "{:?}", dashboard.log());
    // The log keeps a bounded tail however much is typed.
    for i in 0..500 {
        dashboard.run_line(&mut s, &format!("nosuch{i}")).unwrap();
    }
    assert!(dashboard.log().len() <= 200);
}

// ---------------------------------------------------------------------------------------------
// Hostile data and empty states
// ---------------------------------------------------------------------------------------------

/// Draw every surface for the data, and say what the card shows.
fn draw_all(data: &PieceData) -> Vec<String> {
    if png_font().is_some() {
        let card = card_png(data, &CardOptions::default()).unwrap();
        assert!(colours(&decode(&card.png)) > 3);
        sheet_png(data, None, &SheetOptions::default()).unwrap();
    } else {
        assert!(matches!(card_png(data, &CardOptions::default()), Err(SurfaceError::NoFont(_))));
        assert!(matches!(sheet_png(data, None, &SheetOptions::default()), Err(SurfaceError::NoFont(_))));
    }
    let sheet = sheet_svg(data, None, &SheetOptions::default()).unwrap();
    assert!(sheet.len() < 2_000_000, "{}", sheet.len());
    let mut dashboard = Dashboard::new(Theme::Dark).unwrap();
    dashboard.fill(data).unwrap();
    dashboard.text(100, 40, true).unwrap();
    svg_text(&card_svg(data, &CardOptions::default()).unwrap())
}

#[test]
fn an_empty_drawing_and_no_drawing_draw_an_empty_state() {
    // No drawing at all.
    let mut none = Session::empty();
    let data = PieceData::gather(&mut none);
    assert_eq!(data.title, "No drawing is open");
    let runs = draw_all(&data);
    assert!(runs.iter().any(|r| r == "No drawing is open"), "{runs:?}");
    // A new drawing with nothing in it: no piece, no stones, and the card says so.
    let mut empty = Session::empty();
    empty.new_drawing(true);
    let data = PieceData::gather(&mut empty);
    assert!(!data.has_piece && data.stones.is_empty() && data.cost.is_none());
    let runs = draw_all(&data);
    assert!(runs.iter().any(|r| r == "No piece in this drawing"), "{runs:?}");
    assert!(runs.join(" ").contains("there are no checks to show"), "{runs:?}");
    assert!(!runs.iter().any(|r| r == "PASS" || r == "FAIL"));
    assert!(Views::of(&empty).is_none(), "nothing to draw: no views");
    assert!(tech_sheet_svg(&mut empty, &SheetOptions::default()).unwrap().matches("<image").count() == 0);
    // The sample has no parametric piece: its ring and stones still head the card.
    let mut s = sample();
    let data = PieceData::gather(&mut s);
    assert!(!data.has_piece && data.size_a.starts_with("US "), "{data:?}");
    let runs = draw_all(&data);
    assert!(runs.iter().any(|r| r == "Bench sheet") && runs.iter().any(|r| r == "32"), "{runs:?}");
}

#[test]
fn hostile_replies_never_panic_and_are_capped() {
    let long = "W".repeat(200_000);
    let nasty = "a\u{0}\u{1b}[31m\r\n\t\u{202e}evil\u{7f} <svg onload=x>&amp;\"'";
    let group = |i: usize| json!({"cut": format!("{nasty}{i}"), "width": 1e308, "length": -1e308, "count": u64::MAX, "caratEach": 1e300, "carat": -0.0, "handles": [long.clone()]});
    let sheet = json!({
        "stones": {"count": u64::MAX, "carat": 1e308, "groups": (0..10_000).map(group).collect::<Vec<_>>()},
        "bands": (0..5_000).map(|_| json!({"size": long.clone(), "metal": nasty, "grams": 1e308, "mm": -5, "width": "wide", "wall": null})).collect::<Vec<_>>(),
        "warnings": (0..5_000).map(|_| json!(long.clone())).collect::<Vec<_>>(),
        "message": std::iter::repeat_n(long.as_str(), 2_000).collect::<Vec<_>>().join("\n"),
        "cost": {"currency": long.clone(), "total": 1e308, "note": nasty, "lines": (0..10_000).map(|_| json!({"what": long.clone(), "unit": nasty, "qty": 1e308, "rate": -1e308, "amount": 1e-320})).collect::<Vec<_>>()},
    });
    let piece = json!({
        "params": {"kind": long.clone(), "sizeSystem": nasty, "profile": long.clone(), "width": 1e308, "wall": -1.0, "cut": nasty, "stone": nasty, "stoneWidth": 1e308, "halo": 1e-300, "prongs": u64::MAX},
        "size": {"usText": long.clone(), "eu": 1e308, "mm": 1e308},
        "metal": {"name": long.clone(), "grams": 1e308},
        "stones": {"count": -1, "carat": "many"},
        "checks": (0..10_000).map(|i| json!({"id": format!("{nasty}{i}"), "ok": if i % 2 == 0 { json!(true) } else { json!("yes") }, "message": long.clone()})).collect::<Vec<_>>(),
        "handles": (0..5_000).map(|i| json!(format!("{i:X}"))).collect::<Vec<_>>(),
    });
    let data = PieceData::from_replies(Some(&piece), Some(&sheet));
    assert_eq!(data.stones.len(), data::MAX_STONE_ROWS);
    assert_eq!(data.stones_left_out, 10_000 - data::MAX_STONE_ROWS);
    assert!(data.stones_more().contains("more lines"));
    assert_eq!(data.checks.len(), data::MAX_CHECK_ROWS);
    assert_eq!(data.bands.len(), data::MAX_BAND_ROWS);
    assert_eq!(data.warnings.len(), data::MAX_WARNING_ROWS);
    assert_eq!(data.cost.as_ref().unwrap().lines.len(), data::MAX_COST_ROWS);
    assert!(data.bench.len() <= data::MAX_BENCH_LINES);
    // A check that does not say `true` did not pass.
    assert!(!data.checks[1].ok && data.checks[0].ok);
    // Nothing printed is longer than a row can hold, or carries a control character.
    let printed: Vec<&String> = [&data.title, &data.subtitle, &data.size_a, &data.size_b, &data.metal, &data.metal_note]
        .into_iter()
        .chain(data.checks.iter().flat_map(|c| [&c.name, &c.message]))
        .chain(data.stones.iter().map(|s| &s.what))
        .chain(data.bands.iter().flat_map(|b| [&b.size, &b.metal]))
        .chain(&data.warnings)
        .chain(&data.bench)
        .collect();
    for text in printed {
        assert!(text.chars().count() <= data::MAX_SENTENCE + 1, "{} characters", text.chars().count());
        assert!(!text.chars().any(|c| c.is_control() || c == '\u{202e}'), "{text:?}");
    }
    assert!(data.json.to_string().len() < 400_000 && !data.json.to_string().contains("\"handles\""), "{}", data.json.to_string().len());

    // And it draws: every surface, both palettes.
    let runs = draw_all(&data);
    assert!(runs.iter().any(|r| r == "PASS") && runs.iter().any(|r| r == "FAIL"), "{runs:?}");
    // Markup in a name is text on the page, not markup.
    let svg = card_svg(&data, &CardOptions::default()).unwrap();
    assert!(!svg.contains("<svg onload") && svg.contains("&lt;svg onload"), "escaped");
    let light = png!(card_png(&data, &CardOptions { theme: Theme::Light, ..CardOptions::default() }));
    assert!((light.png.len() as u64) < MAX_PNG_BYTES);
}

#[test]
fn views_the_kernel_refuses_are_left_out() {
    let data = PieceData::from_replies(None, None);
    for views in [
        Views { png: b"not a png".to_vec(), width: 10, height: 10 },
        Views { png: Vec::new(), width: 0, height: 0 },
        Views { png: vec![0; 64], width: u32::MAX, height: u32::MAX },
    ] {
        let svg = sheet_svg(&data, Some(&views), &SheetOptions::default()).unwrap();
        assert_eq!(svg.matches("<image").count(), 0);
    }
}

// ---------------------------------------------------------------------------------------------
// The engine's door
// ---------------------------------------------------------------------------------------------

#[test]
fn gathering_changes_nothing_in_the_drawing() {
    let mut s = haloed();
    let (doc, undo, log) = (s.state().unwrap().doc.clone(), s.state().unwrap().undo.len(), s.log.len());
    assert!(matches!(piece_card(&mut s, &CardOptions::default()), Ok(_) | Err(SurfaceError::NoFont(_))));
    card_svg(&PieceData::gather(&mut s), &CardOptions::default()).unwrap();
    tech_sheet_svg(&mut s, &SheetOptions::default()).unwrap();
    dashboard_text(&mut s, 100, 30, Theme::Dark, true).unwrap();
    assert!(std::sync::Arc::ptr_eq(&doc, &s.state().unwrap().doc), "the drawing is the same drawing");
    assert_eq!(s.state().unwrap().undo.len(), undo, "and there is nothing new to undo");
    assert_eq!(s.log.len(), log, "and nothing was printed at the command line");
}

#[test]
fn the_engine_reaches_the_card_once_installed() {
    install();
    install();
    assert!(cadcraft_engine::surfaces::available());
    let mut s = haloed();
    if png_font().is_none() {
        // The door draws PNGs: with no font on the machine it answers with the sentence.
        let e = cadcraft_engine::surfaces::render(&mut s, "piece-card", &json!({})).unwrap_err();
        assert!(e.contains("needs a font") && e.contains(".svg"), "{e}");
        return;
    }
    let picture = cadcraft_engine::surfaces::render(&mut s, "piece-card", &json!({})).unwrap();
    assert_eq!(picture.width, 1280);
    assert_eq!(picture.data["piece"]["stones"]["count"], 20);
    assert_eq!(picture.data["sheet"]["stones"]["count"], 20);
    assert!(picture.data["piece"].get("handles").is_none());
    let wide = cadcraft_engine::surfaces::render(&mut s, "piece-card", &json!({"width": 800, "theme": "light"})).unwrap();
    assert_eq!(wide.width, 1600);
    let sheet = cadcraft_engine::surfaces::render(&mut s, "tech-sheet", &json!({})).unwrap();
    assert_eq!(sheet.width, 794 * 2);
    // What it does not know, it refuses in a sentence.
    for (name, params) in
        [("nosuch", json!({})), ("piece-card", json!({"theme": "sepia"})), ("piece-card", json!({"theme": 7})), (&*"x".repeat(100_000), json!({}))]
    {
        let e = cadcraft_engine::surfaces::render(&mut s, name, &params).unwrap_err();
        assert!(e.len() < 200, "{e}");
    }
    // A hostile width is clamped.
    for width in [json!(-1), json!(1e300), json!("wide"), json!(null), json!([640])] {
        let p = cadcraft_engine::surfaces::render(&mut s, "piece-card", &json!({ "width": width })).unwrap();
        assert!((640..=2400).contains(&p.width), "{}", p.width);
    }
}

#[test]
fn the_assistant_draws_the_card_from_inside_a_run() {
    install();
    let mut s = haloed();
    let dir = std::env::temp_dir().join(format!("cadcraft-surface-test-{}", std::process::id()));
    let path = dir.join("card.png");
    let code = format!("(card \"{}\" 800 \"light\")", path.to_string_lossy().replace('\\', "/"));
    let r = s.execute("run", &json!({ "code": code })).unwrap();
    if png_font().is_none() {
        // No font on the machine: the model reads why there is no card, and nothing was written.
        assert!(r["error"].as_str().is_some_and(|e| e.contains("needs a font")), "{r}");
        assert!(!path.exists());
        return;
    }
    assert!(r.get("error").is_none_or(Value::is_null), "{r}");
    let images: Vec<&str> = r["images"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert_eq!(images.len(), 1, "{r}");
    let png = std::fs::read(&path).unwrap();
    assert_eq!(decode(&png).width(), 1600);
    let value = r["value"].as_str().unwrap();
    assert!(value.contains("(WIDTH . 1600)") && value.contains("(COUNT . 20)") && value.contains("PIECE"), "{value}");
    // Bad arguments are LISP errors the model reads, never a panic.
    for bad in ["(card 1 2 3 4)", "(card \"a.png\" \"light\" \"dark\")", "(card 800 \"sepia\")", "(card '(1 2))"] {
        let r = s.execute("run", &json!({ "code": bad })).unwrap();
        assert!(r["error"].is_string(), "{bad}: {r}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------------------------
// Looking at them
// ---------------------------------------------------------------------------------------------

/// Write every surface for the sample and for a haloed solitaire into the directory named by
/// `CADCRAFT_SURFACE_SAMPLES`, to be looked at. Without the variable it does nothing.
#[test]
fn write_the_samples_to_look_at() {
    let Some(dir) = std::env::var_os("CADCRAFT_SURFACE_SAMPLES").map(std::path::PathBuf::from) else { return };
    std::fs::create_dir_all(&dir).unwrap();
    let mut drawings = vec![("sample", sample()), ("halo", haloed()), ("halo-priced", haloed())];
    priced(&mut drawings[2].1);
    let mut empty = Session::empty();
    empty.new_drawing(true);
    drawings.push(("empty", empty));
    for (name, s) in &mut drawings {
        for theme in [Theme::Dark, Theme::Light] {
            let t = theme.name();
            let options = SheetOptions { theme, ..SheetOptions::default() };
            std::fs::write(dir.join(format!("sheet-{name}-{t}.svg")), tech_sheet_svg(s, &options).unwrap()).unwrap();
            if png_font().is_some() {
                let card = piece_card(s, &CardOptions { theme, ..CardOptions::default() }).unwrap();
                std::fs::write(dir.join(format!("card-{name}-{t}.png")), &card.picture.png).unwrap();
                std::fs::write(dir.join(format!("sheet-{name}-{t}.png")), tech_sheet_png(s, &options).unwrap().png).unwrap();
            }
        }
        std::fs::write(dir.join(format!("card-{name}.svg")), card_svg(&PieceData::gather(s), &CardOptions::default()).unwrap()).unwrap();
        std::fs::write(dir.join(format!("card-{name}.json")), serde_json::to_string_pretty(&PieceData::gather(s).json).unwrap()).unwrap();
        std::fs::write(dir.join(format!("tui-{name}-120x40.txt")), dashboard_text(s, 120, 40, Theme::Dark, true).unwrap()).unwrap();
        std::fs::write(dir.join(format!("tui-{name}-80x24.txt")), dashboard_text(s, 80, 24, Theme::Dark, true).unwrap()).unwrap();
        std::fs::write(dir.join(format!("tui-{name}-120x40.ansi")), dashboard_text(s, 120, 40, Theme::Dark, false).unwrap()).unwrap();
    }
}
