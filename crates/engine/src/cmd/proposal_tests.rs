//! PROPOSE, ACCEPT, REJECT and PROPOSALS: a proposal reads a change and leaves the drawing alone;
//! accepting it is the change, as one undo step; rejecting it is nothing at all.

use std::sync::Arc;

use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::proposal::{MAX_PENDING, MAX_STEPS, MAX_VARIANTS};
use crate::Session;

/// A millimetre drawing holding a solitaire.
fn ring() -> Session {
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    s.execute("piece", &json!({"kind": "solitaire"})).unwrap();
    s
}

/// Everything a proposal must leave as it found it.
fn standing(s: &Session) -> (Arc<cadcraft_doc::Drawing>, usize, usize, u64, Vec<cadcraft_doc::Handle>, usize, Option<String>) {
    let st = s.state().unwrap();
    (st.doc.clone(), st.undo.len(), st.redo.len(), st.revision, st.selection.clone(), s.log.len(), s.last_command.clone())
}

fn same(a: &(Arc<cadcraft_doc::Drawing>, usize, usize, u64, Vec<cadcraft_doc::Handle>, usize, Option<String>), s: &Session) {
    let b = standing(s);
    assert!(Arc::ptr_eq(&a.0, &b.0), "the drawing is the one it was");
    assert_eq!((a.1, a.2, a.3, &a.4, a.5, &a.6), (b.1, b.2, b.3, &b.4, b.5, &b.6), "undo, redo, revision, selection, log, last command");
}

fn wider() -> Value {
    json!({"steps": [{"command": "piece", "params": {"width": 2.6}}], "title": "A wider band"})
}

fn change<'a>(report: &'a Value, key: &str) -> &'a Value {
    report["changes"].as_array().unwrap().iter().find(|c| c["key"] == key).unwrap_or(&Value::Null)
}

#[test]
fn a_proposal_reads_the_change_and_leaves_the_drawing_alone() {
    let mut s = ring();
    let before = standing(&s);
    let r = s.execute("propose", &wider()).unwrap();
    same(&before, &s);
    let p = &r["proposals"][0];
    assert_eq!(p["title"], "A wider band");
    assert_eq!(p["steps"][0]["command"], "piece");
    let width = change(p, "piece.width");
    assert_eq!(
        (width["before"].as_f64(), width["after"].as_f64(), width["delta"].as_f64(), width["unit"].as_str()),
        (Some(2.2), Some(2.6), Some(0.4), Some("mm"))
    );
    // More band is more metal, and the figures are the engine's own for each side.
    let grams = change(p, "grams");
    assert!(grams["delta"].as_f64().unwrap() > 0.0, "{grams}");
    assert_eq!(p["before"]["piece"]["params"]["width"], 2.2);
    assert_eq!(p["after"]["piece"]["params"]["width"], 2.6);
    assert_eq!(p["unchanged"], false);
    assert!(p["message"].as_str().unwrap().contains("Width 2.2 → 2.6 mm"), "{}", p["message"]);
    assert_eq!(s.proposals.len(), 1);
}

#[test]
fn accepting_is_the_change_itself_as_one_undo_step() {
    let mut s = ring();
    let base = standing(&s);
    let id = s.execute("propose", &wider()).unwrap()["proposals"][0]["id"].as_u64().unwrap();
    let r = s.execute("accept", &json!({"id": id})).unwrap();
    assert_eq!(r["accepted"], id);
    // The drawing is what running the step would have made.
    let mut direct = ring();
    direct.execute("piece", &json!({"width": 2.6})).unwrap();
    assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted and run directly are the same drawing");
    assert_eq!(s.state().unwrap().undo.len(), base.1 + 1, "one step");
    assert_eq!(s.state().unwrap().revision, base.3 + 1);
    assert!(s.proposals.is_empty());
    // And one undo is the drawing as it was.
    assert_eq!(s.undo().unwrap().as_deref(), Some("Proposal: A wider band"));
    assert!(Arc::ptr_eq(&s.state().unwrap().doc, &base.0));
    // Accepted twice: there is nothing to accept.
    assert!(s.execute("accept", &json!({"id": id})).unwrap_err().to_string().contains("no proposal"));
}

