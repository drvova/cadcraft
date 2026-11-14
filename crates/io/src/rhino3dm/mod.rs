//! Rhino `.3dm` files: a reader for layers, object names, meshes and curves, and a writer for the
//! same subset.
//!
//! Written from CADCraft's own format note, `docs/formats/3dm.md` (the layout learned from
//! McNeel's openNURBS toolkit read as documentation; `docs/adr/0003-3dm.md`). Surfaces, breps,
//! extrusions and SubD objects are recognised and listed in [`Model::skipped`], never parsed.
//!
//! Input is hostile: every length is checked against the bytes that remain, counts are capped
//! ([`Limits`]), nesting is bounded ([`MAX_DEPTH`]) and nothing here panics.

mod read;
mod write;

#[cfg(test)]
mod tests;

pub use read::{Limits, read, read_with};
pub use write::write;

/// The archive versions the writer produces: 50 (Rhino 5), 60, 70 (Rhino 7) and 80 (Rhino 8).
pub const WRITE_VERSIONS: [u32; 4] = [50, 60, 70, 80];
/// Deepest nesting of chunks (and of joined curves inside joined curves) the reader follows.
pub const MAX_DEPTH: usize = 24;

/// What a `.3dm` file held, in the file's own units and frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Model {
    /// The archive version from the file's first 32 bytes (4, 50, 60, 70, 80 …).
    pub version: u32,
    /// The writing toolkit's version number from the properties table (0 when absent).
    pub toolkit: u64,
    /// The start section's free text (the writing application), trimmed.
    pub comment: String,
    /// The model's unit: (unit system code, millimetres per unit), when the file says.
    pub units: Option<(u32, f64)>,
    pub layers: Vec<Layer>,
    pub objects: Vec<Object>,
    /// Objects of kinds this reader does not take, by kind.
    pub skipped: Vec<Skipped>,
    /// What was damaged or left out, in words.
    pub notes: Vec<String>,
}

/// Millimetres per unit and the name of a unit system code (`docs/formats/3dm.md` §4), for the
/// codes with a fixed size.
pub fn unit(code: u32) -> Option<(f64, &'static str)> {
    Some(match code {
        1 => (1e-3, "microns"),
        2 => (1.0, "millimeters"),
        3 => (10.0, "centimeters"),
        4 => (1000.0, "meters"),
        5 => (1e6, "kilometers"),
        6 => (2.54e-5, "microinches"),
        7 => (0.0254, "mils"),
        8 => (25.4, "inches"),
        9 => (304.8, "feet"),
        10 => (1_609_344.0, "miles"),
        13 => (1e-6, "nanometers"),
        14 => (100.0, "decimeters"),
        _ => return None,
    })
}

/// A layer: its name, colour and the index objects refer to it by.
#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    pub name: String,
    /// Red, green, blue.
    pub color: [u8; 3],
    /// The index stored in the file (objects refer to layers by it).
    pub index: i32,
}

/// One object of the object table that this reader takes.
#[derive(Clone, Debug, PartialEq)]
pub struct Object {
    /// The object's name ("" when it has none).
    pub name: String,
    /// The layer index from the object's attributes.
    pub layer: i32,
    pub geometry: Geometry,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Geometry {
    Mesh(Mesh),
    Curve(Curve),
}

/// A polygon mesh: vertices and faces, each face a triangle (`c == d`) or a quad.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mesh {
    pub vertices: Vec<[f64; 3]>,
    /// Four vertex indices per face; a triangle repeats its third index.
    pub faces: Vec<[u32; 4]>,
    /// One per vertex, or empty.
    pub normals: Vec<[f32; 3]>,
}

impl Mesh {
    /// The faces as triangles (a quad `a b c d` is `a b c` and `a c d`).
    pub fn triangles(&self) -> Vec<[u32; 3]> {
        let mut out = Vec::with_capacity(self.faces.len().saturating_mul(2));
        for &[a, b, c, d] in &self.faces {
            out.push([a, b, c]);
            if c != d {
                out.push([a, c, d]);
            }
        }
        out
    }
}

