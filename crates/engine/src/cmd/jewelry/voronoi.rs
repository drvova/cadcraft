//! A Voronoi diagram on a strip that wraps round: the maths under a pierced or textured band.
//!
//! The band's outside is developed (unrolled) into a strip `0 ≤ s < L` round the band by
//! `−h ≤ z ≤ h` across it, periodic in `s` (the far end is the near end again). Sites stand one
//! to a cell of a `cols × rows` grid, each moved from its cell's centre by at most a known slack
//! (a seeded jitter, or a hexagonal lattice's half-cell offset). That bound is what makes the
//! diagram local: a point's nearest site, and every bisector that can bound its cell within a
//! distance `cap`, are among the sites of a small window of grid cells round it
//! ([`Sites::window`]), so the distance to the cell's boundary is exact up to `cap` and the
//! cells are exact polygons (half-plane clipping against the window, [`Sites::cell`]).
//!
//! A point's distance to its own cell's boundary is `min_b (|q−b|² − |q−a|²) / (2|b−a|)` over
//! the other sites `b` (`a` the nearest): the distance to the nearest bisector line, which for a
//! point inside a convex cell is the distance to the cell's boundary — and to the whole diagram.

use cadcraft_geom::Vec2;

/// The widest window (grid cells each side) a diagram is allowed: more means walls far too wide
/// for cells that small, which the caller refuses.
pub(super) const MAX_WINDOW: usize = 8;

/// A small seeded generator (SplitMix64): the same seed always gives the same pattern.
#[derive(Clone, Debug)]
pub(super) struct Rng(u64);

impl Rng {
    pub(super) fn new(seed: u64) -> Rng {
        Rng(seed ^ 0x9E37_79B9_7F4A_7C15)
    }
    pub(super) fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// A number in `[0, 1)`.
    pub(super) fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// The sites of a periodic diagram on a grid.
#[derive(Clone, Debug)]
pub(super) struct Sites {
    pub cols: usize,
    pub rows: usize,
    /// Cell size round (`cw`) and across (`ch`).
    pub cw: f64,
    pub ch: f64,
    /// The strip's length round the band (`cols · cw`).
    pub length: f64,
    /// Where row 0's cells begin across the strip.
    pub z0: f64,
    /// `pts[r · cols + c]`, the site of grid cell `(r, c)`, `0 ≤ s < length`.
    pub pts: Vec<Vec2>,
    /// Window half-widths (round, across) in grid cells.
    pub ns: usize,
    pub nz: usize,
    /// The distance up to which [`Sites::boundary`] is exact.
    pub cap: f64,
}

impl Sites {
    /// Sites with the given positions; `slack` is how far (as a fraction of a cell, round and
    /// across) any site may stand from its cell's centre. `None` when the window would be wider
    /// than [`MAX_WINDOW`] or the grid is degenerate.
    pub(super) fn new(cols: usize, rows: usize, cw: f64, ch: f64, z0: f64, pts: Vec<Vec2>, slack: (f64, f64), cap: f64) -> Option<Sites> {
        if cols == 0 || rows == 0 || pts.len() != cols.checked_mul(rows)? || !(cw > 1e-6 && ch > 1e-6 && cap.is_finite() && cap > 0.0) {
            return None;
        }
        let (jx, jz) = (slack.0.clamp(0.0, 0.5), slack.1.clamp(0.0, 0.5));
        // The nearest site is at most `r1` away; a site outside the window at least `r2`; a
        // bisector with a site outside the window is then at least (r2 − r1)/2 away.
        let r1 = ((0.5 + jx) * cw).hypot((0.5 + jz) * ch);
        let need = r1 + 2.0 * cap;
        let n_of = |c: f64, j: f64| -> Option<usize> {
            let n = (need / c - 0.5 + j).ceil().max(1.0);
            (n.is_finite() && n <= MAX_WINDOW as f64).then_some(n as usize)
        };
        let (ns, nz) = (n_of(cw, jx)?, n_of(ch, jz)?);
        Some(Sites { cols, rows, cw, ch, length: cw * cols as f64, z0, pts, ns, nz, cap })
    }

    /// `s` brought into `[0, length)`.
    pub(super) fn wrap(&self, s: f64) -> f64 {
        let w = s.rem_euclid(self.length);
        if w.is_finite() { w } else { 0.0 }
    }

    /// The grid cell `(row, column)` holding `q` (`z` clamped to the rows).
    fn grid(&self, q: Vec2) -> (i64, i64) {
        let c = (self.wrap(q.x) / self.cw).floor();
        let r = ((q.y - self.z0) / self.ch).floor().clamp(0.0, (self.rows - 1) as f64);
        (if r.is_finite() { r as i64 } else { 0 }, if c.is_finite() { c as i64 } else { 0 })
    }

    /// Every site of the window round grid cell `(r, c)` (`extra` more cells each way), each
    /// as the image nearest that cell, with its index.
    fn around(&self, r: i64, c: i64, extra: usize) -> impl Iterator<Item = (usize, Vec2)> + '_ {
        let (ns, nz) = ((self.ns + extra) as i64, (self.nz + extra) as i64);
        let (cols, rows) = (self.cols as i64, self.rows as i64);
        (r - nz..=r + nz).filter(move |rr| (0..rows).contains(rr)).flat_map(move |rr| {
            (c - ns..=c + ns).filter_map(move |cc| {
                let k = cc.rem_euclid(cols);
                let i = usize::try_from(rr * cols + k).ok()?;
                let p = self.pts.get(i)?;
                // The image of the site in the period `cc` falls in.
                let shift = (cc - k) as f64 / cols as f64 * self.length;
                Some((i, Vec2::new(p.x + shift, p.y)))
            })
        })
    }

