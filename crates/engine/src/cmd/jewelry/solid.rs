//! One solid for the caster: the piece's metal as a single closed, manifold, consistently
//! oriented and non-self-intersecting shell, with a seat cut for every stone.
//!
//! The decision and why is `docs/adr/0002-mesh-booleans.md`. In short: every part of the piece
//! is described analytically ([`Prim`]) by a signed distance bound — negative inside, positive
//! outside, never steeper than one (1-Lipschitz) — and the metal is
//! `max(min(adds), −min(cuts))`. That field is sampled on a sparse grid and its zero set is
//! extracted by marching tetrahedra on the Kuhn split of each cube. The surface that gives is the
//! zero set of the field's piecewise-linear interpolant over a conforming tetrahedral mesh, so it
//! is closed (the grid is padded with outside nodes), a 2-manifold (each vertex lies inside one
//! grid edge and is shared by key, not by value), wound consistently (from each tetrahedron's own
//! parity) and free of self-intersections (each triangle lies in one tetrahedron). The extractor
//! still checks every edge before it answers, and refuses rather than hand over a broken shell.
//!
//! Work is bounded: a binned index keeps each grid block to the primitives near it, and the
//! number of blocks, field evaluations and triangles are capped; over a cap the caller samples
//! more coarsely.

use std::collections::HashMap;

use cadcraft_geom::{Vec2, Vec3};

use super::heads::BezelBound;
use super::kinds::{Face, Taper};

/// Cells along a block's edge.
const BLOCK: usize = 8;
/// The most grid blocks one extraction looks at.
const MAX_BLOCKS: usize = 1_500_000;
/// The most primitive-in-block registrations of the binned index.
const MAX_BINNED: usize = 12_000_000;
/// The most primitive evaluations one extraction makes.
const MAX_EVALS: u64 = 150_000_000;
/// The most stone vertices a seat is fitted to.
const MAX_FIT_POINTS: usize = 200_000;
/// How far along a grid edge a surface vertex may lie from either end, as a fraction of the edge.
const EDGE_CLAMP: f64 = 0.01;
/// The finest step a piece too thin for the asked one is sampled at, mm.
const MIN_STEP: f64 = 0.02;
/// The most attempts at successively coarser (or, for a thin piece, finer) steps.
const MAX_ATTEMPTS: usize = 10;

/// A plane's origin and three orthonormal axes: `u` and `v` in the plane, `w` square to it.
#[derive(Clone, Copy, Debug)]
pub(super) struct Axes {
    pub o: Vec3,
    pub u: Vec3,
    pub v: Vec3,
    pub w: Vec3,
}

impl Axes {
    fn local(&self, p: Vec3) -> Vec3 {
        let d = p - self.o;
        Vec3::new(d.dot(self.u), d.dot(self.v), d.dot(self.w))
    }
    fn at(&self, x: f64, y: f64, h: f64) -> Vec3 {
        self.o + self.u * x + self.v * y + self.w * h
    }
    /// The box around a local box's eight corners.
    fn bounds(&self, lo: Vec3, hi: Vec3) -> (Vec3, Vec3) {
        let mut b = (Vec3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY), Vec3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY));
        for k in 0..8 {
            let x = if k & 1 == 0 { lo.x } else { hi.x };
            let y = if k & 2 == 0 { lo.y } else { hi.y };
            let h = if k & 4 == 0 { lo.z } else { hi.z };
            grow(&mut b, self.at(x, y, h));
        }
        b
    }
}

fn grow(b: &mut (Vec3, Vec3), p: Vec3) {
    b.0 = Vec3::new(b.0.x.min(p.x), b.0.y.min(p.y), b.0.z.min(p.z));
    b.1 = Vec3::new(b.1.x.max(p.x), b.1.y.max(p.y), b.1.z.max(p.z));
}

/// A girdle (or any outline) in its own plane.
#[derive(Clone, Debug)]
pub(super) enum Outline {
    /// A circle of this radius about the plane's origin.
    Circle(f64),
    /// A simple counter-clockwise polygon.
    Poly(Vec<Vec2>),
}

impl Outline {
    /// The signed distance in the plane: negative inside.
    fn dist(&self, p: Vec2) -> f64 {
        match self {
            Outline::Circle(r) => p.len() - r,
            Outline::Poly(poly) => poly_dist(poly, p),
        }
    }
    fn extent(&self) -> (Vec2, Vec2) {
        match self {
            Outline::Circle(r) => (Vec2::new(-r, -r), Vec2::new(*r, *r)),
            Outline::Poly(poly) => {
                let mut lo = Vec2::new(f64::INFINITY, f64::INFINITY);
                let mut hi = Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
                for p in poly {
                    lo = lo.min(*p);
                    hi = hi.max(*p);
                }
                (lo, hi)
            }
        }
    }
}

/// The signed distance from `p` to a simple polygon: negative inside.
pub(super) fn poly_dist(poly: &[Vec2], p: Vec2) -> f64 {
    let n = poly.len();
    if n < 3 {
        return f64::INFINITY;
    }
    let mut best = f64::INFINITY;
    let mut inside = false;
    for (i, a) in poly.iter().enumerate() {
        let Some(b) = poly.get((i + 1) % n) else { continue };
        let (a, b) = (*a, *b);
        let e = b - a;
        let w = p - a;
        let l2 = e.dot(e);
        let t = if l2 > 1e-300 { (w.dot(e) / l2).clamp(0.0, 1.0) } else { 0.0 };
        best = best.min((w - e * t).len());
        if (a.y > p.y) != (b.y > p.y) {
            let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
            if p.x < x {
                inside = !inside;
            }
        }
    }
    if inside { -best } else { best }
}

/// A stone's seat: the room its own body takes, grown by a clearance, and optionally a bore above
/// its girdle (so it can be set from above) — in the stone's girdle plane, the table toward `w`.
#[derive(Clone, Debug)]
pub(super) struct Envelope {
    pub axes: Axes,
    pub outline: Outline,
    /// How far in from the girdle the pavilion's culet (or keel) lies: the outline's inradius.
    pub reach: f64,
    pub girdle: f64,
    pub crown: f64,
    pub pavilion: f64,
    /// The table as a fraction of the width.
    pub table: f64,
    /// A cabochon: flat at the plane, a dome `crown` high above it.
    pub cab: bool,
    pub clearance: f64,
    /// The height a bore of the girdle's size (plus clearance) reaches above the girdle.
    pub bore: Option<f64>,
    /// The stone's own section, fitted to its vertices ([`Envelope::fit`]): the lines `(h0, d0,
    /// slope)` whose minimum is the concave hull of how far out of the outline the stone reaches
    /// at each height, and the heights it spans. Empty: the analytic crown and pavilion are used.
    pub profile: Vec<(f64, f64, f64)>,
    pub span: (f64, f64),
}

