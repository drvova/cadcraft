//! `PIECEMESH` and `STLOUT`: a parametric ring as a solid, from [`PieceParams`].
//!
//! `PIECEMESH` answers with triangles for a 3D viewport and `STLOUT` with an STL for the caster.
//! Both read the piece's parameters straight from their JSON, build the same solid and change
//! nothing in the drawing. Everything is millimetres. The finger's axis is Z, the ring lies in
//! the XY plane centred on the origin, and the head (12 o'clock) is at +Y.
//!
//! # The solids
//!
//! The solid is the same piece `PIECE` draws as a sheet: every number the two share — the band's
//! section and weight, a stone's proportions, a solitaire's seat, prongs and halo, an eternity
//! band's count and seat — is worked out in [`super::piece_params`], where each is defined, and
//! only built here.
//!
//! **Band.** The section ([`Section`]) revolved about Z, centred on Z = 0, from the inside radius
//! `size.diameter / 2` to that plus `wall`. Flat: the rectangle `width` × `wall`, edges sharp.
//! Dome: a half-round — a circular arc over the full width rising to the wall, on straight sides
//! of `wall − width/2` when the wall is more than half the width — sampled evenly along its arc,
//! so the mesh is inscribed in the solid whose volume `PIECE` weighs. Comfort and court: the same
//! with the finger side eased (an arc that touches the finger in the middle, sampled likewise).
//! Knife and bevel: their flat faces, exactly. Concave: the hollow as the tangents to its arc, so
//! that mesh too is inscribed. Every profile is the one the shared module defines.
//!
//! **Stones.** A stone is as deep as `GEM` has its cut, split crown 26 %, girdle 4 %, pavilion
//! 70 %, under the table `GEM` draws for the cut. A round is a brilliant: an eight-sided table,
//! eight stars, eight bezel kites (planar), sixteen upper-girdle facets, the girdle, sixteen
//! lower-girdle facets and eight pavilion mains to the culet. Every other cut is its own girdle
//! outline (`gem::outline`) tapered up to a table (the outline scaled about its centroid) and
//! down to a culet point (pear, heart, trillion, and anything as long as wide) or to a keel line
//! along the long axis. A cabochon is a dome on a flat base.
//!
//! **Solitaire.** The band, and on top of it at +Y the centre stone, its length along the finger,
//! its culet 0.5 mm above the band ([`Head`]). The prongs are round wire of the shared diameter
//! (15 % of the stone's lesser dimension, 0.8–1.2 mm), from inside the band, through a gallery
//! rail half-way down the pavilion, up through the girdle and over it by 1.15 wire diameters,
//! capped with a hemisphere. They stand on the girdle at the shared sites (where `SETTING` puts
//! them; evenly on a round, starting half a step off the band's direction). A halo is round
//! diamonds of width `halo` at the shared sites — on the girdle offset by half the prong wire,
//! `gap` and half a melee, as many as keep `gap` between every pair — on a seat plate.
//!
//! **Three-stone.** A solitaire's band and centre stone, and one side stone each side of it around
//! the band at the shared angle ([`shared::Sides`]): each in a head of its own that stands along
//! its own radius as the centre's stands at +Y, with its own prongs and gallery rail. The side
//! stones are the part `side stones`. Side stones that do not clear the centre stone within the
//! limit — which `PIECE` refuses — are still built, at the limit, and the notes say so.
//!
//! **Eternity.** The band and its stones in the piece's cut, `melee` wide, evenly around the
//! outside ([`Row`]): stone `i` of `n` is `2π·i/n` clockwise from 12 o'clock seen from +Z, its
//! table level with the band's outside and its pavilion in the band. With no `count`, as many as
//! keep `gap` of metal between neighbouring girdles (the number `PIECE` reports as `fits`). A
//! `count` that does not fit — which `PIECE` refuses — is still built, because this is a viewer,
//! and the reply's `notes` say so. Between neighbours close enough to share them stand two bead
//! prongs.
//!
//! # Shells
//!
//! Every part is a closed shell, wound counter-clockwise seen from outside. The band, the rail,
//! the prongs, the halo seat and the beads are separate shells that pass through each other where
//! they join, and stone seats are not cut from the metal: that is how such a model is commonly
//! handed to a caster's slicer, which unions them.
//!
//! # Metal weight
//!
//! `metal.grams` and `metal.volumeMm3` are the band alone, exactly: the figure `PIECE` reports,
//! from the same function ([`PieceParams::band_grams`]). `metal.shells` is the sum of the
//! tessellated metal shells (band, rail, prongs, halo seat, beads) — approximate, and where
//! shells overlap it counts the overlap twice. It is not a second metal weight.
//!
//! # Limits
//!
//! A reply holds at most [`MAX_TRIANGLES`] triangles and `PIECEMESH` stays under about 4 MB of
//! JSON. A piece that would exceed either is built again at a coarser tessellation (never cut off
//! part-way through a surface) and the reply's `notes` say so.

use cadcraft_doc::EntityKind;
use cadcraft_geom::{PI, TAU, Vec2, Vec3};
use serde_json::{Value, json};

#[path = "mesh_kinds.rs"]
mod mesh_kinds;

use super::super::*;
use super::heads::BezelBound;
use super::piece_params::{self as shared, Head, MAX_PIECE_STONES, MIN_CAST_WALL, PieceKind, PieceParams, Profile, Row, Section, proportions};
use super::sizes::RingSize;
use super::solid::{self as solid, Axes, Csg, Envelope, Outline, Prim, Solid, solidify};
use super::*;

/// The most triangles a reply holds.
pub(super) const MAX_TRIANGLES: usize = 150_000;
/// The estimated JSON size `PIECEMESH` builds to (the reply itself stays under about 4 MB).
const MAX_JSON_ESTIMATE: usize = 3_600_000;
/// The most triangles an ASCII STL holds (about 200 bytes each).
const MAX_ASCII_TRIANGLES: usize = 30_000;

// Seats. These are this project's approximation of a bench's usual figures, as its authors
// understand them — not taken from a cited standard.

/// The gap left all round a stone in its seat (and in the bearing cut into its prongs), mm.
const SEAT_CLEARANCE: f64 = 0.05;
/// A centre stone's clearance hole under its culet: its radius as a fraction of the girdle's
/// inradius.
const CULET_HOLE: f64 = 0.3;
/// How far past the culet's clearance over the band the culet hole reaches, mm (into the band when
/// the head stands low).
const CULET_POCKET: f64 = 0.25;
/// A set melee's (halo, eternity) through-hole for light and cleaning: its radius as a fraction of
/// the girdle's radius (a hole about half the stone's diameter).
const PAVE_HOLE: f64 = 0.5;
/// How far a melee's bore (the girdle-sized opening it is set through) reaches past the metal, mm.
const BORE_OVER: f64 = 1.0;
/// How far under a halo seat's plate a melee's through-hole reaches, mm.
const HOLE_OVER: f64 = 0.5;

