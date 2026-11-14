//! IMPORT3DM (and IMPORT of a `.3dm`) against files written by CADCraft's own 3dm writer:
//! volumes and weights of closed meshes against analytic solids, curves into drawing objects,
//! a profile brought in and used by PIECE, the JSON contract and hostile files.

use std::time::{Duration, Instant};

use cadcraft_doc::EntityKind;
use cadcraft_geom::{PI, TAU};
use cadcraft_io::rhino3dm::{self, Curve, Geometry, Layer, Mesh, Model, Nurbs, Object, Plane};
use hegel::TestCase;
use hegel::generators as gs;
use serde_json::{Value, json};

use super::tests::mm_drawing;
use crate::{EngineError, Session};

fn b64(bytes: &[u8]) -> String {
    super::super::file::base64_encode(bytes)
}

fn import(s: &mut Session, model: &Model, extra: Value) -> Value {
    let bytes = rhino3dm::write(model, 80).unwrap();
    let mut p = json!({ "data": b64(&bytes) });
    if let (Some(p), Value::Object(e)) = (p.as_object_mut(), extra) {
        p.extend(e);
    }
    s.execute("import3dm", &p).unwrap()
}

fn obj(name: &str, layer: i32, geometry: Geometry) -> Object {
    Object { name: name.into(), layer, geometry }
}