impl Envelope {
    /// Fits the seat to the stone's own vertices (world coordinates): for each height, how far out
    /// of the outline the stone reaches, as the concave hull of the vertices' `(h, d)`. A convex
    /// stone lies wholly inside the room that gives, whatever its facets (a brilliant's crown
    /// bulges past the straight line from girdle to table).
    pub(super) fn fit(&mut self, pts: &[Vec3]) {
        let mut hd: Vec<(f64, f64)> = pts
            .iter()
            .map(|p| {
                let q = self.axes.local(*p);
                (q.z, self.outline.dist(Vec2::new(q.x, q.y)))
            })
            .filter(|(h, d)| h.is_finite() && d.is_finite())
            .collect();
        if hd.len() < 2 || hd.len() > MAX_FIT_POINTS {
            return;
        }
        hd.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        // The upper hull, left to right (Andrew's monotone chain).
        let mut hull: Vec<(f64, f64)> = Vec::new();
        for q in hd {
            while hull.len() >= 2 {
                let (Some(a), Some(b)) = (hull.get(hull.len() - 2).copied(), hull.last().copied()) else { break };
                if (b.0 - a.0) * (q.1 - a.1) - (b.1 - a.1) * (q.0 - a.0) >= 0.0 {
                    hull.pop();
                } else {
                    break;
                }
            }
            hull.push(q);
        }
        let (Some(first), Some(last)) = (hull.first().copied(), hull.last().copied()) else { return };
        let mut lines = Vec::new();
        for w in hull.windows(2) {
            if let [a, b] = w {
                let dh = b.0 - a.0;
                if dh > 1e-9 {
                    lines.push((a.0, a.1, ((b.1 - a.1) / dh).clamp(-1e6, 1e6)));
                }
            }
        }
        if lines.is_empty() {
            lines.push((first.0, first.1.max(last.1), 0.0));
        }
        self.profile = lines;
        self.span = (first.0, last.0);
    }

    fn eval(&self, p: Vec3) -> f64 {
        let q = self.axes.local(p);
        let (h, c, a) = (q.z, self.clearance, self.reach.max(0.0));
        let d = self.outline.dist(Vec2::new(q.x, q.y));
        let body = if !self.profile.is_empty() {
            let side = self.profile.iter().map(|(h0, d0, s)| (d - d0 - s * (h - h0)) / (1.0 + s * s).sqrt()).fold(f64::NEG_INFINITY, f64::max);
            (side - c).max((self.span.0 - c - h).max(h - self.span.1 - c))
        } else if self.cab {
            let depth = self.crown.max(1e-6);
            // Under the dome (an ellipse in section) by tangent lines to it: the room is never
            // smaller than the stone.
            let slope = (a * 4.0 / 3.0 / depth).min(50.0);
            let inset = (a * (0.4 + 4.0 / 3.0 * (h / depth - 0.8))).max(0.0);
            let k = (1.0 + slope * slope).sqrt();
            ((d + inset) / k - c).max((-c - h).max(h - depth - c))
        } else {
            let g2 = self.girdle / 2.0;
            let sp = (a / self.pavilion.max(1e-6)).min(50.0);
            let sc = (a * (1.0 - self.table.clamp(0.0, 1.0)) / self.crown.max(1e-6)).min(50.0);
            let tp = (-g2 - h).max(0.0);
            let tc = (h - g2).max(0.0);
            let k = (1.0 + sp.max(sc).powi(2)).sqrt();
            let side = (d + sp * tp + sc * tc) / k - c;
            let ends = (-g2 - self.pavilion - c - h).max(h - g2 - self.crown - c);
            side.max(ends)
        };
        match self.bore {
            Some(top) => body.min((d - c).max((-h).max(h - top))),
            None => body,
        }
    }
    fn bounds(&self) -> (Vec3, Vec3) {
        let (lo, hi) = self.outline.extent();
        let c = self.clearance;
        let (bottom, top) =
            if self.cab { (-c, self.crown + c) } else { (-self.girdle / 2.0 - self.pavilion - c, self.girdle / 2.0 + self.crown + c) };
        let top = self.bore.map_or(top, |b| top.max(b));
        self.axes.bounds(Vec3::new(lo.x - c, lo.y - c, bottom), Vec3::new(hi.x + c, hi.y + c, top))
    }
}

/// One analytic part of the piece.
#[derive(Clone, Debug)]
pub(super) enum Prim {
    /// A section `(r, z)` revolved about Z (made by [`Prim::revolve`]).
    Revolve(Section),
    /// A round wire of radius `r` along a path, open (round ends) or closed.
    Wire {
        pts: Vec<Vec3>,
        r: f64,
        closed: bool,
    },
    Sphere {
        c: Vec3,
        r: f64,
    },
    /// A cylinder of radius `r` along `axes.w` from `lo` to `hi`.
    Cylinder {
        axes: Axes,
        r: f64,
        lo: f64,
        hi: f64,
    },
    /// The band between two offsets of an outline, from `lo` to `hi` along `axes.w`.
    Plate {
        axes: Axes,
        outline: Outline,
        inner: f64,
        outer: f64,
        lo: f64,
        hi: f64,
    },
    Seat(Envelope),
    /// A dome ring's or a signet's tapered shank: the bottom `section` (`(x across, height over
    /// the finger)`) scaled as it goes round a finger of radius `ri` ([`Taper::distance_by`]).
    Taper {
        taper: Taper,
        section: Section,
        ri: f64,
    },
    /// A bezel's collar round a stone's girdle ([`BezelBound::distance`]).
    Bezel(BezelBound),
    /// A signet's face plate, its outline `(x around, z along)` ([`Face::distance`]).
    Face {
        face: Face,
        outline: Vec<Vec2>,
    },
    /// A band swept along a drawn rail ([`super::sweep::RailBound`]).
    Rail(super::sweep::RailBound),
    /// A split or cathedral shank ([`super::shank::ShankBound`]).
    Shank(super::shank::ShankBound),
    /// A letter's stroke cut in or raised ([`super::engrave::Groove`]).
    Groove(super::engrave::Groove),
    /// A styled prong's top: a claw's cone, a tab's or V's bars ([`super::prongs::ProngSolid`]).
    Prong(super::prongs::ProngSolid),
    /// A channel setting's rails, or the channel cut between them ([`super::channel::ChannelBound`]).
    Channel(super::channel::ChannelBound),
    /// A band's generative pattern cut ([`super::pattern::PatternCut::distance`]).
    Pattern(Box<super::pattern::PatternCut>),
}