/// A plane: origin and unit axes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plane {
    pub origin: [f64; 3],
    pub x: [f64; 3],
    pub y: [f64; 3],
    pub z: [f64; 3],
}

impl Plane {
    /// The world XY plane through `origin`.
    pub fn xy(origin: [f64; 3]) -> Plane {
        Plane { origin, x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0] }
    }
}

/// A NURBS curve in the file's convention: `order` = degree + 1 and
/// `points.len() + order − 2` knots (no superfluous end knots).
#[derive(Clone, Debug, PartialEq)]
pub struct Nurbs {
    /// 2 or 3.
    pub dimension: u32,
    pub order: u32,
    pub knots: Vec<f64>,
    /// Euclidean control points (already divided by their weights; z = 0 for a 2-D curve).
    pub points: Vec<[f64; 3]>,
    /// One per point, or empty when the curve is not rational.
    pub weights: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Curve {
    Line {
        from: [f64; 3],
        to: [f64; 3],
    },
    /// A circular arc in `plane`, from `start` to `end` radians about its origin from its x
    /// axis; a full circle spans 2π.
    Arc {
        plane: Plane,
        radius: f64,
        start: f64,
        end: f64,
    },
    Polyline(Vec<[f64; 3]>),
    Nurbs(Nurbs),
    /// Joined segments, in order.
    Joined(Vec<Curve>),
}

/// How many objects of one kind were left out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skipped {
    pub kind: String,
    pub count: usize,
}

// ------------------------------------------------------------------------------------------
// Format facts (docs/formats/3dm.md §3–§4)
// ------------------------------------------------------------------------------------------

pub(crate) const SIGNATURE: &[u8; 24] = b"3D Geometry File Format ";

pub(crate) const TC_SHORT: u32 = 0x8000_0000;
pub(crate) const TC_CRC: u32 = 0x0000_8000;

pub(crate) const TC_COMMENTBLOCK: u32 = 0x0000_0001;
pub(crate) const TC_ENDOFFILE: u32 = 0x0000_7FFF;
pub(crate) const TC_ENDOFTABLE: u32 = 0xFFFF_FFFF;
pub(crate) const TC_PROPERTIES_TABLE: u32 = 0x1000_0014;
pub(crate) const TC_SETTINGS_TABLE: u32 = 0x1000_0015;
pub(crate) const TC_SETTINGS_UNITSANDTOLS: u32 = 0x2000_8031;
pub(crate) const TC_LAYER_TABLE: u32 = 0x1000_0011;
pub(crate) const TC_OBJECT_TABLE: u32 = 0x1000_0013;
pub(crate) const TC_PROPERTIES_OPENNURBS_VERSION: u32 = 0xA000_0026;
pub(crate) const TC_LAYER_RECORD: u32 = 0x2000_8050;
pub(crate) const TC_OBJECT_RECORD: u32 = 0x2000_8070;
pub(crate) const TC_OBJECT_RECORD_TYPE: u32 = 0x8200_0071;
pub(crate) const TC_OBJECT_RECORD_ATTRIBUTES: u32 = 0x0200_8072;
pub(crate) const TC_OBJECT_RECORD_END: u32 = 0x8200_007F;
pub(crate) const TC_CLASS: u32 = 0x0002_7FFA;
pub(crate) const TC_CLASS_UUID: u32 = 0x0002_FFFB;
pub(crate) const TC_CLASS_DATA: u32 = 0x0002_FFFC;
pub(crate) const TC_CLASS_END: u32 = 0x8002_7FFF;
pub(crate) const TC_ANONYMOUS: u32 = 0x4000_8000;

