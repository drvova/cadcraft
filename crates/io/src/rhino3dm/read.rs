//! Reading a `.3dm` file (`docs/formats/3dm.md`).

use super::*;
use crate::{IoError, Result};

/// Caps on what one file may make the reader allocate or loop over.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Objects taken from the object table (more are counted as skipped).
    pub max_objects: usize,
    /// Vertices (and faces) of one mesh.
    pub max_mesh_vertices: usize,
    /// Control points of one curve, segments of one joined curve.
    pub max_curve_points: usize,
    /// Bytes inflated from compressed buffers over the whole file.
    pub max_inflated: usize,
    /// Layers taken from the layer table.
    pub max_layers: usize,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            max_objects: 100_000,
            max_mesh_vertices: 8_000_000,
            max_curve_points: 1_000_000,
            max_inflated: 512 * 1024 * 1024,
            max_layers: 10_000,
        }
    }
}

/// Longest string (UTF-16 units) the reader takes for a name.
const MAX_STRING: usize = 65_536;
/// Highest NURBS order the reader takes (degree 63).
const MAX_ORDER: u32 = 64;

type R<T> = std::result::Result<T, String>;

/// Read a `.3dm` file with the default [`Limits`].
pub fn read(bytes: &[u8]) -> Result<Model> {
    read_with(bytes, &Limits::default())
}

/// Read a `.3dm` file. A damaged record is left out (and said so in [`Model::notes`]); a file
/// that is not a 3dm file, or whose start is damaged, is an error.
pub fn read_with(bytes: &[u8], limits: &Limits) -> Result<Model> {
    let err = |m: String| IoError::Format(format!("3dm: {m}"));
    let head = bytes.get(..32).ok_or_else(|| err("the file is too short to be a Rhino 3dm file".into()))?;
    if head.get(..24) != Some(&SIGNATURE[..]) {
        return Err(err("not a Rhino 3dm file (no \"3D Geometry File Format\" signature)".into()));
    }
    let version = parse_version(head.get(24..32).unwrap_or_default()).ok_or_else(|| err("the archive version is not a number".into()))?;
    if version < 2 {
        return Err(err(format!("archive version {version} (Rhino 1) is not supported")));
    }
    let mut rd = Reader { wide: version >= 50, limits: *limits, inflated: 0 };
    let mut model = Model { version, ..Model::default() };
    let mut cur = Cur::new(bytes.get(32..).unwrap_or_default());
    let first = rd.chunk(&mut cur).map_err(err)?;
    if first.tc != TC_COMMENTBLOCK {
        return Err(err("the start section is damaged (no comment block)".into()));
    }
    model.comment = comment_text(first.body);
    let mut tables = 0usize;
    while cur.left() > 0 {
        let c = match rd.chunk(&mut cur) {
            Ok(c) => c,
            Err(e) => {
                model.notes.push(format!("the file is damaged after {tables} tables ({e}); what came before was read"));
                break;
            }
        };
        tables += 1;
        match c.tc {
            TC_PROPERTIES_TABLE => {
                if let Some(v) = rd.toolkit_version(c.body) {
                    model.toolkit = v;
                }
            }
            TC_SETTINGS_TABLE => {
                if let Ok(chunks) = rd.chunks(c.body) {
                    model.units = chunks.iter().find(|k| k.tc == TC_SETTINGS_UNITSANDTOLS).and_then(|k| units(k.body));
                }
            }
            TC_LAYER_TABLE => rd.layers(c.body, &mut model),
            TC_OBJECT_TABLE => rd.objects(c.body, &mut model),
            TC_ENDOFFILE => break,
            _ => {}
        }
    }
    Ok(model)
}

fn parse_version(field: &[u8]) -> Option<u32> {
    let s = std::str::from_utf8(field).ok()?.trim_start_matches(' ');
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// The model units record (§4 Settings): (code, millimetres per unit), when it names a size.
fn units(body: &[u8]) -> Option<(u32, f64)> {
    let mut cur = Cur::new(body);
    let layout = cur.i32().ok()?;
    if !(100..200).contains(&layout) {
        return None;
    }
    let code = cur.u32().ok()?;
    if let Some((mm, _)) = unit(code) {
        return Some((code, mm));
    }
    if code == 0 || layout < 102 {
        return None;
    }
    cur.skip(8 * 3 + 4 * 2).ok()?;
    let m = cur.f64().ok()?;
    (m.is_finite() && m > 0.0 && m < 1e12).then_some((code, m * 1000.0))
}

fn comment_text(b: &[u8]) -> String {
    let s = String::from_utf8_lossy(b);
    let s: String = s.chars().filter(|c| *c != '\u{1a}' && *c != '\0').take(1000).collect();
    s.trim().to_string()
}

/// A chunk: its typecode, its value (the data of a short chunk, the length of a long one) and a
/// long chunk's content without its trailing CRC.
struct Chunk<'a> {
    tc: u32,
    value: i64,
    body: &'a [u8],
}