#[test]
fn rejecting_is_nothing_at_all() {
    let mut s = ring();
    let before = standing(&s);
    let id = s.execute("propose", &wider()).unwrap()["proposals"][0]["id"].as_u64().unwrap();
    s.execute("propose", &wider()).unwrap();
    assert_eq!(s.execute("reject", &json!({"id": id})).unwrap()["rejected"], json!([id]));
    assert_eq!(s.proposals.len(), 1);
    assert_eq!(s.execute("reject", &json!({})).unwrap()["rejected"].as_array().unwrap().len(), 1);
    assert_eq!(s.execute("reject", &json!({})).unwrap()["rejected"], json!([]));
    assert!(s.execute("reject", &json!({"id": id})).is_err());
    same(&before, &s);
}

#[test]
fn a_proposal_is_for_the_drawing_it_was_made_on() {
    let mut s = ring();
    let id = s.execute("propose", &wider()).unwrap()["proposals"][0]["id"].as_u64().unwrap();
    assert_eq!(s.execute("proposals", &json!({})).unwrap()["proposals"][0]["stale"], false);
    s.execute("piece", &json!({"wall": 2.0})).unwrap();
    assert_eq!(s.execute("proposals", &json!({})).unwrap()["proposals"][0]["stale"], true);
    let now = standing(&s);
    let e = s.execute("accept", &json!({"id": id})).unwrap_err().to_string();
    assert!(e.contains("changed since") && e.contains("propose it again"), "{e}");
    same(&now, &s);
    // Undone back to the drawing it was made on, it applies again.
    s.undo().unwrap();
    s.execute("accept", &json!({"id": id})).unwrap();
    assert_eq!(s.execute("piece", &json!({"query": true})).unwrap()["piece"]["params"]["width"], 2.6);
}

#[test]
fn variants_are_read_side_by_side_and_one_is_taken() {
    let mut s = ring();
    let before = standing(&s);
    let r = s
        .execute(
            "propose",
            &json!({"variants": [
                {"title": "Slim", "steps": [{"command": "piece", "params": {"width": 1.8}}]},
                {"steps": [{"command": "piece", "params": {"width": 3.0}}, {"command": "piece", "params": {"metal": "platinum"}}]},
                {"title": "Halo", "steps": [{"command": "piece", "params": {"halo": true}}]},
            ]}),
        )
        .unwrap();
    same(&before, &s);
    let list = r["proposals"].as_array().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!((list[0]["title"].as_str(), list[1]["title"].as_str()), (Some("Slim"), Some("Option 2")));
    assert!(list.iter().all(|p| p["group"] == list[0]["group"]));
    // Each is read from the same drawing, not from the one before it.
    assert_eq!(change(&list[1], "piece.width")["before"], 2.2);
    assert_eq!(change(&list[1], "piece.metal")["after"], "platinum");
    assert!(change(&list[2], "stones.count")["delta"].as_f64().unwrap() > 0.0);
    assert!(change(&list[0], "grams")["delta"].as_f64().unwrap() < 0.0);
    // One taken: the others go with it.
    s.execute("accept", &json!({"id": list[2]["id"]})).unwrap();
    assert!(s.proposals.is_empty());
    // A halo reads back as the size of its stones.
    assert!(s.execute("piece", &json!({"query": true})).unwrap()["piece"]["params"]["halo"].as_f64().is_some());
}

#[test]
fn a_step_that_fails_fails_the_proposal_and_says_which() {
    let mut s = ring();
    let before = standing(&s);
    let e = s
        .execute(
            "propose",
            &json!({"steps": [{"command": "piece", "params": {"width": 2.6}}, {"command": "piece", "params": {"profile": "sawtooth"}}]}),
        )
        .unwrap_err()
        .to_string();
    assert!(e.contains("step 2 (`piece`) failed"), "{e}");
    same(&before, &s);
    assert!(s.proposals.is_empty());
    // A variant that fails fails them all: none is kept.
    let e = s
        .execute("propose", &json!({"variants": [{"steps": [{"command": "piece", "params": {"width": 2.6}}]}, {"steps": [{"command": "piece", "params": {"profile": "sawtooth"}}]}]}))
        .unwrap_err()
        .to_string();
    assert!(e.contains("step 1"), "{e}");
    same(&before, &s);
    assert!(s.proposals.is_empty());
}

