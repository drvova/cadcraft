//! `objects`: the list an interface shows as the drawing's tree — kinds, layers, the telling
//! fact of each object, its groups; bounded, sanitised, and read-only.

use cadcraft_doc::{Entity, EntityKind, Handle};
use serde_json::{Value, json};

use super::{MAX_LIMIT, MAX_NAME_CHARS, MAX_TEXT_CHARS, clip, preview};
use crate::Session;

fn run(s: &mut Session, p: Value) -> Value {
    s.execute("objects", &p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

fn rows(r: &Value) -> &Vec<Value> {
    r["objects"].as_array().unwrap()
}

/// The first row of one kind.
fn of_kind<'a>(r: &'a Value, kind: &str) -> &'a Value {
    rows(r).iter().find(|o| o["kind"] == kind).unwrap_or_else(|| panic!("no {kind} in {r}"))
}

/// The drawing as a test compares it: objects, undo depth, revision, selection.
fn state(s: &Session) -> (usize, usize, u64, Vec<Handle>) {
    let st = s.state().unwrap();
    (st.doc.model.len(), st.undo.len(), st.revision, st.selection.clone())
}

/// A line, a circle, an arc, a text and an MTEXT; the circle and the text on their own layers.
fn drawing() -> Session {
    let mut s = Session::new();
    s.execute("line", &json!({"points": [[0, 0], [3, 4]]})).unwrap();
    s.execute("layer.new", &json!({"name": "Stones", "current": true})).unwrap();
    s.execute("circle", &json!({"center": [10, 0], "radius": 0.65})).unwrap();
    s.execute("layer.new", &json!({"name": "Notes", "current": true})).unwrap();
    s.execute("text", &json!({"at": [0, 10], "text": "18k yellow gold", "height": 2})).unwrap();
    s.execute("mtext", &json!({"at": [0, 20], "text": "Polish\\Pall over", "height": 2})).unwrap();
    s.execute("arc", &json!({"center": [0, 0], "radius": 2.5, "start": 0, "end": 90})).unwrap();
    s
}