/// An axis-aligned box as six outward quads.
fn cuboid(dx: f64, dy: f64, dz: f64) -> Mesh {
    let vertices = (0..8u32).map(|i| [f64::from(i & 1) * dx, f64::from((i >> 1) & 1) * dy, f64::from((i >> 2) & 1) * dz]).collect();
    let faces = vec![[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    Mesh { vertices, faces, normals: Vec::new() }
}

/// A torus about Z (`r` tube radius about a circle of radius `big`), `n` × `m` quads, outward.
fn torus(big: f64, r: f64, n: u32, m: u32) -> Mesh {
    let mut vertices = Vec::new();
    for i in 0..n {
        let u = TAU * f64::from(i) / f64::from(n);
        for j in 0..m {
            let v = TAU * f64::from(j) / f64::from(m);
            let rho = big + r * v.cos();
            vertices.push([rho * u.cos(), rho * u.sin(), r * v.sin()]);
        }
    }
    let id = |i: u32, j: u32| (i % n) * m + (j % m);
    let mut faces = Vec::new();
    for i in 0..n {
        for j in 0..m {
            faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
        }
    }
    Mesh { vertices, faces, normals: Vec::new() }
}

/// A band: the solid between two coaxial `n`-gon prisms (outer radius `ro`, inner `ri`, height
/// `h`), as one closed outward shell of triangles and quads.
fn polygon_band(ro: f64, ri: f64, h: f64, n: u32) -> Mesh {
    let mut vertices = Vec::new();
    for (r, z) in [(ro, 0.0), (ro, h), (ri, 0.0), (ri, h)] {
        for i in 0..n {
            let a = TAU * f64::from(i) / f64::from(n);
            vertices.push([r * a.cos(), r * a.sin(), z]);
        }
    }
    let (ob, ot, ib, it) = (0, n, 2 * n, 3 * n);
    let mut faces = Vec::new();
    for i in 0..n {
        let j = (i + 1) % n;
        faces.push([ob + i, ob + j, ot + j, ot + i]); // outside, facing out
        faces.push([ib + j, ib + i, it + i, it + j]); // inside, facing the axis
        faces.push([ot + i, ot + j, it + j, it + i]); // top
        faces.push([ob + j, ob + i, ib + i, ib + j]); // bottom
    }
    Mesh { vertices, faces, normals: Vec::new() }
}

fn grams(r: &Value, metal: &str) -> f64 {
    r["grams"][metal].as_f64().unwrap()
}

#[test]
fn a_cube_weighs_its_volume_in_every_metal() {
    let mut s = mm_drawing();
    let model = Model { objects: vec![obj("cube", 0, Geometry::Mesh(cuboid(2.0, 3.0, 4.0)))], ..Model::default() };
    let r = import(&mut s, &model, json!({}));
    let m = &r["meshes"][0];
    assert_eq!(m["name"], "cube");
    assert_eq!(m["triangles"], 12);
    assert_eq!(m["closed"], true);
    assert_eq!(m["volumeMm3"], json!(24.0));
    assert!((grams(m, "gold18") - 24.0 / 1000.0 * 15.5).abs() < 1e-3, "{m}");
    assert!((grams(m, "platinum") - 24.0 / 1000.0 * 20.7).abs() < 1e-3);
    assert_eq!(m["grams"].as_object().unwrap().len(), super::rhino::METALS.len());
    assert_eq!(m["bounds"], json!({"min": [0.0, 0.0, 0.0], "max": [2.0, 3.0, 4.0]}));
    assert_eq!(r["units"], "millimeters");
    assert!(r["added"].as_array().unwrap().is_empty(), "meshes are reported, not added, by default");
}

#[test]
fn a_band_and_a_torus_weigh_what_the_solid_does() {
    let mut s = mm_drawing();
    let (ro, ri, h, n) = (10.0, 8.5, 2.5, 96u32);
    // The exact volume of the polygonal band: the two regular n-gons' area difference by height.
    let polygon = |r: f64| 0.5 * f64::from(n) * r * r * (TAU / f64::from(n)).sin();
    let band = h * (polygon(ro) - polygon(ri));
    let (big, small) = (9.0, 1.0);
    let model = Model {
        objects: vec![obj("band", 0, Geometry::Mesh(polygon_band(ro, ri, h, n))), obj("torus", 0, Geometry::Mesh(torus(big, small, 256, 128)))],
        ..Model::default()
    };
    let r = import(&mut s, &model, json!({}));
    let v = r["meshes"][0]["volumeMm3"].as_f64().unwrap();
    // Single-precision vertices: within a part in a hundred thousand.
    assert!((v - band).abs() / band < 1e-5, "{v} vs {band}");
    let t = r["meshes"][1]["volumeMm3"].as_f64().unwrap();
    let exact = 2.0 * PI * PI * big * small * small;
    assert!((t - exact).abs() / exact < 2e-3, "{t} vs {exact}");
    assert!((grams(&r["meshes"][1], "silver") - t / 1000.0 * 10.4).abs() < 2e-3);
}

#[test]
fn inches_are_read_as_millimetres() {
    let mut s = mm_drawing();
    let model = Model { units: Some((8, 25.4)), objects: vec![obj("", 0, Geometry::Mesh(cuboid(1.0, 1.0, 1.0)))], ..Model::default() };
    let r = import(&mut s, &model, json!({}));
    assert_eq!(r["units"], "inches");
    let v = r["meshes"][0]["volumeMm3"].as_f64().unwrap();
    assert!((v - 25.4f64.powi(3)).abs() < 0.01, "{v}");
}

#[test]
fn an_open_mesh_has_no_volume() {
    let mut s = mm_drawing();
    let mut m = cuboid(1.0, 1.0, 1.0);
    m.faces.pop();
    let r = import(&mut s, &Model { objects: vec![obj("lid off", 0, Geometry::Mesh(m))], ..Model::default() }, json!({}));
    assert_eq!(r["meshes"][0]["closed"], false);
    assert!(r["meshes"][0].get("volumeMm3").is_none());
    assert!(r["meshes"][0].get("grams").is_none());
}

#[test]
fn faces_true_adds_the_mesh_as_3dfaces_on_its_layer() {
    let mut s = mm_drawing();
    let model = Model {
        layers: vec![Layer { name: "Metal".into(), color: [200, 160, 40], index: 0 }],
        objects: vec![obj("cube", 0, Geometry::Mesh(cuboid(1.0, 1.0, 1.0)))],
        ..Model::default()
    };
    let r = import(&mut s, &model, json!({"faces": true}));
    let added = r["added"].as_array().unwrap();
    assert_eq!(added.len(), 12);
    let d = s.doc().unwrap();
    let faces = d.model.iter().filter(|e| matches!(e.kind, EntityKind::Face3d(_))).count();
    assert_eq!(faces, 12);
    assert!(d.model.iter().all(|e| e.common.layer == "Metal"));
    let layer = d.layers.iter().find(|l| l.name == "Metal").unwrap();
    assert_eq!(layer.color, cadcraft_color::Color::True(cadcraft_color::Rgb(200, 160, 40)));
}

fn curves_model() -> Model {
    let quarter = Nurbs {
        dimension: 3,
        order: 3,
        knots: vec![0.0, 0.0, 1.0, 1.0],
        points: vec![[1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]],
        weights: vec![1.0, std::f64::consts::FRAC_1_SQRT_2, 1.0],
    };
    let tilted = Plane { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], y: [0.0, 0.0, 1.0], z: [0.0, -1.0, 0.0] };
    Model {
        layers: vec![Layer { name: "Default".into(), color: [0, 0, 0], index: 0 }, Layer { name: "Rails".into(), color: [255, 0, 0], index: 1 }],
        objects: vec![
            obj("l", 1, Geometry::Curve(Curve::Line { from: [0.0, 0.0, 0.0], to: [3.0, 4.0, 0.0] })),
            obj("a", 1, Geometry::Curve(Curve::Arc { plane: Plane::xy([1.0, 1.0, 0.0]), radius: 2.0, start: 0.0, end: PI / 2.0 })),
            obj("c", 0, Geometry::Curve(Curve::Arc { plane: Plane::xy([5.0, 5.0, 0.0]), radius: 1.0, start: 0.0, end: TAU })),
            obj("p", 0, Geometry::Curve(Curve::Polyline(vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 0.0, 0.0]]))),
            obj("n", 0, Geometry::Curve(Curve::Nurbs(quarter))),
            obj("t", 0, Geometry::Curve(Curve::Arc { plane: tilted, radius: 1.0, start: 0.0, end: PI })),
            obj(
                "j",
                0,
                Geometry::Curve(Curve::Joined(vec![
                    Curve::Line { from: [0.0, 0.0, 0.0], to: [2.0, 0.0, 0.0] },
                    Curve::Line { from: [2.0, 0.0, 0.0], to: [2.0, 1.0, 0.0] },
                    Curve::Line { from: [2.0, 1.0, 0.0], to: [0.0, 0.0, 0.0] },
                ])),
            ),
        ],
        ..Model::default()
    }
}

