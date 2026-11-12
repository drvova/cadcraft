//! `PIECEMESH` and `STLOUT`: a parametric ring as a solid, from [`PieceParams`].
//!
//! `PIECEMESH` answers with triangles for a 3D viewport and `STLOUT` with an STL for the caster.
//! Both read the piece's parameters straight from their JSON, build the same solid and change
//! nothing in the drawing. Everything is millimetres. The finger's axis is Z, the ring lies in
//! the XY plane centred on the origin, and the head (12 o'clock) is at +Y.
//!
//! # The solids
//!
//! **Band.** The section revolved about Z, centred on Z = 0, from the inside radius
//! `size.diameter / 2` to that plus `wall`. Flat: the rectangle `width` × `wall`, edges sharp.
//! Dome: a flat inside and a half-ellipse outside with semi-axes `width / 2` (along the finger)
//! and `wall` (radial) — a true half-round when `wall = width / 2`, and never wider than the band
//! whatever the wall. Its volume by Pappus is `2π · (r + 4·wall / 3π) · (π · width · wall / 4)`.
//!
//! **Stones.** A stone is `depth = gem::default_depth(cut, width)` deep, split crown 26 %, girdle
//! 4 %, pavilion 70 %. A round is a brilliant: an eight-sided table 57 % of the diameter, eight
//! stars, eight bezel kites (planar), sixteen upper-girdle facets, the girdle, sixteen lower-girdle
//! facets and eight pavilion mains to the culet. Every other cut is its own girdle outline
//! (`gem::outline`) tapered up to a table (the outline scaled about its centroid) and down to a
//! culet point (pear, heart, trillion, and anything as long as wide) or to a keel line along the
//! long axis. A cabochon is a dome on a flat base.
//!
//! **Solitaire.** The band, and on top of it at +Y the centre stone, its length along the finger,
//! its culet 0.25 mm above the band. The prongs are round wire, `0.075 × the stone's lesser
//! dimension` in radius (0.3–0.8 mm), from inside the band, through a gallery rail half-way down
//! the pavilion, up the girdle and over it, capped with a hemisphere. They stand where `SETTING`
//! puts them (`setting::prong_sites`: corners first, then the points furthest apart); on a round
//! they are evenly spaced starting half a step off the band's direction. A halo is round melee of
//! width `halo` on the girdle outline offset by `halo / 2 + max(gap, 0.15)`, as many as fit:
//! `n = floor(perimeter of that offset outline / (halo + gap))`, at least three, on a seat plate.
//!
//! **Eternity.** The band and `count` round stones of diameter `melee` evenly around the outside,
//! the first at 12 o'clock, tables outward, girdles `max(0.05, 0.08 × melee)` above the band's
//! outside surface, pavilions in the band. With no `count`, as many as fit with `gap` between
//! them on the band's outside circle:
//!
//! ```text
//! n = floor(π · (size.diameter + 2 · wall) / (melee + gap))      clamped to 1 ..= 400
//! ```
//!
//! ([`eternity_count`]; the sheet uses the same number.) Between neighbours close enough to share
//! them stand two bead prongs.
//!
//! # Shells
//!
//! Every part is a closed shell, wound counter-clockwise seen from outside. The band, the rail,
//! the prongs, the halo seat and the beads are separate shells that pass through each other where
//! they join, and stone seats are not cut from the metal: that is how such a model is commonly
//! handed to a caster's slicer, which unions them. The metal volume reported is the sum of the
//! shells, so where shells overlap it counts the overlap twice.
//!
//! # Limits
//!
//! A reply holds at most [`MAX_TRIANGLES`] triangles and `PIECEMESH` stays under about 4 MB of
//! JSON. A piece that would exceed either is built again at a coarser tessellation (never cut off
//! part-way through a surface) and the reply's `notes` say so.

use cadcraft_doc::EntityKind;
use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Value, json};

use super::super::*;
use super::piece_params::{MAX_PIECE_STONES, MIN_CAST_WALL, PieceKind, PieceParams, Profile};
use super::*;

/// The most triangles a reply holds.
pub(super) const MAX_TRIANGLES: usize = 150_000;
/// The estimated JSON size `PIECEMESH` builds to (the reply itself stays under about 4 MB).
const MAX_JSON_ESTIMATE: usize = 3_600_000;
/// The most triangles an ASCII STL holds (about 200 bytes each).
const MAX_ASCII_TRIANGLES: usize = 30_000;

/// A stone's depth, split: crown, girdle, pavilion.
pub(super) const CROWN: f64 = 0.26;
pub(super) const GIRDLE: f64 = 0.04;
pub(super) const PAVILION: f64 = 0.70;
/// A round brilliant's table, corner to corner, as a fraction of its diameter.
pub(super) const ROUND_TABLE: f64 = 0.57;
/// How far a star facet reaches from the table's edge to the girdle.
const STAR_LENGTH: f64 = 0.5;
/// Where the lower-girdle facets meet, as a fraction of the way in from the girdle.
const LOWER_HALF: f64 = 0.77;
/// The gap between a centre stone's lowest point and the band under it.
pub(super) const CULET_CLEARANCE: f64 = 0.25;

/// How finely the solid is tessellated.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Quality {
    Draft,
    Fine,
}

impl Quality {
    fn parse(cmd: &str, p: &Value, default: Quality) -> Result<Quality> {
        match p.get("quality").filter(|v| !v.is_null()) {
            None => Ok(default),
            Some(v) => match v.as_str().map(|s| s.trim().to_ascii_lowercase()).as_deref() {
                Some("draft") => Ok(Quality::Draft),
                Some("fine") => Ok(Quality::Fine),
                _ => Err(bad(cmd, "`quality` must be draft or fine")),
            },
        }
    }
    pub(super) fn name(self) -> &'static str {
        match self {
            Quality::Draft => "draft",
            Quality::Fine => "fine",
        }
    }
    fn level(self) -> usize {
        match self {
            Quality::Fine => 0,
            Quality::Draft => 1,
        }
    }
}

/// One tessellation level: how many pieces each curve is cut into.
#[derive(Clone, Copy)]
struct Detail {
    /// Steps around the band (a multiple of four, so the extremes are vertices).
    band: usize,
    /// Segments across a dome (even, so the crown is a vertex).
    dome: usize,
    /// Girdle points per sixteenth of the centre stone and of melee.
    centre: usize,
    melee: usize,
    /// The most points on a fancy cut's girdle.
    outline: usize,
    /// Sides of a prong, rings in its end caps, and steps per span of its path.
    radial: usize,
    cap: usize,
    sub: usize,
    /// Sides and latitudes of a bead.
    bead_radial: usize,
    bead_lat: usize,
}

/// Fine, draft, and two coarser levels a very large piece falls back to.
const DETAILS: [Detail; 4] = [
    Detail { band: 192, dome: 32, centre: 4, melee: 2, outline: 96, radial: 12, cap: 3, sub: 5, bead_radial: 8, bead_lat: 4 },
    Detail { band: 96, dome: 16, centre: 2, melee: 1, outline: 48, radial: 8, cap: 2, sub: 3, bead_radial: 6, bead_lat: 3 },
    Detail { band: 64, dome: 12, centre: 1, melee: 1, outline: 32, radial: 6, cap: 2, sub: 2, bead_radial: 6, bead_lat: 3 },
    Detail { band: 48, dome: 8, centre: 1, melee: 1, outline: 24, radial: 6, cap: 2, sub: 2, bead_radial: 5, bead_lat: 3 },
];

/// What a build must stay under.
#[derive(Clone, Copy)]
struct Budget {
    triangles: usize,
    /// The estimated size of the `PIECEMESH` reply, when that is what is being built.
    json: Option<usize>,
    /// Count the stones' triangles too.
    stones: bool,
}