struct Cur<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Cur<'a> {
    fn new(b: &'a [u8]) -> Cur<'a> {
        Cur { b, p: 0 }
    }
    fn left(&self) -> usize {
        self.b.len().saturating_sub(self.p)
    }
    fn take(&mut self, n: usize) -> R<&'a [u8]> {
        let end = self.p.checked_add(n).ok_or("a length overflows")?;
        let s = self.b.get(self.p..end).ok_or_else(|| format!("{n} bytes needed, {} left", self.left()))?;
        self.p = end;
        Ok(s)
    }
    fn skip(&mut self, n: usize) -> R<()> {
        self.take(n).map(|_| ())
    }
    fn arr<const N: usize>(&mut self) -> R<[u8; N]> {
        let s = self.take(N)?;
        let mut a = [0u8; N];
        a.copy_from_slice(s);
        Ok(a)
    }
    fn u8(&mut self) -> R<u8> {
        Ok(self.arr::<1>()?[0])
    }
    fn u16(&mut self) -> R<u16> {
        Ok(u16::from_le_bytes(self.arr()?))
    }
    fn i32(&mut self) -> R<i32> {
        Ok(i32::from_le_bytes(self.arr()?))
    }
    fn u32(&mut self) -> R<u32> {
        Ok(u32::from_le_bytes(self.arr()?))
    }
    fn i64(&mut self) -> R<i64> {
        Ok(i64::from_le_bytes(self.arr()?))
    }
    fn f32(&mut self) -> R<f32> {
        Ok(f32::from_le_bytes(self.arr()?))
    }
    fn f64(&mut self) -> R<f64> {
        Ok(f64::from_le_bytes(self.arr()?))
    }
    /// A finite number.
    fn num(&mut self) -> R<f64> {
        let v = self.f64()?;
        if v.is_finite() { Ok(v) } else { Err("a number is not finite".into()) }
    }
    fn point(&mut self) -> R<[f64; 3]> {
        Ok([self.num()?, self.num()?, self.num()?])
    }
    /// A count that must be ≥ 0 and at most `max`.
    fn count(&mut self, max: usize, what: &str) -> R<usize> {
        let n = self.i32()?;
        let n = usize::try_from(n).map_err(|_| format!("a negative {what} count"))?;
        if n > max { Err(format!("{n} {what} (at most {max})")) } else { Ok(n) }
    }
    /// A wide (UTF-16) string.
    fn string(&mut self) -> R<String> {
        let n = self.u32()? as usize;
        if n > MAX_STRING || n.saturating_mul(2) > self.left() {
            return Err(format!("a string of {n} characters"));
        }
        let mut units = Vec::with_capacity(n);
        for _ in 0..n {
            units.push(self.u16()?);
        }
        let end = units.iter().position(|u| *u == 0).unwrap_or(units.len());
        Ok(String::from_utf16_lossy(units.get(..end).unwrap_or_default()))
    }
    /// A chunk version byte: (major, minor).
    fn version(&mut self) -> R<(u8, u8)> {
        let v = self.u8()?;
        Ok((v >> 4, v & 0x0F))
    }
}

struct Reader {
    /// 8-byte chunk values (archive 50 and later).
    wide: bool,
    limits: Limits,
    inflated: usize,
}