/// Object types of `TC_OBJECT_RECORD_TYPE`.
pub(crate) const OT_CURVE: u64 = 4;
pub(crate) const OT_MESH: u64 = 0x20;

/// Class ids as the 16 bytes stored in a file.
pub(crate) type ClassId = [u8; 16];

/// The stored bytes of a class id given in its text form's numbers.
pub(crate) const fn class_id(d1: u32, d2: u16, d3: u16, d4: [u8; 8]) -> ClassId {
    let a = d1.to_le_bytes();
    let b = d2.to_le_bytes();
    let c = d3.to_le_bytes();
    [a[0], a[1], a[2], a[3], b[0], b[1], c[0], c[1], d4[0], d4[1], d4[2], d4[3], d4[4], d4[5], d4[6], d4[7]]
}

const MCNEEL_TAIL: [u8; 8] = [0xBF, 0xE5, 0x00, 0x10, 0x83, 0x01, 0x22, 0xF0];
pub(crate) const CLASS_LAYER: ClassId = class_id(0x9580_9813, 0xE985, 0x11d3, MCNEEL_TAIL);
pub(crate) const CLASS_MESH: ClassId = class_id(0x4ED7_D4E4, 0xE947, 0x11d3, MCNEEL_TAIL);
pub(crate) const CLASS_NURBS_CURVE: ClassId = class_id(0x4ED7_D4DD, 0xE947, 0x11d3, MCNEEL_TAIL);
pub(crate) const CLASS_POLYLINE_CURVE: ClassId = class_id(0x4ED7_D4E6, 0xE947, 0x11d3, MCNEEL_TAIL);
pub(crate) const CLASS_LINE_CURVE: ClassId = class_id(0x4ED7_D4DB, 0xE947, 0x11d3, MCNEEL_TAIL);
pub(crate) const CLASS_ARC_CURVE: ClassId = class_id(0xCF33_BE2A, 0x09B4, 0x11d4, [0xBF, 0xFB, 0x00, 0x10, 0x83, 0x01, 0x22, 0xF0]);
pub(crate) const CLASS_POLY_CURVE: ClassId = class_id(0x4ED7_D4E0, 0xE947, 0x11d3, MCNEEL_TAIL);

/// Kinds the reader recognises but leaves out, for the report.
pub(crate) const KNOWN_SKIPPED: [(ClassId, &str); 5] = [
    (class_id(0xC310_1A1D, 0xF157, 0x11d3, [0xBF, 0xE7, 0x00, 0x10, 0x83, 0x01, 0x22, 0xF0]), "point"),
    (class_id(0x4ED7_D4DE, 0xE947, 0x11d3, MCNEEL_TAIL), "NURBS surface"),
    (class_id(0x60B5_DBC5, 0xE660, 0x11d3, [0xBF, 0xE4, 0x00, 0x10, 0x83, 0x01, 0x22, 0xF0]), "brep (polysurface)"),
    (class_id(0x36F5_3175, 0x72B8, 0x4d47, [0xBF, 0x1F, 0xB4, 0xE6, 0xFC, 0x24, 0xF4, 0xB9]), "extrusion"),
    (class_id(0xF09B_A4D9, 0x455B, 0x42C3, [0xBA, 0x3B, 0xE6, 0xCC, 0xAC, 0xEF, 0x85, 0x3B]), "SubD"),
];

/// CRC-32 as zlib computes it (IEEE polynomial, reflected), continuing from `crc`.
pub(crate) fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    let mut c = !crc;
    for &b in bytes {
        // The index is one byte, so it is always inside the 256-entry table.
        let i = ((c ^ u32::from(b)) & 0xFF) as usize;
        c = CRC_TABLE.get(i).copied().unwrap_or(0) ^ (c >> 8);
    }
    !c
}

const CRC_TABLE: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { (c >> 1) ^ 0xEDB8_8320 } else { c >> 1 };
            k += 1;
        }
        t[n] = c;
        n += 1;
    }
    t
};