/// One part of the piece: a set of closed shells of one material.
pub(super) struct PartMesh {
    /// `metal` or `stone`.
    pub part: &'static str,
    pub name: &'static str,
    pub color: [u8; 3],
    pub positions: Vec<Vec3>,
    pub indices: Vec<u32>,
}

impl PartMesh {
    pub(super) fn triangles(&self) -> usize {
        self.indices.len() / 3
    }
    /// The volume the part's shells enclose (positive when they face outward).
    pub(super) fn volume(&self) -> f64 {
        signed_volume(&self.positions, &self.indices)
    }
}

/// The piece as triangles.
pub(super) struct PieceMesh {
    pub meshes: Vec<PartMesh>,
    pub notes: Vec<String>,
    /// How many stones the piece carries.
    pub stones: u32,
    /// The tessellation level it was built at (0 fine, 1 draft, 2 and 3 coarser).
    pub level: usize,
    /// Even the coarsest level is over the budget (never so for `PIECEMESH`).
    pub over: bool,
}

impl PieceMesh {
    pub(super) fn triangles(&self) -> usize {
        self.meshes.iter().map(PartMesh::triangles).sum()
    }
    /// The metal shells' volume in cubic millimetres (overlaps counted twice).
    pub(super) fn metal_volume(&self) -> f64 {
        self.meshes.iter().filter(|m| m.part == "metal").map(PartMesh::volume).sum()
    }
    /// The corners of the box around every vertex, rounded as the reply rounds them.
    pub(super) fn bounds(&self) -> ([f64; 3], [f64; 3]) {
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        let mut any = false;
        for p in self.meshes.iter().flat_map(|m| m.positions.iter()) {
            any = true;
            for ((l, h), v) in lo.iter_mut().zip(hi.iter_mut()).zip([p.x, p.y, p.z]) {
                let v = r3(v);
                *l = l.min(v);
                *h = h.max(v);
            }
        }
        if any { (lo, hi) } else { ([0.0; 3], [0.0; 3]) }
    }
    fn counted(&self, stones: bool) -> usize {
        self.meshes.iter().filter(|m| stones || m.part == "metal").map(PartMesh::triangles).sum()
    }
    /// About how many bytes the `PIECEMESH` reply takes: a coordinate is at most eight characters
    /// with its comma, an index seven.
    fn json_estimate(&self) -> usize {
        self.meshes.iter().map(|m| m.positions.len() * 24 + m.indices.len() * 7 + 160).sum::<usize>() + 600
    }
}

/// A coordinate as the reply carries it: three decimals, never NaN and never a negative zero.
pub(super) fn r3(x: f64) -> f64 {
    if !x.is_finite() {
        return 0.0;
    }
    let v = (x * 1000.0).round() / 1000.0;
    if v == 0.0 { 0.0 } else { v }
}

/// The volume a triangle soup encloses, by the divergence theorem.
pub(super) fn signed_volume(positions: &[Vec3], indices: &[u32]) -> f64 {
    let at = |i: &u32| positions.get(*i as usize).copied();
    let mut six = 0.0;
    for t in indices.chunks_exact(3) {
        if let (Some(a), Some(b), Some(c)) = (t.first().and_then(at), t.get(1).and_then(at), t.get(2).and_then(at)) {
            six += a.dot(b.cross(c));
        }
    }
    six / 6.0
}

/// How many stones an eternity band carries: `count` when given, else as many as fit around the
/// band's outside circle with `gap` between them — `floor(π · outer diameter / (melee + gap))`.
pub(super) fn eternity_count(p: &PieceParams) -> u32 {
    if let Some(n) = p.count {
        return n.clamp(1, MAX_PIECE_STONES);
    }
    let pitch = p.melee + p.gap;
    let n = if pitch.is_finite() && pitch > 1e-6 { (PI * p.outer() / pitch).floor() } else { 1.0 };
    if n.is_finite() { n.clamp(1.0, f64::from(MAX_PIECE_STONES)) as u32 } else { 1 }
}

// ---------------------------------------------------------------------------------------------
// The mesh under construction
// ---------------------------------------------------------------------------------------------

/// A run of consecutive vertices forming a closed ring.
#[derive(Clone, Copy)]
struct Ring {
    start: u32,
    n: u32,
}

impl Ring {
    fn at(self, k: u32) -> u32 {
        if self.n == 0 { self.start } else { self.start.saturating_add(k % self.n) }
    }
}

/// Vertices and triangles being gathered for one part.
#[derive(Default)]
struct Buf {
    pos: Vec<Vec3>,
    idx: Vec<u32>,
}

impl Buf {
    fn v(&mut self, p: Vec3) -> u32 {
        let i = u32::try_from(self.pos.len()).unwrap_or(u32::MAX);
        self.pos.push(p);
        i
    }
    fn tri(&mut self, a: u32, b: u32, c: u32) {
        if a != b && b != c && a != c {
            self.idx.extend([a, b, c]);
        }
    }
    fn ring<I: IntoIterator<Item = Vec3>>(&mut self, pts: I) -> Ring {
        let start = u32::try_from(self.pos.len()).unwrap_or(u32::MAX);
        let mut n = 0u32;
        for p in pts {
            self.v(p);
            n = n.saturating_add(1);
        }
        Ring { start, n }
    }
    /// The wall between two rings of the same count, `b` further along the direction the rings
    /// run counter-clockwise about.
    fn bridge(&mut self, a: Ring, b: Ring) {
        let n = a.n.min(b.n);
        for k in 0..n {
            self.tri(a.at(k), a.at(k + 1), b.at(k + 1));
            self.tri(a.at(k), b.at(k + 1), b.at(k));
        }
    }
    /// Close the near end of a stack of rings onto one vertex.
    fn cap_start(&mut self, pole: u32, r: Ring) {
        for k in 0..r.n {
            self.tri(pole, r.at(k + 1), r.at(k));
        }
    }
    /// Close the far end of a stack of rings onto one vertex.
    fn cap_end(&mut self, r: Ring, pole: u32) {
        for k in 0..r.n {
            self.tri(pole, r.at(k), r.at(k + 1));
        }
    }
    fn part(self, part: &'static str, name: &'static str, color: [u8; 3]) -> Option<PartMesh> {
        if self.idx.is_empty() {
            return None;
        }
        Some(PartMesh { part, name, color, positions: self.pos, indices: self.idx })
    }
}

/// Where a stone sits: its girdle plane's origin, the plane's two axes and the way its table faces.
#[derive(Clone, Copy)]
struct Frame {
    o: Vec3,
    u: Vec3,
    v: Vec3,
    w: Vec3,
}

impl Frame {
    fn at(&self, x: f64, y: f64, h: f64) -> Vec3 {
        self.o + self.u * x + self.v * y + self.w * h
    }
}

/// A unit vector square to `t`.
fn any_perp(t: Vec3) -> Vec3 {
    let axis = if t.x.abs() < 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 1.0, 0.0) };
    t.cross(axis).normalized()
}

