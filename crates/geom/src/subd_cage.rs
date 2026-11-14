//! The SubD control cage: a polygon mesh of quads and n-gons with half-edge topology, per-edge
//! crease sharpness and per-vertex corner tags.
//!
//! A cage is always valid once built: every face has 3 to [`MAX_FACE_SIDES`] distinct vertices,
//! every edge has one or two faces, the faces are consistently oriented (each directed edge is
//! used once), every vertex is manifold (its faces form one fan), no vertex is unused, no face has
//! zero area and every coordinate is finite. [`SubdCage::new`] checks all of that and returns a
//! [`SubdError`] instead of panicking; every edit builds its result through it again.

use crate::Vec3;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;

/// Most vertices a cage may hold.
pub const MAX_CAGE_VERTICES: usize = 2_000_000;
/// Most faces a cage may hold (subdivision refuses to produce more).
pub const MAX_CAGE_FACES: usize = 1_000_000;
/// Most sides of one face.
pub const MAX_FACE_SIDES: usize = 1024;
/// Sharpness at or above this is treated as infinitely sharp.
pub const SHARP: f64 = f64::INFINITY;

const NONE: u32 = u32::MAX;

/// Why a cage, or an operation on one, was refused.
#[derive(Clone, Debug, PartialEq)]
pub enum SubdError {
    /// The cage has no faces.
    Empty,
    /// Too many vertices, faces or sides, or a result would be too large.
    TooLarge(String),
    /// A coordinate or parameter is NaN or infinite.
    NonFinite(String),
    /// A face has fewer than 3 vertices, repeats a vertex or refers to a missing one.
    BadFace(usize),
    /// A face has (nearly) zero area.
    Degenerate(usize),
    /// An edge has more than two faces, or two faces run it the same way.
    NonManifoldEdge(u32, u32),
    /// A vertex's faces do not form a single fan.
    NonManifoldVertex(u32),
    /// A vertex is not used by any face.
    UnusedVertex(u32),
    /// A crease names an edge that does not exist, or its sharpness is negative or NaN.
    BadCrease(u32, u32),
    /// Some other parameter is out of range.
    BadParam(String),
}

impl fmt::Display for SubdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SubdError::Empty => write!(f, "the SubD cage has no faces"),
            SubdError::TooLarge(s) => write!(f, "the SubD cage is too large: {s}"),
            SubdError::NonFinite(s) => write!(f, "not a finite number: {s}"),
            SubdError::BadFace(i) => write!(f, "face {i} needs 3 or more distinct, existing vertices"),
            SubdError::Degenerate(i) => write!(f, "face {i} has zero area"),
            SubdError::NonManifoldEdge(a, b) => write!(f, "edge {a}-{b} is non-manifold or inconsistently oriented"),
            SubdError::NonManifoldVertex(v) => write!(f, "vertex {v} is non-manifold"),
            SubdError::UnusedVertex(v) => write!(f, "vertex {v} is not used by any face"),
            SubdError::BadCrease(a, b) => write!(f, "crease on {a}-{b}: no such edge, or a bad sharpness"),
            SubdError::BadParam(s) => write!(f, "{s}"),
        }
    }
}

impl std::error::Error for SubdError {}

/// The undirected key of the edge between two vertices.
pub fn edge_key(a: u32, b: u32) -> (u32, u32) {
    if a <= b { (a, b) } else { (b, a) }
}

/// Half-edge connectivity derived from a cage's faces. Half-edge `h` is corner `h` of the flat
/// face-vertex list: it runs from that corner's vertex to the next corner's vertex of its face.
#[derive(Clone, Debug)]
pub struct Topology {
    he_face: Vec<u32>,
    he_twin: Vec<u32>,
    he_edge: Vec<u32>,
    /// Each edge's first half-edge.
    edge_he: Vec<u32>,
    /// Each vertex's first outgoing half-edge: for a boundary vertex, the one with no twin.
    vert_out: Vec<u32>,
    vert_boundary: Vec<bool>,
    vert_valence: Vec<u32>,
}