#[test]
fn curves_become_the_drawings_objects_on_their_layers() {
    let mut s = mm_drawing();
    let r = import(&mut s, &curves_model(), json!({}));
    let rows = r["curves"].as_array().unwrap();
    let kinds: Vec<&str> = rows.iter().map(|c| c["added"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["line", "arc", "circle", "polyline", "spline", "polyline", "polyline"], "{r}");
    assert_eq!(rows.iter().map(|c| c["kind"].as_str().unwrap()).collect::<Vec<_>>(), ["line", "arc", "circle", "polyline", "nurbs", "arc", "joined"]);
    assert_eq!(rows[5]["projected"], true);
    assert!(rows.iter().take(5).all(|c| c["projected"] == false));
    assert_eq!(rows[3]["closed"], true);
    assert_eq!(rows[6]["closed"], true);
    assert_eq!(r["added"].as_array().unwrap().len(), 7);
    let d = s.doc().unwrap();
    let by_handle = |h: &Value| d.model.iter().find(|e| e.handle.hex() == h.as_str().unwrap()).unwrap();
    let line = by_handle(&rows[0]["handle"]);
    assert_eq!(line.common.layer, "Rails");
    let EntityKind::Arc(a) = &by_handle(&rows[1]["handle"]).kind else { panic!("an arc") };
    assert!((a.radius - 2.0).abs() < 1e-12 && a.start.abs() < 1e-12 && (a.end - PI / 2.0).abs() < 1e-12);
    let EntityKind::Spline(sp) = &by_handle(&rows[4]["handle"]).kind else { panic!("a spline") };
    assert_eq!(sp.degree, 2);
    assert_eq!(sp.knots, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
    // The rational quadratic is a true quarter circle.
    for i in 0..=10 {
        let p = sp.eval(f64::from(i) / 10.0);
        assert!((p.len() - 1.0).abs() < 1e-9, "{p:?}");
    }
    let EntityKind::LwPolyline(pl) = &by_handle(&rows[3]["handle"]).kind else { panic!("a polyline") };
    assert!(pl.closed && pl.vertices.len() == 3);
    let EntityKind::LwPolyline(tilt) = &by_handle(&rows[5]["handle"]).kind else { panic!("a polyline") };
    // The half circle in the XZ plane projects onto the X axis.
    assert!(tilt.vertices.iter().all(|v| v.p.y.abs() < 1e-12 && v.p.x.abs() <= 1.0 + 1e-12));
    assert!(r["notes"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains("projected")));
}

#[test]
fn an_arc_in_a_downward_plane_keeps_its_ends() {
    let mut s = mm_drawing();
    let down = Plane { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], y: [0.0, -1.0, 0.0], z: [0.0, 0.0, -1.0] };
    let model =
        Model { objects: vec![obj("", 0, Geometry::Curve(Curve::Arc { plane: down, radius: 1.0, start: 0.0, end: PI / 2.0 }))], ..Model::default() };
    let r = import(&mut s, &model, json!({}));
    let d = s.doc().unwrap();
    let e = d.model.iter().find(|e| e.handle.hex() == r["curves"][0]["handle"].as_str().unwrap()).unwrap();
    let EntityKind::Arc(a) = &e.kind else { panic!("an arc") };
    // From (1, 0) clockwise to (0, -1): counter-clockwise from 270° to 0°.
    assert!((a.start - 1.5 * PI).abs() < 1e-12 && a.end.abs() < 1e-12, "{a:?}");
}

#[test]
fn an_imported_profile_shapes_a_piece() {
    let mut s = mm_drawing();
    let model = Model {
        objects: vec![obj(
            "section",
            0,
            Geometry::Curve(Curve::Polyline(vec![[10.0, 20.0, 0.0], [13.0, 20.0, 0.0], [13.0, 21.8, 0.0], [10.0, 21.8, 0.0], [10.0, 20.0, 0.0]])),
        )],
        ..Model::default()
    };
    let r = import(&mut s, &model, json!({}));
    let h = r["curves"][0]["handle"].as_str().unwrap().to_string();
    let p = s.execute("piece", &json!({"kind": "band", "profile": {"curve": h}, "size": 7})).unwrap();
    let params = &p["piece"]["params"];
    assert_eq!(params["profile"], "custom");
    assert!((params["width"].as_f64().unwrap() - 3.0).abs() < 1e-9, "{params}");
    assert!((params["wall"].as_f64().unwrap() - 1.8).abs() < 1e-9, "{params}");
    // A closed NURBS curve (a full rational circle of nine points) serves as well.
    let w = std::f64::consts::FRAC_1_SQRT_2;
    let r0 = 0.9;
    let pts = [[1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [-1.0, 1.0], [-1.0, 0.0], [-1.0, -1.0], [0.0, -1.0], [1.0, -1.0], [1.0, 0.0]];
    let circle = Nurbs {
        dimension: 3,
        order: 3,
        knots: vec![0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 4.0, 4.0],
        points: pts.iter().map(|q| [q[0] * r0, q[1] * r0 + 5.0, 0.0]).collect(),
        weights: vec![1.0, w, 1.0, w, 1.0, w, 1.0, w, 1.0],
    };
    let r = import(&mut s, &Model { objects: vec![obj("round", 0, Geometry::Curve(Curve::Nurbs(circle)))], ..Model::default() }, json!({}));
    assert_eq!(r["curves"][0]["closed"], true);
    let h = r["curves"][0]["handle"].as_str().unwrap().to_string();
    let p = s.execute("piece", &json!({"kind": "band", "profile": {"curve": h}, "size": 7})).unwrap();
    assert!((p["piece"]["params"]["width"].as_f64().unwrap() - 1.8).abs() < 1e-3, "{}", p["piece"]["params"]);
}

#[test]
fn import_takes_a_3dm_file_too() {
    let mut s = mm_drawing();
    let bytes = rhino3dm::write(&curves_model(), 70).unwrap();
    let r = s.execute("import", &json!({"data": b64(&bytes), "name": "ring.3dm"})).unwrap();
    assert_eq!(r["version"], 70);
    assert_eq!(r["curves"].as_array().unwrap().len(), 7);
}

#[test]
fn the_json_contract() {
    let mut s = mm_drawing();
    let bytes = rhino3dm::write(&curves_model(), 60).unwrap();
    let before = s.doc().unwrap().model.iter().count();
    let r = s.execute("import3dm", &json!({"data": b64(&bytes), "query": true})).unwrap();
    for key in ["version", "units", "mmPerUnit", "layers", "meshes", "curves", "skipped", "added", "notes", "message"] {
        assert!(r.get(key).is_some(), "{key}: {r}");
    }
    assert_eq!(r["layers"], json!([{"name": "Default", "color": "#000000"}, {"name": "Rails", "color": "#ff0000"}]));
    assert_eq!(s.doc().unwrap().model.iter().count(), before, "query adds nothing");
    let r = s.execute("import3dm", &json!({"data": b64(&bytes), "curves": false})).unwrap();
    assert!(r["added"].as_array().unwrap().is_empty());
    for (p, says) in [
        (json!({}), "`path` or `data`"),
        (json!({"data": "%%%"}), "base64"),
        (json!({"data": b64(b"not a rhino file at all, no sir, not at all")}), "not a Rhino 3dm file"),
    ] {
        match s.execute("import3dm", &p) {
            Err(EngineError::Internal(..)) => panic!("{p}: a panic was caught"),
            Err(e) => assert!(e.to_string().contains(says), "{p}: {e}"),
            Ok(v) => panic!("{p}: accepted {v}"),
        }
    }
}

fn never_panics(bytes: &[u8]) {
    let mut s = Session::new();
    let started = Instant::now();
    if let Err(EngineError::Internal(m, _)) = s.execute("import3dm", &json!({"data": b64(bytes), "faces": true})) {
        panic!("a panic was caught: {m}");
    }
    assert!(started.elapsed() < Duration::from_secs(5), "{} bytes took {:?}", bytes.len(), started.elapsed());
}

/// Random bytes behind a valid signature never panic and finish quickly.
#[hegel::test(test_cases = 300)]
fn random_3dm_bytes_never_panic(tc: TestCase) {
    let version = tc.draw(gs::sampled_from(vec!["       4", "      50", "      70", "      80"]));
    let mut bytes = format!("3D Geometry File Format {version}").into_bytes();
    bytes.extend(tc.draw(gs::binary().max_size(2048)));
    never_panics(&bytes);
}

/// A valid file with bytes overwritten or cut off never panics.
#[hegel::test(test_cases = 300)]
fn mutated_3dm_files_never_panic(tc: TestCase) {
    let mut model = curves_model();
    model.objects.push(obj("cube", 1, Geometry::Mesh(cuboid(1.0, 2.0, 3.0))));
    model.objects.push(obj("torus", 0, Geometry::Mesh(torus(5.0, 1.0, 12, 8))));
    let version = tc.draw(gs::sampled_from(rhino3dm::WRITE_VERSIONS.to_vec()));
    let mut bytes = rhino3dm::write(&model, version).unwrap();
    let edits = tc.draw(gs::integers::<usize>().min_value(1).max_value(8));
    for _ in 0..edits {
        let at = tc.draw(gs::integers::<usize>().min_value(0).max_value(bytes.len().saturating_sub(1)));
        match tc.draw(gs::integers::<u8>().min_value(0).max_value(3)) {
            0 => bytes[at] = tc.draw(gs::integers::<u8>()),
            1 => {
                for (k, b) in [0xFF, 0xFF, 0xFF, 0x7F].into_iter().enumerate() {
                    if let Some(x) = bytes.get_mut(at + k) {
                        *x = b;
                    }
                }
            }
            2 => bytes.truncate(at),
            _ => {
                let v = tc.draw(gs::integers::<u32>());
                for (k, b) in v.to_le_bytes().into_iter().enumerate() {
                    if let Some(x) = bytes.get_mut(at + k) {
                        *x = b;
                    }
                }
            }
        }
        if bytes.is_empty() {
            break;
        }
    }
    never_panics(&bytes);
}