/// Edges of a section taken together for [`Section::dist`].
const CHUNK: usize = 12;

/// A closed polygon with its edges in runs, each with its box, so the distance to it skips the
/// runs that cannot be nearer than one already found.
#[derive(Clone, Debug)]
pub(super) struct Section {
    pub pts: Vec<Vec2>,
    /// Each run's first edge, one past its last, and its box.
    runs: Vec<(usize, usize, Vec2, Vec2)>,
}

impl Section {
    pub(super) fn new(pts: Vec<Vec2>) -> Section {
        let n = pts.len();
        let mut runs = Vec::new();
        let mut start = 0;
        while start < n {
            let end = (start + CHUNK).min(n);
            let (mut lo, mut hi) = (Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY));
            for i in start..=end {
                if let Some(q) = pts.get(i % n) {
                    lo = lo.min(*q);
                    hi = hi.max(*q);
                }
            }
            runs.push((start, end, lo, hi));
            start = end;
        }
        Section { pts, runs }
    }

    /// The signed distance, negative inside: [`poly_dist`], faster.
    pub(super) fn dist(&self, p: Vec2) -> f64 {
        let n = self.pts.len();
        if n < 3 {
            return f64::INFINITY;
        }
        let mut best = f64::INFINITY;
        let mut inside = false;
        for (start, end, lo, hi) in &self.runs {
            let crossing = p.y >= lo.y && p.y <= hi.y && p.x <= hi.x;
            let gap = Vec2::new((lo.x - p.x).max(p.x - hi.x).max(0.0), (lo.y - p.y).max(p.y - hi.y).max(0.0)).len();
            if !crossing && gap >= best {
                continue;
            }
            for i in *start..*end {
                let (Some(a), Some(b)) = (self.pts.get(i), self.pts.get((i + 1) % n)) else { continue };
                let (a, b) = (*a, *b);
                if gap < best {
                    let e = b - a;
                    let w = p - a;
                    let l2 = e.dot(e);
                    let t = if l2 > 1e-300 { (w.dot(e) / l2).clamp(0.0, 1.0) } else { 0.0 };
                    best = best.min((w - e * t).len());
                }
                if crossing && (a.y > p.y) != (b.y > p.y) {
                    let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
                    if p.x < x {
                        inside = !inside;
                    }
                }
            }
        }
        if inside { -best } else { best }
    }
}

fn segment_dist(p: Vec3, a: Vec3, b: Vec3) -> f64 {
    let e = b - a;
    let l2 = e.dot(e);
    let t = if l2 > 1e-300 { ((p - a).dot(e) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (p - (a + e * t)).len()
}

impl Prim {
    pub(super) fn eval(&self, p: Vec3) -> f64 {
        let v = match self {
            Prim::Revolve(section) => section.dist(Vec2::new(p.x.hypot(p.y), p.z)),
            Prim::Wire { pts, r, closed } => {
                let n = pts.len();
                let mut best = f64::INFINITY;
                let spans = if *closed { n } else { n.saturating_sub(1) };
                for i in 0..spans {
                    if let (Some(a), Some(b)) = (pts.get(i), pts.get((i + 1) % n)) {
                        best = best.min(segment_dist(p, *a, *b));
                    }
                }
                if n == 1
                    && let Some(a) = pts.first()
                {
                    best = (p - *a).len();
                }
                best - r
            }
            Prim::Sphere { c, r } => (p - *c).len() - r,
            Prim::Cylinder { axes, r, lo, hi } => {
                let q = axes.local(p);
                (q.x.hypot(q.y) - r).max((lo - q.z).max(q.z - hi))
            }
            Prim::Plate { axes, outline, inner, outer, lo, hi } => {
                let q = axes.local(p);
                let d = outline.dist(Vec2::new(q.x, q.y));
                (inner - d).max(d - outer).max((lo - q.z).max(q.z - hi))
            }
            Prim::Seat(e) => e.eval(p),
            Prim::Taper { taper, section, ri } => taper.distance_by(*ri, p, |q| section.dist(q)),
            Prim::Bezel(b) => b.distance(p),
            Prim::Face { face, outline } => face.distance(p, outline),
            Prim::Rail(b) => b.distance(p),
            Prim::Shank(b) => b.distance(p),
            Prim::Groove(g) => g.distance(p),
            Prim::Prong(prong) => prong.distance(p),
            Prim::Channel(c) => c.distance(p),
            Prim::Pattern(c) => c.distance(p),
        };
        if v.is_nan() { f64::INFINITY } else { v }
    }

    /// The box outside which the primitive is positive.
    fn bounds(&self) -> (Vec3, Vec3) {
        let empty = (Vec3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY), Vec3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY));
        match self {
            Prim::Revolve(Section { pts: section, .. }) => {
                let rmax = section.iter().map(|q| q.x.abs()).fold(0.0, f64::max);
                let zlo = section.iter().map(|q| q.y).fold(f64::INFINITY, f64::min);
                let zhi = section.iter().map(|q| q.y).fold(f64::NEG_INFINITY, f64::max);
                (Vec3::new(-rmax, -rmax, zlo), Vec3::new(rmax, rmax, zhi))
            }
            Prim::Wire { pts, r, .. } => {
                let mut b = empty;
                for p in pts {
                    grow(&mut b, *p - Vec3::new(*r, *r, *r));
                    grow(&mut b, *p + Vec3::new(*r, *r, *r));
                }
                b
            }
            Prim::Sphere { c, r } => (*c - Vec3::new(*r, *r, *r), *c + Vec3::new(*r, *r, *r)),
            Prim::Cylinder { axes, r, lo, hi } => axes.bounds(Vec3::new(-r, -r, *lo), Vec3::new(*r, *r, *hi)),
            Prim::Plate { axes, outline, outer, lo, hi, .. } => {
                let (a, b) = outline.extent();
                let o = outer.max(0.0);
                axes.bounds(Vec3::new(a.x - o, a.y - o, *lo), Vec3::new(b.x + o, b.y + o, *hi))
            }
            Prim::Seat(e) => e.bounds(),
            Prim::Taper { taper, section, ri } => {
                // The scale is largest at the top or at the bottom of the shank.
                let ((ax, ay), (bx, by)) = (taper.scale(0.0), taper.scale(std::f64::consts::PI));
                let (sx, sy) = (ax.max(bx).max(0.0), ay.max(by).max(0.0));
                let x = section.pts.iter().map(|q| q.x.abs()).fold(0.0, f64::max) * sx;
                let r = (ri + section.pts.iter().map(|q| q.y.abs()).fold(0.0, f64::max) * sy).max(0.0);
                (Vec3::new(-r, -r, -x), Vec3::new(r, r, x))
            }
            Prim::Bezel(b) => {
                let (lo, hi) = b
                    .girdle
                    .iter()
                    .fold((Vec2::new(f64::INFINITY, f64::INFINITY), Vec2::new(f64::NEG_INFINITY, f64::NEG_INFINITY)), |(lo, hi), q| {
                        (lo.min(*q), hi.max(*q))
                    });
                let wall = b.bezel.wall.max(0.0);
                let axes = Axes { o: b.o, u: b.u, v: b.v, w: b.w };
                axes.bounds(Vec3::new(lo.x - wall, lo.y - wall, b.bezel.bottom), Vec3::new(hi.x + wall, hi.y + wall, b.bezel.top()))
            }
            Prim::Rail(b) => b.bounds(),
            Prim::Shank(b) => b.bounds(),
            Prim::Face { face, outline } => {
                let mut bx = empty;
                for q in outline {
                    grow(&mut bx, Vec3::new(q.x, face.bottom, q.y));
                    grow(&mut bx, Vec3::new(q.x, face.top, q.y));
                }
                bx
            }
            Prim::Groove(g) => g.bounds(),
            Prim::Prong(prong) => prong.bounds(),
            Prim::Channel(c) => c.bounds(),
            Prim::Pattern(c) => c.bounds(),
        }
    }
}