/// A round wire along `path` with a hemisphere on each end: one closed shell.
fn capsule(buf: &mut Buf, path: &[Vec3], radius: f64, radial: usize, cap: usize) {
    let mut pts: Vec<Vec3> = Vec::with_capacity(path.len());
    for p in path {
        if p.is_finite() && pts.last().is_none_or(|l| (*p - *l).len() > 1e-6) {
            pts.push(*p);
        }
    }
    let n = pts.len();
    let (Some(first), Some(last)) = (pts.first().copied(), pts.last().copied()) else { return };
    if n < 2 || !(radius.is_finite() && radius > 1e-6) {
        return;
    }
    let radial = radial.clamp(3, 64);
    let cap = cap.clamp(1, 16);
    let tangent = |i: usize| -> Vec3 {
        let a = pts.get(i.saturating_sub(1)).copied().unwrap_or(first);
        let b = pts.get((i + 1).min(n - 1)).copied().unwrap_or(last);
        (b - a).normalized()
    };
    let circle = |c: Vec3, nrm: Vec3, bin: Vec3, r: f64| {
        (0..radial).map(move |k| {
            let a = TAU * k as f64 / radial as f64;
            c + (nrm * a.cos() + bin * a.sin()) * r
        })
    };
    let t0 = tangent(0);
    let mut nrm = any_perp(t0);
    let pole0 = buf.v(first - t0 * radius);
    let mut prev: Option<Ring> = None;
    let link = |buf: &mut Buf, ring: Ring, prev: &mut Option<Ring>| {
        match *prev {
            Some(p) => buf.bridge(p, ring),
            None => buf.cap_start(pole0, ring),
        }
        *prev = Some(ring);
    };
    // The near hemisphere, from just off its pole to the wire's first section.
    for j in (1..cap).rev() {
        let a = (PI / 2.0) * j as f64 / cap as f64;
        let ring = buf.ring(circle(first - t0 * (radius * a.sin()), nrm, t0.cross(nrm), radius * a.cos()));
        link(buf, ring, &mut prev);
    }
    let mut t = t0;
    for (i, p) in pts.iter().enumerate() {
        t = tangent(i);
        // Carry the section's direction along the wire without twisting it.
        let carried = (nrm - t * nrm.dot(t)).normalized();
        nrm = if carried.len() > 0.5 { carried } else { any_perp(t) };
        let ring = buf.ring(circle(*p, nrm, t.cross(nrm), radius));
        link(buf, ring, &mut prev);
    }
    for j in 1..cap {
        let a = (PI / 2.0) * j as f64 / cap as f64;
        let ring = buf.ring(circle(last + t * (radius * a.sin()), nrm, t.cross(nrm), radius * a.cos()));
        link(buf, ring, &mut prev);
    }
    let pole1 = buf.v(last + t * radius);
    if let Some(p) = prev {
        buf.cap_end(p, pole1);
    }
}

/// A round wire around a closed loop lying square to `up`: one closed shell. Corners are mitred so
/// the wire keeps its width around them.
fn loop_wire(buf: &mut Buf, pts: &[Vec3], up: Vec3, radius: f64, radial: usize) {
    let n = pts.len();
    if n < 3 || !(radius.is_finite() && radius > 1e-6) {
        return;
    }
    let radial = radial.clamp(3, 64);
    let at = |i: usize| pts.get(i % n).copied().unwrap_or(Vec3::ZERO);
    let mut first: Option<Ring> = None;
    let mut prev: Option<Ring> = None;
    for i in 0..n {
        let (a, p, b) = (at(i + n - 1), at(i), at(i + 1));
        let t = (b - a).normalized();
        let out = t.cross(up).normalized();
        let cos_half = t.dot((b - p).normalized()).abs().max(0.5);
        let ring = buf.ring((0..radial).map(|k| {
            let ang = TAU * k as f64 / radial as f64;
            p + up * (radius * ang.cos()) + out * (radius / cos_half * ang.sin())
        }));
        if let Some(q) = prev {
            buf.bridge(q, ring);
        }
        first = first.or(Some(ring));
        prev = Some(ring);
    }
    if let (Some(a), Some(b)) = (prev, first) {
        buf.bridge(a, b);
    }
}

/// A bead: a sphere, one closed shell.
fn bead(buf: &mut Buf, centre: Vec3, up: Vec3, radius: f64, radial: usize, lat: usize) {
    if !(centre.is_finite() && radius.is_finite() && radius > 1e-6) {
        return;
    }
    let radial = radial.clamp(3, 64);
    let lat = lat.clamp(2, 32);
    let nrm = any_perp(up);
    let bin = up.cross(nrm);
    let south = buf.v(centre - up * radius);
    let mut prev: Option<Ring> = None;
    for j in 1..lat {
        let phi = -PI / 2.0 + PI * j as f64 / lat as f64;
        let (c, r) = (centre + up * (radius * phi.sin()), radius * phi.cos());
        let ring = buf.ring((0..radial).map(|k| {
            let a = TAU * k as f64 / radial as f64;
            c + (nrm * a.cos() + bin * a.sin()) * r
        }));
        match prev {
            Some(p) => buf.bridge(p, ring),
            None => buf.cap_start(south, ring),
        }
        prev = Some(ring);
    }
    let north = buf.v(centre + up * radius);
    if let Some(p) = prev {
        buf.cap_end(p, north);
    }
}

/// A smooth curve through `pts` (Catmull–Rom), `sub` steps to a span.
fn smooth_path(pts: &[Vec3], sub: usize) -> Vec<Vec3> {
    let n = pts.len();
    let sub = sub.clamp(1, 16);
    let at = |i: isize| -> Vec3 {
        let i = i.clamp(0, n.saturating_sub(1) as isize) as usize;
        pts.get(i).copied().unwrap_or(Vec3::ZERO)
    };
    let mut out = Vec::with_capacity(n.saturating_mul(sub) + 1);
    for i in 0..n.saturating_sub(1) {
        let i = i as isize;
        let (p0, p1, p2, p3) = (at(i - 1), at(i), at(i + 1), at(i + 2));
        for s in 0..sub {
            let t = s as f64 / sub as f64;
            let (t2, t3) = (t * t, t * t * t);
            out.push((p1 * 2.0 + (p2 - p0) * t + (p0 * 2.0 - p1 * 5.0 + p2 * 4.0 - p3) * t2 + (p1 * 3.0 - p0 - p2 * 3.0 + p3) * t3) * 0.5);
        }
    }
    if let Some(last) = pts.last() {
        out.push(*last);
    }
    out
}

// ---------------------------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------------------------

/// A piece's numbers with every one made safe to build from, whatever it was given.
struct Sane {
    kind: PieceKind,
    /// Inside and outside radius.
    ri: f64,
    ro: f64,
    wall: f64,
    width: f64,
    dome: bool,
    stone_length: f64,
    stone_width: f64,
    prongs: usize,
    halo: Option<f64>,
    melee: f64,
    gap: f64,
    count: u32,
}

fn fin(x: f64, lo: f64, hi: f64, default: f64) -> f64 {
    if x.is_finite() { x.clamp(lo, hi) } else { default }
}

impl Sane {
    fn of(p: &PieceParams) -> Sane {
        let ri = fin(p.inner() / 2.0, 1.0, 50.0, 8.255);
        let wall = fin(p.wall, 0.05, 20.0, 1.8);
        Sane {
            kind: p.kind,
            ri,
            ro: ri + wall,
            wall,
            width: fin(p.width, 0.1, 60.0, 2.2),
            dome: p.profile == Profile::Dome,
            stone_length: fin(p.stone_length, 0.1, 60.0, 6.5),
            stone_width: fin(p.stone_width, 0.1, 60.0, 6.5),
            prongs: (p.prongs as usize).clamp(2, 12),
            halo: p.halo.filter(|h| h.is_finite()).map(|h| h.clamp(0.1, 10.0)),
            melee: fin(p.melee, 0.1, 20.0, 1.8),
            gap: fin(p.gap, 0.0, 20.0, 0.2),
            count: eternity_count(p),
        }
    }
    /// The band's outside radius at `z` along the finger.
    fn outside_at(&self, z: f64) -> f64 {
        if !self.dome {
            return self.ro;
        }
        let t = (2.0 * z / self.width).clamp(-1.0, 1.0);
        self.ri + self.wall * (1.0 - t * t).max(0.0).sqrt()
    }
}