#[test]
fn only_commands_that_record_undo_can_be_steps() {
    let mut s = ring();
    let before = standing(&s);
    for (steps, said) in [
        (json!([{"command": "pricebook", "params": {"set": {"metal": {"gold18": 70}}}}]), "records no undo"),
        (json!([{"command": "propose", "params": {}}]), "cannot be proposed"),
        (json!([{"command": "accept", "params": {"id": 1}}]), "cannot be proposed"),
        (json!([{"command": "undo"}]), "cannot be proposed"),
        (json!([{"command": "no-such-command"}]), "unknown command"),
        (json!([{"params": {}}]), "`command` must be"),
        (json!([{"command": "piece", "params": [1, 2]}]), "`params` must be an object"),
        (json!([]), "at least one step"),
        (json!("piece"), "must be a list"),
    ] {
        let e = s.execute("propose", &json!({"steps": steps})).unwrap_err().to_string();
        assert!(e.contains(said), "{steps}: {e}");
    }
    let many: Vec<Value> = (0..=MAX_STEPS).map(|_| json!({"command": "piece", "params": {"width": 2.4}})).collect();
    assert!(s.execute("propose", &json!({"steps": many})).unwrap_err().to_string().contains("at most"));
    let options: Vec<Value> = (0..=MAX_VARIANTS).map(|_| json!({"steps": [{"command": "piece", "params": {"width": 2.4}}]})).collect();
    assert!(s.execute("propose", &json!({"variants": options})).unwrap_err().to_string().contains("at most"));
    assert!(s.execute("propose", &json!({"variants": []})).is_err());
    assert!(s.execute("propose", &json!({"variants": 3})).is_err());
    same(&before, &s);
    assert!(s.proposals.is_empty());
}

#[test]
fn a_check_the_change_breaks_is_named_and_one_it_mends_too() {
    let mut s = ring();
    let r = s.execute("propose", &json!({"steps": [{"command": "piece", "params": {"wall": 0.3}}]})).unwrap();
    let p = &r["proposals"][0];
    assert_eq!(p["checks"]["broken"][0]["id"], "wall", "{}", p["checks"]);
    assert_eq!(p["checks"]["fixed"], json!([]));
    assert!(p["message"].as_str().unwrap().contains("1 check(s) would fail"), "{}", p["message"]);
    s.execute("accept", &json!({"id": p["id"]})).unwrap();
    let r = s.execute("propose", &json!({"steps": [{"command": "piece", "params": {"wall": 1.8}}]})).unwrap();
    assert_eq!(r["proposals"][0]["checks"]["fixed"][0]["id"], "wall");
    assert_eq!(r["proposals"][0]["checks"]["failing"], json!([]));
}

#[test]
fn a_change_that_is_not_a_piece_is_counted_in_objects() {
    let mut s = Session::new();
    s.execute("line", &json!({"points": [[0, 0], [10, 0]]})).unwrap();
    let before = standing(&s);
    let r = s
        .execute("propose", &json!({"steps": [{"command": "circle", "params": {"center": [5, 5], "radius": 2}}, {"command": "circle", "params": {"center": [9, 9], "radius": 1}}]}))
        .unwrap();
    same(&before, &s);
    let p = &r["proposals"][0];
    assert_eq!(p["objects"], json!({"before": 1, "after": 3, "added": 2, "removed": 0, "modified": 0}));
    assert_eq!(p["title"], "circle");
    assert_eq!(p["before"]["piece"], Value::Null);
    assert!(p["message"].as_str().unwrap().contains("2 added"), "{}", p["message"]);
    s.execute("accept", &json!({"id": p["id"]})).unwrap();
    assert_eq!(s.state().unwrap().doc.model.len(), 3);
    assert_eq!(s.state().unwrap().undo.len(), before.1 + 1);
}

