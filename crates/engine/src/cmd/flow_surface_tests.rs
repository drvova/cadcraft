//! FLOWALONGSRF / FLOWALONGCRV through `Session::execute`: identity on a planar target, exact wrap onto a
//! cylinder, stones with normals, rigid mode, curve flow, the surface-entity hook and hostile
//! params (Hegel).

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::{NurbsCurve3, NurbsSurface, TAU, Vec3};
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use crate::Session;

fn net_json(s: &NurbsSurface) -> Value {
    json!({
        "degreeU": s.degree_u(), "degreeV": s.degree_v(), "countU": s.count_u(), "countV": s.count_v(),
        "points": s.points().iter().map(|p| json!([p.x, p.y, p.z])).collect::<Vec<_>>(),
        "knotsU": s.knots_u(), "knotsV": s.knots_v(), "weights": s.weights(),
    })
}

fn cylinder(r: f64, h: f64) -> Value {
    let c = NurbsCurve3::circle(Vec3::ZERO, Vec3::Z, r).unwrap();
    net_json(&NurbsSurface::extrude(&c, Vec3::new(0.0, 0.0, h)).unwrap())
}

fn plane(w: f64, h: f64) -> Value {
    json!({"degreeU": 1, "degreeV": 1, "countU": 2, "countV": 2, "points": [[0, 0, 0], [0, h, 0], [w, 0, 0], [w, h, 0]]})
}

fn added(s: &Session, r: &Value) -> Vec<EntityKind> {
    let d = s.doc().unwrap();
    r["added"].as_array().unwrap().iter().map(|h| d.entity(Handle::parse_hex(h.as_str().unwrap()).unwrap()).unwrap().kind.clone()).collect()
}

fn radius(p: Vec3) -> f64 {
    (p.x * p.x + p.y * p.y).sqrt()
}

fn last(s: &Session) -> String {
    s.doc().unwrap().model.last().unwrap().handle.hex()
}

fn line(s: &mut Session, a: [f64; 2], b: [f64; 2]) -> String {
    s.execute("line", &json!({"points": [a, b]})).unwrap();
    last(s)
}

#[test]
fn planar_target_leaves_objects_in_place() {
    let mut s = Session::new();
    let h = line(&mut s, [1.0, 1.0], [8.0, 4.0]);
    let base = json!({"origin": [0, 0], "width": 10, "height": 5});
    let r = s.execute("flowalongsrf", &json!({"handles": [h], "target": plane(10.0, 5.0), "base": base})).unwrap();
    let out = added(&s, &r);
    let EntityKind::Polyline3d(p) = &out[0] else { panic!("{out:?}") };
    assert!((p.points[0] - Vec3::new(1.0, 1.0, 0.0)).len() < 1e-9);
    assert!((*p.points.last().unwrap() - Vec3::new(8.0, 4.0, 0.0)).len() < 1e-9);
}