impl Reader {
    fn chunk<'a>(&self, cur: &mut Cur<'a>) -> R<Chunk<'a>> {
        let tc = cur.u32()?;
        let short = tc & TC_SHORT != 0;
        let value = if self.wide {
            cur.i64()?
        } else if short {
            i64::from(cur.i32()?)
        } else {
            i64::from(cur.u32()?)
        };
        if short {
            return Ok(Chunk { tc, value, body: &[] });
        }
        let len = usize::try_from(value).map_err(|_| format!("chunk {tc:#010x} has a negative length"))?;
        if len > cur.left() {
            return Err(format!("chunk {tc:#010x} says {len} bytes, {} left", cur.left()));
        }
        let content = cur.take(len)?;
        let body = if tc & TC_CRC != 0 { content.get(..len.saturating_sub(4)).unwrap_or_default() } else { content };
        Ok(Chunk { tc, value, body })
    }

    /// The chunks of `body`, in order, stopping at the first damaged one.
    fn chunks<'a>(&self, body: &'a [u8]) -> R<Vec<Chunk<'a>>> {
        let mut cur = Cur::new(body);
        let mut out = Vec::new();
        while cur.left() > 0 {
            let c = self.chunk(&mut cur)?;
            let end = c.tc == TC_ENDOFTABLE;
            out.push(c);
            if end {
                break;
            }
        }
        Ok(out)
    }

    fn toolkit_version(&self, body: &[u8]) -> Option<u64> {
        let chunks = self.chunks(body).ok()?;
        let c = chunks.iter().find(|c| c.tc == TC_PROPERTIES_OPENNURBS_VERSION)?;
        // The value is unsigned in the file.
        Some(if self.wide { c.value as u64 } else { u64::from(c.value as u32) })
    }

    fn layers(&mut self, body: &[u8], model: &mut Model) {
        let mut cur = Cur::new(body);
        let mut position = 0i32;
        while cur.left() > 0 {
            let c = match self.chunk(&mut cur) {
                Ok(c) => c,
                Err(e) => {
                    model.notes.push(format!("the layer table is damaged ({e}); {} layers were read", model.layers.len()));
                    return;
                }
            };
            if c.tc == TC_ENDOFTABLE {
                return;
            }
            if c.tc != TC_LAYER_RECORD {
                continue;
            }
            if model.layers.len() >= self.limits.max_layers {
                model.notes.push(format!("only the first {} layers were read", self.limits.max_layers));
                return;
            }
            match self.class(c.body).and_then(|(id, data)| if id == CLASS_LAYER { layer(data, position).map(Some) } else { Ok(None) }) {
                Ok(Some(l)) => model.layers.push(l),
                Ok(None) => {}
                Err(e) => model.notes.push(format!("layer {position} is damaged ({e}) and was left out")),
            }
            position = position.saturating_add(1);
        }
    }

    /// The openNURBS object (§4.1) at the start of `body`: its class id and its data.
    fn class<'a>(&self, body: &'a [u8]) -> R<(ClassId, &'a [u8])> {
        let c = self.chunk(&mut Cur::new(body))?;
        if c.tc != TC_CLASS {
            return Err(format!("expected an object, found chunk {:#010x}", c.tc));
        }
        self.class_of(c.body)
    }

    fn objects(&mut self, body: &[u8], model: &mut Model) {
        let mut cur = Cur::new(body);
        let mut position = 0usize;
        let mut over = 0usize;
        while cur.left() > 0 {
            let c = match self.chunk(&mut cur) {
                Ok(c) => c,
                Err(e) => {
                    model.notes.push(format!("the object table is damaged ({e}); {} objects were read", model.objects.len()));
                    break;
                }
            };
            if c.tc == TC_ENDOFTABLE {
                break;
            }
            if c.tc != TC_OBJECT_RECORD {
                continue;
            }
            position += 1;
            if model.objects.len() >= self.limits.max_objects {
                over += 1;
                continue;
            }
            match self.object(c.body) {
                Ok(Taken::Object(o)) => model.objects.push(o),
                Ok(Taken::Skipped(kind)) => add_skipped(&mut model.skipped, kind),
                Err(e) => model.notes.push(format!("object {position} is damaged ({e}) and was left out")),
            }
        }
        if over > 0 {
            model.notes.push(format!("{over} objects past the first {} were left out", self.limits.max_objects));
        }
    }

    fn object(&mut self, body: &[u8]) -> R<Taken> {
        let mut object_type = None;
        let mut class = None;
        let mut name = String::new();
        let mut layer_index = 0;
        for c in self.chunks(body)? {
            match c.tc {
                TC_OBJECT_RECORD_TYPE => object_type = Some(c.value as u64 & 0xFFFF_FFFF),
                TC_CLASS => class = Some(c.body),
                TC_OBJECT_RECORD_ATTRIBUTES => {
                    // A damaged attribute block keeps the geometry on layer 0, unnamed.
                    if let Ok((n, l)) = attributes(c.body) {
                        name = n;
                        layer_index = l;
                    }
                }
                TC_OBJECT_RECORD_END => break,
                _ => {}
            }
        }
        let class_body = class.ok_or("an object record without an object")?;
        let (id, data) = self.class_of(class_body)?;
        let geometry = if id == CLASS_MESH {
            Geometry::Mesh(self.mesh(data)?)
        } else {
            match self.curve(&id, data, 0)? {
                Some(c) => Geometry::Curve(c),
                None => {
                    let kind = KNOWN_SKIPPED.iter().find(|(k, _)| *k == id).map(|(_, n)| (*n).to_string()).unwrap_or_else(|| match object_type {
                        Some(OT_CURVE) => "curve of another kind".to_string(),
                        Some(OT_MESH) => "mesh of another kind".to_string(),
                        Some(t) => format!("object type {t:#x}"),
                        None => "unknown object".to_string(),
                    });
                    return Ok(Taken::Skipped(kind));
                }
            }
        };
        Ok(Taken::Object(Object { name, layer: layer_index, geometry }))
    }

    /// The class id and data inside a class chunk's content.
    fn class_of<'a>(&self, class_body: &'a [u8]) -> R<(ClassId, &'a [u8])> {
        let mut id = None;
        let mut data = None;
        for k in self.chunks(class_body)? {
            match k.tc {
                TC_CLASS_UUID => id = Some(Cur::new(k.body).arr::<16>()?),
                TC_CLASS_DATA => data = Some(k.body),
                TC_CLASS_END => break,
                _ => {}
            }
        }
        match (id, data) {
            (Some(id), Some(data)) => Ok((id, data)),
            _ => Err("an object without its class id or data".into()),
        }
    }

    fn mesh(&mut self, data: &[u8]) -> R<Mesh> {
        let mut cur = Cur::new(data);
        let (major, _minor) = cur.version()?;
        if major != 3 {
            return Err(format!("mesh layout {major}.x is not supported (only the compressed layout 3.x)"));
        }
        let max = self.limits.max_mesh_vertices;
        let v = cur.count(max, "vertices")?;
        let f = cur.count(max.saturating_mul(2), "faces")?;
        // Texture and surface domains (4 intervals), surface scale, three legacy float boxes.
        cur.skip(8 * 8 + 2 * 8 + (6 + 6 + 4) * 4)?;
        let _closed = cur.i32()?;
        // Mesh parameters, then four curvature statistics, each behind a presence byte.
        for _ in 0..5 {
            if cur.u8()? != 0 {
                self.chunk(&mut cur)?;
            }
        }
        let size = cur.i32()?;
        let width = match size {
            1 | 2 | 4 => size as usize,
            _ if f == 0 => 1,
            _ => return Err(format!("face index size {size}")),
        };
        let need = f.checked_mul(4 * width).ok_or("the face array overflows")?;
        if need > cur.left() {
            return Err(format!("{f} faces need {need} bytes, {} left", cur.left()));
        }
        let mut faces = Vec::with_capacity(f);
        for _ in 0..f {
            let mut q = [0u32; 4];
            for i in q.iter_mut() {
                *i = match width {
                    1 => u32::from(cur.u8()?),
                    2 => u32::from(cur.u16()?),
                    _ => cur.u32()?,
                };
                if *i as usize >= v {
                    return Err(format!("a face refers to vertex {} of {v}", *i));
                }
            }
            faces.push(q);
        }
        let mut vertices = Vec::new();
        if v > 0 {
            let raw = self.buffer(&mut cur, v * 12)?;
            if raw.len() != v * 12 {
                return Err(format!("{} vertex bytes for {v} vertices", raw.len()));
            }
            vertices.reserve(v);
            for p in raw.chunks_exact(12) {
                let mut c = Cur::new(p);
                let q = [f64::from(c.f32()?), f64::from(c.f32()?), f64::from(c.f32()?)];
                if !q.iter().all(|x| x.is_finite()) {
                    return Err("a vertex is not finite".into());
                }
                vertices.push(q);
            }
        }
        let mut normals = Vec::new();
        // Normals are optional; a damaged normal buffer only loses the normals.
        if v > 0
            && let Ok(raw) = self.buffer(&mut cur, v * 12)
            && raw.len() == v * 12
        {
            for p in raw.chunks_exact(12) {
                let mut c = Cur::new(p);
                normals.push([c.f32()?, c.f32()?, c.f32()?]);
            }
        }
        Ok(Mesh { vertices, faces, normals })
    }

    /// A compressed buffer (§5) of at most `max` bytes.
    fn buffer(&mut self, cur: &mut Cur, max: usize) -> R<Vec<u8>> {
        let size = cur.u32()? as usize;
        if size == 0 {
            return Ok(Vec::new());
        }
        if size > max {
            return Err(format!("a buffer of {size} bytes where at most {max} belong"));
        }
        let total = self.inflated.saturating_add(size);
        if total > self.limits.max_inflated {
            return Err(format!("the file inflates past {} MiB", self.limits.max_inflated / (1024 * 1024)));
        }
        let crc = cur.u32()?;
        let out = match cur.u8()? {
            0 => cur.take(size)?.to_vec(),
            1 => {
                let c = self.chunk(cur)?;
                if c.tc != TC_ANONYMOUS {
                    return Err("a compressed buffer without its data chunk".into());
                }
                miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(c.body, size)
                    .map_err(|_| "a compressed buffer does not inflate".to_string())?
            }
            m => return Err(format!("compression method {m}")),
        };
        if out.len() != size {
            return Err(format!("a buffer inflates to {} bytes, not {size}", out.len()));
        }
        if crc32(0, &out) != crc {
            return Err("a compressed buffer fails its CRC".into());
        }
        self.inflated = total;
        Ok(out)
    }

    /// A curve of a class this reader takes, or `None` for another class.
    fn curve(&mut self, id: &ClassId, data: &[u8], depth: usize) -> R<Option<Curve>> {
        if depth > MAX_DEPTH {
            return Err("joined curves nest too deep".into());
        }
        let mut cur = Cur::new(data);
        let max = self.limits.max_curve_points;
        Ok(Some(if *id == CLASS_LINE_CURVE {
            major1(&mut cur)?;
            Curve::Line { from: cur.point()?, to: cur.point()? }
        } else if *id == CLASS_ARC_CURVE {
            major1(&mut cur)?;
            let plane = plane(&mut cur)?;
            let radius = cur.num()?;
            for _ in 0..3 {
                cur.point()?;
            }
            let (start, end) = (cur.num()?, cur.num()?);
            if radius <= 0.0 || end <= start {
                return Err("an arc with no radius or no angle".into());
            }
            Curve::Arc { plane, radius, start, end }
        } else if *id == CLASS_POLYLINE_CURVE {
            major1(&mut cur)?;
            let n = cur.count(max, "polyline points")?;
            if n.saturating_mul(24) > cur.left() {
                return Err(format!("{n} points need more bytes than are left"));
            }
            let mut pts = Vec::with_capacity(n);
            for _ in 0..n {
                pts.push(cur.point()?);
            }
            if pts.len() < 2 {
                return Err("a polyline with fewer than two points".into());
            }
            Curve::Polyline(pts)
        } else if *id == CLASS_NURBS_CURVE {
            Curve::Nurbs(nurbs(&mut cur, max)?)
        } else if *id == CLASS_POLY_CURVE {
            major1(&mut cur)?;
            let n = cur.count(max.min(100_000), "segments")?;
            cur.skip(8 + 48)?;
            let m = cur.count(max, "segment parameters")?;
            cur.skip(m.checked_mul(8).ok_or("overflow")?)?;
            let mut segs = Vec::with_capacity(n.min(1024));
            for _ in 0..n {
                let c = self.chunk(&mut cur)?;
                if c.tc != TC_CLASS {
                    return Err("a joined curve's segment is not an object".into());
                }
                let (sid, sdata) = self.class_of(c.body)?;
                match self.curve(&sid, sdata, depth + 1)? {
                    Some(s) => segs.push(s),
                    None => return Err("a joined curve has a segment of a kind not read".into()),
                }
            }
            if segs.is_empty() {
                return Err("a joined curve without segments".into());
            }
            Curve::Joined(segs)
        } else {
            return Ok(None);
        }))
    }
}