/// A SubD control cage. See the module documentation for what "valid" means.
#[derive(Clone, Debug)]
pub struct SubdCage {
    positions: Vec<Vec3>,
    face_start: Vec<u32>,
    face_verts: Vec<u32>,
    /// Sharpness of tagged edges (> 0; `SHARP` for infinitely sharp).
    creases: BTreeMap<(u32, u32), f64>,
    corners: BTreeSet<u32>,
    topo: Topology,
    edge_sharp: Vec<f64>,
}

impl SubdCage {
    /// Builds and validates a cage with no creases or corners.
    pub fn new(positions: Vec<Vec3>, faces: &[Vec<u32>]) -> Result<SubdCage, SubdError> {
        Self::with_tags(positions, faces, BTreeMap::new(), BTreeSet::new())
    }

    /// Builds and validates a cage with crease sharpness per edge (keyed by [`edge_key`]) and
    /// corner-tagged vertices. Sharpness 0 entries are dropped.
    pub fn with_tags(
        positions: Vec<Vec3>,
        faces: &[Vec<u32>],
        creases: BTreeMap<(u32, u32), f64>,
        corners: BTreeSet<u32>,
    ) -> Result<SubdCage, SubdError> {
        if faces.len() > MAX_CAGE_FACES {
            return Err(SubdError::TooLarge(format!("{} faces (at most {MAX_CAGE_FACES})", faces.len())));
        }
        let mut face_start = Vec::with_capacity(faces.len() + 1);
        let total: usize = faces.iter().map(|f| f.len()).fold(0usize, |a, b| a.saturating_add(b));
        if total > MAX_CAGE_FACES.saturating_mul(8) {
            return Err(SubdError::TooLarge(format!("{total} face corners")));
        }
        let mut face_verts = Vec::with_capacity(total);
        face_start.push(0u32);
        for f in faces {
            face_verts.extend_from_slice(f);
            face_start.push(face_verts.len() as u32);
        }
        Self::from_flat(positions, face_start, face_verts, creases, corners)
    }

    pub(crate) fn from_flat(
        positions: Vec<Vec3>,
        face_start: Vec<u32>,
        face_verts: Vec<u32>,
        creases: BTreeMap<(u32, u32), f64>,
        corners: BTreeSet<u32>,
    ) -> Result<SubdCage, SubdError> {
        let topo = validate(&positions, &face_start, &face_verts)?;
        let mut edge_sharp = vec![0.0; topo.edge_he.len()];
        let mut edge_of: HashMap<(u32, u32), u32> = HashMap::with_capacity(topo.edge_he.len());
        for (e, &h) in topo.edge_he.iter().enumerate() {
            let (a, b) = he_ends(&face_start, &face_verts, &topo, h);
            edge_of.insert(edge_key(a, b), e as u32);
        }
        let mut kept = BTreeMap::new();
        for (&(a, b), &s) in &creases {
            if s.is_nan() || s < 0.0 {
                return Err(SubdError::BadCrease(a, b));
            }
            let Some(&e) = edge_of.get(&edge_key(a, b)) else {
                return Err(SubdError::BadCrease(a, b));
            };
            if s > 0.0 {
                edge_sharp[e as usize] = s;
                kept.insert(edge_key(a, b), s);
            }
        }
        for &c in &corners {
            if c as usize >= positions.len() {
                return Err(SubdError::BadParam(format!("corner vertex {c} does not exist")));
            }
        }
        Ok(SubdCage { positions, face_start, face_verts, creases: kept, corners, topo, edge_sharp })
    }