#[test]
fn either_side_of_a_proposal_can_be_read() {
    let mut s = ring();
    let id =
        s.execute("propose", &json!({"steps": [{"command": "piece", "params": {"halo": true}}]})).unwrap()["proposals"][0]["id"].as_u64().unwrap();
    let before = standing(&s);
    let after = s.execute("proposals", &json!({"id": id, "of": "after", "run": {"command": "piece"}})).unwrap();
    assert!(after["result"]["piece"]["params"]["halo"].as_f64().is_some(), "{}", after["result"]["piece"]["params"]);
    let was = s.execute("proposals", &json!({"id": id, "of": "before", "run": {"command": "techsheet"}})).unwrap();
    assert_eq!(was["result"]["stones"]["count"], 1);
    // The solid of the change, for a picture of it, is PIECEMESH of the side's own parameters.
    let mut params = after["result"]["piece"]["params"].clone();
    params["quality"] = json!("draft");
    assert!(s.execute("piecemesh", &params).unwrap()["triangles"].as_u64().unwrap() > 0);
    assert_eq!(s.execute("proposals", &json!({"id": id, "run": {"command": "objects"}})).unwrap()["of"], "after");
    // PIECE is only ever a question here, whatever it is handed.
    let asked = s.execute("proposals", &json!({"id": id, "run": {"command": "piece", "params": {"width": 9.0}}})).unwrap();
    assert_eq!(asked["result"]["piece"]["params"]["width"], 2.2);
    for (params, said) in [
        (json!({"id": id, "run": {"command": "line", "params": {"points": [[0, 0], [1, 1]]}}}), "cannot be run on a proposal"),
        (json!({"id": id, "of": "sideways", "run": {"command": "piece"}}), "\"before\" or \"after\""),
        (json!({"id": 999, "run": {"command": "piece"}}), "no proposal"),
        (json!({"id": id, "run": 4}), "`run` must be"),
        (json!({"run": {"command": "piece"}}), "`id` must be"),
    ] {
        let e = s.execute("proposals", &params).unwrap_err().to_string();
        assert!(e.contains(said), "{params}: {e}");
    }
    same(&before, &s);
}

#[test]
fn the_oldest_proposals_give_way() {
    let mut s = ring();
    for _ in 0..MAX_PENDING + 3 {
        s.execute("propose", &wider()).unwrap();
    }
    assert_eq!(s.proposals.len(), MAX_PENDING);
    let first = s.execute("proposals", &json!({})).unwrap()["proposals"][0]["id"].as_u64().unwrap();
    assert!(first > 2, "the first ones are gone");
}

/// Hostile parameters are refused with a sentence, never a panic, and change nothing.
#[test]
fn hostile_params_never_panic() {
    let mut s = ring();
    let before = standing(&s);
    let deep = (0..200).fold(json!(1), |v, _| json!([v]));
    for params in [
        json!(null),
        json!(7),
        json!("x"),
        json!([]),
        json!({"steps": null}),
        json!({"steps": [null]}),
        json!({"steps": [[]]}),
        json!({"steps": [{"command": 3}]}),
        json!({"steps": [{"command": ""}]}),
        json!({"steps": [{"command": "piece", "params": "wide"}]}),
        json!({"steps": [{"command": "piece", "params": {"width": 1e308}}]}),
        json!({"steps": [{"command": "piece", "params": {"width": -1}}]}),
        json!({"steps": [{"command": "piece", "params": {"width": deep}}]}),
        json!({"variants": [null]}),
        json!({"variants": [{"steps": 1}]}),
        json!({"variants": {"a": 1}}),
        json!({"title": {"a": 1}, "steps": [{"command": "piece", "params": {"width": 2.4}}]}),
    ] {
        let _ = s.execute("propose", &params);
        for cmd in ["accept", "reject", "proposals"] {
            for p in [
                json!(null),
                json!(7),
                json!({"id": -1}),
                json!({"id": 1e99}),
                json!({"id": "1"}),
                json!({"id": u64::MAX}),
                json!({"id": 1, "run": null, "of": 3}),
            ] {
                let _ = s.execute(cmd, &p);
            }
        }
        s.execute("reject", &json!({})).unwrap();
        same(&before, &s);
    }
    // A title is one short line whatever it was given.
    let long = "x".repeat(5000) + "\n\u{7}tail";
    let r = s.execute("propose", &json!({"title": long, "steps": [{"command": "piece", "params": {"width": 2.4}}]})).unwrap();
    let title = r["proposals"][0]["title"].as_str().unwrap();
    assert!(title.chars().count() <= 120 && !title.contains('\n'));
}