/// The metal as a construction: what is added, and what is cut from it.
#[derive(Default, Clone, Debug)]
pub(super) struct Csg {
    pub add: Vec<Prim>,
    pub cut: Vec<Prim>,
}

impl Csg {
    /// The field at `p`, every primitive considered.
    #[cfg(test)]
    pub(super) fn eval(&self, p: Vec3) -> f64 {
        let add = self.add.iter().map(|q| q.eval(p)).fold(f64::INFINITY, f64::min);
        let cut = self.cut.iter().map(|q| q.eval(p)).fold(f64::INFINITY, f64::min);
        add.max(-cut)
    }
}

/// The merged solid.
pub(super) struct Solid {
    pub positions: Vec<Vec3>,
    pub indices: Vec<u32>,
    /// The grid step it was sampled at, in millimetres.
    pub step: f64,
    /// How many separate bodies (closed shells) it is in, crumbs left out: one for a piece that
    /// casts whole.
    pub bodies: usize,
}

impl Solid {
    pub(super) fn triangles(&self) -> usize {
        self.indices.len() / 3
    }
    pub(super) fn volume(&self) -> f64 {
        super::mesh::signed_volume(&self.positions, &self.indices)
    }
}

/// Why an extraction stopped.
#[derive(Debug, PartialEq)]
pub(super) enum Fail {
    /// Nothing of the metal was sampled at this step.
    Empty,
    /// Over a cap; about this many times too much.
    Over(f64),
    /// The shell failed its own check (never expected; refused rather than written).
    Broken(String),
}