/// The band's section as (radius, z), in the order that faces the revolved surface outward.
fn band_section(s: &Sane, d: &Detail) -> Vec<(f64, f64)> {
    let h = s.width / 2.0;
    if !s.dome {
        return vec![(s.ri, -h), (s.ri, h), (s.ro, h), (s.ro, -h)];
    }
    let m = (d.dome.clamp(2, 256) / 2) * 2;
    let mut pts = Vec::with_capacity(m + 1);
    pts.push((s.ri, -h));
    pts.push((s.ri, h));
    for j in 1..m {
        let a = PI * j as f64 / m as f64;
        pts.push((s.ri + s.wall * a.sin(), h * a.cos()));
    }
    pts
}

fn build_band(buf: &mut Buf, s: &Sane, d: &Detail) {
    let section = band_section(s, d);
    let n = (d.band.clamp(8, 1024) / 4) * 4;
    let mut first: Option<Ring> = None;
    let mut prev: Option<Ring> = None;
    for i in 0..n {
        let a = TAU * i as f64 / n as f64;
        let (c, sn) = (a.cos(), a.sin());
        let ring = buf.ring(section.iter().map(|(r, z)| Vec3::new(r * c, r * sn, *z)));
        if let Some(p) = prev {
            buf.bridge(p, ring);
        }
        first = first.or(Some(ring));
        prev = Some(ring);
    }
    if let (Some(a), Some(b)) = (prev, first) {
        buf.bridge(a, b);
    }
}

// ---------------------------------------------------------------------------------------------
// Stones
// ---------------------------------------------------------------------------------------------

/// A stone's girdle thickness, crown height and pavilion depth from its whole depth.
pub(super) fn proportions(depth: f64) -> (f64, f64, f64) {
    (GIRDLE * depth, CROWN * depth, PAVILION * depth)
}

/// A round brilliant of `radius`, `k` girdle points to each sixteenth.
fn round_brilliant(buf: &mut Buf, f: &Frame, radius: f64, depth: f64, k: usize) {
    if !(radius.is_finite() && depth.is_finite() && radius > 1e-6 && depth > 1e-6) {
        return;
    }
    let k = k.clamp(1, 8) as u32;
    let (g, hc, hp) = proportions(depth);
    let n = 16 * k;
    let e = PI / 8.0;
    let polar = |r: f64, a: f64, h: f64| f.at(r * a.cos(), r * a.sin(), h);
    let (zg, zt, zc) = (g / 2.0, g / 2.0 + hc, -g / 2.0 - hp);
    let rt = ROUND_TABLE * radius;
    // A star's tip lies in the plane of the bezel facets either side of it, so the kites are flat.
    let edge = rt * e.cos();
    let rs = edge + STAR_LENGTH * (radius - edge);
    let zs = zt - (zt - zg) * ((rs * e.cos() - rt) / (radius - rt));
    // Likewise below: where two lower-girdle facets meet lies in the pavilion mains' planes.
    let rl = (1.0 - LOWER_HALF) * radius / e.cos();
    let zl = zc + hp * (1.0 - LOWER_HALF);
    let table = buf.ring((0..8).map(|i| polar(rt, 2.0 * e * f64::from(i), zt)));
    let star = buf.ring((0..8).map(|i| polar(rs, e * f64::from(2 * i + 1), zs)));
    let upper = buf.ring((0..n).map(|j| polar(radius, TAU * f64::from(j) / f64::from(n), zg)));
    let lower = buf.ring((0..n).map(|j| polar(radius, TAU * f64::from(j) / f64::from(n), -zg)));
    let low = buf.ring((0..8).map(|i| polar(rl, e * f64::from(2 * i + 1), zl)));
    let culet = buf.v(f.at(0.0, 0.0, zc));
    for i in 1..7 {
        buf.tri(table.at(0), table.at(i), table.at(i + 1));
    }
    for i in 0..8u32 {
        let m = 2 * k * i;
        buf.tri(table.at(i), star.at(i), table.at(i + 1));
        buf.tri(table.at(i), star.at(i + 7), upper.at(m));
        buf.tri(table.at(i), upper.at(m), star.at(i));
        for j in m..m + 2 * k {
            buf.tri(star.at(i), upper.at(j), upper.at(j + 1));
            buf.tri(low.at(i), lower.at(j + 1), lower.at(j));
        }
        buf.tri(culet, lower.at(m), low.at(i + 7));
        buf.tri(culet, low.at(i), lower.at(m));
    }
    buf.bridge(lower, upper);
}

/// Where a fancy cut's pavilion ends: one point, or a keel from `a` to `b`.
#[derive(Clone, Copy)]
enum Culet {
    Point(Vec2),
    Keel(Vec2, Vec2),
}

impl Culet {
    /// The end of the pavilion a girdle point runs down to.
    fn under(self, p: Vec2) -> Vec2 {
        match self {
            Culet::Point(c) => c,
            Culet::Keel(a, b) => {
                let mid = a.lerp(b, 0.5);
                if (p - mid).dot(b - a) >= 0.0 { b } else { a }
            }
        }
    }
}

/// The culet of a cut with this girdle: a keel along the long axis when the stone is longer than
/// wide and the cut is not one that comes to a point.
fn culet_of(cut: &str, poly: &[Vec2], centre: Vec2) -> Culet {
    if matches!(cut, "pear" | "heart" | "trillion" | "triangle" | "cabochon") {
        return Culet::Point(centre);
    }
    let (mut lo, mut hi) = (Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY));
    for p in poly {
        lo = lo.min(*p);
        hi = hi.max(*p);
    }
    let (dx, dy) = (hi.x - lo.x, hi.y - lo.y);
    let (long, short, axis) = if dy >= dx { (dy, dx, Vec2::new(0.0, 1.0)) } else { (dx, dy, Vec2::new(1.0, 0.0)) };
    if !(long.is_finite() && short.is_finite()) || long <= 1.08 * short {
        return Culet::Point(centre);
    }
    // A marquise or an oval keeps a short keel; a step cut's runs the length less the width.
    let share = if matches!(cut, "marquise" | "oval") { 0.6 } else { 1.0 };
    let half = (long - short) / 2.0 * share;
    let keel = Culet::Keel(centre - axis * half, centre + axis * half);
    // The girdle must fall into two runs, one for each end of the keel.
    let n = poly.len();
    let side = |i: usize| poly.get(i % n).is_some_and(|p| (*p - centre).dot(axis) >= 0.0);
    let changes = (0..n).filter(|i| side(*i) != side(i + 1)).count();
    if changes == 2 { keel } else { Culet::Point(centre) }
}

/// A faceted fancy cut: the girdle outline up to a table and down to a point or a keel.
fn fancy_stone(buf: &mut Buf, f: &Frame, poly: &[Vec2], centre: Vec2, depth: f64, table: f64, culet: Culet) {
    let (g, hc, hp) = proportions(depth);
    let lower = buf.ring(poly.iter().map(|p| f.at(p.x, p.y, -g / 2.0)));
    let upper = buf.ring(poly.iter().map(|p| f.at(p.x, p.y, g / 2.0)));
    let top = buf.ring(poly.iter().map(|p| {
        let q = centre + (*p - centre) * table;
        f.at(q.x, q.y, g / 2.0 + hc)
    }));
    let mid = buf.v(f.at(centre.x, centre.y, g / 2.0 + hc));
    buf.bridge(lower, upper);
    buf.bridge(upper, top);
    buf.cap_end(top, mid);
    let zc = -g / 2.0 - hp;
    match culet {
        Culet::Point(c) => {
            let tip = buf.v(f.at(c.x, c.y, zc));
            buf.cap_start(tip, lower);
        }
        Culet::Keel(a, b) => {
            let ka = buf.v(f.at(a.x, a.y, zc));
            let kb = buf.v(f.at(b.x, b.y, zc));
            let n = poly.len();
            let end = |i: usize| -> u32 {
                let p = poly.get(i % n).copied().unwrap_or(centre);
                if (p - a.lerp(b, 0.5)).dot(b - a) >= 0.0 { kb } else { ka }
            };
            for i in 0..n {
                let (here, next) = (end(i), end(i + 1));
                let (i0, i1) = (lower.at(i as u32), lower.at(i as u32 + 1));
                buf.tri(here, i1, i0);
                if here != next {
                    buf.tri(here, next, i1);
                }
            }
        }
    }
}