/// How far a star facet reaches from the table's edge to the girdle.
const STAR_LENGTH: f64 = 0.5;
/// Where the lower-girdle facets meet, as a fraction of the way in from the girdle.
const LOWER_HALF: f64 = 0.77;

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
    /// Eternity: the most stones that fit at the gap (what `PIECE` reports as `fits`).
    pub fits: Option<u32>,
    /// The tessellation level it was built at (0 fine, 1 draft, 2 and 3 coarser).
    pub level: usize,
    /// Even the coarsest level is over the budget (never so for `PIECEMESH`).
    pub over: bool,
    /// The metal as a construction of analytic parts, seats cut, for the merged solid.
    pub csg: Csg,
    /// How many stone seats `csg` cuts.
    pub seats: u32,
}

impl PieceMesh {
    pub(super) fn triangles(&self) -> usize {
        self.meshes.iter().map(PartMesh::triangles).sum()
    }
    /// The tessellated metal shells' volume in cubic millimetres (overlaps counted twice): an
    /// approximation, not the piece's metal weight.
    pub(super) fn shells_volume(&self) -> f64 {
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

/// A piece with every number made safe to build from, whatever it was given. Parameters that
/// came through the parser are already inside these limits, so for them nothing changes.
struct Sane {
    p: PieceParams,
    /// The finger's radius, and the radius of the band's outside in the middle of its width
    /// (where a stone stands).
    ri: f64,
    top: f64,
    section: Section,
}

fn fin(x: f64, lo: f64, hi: f64, default: f64) -> f64 {
    if x.is_finite() { x.clamp(lo, hi) } else { default }
}

impl Sane {
    fn of(p: &PieceParams) -> Sane {
        let mut q = p.clone();
        if !(q.size.diameter.is_finite() && (2.0..=100.0).contains(&q.size.diameter))
            && let Some(six) = RingSize::from_us(6.0)
        {
            q.size = six;
        }
        q.wall = fin(p.wall, 0.05, 20.0, 1.8);
        q.width = fin(p.width, 0.1, 60.0, 2.2);
        q.stone_length = fin(p.stone_length, 0.1, 60.0, 6.5);
        q.stone_width = fin(p.stone_width, 0.1, 60.0, 6.5);
        q.prongs = p.prongs.clamp(2, 12);
        q.halo = p.halo.filter(|h| h.is_finite()).map(|h| h.clamp(0.1, 10.0));
        q.melee = fin(p.melee, 0.1, 20.0, 1.8);
        q.gap = fin(p.gap, 0.0, 20.0, 0.2);
        q.count = p.count.map(|n| n.clamp(1, MAX_PIECE_STONES));
        q.side_width = p.side_width.filter(|x| x.is_finite()).map(|x| x.clamp(0.1, 60.0));
        q.side_length = p.side_length.filter(|x| x.is_finite()).map(|x| x.clamp(0.1, 60.0));
        q.side_prongs = p.side_prongs.clamp(2, 12);
        q.side_cut = p.side_cut.clone().filter(|name| gem::cut_of(name).is_some());
        q.bezel_wall = p.bezel_wall.filter(|x| x.is_finite()).map(|x| x.clamp(0.05, 5.0));
        q.bezel_height = p.bezel_height.filter(|x| x.is_finite()).map(|x| x.clamp(0.0, 10.0));
        q.top_width = p.top_width.filter(|x| x.is_finite()).map(|x| x.clamp(0.1, 60.0));
        q.top_wall = p.top_wall.filter(|x| x.is_finite()).map(|x| x.clamp(0.05, 20.0));
        q.face_length = fin(p.face_length, 1.0, 60.0, 12.0);
        q.face_width = fin(p.face_width, 1.0, 60.0, 10.0);
        if gem::cut_of(&q.cut).is_none() {
            q.cut = "round".to_string();
        }
        let ri = fin(q.inner() / 2.0, 1.0, 50.0, 8.255);
        let section = q.section();
        let top = fin(ri + section.height_at(0.0), ri, ri + q.wall, ri + q.wall);
        Sane { ri, top, section, p: q }
    }
    /// The band's outside radius at `z` along the finger.
    fn outside_at(&self, z: f64) -> f64 {
        self.ri + self.section.height_at(z)
    }
}

/// The band's section as (radius, z), in the order that faces the revolved surface outward: the
/// shared [`Section`] as a polygon inscribed in it, its arcs sampled evenly along themselves.
fn band_section(s: &Sane, d: &Detail) -> Vec<(f64, f64)> {
    let m = (d.dome.clamp(2, 256) / 2) * 2;
    let mut polygon = s.section.polygon(m);
    if polygon.len() < 3 {
        // A section too slight to have a shape is the rectangle around it.
        polygon = Section::flat(s.p.width, s.p.wall).polygon(m);
    }
    polygon.iter().map(|q| (s.ri + q.y, q.x)).collect()
}

/// The band's section for the merged solid: finer than any tessellation level.
const SOLID_SECTION: usize = 128;

fn build_band(buf: &mut Buf, csg: &mut Csg, s: &Sane, d: &Detail) {
    let fine = Detail { dome: SOLID_SECTION, ..*d };
    csg.add.push(Prim::Revolve(solid::Section::new(band_section(s, &fine).iter().map(|(r, z)| Vec2::new(*r, *z)).collect())));
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

/// A round brilliant of `radius` under a table `table` of its diameter (corner to corner), `k`
/// girdle points to each sixteenth.
fn round_brilliant(buf: &mut Buf, f: &Frame, radius: f64, depth: f64, table: f64, k: usize) {
    if !(radius.is_finite() && depth.is_finite() && radius > 1e-6 && depth > 1e-6) {
        return;
    }
    let table = fin(table, 0.3, 0.8, 0.57);
    let k = k.clamp(1, 8) as u32;
    let (g, hc, hp) = proportions(depth);
    let n = 16 * k;
    let e = PI / 8.0;
    let polar = |r: f64, a: f64, h: f64| f.at(r * a.cos(), r * a.sin(), h);
    let (zg, zt, zc) = (g / 2.0, g / 2.0 + hc, -g / 2.0 - hp);
    let rt = table * radius;
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

// ---------------------------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------------------------

fn axes_of(f: &Frame) -> Axes {
    Axes { o: f.o, u: f.u, v: f.v, w: f.w }
}

/// The room a stone takes in its seat: its girdle, crown and pavilion (a cabochon's dome) grown by
/// [`SEAT_CLEARANCE`], and a bore of `bore` over the girdle when it is set from above.
fn seat_envelope(shape: &StoneShape, frame: &Frame, girdle: f64, crown: f64, pavilion: f64, bore: Option<f64>) -> Envelope {
    let (outline, reach) = if shape.round {
        (Outline::Circle(shape.width / 2.0), shape.width / 2.0)
    } else {
        let r = -super::solid::poly_dist(&shape.poly, shape.centre);
        (Outline::Poly(shape.poly.clone()), if r.is_finite() { r.max(0.0) } else { 0.0 })
    };
    Envelope {
        axes: axes_of(frame),
        outline,
        reach,
        girdle,
        crown,
        pavilion,
        table: shape.table,
        cab: shape.cab,
        clearance: SEAT_CLEARANCE,
        bore,
        profile: Vec::new(),
        span: (0.0, 0.0),
    }
}

/// Fits a seat to its stone as built at this level and at the finest one (`make` builds the stone
/// at a level's detail into a buffer), so the room holds the stone however it is tessellated.
fn fit_seat(envelope: &mut Envelope, d: &Detail, make: &dyn Fn(&mut Buf, &Detail)) {
    let mut buf = Buf::default();
    make(&mut buf, d);
    if let Some(fine) = DETAILS.first() {
        make(&mut buf, fine);
    }
    envelope.fit(&buf.pos);
}

/// The parts being built, by name.
#[derive(Default)]
struct Parts {
    band: Buf,
    head: Buf,
    prongs: Buf,
    seat: Buf,
    beads: Buf,
    bezel: Buf,
    face: Buf,
    centre: Buf,
    sides: Buf,
    melee: Buf,
    /// Pavé on the band ([`super::pave_band`]).
    pave: Buf,
    notes: Vec<String>,
    stones: u32,
    fits: Option<u32>,
    csg: Csg,
    seats: u32,
}

impl Parts {
    /// A note said once, however many stones it is true of.
    fn note(&mut self, text: String) {
        if !self.notes.contains(&text) {
            self.notes.push(text);
        }
    }
}

/// A stone's shape in its own plan (x across, y along its length), ready to build at any frame
/// whose origin is on the girdle's plane (a cabochon's base).
struct StoneShape {
    /// A brilliant: the girdle is a circle.
    round: bool,
    cab: bool,
    poly: Vec<Vec2>,
    centre: Vec2,
    culet: Culet,
    width: f64,
    depth: f64,
    /// The table as a fraction of the width.
    table: f64,
    /// The cut had no usable outline at this size; an oval stands in for it.
    stand_in: bool,
}

impl StoneShape {
    fn of(cut: &gem::Cut, length: f64, width: f64, depth: f64, max_pts: usize) -> StoneShape {
        let cab = cut.name == "cabochon";
        let round = !cab && cut.is_circle(length, width);
        let (poly, centre, stand_in) = if round {
            (ellipse_polygon(width, width, max_pts), Vec2::ZERO, false)
        } else {
            match girdle_polygon(cut, length, width, max_pts) {
                Some((poly, centre)) => (poly, centre, false),
                None => (ellipse_polygon(length, width, max_pts), Vec2::ZERO, true),
            }
        };
        let culet = if round { Culet::Point(Vec2::ZERO) } else { culet_of(cut.name, &poly, centre) };
        StoneShape { round, cab, poly, centre, culet, width, depth, table: shared::table_ratio(cut), stand_in }
    }

    /// One closed shell: `k` girdle points to a sixteenth of a brilliant, `steps` up a cabochon.
    fn build(&self, buf: &mut Buf, f: &Frame, k: usize, steps: usize) {
        if self.round {
            round_brilliant(buf, f, self.width / 2.0, self.depth, self.table, k);
        } else if self.cab {
            cabochon(buf, f, &self.poly, self.centre, self.depth, steps);
        } else {
            fancy_stone(buf, f, &self.poly, self.centre, self.depth, self.table, self.culet);
        }
    }
}

/// A stone to stand on the band in a head of its own.
struct Standing<'a> {
    cut: &'static gem::Cut,
    length: f64,
    width: f64,
    head: Head,
    /// Where its prongs stand on its girdle, or why none are shown.
    sites: Result<Vec<Vec2>>,
    /// The outward direction it stands along, in the ring's plane (12 o'clock is +y).
    out: Vec2,
    /// Its name in a note.
    what: &'a str,
    /// One of a three-stone ring's side stones, not the centre stone.
    side: bool,
}

/// A head as built: the stone's shape, the frame of its girdle plane and its girdle's outward
/// directions.
struct Stood {
    shape: StoneShape,
    frame: Frame,
    normals: Vec<Vec2>,
}

/// One stone in its prong head, standing on the band along its own radius: the stone, its prongs
/// from inside the band's metal up over the girdle, and the gallery rail around its pavilion.
fn build_head(s: &Sane, d: &Detail, out: &mut Parts, stone: Standing) -> Stood {
    let p = &s.p;
    let (cut, head) = (stone.cut, stone.head);
    let shape = StoneShape::of(cut, stone.length, stone.width, head.depth, d.outline);
    if shape.stand_in {
        out.note(format!(
            "A {} of {}×{} mm has no usable girdle outline; the {} is shown as an oval of that size.",
            cut.name,
            size_json(stone.length),
            size_json(stone.width),
            stone.what
        ));
    }
    let (poly, centre, culet, cab) = (&shape.poly, shape.centre, shape.culet, shape.cab);
    let normals = vertex_normals(poly, centre);
    let (g, hp) = (head.girdle, if cab { 0.0 } else { proportions(head.depth).2 });
    // The girdle's plane: x around the band, y along the finger, the table facing outward.
    let w = Vec3::new(stone.out.x, stone.out.y, 0.0);
    let frame = Frame { o: w * (s.top + head.girdle_height()), u: Vec3::new(stone.out.y, -stone.out.x, 0.0), v: Vec3::new(0.0, 0.0, -1.0), w };
    shape.build(if stone.side { &mut out.sides } else { &mut out.centre }, &frame, d.centre, d.dome / 2);
    out.stones += 1;
    if let Some(bezel) = head.bezel {
        // A bezel's collar takes the prongs' and the rail's place.
        mesh_kinds::build_bezel(&mut out.bezel, &frame, &shape.poly, &normals, &bezel);
        out.csg.add.push(Prim::Bezel(BezelBound { o: frame.o, u: frame.u, v: frame.v, w: frame.w, girdle: shape.poly.clone(), bezel }));
        // The seat: the stone's own room, cut from the collar's ledge and anything under it.
        let (girdle, crown, pavilion) = if cab { (0.0, head.depth, 0.0) } else { proportions(head.depth) };
        let mut envelope = seat_envelope(&shape, &frame, girdle, crown, pavilion, None);
        fit_seat(&mut envelope, d, &|b, dd| {
            StoneShape::of(cut, stone.length, stone.width, head.depth, dd.outline).build(b, &frame, dd.centre, dd.dome / 2)
        });
        if envelope.reach > 1e-6 {
            out.csg.cut.push(Prim::Seat(envelope));
            out.seats += 1;
        }
        return Stood { shape, frame, normals };
    }

    // The prongs: on the girdle where the sheet draws them.
    let rp = head.prong / 2.0;
    let rail_r = 0.7 * rp;
    let sites = stone.sites.unwrap_or_else(|e| {
        out.note(format!("No prongs are shown on the {}: {e}.", stone.what));
        Vec::new()
    });
    // Half-way down the pavilion, just outside it: where the gallery rail runs.
    let rail_h = -(g / 2.0 + 0.5 * hp);
    let rail_at = |q: Vec2, outward: Vec2| q.lerp(culet.under(q), 0.5) + outward * (1.2 * rail_r);
    // The wire's axis ends its own radius under the tips' height.
    let tip_h = head.prong_height() - head.girdle_height() - rp;
    for site in sites.iter().filter(|q| q.is_finite()) {
        let dir = (*site - centre).normalized();
        if dir.len() < 0.5 {
            continue;
        }
        // The foot, inside the band's metal and clear of the finger: worked out as at 12 o'clock
        // and turned to where the head stands.
        let zmax = (p.width / 2.0 - rp).max(0.0) * if s.section.profile == Profile::Flat { 1.0 } else { 0.6 };
        let z = (-site.y * shared::PRONG_FOOT).clamp(-zmax, zmax);
        let rc = (s.outside_at(z) - 0.5 * rp).max(s.ri + 1.05 * rp);
        let x = (site.x * shared::PRONG_FOOT).clamp(-0.5 * rc, 0.5 * rc);
        let y = (rc * rc - x * x).max(0.0).sqrt();
        let foot = frame.u * x + frame.w * y + Vec3::new(0.0, 0.0, z);
        let tip = *site - dir * (0.85 * rp);
        let mut path = vec![foot];
        if !cab {
            let q = rail_at(*site, dir);
            path.push(frame.at(q.x, q.y, rail_h));
        }
        path.push(frame.at(site.x, site.y, 0.0));
        path.push(frame.at(tip.x, tip.y, tip_h));
        let wire = smooth_path(&path, d.sub);
        capsule(&mut out.prongs, &wire, rp, d.radial, d.cap);
        out.csg.add.push(Prim::Wire { pts: wire, r: rp, closed: false });
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
        out.csg.add.push(Prim::Wire { pts: rail, r: rail_r, closed: true });
    }
    // The seat: the stone's own room in the prongs and the rail (the bearing), and a clearance
    // hole under the culet.
    let (girdle, crown, pavilion) = if cab { (0.0, head.depth, 0.0) } else { proportions(head.depth) };
    let mut envelope = seat_envelope(&shape, &frame, girdle, crown, pavilion, None);
    fit_seat(&mut envelope, d, &|b, dd| {
        StoneShape::of(cut, stone.length, stone.width, head.depth, dd.outline).build(b, &frame, dd.centre, dd.dome / 2)
    });
    if let Some(reach) = (envelope.reach > 1e-6).then_some(envelope.reach) {
        if !cab {
            let at = Axes { o: frame.at(centre.x, centre.y, 0.0), ..envelope.axes };
            let culet = -girdle / 2.0 - pavilion;
            out.csg.cut.push(Prim::Cylinder {
                axes: at,
                r: CULET_HOLE * reach,
                lo: culet - head.clear - CULET_POCKET,
                hi: -girdle / 2.0 - 0.5 * pavilion,
            });
        }
        out.csg.cut.push(Prim::Seat(envelope));
        out.seats += 1;
    }
    if !shape.round && !cab {
        out.note(format!(
            "The {}{} is its girdle outline tapered to a table and to a {}; its facets are not the cut's own.",
            cut.name,
            if stone.side { " side stone" } else { "" },
            if matches!(culet, Culet::Keel(..)) { "keel" } else { "culet" }
        ));
    }
    Stood { shape, frame, normals }
}

fn build_solitaire(s: &Sane, d: &Detail, out: &mut Parts) {
    let p = &s.p;
    let Some(cut) = p.cut_data() else { return };
    let Some(round_cut) = gem::CUTS.first() else { return };
    // The seat: how deep the stone is, how high it stands, its prong wire and its halo.
    let head: Head = p.head();
    if let Err(e) = p.centre_stone("piecemesh") {
        out.notes.push(format!("PIECE does not draw this stone ({e}); it is shown as asked."));
    }
    let centre = Standing {
        cut,
        length: p.stone_length,
        width: p.stone_width,
        head,
        sites: p.prong_sites(),
        out: Vec2::new(0.0, 1.0),
        what: "stone",
        side: false,
    };
    let Stood { shape, frame, normals } = build_head(s, d, out, centre);
    let poly = &shape.poly;

    if p.kind == PieceKind::ThreeStone {
        // One side stone each side of the centre, around the band, in its own head.
        let sides = p.sides();
        if let Err(e) = p.side_stone("piecemesh") {
            out.notes.push(format!("PIECE does not draw these side stones ({e}); they are shown as asked."));
        }
        if let Some(side_cut) = p.side_cut_data() {
            for side in [1.0, -1.0] {
                let beside = Standing {
                    cut: side_cut,
                    length: sides.length,
                    width: sides.width,
                    head: sides.head,
                    sites: p.side_prong_sites(),
                    out: sides.out(side),
                    what: "side stone",
                    side: true,
                };
                build_head(s, d, out, beside);
            }
        }
        if !sides.fits {
            out.notes.push(format!(
                "Side stones of {}×{} mm do not clear the centre stone within {}° of the top with {} mm between their settings (PIECE refuses them); they are shown at {}° and overlap or crowd it.",
                size_json(sides.length),
                size_json(sides.width),
                size_json(shared::MAX_SIDE_ANGLE.to_degrees()),
                size_json(p.gap),
                size_json(shared::MAX_SIDE_ANGLE.to_degrees())
            ));
        }
        if p.halo.is_some() {
            out.notes.push("A three-stone ring has no halo: `halo` is not used.".to_string());
        }
    }

    if let Some(seat) = head.halo {
        match p.halo_sites() {
            None => out.notes.push(format!(
                "A halo of {} mm melee does not fit around this stone at a {} mm gap (PIECE refuses it); none is shown.",
                size_json(seat.melee),
                size_json(p.gap)
            )),
            Some(centres) => {
                let (mg, mc, mp) = proportions(seat.depth);
                for c in &centres {
                    let f = Frame { o: frame.at(c.x, c.y, 0.0), ..frame };
                    round_brilliant(&mut out.melee, &f, seat.melee / 2.0, seat.depth, shared::table_ratio(round_cut), d.melee);
                    out.stones += 1;
                    // Its seat in the plate: a cone at the pavilion's angle, a bore to set it
                    // through and a hole through the plate.
                    let r = seat.melee / 2.0;
                    let mut envelope = Envelope {
                        axes: axes_of(&f),
                        outline: Outline::Circle(r),
                        reach: r,
                        girdle: mg,
                        crown: mc,
                        pavilion: mp,
                        table: shared::table_ratio(round_cut),
                        cab: false,
                        clearance: SEAT_CLEARANCE,
                        bore: Some(mg / 2.0 + mc + BORE_OVER),
                        profile: Vec::new(),
                        span: (0.0, 0.0),
                    };
                    fit_seat(&mut envelope, d, &|b, dd| round_brilliant(b, &f, r, seat.depth, shared::table_ratio(round_cut), dd.melee));
                    out.csg.cut.push(Prim::Seat(envelope));
                    out.csg.cut.push(Prim::Cylinder { axes: axes_of(&f), r: PAVE_HOLE * r, lo: -seat.under - HOLE_OVER, hi: 0.0 });
                    out.seats += 1;
                }
                // The seat: a flat ring under the halo, from just outside the centre stone to
                // just outside the melee.
                let near = seat.offset - seat.melee / 2.0;
                let offset = |by: f64| -> Vec<Vec2> { poly.iter().zip(&normals).map(|(q, n)| *q + *n * by).collect() };
                let (inner, outer) = (offset((near - 0.1).max(0.02)), offset(near + seat.melee + 0.2));
                let top = -0.04 * seat.melee;
                let mut first: Option<Ring> = None;
                let mut prev: Option<Ring> = None;
                for (a, b) in inner.iter().zip(&outer) {
                    let ring = out.seat.ring([
                        frame.at(a.x, a.y, -seat.under),
                        frame.at(a.x, a.y, top),
                        frame.at(b.x, b.y, top),
                        frame.at(b.x, b.y, -seat.under),
                    ]);
                    if let Some(q) = prev {
                        out.seat.bridge(q, ring);
                    }
                    first = first.or(Some(ring));
                    prev = Some(ring);
                }
                if let (Some(a), Some(b)) = (prev, first) {
                    out.seat.bridge(a, b);
                }
                let outline = if shape.round { Outline::Circle(shape.width / 2.0) } else { Outline::Poly(poly.clone()) };
                out.csg.add.push(Prim::Plate {
                    axes: axes_of(&frame),
                    outline,
                    inner: (near - 0.1).max(0.02),
                    outer: near + seat.melee + 0.2,
                    lo: -seat.under,
                    hi: top,
                });
                if cut.name == "heart" {
                    out.notes.push("Around a heart the halo follows the lobes and the point; in the cleft its seat is approximate.".to_string());
                }
            }
        }
    }
    out.notes.push(
        "The band, the gallery rail, the prongs and the halo seat are separate closed shells that pass through each other where they join, \
         and no seat is cut for a stone; a slicer unions them."
            .to_string(),
    );
}

fn build_eternity(s: &Sane, d: &Detail, out: &mut Parts) {
    let p = &s.p;
    let Some(cut) = p.cut_data() else { return };
    // The row: how deep the stones are, the circle their girdles lie on, and how many fit.
    let row: Row = p.eternity_row();
    let n = row.count(p.count);
    out.fits = Some(row.fits);
    let (m, radius, depth) = (row.melee, row.melee / 2.0, row.depth);
    let shape = StoneShape::of(cut, m, m, depth, 16 * d.melee.clamp(1, 8));
    // A cabochon's frame is its base; a faceted stone's is its girdle.
    let seat_r = if shape.cab { row.top - depth } else { row.radius };
    let radial = |v: Vec2| Vec3::new(v.x, v.y, 0.0);
    let (girdle, crown, pavilion) = if shape.cab { (0.0, depth, 0.0) } else { proportions(depth) };
    // A bore up through the band's outside, and a hole down through it to the finger.
    let bore = (s.ri + p.wall + BORE_OVER - seat_r).max(girdle / 2.0 + crown + SEAT_CLEARANCE);
    let through = seat_r - s.ri + BORE_OVER;
    for k in 0..n {
        let w = radial(Row::out(k, n));
        let f = Frame { o: w * seat_r, u: Vec3::new(-w.y, w.x, 0.0), v: Vec3::Z, w };
        shape.build(&mut out.melee, &f, d.melee, 2);
        let mut envelope = seat_envelope(&shape, &f, girdle, crown, pavilion, Some(bore));
        fit_seat(&mut envelope, d, &|b, dd| StoneShape::of(cut, m, m, depth, 16 * dd.melee.clamp(1, 8)).build(b, &f, dd.melee, 2));
        out.csg.cut.push(Prim::Cylinder { axes: axes_of(&f), r: PAVE_HOLE * envelope.reach, lo: -through, hi: 0.0 });
        out.csg.cut.push(Prim::Seat(envelope));
        out.seats += 1;
    }
    out.stones += n;

    // Bead prongs, two between each pair of neighbours that are close enough to share them.
    let rb = (0.16 * m).clamp(0.2, 0.5);
    let half_pitch = row.radius * (PI / f64::from(n)).sin();
    if n >= 2 && half_pitch <= radius + 0.8 * rb {
        let reach = radius + 0.6 * rb;
        let z0 = (reach * reach - half_pitch * half_pitch).max(0.0).sqrt().min((p.width / 2.0 - rb).max(0.0));
        let zs: &[f64] = if z0 < 0.6 * rb { &[0.0] } else { &[-1.0, 1.0] };
        let step = TAU / f64::from(n);
        for k in 0..n {
            let phi = step * (f64::from(k) + 0.5);
            let w = Vec3::new(phi.sin(), phi.cos(), 0.0);
            for sign in zs {
                let z = sign * z0;
                let r = (s.outside_at(z) - 0.2 * rb).max(s.ri + rb + 0.02);
                bead(&mut out.beads, w * r + Vec3::Z * z, w, rb, d.bead_radial, d.bead_lat);
                out.csg.add.push(Prim::Sphere { c: w * r + Vec3::Z * z, r: rb });
            }
        }
    } else if n >= 2 {
        out.notes.push("The stones stand too far apart to share bead prongs; none are shown.".to_string());
    }
    if let Err(e) = p.row_stone("piecemesh") {
        out.notes.push(format!("PIECE does not draw these stones ({e}); they are shown as asked."));
    }
    if shape.stand_in {
        out.notes.push(format!("A {} of {} mm has no usable girdle outline; the stones are shown as rounds.", cut.name, size_json(m)));
    }
    if row.fits == 0 {
        out.notes.push(format!(
            "No {} mm stone fits around this band with {} mm between girdles (PIECE refuses it); the {n} shown overlap.",
            size_json(m),
            size_json(p.gap)
        ));
    } else if n > row.fits {
        out.notes.push(format!(
            "{n} stones of {} mm do not fit around this band with {} mm between girdles (at most {} do, and PIECE refuses more); they overlap.",
            size_json(m),
            size_json(p.gap),
            row.fits
        ));
    }
    let seat_height = s.section.height_at(0.0);
    if depth > seat_height + 1e-9 {
        out.notes.push(format!(
            "The stones' culets reach through the {} mm wall: {} mm stones are {} mm deep.",
            size_json(seat_height),
            size_json(m),
            size_json(depth)
        ));
    }
    if !row.level() {
        out.notes.push(format!(
            "A {} band falls {} mm from its middle to the stones' edges, under their girdles: the row has no seat there (PIECE's stone-seat check fails).",
            p.profile.name(),
            size_json(row.fall)
        ));
    }
    if m > p.width + 1e-9 {
        out.notes.push(format!("The stones ({} mm) are wider than the band ({} mm).", size_json(m), size_json(p.width)));
    }
    out.notes.push(
        "The band and the bead prongs are separate closed shells that pass through each other, and no seat is cut for a stone; a slicer unions them."
            .to_string(),
    );
}

/// Pavé on the band: each stone a round brilliant on its frame from [`super::pave_band::fit`]
/// (the sheet's own placement), and bead prongs between neighbours as the eternity row has them.
fn build_pave(s: &Sane, d: &Detail, out: &mut Parts) {
    use super::pave_band;
    let Some(fit) = pave_band::fit(&s.p) else {
        out.notes.extend(pave_band::unused(&s.p));
        return;
    };
    let table = gem::CUTS.first().map_or(0.57, shared::table_ratio);
    for st in &fit.stones {
        // u × v = w: the girdle's plane, its table along the normal.
        let (w, u) = (st.normal, -st.around);
        let f = Frame { o: st.girdle, u, v: w.cross(u), w };
        round_brilliant(&mut out.pave, &f, st.diameter / 2.0, st.depth, table, d.melee);
        // Its seat, as an eternity stone's: the stone's room with a bore up through the outside
        // (the table is level with it) and a hole along the normal through to the finger.
        if let Some(cut) = gem::CUTS.first() {
            let shape = StoneShape::of(cut, st.diameter, st.diameter, st.depth, 16 * d.melee.clamp(1, 8));
            let (girdle, crown, pavilion) = proportions(st.depth);
            let mut envelope = seat_envelope(&shape, &f, girdle, crown, pavilion, Some(girdle / 2.0 + crown + SEAT_CLEARANCE + BORE_OVER));
            fit_seat(&mut envelope, d, &|b, dd| round_brilliant(b, &f, st.diameter / 2.0, st.depth, table, dd.melee));
            let through = (Vec2::new(st.girdle.x, st.girdle.y).len() - s.ri + BORE_OVER).max(BORE_OVER);
            out.csg.cut.push(Prim::Cylinder { axes: axes_of(&f), r: PAVE_HOLE * envelope.reach, lo: -through, hi: 0.0 });
            out.csg.cut.push(Prim::Seat(envelope));
            out.seats += 1;
        }
    }
    out.stones = out.stones.saturating_add(u32::try_from(fit.stones.len()).unwrap_or(u32::MAX));
    if let Some(surf) = pave_band::Surface::of(&s.p) {
        for (c, up, rb) in pave_band::beads(&fit, &surf) {
            bead(&mut out.beads, c, up, rb, d.bead_radial, d.bead_lat);
            out.csg.add.push(Prim::Sphere { c, r: rb });
        }
    }
    if !fit.ok() {
        out.notes.push(format!("Pavé: {}", fit.message()));
    }
    if fit.spec.layout == pave_band::Layout::Scallop {
        out.notes.push("The pavé's scallops are drawn on the sheet; the solid does not cut them.".to_string());
    }
    out.notes.push(
        "Pavé stones sit on the band's outside, tables level with it, and the beads pass through the band; STLOUT cuts each stone's seat."
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
    if s.p.tapered() {
        mesh_kinds::build_tapered_band(&mut parts.band, &mut parts.csg, &s, &d);
    } else {
        build_band(&mut parts.band, &mut parts.csg, &s, &d);
    }
    match s.p.kind {
        PieceKind::Band | PieceKind::Dome => {}
        PieceKind::Signet => mesh_kinds::build_face(&mut parts.face, &mut parts.csg, &s, &d),
        PieceKind::HalfEternity => mesh_kinds::build_half_eternity(&s, &d, &mut parts),
        PieceKind::Solitaire | PieceKind::ThreeStone => build_solitaire(&s, &d, &mut parts),
        PieceKind::Eternity => build_eternity(&s, &d, &mut parts),
    }
    build_pave(&s, &d, &mut parts);
    let metal = metal_color(&p.metal);
    let stone = stone_color(&p.stone);
    // A halo's melee are diamonds whatever the centre stone is; an eternity band's are the piece's stone.
    let small = if s.p.kind == PieceKind::Solitaire { stone_color("diamond") } else { stone };
    let meshes = [
        parts.band.part("metal", "band", metal),
        parts.head.part("metal", "head", metal),
        parts.prongs.part("metal", "prongs", metal),
        parts.seat.part("metal", "halo seat", metal),
        parts.beads.part("metal", "beads", metal),
        parts.bezel.part("metal", "bezel", metal),
        parts.face.part("metal", "face", metal),
        parts.centre.part("stone", "centre stone", stone),
        parts.sides.part("stone", "side stones", stone),
        parts.melee.part("stone", "melee", small),
        parts.pave.part("stone", "pave", stone_color("diamond")),
    ]
    .into_iter()
    .flatten()
    .collect();
    PieceMesh { meshes, notes: parts.notes, stones: parts.stones, fits: parts.fits, level, over: false, csg: parts.csg, seats: parts.seats }
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

/// The stones' triangles alone, for an STL beside the merged solid.
fn stone_triangles(mesh: &PieceMesh) -> Vec<[Vec3; 4]> {
    let stones = PieceMesh {
        meshes: mesh
            .meshes
            .iter()
            .filter(|m| m.part == "stone")
            .map(|m| PartMesh { positions: m.positions.clone(), indices: m.indices.clone(), ..*m })
            .collect(),
        notes: Vec::new(),
        stones: 0,
        fits: None,
        level: 0,
        over: false,
        csg: Csg::default(),
        seats: 0,
    };
    stl_triangles(&stones, true).0
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

const PIECE_KEYS: &str = "kind: band|solitaire|threestone|eternity|halfeternity|dome|signet, head?: prong|bezel, bezelWall?, bezelHeight?, topWidth?, topWall?, face?: round|oval|cushion|rectangle, faceLength?, faceWidth?, system?, size? (default US 6), wall?: mm (1.8), width?: mm (2.2), \
    profile?: flat|dome|comfort|court|knife|bevel|concave|custom (with profileCurve, as PIECE reports it), comfort?|ridge?|bevel?|hollow?: mm (the profile's own number), metal? (gold18), cut? (round), stoneWidth?: mm (6.5), stoneLength?: mm, stone? (diamond), prongs?: 3–8 (6), halo?: bool | melee mm, \
    sideWidth?: mm, sideLength?: mm, sideCut?, sideProngs?: 3–8 (4), melee?: mm (1.8), count?: stones (default: as many as fit), gap?: mm (0.2), pave?: false|true|{layout, rows, melee, gap, span|from/to, symmetric, graduated} (as PIECE takes it)";

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec::new("piecemesh", "Piece as a Solid", run_piecemesh)
            .params(
                "{kind: band|solitaire|threestone|eternity|halfeternity|dome|signet, …the piece's parameters as PIECE takes them (head: prong|bezel with bezelWall, bezelHeight; topWidth, topWall; face, faceLength, faceWidth; size, wall, width, profile: flat|dome|comfort|court|knife|bevel|concave with its comfort, ridge, bevel or hollow, metal, cut, stoneWidth, \
                 stoneLength, stone, prongs, halo, sideWidth, sideLength, sideCut, sideProngs, melee, count, gap), quality?: draft|fine (default draft)} → {meshes: [{part: metal|stone, name, \
                 color: [r,g,b], positions: [x,y,z,…] mm, indices: [i,j,k,…]}], bounds: {min, max}, triangles, size, kind, params (as PIECE \
                 reports them), quality, level, stones (centre + side + halo + eternity stones: the count PIECE reports), fits? (eternity: the most \
                 that fit at `gap`), metal: {name, density, grams and volumeMm3 (the band alone, exactly: the weight PIECE reports), shells: \
                 {volumeMm3, grams} (the tessellated metal shells summed, overlaps counted twice: approximate, not the metal weight)}, \
                 notes}: the same piece PIECE draws, as closed shells of triangles (finger axis Z, head at +Y), at most 150,000. An eternity \
                 `count` that does not fit at `gap`, or three-stone side stones that do not clear the centre stone (PIECE refuses both), are \
                 still built and `notes` say so; a three-stone ring's side stones are the part `side stones`; changes nothing",
            )
            .enabled(always)
            .noundo(),
        CommandSpec::new("stlout", "STL Out", run_stlout)
            .alias(&["stlexport"])
            .params(
                "{kind: band|solitaire|threestone|eternity, …the piece's parameters as PIECE takes them, stones?: bool (default false: the metal only, which \
                 is what is cast), quality?: draft|fine (default fine: the metal sampled at 0.1 mm; draft 0.2 mm), binary?: bool (default true), \
                 maxTriangles?: 1000–1000000 (default 150000; an ASCII STL at most 30000)} → {format: stl-binary|stl-ascii, base64 | text, bytes, \
                 triangles, name, quality, step (the grid step the metal was sampled at, mm: coarser than asked when it must be to fit), seats, \
                 bodies (1: the metal casts whole), metal: {name, density, volumeMm3, grams (the merged solid: what is cast), band: {volumeMm3, \
                 grams} (the band alone, exactly: what PIECE and the bench sheet report)}, notes}: the piece as an STL in millimetres, the \
                 metal one closed, manifold, outward-facing shell with a seat cut for every stone, the stones (when asked) shells of their \
                 own; changes nothing",
            )
            .enabled(always)
            .noundo(),
    ]
}

/// The piece a mesh command was handed. With no `kind` there is nothing to build.
fn piece_of(cmd: &str, p: &Value) -> Result<PieceParams> {
    if str_param(p, "kind").is_none() {
        return Err(bad(
            cmd,
            format!(
                "there is no piece to show: give `kind` (band, solitaire, threestone, eternity, halfeternity, dome or signet) and its parameters ({PIECE_KEYS})"
            ),
        ));
    }
    PieceParams::parse(cmd, p)
}

fn run_piecemesh(_s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "piecemesh";
    let piece = piece_of(cmd, p)?;
    let quality = Quality::parse(cmd, p, Quality::Draft)?;
    let mesh = piece_mesh(&piece, quality);
    let (lo, hi) = mesh.bounds();
    let shells = mesh.shells_volume();
    let band = piece.band_volume();
    let meshes: Vec<Value> = mesh
        .meshes
        .iter()
        .map(|m| {
            let positions: Vec<f64> = m.positions.iter().flat_map(|v| [r3(v.x), r3(v.y), r3(v.z)]).collect();
            json!({ "part": m.part, "name": m.name, "color": m.color, "positions": positions, "indices": m.indices })
        })
        .collect();
    let mut reply = json!({
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
            "volumeMm3": r3(band),
            "grams": r3(piece.band_grams()),
            "bezelGrams": if piece.bezeled() { json!(r3(piece.bezel_grams())) } else { Value::Null },
            "shells": { "volumeMm3": r3(shells), "grams": r3(shells / 1000.0 * piece.density) },
        },
        "notes": mesh.notes,
    });
    if let (Some(fits), Some(o)) = (mesh.fits, reply.as_object_mut()) {
        o.insert("fits".into(), json!(fits));
    }
    Ok(reply)
}

/// The merged solid's grid step at each quality, mm.
const SOLID_STEP_FINE: f64 = 0.1;
const SOLID_STEP_DRAFT: f64 = 0.2;
/// The most triangles a binary STL may be asked for with `maxTriangles` (about 50 MB); without it
/// the file holds at most [`MAX_TRIANGLES`], what the interface downloads.
pub(super) const MAX_SOLID_TRIANGLES: usize = 1_000_000;
/// How far the merged solid's volume may stand from the analytic band's, as a fraction per
/// millimetre of grid step (1% at fine quality's 0.1 mm, 2% at draft's 0.2 mm), before the reply
/// says so. The piecewise-linear surface cuts a convex section's corners, so the solid comes out a
/// little light: about 0.1–0.3% at 0.1 mm on usual bands, up to about 1.3% at 0.2 mm on a small,
/// thin one.
pub(super) const SOLID_AGREEMENT_PER_MM: f64 = 0.1;

/// The metal as one closed shell (seats cut) at `quality`'s grid step, coarser when it must be to
/// stay under `max_tris`: its triangles (normal first), the solid, and notes.
pub(super) fn solid_stl(mesh: &PieceMesh, quality: Quality, max_tris: usize) -> std::result::Result<(Vec<[Vec3; 4]>, Solid, Vec<String>), String> {
    let step = match quality {
        Quality::Fine => SOLID_STEP_FINE,
        Quality::Draft => SOLID_STEP_DRAFT,
    };
    let (solid, coarsened) = solidify(&mesh.csg, step, max_tris)?;
    let mut notes = Vec::new();
    if coarsened {
        notes.push(format!(
            "The merged solid is sampled at {} mm, coarser than {} quality's {step} mm, to stay under {max_tris} triangles.",
            fmt_mm(solid.step),
            quality.name()
        ));
    }
    let mut tris = Vec::with_capacity(solid.triangles());
    for t in solid.indices.chunks_exact(3) {
        let at = |k: usize| t.get(k).and_then(|i| solid.positions.get(*i as usize)).copied();
        let (Some(a), Some(b), Some(c)) = (at(0), at(1), at(2)) else { continue };
        let n = (b - a).cross(c - a);
        let len = n.len();
        let n = if len.is_finite() && len > 0.0 { n * (1.0 / len) } else { Vec3::Z };
        tris.push([n, a, b, c]);
    }
    Ok((tris, solid, notes))
}

fn run_stlout(_s: &mut Session, p: &Value) -> Result<Value> {
    let cmd = "stlout";
    let piece = piece_of(cmd, p)?;
    let quality = Quality::parse(cmd, p, Quality::Fine)?;
    let stones = bool_or(p, "stones", false);
    let binary = bool_or(p, "binary", true);
    let cap = match p.get("maxTriangles").filter(|v| !v.is_null()) {
        None => MAX_TRIANGLES,
        Some(v) => match v.as_f64() {
            Some(n) if n.is_finite() && (1000.0..=MAX_SOLID_TRIANGLES as f64).contains(&n) => n as usize,
            _ => return Err(bad(cmd, format!("`maxTriangles` is a number from 1000 to {MAX_SOLID_TRIANGLES}"))),
        },
    };
    let cap = if binary { cap } else { cap.min(MAX_ASCII_TRIANGLES) };
    // The tessellated piece gives the stones (and the notes); the metal is the merged solid.
    // At most half the file for the tessellated piece (the stones are what is kept of it), so the
    // merged metal always has the other half.
    let budget = Budget { triangles: cap / 2, json: None, stones };
    let mesh = piece_mesh_within(&piece, quality, budget);
    if stones && mesh.over {
        return Err(bad(
            cmd,
            format!("this piece's stones are more than {} triangles, too many for an ASCII STL; ask for the binary one", budget.triangles),
        ));
    }
    let stone_tris = if stones { stone_triangles(&mesh) } else { Vec::new() };
    let room = cap.saturating_sub(stone_tris.len()).max(1);
    let (mut tris, solid, mut extra) = solid_stl(&mesh, quality, room).map_err(|e| bad(cmd, e))?;
    if stones {
        tris.extend(stone_tris);
    }
    let mut notes = mesh.notes;
    notes.append(&mut extra);
    if piece.wall < MIN_CAST_WALL {
        notes.push(format!("A {} mm wall is thinner than a bench casts ({MIN_CAST_WALL} mm).", size_json(piece.wall)));
    }
    notes.push(
        if stones {
            "The metal is one closed shell with a seat cut for every stone; the stones are included as shells of their own."
        } else {
            "The metal only, as one closed shell with a seat cut for every stone: the stones are left out."
        }
        .to_string(),
    );
    let volume = solid.volume();
    let band = piece.band_volume();
    if solid.bodies > 1 {
        notes.push(format!(
            "The metal is in {} separate pieces, not one: a seat cuts a part clean through (stones crowding each other or a prong) — give the stones more room.",
            solid.bodies
        ));
    }
    let agreement = SOLID_AGREEMENT_PER_MM * solid.step;
    if piece.kind == PieceKind::Band && band > 0.0 && ((volume - band) / band).abs() > agreement {
        notes.push(format!(
            "The solid's volume ({volume:.1} mm³) is more than {:.0}% from the band's exact volume ({band:.1} mm³): the band is thin for the {} mm sampling step.",
            agreement * 100.0,
            fmt_mm(solid.step)
        ));
    }
    let title = format!("{}-us{}-{}", piece.kind.name(), fmt_mm(piece.size.us), piece.metal);
    let name = format!("{title}.stl");
    let mut reply = json!({
        "triangles": tris.len(),
        "name": name,
        "quality": quality.name(),
        "units": "mm",
        "step": r3(solid.step),
        "seats": mesh.seats,
        "bodies": solid.bodies,
        "metal": {
            "name": piece.metal,
            "density": piece.density,
            "volumeMm3": r3(volume),
            "grams": r3(volume / 1000.0 * piece.density),
            "band": { "volumeMm3": r3(band), "grams": r3(piece.band_grams()) },
        },
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