#[test]
fn circle_wraps_onto_cylinder_and_stones_carry_normals() {
    let mut s = Session::new();
    let (r, h) = (5.0, 4.0);
    s.execute("circle", &json!({"center": [10, 2], "radius": 1})).unwrap();
    let c = last(&s);
    let base = json!({"origin": [0, 0], "width": TAU * r, "height": h});
    let row: Vec<Value> = (0..8).map(|i| json!([2.0 + 3.0 * i as f64, 2.0])).collect();
    let res = s.execute("flowalongsrf", &json!({"handles": [c], "points": row, "target": cylinder(r, h), "base": base, "tolerance": 1e-3})).unwrap();
    let out = added(&s, &res);
    let EntityKind::Polyline3d(p) = &out[0] else { panic!("{out:?}") };
    assert!(p.closed && p.points.len() > 16);
    assert!(p.points.iter().all(|q| (radius(*q) - r).abs() < 1e-9));
    let stones = res["stones"].as_array().unwrap();
    assert_eq!(stones.len(), 8);
    for st in stones {
        let a: Vec<f64> = st["point"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let n: Vec<f64> = st["normal"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let (pt, nn) = (Vec3::new(a[0], a[1], a[2]), Vec3::new(n[0], n[1], n[2]));
        assert!((radius(pt) - r).abs() < 1e-6 && (pt.z - 2.0).abs() < 1e-6);
        // Radial normal, unit length.
        assert!(nn.z.abs() < 1e-6 && (nn.len() - 1.0).abs() < 1e-6);
        assert!((nn.cross(Vec3::new(pt.x, pt.y, 0.0).normalized())).len() < 1e-6);
    }
    // Undo removes what was added.
    s.undo().unwrap();
    assert_eq!(s.doc().unwrap().model.len(), 1);
}

#[test]
fn rigid_mode_and_query() {
    let mut s = Session::new();
    let h = line(&mut s, [4.0, 1.0], [5.0, 1.0]);
    let base = json!({"origin": [0, 0], "width": 10, "height": 3});
    let q = s.execute("flowalongsrf", &json!({"handles": [h], "target": cylinder(1.5, 3.0), "base": base, "mode": "rigid", "query": true})).unwrap();
    assert!(q["added"].as_array().unwrap().is_empty());
    let r = s.execute("flowalongsrf", &json!({"handles": [h], "target": cylinder(1.5, 3.0), "base": base, "mode": "rigid"})).unwrap();
    let out = added(&s, &r);
    let EntityKind::Polyline3d(p) = &out[0] else { panic!("{out:?}") };
    // Rigid keeps unit edges.
    assert!(((p.points[1] - p.points[0]).len() - 1.0).abs() < 1e-9);
}

#[test]
fn flow_along_a_drawn_circle() {
    let mut s = Session::new();
    let rr = 4.0;
    s.execute("circle", &json!({"center": [0, 0], "radius": rr})).unwrap();
    let target = last(&s);
    let h = line(&mut s, [0.0, 0.5], [TAU * rr, 0.5]);
    let r = s.execute("flowalongcrv", &json!({"handles": [h], "target": {"handle": target}, "base": {"from": [0, 0], "to": [TAU * rr, 0]}})).unwrap();
    let out = added(&s, &r);
    let EntityKind::Polyline3d(p) = &out[0] else { panic!("{out:?}") };
    // Offset 0.5 to one side of a circle of radius 4: a concentric circle of 3.5 or 4.5.
    let d = (radius(p.points[3]) - rr).abs();
    assert!((d - 0.5).abs() < 1e-3, "{d}");
    assert!(p.points.iter().all(|q| ((radius(*q) - rr).abs() - 0.5).abs() < 1e-3));
}

#[test]
fn surface_entity_hook_reports_not_available() {
    let mut s = Session::new();
    let h = line(&mut s, [0.0, 0.0], [1.0, 1.0]);
    let e = s.execute("flowalongsrf", &json!({"handles": [h.clone()], "target": {"handle": h}})).unwrap_err();
    assert!(e.to_string().contains("not available yet"), "{e}");
}

#[test]
fn hostile_flow_params_are_errors() {
    let mut s = Session::new();
    let h = line(&mut s, [0.0, 0.0], [1.0, 1.0]);
    for p in [
        json!({"handles": [h], "target": {"countU": 100000, "countV": 100000, "points": []}}),
        json!({"handles": [h], "target": {"countU": 2, "countV": 2, "points": [[0, 0, 0]]}}),
        json!({"handles": [h], "target": plane(1.0, 1.0), "offset": 1e308}),
        json!({"handles": [h], "target": plane(1.0, 1.0), "mode": "melt"}),
        json!({"handles": [h], "target": plane(1.0, 1.0), "base": {"origin": [0, 0], "width": -1, "height": 1}}),
        json!({"handles": [h], "target": {"countU": 2, "countV": 2, "points": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]}}),
        json!({"target": plane(1.0, 1.0), "points": vec![json!([0, 0]); 100_001]}),
        json!({"handles": [h], "target": {"points": [[0, 0, 0]]}}),
    ] {
        let _ = s.execute("flowalongsrf", &p).unwrap_err();
    }
    let _ = s.execute("flowalongcrv", &json!({"handles": [h], "target": {"points": [[0, 0, 0], [0, 0, 0]]}})).unwrap_err();
    // A NaN-free tiny tolerance stays bounded.
    let r = s.execute("flowalongsrf", &json!({"handles": [h], "target": cylinder(1.0, 1.0), "tolerance": 1e-300}));
    if let Ok(r) = r {
        assert!(r["added"].as_array().unwrap().len() <= 1);
    }
}

#[hegel::test(test_cases = 200)]
fn flow_params_never_panic(tc: TestCase) {
    let mut s = Session::new();
    s.execute("line", &json!({"points": [[0, 0], [3, 1]]})).unwrap();
    let num = |tc: &TestCase| json!(tc.draw(gs::floats::<f64>().min_value(-1e12).max_value(1e12)));
    let count = tc.draw(gs::integers::<u64>().min_value(0).max_value(6));
    let pts: Vec<Value> = (0..tc.draw(gs::integers::<usize>().min_value(0).max_value(40))).map(|_| json!([num(&tc), num(&tc), num(&tc)])).collect();
    let target = json!({"countU": count, "countV": tc.draw(gs::integers::<u64>().min_value(0).max_value(6)), "degreeU": tc.draw(gs::integers::<u64>().min_value(0).max_value(9)), "points": pts});
    let p = json!({
        "target": target,
        "points": [[num(&tc), num(&tc)]],
        "base": if tc.draw(gs::booleans()) { json!({"origin": [num(&tc), num(&tc)], "width": num(&tc), "height": num(&tc)}) } else { Value::Null },
        "offset": num(&tc), "tolerance": num(&tc), "stretch": tc.draw(gs::booleans()), "flip": tc.draw(gs::booleans()),
        "mode": if tc.draw(gs::booleans()) { "rigid" } else { "deforming" },
    });
    if let Ok(r) = s.execute("flowalongsrf", &p) {
        for st in r["stones"].as_array().unwrap() {
            assert!(st["point"].as_array().unwrap().iter().all(|x| x.as_f64().is_some_and(f64::is_finite)));
        }
    }
    let _ = s.execute("flowalongcrv", &json!({"target": {"points": p["target"]["points"]}, "points": p["points"], "offset": p["offset"], "base": {"from": [num(&tc), 0], "to": [num(&tc), 1]}}));
}