    /// The nearest site to `q` (its index), and `q`'s distance to that cell's boundary, exact up
    /// to [`Sites::cap`] (capped there).
    pub(super) fn boundary(&self, q: Vec2) -> (usize, f64) {
        let q = Vec2::new(self.wrap(q.x), q.y);
        let (r, c) = self.grid(q);
        let mut best: Option<(usize, Vec2, f64)> = None;
        for (i, p) in self.around(r, c, 0) {
            let d = (q - p).dot(q - p);
            if best.is_none_or(|b| d < b.2) {
                best = Some((i, p, d));
            }
        }
        let Some((ia, a, da)) = best else { return (0, 0.0) };
        let mut e = self.cap;
        for (_, b) in self.around(r, c, 0) {
            let ab = b - a;
            let l = ab.len();
            if l < 1e-12 {
                continue;
            }
            let d = ((q - b).dot(q - b) - da) / (2.0 * l);
            e = e.min(d);
        }
        (ia, e.max(0.0))
    }

    /// Site `i`'s cell, every edge moved `inset` towards the site, clipped to `|z| ≤ h`: a convex
    /// polygon counter-clockwise, or empty when nothing is left.
    pub(super) fn cell(&self, i: usize, inset: f64, h: f64) -> Vec<Vec2> {
        let Some(a) = self.pts.get(i).copied() else { return Vec::new() };
        let span = (self.ns + 2) as f64 * self.cw;
        let mut poly = vec![Vec2::new(a.x - span, -h), Vec2::new(a.x + span, -h), Vec2::new(a.x + span, h), Vec2::new(a.x - span, h)];
        let (r, c) = ((i / self.cols) as i64, (i % self.cols) as i64);
        for (j, b) in self.around(r, c, 1) {
            let ab = b - a;
            let l = ab.len();
            if l < 1e-12 || (j == i && l < 1e-9) {
                continue;
            }
            let n = ab * (1.0 / l);
            // Keep n·q ≤ n·midpoint − inset.
            let m = (a + b) * 0.5;
            poly = clip(&poly, n, n.dot(m) - inset);
            if poly.is_empty() {
                break;
            }
        }
        poly
    }
}

/// The part of a convex polygon with `n·q ≤ c` (Sutherland–Hodgman against one line).
pub(super) fn clip(poly: &[Vec2], n: Vec2, c: f64) -> Vec<Vec2> {
    let mut out = Vec::with_capacity(poly.len() + 1);
    let len = poly.len();
    for k in 0..len {
        let (Some(p), Some(q)) = (poly.get(k), poly.get((k + 1) % len)) else { continue };
        let (dp, dq) = (n.dot(*p) - c, n.dot(*q) - c);
        if dp <= 0.0 {
            out.push(*p);
        }
        if (dp < 0.0 && dq > 0.0) || (dp > 0.0 && dq < 0.0) {
            let t = dp / (dp - dq);
            out.push(*p + (*q - *p) * t);
        }
    }
    if out.len() < 3 { Vec::new() } else { out }
}

/// A polygon's area (positive counter-clockwise).
pub(super) fn area(poly: &[Vec2]) -> f64 {
    let n = poly.len();
    let mut a = 0.0;
    for k in 0..n {
        if let (Some(p), Some(q)) = (poly.get(k), poly.get((k + 1) % n)) {
            a += p.x * q.y - q.x * p.y;
        }
    }
    a / 2.0
}

/// A polygon's perimeter.
pub(super) fn perimeter(poly: &[Vec2]) -> f64 {
    let n = poly.len();
    (0..n).filter_map(|k| Some((*poly.get((k + 1) % n)? - *poly.get(k)?).len())).sum()
}

/// How wide a simple polygon is at height `z` (the total length of its chords there).
pub(super) fn width_at(poly: &[Vec2], z: f64) -> f64 {
    let n = poly.len();
    let mut xs: Vec<f64> = Vec::new();
    for k in 0..n {
        let (Some(p), Some(q)) = (poly.get(k), poly.get((k + 1) % n)) else { continue };
        if (p.y > z) != (q.y > z) {
            xs.push(p.x + (z - p.y) / (q.y - p.y) * (q.x - p.x));
        }
    }
    xs.sort_by(f64::total_cmp);
    xs.chunks_exact(2).map(|w| if let [a, b] = w { (b - a).abs() } else { 0.0 }).sum()
}

/// `∫ width(z) · f(z) dz` over a polygon's height, by the midpoint rule on `n` slices.
pub(super) fn integrate(poly: &[Vec2], n: usize, f: impl Fn(f64) -> f64) -> f64 {
    let lo = poly.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
    let hi = poly.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
    if !(lo.is_finite() && hi.is_finite() && hi > lo) {
        return 0.0;
    }
    let n = n.clamp(1, 4096);
    let dz = (hi - lo) / n as f64;
    (0..n)
        .map(|k| {
            let z = lo + (k as f64 + 0.5) * dz;
            width_at(poly, z) * f(z)
        })
        .sum::<f64>()
        * dz
}