    pub fn positions(&self) -> &[Vec3] {
        &self.positions
    }
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }
    pub fn face_count(&self) -> usize {
        self.face_start.len().saturating_sub(1)
    }
    pub fn edge_count(&self) -> usize {
        self.topo.edge_he.len()
    }
    /// The vertices of face `f`, counter-clockwise seen from outside.
    pub fn face(&self, f: usize) -> &[u32] {
        let (a, b) = self.face_range(f);
        self.face_verts.get(a..b).unwrap_or(&[])
    }
    /// Every face as a vertex list.
    pub fn faces(&self) -> Vec<Vec<u32>> {
        (0..self.face_count()).map(|f| self.face(f).to_vec()).collect()
    }
    /// Every edge as its two vertices.
    pub fn edges(&self) -> Vec<(u32, u32)> {
        self.topo.edge_he.iter().map(|&h| self.he_ends(h)).collect()
    }
    pub fn creases(&self) -> &BTreeMap<(u32, u32), f64> {
        &self.creases
    }
    pub fn corners(&self) -> &BTreeSet<u32> {
        &self.corners
    }
    /// Sharpness of the edge between `a` and `b` (0 when untagged or absent).
    pub fn crease(&self, a: u32, b: u32) -> f64 {
        self.creases.get(&edge_key(a, b)).copied().unwrap_or(0.0)
    }
    /// True when no edge has only one face.
    pub fn is_closed(&self) -> bool {
        self.topo.he_twin.iter().all(|&t| t != NONE)
    }
    pub fn is_boundary_vertex(&self, v: u32) -> bool {
        self.topo.vert_boundary.get(v as usize).copied().unwrap_or(false)
    }
    /// Number of edges at a vertex.
    pub fn valence(&self, v: u32) -> u32 {
        self.topo.vert_valence.get(v as usize).copied().unwrap_or(0)
    }
    /// True when every face is a quad.
    pub fn all_quads(&self) -> bool {
        self.face_start.windows(2).all(|w| w[1] - w[0] == 4)
    }
    /// The largest finite crease sharpness (0 when none).
    pub fn max_finite_sharpness(&self) -> f64 {
        self.creases.values().copied().filter(|s| s.is_finite()).fold(0.0, f64::max)
    }
    /// The edge index of the edge between `a` and `b`, if there is one.
    pub fn find_edge(&self, a: u32, b: u32) -> Option<usize> {
        let mut fan = Vec::new();
        let closing = self.fan(a, &mut fan);
        for &h in &fan {
            if self.dest(h) == b {
                return Some(self.he_edge(h));
            }
        }
        closing.filter(|&p| self.origin(p) == b).map(|p| self.he_edge(p))
    }
    /// Euler characteristic V − E + F.
    pub fn euler(&self) -> i64 {
        self.vertex_count() as i64 - self.edge_count() as i64 + self.face_count() as i64
    }
    /// Axis-aligned bounds (min, max).
    pub fn bounds(&self) -> (Vec3, Vec3) {
        bounds_of(&self.positions)
    }

    // ---------- half-edge access (crate) ----------

    pub(crate) fn face_range(&self, f: usize) -> (usize, usize) {
        let a = self.face_start.get(f).copied().unwrap_or(0) as usize;
        let b = self.face_start.get(f + 1).copied().unwrap_or(a as u32) as usize;
        (a, b)
    }
    pub(crate) fn face_start(&self) -> &[u32] {
        &self.face_start
    }
    pub(crate) fn face_verts(&self) -> &[u32] {
        &self.face_verts
    }
    pub(crate) fn he_count(&self) -> usize {
        self.face_verts.len()
    }
    pub(crate) fn origin(&self, h: u32) -> u32 {
        self.face_verts[h as usize]
    }
    pub(crate) fn next(&self, h: u32) -> u32 {
        next_he(&self.face_start, &self.topo, h)
    }
    pub(crate) fn prev(&self, h: u32) -> u32 {
        let f = self.topo.he_face[h as usize] as usize;
        let s = self.face_start[f];
        if h == s { self.face_start[f + 1] - 1 } else { h - 1 }
    }
    pub(crate) fn dest(&self, h: u32) -> u32 {
        self.origin(self.next(h))
    }
    pub(crate) fn twin(&self, h: u32) -> Option<u32> {
        let t = self.topo.he_twin[h as usize];
        (t != NONE).then_some(t)
    }
    pub(crate) fn he_face(&self, h: u32) -> usize {
        self.topo.he_face[h as usize] as usize
    }
    pub(crate) fn he_edge(&self, h: u32) -> usize {
        self.topo.he_edge[h as usize] as usize
    }
    pub(crate) fn edge_he(&self, e: usize) -> u32 {
        self.topo.edge_he[e]
    }
    pub(crate) fn he_ends(&self, h: u32) -> (u32, u32) {
        (self.origin(h), self.dest(h))
    }
    /// Sharpness of edge `e` as the rules see it: boundary edges are infinitely sharp.
    pub(crate) fn rule_sharpness(&self, e: usize) -> f64 {
        let h = self.topo.edge_he[e];
        if self.topo.he_twin[h as usize] == NONE { SHARP } else { self.edge_sharp[e] }
    }
    pub(crate) fn edge_sharpness(&self, e: usize) -> f64 {
        self.edge_sharp[e]
    }
    /// The outgoing half-edges of `v` in counter-clockwise order (seen from outside); for a
    /// boundary vertex the first has no twin. Also returns the incoming boundary half-edge that
    /// closes the fan of a boundary vertex.
    pub(crate) fn fan(&self, v: u32, out: &mut Vec<u32>) -> Option<u32> {
        out.clear();
        let start = *self.topo.vert_out.get(v as usize)?;
        let mut h = start;
        let cap = self.topo.vert_valence[v as usize] as usize + 1;
        for _ in 0..cap {
            out.push(h);
            let p = self.prev(h);
            let t = self.topo.he_twin[p as usize];
            if t == NONE {
                return Some(p);
            }
            if t == start {
                return None;
            }
            h = t;
        }
        None
    }
    pub(crate) fn replace_positions(&mut self, p: Vec<Vec3>) -> Result<(), SubdError> {
        if p.len() != self.positions.len() {
            return Err(SubdError::BadParam("position count changed".into()));
        }
        if let Some(i) = p.iter().position(|q| !q.is_finite()) {
            return Err(SubdError::NonFinite(format!("vertex {i}")));
        }
        check_areas(&p, &self.face_start, &self.face_verts)?;
        self.positions = p;
        Ok(())
    }
    pub(crate) fn into_parts(self) -> (Vec<Vec3>, Vec<Vec<u32>>, BTreeMap<(u32, u32), f64>, BTreeSet<u32>) {
        let faces = self.faces();
        (self.positions, faces, self.creases, self.corners)
    }
}