/// A cabochon: a dome over the girdle outline, flat underneath.
fn cabochon(buf: &mut Buf, f: &Frame, poly: &[Vec2], centre: Vec2, depth: f64, steps: usize) {
    let steps = steps.clamp(2, 16);
    let base = buf.v(f.at(centre.x, centre.y, 0.0));
    let mut prev = buf.ring(poly.iter().map(|p| f.at(p.x, p.y, 0.0)));
    buf.cap_start(base, prev);
    for i in 1..steps {
        let a = (PI / 2.0) * i as f64 / steps as f64;
        let ring = buf.ring(poly.iter().map(|p| {
            let q = centre + (*p - centre) * a.cos();
            f.at(q.x, q.y, depth * a.sin())
        }));
        buf.bridge(prev, ring);
        prev = ring;
    }
    let apex = buf.v(f.at(centre.x, centre.y, depth));
    buf.cap_end(prev, apex);
}

/// An ellipse `width` across x and `length` along y, counter-clockwise.
fn ellipse_polygon(length: f64, width: f64, n: usize) -> Vec<Vec2> {
    let n = n.clamp(8, 512);
    (0..n)
        .map(|i| {
            let a = TAU * i as f64 / n as f64;
            Vec2::new(width / 2.0 * a.cos(), length / 2.0 * a.sin())
        })
        .collect()
}

/// A cut's girdle as a counter-clockwise polygon of at most `max_pts` points, when its outline
/// makes one that every point of can be seen from its centroid.
fn girdle_polygon(cut: &gem::Cut, length: f64, width: f64, max_pts: usize) -> Option<(Vec<Vec2>, Vec2)> {
    let max_pts = max_pts.clamp(16, 512);
    let mut pts: Vec<Vec2> = match gem::outline(cut, length, width) {
        EntityKind::Circle(c) => (0..max_pts)
            .map(|i| {
                let a = TAU * i as f64 / max_pts as f64;
                c.center.xy() + Vec2::new(a.cos(), a.sin()) * c.radius
            })
            .collect(),
        EntityKind::Ellipse(el) => {
            let ellipse = cadcraft_geom::Ellipse::full(el.center.xy(), el.major.xy(), el.ratio);
            (0..max_pts).map(|i| ellipse.at_param(TAU * i as f64 / max_pts as f64)).collect()
        }
        EntityKind::LwPolyline(pl) => {
            let poly = cadcraft_geom::Polyline { vertices: pl.vertices, closed: true };
            let mut tol = 0.002 * length.max(width);
            let mut out = Vec::new();
            // Loosen the chord tolerance until the outline is few enough points.
            for _ in 0..24 {
                out = clean_loop(poly.tessellate(tol));
                if out.len() <= max_pts {
                    break;
                }
                tol *= 1.6;
            }
            out
        }
        _ => return None,
    };
    pts = clean_loop(pts);
    if pts.len() < 3 || pts.len() > max_pts || pts.iter().any(|p| !p.is_finite()) {
        return None;
    }
    let area = cadcraft_geom::shoelace(&pts);
    if !area.is_finite() || area.abs() < 1e-6 {
        return None;
    }
    if area < 0.0 {
        pts.reverse();
    }
    let centre = cadcraft_geom::polygon_centroid(&pts).filter(|c| c.is_finite())?;
    let n = pts.len();
    let visible = (0..n).all(|i| match (pts.get(i), pts.get((i + 1) % n)) {
        (Some(a), Some(b)) => (*a - centre).cross(*b - centre) > 1e-9,
        _ => false,
    });
    visible.then_some((pts, centre))
}

/// A sampled loop without repeated points (the closing one included).
fn clean_loop(pts: Vec<Vec2>) -> Vec<Vec2> {
    let mut out: Vec<Vec2> = Vec::with_capacity(pts.len());
    for p in pts {
        if out.last().is_none_or(|l| l.dist(p) > 1e-4) {
            out.push(p);
        }
    }
    while out.len() > 1 && out.first().zip(out.last()).is_some_and(|(a, b)| a.dist(*b) <= 1e-4) {
        out.pop();
    }
    out
}

/// The outward direction at each vertex of a counter-clockwise polygon.
fn vertex_normals(poly: &[Vec2], centre: Vec2) -> Vec<Vec2> {
    let n = poly.len();
    (0..n)
        .map(|i| {
            let at = |j: usize| poly.get(j % n).copied().unwrap_or(centre);
            let t = (at(i + 1) - at(i + n - 1)).normalized();
            let out = Vec2::new(t.y, -t.x);
            if out.len() > 0.5 { out } else { (at(i) - centre).normalized() }
        })
        .collect()
}