enum Taken {
    Object(Object),
    Skipped(String),
}

fn add_skipped(list: &mut Vec<Skipped>, kind: String) {
    match list.iter_mut().find(|s| s.kind == kind) {
        Some(s) => s.count += 1,
        None => list.push(Skipped { kind, count: 1 }),
    }
}

fn major1(cur: &mut Cur) -> R<()> {
    match cur.version()? {
        (1, _) => Ok(()),
        (m, _) => Err(format!("curve layout {m}.x is not supported")),
    }
}

fn plane(cur: &mut Cur) -> R<Plane> {
    let p = Plane { origin: cur.point()?, x: cur.point()?, y: cur.point()?, z: cur.point()? };
    for _ in 0..4 {
        cur.num()?;
    }
    Ok(p)
}

fn nurbs(cur: &mut Cur, max: usize) -> R<Nurbs> {
    major1(cur)?;
    let dim = cur.i32()?;
    let rational = cur.i32()?;
    let order = cur.i32()?;
    let n = cur.i32()?;
    let dimension = match dim {
        2 | 3 => dim as u32,
        _ => return Err(format!("a curve of dimension {dim}")),
    };
    let rational = match rational {
        0 => false,
        1 => true,
        _ => return Err("a rational flag that is neither 0 nor 1".into()),
    };
    let order = u32::try_from(order).ok().filter(|o| (2..=MAX_ORDER).contains(o)).ok_or_else(|| format!("NURBS order {order}"))?;
    let n = usize::try_from(n).ok().filter(|n| *n >= order as usize && *n <= max).ok_or_else(|| format!("{n} control points for order {order}"))?;
    cur.skip(8 + 48)?;
    let want = n + order as usize - 2;
    let k = cur.count(max.saturating_add(MAX_ORDER as usize), "knots")?;
    if k != want {
        return Err(format!("{k} knots where {want} belong"));
    }
    let mut knots = Vec::with_capacity(k);
    for _ in 0..k {
        knots.push(cur.num()?);
    }
    if knots.windows(2).any(|w| matches!(w, [a, b] if b < a)) {
        return Err("the knots decrease".into());
    }
    if cur.count(max, "control points")? != n {
        return Err("the control point counts disagree".into());
    }
    let size = dimension as usize + usize::from(rational);
    if n.saturating_mul(size * 8) > cur.left() {
        return Err(format!("{n} control points need more bytes than are left"));
    }
    let mut points = Vec::with_capacity(n);
    let mut weights = Vec::new();
    for _ in 0..n {
        let x = cur.num()?;
        let y = cur.num()?;
        let z = if dimension == 3 { cur.num()? } else { 0.0 };
        if rational {
            let w = cur.num()?;
            if w.abs() < 1e-300 {
                return Err("a control point of weight 0".into());
            }
            points.push([x / w, y / w, z / w]);
            weights.push(w);
        } else {
            points.push([x, y, z]);
        }
    }
    Ok(Nurbs { dimension, order, knots, points, weights })
}

