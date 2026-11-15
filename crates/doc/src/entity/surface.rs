//! Free-form objects: NURBS surfaces (optionally trimmed) and SubD (Catmull–Clark) objects.
//!
//! Both are stored as plain data (control net, knots, weights, trim loops; cage, creases,
//! corners), so they serialise with the drawing and its undo history, and are rebuilt into the
//! `cadcraft_geom` kernel types when they are evaluated. Everything that rebuilds validates, so a
//! hostile object read from a file is an error, never a panic. Neither has a DXF entity of its own
//! (DXF's SURFACE is ACIS data): the DXF writer keeps them in CADCraft's own XRECORD and reports
//! them as not exported to other programs.

use std::collections::{BTreeMap, BTreeSet};

use cadcraft_geom::{
    LimitOptions, Mat3, NurbsSurface, SHARP, SubdCage, SubdError, SubdMesh, SurfaceError, SurfaceMesh, TessOptions, Vec2, Vec3, limit_mesh,
    limit_positions, point_in_trims, subdivide_levels, surface_trim, tessellate_trimmed,
};
use serde::{Deserialize, Serialize};

/// Isocurves drawn in each direction of a surface's wireframe (besides its edges).
pub const SURFACE_ISOCURVES: usize = 5;
/// Samples along one isocurve or edge of the wireframe.
const ISO_SAMPLES: usize = 48;
/// Crease sharpness at or above this is stored for [`SHARP`] (JSON has no infinity).
pub const SHARP_STORED: f64 = 1.0e6;
/// Most display levels of a SubD object.
pub const MAX_SUBD_DISPLAY_LEVEL: u32 = 4;
/// A SubD's wireframe shows the subdivided cage up to this many faces, else the control cage.
const SUBD_WIRE_FACES: usize = 20_000;

/// A NURBS surface: degree, knots and the control net (row-major, `points[i · count_v + j]`),
/// weights (empty = all 1), and trim loops in parameter space (none = untrimmed; even–odd).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Surface {
    pub degree_u: usize,
    pub degree_v: usize,
    pub knots_u: Vec<f64>,
    pub knots_v: Vec<f64>,
    pub count_u: usize,
    pub count_v: usize,
    pub points: Vec<Vec3>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weights: Vec<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trims: Vec<Vec<Vec2>>,
}

impl Surface {
    /// A surface from a kernel surface and its trim loops in parameter space (empty =
    /// untrimmed; even–odd). The loops are validated (counts, finiteness). For readers such as
    /// `.3dm`: `EntityKind::Surface(Surface::new(&s, loops)?)`.
    pub fn new(s: &NurbsSurface, trims: Vec<Vec<Vec2>>) -> Result<Surface, SurfaceError> {
        surface_trim::validate_trims(&trims)?;
        let mut f = Surface::from_nurbs(s);
        f.trims = trims;
        Ok(f)
    }

    /// The plain data of a kernel surface (untrimmed).
    pub fn from_nurbs(s: &NurbsSurface) -> Surface {
        let weights = if s.is_rational() { s.weights().to_vec() } else { Vec::new() };
        Surface {
            degree_u: s.degree_u(),
            degree_v: s.degree_v(),
            knots_u: s.knots_u().to_vec(),
            knots_v: s.knots_v().to_vec(),
            count_u: s.count_u(),
            count_v: s.count_v(),
            points: s.points().to_vec(),
            weights,
            trims: Vec::new(),
        }
    }

    /// The kernel surface (validated; the trims are checked too).
    pub fn nurbs(&self) -> Result<NurbsSurface, SurfaceError> {
        surface_trim::validate_trims(&self.trims)?;
        NurbsSurface::new(
            self.degree_u,
            self.degree_v,
            self.knots_u.clone(),
            self.knots_v.clone(),
            self.count_u,
            self.count_v,
            self.points.clone(),
            self.weights.clone(),
        )
    }

    pub fn is_trimmed(&self) -> bool {
        !self.trims.is_empty()
    }

    /// Whether parameter point `(u, v)` is kept by the trims.
    pub fn keeps(&self, u: f64, v: f64) -> bool {
        point_in_trims(&self.trims, Vec2::new(u, v))
    }

    /// Triangles of the (trimmed) surface.
    pub fn mesh(&self, opts: &TessOptions) -> Result<SurfaceMesh, SurfaceError> {
        tessellate_trimmed(&self.nurbs()?, &self.trims, opts)
    }