/// `count` points evenly along a closed polygon by length, the first at its first vertex.
fn along_loop(pts: &[Vec2], count: usize) -> Vec<Vec2> {
    let n = pts.len();
    if n < 2 || count == 0 {
        return Vec::new();
    }
    let seg = |i: usize| (pts.get(i % n).copied().unwrap_or(Vec2::ZERO), pts.get((i + 1) % n).copied().unwrap_or(Vec2::ZERO));
    let total: f64 = (0..n)
        .map(|i| {
            let (a, b) = seg(i);
            a.dist(b)
        })
        .sum();
    if !(total.is_finite() && total > 1e-9) {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(count);
    let (mut i, mut before) = (0usize, 0.0f64);
    for k in 0..count {
        let want = total * k as f64 / count as f64;
        loop {
            let (a, b) = seg(i);
            let len = a.dist(b);
            if before + len >= want || i + 1 >= n {
                let t = if len > 1e-12 { ((want - before) / len).clamp(0.0, 1.0) } else { 0.0 };
                out.push(a.lerp(b, t));
                break;
            }
            before += len;
            i += 1;
        }
    }
    out
}

/// A closed polygon with its long edges divided, so no two neighbours are further apart than
/// about one `steps`-th of the way around. Every original vertex is kept.
fn densified(pts: &[Vec2], steps: usize) -> Vec<Vec2> {
    let n = pts.len();
    let steps = steps.clamp(8, 1024);
    let spacing = loop_length(pts) / steps as f64;
    if !(spacing.is_finite() && spacing > 1e-9) {
        return pts.to_vec();
    }
    let mut out = Vec::with_capacity(n + steps);
    for i in 0..n {
        let (Some(a), Some(b)) = (pts.get(i).copied(), pts.get((i + 1) % n).copied()) else { continue };
        let pieces = ((a.dist(b) / spacing).ceil() as usize).clamp(1, steps);
        out.extend((0..pieces).map(|k| a.lerp(b, k as f64 / pieces as f64)));
    }
    out
}

fn loop_length(pts: &[Vec2]) -> f64 {
    let n = pts.len();
    (0..n).map(|i| pts.get(i).zip(pts.get((i + 1) % n)).map_or(0.0, |(a, b)| a.dist(*b))).sum()
}

// ---------------------------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------------------------

/// The parts being built, by name.
#[derive(Default)]
struct Parts {
    band: Buf,
    head: Buf,
    prongs: Buf,
    seat: Buf,
    beads: Buf,
    centre: Buf,
    melee: Buf,
    notes: Vec<String>,
    stones: u32,
}

fn build_solitaire(p: &PieceParams, s: &Sane, d: &Detail, out: &mut Parts) {
    let Some(round_cut) = gem::CUTS.first() else { return };
    let cut = gem::cut_of(&p.cut).unwrap_or(round_cut);
    let (length, width) = (s.stone_length, s.stone_width);
    let cab = cut.name == "cabochon";
    let round = !cab && cut.is_circle(length, width);
    let lesser = length.min(width);
    let depth = fin(gem::default_depth(cut, if round { width } else { lesser }), 0.05, 60.0, 0.6 * lesser);
    let (g, _, hp) = proportions(depth);
    // The girdle in plan: x across the finger's direction of travel, y along the finger.
    let (poly, centre) = if round {
        (ellipse_polygon(width, width, d.outline), Vec2::ZERO)
    } else {
        match girdle_polygon(cut, length, width, d.outline) {
            Some(found) => found,
            None => {
                out.notes.push(format!(
                    "A {} of {}×{} mm has no usable girdle outline; the stone is shown as an oval of that size.",
                    cut.name,
                    size_json(length),
                    size_json(width)
                ));
                (ellipse_polygon(length, width, d.outline), Vec2::ZERO)
            }
        }
    };
    let culet = if round { Culet::Point(Vec2::ZERO) } else { culet_of(cut.name, &poly, centre) };
    let normals = vertex_normals(&poly, centre);
    let below = if cab { 0.0 } else { g / 2.0 + hp };

    // The halo's stones and the plate they sit on, worked out first: the head stands high enough
    // for the plate to clear the band.
    let halo = s.halo.map(|h| {
        let between = s.gap.max(0.15);
        let offset = |by: f64| -> Vec<Vec2> { poly.iter().zip(&normals).map(|(q, n)| *q + *n * by).collect() };
        let track = offset(h / 2.0 + between);
        let fit = (loop_length(&track) / (h + s.gap)).floor();
        let count = if fit.is_finite() { fit.clamp(3.0, f64::from(MAX_PIECE_STONES)) as usize } else { 3 };
        let halo_depth = fin(gem::default_depth(round_cut, h), 0.05, 20.0, 0.6 * h);
        let (hg, _, hhp) = proportions(halo_depth);
        (h, halo_depth, along_loop(&track, count), offset((between - 0.1).max(0.02)), offset(between + h + 0.2), hg / 2.0 + hhp + 0.2)
    });
    let drop = halo.as_ref().map_or(below, |h| below.max(h.5));
    let frame = Frame {
        o: Vec3::new(0.0, s.ro + CULET_CLEARANCE + drop, 0.0),
        u: Vec3::new(1.0, 0.0, 0.0),
        v: Vec3::new(0.0, 0.0, -1.0),
        w: Vec3::new(0.0, 1.0, 0.0),
    };

    if round {
        round_brilliant(&mut out.centre, &frame, width / 2.0, depth, d.centre);
    } else if cab {
        cabochon(&mut out.centre, &frame, &poly, centre, depth, d.dome / 2);
    } else {
        let table = if matches!(cut.name, "emerald" | "baguette" | "rect" | "radiant") { 0.65 } else { 0.60 };
        fancy_stone(&mut out.centre, &frame, &poly, centre, depth, table, culet);
    }
    out.stones += 1;

    // The prongs: where SETTING puts them on this girdle; on a round, evenly.
    let rp = (0.075 * lesser).clamp(0.3, 0.8);
    let rail_r = 0.7 * rp;
    let sites: Vec<Vec2> = if round {
        (0..s.prongs)
            .map(|k| {
                let a = PI / s.prongs as f64 + TAU * k as f64 / s.prongs as f64;
                Vec2::new(a.cos(), a.sin()) * (width / 2.0)
            })
            .collect()
    } else {
        // The corners stay vertices; the straight runs between them get points a prong can stand on.
        let target = setting::Target { outline: densified(&poly, 128), at: Vec2::ZERO, rotation: 0.0, scale: 1.0, cut: Some(cut.name.to_string()) };
        setting::prong_sites(&target, Some(s.prongs)).unwrap_or_default()
    };
    // Half-way down the pavilion, just outside it: where the gallery rail runs.
    let rail_h = -(g / 2.0 + 0.5 * hp);
    let rail_at = |q: Vec2, outward: Vec2| q.lerp(culet.under(q), 0.5) + outward * (1.2 * rail_r);
    for site in sites.iter().filter(|q| q.is_finite()) {
        let dir = (*site - centre).normalized();
        if dir.len() < 0.5 {
            continue;
        }
        // The foot, inside the band's metal and clear of the finger.
        let zmax = (s.width / 2.0 - rp).max(0.0) * if s.dome { 0.6 } else { 1.0 };
        let z = (-site.y * 0.45).clamp(-zmax, zmax);
        let rc = (s.outside_at(z) - 0.5 * rp).max(s.ri + 1.05 * rp);
        let x = (site.x * 0.45).clamp(-0.5 * rc, 0.5 * rc);
        let foot = Vec3::new(x, (rc * rc - x * x).max(0.0).sqrt(), z);
        let seat = *site + dir * (0.7 * rp);
        let tip = *site - dir * (0.15 * rp);
        let mut path = vec![foot];
        if !cab {
            let q = rail_at(*site, dir);
            path.push(frame.at(q.x, q.y, rail_h));
        }
        path.push(frame.at(seat.x, seat.y, 0.0));
        path.push(frame.at(tip.x, tip.y, g / 2.0 + 1.3 * rp));
        capsule(&mut out.prongs, &smooth_path(&path, d.sub), rp, d.radial, d.cap);
    }
    if !cab {
        let rail: Vec<Vec3> = poly
            .iter()
            .zip(&normals)
            .map(|(q, n)| {
                let r = rail_at(*q, *n);
                frame.at(r.x, r.y, rail_h)
            })
            .collect();
        loop_wire(&mut out.head, &rail, frame.w, rail_r, d.radial);
    }

    if let Some((h, halo_depth, centres, inner, outer, plate)) = halo {
        for c in &centres {
            let f = Frame { o: frame.at(c.x, c.y, 0.0), ..frame };
            round_brilliant(&mut out.melee, &f, h / 2.0, halo_depth, d.melee);
            out.stones += 1;
        }
        // The seat: a flat ring under the halo, from just outside the centre stone to just
        // outside the melee.
        let top = -0.04 * h;
        let mut first: Option<Ring> = None;
        let mut prev: Option<Ring> = None;
        for (a, b) in inner.iter().zip(&outer) {
            let ring = out.seat.ring([frame.at(a.x, a.y, -plate), frame.at(a.x, a.y, top), frame.at(b.x, b.y, top), frame.at(b.x, b.y, -plate)]);
            if let Some(q) = prev {
                out.seat.bridge(q, ring);
            }
            first = first.or(Some(ring));
            prev = Some(ring);
        }
        if let (Some(a), Some(b)) = (prev, first) {
            out.seat.bridge(a, b);
        }
        if cut.name == "heart" {
            out.notes.push("Around a heart the halo follows the lobes and the point; in the cleft its stones crowd.".to_string());
        }
    }
    out.notes.push(
        "The band, the gallery rail, the prongs and the halo seat are separate closed shells that pass through each other where they join, \
         and no seat is cut for a stone; a slicer unions them."
            .to_string(),
    );
    if !round && !cab {
        out.notes.push(format!(
            "The {} is its girdle outline tapered to a table and to a {}; its facets are not the cut's own.",
            cut.name,
            if matches!(culet, Culet::Keel(..)) { "keel" } else { "culet" }
        ));
    }
}

fn build_eternity(s: &Sane, d: &Detail, out: &mut Parts) {
    let Some(round_cut) = gem::CUTS.first() else { return };
    let n = s.count.clamp(1, MAX_PIECE_STONES);
    let radius = s.melee / 2.0;
    let depth = fin(gem::default_depth(round_cut, s.melee), 0.05, 20.0, 0.6 * s.melee);
    let (g, _, hp) = proportions(depth);
    let lift = (0.08 * s.melee).max(0.05);
    let girdle_r = s.ro + lift;
    let step = TAU / f64::from(n);
    let radial = |a: f64| Vec3::new(a.cos(), a.sin(), 0.0);
    for k in 0..n {
        let a = PI / 2.0 + step * f64::from(k);
        let w = radial(a);
        let f = Frame { o: w * girdle_r, u: Vec3::new(-a.sin(), a.cos(), 0.0), v: Vec3::Z, w };
        round_brilliant(&mut out.melee, &f, radius, depth, d.melee);
    }
    out.stones += n;

    // Bead prongs, two between each pair of neighbours that are close enough to share them.
    let rb = (0.16 * s.melee).clamp(0.2, 0.5);
    let half_pitch = girdle_r * (PI / f64::from(n)).sin();
    if n >= 2 && half_pitch <= radius + 0.8 * rb {
        let reach = radius + 0.6 * rb;
        let z0 = (reach * reach - half_pitch * half_pitch).max(0.0).sqrt().min((s.width / 2.0 - rb).max(0.0));
        let zs: &[f64] = if z0 < 0.6 * rb { &[0.0] } else { &[-1.0, 1.0] };
        for k in 0..n {
            let w = radial(PI / 2.0 + step * (f64::from(k) + 0.5));
            for sign in zs {
                let z = sign * z0;
                let r = (s.outside_at(z) + lift - 0.2 * rb).max(s.ri + rb + 0.02);
                bead(&mut out.beads, w * r + Vec3::Z * z, w, rb, d.bead_radial, d.bead_lat);
            }
        }
    } else if n >= 2 {
        out.notes.push("The stones stand too far apart to share bead prongs; none are shown.".to_string());
    }
    let fits = (TAU * s.ro / (s.melee + s.gap)).floor();
    if f64::from(n) > fits {
        out.notes.push(format!(
            "{n} stones of {} mm do not fit around this band with {} mm between them (at most {fits:.0} do); they overlap.",
            size_json(s.melee),
            size_json(s.gap)
        ));
    }
    if g / 2.0 + hp - lift > s.wall {
        out.notes.push(format!(
            "The stones' culets reach through the {} mm wall: {} mm stones want a wall of {} mm or more.",
            size_json(s.wall),
            size_json(s.melee),
            size_json(g / 2.0 + hp - lift + 0.3)
        ));
    }
    if s.melee > s.width + 1e-9 {
        out.notes.push(format!("The stones ({} mm) are wider than the band ({} mm).", size_json(s.melee), size_json(s.width)));
    }
    out.notes.push(
        "The band and the bead prongs are separate closed shells that pass through each other, and no seat is cut for a stone; a slicer unions them."
            .to_string(),
    );
}

/// The alloy's colour.
pub(super) fn metal_color(name: &str) -> [u8; 3] {
    match name.trim().to_ascii_lowercase().as_str() {
        "gold24" | "24k" => [255, 198, 52],
        "gold22" | "22k" => [250, 198, 68],
        "gold18" | "18k" => [240, 196, 92],
        "gold14" | "14k" => [233, 197, 112],
        "gold10" | "10k" | "gold9" | "9k" => [226, 198, 130],
        "platinum" | "pt950" => [229, 228, 226],
        "palladium" | "pd950" => [206, 208, 211],
        "silver" | "ag925" | "sterling" => [224, 225, 229],
        "steel" => [176, 180, 186],
        "titanium" => [135, 134, 130],
        "brass" => [201, 170, 82],
        "copper" => [200, 117, 51],
        "wax" => [58, 140, 112],
        _ => [200, 200, 204],
    }
}

/// The stone's colour.
pub(super) fn stone_color(name: &str) -> [u8; 3] {
    match name.trim().to_ascii_lowercase().as_str() {
        "diamond" | "cz" | "moissanite" | "quartz" | "zircon" => [226, 238, 250],
        "sapphire" => [22, 62, 160],
        "ruby" => [176, 16, 44],
        "emerald" => [16, 132, 82],
        "morganite" => [244, 190, 186],
        "aquamarine" => [150, 216, 226],
        "amethyst" => [142, 84, 180],
        "citrine" => [228, 168, 44],
        "topaz" => [112, 184, 228],
        "spinel" => [206, 52, 92],
        "tanzanite" => [78, 70, 172],
        "tourmaline" => [214, 80, 136],
        "garnet" => [124, 22, 30],
        "peridot" => [164, 200, 52],
        "alexandrite" => [52, 132, 122],
        "opal" => [226, 236, 232],
        "pearl" => [240, 234, 220],
        "onyx" => [24, 24, 28],
        "turquoise" => [64, 190, 196],
        "lapis" => [34, 64, 150],
        "jade" => [92, 164, 110],
        "moonstone" => [214, 222, 236],
        "coral" => [240, 112, 88],
        _ => [226, 238, 250],
    }
}

fn build(p: &PieceParams, level: usize) -> PieceMesh {
    let d = DETAILS.get(level).or(DETAILS.last()).copied().unwrap_or(Detail {
        band: 48,
        dome: 8,
        centre: 1,
        melee: 1,
        outline: 24,
        radial: 6,
        cap: 2,
        sub: 2,
        bead_radial: 5,
        bead_lat: 3,
    });
    let s = Sane::of(p);
    let mut parts = Parts::default();
    build_band(&mut parts.band, &s, &d);
    match s.kind {
        PieceKind::Band => {}
        PieceKind::Solitaire => build_solitaire(p, &s, &d, &mut parts),
        PieceKind::Eternity => build_eternity(&s, &d, &mut parts),
    }
    let metal = metal_color(&p.metal);
    let stone = stone_color(&p.stone);
    let meshes = [
        parts.band.part("metal", "band", metal),
        parts.head.part("metal", "head", metal),
        parts.prongs.part("metal", "prongs", metal),
        parts.seat.part("metal", "halo seat", metal),
        parts.beads.part("metal", "beads", metal),
        parts.centre.part("stone", "centre stone", stone),
        parts.melee.part("stone", "melee", stone),
    ]
    .into_iter()
    .flatten()
    .collect();
    PieceMesh { meshes, notes: parts.notes, stones: parts.stones, level, over: false }
}

fn piece_mesh_within(p: &PieceParams, quality: Quality, budget: Budget) -> PieceMesh {
    let start = quality.level();
    let mut mesh = build(p, start);
    let fits = |m: &PieceMesh| m.counted(budget.stones) <= budget.triangles && budget.json.is_none_or(|max| m.json_estimate() <= max);
    let mut level = start;
    while !fits(&mesh) && level + 1 < DETAILS.len() {
        level += 1;
        mesh = build(p, level);
    }
    if level != start {
        mesh.notes.push(format!(
            "The piece is too large to send at {} quality; it is tessellated more coarsely (level {level} of {}) to stay under {} triangles{}.",
            quality.name(),
            DETAILS.len() - 1,
            budget.triangles,
            if budget.json.is_some() { " and 4 MB" } else { "" }
        ));
    }
    mesh.over = !fits(&mesh);
    mesh
}

/// The piece as a solid for a viewport: at most [`MAX_TRIANGLES`] triangles and about 4 MB of
/// JSON, coarser than asked when it must be (the notes say so).
pub(super) fn piece_mesh(p: &PieceParams, quality: Quality) -> PieceMesh {
    piece_mesh_within(p, quality, Budget { triangles: MAX_TRIANGLES, json: Some(MAX_JSON_ESTIMATE), stones: true })
}

// ---------------------------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------------------------

/// The triangles an STL carries: the metal, and the stones when asked. A triangle with no area
/// has no normal and is left out; the count of those comes back too.
pub(super) fn stl_triangles(mesh: &PieceMesh, stones: bool) -> (Vec<[Vec3; 4]>, usize) {
    let mut out = Vec::with_capacity(mesh.counted(stones));
    let mut dropped = 0usize;
    for m in mesh.meshes.iter().filter(|m| stones || m.part == "metal") {
        let at = |i: &u32| m.positions.get(*i as usize).copied();
        for t in m.indices.chunks_exact(3) {
            let (Some(a), Some(b), Some(c)) = (t.first().and_then(at), t.get(1).and_then(at), t.get(2).and_then(at)) else { continue };
            let normal = (b - a).cross(c - a);
            let len = normal.len();
            if !(len.is_finite() && len > 1e-12 && a.is_finite() && b.is_finite() && c.is_finite()) {
                dropped += 1;
                continue;
            }
            out.push([normal * (1.0 / len), a, b, c]);
        }
    }
    (out, dropped)
}

/// A binary STL: an 80-byte header, the triangle count, then each triangle's normal and three
/// vertices as little-endian `f32` and a zero attribute word — 84 + 50·n bytes.
pub(super) fn stl_binary(tris: &[[Vec3; 4]], title: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(84 + tris.len() * 50);
    let mut header = [0u8; 80];
    // A binary file must not begin with the word an ASCII one does.
    let text = format!("CADCraft binary STL, millimetres: {title}");
    for (slot, byte) in header.iter_mut().zip(text.bytes().filter(u8::is_ascii)) {
        *slot = byte;
    }
    out.extend_from_slice(&header);
    out.extend_from_slice(&u32::try_from(tris.len()).unwrap_or(u32::MAX).to_le_bytes());
    for t in tris {
        for v in t {
            for c in [v.x, v.y, v.z] {
                out.extend_from_slice(&(c as f32).to_le_bytes());
            }
        }
        out.extend_from_slice(&0u16.to_le_bytes());
    }
    out
}

/// An ASCII STL.
pub(super) fn stl_ascii(tris: &[[Vec3; 4]], title: &str) -> String {
    use std::fmt::Write;
    let name: String = title.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).collect();
    let mut out = String::with_capacity(64 + tris.len() * 220);
    let _ = writeln!(out, "solid {name}");
    for [n, a, b, c] in tris {
        let _ = writeln!(out, "  facet normal {} {} {}", n.x as f32, n.y as f32, n.z as f32);
        out.push_str("    outer loop\n");
        for v in [a, b, c] {
            let _ = writeln!(out, "      vertex {} {} {}", v.x as f32, v.y as f32, v.z as f32);
        }
        out.push_str("    endloop\n  endfacet\n");
    }
    let _ = writeln!(out, "endsolid {name}");
    out
}