fn layer(data: &[u8], position: i32) -> R<Layer> {
    let mut cur = Cur::new(data);
    match cur.version()? {
        (1, _) => {}
        (m, _) => return Err(format!("layer layout {m}.x is not supported")),
    }
    let _mode = cur.i32()?;
    let index = cur.i32()?;
    let _iges = cur.i32()?;
    let _material = cur.i32()?;
    let _obsolete = cur.i32()?;
    let c = cur.arr::<4>()?;
    cur.skip(2 + 2 + 8 + 8)?;
    let name = cur.string()?;
    Ok(Layer { name, color: [c[0], c[1], c[2]], index: if index >= 0 { index } else { position } })
}

/// An object's name and layer index from its attributes (§4.2).
fn attributes(data: &[u8]) -> R<(String, i32)> {
    let mut cur = Cur::new(data);
    let (major, _) = cur.version()?;
    match major {
        2 => {
            cur.skip(16)?;
            let layer = cur.i32()?;
            let name = if cur.u8()? == 1 { cur.string()? } else { String::new() };
            Ok((name, layer))
        }
        1 => {
            cur.skip(16)?;
            let layer = cur.i32()?;
            cur.skip(4 + 4 + 2 + 2 + 8 + 8 + 4 + 4)?;
            Ok((cur.string()?, layer))
        }
        m => Err(format!("attribute layout {m}.x")),
    }
}
