//! Writing a `.3dm` file of layers, meshes and curves (`docs/formats/3dm.md`), for export and for
//! the reader's tests.

use super::*;
use crate::{IoError, Result};

/// The toolkit version number written in the properties table, in the old year-month-day form
/// (`((yyyy·100 + mm)·100 + dd)·10 + major`); any number from 200712190 on selects the
/// version-5 attribute layout the writer uses.
const TOOLKIT: u64 = 2_026_111_408;

/// Write `model`'s layers and objects as a `.3dm` file of archive `version` (one of
/// [`WRITE_VERSIONS`]). `model.skipped`, `notes` and `toolkit` are not written.
pub fn write(model: &Model, version: u32) -> Result<Vec<u8>> {
    if !WRITE_VERSIONS.contains(&version) {
        return Err(IoError::Format(format!("3dm: the writer writes archive versions 50, 60, 70 and 80, not {version}")));
    }
    let mut w = W { out: Vec::new(), open: Vec::new(), version };
    w.out.extend_from_slice(format!("3D Geometry File Format {version:>8}").as_bytes());
    w.begin(TC_COMMENTBLOCK);
    w.bytes(b" CADCraft 3dm writer\n\x1a\0");
    w.end();
    w.begin(TC_PROPERTIES_TABLE);
    w.short(TC_PROPERTIES_OPENNURBS_VERSION, TOOLKIT as i64);
    w.short(TC_ENDOFTABLE, 0);
    w.end();
    w.begin(TC_SETTINGS_TABLE);
    // The model units: millimetres unless the model says otherwise.
    let (code, mm) = model.units.unwrap_or((2, 1.0));
    w.begin(TC_SETTINGS_UNITSANDTOLS);
    w.i32(102);
    w.u32(code);
    w.f64(0.001); // absolute tolerance
    w.f64(std::f64::consts::PI / 180.0);
    w.f64(0.01);
    w.i32(0); // decimal display
    w.i32(3); // display precision
    w.f64(mm / 1000.0);
    w.string("");
    w.end();
    w.short(TC_ENDOFTABLE, 0);
    w.end();
    w.begin(TC_LAYER_TABLE);
    for (i, l) in model.layers.iter().enumerate() {
        w.begin(TC_LAYER_RECORD);
        w.class(&CLASS_LAYER, |w| layer(w, l, i));
        w.end();
    }
    w.short(TC_ENDOFTABLE, 0);
    w.end();
    w.begin(TC_OBJECT_TABLE);
    for (i, o) in model.objects.iter().enumerate() {
        w.begin(TC_OBJECT_RECORD);
        let (ot, id) = match &o.geometry {
            Geometry::Mesh(_) => (OT_MESH, CLASS_MESH),
            Geometry::Curve(c) => (OT_CURVE, curve_class(c)),
        };
        w.short(TC_OBJECT_RECORD_TYPE, ot as i64);
        match &o.geometry {
            Geometry::Mesh(m) => w.class(&id, |w| mesh(w, m)),
            Geometry::Curve(c) => w.class(&id, |w| curve(w, c)),
        }
        w.begin(TC_OBJECT_RECORD_ATTRIBUTES);
        w.u8(0x20); // version-5 layout, 2.0
        w.bytes(&make_id(b"object", i, &o.name));
        w.i32(o.layer);
        if !o.name.is_empty() {
            w.u8(1);
            w.string(&o.name);
        }
        w.u8(0);
        w.end();
        w.short(TC_OBJECT_RECORD_END, 0);
        w.end();
    }
    w.short(TC_ENDOFTABLE, 0);
    w.end();
    // The end mark holds the whole file's size, itself included: typecode, value, size.
    w.begin(TC_ENDOFFILE);
    let total = w.out.len() as u64 + 8;
    w.u64(total);
    w.end();
    Ok(w.out)
}

/// The bytes being written and the chunks still open (typecode, where the length goes, running
/// CRC of the bytes written directly in it).
struct W {
    out: Vec<u8>,
    open: Vec<(u32, usize, u32)>,
    version: u32,
}