// ---------------------------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------------------------

const PIECE_KEYS: &str = "kind: band|solitaire|eternity, system?, size? (default US 6), wall?: mm (1.8), width?: mm (2.2), profile?: flat|dome, \
    metal? (gold18), cut? (round), stoneWidth?: mm (6.5), stoneLength?: mm, stone? (diamond), prongs?: 3–8 (6), halo?: bool | melee mm, \
    melee?: mm (1.8), count?: stones (default: as many as fit), gap?: mm (0.2)";

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("piecemesh", "Piece as a Solid", run_piecemesh)
            .params(
                "{kind: band|solitaire|eternity, …the piece's parameters as PIECE takes them (size, wall, width, profile, metal, cut, stoneWidth, \
                 stoneLength, stone, prongs, halo, melee, count, gap), quality?: draft|fine (default draft)} → {meshes: [{part: metal|stone, name, \
                 color: [r,g,b], positions: [x,y,z,…] mm, indices: [i,j,k,…]}], bounds: {min, max}, triangles, size, kind, params, quality, level, stones, \
                 metal: {name, density, volumeMm3, grams}, notes}: the piece as closed shells of triangles (finger axis Z, head at +Y), at most \
                 150,000; changes nothing",
            )
            .enabled(always)
            .noundo(),
        CommandSpec::new("stlout", "STL Out", run_stlout)
            .alias(&["stlexport"])
            .params(
                "{kind: band|solitaire|eternity, …the piece's parameters as PIECE takes them, stones?: bool (default false: the metal only, which \
                 is what is cast), quality?: draft|fine (default fine), binary?: bool (default true)} → {format: stl-binary|stl-ascii, \
                 base64 | text, bytes, triangles, name, quality, notes}: the piece as an STL in millimetres; changes nothing",
            )
            .enabled(always)
            .noundo(),
    ]
}