#[test]
fn kinds_layers_and_telling_facts_come_back() {
    let mut s = drawing();
    let r = run(&mut s, json!({}));
    assert_eq!(r["total"], 5, "{r}");
    assert_eq!(r["truncated"], false);
    assert_eq!(r["space"], "Model");
    assert_eq!(rows(&r).len(), 5);
    let kinds: Vec<&str> = rows(&r).iter().map(|o| o["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["line", "circle", "text", "mtext", "arc"], "in the drawing's own order");
    for o in rows(&r) {
        let h = o["handle"].as_str().unwrap();
        assert!(Handle::parse_hex(h).is_some(), "{h}");
        assert!(s.doc().unwrap().entity(Handle::parse_hex(h).unwrap()).is_some());
        assert!(o.get("geometry").is_none() && o.get("group").is_none(), "{o}");
    }
    let line = of_kind(&r, "line");
    assert_eq!(line["layer"], "0");
    assert_eq!(line["size"], "5.0000", "a line's length, as LUPREC writes it");
    let circle = of_kind(&r, "circle");
    assert_eq!(circle["layer"], "Stones");
    assert_eq!(circle["size"], "1.3000", "a circle's diameter");
    assert_eq!(of_kind(&r, "arc")["size"], "2.5000", "an arc's radius");
    let text = of_kind(&r, "text");
    assert_eq!(text["layer"], "Notes");
    assert_eq!(text["text"], "18k yellow gold");
    assert!(text.get("size").is_none() && text.get("name").is_none(), "{text}");
    assert_eq!(of_kind(&r, "mtext")["text"], "Polish all over", "formatting codes are not content");
}

#[test]
fn size_follows_the_drawings_precision() {
    let mut s = drawing();
    s.execute("setvar", &json!({"name": "LUPREC", "value": 1})).unwrap();
    let r = run(&mut s, json!({}));
    assert_eq!(of_kind(&r, "circle")["size"], "1.3");
    assert_eq!(of_kind(&r, "line")["size"], "5.0");
}

#[test]
fn block_names_come_back_for_inserts() {
    let mut s = drawing();
    let made = s.execute("line", &json!({"points": [[20, 0], [21, 0]]})).unwrap();
    s.execute("block", &json!({"name": "GEM-ROUND-1.3", "base": [20, 0], "handles": made["handles"], "keep": "delete"})).unwrap();
    s.execute("insert", &json!({"name": "GEM-ROUND-1.3", "at": [30, 0]})).unwrap();
    let r = run(&mut s, json!({}));
    let insert = of_kind(&r, "insert");
    assert_eq!(insert["name"], "GEM-ROUND-1.3");
    assert!(insert.get("text").is_none() && insert.get("size").is_none(), "{insert}");
}

/// Push an object the commands would refuse to make: a file can hold it.
fn push(s: &mut Session, handle: u64, kind: EntityKind) {
    s.doc_mut().unwrap().model.push(Entity::new(Handle(handle), kind));
}

#[test]
fn hostile_strings_are_clipped_and_sanitised() {
    // Made by the commands, then given the strings a file could hold and a command would refuse.
    let mut s = Session::new();
    let made = s.execute("line", &json!({"points": [[20, 0], [21, 0]]})).unwrap();
    s.execute("block", &json!({"name": "B", "base": [20, 0], "handles": made["handles"], "keep": "delete"})).unwrap();
    s.execute("insert", &json!({"name": "B", "at": [30, 0]})).unwrap();
    s.execute("text", &json!({"at": [0, 10], "text": "t", "height": 2})).unwrap();
    s.execute("mtext", &json!({"at": [0, 20], "text": "m", "height": 2})).unwrap();
    let long_name = format!("B\u{7}AD\n{}", "N".repeat(5_000));
    let value = format!("  first\tline\r\nsecond\u{0}\u{1b}[31m {}", "x".repeat(10_000));
    let contents = format!("{{\\fArial;Bold}}\\P{}", "y".repeat(200_000));
    let all: Vec<Entity> = s.doc().unwrap().model.iter().map(|e| e.as_ref().clone()).collect();
    for mut e in all {
        match &mut e.kind {
            EntityKind::Insert(i) => i.block = long_name.clone(),
            EntityKind::Text(t) => t.value = value.clone(),
            EntityKind::MText(t) => t.contents = contents.clone(),
            _ => continue,
        }
        e.common.layer = format!("L\u{9}{}", "a".repeat(4_000));
        assert!(s.doc_mut().unwrap().model.replace(e));
    }
    let r = run(&mut s, json!({}));
    assert_eq!(rows(&r).len(), 3);
    assert!(rows(&r).iter().all(|o| o["layer"].as_str().is_some_and(|l| l.starts_with("L aaa") && l.chars().count() == 128)), "{r}");
    let name = of_kind(&r, "insert")["name"].as_str().unwrap();
    assert_eq!(name.chars().count(), MAX_NAME_CHARS);
    assert!(name.starts_with("BAD NNN"), "{name}");
    let text = of_kind(&r, "text")["text"].as_str().unwrap();
    assert!(text.starts_with("first line second[31m xxx"), "{text}");
    assert_eq!(text.chars().count(), MAX_TEXT_CHARS);
    let mtext = of_kind(&r, "mtext")["text"].as_str().unwrap();
    assert!(mtext.starts_with("Bold yyy"), "{mtext}");
    assert_eq!(mtext.chars().count(), MAX_TEXT_CHARS);
    for o in rows(&r) {
        for (_, v) in o.as_object().unwrap() {
            if let Some(t) = v.as_str() {
                assert!(!t.chars().any(char::is_control), "{t:?}");
            }
        }
    }
    // The whole reply stays small whatever the strings were.
    assert!(r.to_string().len() < 2_000, "{}", r.to_string().len());
}

#[test]
fn clip_and_preview_hold_their_bounds() {
    assert_eq!(clip("", 10), "");
    assert_eq!(clip(" \t\n ", 10), "");
    assert_eq!(clip("a  b", 10), "a b");
    assert_eq!(clip("abcdef", 3), "abc");
    assert_eq!(clip("ab cd", 3), "ab", "a gap is never left hanging at the end");
    assert_eq!(clip("anything", 0), "");
    assert_eq!(clip("né\u{301}e ✓", 4), "né\u{301}e");
    assert_eq!(preview("\\A1;Top", true), "Top");
    assert_eq!(preview("\\A1;Top", false), "\\A1;Top");
    assert!(preview(&"\\".repeat(50_000), true).chars().count() <= MAX_TEXT_CHARS);
}

#[test]
fn non_finite_geometry_reports_no_size() {
    let mut s = Session::new();
    push(&mut s, 0xB001, EntityKind::Circle(cadcraft_doc::Circle { center: cadcraft_geom::Vec3::ZERO, radius: f64::NAN }));
    push(&mut s, 0xB002, EntityKind::Circle(cadcraft_doc::Circle { center: cadcraft_geom::Vec3::ZERO, radius: f64::INFINITY }));
    push(&mut s, 0xB003, EntityKind::Circle(cadcraft_doc::Circle { center: cadcraft_geom::Vec3::ZERO, radius: -1.0 }));
    let r = run(&mut s, json!({}));
    assert_eq!(rows(&r).len(), 3);
    assert!(rows(&r).iter().all(|o| o.get("size").is_none()), "{r}");
}

#[test]
fn the_limit_caps_the_list_and_total_says_what_is_there() {
    let mut s = Session::new();
    for i in 0..12 {
        s.execute("line", &json!({"points": [[i, 0], [i, 1]]})).unwrap();
    }
    let r = run(&mut s, json!({"limit": 5}));
    assert_eq!((rows(&r).len(), &r["total"], &r["truncated"]), (5, &json!(12), &json!(true)));
    let r = run(&mut s, json!({"limit": 12}));
    assert_eq!((rows(&r).len(), &r["truncated"]), (12, &json!(false)));
    let r = run(&mut s, json!({"limit": 0}));
    assert_eq!((rows(&r).len(), &r["total"], &r["truncated"]), (0, &json!(12), &json!(true)));
    let r = run(&mut s, json!({"limit": u64::MAX}));
    assert_eq!((rows(&r).len(), &r["truncated"]), (12, &json!(false)));
    let r = run(&mut s, json!({"limit": null}));
    assert_eq!(rows(&r).len(), 12);
}

#[test]
fn a_huge_limit_is_held_to_the_cap() {
    let mut s = Session::new();
    let extra = 7;
    for i in 0..(MAX_LIMIT + extra) {
        push(&mut s, 0x10_0000 + i as u64, EntityKind::Point(cadcraft_doc::Point { p: cadcraft_geom::Vec3::ZERO, angle: 0.0 }));
    }
    let r = run(&mut s, json!({"limit": 1_000_000}));
    assert_eq!(rows(&r).len(), MAX_LIMIT);
    assert_eq!(r["total"], MAX_LIMIT + extra);
    assert_eq!(r["truncated"], true);
    // The default is smaller still.
    let r = run(&mut s, json!({}));
    assert_eq!(rows(&r).len(), 2_000);
}

#[test]
fn group_membership_is_reported() {
    let mut s = drawing();
    let all = run(&mut s, json!({}));
    let line = of_kind(&all, "line")["handle"].clone();
    let circle = of_kind(&all, "circle")["handle"].clone();
    s.execute("group", &json!({"name": "HEAD", "handles": [line, circle]})).unwrap();
    s.execute("group", &json!({"name": "SHANK", "handles": [line]})).unwrap();
    let r = run(&mut s, json!({}));
    assert_eq!(of_kind(&r, "line")["group"], json!(["HEAD", "SHANK"]));
    assert_eq!(of_kind(&r, "circle")["group"], json!(["HEAD"]));
    assert!(of_kind(&r, "text").get("group").is_none());
}

#[test]
fn a_piece_is_listed_under_its_group() {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    let built = s.execute("piece", &json!({"kind": "solitaire"})).unwrap();
    let handles: Vec<&str> = built["piece"]["handles"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert!(!handles.is_empty());
    let r = run(&mut s, json!({}));
    let in_piece: Vec<&str> = rows(&r)
        .iter()
        .filter(|o| o["group"].as_array().is_some_and(|g| g.iter().any(|n| n == "JEWELRY_PIECE")))
        .filter_map(|o| o["handle"].as_str())
        .collect();
    let mut want = handles.clone();
    want.sort_unstable();
    let mut got = in_piece.clone();
    got.sort_unstable();
    assert_eq!(got, want, "every object of the piece, and only those");
    assert!(rows(&r).iter().any(|o| o["kind"] == "insert" && o["name"].as_str().is_some_and(|n| n.starts_with("GEM-"))), "{r}");
}

#[test]
fn many_groups_on_one_object_are_capped() {
    let mut s = drawing();
    let all = run(&mut s, json!({}));
    let line = of_kind(&all, "line")["handle"].clone();
    for i in 0..20 {
        s.execute("group", &json!({"name": format!("G{i}"), "handles": [line]})).unwrap();
    }
    let r = run(&mut s, json!({}));
    assert_eq!(of_kind(&r, "line")["group"].as_array().unwrap().len(), 8);
}

#[test]
fn the_command_changes_nothing() {
    let mut s = drawing();
    let first = of_kind(&run(&mut s, json!({})), "line")["handle"].clone();
    s.execute("select", &json!({"handles": [first]})).unwrap();
    let before = state(&s);
    let digest = serde_json::to_string(&s.doc().unwrap().groups.len()).unwrap();
    for p in [json!({}), json!({"limit": 1}), json!({"space": "model"}), json!({"space": "current"})] {
        run(&mut s, p);
    }
    assert_eq!(state(&s), before, "objects, undo depth, revision and selection are as they were");
    assert_eq!(serde_json::to_string(&s.doc().unwrap().groups.len()).unwrap(), digest);
    let spec = crate::cmd::find_command("objects").unwrap();
    assert_eq!(spec.label, "Objects");
}

#[test]
fn another_space_can_be_asked_for() {
    let mut s = drawing();
    let layout = s.doc().unwrap().layouts.first().map(|l| l.name.clone());
    if let Some(name) = layout {
        let r = run(&mut s, json!({"space": name}));
        assert_eq!(r["space"], json!(name));
        assert_eq!(r["truncated"], false);
        assert_eq!(rows(&r).len(), r["total"].as_u64().unwrap() as usize);
    }
    let r = run(&mut s, json!({"space": " MODEL "}));
    assert_eq!(r["total"], 5);
    assert!(s.execute("objects", &json!({"space": "No such layout"})).is_err());
}

#[test]
fn hostile_params_never_panic() {
    let mut s = drawing();
    let before = state(&s);
    let hostile = [
        json!({"limit": -1}),
        json!({"limit": -1.0e308}),
        json!({"limit": 1.5}),
        json!({"limit": 1.0e308}),
        json!({"limit": "NaN"}),
        json!({"limit": "12"}),
        json!({"limit": true}),
        json!({"limit": []}),
        json!({"limit": {"n": 1}}),
        json!({"limit": [1, 2]}),
        json!({"space": 7}),
        json!({"space": ["Model"]}),
        json!({"space": {"name": "Model"}}),
        json!({"space": "\u{0}\n".repeat(10_000)}),
        json!({"space": "x".repeat(100_000)}),
        json!({"limit": i64::MIN, "space": false}),
        json!([]),
        json!("objects"),
        json!(null),
        json!(42),
    ];
    for p in &hostile {
        // Refused or answered: never a panic, and an error is short enough to show.
        match s.execute("objects", p) {
            Ok(r) => assert!(rows(&r).len() <= MAX_LIMIT),
            Err(e) => assert!(e.to_string().len() < 400, "{}", e.to_string().len()),
        }
    }
    for p in [json!({"limit": -1}), json!({"limit": 1.5}), json!({"limit": "12"}), json!({"limit": true}), json!({"space": 7})] {
        assert!(s.execute("objects", &p).is_err(), "{p}");
    }
    assert_eq!(state(&s), before);
    // With no drawing open it is an error, not a panic.
    let mut none = Session::default();
    let _ = none.execute("objects", &json!({}));
}