impl W {
    fn bytes(&mut self, b: &[u8]) {
        self.out.extend_from_slice(b);
        if let Some(top) = self.open.last_mut() {
            top.2 = crc32(top.2, b);
        }
    }
    fn u8(&mut self, v: u8) {
        self.bytes(&[v]);
    }
    fn u16(&mut self, v: u16) {
        self.bytes(&v.to_le_bytes());
    }
    fn i16(&mut self, v: i16) {
        self.bytes(&v.to_le_bytes());
    }
    fn i32(&mut self, v: i32) {
        self.bytes(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.bytes(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.bytes(&v.to_le_bytes());
    }
    fn f64(&mut self, v: f64) {
        self.bytes(&v.to_le_bytes());
    }
    fn point(&mut self, p: [f64; 3]) {
        for v in p {
            self.f64(v);
        }
    }
    fn string(&mut self, s: &str) {
        let units: Vec<u16> = s.encode_utf16().collect();
        if units.is_empty() {
            self.u32(0);
            return;
        }
        self.u32(units.len() as u32 + 1);
        for u in units {
            self.u16(u);
        }
        self.u16(0);
    }
    /// A chunk header is never part of any CRC.
    fn header(&mut self, tc: u32, value: i64) {
        self.out.extend_from_slice(&tc.to_le_bytes());
        self.out.extend_from_slice(&value.to_le_bytes());
    }
    fn short(&mut self, tc: u32, value: i64) {
        self.header(tc, value);
    }
    fn begin(&mut self, tc: u32) {
        self.header(tc, 0);
        let at = self.out.len() - 8;
        self.open.push((tc, at, 0));
    }
    fn end(&mut self) {
        let Some((tc, at, crc)) = self.open.pop() else { return };
        if tc & TC_CRC != 0 {
            self.out.extend_from_slice(&crc.to_le_bytes());
        }
        let len = (self.out.len() - at - 8) as u64;
        if let Some(slot) = self.out.get_mut(at..at + 8) {
            slot.copy_from_slice(&len.to_le_bytes());
        }
    }
    fn class(&mut self, id: &ClassId, data: impl FnOnce(&mut W)) {
        self.begin(TC_CLASS);
        self.begin(TC_CLASS_UUID);
        self.bytes(id);
        self.end();
        self.begin(TC_CLASS_DATA);
        data(self);
        self.end();
        self.short(TC_CLASS_END, 0);
        self.end();
    }
    /// A compressed buffer (§5): raw up to 128 bytes, zlib-compressed above.
    fn buffer(&mut self, data: &[u8]) {
        self.u32(data.len() as u32);
        if data.is_empty() {
            return;
        }
        self.u32(crc32(0, data));
        if data.len() <= 128 {
            self.u8(0);
            self.bytes(data);
        } else {
            self.u8(1);
            self.begin(TC_ANONYMOUS);
            self.bytes(&miniz_oxide::deflate::compress_to_vec_zlib(data, 6));
            self.end();
        }
    }
}

/// A stable id from what is written, so a file written twice is the same bytes.
fn make_id(kind: &[u8], index: usize, name: &str) -> [u8; 16] {
    let a = crc32(0, kind);
    let b = crc32(a, &(index as u64).to_le_bytes());
    let c = crc32(b, name.as_bytes());
    let d = crc32(c, b"cadcraft");
    let mut id = [0u8; 16];
    for (i, v) in [a, b, c, d].iter().enumerate() {
        if let Some(s) = id.get_mut(i * 4..i * 4 + 4) {
            s.copy_from_slice(&v.to_le_bytes());
        }
    }
    // A random (version 4) id's variant and version bits.
    if let Some(b) = id.get_mut(7) {
        *b = (*b & 0x0F) | 0x40;
    }
    if let Some(b) = id.get_mut(8) {
        *b = (*b & 0x3F) | 0x80;
    }
    id
}

fn layer(w: &mut W, l: &Layer, position: usize) {
    w.u8(0x15); // 1.5: through the layer id
    w.i32(0); // normal mode
    w.i32(position as i32);
    w.i32(0); // IGES level
    w.i32(-1); // no render material
    w.i32(0);
    w.bytes(&[l.color[0], l.color[1], l.color[2], 0]);
    w.i16(0);
    w.i16(0);
    w.f64(0.0);
    w.f64(1.0);
    w.string(&l.name);
    w.u8(1); // visible
    w.i32(-1); // continuous linetype
    w.bytes(&[0, 0, 0, 0]); // plot colour
    w.f64(0.0); // default plot weight
    w.u8(0); // not locked
    w.bytes(&make_id(b"layer", position, &l.name));
}

fn mesh(w: &mut W, m: &Mesh) {
    let minor = if w.version >= 60 { 8 } else { 5 };
    w.u8(0x30 | minor);
    let v = m.vertices.len();
    w.i32(v as i32);
    w.i32(m.faces.len() as i32);
    for _ in 0..4 {
        w.f64(0.0);
        w.f64(1.0);
    }
    w.f64(0.0);
    w.f64(0.0);
    let (lo, hi) = bounds(&m.vertices);
    let (fl, fh) = if v > 0 { (lo.map(|x| (x as f32).floor()), hi.map(|x| (x as f32).ceil())) } else { ([1.0; 3], [-1.0; 3]) };
    for x in fl.iter().chain(fh.iter()) {
        w.f32(*x);
    }
    for _ in 0..10 {
        w.f32(0.0);
    }
    w.i32(-1); // closed: not known
    for _ in 0..5 {
        w.u8(0); // no mesh parameters, no curvature statistics
    }
    let width: u8 = if v < 256 {
        1
    } else if v < 65_536 {
        2
    } else {
        4
    };
    w.i32(i32::from(width));
    for f in &m.faces {
        for &i in f {
            match width {
                1 => w.u8(i as u8),
                2 => w.u16(i as u16),
                _ => w.u32(i),
            }
        }
    }
    let mut vb = Vec::with_capacity(v * 12);
    for p in &m.vertices {
        for x in p {
            vb.extend_from_slice(&(*x as f32).to_le_bytes());
        }
    }
    w.buffer(&vb);
    let mut nb = Vec::new();
    if m.normals.len() == v {
        for n in &m.normals {
            for x in n {
                nb.extend_from_slice(&x.to_le_bytes());
            }
        }
    }
    w.buffer(&nb);
    w.buffer(&[]); // texture coordinates
    w.buffer(&[]); // curvatures
    w.buffer(&[]); // colours
    w.i32(0); // packed texture rotation
    w.bytes(&[0; 16]); // no texture mapping
    if v > 0 {
        w.buffer(&[]); // surface parameters
    }
    // The mapping tag: its own chunk, version 1.1.
    w.begin(TC_ANONYMOUS);
    w.i32(1);
    w.i32(1);
    w.bytes(&[0; 16]);
    w.u32(0);
    for r in 0..4 {
        for c in 0..4 {
            w.f64(if r == c { 1.0 } else { 0.0 });
        }
    }
    w.u32(0);
    w.end();
    for _ in 0..3 {
        w.u8(0); // manifold, oriented, solid: not known
    }
    if minor >= 6 {
        w.u8(0); // no n-gons
        w.u8(0); // no double-precision vertices
        w.point(if v > 0 { lo } else { [1.0; 3] });
        w.point(if v > 0 { hi } else { [-1.0; 3] });
    }
}

fn bounds(pts: &[[f64; 3]]) -> ([f64; 3], [f64; 3]) {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in pts {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    (lo, hi)
}

fn curve_class(c: &Curve) -> ClassId {
    match c {
        Curve::Line { .. } => CLASS_LINE_CURVE,
        Curve::Arc { .. } => CLASS_ARC_CURVE,
        Curve::Polyline(_) => CLASS_POLYLINE_CURVE,
        Curve::Nurbs(_) => CLASS_NURBS_CURVE,
        Curve::Joined(_) => CLASS_POLY_CURVE,
    }
}

fn dist(a: [f64; 3], b: [f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

fn empty_box(w: &mut W) {
    w.point([1.0; 3]);
    w.point([-1.0; 3]);
}

fn curve(w: &mut W, c: &Curve) {
    match c {
        Curve::Line { from, to } => {
            w.u8(0x10);
            w.point(*from);
            w.point(*to);
            w.f64(0.0);
            w.f64(dist(*from, *to).max(1e-9));
            w.i32(3);
        }
        Curve::Arc { plane, radius, start, end } => {
            w.u8(0x10);
            w.point(plane.origin);
            w.point(plane.x);
            w.point(plane.y);
            w.point(plane.z);
            let o = plane.origin;
            let z = plane.z;
            w.point(z);
            w.f64(-(z[0] * o[0] + z[1] * o[1] + z[2] * o[2]));
            w.f64(*radius);
            for t in [0.0f64, std::f64::consts::FRAC_PI_2, std::f64::consts::PI] {
                let (c, s) = (t.cos() * radius, t.sin() * radius);
                w.point([o[0] + c * plane.x[0] + s * plane.y[0], o[1] + c * plane.x[1] + s * plane.y[1], o[2] + c * plane.x[2] + s * plane.y[2]]);
            }
            w.f64(*start);
            w.f64(*end);
            w.f64(0.0);
            w.f64((radius * (end - start)).max(1e-9));
            w.i32(3);
        }
        Curve::Polyline(pts) => {
            w.u8(0x10);
            w.i32(pts.len() as i32);
            for p in pts {
                w.point(*p);
            }
            w.i32(pts.len() as i32);
            let mut t = 0.0;
            let mut prev = pts.first().copied();
            for p in pts {
                if let Some(q) = prev {
                    t += dist(q, *p);
                }
                prev = Some(*p);
                w.f64(t);
            }
            w.i32(3);
        }
        Curve::Nurbs(n) => {
            let minor = u8::from(w.version >= 60);
            w.u8(0x10 | minor);
            let rational = !n.weights.is_empty();
            w.i32(3);
            w.i32(i32::from(rational));
            w.i32(n.order as i32);
            w.i32(n.points.len() as i32);
            w.i32(0);
            w.i32(0);
            empty_box(w);
            w.i32(n.knots.len() as i32);
            for k in &n.knots {
                w.f64(*k);
            }
            w.i32(n.points.len() as i32);
            for (i, p) in n.points.iter().enumerate() {
                let wt = if rational { n.weights.get(i).copied().unwrap_or(1.0) } else { 1.0 };
                w.point([p[0] * wt, p[1] * wt, p[2] * wt]);
                if rational {
                    w.f64(wt);
                }
            }
            if minor >= 1 {
                w.u8(0);
            }
        }
        Curve::Joined(segs) => {
            w.u8(0x10);
            w.i32(segs.len() as i32);
            w.i32(0);
            w.i32(0);
            empty_box(w);
            w.i32(segs.len() as i32 + 1);
            for i in 0..=segs.len() {
                w.f64(i as f64);
            }
            for s in segs {
                let id = curve_class(s);
                w.class(&id, |w| curve(w, s));
            }
        }
    }
}