    /// Area (trimmed surfaces: over the kept region, to the tolerance in `opts`).
    pub fn area(&self, opts: &TessOptions) -> Result<f64, SurfaceError> {
        surface_trim::trimmed_area(&self.nurbs()?, &self.trims, opts)
    }

    /// Enclosed volume of a closed untrimmed surface (quadrature).
    pub fn volume(&self) -> Result<f64, SurfaceError> {
        if self.is_trimmed() {
            return Err(SurfaceError::NotClosed);
        }
        self.nurbs()?.volume()
    }

    /// The wireframe: the edges (or the trim loops) and isocurves, as 3D polylines clipped to
    /// the trims. Empty when the surface is invalid.
    pub fn wires(&self) -> Vec<Vec<Vec3>> {
        let Ok(s) = self.nurbs() else { return Vec::new() };
        let (u0, u1) = s.domain_u();
        let (v0, v1) = s.domain_v();
        let mut out: Vec<Vec<Vec3>> = Vec::new();
        let line = |a: Vec2, b: Vec2, out: &mut Vec<Vec<Vec3>>, clip: bool| {
            let mut run: Vec<Vec3> = Vec::new();
            for k in 0..=ISO_SAMPLES {
                let p = a.lerp(b, k as f64 / ISO_SAMPLES as f64);
                if !clip || self.keeps(p.x, p.y) {
                    run.push(s.point(p.x, p.y));
                } else if run.len() > 1 {
                    out.push(std::mem::take(&mut run));
                } else {
                    run.clear();
                }
            }
            if run.len() > 1 {
                out.push(run);
            }
        };
        let trimmed = self.is_trimmed();
        // Edges: the parameter rectangle (untrimmed) or the trim loops.
        if trimmed {
            for l in &self.trims {
                let mut pts: Vec<Vec3> = l.iter().map(|p| s.point(p.x, p.y)).collect();
                if let Some(f) = pts.first().copied() {
                    pts.push(f);
                }
                out.push(pts);
            }
        } else {
            let c = [Vec2::new(u0, v0), Vec2::new(u1, v0), Vec2::new(u1, v1), Vec2::new(u0, v1)];
            for i in 0..4 {
                line(c[i], c[(i + 1) % 4], &mut out, false);
            }
        }
        for k in 1..=SURFACE_ISOCURVES {
            let t = k as f64 / (SURFACE_ISOCURVES + 1) as f64;
            let u = u0 + (u1 - u0) * t;
            let v = v0 + (v1 - v0) * t;
            line(Vec2::new(u, v0), Vec2::new(u, v1), &mut out, trimmed);
            line(Vec2::new(u0, v), Vec2::new(u1, v), &mut out, trimmed);
        }
        out
    }

    /// Snap points: the corners and edge midpoints (untrimmed), the trim loops' vertices
    /// (trimmed, at most 64 per loop), and the middle of the domain when it is kept.
    pub fn snap_points(&self) -> Vec<Vec3> {
        let Ok(s) = self.nurbs() else { return Vec::new() };
        let (u0, u1) = s.domain_u();
        let (v0, v1) = s.domain_v();
        let (um, vm) = ((u0 + u1) / 2.0, (v0 + v1) / 2.0);
        let mut out = Vec::new();
        if self.is_trimmed() {
            for l in &self.trims {
                let step = (l.len() / 64).max(1);
                out.extend(l.iter().step_by(step).map(|p| s.point(p.x, p.y)));
            }
        } else {
            for (u, v) in [(u0, v0), (u1, v0), (u1, v1), (u0, v1), (um, v0), (u1, vm), (um, v1), (u0, vm)] {
                out.push(s.point(u, v));
            }
        }
        if self.keeps(um, vm) {
            out.push(s.point(um, vm));
        }
        out
    }

    /// Whether the middle of the parameter domain is kept (it is then the last snap point).
    pub fn keeps_middle(&self) -> bool {
        let Ok(s) = self.nurbs() else { return false };
        let (u0, u1) = s.domain_u();
        let (v0, v1) = s.domain_v();
        self.keeps((u0 + u1) / 2.0, (v0 + v1) / 2.0)
    }

    /// Bounds of the control net (the surface lies inside its convex hull).
    pub fn bounds3(&self) -> Option<(Vec3, Vec3)> {
        bounds3(&self.points)
    }

