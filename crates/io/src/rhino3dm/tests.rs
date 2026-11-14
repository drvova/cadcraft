//! The 3dm reader against the writer (every archive version it writes), against byte sequences
//! built by hand from `docs/formats/3dm.md`, and against damaged and hostile files.

use super::*;

fn cube_mesh() -> Mesh {
    let mut vertices = Vec::new();
    for i in 0..8u32 {
        vertices.push([f64::from(i & 1) * 2.0, f64::from((i >> 1) & 1) * 2.0, f64::from((i >> 2) & 1) * 2.0]);
    }
    // Six quads, outward.
    let faces = vec![[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    Mesh { vertices, faces, normals: Vec::new() }
}

fn sample() -> Model {
    let big: Vec<[f64; 3]> = (0..300).map(|i| [f64::from(i), f64::from(i % 7) * 0.5, 0.25]).collect();
    let mut big_faces = Vec::new();
    for i in 0..298u32 {
        big_faces.push([i, i + 1, i + 2, i + 2]);
    }
    let normals = vec![[0.0f32, 0.0, 1.0]; big.len()];
    Model {
        layers: vec![
            Layer { name: "Default".into(), color: [0, 0, 0], index: 0 },
            Layer { name: "Métal 18k".into(), color: [212, 175, 55], index: 1 },
        ],
        objects: vec![
            Object { name: "cube".into(), layer: 1, geometry: Geometry::Mesh(cube_mesh()) },
            Object { name: "".into(), layer: 0, geometry: Geometry::Mesh(Mesh { vertices: big, faces: big_faces, normals }) },
            Object { name: "rail".into(), layer: 0, geometry: Geometry::Curve(Curve::Line { from: [0.0, 0.0, 0.0], to: [3.0, 4.0, 0.0] }) },
            Object {
                name: "circle".into(),
                layer: 1,
                geometry: Geometry::Curve(Curve::Arc { plane: Plane::xy([1.0, 2.0, 0.0]), radius: 2.5, start: 0.0, end: std::f64::consts::TAU }),
            },
            Object {
                name: "profile".into(),
                layer: 1,
                geometry: Geometry::Curve(Curve::Polyline(vec![[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 1.5, 0.0], [0.0, 0.0, 0.0]])),
            },
            Object {
                name: "nurbs".into(),
                layer: 0,
                geometry: Geometry::Curve(Curve::Nurbs(Nurbs {
                    dimension: 3,
                    order: 3,
                    knots: vec![0.0, 0.0, 1.0, 1.0],
                    points: vec![[1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]],
                    weights: vec![1.0, std::f64::consts::FRAC_1_SQRT_2, 1.0],
                })),
            },
            Object {
                name: "joined".into(),
                layer: 0,
                geometry: Geometry::Curve(Curve::Joined(vec![
                    Curve::Line { from: [0.0, 0.0, 0.0], to: [1.0, 0.0, 0.0] },
                    Curve::Joined(vec![Curve::Line { from: [1.0, 0.0, 0.0], to: [1.0, 1.0, 0.0] }]),
                ])),
            },
        ],
        ..Model::default()
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-12 * (1.0 + a.abs().max(b.abs()))
}

#[test]
fn every_written_version_reads_back() {
    let m = sample();
    for v in WRITE_VERSIONS {
        let bytes = write(&m, v).expect("write");
        let r = read(&bytes).expect("read");
        assert_eq!(r.version, v);
        assert!(r.notes.is_empty(), "{v}: {:?}", r.notes);
        assert_eq!(r.toolkit, 2_026_111_408);
        assert_eq!(r.units, Some((2, 1.0)), "millimetres by default");
        assert!(r.comment.contains("CADCraft"));
        assert_eq!(r.layers, m.layers, "{v}");
        assert_eq!(r.objects.len(), m.objects.len());
        for (a, b) in r.objects.iter().zip(&m.objects) {
            assert_eq!(a.name, b.name);
            assert_eq!(a.layer, b.layer);
            match (&a.geometry, &b.geometry) {
                (Geometry::Mesh(x), Geometry::Mesh(y)) => {
                    assert_eq!(x.faces, y.faces);
                    assert_eq!(x.vertices, y.vertices, "these vertices are exact in single precision");
                    assert_eq!(x.normals, y.normals);
                }
                (Geometry::Curve(Curve::Nurbs(x)), Geometry::Curve(Curve::Nurbs(y))) => {
                    assert_eq!(x.knots, y.knots);
                    assert_eq!(x.order, y.order);
                    for (p, q) in x.points.iter().zip(&y.points) {
                        assert!(p.iter().zip(q).all(|(a, b)| close(*a, *b)), "{p:?} {q:?}");
                    }
                    assert_eq!(x.weights, y.weights);
                }
                (x, y) => assert_eq!(x, y),
            }
        }
        // Deterministic: the same model writes the same bytes.
        assert_eq!(write(&m, v).expect("write"), bytes);
    }
}

#[test]
fn model_units_read_back() {
    for (code, mm) in [(8u32, 25.4), (3, 10.0), (4, 1000.0)] {
        let m = Model { units: Some((code, mm)), ..Model::default() };
        assert_eq!(read(&write(&m, 80).expect("write")).expect("read").units, Some((code, mm)));
    }
    // A custom unit is its metres-per-unit field.
    let m = Model { units: Some((11, 2.5)), ..Model::default() };
    let (code, mm) = read(&write(&m, 70).expect("write")).expect("read").units.expect("units");
    assert_eq!(code, 11);
    assert!((mm - 2.5).abs() < 1e-12);
}

#[test]
fn the_writer_refuses_versions_it_does_not_write() {
    for v in [0, 1, 4, 5, 55, 90] {
        assert!(write(&sample(), v).is_err(), "{v}");
    }
}

#[test]
fn crc32_is_zlibs() {
    assert_eq!(crc32(0, b""), 0);
    assert_eq!(crc32(0, b"123456789"), 0xCBF4_3926);
    assert_eq!(crc32(crc32(0, b"1234"), b"56789"), 0xCBF4_3926);
}

#[test]
fn class_ids_are_stored_as_the_note_says() {
    // 4ED7D4E4-E947-11d3-BFE5-0010830122F0
    assert_eq!(CLASS_MESH, [0xE4, 0xD4, 0xD7, 0x4E, 0x47, 0xE9, 0xD3, 0x11, 0xBF, 0xE5, 0x00, 0x10, 0x83, 0x01, 0x22, 0xF0]);
}

/// A hand-built byte stream, from the note, for a 4-byte-length archive (version 4).
struct Hand {
    b: Vec<u8>,
}

impl Hand {
    fn new(version: u32) -> Hand {
        Hand { b: format!("3D Geometry File Format {version:>8}").into_bytes() }
    }
    /// A long chunk with 4-byte length; `crc` appends the CRC of `content` (direct bytes only).
    fn long4(&mut self, tc: u32, content: &[u8]) {
        let crc = tc & TC_CRC != 0;
        self.b.extend_from_slice(&tc.to_le_bytes());
        self.b.extend_from_slice(&((content.len() + if crc { 4 } else { 0 }) as u32).to_le_bytes());
        self.b.extend_from_slice(content);
        if crc {
            self.b.extend_from_slice(&crc32(0, content).to_le_bytes());
        }
    }
}

fn long4(tc: u32, content: &[u8]) -> Vec<u8> {
    let mut h = Hand { b: Vec::new() };
    h.long4(tc, content);
    h.b
}

fn short4(tc: u32, v: i32) -> Vec<u8> {
    let mut b = tc.to_le_bytes().to_vec();
    b.extend_from_slice(&v.to_le_bytes());
    b
}

fn wstr(s: &str) -> Vec<u8> {
    let u: Vec<u16> = s.encode_utf16().collect();
    let mut b = ((u.len() + 1) as u32).to_le_bytes().to_vec();
    for x in u.iter().chain([0u16].iter()) {
        b.extend_from_slice(&x.to_le_bytes());
    }
    b
}

fn class4(id: &ClassId, data: &[u8]) -> Vec<u8> {
    let mut inner = long4(TC_CLASS_UUID, id);
    inner.extend(long4(TC_CLASS_DATA, data));
    inner.extend(short4(TC_CLASS_END, 0));
    long4(TC_CLASS, &inner)
}

#[test]
fn a_hand_built_version_4_file_reads() {
    let mut h = Hand::new(4);
    h.long4(TC_COMMENTBLOCK, b"hand made\x1a\0");
    let mut props = short4(TC_PROPERTIES_OPENNURBS_VERSION, 200_503_170);
    props.extend(short4(TC_ENDOFTABLE, 0));
    h.long4(TC_PROPERTIES_TABLE, &props);
    // Layer 1.0: mode, index, iges, material, obsolete, colour, line style, name.
    let mut l = vec![0x10];
    for v in [0i32, 0, 0, -1, 0] {
        l.extend_from_slice(&v.to_le_bytes());
    }
    l.extend_from_slice(&[10, 20, 30, 0]);
    l.extend_from_slice(&[0; 4 + 16]);
    l.extend(wstr("Gold"));
    let mut table = long4(TC_LAYER_RECORD, &class4(&CLASS_LAYER, &l));
    table.extend(short4(TC_ENDOFTABLE, 0));
    h.long4(TC_LAYER_TABLE, &table);
    // A line curve with old-layout attributes (major 1): named "edge" on layer 0.
    let mut line = vec![0x10];
    for v in [0.0f64, 0.0, 0.0, 3.0, 4.0, 0.0, 0.0, 5.0] {
        line.extend_from_slice(&v.to_le_bytes());
    }
    line.extend_from_slice(&3i32.to_le_bytes());
    let mut attrs = vec![0x10];
    attrs.extend_from_slice(&[7; 16]);
    attrs.extend_from_slice(&0i32.to_le_bytes());
    attrs.extend_from_slice(&[0; 4 + 4 + 2 + 2 + 8 + 8 + 4 + 4]);
    attrs.extend(wstr("edge"));
    attrs.extend(wstr(""));
    let mut rec = short4(TC_OBJECT_RECORD_TYPE, 4);
    rec.extend(class4(&CLASS_LINE_CURVE, &line));
    rec.extend(long4(TC_OBJECT_RECORD_ATTRIBUTES, &attrs));
    rec.extend(short4(TC_OBJECT_RECORD_END, 0));
    // An unknown table between the two is skipped.
    h.long4(0x1000_0019, &short4(TC_ENDOFTABLE, 0));
    let mut objects = long4(TC_OBJECT_RECORD, &rec);
    objects.extend(short4(TC_ENDOFTABLE, 0));
    h.long4(TC_OBJECT_TABLE, &objects);
    let size = (h.b.len() + 12) as u32;
    h.long4(TC_ENDOFFILE, &size.to_le_bytes());
    let m = read(&h.b).expect("read");
    assert_eq!(m.version, 4);
    assert_eq!(m.toolkit, 200_503_170);
    assert_eq!(m.comment, "hand made");
    assert_eq!(m.layers, vec![Layer { name: "Gold".into(), color: [10, 20, 30], index: 0 }]);
    assert_eq!(
        m.objects,
        vec![Object { name: "edge".into(), layer: 0, geometry: Geometry::Curve(Curve::Line { from: [0.0; 3], to: [3.0, 4.0, 0.0] }) }]
    );
    assert!(m.notes.is_empty(), "{:?}", m.notes);
}

#[test]
fn surfaces_and_breps_are_counted_not_read() {
    let mut m = sample();
    m.objects.truncate(1);
    let mut bytes = write(&m, 70).expect("write");
    // Turn the mesh's class id into a brep's: the reader must skip it by id.
    let pos = bytes.windows(16).position(|w| w == CLASS_MESH).expect("class id");
    bytes.splice(pos..pos + 16, KNOWN_SKIPPED[2].0);
    // The class-id chunk's CRC is now stale; the reader does not check chunk CRCs.
    let r = read(&bytes).expect("read");
    assert!(r.objects.is_empty());
    assert_eq!(r.skipped, vec![Skipped { kind: "brep (polysurface)".into(), count: 1 }]);
}

#[test]
fn not_a_3dm_file_is_an_error() {
    assert!(read(b"").is_err());
    assert!(read(b"3D Geometry File Format ").is_err());
    assert!(read(b"3D Geometry File Format        X0000000").is_err());
    assert!(read(b"3D Geometry File Format        1\x01\0\0\0\0\0\0\0").is_err());
    assert!(read(&[0u8; 64]).is_err());
}

/// A small deterministic generator for the mutation tests (no dependency).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

#[test]
fn hostile_3dm_does_not_panic() {
    let small = Limits { max_objects: 50, max_mesh_vertices: 10_000, max_curve_points: 10_000, max_inflated: 4 << 20, max_layers: 50 };
    for v in WRITE_VERSIONS {
        let good = write(&sample(), v).expect("write");
        // Every truncation.
        for n in 0..good.len() {
            let _ = read_with(good.get(..n).unwrap_or_default(), &small);
        }
        // Random byte and word mutations, including huge lengths and counts.
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15 ^ u64::from(v));
        for _ in 0..3000 {
            let mut b = good.clone();
            for _ in 0..1 + rng.below(4) {
                let at = rng.below(b.len());
                match rng.below(4) {
                    0 => b[at] = rng.next() as u8,
                    1 => {
                        let word = [0xFFu8, 0xFF, 0xFF, 0x7F];
                        for (k, x) in word.iter().enumerate() {
                            if let Some(y) = b.get_mut(at + k) {
                                *y = *x;
                            }
                        }
                    }
                    2 => {
                        for k in 0..8 {
                            if let Some(y) = b.get_mut(at + k) {
                                *y = 0xFF;
                            }
                        }
                    }
                    _ => b.truncate(at),
                }
            }
            let _ = read_with(&b, &small);
        }
    }
    // A length that claims the whole address space, a nesting bomb and a count bomb.
    let mut h = Hand::new(4);
    h.long4(TC_COMMENTBLOCK, b"x");
    h.b.extend_from_slice(&TC_OBJECT_TABLE.to_le_bytes());
    h.b.extend_from_slice(&u32::MAX.to_le_bytes());
    let _ = read(&h.b);
    let mut nested = class4(&CLASS_LINE_CURVE, &[0x10]);
    for _ in 0..200 {
        let mut d = vec![0x10];
        d.extend_from_slice(&1i32.to_le_bytes());
        d.extend_from_slice(&[0; 8 + 48]);
        d.extend_from_slice(&0i32.to_le_bytes());
        d.extend(nested);
        nested = class4(&CLASS_POLY_CURVE, &d);
    }
    let mut rec = short4(TC_OBJECT_RECORD_TYPE, 4);
    rec.extend(nested);
    let mut h = Hand::new(4);
    h.long4(TC_COMMENTBLOCK, b"x");
    let mut objects = long4(TC_OBJECT_RECORD, &rec);
    objects.extend(short4(TC_ENDOFTABLE, 0));
    h.long4(TC_OBJECT_TABLE, &objects);
    let m = read(&h.b).expect("the start is fine");
    assert!(m.objects.is_empty());
    assert!(m.notes.iter().any(|n| n.contains("too deep")), "{:?}", m.notes);
}

#[test]
fn a_mesh_that_claims_more_than_it_holds_is_left_out() {
    let m = Model { objects: vec![Object { name: "m".into(), layer: 0, geometry: Geometry::Mesh(cube_mesh()) }], ..Model::default() };
    let mut bytes = write(&m, 80).expect("write");
    // The vertex count follows the mesh data's version byte (0x38) at the start of the class data.
    let pos = bytes.windows(9).position(|w| w[0] == 0x38 && w[1..5] == 8i32.to_le_bytes() && w[5..9] == 6i32.to_le_bytes()).expect("mesh head");
    bytes.splice(pos + 1..pos + 5, 2_000_000_000i32.to_le_bytes());
    let r = read(&bytes).expect("read");
    assert!(r.objects.is_empty());
    assert_eq!(r.notes.len(), 1, "{:?}", r.notes);
}