const KINDS: [&str; 4] = ["band", "solitaire", "threestone", "eternity"];
const PROFILES: [&str; 7] = ["flat", "dome", "comfort", "court", "knife", "bevel", "concave"];
const METALS: [&str; 5] = ["gold18", "gold14", "platinum", "silver", "titanium"];

/// One change to a piece, as PIECE takes it.
fn drawn_change(tc: &TestCase) -> Value {
    let pick = |from: &[&'static str]| -> &'static str { from[tc.draw(gs::integers::<usize>().min_value(0).max_value(from.len() - 1))] };
    let float = |lo: f64, hi: f64| -> f64 { (tc.draw(gs::floats::<f64>().min_value(lo).max_value(hi)) * 100.0).round() / 100.0 };
    match tc.draw(gs::integers::<u8>().min_value(0).max_value(5)) {
        0 => json!({"width": float(1.5, 6.0)}),
        1 => json!({"wall": float(0.3, 3.0)}),
        2 => json!({"profile": pick(&PROFILES)}),
        3 => json!({"metal": pick(&METALS)}),
        4 => json!({"kind": pick(&KINDS)}),
        _ => json!({"size": f64::from(tc.draw(gs::integers::<u8>().min_value(8).max_value(24))) / 2.0}),
    }
}

/// Rule: whatever is proposed, proposing changes nothing; accepting it gives exactly the drawing
/// that running the same steps gives, in one undo step; and one undo gives the drawing back.
#[hegel::test(test_cases = 60)]
fn a_proposal_accepted_is_its_steps_run_and_rejected_is_nothing(tc: TestCase) {
    let count = tc.draw(gs::integers::<usize>().min_value(1).max_value(3));
    let changes: Vec<Value> = (0..count).map(|_| drawn_change(&tc)).collect();
    let steps: Vec<Value> = changes.iter().map(|c| json!({"command": "piece", "params": c})).collect();
    tc.note(&format!("steps: {}", json!(steps)));

    let mut s = ring();
    let before = standing(&s);
    let proposed = s.execute("propose", &json!({"steps": steps}));
    same(&before, &s);

    // What running them directly does, on a drawing made the same way.
    let mut direct = ring();
    let ran = changes.iter().try_for_each(|c| direct.execute("piece", c).map(|_| ()));
    match (proposed, ran) {
        (Err(_), Err(_)) => assert!(s.proposals.is_empty()),
        (Ok(r), Ok(())) => {
            let id = r["proposals"][0]["id"].as_u64().unwrap();
            // Rejected: nothing. Proposed again and accepted: the steps, as one step.
            s.execute("reject", &json!({"id": id})).unwrap();
            same(&before, &s);
            let id = s.execute("propose", &json!({"steps": steps})).unwrap()["proposals"][0]["id"].as_u64().unwrap();
            s.execute("accept", &json!({"id": id})).unwrap();
            assert!(*s.state().unwrap().doc == *direct.state().unwrap().doc, "accepted is not what the steps make");
            let unchanged = r["proposals"][0]["unchanged"] == true;
            assert_eq!(s.state().unwrap().undo.len(), before.1 + usize::from(!unchanged));
            if !unchanged {
                s.undo().unwrap();
            }
            assert!(*s.state().unwrap().doc == *before.0, "one undo is the drawing as it was");
        }
        (a, b) => panic!("proposing and running disagree: proposed {:?}, run {:?}", a.map(|v| v["message"].clone()), b),
    }
}