    /// Apply a drawing transform (2D affine in XY; Z scales by the transform's scale factor).
    pub fn transform(&mut self, m: &Mat3) {
        let s = m.scale_factor();
        for p in &mut self.points {
            *p = transform3(m, s, *p);
        }
        // A mirror turns the surface inside out; swapping nothing keeps the parameter space (and
        // its trims) valid, and the normals flip with the mirror as a solid's would.
    }
}

/// A SubD object: the control cage (positions and faces), creases (edge, sharpness; sharp edges
/// are stored as [`SHARP_STORED`]), corner-tagged vertices and the display level.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubD {
    pub positions: Vec<Vec3>,
    pub faces: Vec<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub creases: Vec<SubdCrease>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub corners: Vec<u32>,
    #[serde(default = "two")]
    pub level: u32,
}

fn two() -> u32 {
    2
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct SubdCrease {
    pub a: u32,
    pub b: u32,
    pub sharpness: f64,
}

impl SubD {
    /// The plain data of a kernel cage.
    pub fn from_cage(c: &SubdCage, level: u32) -> SubD {
        SubD {
            positions: c.positions().to_vec(),
            faces: c.faces(),
            creases: c
                .creases()
                .iter()
                .map(|(&(a, b), &s)| SubdCrease { a, b, sharpness: if s.is_finite() { s.min(SHARP_STORED) } else { SHARP_STORED } })
                .collect(),
            corners: c.corners().iter().copied().collect(),
            level: level.clamp(1, MAX_SUBD_DISPLAY_LEVEL),
        }
    }

    /// The kernel cage (validated).
    pub fn cage(&self) -> Result<SubdCage, SubdError> {
        let mut creases = BTreeMap::new();
        for c in &self.creases {
            if c.sharpness.is_nan() || c.sharpness < 0.0 {
                return Err(SubdError::BadParam("crease sharpness must be 0 or more".into()));
            }
            let s = if c.sharpness >= SHARP_STORED { SHARP } else { c.sharpness };
            creases.insert(cadcraft_geom::edge_key(c.a, c.b), s);
        }
        let corners: BTreeSet<u32> = self.corners.iter().copied().collect();
        SubdCage::with_tags(self.positions.clone(), &self.faces, creases, corners)
    }

    /// The display level, made safe.
    pub fn display_level(&self) -> u32 {
        self.level.clamp(1, MAX_SUBD_DISPLAY_LEVEL)
    }

    /// The limit surface's triangles at `levels` (at least the display level's need for creases).
    pub fn mesh(&self, levels: u32) -> Result<SubdMesh, SubdError> {
        let cage = self.cage()?;
        let need = cage.max_finite_sharpness().ceil().clamp(1.0, f64::from(MAX_SUBD_DISPLAY_LEVEL + 2)) as u32;
        limit_mesh(&cage, LimitOptions { levels: levels.max(need).clamp(1, MAX_SUBD_DISPLAY_LEVEL + 2) })
    }

    /// The wireframe: the edges of the once-subdivided cage at their limit positions (the
    /// control cage's edges for a very large cage, or when the limit cannot be computed).
    pub fn wires(&self) -> Vec<Vec<Vec3>> {
        let Ok(cage) = self.cage() else { return Vec::new() };
        let edges_of = |c: &SubdCage, pos: &[Vec3]| -> Vec<Vec<Vec3>> {
            c.edges().iter().filter_map(|&(a, b)| Some(vec![*pos.get(a as usize)?, *pos.get(b as usize)?])).collect()
        };
        if cage.face_count() * 4 <= SUBD_WIRE_FACES
            && let Ok(sub) = subdivide_levels(&cage, 1)
            && sub.max_finite_sharpness() == 0.0
            && let Ok(limit) = limit_positions(&sub)
        {
            return edges_of(&sub, &limit);
        }
        edges_of(&cage, cage.positions())
    }

    /// Snap points: the limit positions of the cage's vertices (their cage positions when the
    /// limit cannot be computed) and the midpoints of the cage's edges at the limit.
    pub fn snap_points(&self) -> Vec<Vec3> {
        let Ok(cage) = self.cage() else { return Vec::new() };
        if let Ok(sub) = subdivide_levels(&cage, 1)
            && let Ok(limit) = limit_positions(&sub)
        {
            // Old vertices keep their indices, then the edge points (one per cage edge).
            let n = cage.vertex_count() + cage.edge_count();
            return limit.into_iter().take(n).collect();
        }
        cage.positions().to_vec()
    }

    pub fn bounds3(&self) -> Option<(Vec3, Vec3)> {
        bounds3(&self.positions)
    }

    pub fn transform(&mut self, m: &Mat3) {
        let s = m.scale_factor();
        for p in &mut self.positions {
            *p = transform3(m, s, *p);
        }
        if m.is_mirroring() {
            // A mirror reverses every face's winding; reverse them back so the cage stays
            // outward-facing.
            for f in &mut self.faces {
                f.reverse();
            }
        }
    }
}

fn transform3(m: &Mat3, s: f64, p: Vec3) -> Vec3 {
    let q = m.apply(p.xy());
    Vec3::new(q.x, q.y, p.z * s)
}

fn bounds3(pts: &[Vec3]) -> Option<(Vec3, Vec3)> {
    let mut it = pts.iter().filter(|p| p.is_finite());
    let f = *it.next()?;
    let (mut lo, mut hi) = (f, f);
    for p in it {
        lo = Vec3::new(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z));
        hi = Vec3::new(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z));
    }
    Some((lo, hi))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cadcraft_geom::subd_edit::box_cage;

    fn plane() -> Surface {
        Surface::from_nurbs(
            &NurbsSurface::bilinear(Vec3::ZERO, Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 10.0, 0.0), Vec3::new(10.0, 10.0, 0.0)).unwrap(),
        )
    }

    #[test]
    fn surface_round_trips_through_json_and_rebuilds() {
        let s = plane();
        let j = serde_json::to_string(&s).unwrap();
        let back: Surface = serde_json::from_str(&j).unwrap();
        assert_eq!(back, s);
        assert!((back.area(&TessOptions::default()).unwrap() - 100.0).abs() < 1e-9);
        assert!(!s.wires().is_empty());
        assert_eq!(s.snap_points().len(), 9);
    }

    #[test]
    fn trimmed_area_removes_the_hole() {
        let mut s = plane();
        let outer = vec![Vec2::new(0.0, 0.0), Vec2::new(1.0, 0.0), Vec2::new(1.0, 1.0), Vec2::new(0.0, 1.0)];
        let hole: Vec<Vec2> = (0..256)
            .map(|k| {
                let a = std::f64::consts::TAU * k as f64 / 256.0;
                Vec2::new(0.5 + 0.25 * a.cos(), 0.5 + 0.25 * a.sin())
            })
            .collect();
        s.trims = vec![outer, hole];
        let a = s.area(&TessOptions { chord_tol: 0.01, ..TessOptions::default() }).unwrap();
        let want = 100.0 - std::f64::consts::PI * 2.5 * 2.5;
        assert!((a - want).abs() / want < 2e-3, "{a} vs {want}");
        assert!(!s.keeps(0.5, 0.5) && s.keeps(0.1, 0.1));
    }

    #[test]
    fn hostile_surface_data_is_an_error() {
        let mut s = plane();
        s.count_u = 1 << 40;
        assert!(s.nurbs().is_err());
        assert!(s.wires().is_empty() && s.snap_points().is_empty());
        let mut s = plane();
        s.points[0].x = f64::NAN;
        assert!(s.nurbs().is_err());
        let mut s = plane();
        s.trims = vec![vec![Vec2::new(0.0, 0.0)]];
        assert!(s.mesh(&TessOptions::default()).is_err());
    }

    #[test]
    fn subd_round_trips_and_keeps_sharp_creases() {
        let c = cadcraft_geom::subd_edit::crease_all(&box_cage(2.0, 2.0, 2.0).unwrap(), SHARP).unwrap();
        let d = SubD::from_cage(&c, 2);
        let j = serde_json::to_string(&d).unwrap();
        let back: SubD = serde_json::from_str(&j).unwrap();
        let m = back.mesh(3).unwrap();
        assert!(m.closed);
        let v = m.volume().unwrap();
        assert!((v - 8.0).abs() < 1e-6, "{v}");
        assert!(!back.wires().is_empty());
        let mut bad = back.clone();
        bad.faces[0][0] = 99;
        assert!(bad.cage().is_err() && bad.wires().is_empty());
    }
}