/// One extraction at `step`, at most `max_tris` triangles; `smooth`: its vertices moved onto the true surface ([`project`]), else left
/// on the grid's piecewise-linear surface.
pub(super) fn extract_with(csg: &Csg, step: f64, max_tris: usize, smooth: bool) -> Result<Solid, Fail> {
    if !(step.is_finite() && step > 1e-4) {
        return Err(Fail::Over(2.0));
    }
    // Every primitive with its box; adds first.
    let mut prims: Vec<(&Prim, bool, Vec3, Vec3)> = Vec::new();
    for (list, cut) in [(&csg.add, false), (&csg.cut, true)] {
        for q in list {
            let (lo, hi) = q.bounds();
            if lo.is_finite() && hi.is_finite() && lo.x <= hi.x && lo.y <= hi.y && lo.z <= hi.z {
                prims.push((q, cut, lo, hi));
            }
        }
    }
    let mut bb = (Vec3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY), Vec3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY));
    for (_, cut, lo, hi) in &prims {
        if !cut {
            grow(&mut bb, *lo);
            grow(&mut bb, *hi);
        }
    }
    if !(bb.0.is_finite() && bb.1.is_finite()) {
        return Err(Fail::Empty);
    }
    let pad = 3.0 * step;
    let origin = bb.0 - Vec3::new(pad, pad, pad);
    let span = bb.1 - bb.0 + Vec3::new(2.0 * pad, 2.0 * pad, 2.0 * pad);
    let cell = (BLOCK as f64) * step;
    let nbf = [span.x / cell, span.y / cell, span.z / cell].map(|x| x.ceil().max(1.0));
    let total = nbf[0] * nbf[1] * nbf[2];
    if !total.is_finite() || total > MAX_BLOCKS as f64 {
        return Err(Fail::Over((total / MAX_BLOCKS as f64).max(1.1)));
    }
    let nb = nbf.map(|x| x as usize);
    let blocks = nb[0] * nb[1] * nb[2];
    // Nodes along each axis.
    let nn = nb.map(|n| n * BLOCK + 1);
    let block_of = |x: f64, axis: usize| -> usize {
        let o = [origin.x, origin.y, origin.z][axis];
        let b = ((x - o) / cell).floor();
        if b.is_finite() && b > 0.0 { (b as usize).min(nb[axis] - 1) } else { 0 }
    };

    // The binned index: each primitive in every block its box (grown by a margin) touches.
    let margin = 2.0 * step;
    let range = |lo: Vec3, hi: Vec3| -> [(usize, usize); 3] {
        let l = [lo.x - margin, lo.y - margin, lo.z - margin];
        let h = [hi.x + margin, hi.y + margin, hi.z + margin];
        [0, 1, 2].map(|a| (block_of(l[a], a), block_of(h[a], a)))
    };
    let mut counts = vec![0u32; blocks + 1];
    let mut binned = 0usize;
    for (_, _, lo, hi) in &prims {
        let r = range(*lo, *hi);
        let n = (r[0].1 - r[0].0 + 1) * (r[1].1 - r[1].0 + 1) * (r[2].1 - r[2].0 + 1);
        binned = binned.saturating_add(n);
        if binned > MAX_BINNED {
            return Err(Fail::Over(1.3));
        }
        for z in r[2].0..=r[2].1 {
            for y in r[1].0..=r[1].1 {
                for x in r[0].0..=r[0].1 {
                    if let Some(c) = counts.get_mut(x + nb[0] * (y + nb[1] * z)) {
                        *c += 1;
                    }
                }
            }
        }
    }
    let mut offsets = vec![0u32; blocks + 1];
    let mut acc = 0u32;
    for (o, c) in offsets.iter_mut().zip(&counts) {
        *o = acc;
        acc = acc.saturating_add(*c);
    }
    let mut fill = offsets.clone();
    let mut members = vec![0u32; acc as usize];
    for (i, (_, _, lo, hi)) in prims.iter().enumerate() {
        let r = range(*lo, *hi);
        for z in r[2].0..=r[2].1 {
            for y in r[1].0..=r[1].1 {
                for x in r[0].0..=r[0].1 {
                    if let Some(f) = fill.get_mut(x + nb[0] * (y + nb[1] * z))
                        && let Some(slot) = members.get_mut(*f as usize)
                    {
                        *slot = i as u32;
                        *f += 1;
                    }
                }
            }
        }
    }
    let candidates = |b: usize| -> &[u32] {
        let (s, e) = (offsets.get(b).copied().unwrap_or(0) as usize, offsets.get(b + 1).copied().unwrap_or(0) as usize);
        members.get(s..e).unwrap_or(&[])
    };
    let value = |p: Vec3, cand: &[u32]| -> f64 {
        let (mut add, mut cut) = (f64::INFINITY, f64::INFINITY);
        for i in cand {
            if let Some((q, is_cut, _, _)) = prims.get(*i as usize) {
                let v = q.eval(p);
                if *is_cut { cut = cut.min(v) } else { add = add.min(v) }
            }
        }
        add.max(-cut)
    };
    let node = |i: usize, j: usize, k: usize| origin + Vec3::new(i as f64 * step, j as f64 * step, k as f64 * step);

    // Pass 1: the blocks the surface may cross.
    let half_diag = 0.5 * cell * 3f64.sqrt();
    let mut surface: Vec<(usize, [usize; 3])> = Vec::new();
    let mut evals = 0u64;
    for bz in 0..nb[2] {
        for by in 0..nb[1] {
            for bx in 0..nb[0] {
                let b = bx + nb[0] * (by + nb[1] * bz);
                let cand = candidates(b);
                if !cand.iter().any(|i| prims.get(*i as usize).is_some_and(|q| !q.1)) {
                    continue;
                }
                let c = node(bx * BLOCK, by * BLOCK, bz * BLOCK) + Vec3::new(cell / 2.0, cell / 2.0, cell / 2.0);
                let f = value(c, cand);
                evals += cand.len() as u64;
                if f.abs() <= half_diag + step {
                    surface.push((b, [bx, by, bz]));
                    evals = evals.saturating_add(cand.len() as u64 * ((BLOCK + 1) as u64).pow(3));
                }
            }
        }
    }
    if surface.is_empty() {
        return Err(Fail::Empty);
    }
    // About eight triangles per surface cell; a surface block holds about BLOCK² of them.
    let estimate = surface.len() as f64 * (BLOCK * BLOCK) as f64 * 5.0;
    if estimate > 1.6 * max_tris as f64 {
        return Err(Fail::Over(estimate / max_tris as f64));
    }
    if evals > MAX_EVALS {
        return Err(Fail::Over((evals as f64 / MAX_EVALS as f64).max(1.1)));
    }

    // Pass 2: marching tetrahedra in each surface block.
    let tets = kuhn_tets();
    let corner = |c: usize| [c & 1, (c >> 1) & 1, (c >> 2) & 1];
    let id = |i: usize, j: usize, k: usize| -> u64 { i as u64 + nn[0] as u64 * (j as u64 + nn[1] as u64 * k as u64) };
    let side = BLOCK + 1;
    let mut vals = vec![0.0f64; side * side * side];
    let mut positions: Vec<Vec3> = Vec::new();
    // The block each vertex was made in: its field's candidates, for the projection.
    let mut owner: Vec<u32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut keyed: HashMap<(u64, u64), u32> = HashMap::new();
    let mut done = 0usize;
    for (b, [bx, by, bz]) in &surface {
        let cand = candidates(*b);
        let blk = u32::try_from(*b).unwrap_or(u32::MAX);
        let (i0, j0, k0) = (bx * BLOCK, by * BLOCK, bz * BLOCK);
        for k in 0..side {
            for j in 0..side {
                for i in 0..side {
                    if let Some(slot) = vals.get_mut(i + side * (j + side * k)) {
                        *slot = value(node(i0 + i, j0 + j, k0 + k), cand);
                    }
                }
            }
        }
        let at = |i: usize, j: usize, k: usize| vals.get(i + side * (j + side * k)).copied().unwrap_or(f64::INFINITY);
        for k in 0..BLOCK {
            for j in 0..BLOCK {
                for i in 0..BLOCK {
                    for tet in &tets {
                        let mut g = [(0usize, 0usize, 0usize); 4];
                        let mut f = [0.0f64; 4];
                        for (slot, c) in tet.iter().enumerate() {
                            let [dx, dy, dz] = corner(*c);
                            if let (Some(gs), Some(fs)) = (g.get_mut(slot), f.get_mut(slot)) {
                                *gs = (i + dx, j + dy, k + dz);
                                *fs = at(i + dx, j + dy, k + dz);
                            }
                        }
                        let inside = f.map(|v| v < 0.0);
                        let n_in = inside.iter().filter(|x| **x).count();
                        if n_in == 0 || n_in == 4 {
                            continue;
                        }
                        let mut vertex = |a: usize, b: usize| -> u32 {
                            let (ga, gb) = (g.get(a).copied().unwrap_or_default(), g.get(b).copied().unwrap_or_default());
                            let (ia, ib) = (id(i0 + ga.0, j0 + ga.1, k0 + ga.2), id(i0 + gb.0, j0 + gb.1, k0 + gb.2));
                            let key = if ia < ib { (ia, ib) } else { (ib, ia) };
                            if let Some(v) = keyed.get(&key) {
                                return *v;
                            }
                            let (fa, fb) = (f.get(a).copied().unwrap_or(0.0), f.get(b).copied().unwrap_or(0.0));
                            let t = if (fa - fb).abs() > 1e-300 { fa / (fa - fb) } else { 0.5 };
                            let t = if t.is_finite() { t.clamp(EDGE_CLAMP, 1.0 - EDGE_CLAMP) } else { 0.5 };
                            let (pa, pb) = (node(i0 + ga.0, j0 + ga.1, k0 + ga.2), node(i0 + gb.0, j0 + gb.1, k0 + gb.2));
                            let v = u32::try_from(positions.len()).unwrap_or(u32::MAX);
                            positions.push(pa + (pb - pa) * t);
                            owner.push(blk);
                            keyed.insert(key, v);
                            v
                        };
                        let ins: Vec<usize> = (0..4).filter(|s| inside.get(*s).copied().unwrap_or(false)).collect();
                        let outs: Vec<usize> = (0..4).filter(|s| !inside.get(*s).copied().unwrap_or(false)).collect();
                        match (ins.as_slice(), outs.as_slice()) {
                            ([a], [x, y, z]) => {
                                let (y, z) = if odd([*a, *x, *y, *z]) { (*z, *y) } else { (*y, *z) };
                                let t = [vertex(*a, *x), vertex(*a, y), vertex(*a, z)];
                                indices.extend(t);
                            }
                            ([x, y, z], [o]) => {
                                let (y, z) = if odd([*o, *x, *y, *z]) { (*z, *y) } else { (*y, *z) };
                                let t = [vertex(*o, *x), vertex(*o, z), vertex(*o, y)];
                                indices.extend(t);
                            }
                            ([a, b], [c, d]) => {
                                let (c, d) = if odd([*a, *b, *c, *d]) { (*d, *c) } else { (*c, *d) };
                                let (ac, ad, bd, bc) = (vertex(*a, c), vertex(*a, d), vertex(*b, d), vertex(*b, c));
                                indices.extend([ac, ad, bd, ac, bd, bc]);
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        done += 1;
        if indices.len() / 3 > max_tris {
            // Over part-way through: how far over the whole would be, at this rate.
            let whole = (indices.len() / 3) as f64 * surface.len() as f64 / done as f64;
            return Err(Fail::Over((whole / max_tris as f64 * 1.1).max(1.1)));
        }
    }
    if indices.is_empty() {
        return Err(Fail::Empty);
    }
    verify(&positions, &indices).map_err(Fail::Broken)?;
    let field = |v: usize, p: Vec3| value(p, candidates(owner.get(v).copied().unwrap_or(u32::MAX) as usize));
    if smooth {
        project(&mut positions, &indices, step, &field);
        verify(&positions, &indices).map_err(Fail::Broken)?;
    }
    let (positions, indices, bodies) = drop_crumbs(positions, indices);
    if indices.is_empty() {
        return Err(Fail::Empty);
    }
    Ok(Solid { positions, indices, step, bodies })
}

/// Newton steps per vertex onto the field's zero set.
const NEWTON_STEPS: usize = 4;
/// The farthest a vertex is moved onto the true surface, as a fraction of the grid step: it stays
/// in the cells around the grid edge it was made on.
const MAX_MOVE: f64 = 0.6;
/// The rounds of putting back vertices whose move turned a triangle over.
const UNDO_ROUNDS: usize = 12;
/// The least area a triangle keeps after the projection, mm².
const MIN_AREA: f64 = 1e-9;

/// The field's gradient at `p` by central differences `h` apart.
fn gradient(f: &dyn Fn(Vec3) -> f64, p: Vec3, h: f64) -> Vec3 {
    let d = |e: Vec3| (f(p + e) - f(p - e)) / (2.0 * h);
    Vec3::new(d(Vec3::new(h, 0.0, 0.0)), d(Vec3::new(0.0, h, 0.0)), d(Vec3::new(0.0, 0.0, h)))
}

/// A point moved onto the field's zero set by Newton steps along its gradient, at most
/// [`MAX_MOVE`] × `step` from where it was; the point itself when that does not bring it nearer.
pub(super) fn onto_surface(f: &dyn Fn(Vec3) -> f64, p0: Vec3, step: f64) -> Vec3 {
    let f0 = f(p0);
    if !f0.is_finite() {
        return p0;
    }
    let (h, reach) = (0.02 * step, MAX_MOVE * step);
    let mut p = p0;
    let mut fp = f0;
    for _ in 0..NEWTON_STEPS {
        if fp.abs() <= 1e-7 * step {
            break;
        }
        let g = gradient(f, p, h);
        let g2 = g.dot(g);
        if !(g2.is_finite() && g2 > 0.04) {
            break;
        }
        let mut q = p - g * (fp / g2);
        let off = q - p0;
        let l = off.len();
        if !l.is_finite() {
            break;
        }
        if l > reach {
            q = p0 + off * (reach / l);
        }
        let fq = f(q);
        if !(fq.is_finite() && fq.abs() < fp.abs()) {
            break;
        }
        p = q;
        fp = fq;
    }
    p
}

/// Moves every surface vertex onto the true surface (the zero set of the field itself, not of its
/// piecewise-linear interpolant), which takes off the grid's facets on curved parts. The
/// connectivity is the extractor's, unchanged; a vertex whose move turns one of its triangles over
/// (against its normal before), or leaves it without area, is put back, round by round, so the
/// shell stays closed, manifold and wound outward. `field(v, p)` is the field at `p` for vertex
/// `v`'s neighbourhood.
fn project(positions: &mut [Vec3], indices: &[u32], step: f64, field: &dyn Fn(usize, Vec3) -> f64) {
    let before: Vec<Vec3> = positions.to_vec();
    for (v, p) in positions.iter_mut().enumerate() {
        *p = onto_surface(&|q| field(v, q), *p, step);
    }
    let at = |ps: &[Vec3], i: u32| ps.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let tris: Vec<[u32; 3]> = indices.chunks_exact(3).filter_map(|t| Some([*t.first()?, *t.get(1)?, *t.get(2)?])).collect();
    // The triangles round each vertex.
    let mut around: Vec<Vec<u32>> = vec![Vec::new(); positions.len()];
    for (i, t) in tris.iter().enumerate() {
        for v in t {
            if let Some(list) = around.get_mut(*v as usize) {
                list.push(u32::try_from(i).unwrap_or(u32::MAX));
            }
        }
    }
    // The triangles whose shape changed since they were last checked: all of them at first.
    let mut dirty: Vec<u32> = (0..u32::try_from(tris.len()).unwrap_or(u32::MAX)).collect();
    for round in 0..=UNDO_ROUNDS {
        let mut undo: Vec<u32> = Vec::new();
        for &ti in &dirty {
            let Some(&[a, b, c]) = tris.get(ti as usize) else { continue };
            let n0 = (at(&before, b) - at(&before, a)).cross(at(&before, c) - at(&before, a));
            let n1 = (at(positions, b) - at(positions, a)).cross(at(positions, c) - at(positions, a));
            if n0.dot(n1) <= 0.0 || n1.len() < 2.0 * MIN_AREA {
                undo.extend([a, b, c]);
            }
        }
        undo.extend(crossings(positions, &tris, &dirty, step));
        if undo.is_empty() {
            return;
        }
        if round == UNDO_ROUNDS {
            break;
        }
        // Put back each offending vertex and the ring round it, and check again what that moved.
        let mut moved: Vec<u32> = Vec::new();
        for i in undo {
            for &ti in around.get(i as usize).map_or(&[][..], Vec::as_slice) {
                if let Some(t) = tris.get(ti as usize) {
                    moved.extend(t.iter().copied());
                }
            }
        }
        moved.sort_unstable();
        moved.dedup();
        let mut next: Vec<u32> = Vec::new();
        for i in moved {
            if let (Some(p), Some(q)) = (positions.get_mut(i as usize), before.get(i as usize))
                && *p != *q
            {
                *p = *q;
                next.extend(around.get(i as usize).map_or(&[][..], Vec::as_slice));
            }
        }
        next.sort_unstable();
        next.dedup();
        dirty = next;
    }
    // Still turned over or crossing after every round: the extractor's own shell.
    positions.copy_from_slice(&before);
}

/// Whether the segment `p`–`q` passes through the inside of triangle `t`.
fn segment_crosses(p: Vec3, q: Vec3, t: &[Vec3; 3]) -> bool {
    let [t0, t1, t2] = *t;
    let (e1, e2, d) = (t1 - t0, t2 - t0, q - p);
    let h = d.cross(e2);
    let a = e1.dot(h);
    if a.is_nan() || a.abs() < 1e-14 {
        return false;
    }
    let f = 1.0 / a;
    let s = p - t0;
    let u = f * s.dot(h);
    let qv = s.cross(e1);
    let v = f * d.dot(qv);
    let w = f * e2.dot(qv);
    let eps = 1e-9;
    u > -eps && v > -eps && u + v < 1.0 + eps && w > -eps && w < 1.0 + eps
}

/// The vertices of every pair of triangles, sharing no vertex, one of them in `check`, that pass
/// through each other: each triangle binned by its centroid in cells of twice the step and the
/// 27 cells around each checked one searched (a moved triangle is never longer than about two
/// steps).
fn crossings(positions: &[Vec3], tris: &[[u32; 3]], check: &[u32], step: f64) -> Vec<u32> {
    if check.is_empty() {
        return Vec::new();
    }
    let cell = 2.0 * step;
    let pos = |i: u32| positions.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let key = |p: Vec3| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64, (p.z / cell).floor() as i64);
    let mut bins: HashMap<(i64, i64, i64), Vec<u32>> = HashMap::new();
    for (i, t) in tris.iter().enumerate() {
        let c = (pos(t[0]) + pos(t[1]) + pos(t[2])) * (1.0 / 3.0);
        bins.entry(key(c)).or_default().push(u32::try_from(i).unwrap_or(u32::MAX));
    }
    let boxed = |v: &[Vec3; 3]| {
        let mut b = (v[0], v[0]);
        grow(&mut b, v[1]);
        grow(&mut b, v[2]);
        b
    };
    let mut out = Vec::new();
    for &i in check {
        let Some(t) = tris.get(i as usize) else { continue };
        let tv = [pos(t[0]), pos(t[1]), pos(t[2])];
        let (tlo, thi) = boxed(&tv);
        let (x, y, z) = key((tv[0] + tv[1] + tv[2]) * (1.0 / 3.0));
        for dz in -1..=1 {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let Some(list) = bins.get(&(x + dx, y + dy, z + dz)) else { continue };
                    for &j in list {
                        let Some(u) = tris.get(j as usize) else { continue };
                        if j == i || t.iter().any(|v| u.contains(v)) {
                            continue;
                        }
                        let uv = [pos(u[0]), pos(u[1]), pos(u[2])];
                        let (ulo, uhi) = boxed(&uv);
                        if ulo.x > thi.x || ulo.y > thi.y || ulo.z > thi.z || tlo.x > uhi.x || tlo.y > uhi.y || tlo.z > uhi.z {
                            continue;
                        }
                        let hit = (0..3).any(|k| {
                            let (a, b) = (k, (k + 1) % 3);
                            segment_crosses(tv[a], tv[b], &uv) || segment_crosses(uv[a], uv[b], &tv)
                        });
                        if hit {
                            out.extend(t.iter().chain(u.iter()).copied());
                        }
                    }
                }
            }
        }
    }
    out
}

/// The closed shells smaller than this fraction of the whole (by volume) are sampling crumbs —
/// a grid node or two of metal left between two seats — and are left out.
const CRUMB: f64 = 1e-3;

/// The shell without its crumbs: each edge-connected shell is closed on its own, so leaving one
/// out leaves the rest closed and manifold. Also how many shells are kept.
fn drop_crumbs(positions: Vec<Vec3>, indices: Vec<u32>) -> (Vec<Vec3>, Vec<u32>, usize) {
    let mut parent: Vec<u32> = (0..u32::try_from(positions.len()).unwrap_or(u32::MAX)).collect();
    fn find(p: &mut [u32], mut i: u32) -> u32 {
        while let Some(&up) = p.get(i as usize) {
            if up == i {
                break;
            }
            let grand = p.get(up as usize).copied().unwrap_or(up);
            if let Some(slot) = p.get_mut(i as usize) {
                *slot = grand;
            }
            i = grand;
        }
        i
    }
    for t in indices.chunks_exact(3) {
        let (Some(a), Some(b), Some(c)) = (t.first(), t.get(1), t.get(2)) else { continue };
        let ra = find(&mut parent, *a);
        for v in [*b, *c] {
            let rv = find(&mut parent, v);
            if let Some(slot) = parent.get_mut(rv as usize) {
                *slot = ra;
            }
        }
    }
    let at = |i: u32| positions.get(i as usize).copied().unwrap_or(Vec3::ZERO);
    let mut volume: HashMap<u32, f64> = HashMap::new();
    let mut roots = Vec::with_capacity(indices.len() / 3);
    for t in indices.chunks_exact(3) {
        let (Some(a), Some(b), Some(c)) = (t.first(), t.get(1), t.get(2)) else { continue };
        let r = find(&mut parent, *a);
        roots.push(r);
        *volume.entry(r).or_default() += at(*a).dot(at(*b).cross(at(*c))) / 6.0;
    }
    if volume.len() <= 1 {
        return (positions, indices, volume.len());
    }
    let total: f64 = volume.values().map(|v| v.abs()).sum();
    let bodies = volume.values().filter(|v| v.abs() >= CRUMB * total).count();
    let keep: Vec<u32> = indices
        .chunks_exact(3)
        .zip(&roots)
        .filter(|(_, r)| volume.get(r).is_some_and(|v| v.abs() >= CRUMB * total))
        .flat_map(|(t, _)| t.iter().copied())
        .collect();
    // Renumber the vertices still used.
    let mut map = vec![u32::MAX; positions.len()];
    let mut kept = Vec::new();
    let mut out = Vec::with_capacity(keep.len());
    for i in keep {
        let Some(slot) = map.get_mut(i as usize) else { continue };
        if *slot == u32::MAX {
            *slot = u32::try_from(kept.len()).unwrap_or(u32::MAX);
            kept.push(at(i));
        }
        out.push(*slot);
    }
    (kept, out, bodies)
}

/// Every edge used once each way, no triangle repeating a vertex.
pub(super) fn verify(positions: &[Vec3], indices: &[u32]) -> Result<(), String> {
    let mut edges: HashMap<(u32, u32), u32> = HashMap::with_capacity(indices.len());
    for t in indices.chunks_exact(3) {
        let (Some(a), Some(b), Some(c)) = (t.first().copied(), t.get(1).copied(), t.get(2).copied()) else { continue };
        if a == b || b == c || a == c {
            return Err("a triangle repeats a vertex".into());
        }
        if [a, b, c].iter().any(|i| positions.get(*i as usize).is_none_or(|p| !p.is_finite())) {
            return Err("a vertex is missing or not finite".into());
        }
        for e in [(a, b), (b, c), (c, a)] {
            *edges.entry(e).or_default() += 1;
        }
    }
    for ((a, b), n) in &edges {
        if *n != 1 || edges.get(&(*b, *a)) != Some(&1) {
            return Err(format!("the edge {a}–{b} is not shared by exactly two triangles running opposite ways"));
        }
    }
    Ok(())
}

/// Whether a permutation of four is odd.
fn odd(p: [usize; 4]) -> bool {
    let mut inv = 0;
    for i in 0..4 {
        for j in i + 1..4 {
            if p.get(i) > p.get(j) {
                inv += 1;
            }
        }
    }
    inv % 2 == 1
}

/// The six tetrahedra of the Kuhn split of a cube (corner `c` is at x = bit 0, y = bit 1, z = bit
/// 2), each ordered so it is positively oriented.
fn kuhn_tets() -> [[usize; 4]; 6] {
    let perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    let pos = |c: usize| Vec3::new((c & 1) as f64, ((c >> 1) & 1) as f64, ((c >> 2) & 1) as f64);
    perms.map(|[a, b, _]| {
        let v1 = 1usize << a;
        let v2 = v1 | (1usize << b);
        let (p0, p1, p2, p3) = (pos(0), pos(v1), pos(v2), pos(7));
        let det = (p1 - p0).dot((p2 - p0).cross(p3 - p0));
        if det > 0.0 { [0, v1, v2, 7] } else { [0, v2, v1, 7] }
    })
}

/// The solid at `step` or as much coarser as it takes to stay under `max_tris`: the solid and
/// whether it was coarsened.
pub(super) fn solidify(csg: &Csg, step: f64, max_tris: usize) -> Result<(Solid, bool), String> {
    solidify_with(csg, step, max_tris, true)
}

/// [`solidify`], smoothed or not ([`extract_with`]).
pub(super) fn solidify_with(csg: &Csg, step: f64, max_tris: usize, smooth: bool) -> Result<(Solid, bool), String> {
    let mut step = if step.is_finite() && step > 1e-3 { step } else { 0.1 };
    let mut coarsened = false;
    for _ in 0..MAX_ATTEMPTS {
        match extract_with(csg, step, max_tris, smooth) {
            Ok(s) => return Ok((s, coarsened)),
            Err(Fail::Over(by)) => {
                let by = if by.is_finite() { by.clamp(1.0, 1e6) } else { 2.0 };
                step *= by.sqrt().max(1.15) * 1.05;
                coarsened = true;
            }
            // Too thin to catch at this step: sample finer, unless it was coarsened to fit.
            Err(Fail::Empty) if !coarsened && step / 2.0 >= MIN_STEP => step /= 2.0,
            Err(Fail::Empty) => {
                return Err("no metal is left to build: the piece is too thin to sample, or its stones' seats cut all of it away".into());
            }
            Err(Fail::Broken(e)) => return Err(format!("the merged solid failed its own check ({e}); nothing was written")),
        }
    }
    Err(format!("the piece is too large to build as one solid under {max_tris} triangles"))
}