pub(crate) fn bounds_of(p: &[Vec3]) -> (Vec3, Vec3) {
    let mut lo = Vec3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
    let mut hi = Vec3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for q in p {
        lo = Vec3::new(lo.x.min(q.x), lo.y.min(q.y), lo.z.min(q.z));
        hi = Vec3::new(hi.x.max(q.x), hi.y.max(q.y), hi.z.max(q.z));
    }
    (lo, hi)
}

fn next_he(face_start: &[u32], topo: &Topology, h: u32) -> u32 {
    let f = topo.he_face[h as usize] as usize;
    if h + 1 < face_start[f + 1] { h + 1 } else { face_start[f] }
}

fn he_ends(face_start: &[u32], face_verts: &[u32], topo: &Topology, h: u32) -> (u32, u32) {
    (face_verts[h as usize], face_verts[next_he(face_start, topo, h) as usize])
}

/// Newell normal of a polygon (twice the area vector).
pub(crate) fn newell(p: &[Vec3], idx: &[u32]) -> Vec3 {
    let mut n = Vec3::ZERO;
    let k = idx.len();
    for i in 0..k {
        let a = p.get(idx[i] as usize).copied().unwrap_or_default();
        let b = p.get(idx[(i + 1) % k] as usize).copied().unwrap_or_default();
        n = n + Vec3::new((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
    }
    n
}

fn check_areas(positions: &[Vec3], face_start: &[u32], face_verts: &[u32]) -> Result<(), SubdError> {
    let (lo, hi) = bounds_of(positions);
    let diag = (hi - lo).len();
    // A face is degenerate when its area is negligible against the cage's size.
    let tol = (diag * diag * 1e-20).max(f64::MIN_POSITIVE);
    for (f, w) in face_start.windows(2).enumerate() {
        let idx = &face_verts[w[0] as usize..w[1] as usize];
        let a = newell(positions, idx).len() * 0.5;
        if a.is_nan() || a <= tol {
            return Err(SubdError::Degenerate(f));
        }
    }
    Ok(())
}

fn validate(positions: &[Vec3], face_start: &[u32], face_verts: &[u32]) -> Result<Topology, SubdError> {
    let nv = positions.len();
    let nf = face_start.len().saturating_sub(1);
    if nf == 0 {
        return Err(SubdError::Empty);
    }
    if nv > MAX_CAGE_VERTICES {
        return Err(SubdError::TooLarge(format!("{nv} vertices (at most {MAX_CAGE_VERTICES})")));
    }
    if nf > MAX_CAGE_FACES {
        return Err(SubdError::TooLarge(format!("{nf} faces (at most {MAX_CAGE_FACES})")));
    }
    if let Some(i) = positions.iter().position(|p| !p.is_finite()) {
        return Err(SubdError::NonFinite(format!("vertex {i}")));
    }
    let nh = face_verts.len();
    let mut he_face = vec![0u32; nh];
    let mut seen: Vec<u32> = Vec::new();
    for f in 0..nf {
        let (a, b) = (face_start[f] as usize, face_start[f + 1] as usize);
        if b < a || b > nh || b - a < 3 || b - a > MAX_FACE_SIDES {
            return Err(SubdError::BadFace(f));
        }
        seen.clear();
        for h in a..b {
            let v = face_verts[h];
            if v as usize >= nv || seen.contains(&v) {
                return Err(SubdError::BadFace(f));
            }
            seen.push(v);
            he_face[h] = f as u32;
        }
    }
    if face_start.last().copied().unwrap_or(0) as usize != nh {
        return Err(SubdError::BadParam("face list is inconsistent".into()));
    }
    check_areas(positions, face_start, face_verts)?;

    let mut topo = Topology {
        he_face,
        he_twin: vec![NONE; nh],
        he_edge: vec![NONE; nh],
        edge_he: Vec::new(),
        vert_out: vec![NONE; nv],
        vert_boundary: vec![false; nv],
        vert_valence: vec![0; nv],
    };
    let mut directed: HashMap<(u32, u32), u32> = HashMap::with_capacity(nh);
    for h in 0..nh as u32 {
        let (a, b) = he_ends(face_start, face_verts, &topo, h);
        if directed.insert((a, b), h).is_some() {
            return Err(SubdError::NonManifoldEdge(a, b));
        }
    }
    for h in 0..nh as u32 {
        let (a, b) = he_ends(face_start, face_verts, &topo, h);
        if let Some(&t) = directed.get(&(b, a)) {
            topo.he_twin[h as usize] = t;
        }
        if topo.he_edge[h as usize] == NONE {
            let e = topo.edge_he.len() as u32;
            topo.edge_he.push(h);
            topo.he_edge[h as usize] = e;
            let t = topo.he_twin[h as usize];
            if t != NONE {
                topo.he_edge[t as usize] = e;
            }
        }
    }
    // Vertex fans: count corners, find a boundary-start outgoing half-edge.
    let mut corners = vec![0u32; nv];
    for h in 0..nh as u32 {
        let v = face_verts[h as usize];
        corners[v as usize] += 1;
        if topo.vert_out[v as usize] == NONE || topo.he_twin[h as usize] == NONE {
            if topo.he_twin[h as usize] == NONE && topo.vert_boundary[v as usize] {
                // A second boundary start: two fans meet here.
                return Err(SubdError::NonManifoldVertex(v));
            }
            topo.vert_out[v as usize] = h;
            if topo.he_twin[h as usize] == NONE {
                topo.vert_boundary[v as usize] = true;
            }
        }
    }
    #[allow(clippy::needless_range_loop)]
    for v in 0..nv {
        if corners[v] == 0 {
            return Err(SubdError::UnusedVertex(v as u32));
        }
        // Walk the fan; it must visit every corner of the vertex.
        let start = topo.vert_out[v];
        let mut h = start;
        let mut count = 0u32;
        loop {
            count += 1;
            if count > corners[v] {
                return Err(SubdError::NonManifoldVertex(v as u32));
            }
            let f = topo.he_face[h as usize] as usize;
            let p = if h == face_start[f] { face_start[f + 1] - 1 } else { h - 1 };
            let t = topo.he_twin[p as usize];
            if t == NONE || t == start {
                break;
            }
            h = t;
        }
        if count != corners[v] {
            return Err(SubdError::NonManifoldVertex(v as u32));
        }
        topo.vert_valence[v] = count + u32::from(topo.vert_boundary[v]);
    }
    Ok(topo)
}