/// The piece a mesh command was handed. With no `kind` there is nothing to build.
fn piece_of(cmd: &str, p: &Value) -> Result<PieceParams> {
    if str_param(p, "kind").is_none() {
        return Err(bad(cmd, format!("there is no piece to show: give `kind` (band, solitaire or eternity) and its parameters ({PIECE_KEYS})")));
    }
    PieceParams::parse(cmd, p)
}

fn run_piecemesh(_s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "piecemesh";
    let piece = piece_of(cmd, p)?;
    let quality = Quality::parse(cmd, p, Quality::Draft)?;
    let mesh = piece_mesh(&piece, quality);
    let (lo, hi) = mesh.bounds();
    let volume = mesh.metal_volume();
    let meshes: Vec<Value> = mesh
        .meshes
        .iter()
        .map(|m| {
            let positions: Vec<f64> = m.positions.iter().flat_map(|v| [r3(v.x), r3(v.y), r3(v.z)]).collect();
            json!({ "part": m.part, "name": m.name, "color": m.color, "positions": positions, "indices": m.indices })
        })
        .collect();
    Ok(json!({
        "meshes": meshes,
        "bounds": { "min": lo, "max": hi },
        "triangles": mesh.triangles(),
        "size": piece.size.json(),
        "kind": piece.kind.name(),
        "params": piece.json(),
        "quality": quality.name(),
        "level": mesh.level,
        "stones": mesh.stones,
        "metal": {
            "name": piece.metal,
            "density": piece.density,
            "volumeMm3": r3(volume),
            "grams": r3(volume / 1000.0 * piece.density),
        },
        "notes": mesh.notes,
    }))
}

fn run_stlout(_s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "stlout";
    let piece = piece_of(cmd, p)?;
    let quality = Quality::parse(cmd, p, Quality::Fine)?;
    let stones = bool_or(p, "stones", false);
    let binary = bool_or(p, "binary", true);
    let budget = Budget { triangles: if binary { MAX_TRIANGLES } else { MAX_ASCII_TRIANGLES }, json: None, stones };
    let mesh = piece_mesh_within(&piece, quality, budget);
    if mesh.over {
        return Err(bad(cmd, format!("this piece is more than {} triangles, too many for an ASCII STL; ask for the binary one", budget.triangles)));
    }
    let (tris, dropped) = stl_triangles(&mesh, stones);
    let mut notes = mesh.notes;
    if dropped > 0 {
        notes.push(format!("{dropped} triangles with no area were left out."));
    }
    if piece.wall < MIN_CAST_WALL {
        notes.push(format!("A {} mm wall is thinner than a bench casts ({MIN_CAST_WALL} mm).", size_json(piece.wall)));
    }
    notes.push(if stones { "The stones are included as shells of their own." } else { "The metal only: the stones are left out." }.to_string());
    let title = format!("{}-us{}-{}", piece.kind.name(), fmt_mm(piece.size.us), piece.metal);
    let name = format!("{title}.stl");
    let mut reply = json!({
        "triangles": tris.len(),
        "name": name,
        "quality": quality.name(),
        "units": "mm",
        "notes": notes,
    });
    if binary {
        let bytes = stl_binary(&tris, &title);
        reply["format"] = json!("stl-binary");
        reply["bytes"] = json!(bytes.len());
        reply["base64"] = json!(super::file::base64_encode(&bytes));
    } else {
        let text = stl_ascii(&tris, &title);
        reply["format"] = json!("stl-ascii");
        reply["bytes"] = json!(text.len());
        reply["text"] = json!(text);
    }
    Ok(reply)
}
