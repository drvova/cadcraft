//! A worn piece's prong head in metal, mm³, worked out from its parts rather than cast: every
//! prong as a wire along the path the mesh gives it (foot, gallery rail, girdle, tip) less what
//! of its section lies in the stone's seat, a styled prong's top (a claw's cone, a tab's or a V's
//! bars) the same way, the gallery rail less its share in the seat, and the base (a wire ring
//! through the feet and a spoke from each foot to the middle) less the metal counted twice where
//! the parts meet: each prong through the rail, each prong's and spoke's end in the ring, the
//! spokes' ends in the middle.
//!
//! The seat is the stone grown by the seat's clearance, its pavilion and crown as cones (a
//! cabochon's dome under its tangent lines) — what the solid's seat cuts. A wire's section in
//! it is the circular segment on the stone's side of the seat's face at that point.
//! `cross_tests::the_prong_head_estimate_is_within_ten_percent_of_the_cast_solid` checks this
//! against the solid `STLOUT` casts.

use cadcraft_geom::{PI, TAU, Vec2, Vec3};

use super::piece_params::{HaloSeat, PRONG_FOOT, PieceParams, proportions, table_ratio};
use super::prongs::{self, Plane, ProngPart, Site};

/// The seat's clearance round the stone (the solid's own).
const CLEARANCE: f64 = 0.05;
/// Steps along a wire's path between two of its points.
const STEPS: usize = 6;
/// Samples along each edge of a bar.
const BAR_SAMPLES: usize = 8;

/// The seat a head's stone sits in, in its girdle plane: `o` out of the girdle outline, `h` over
/// the girdle's middle.
struct Seat {
    reach: f64,
    girdle: f64,
    crown: f64,
    pavilion: f64,
    table: f64,
    cab: bool,
    /// A halo's seat plate round the girdle (`inner`, `outer` out of the outline, `lo`, `hi`),
    /// which the prongs pass through.
    plate: Option<(f64, f64, f64, f64)>,
}

impl Seat {
    /// How far a point lies outside the seat (negative inside).
    fn outside(&self, o: f64, h: f64) -> f64 {
        let (a, c) = (self.reach.max(0.0), CLEARANCE);
        if self.cab {
            let depth = self.crown.max(1e-6);
            let slope = (a * 4.0 / 3.0 / depth).min(50.0);
            let inset = (a * (0.4 + 4.0 / 3.0 * (h / depth - 0.8))).max(0.0);
            let k = (1.0 + slope * slope).sqrt();
            return ((o + inset) / k - c).max((-c - h).max(h - depth - c));
        }
        let g2 = self.girdle / 2.0;
        let sp = (a / self.pavilion.max(1e-6)).min(50.0);
        let sc = (a * (1.0 - self.table.clamp(0.0, 1.0)) / self.crown.max(1e-6)).min(50.0);
        let (tp, tc) = ((-g2 - h).max(0.0), (h - g2).max(0.0));
        let side = (o + sp * tp + sc * tc) / self.slope() - c;
        side.max((-g2 - self.pavilion - c - h).max(h - g2 - self.crown - c))
    }
    /// The steeper side's `√(1 + s²)`.
    fn slope(&self) -> f64 {
        let a = self.reach.max(0.0);
        let sp = (a / self.pavilion.max(1e-6)).min(50.0);
        let sc = (a * (1.0 - self.table.clamp(0.0, 1.0)) / self.crown.max(1e-6)).min(50.0);
        (1.0 + sp.max(sc).powi(2)).sqrt()
    }
    /// How far `q` (plan and height) lies outside the seat, seen from the prong at `site`.
    fn at(&self, site: &Site, q: Vec3) -> f64 {
        self.outside(out_of(site, q), q.z)
    }
}

/// How far `q` lies out of the girdle outline by the prong at `site`: along its outward normal,
/// or at a V's corner from the nearer of its two edges.
fn out_of(site: &Site, q: Vec3) -> f64 {
    let d = Vec2::new(q.x, q.y) - site.at;
    match site.corner {
        Some((e1, e2)) => {
            let normal = |e: Vec2, other: Vec2| {
                let n0 = Vec2::new(e.y, -e.x);
                if n0.dot(other) > 0.0 { -n0 } else { n0 }
            };
            d.dot(normal(e1, e2)).max(d.dot(normal(e2, e1)))
        }
        None => d.dot(site.out),
    }
}

/// The area of a disc of radius `r` on the far side of a line `d` from its centre (all of it when
/// `d ≤ −r`, none when `d ≥ r`).
fn segment(r: f64, d: f64) -> f64 {
    if !(r > 0.0 && d.is_finite()) {
        return 0.0;
    }
    if d >= r {
        0.0
    } else if d <= -r {
        PI * r * r
    } else {
        r * r * (d / r).acos() - d * (r * r - d * d).max(0.0).sqrt()
    }
}

/// A round section of radius `r` at `q`, less its part in the seat.
fn section(seat: &Seat, site: &Site, q: Vec3, r: f64) -> f64 {
    let mut a = PI * r * r - segment(r, seat.at(site, q));
    if let Some((inner, outer, lo, hi)) = seat.plate
        && (lo..=hi).contains(&q.z)
    {
        // The halo's seat holds this part of the prong already.
        let o = out_of(site, q);
        a -= segment(r, inner - o) - segment(r, outer - o);
    }
    a.max(0.0)
}

/// A wire of radius `r` along `pts` (no end caps), less its part in the seat.
fn wire(seat: &Seat, site: &Site, pts: &[Vec3], r: f64) -> f64 {
    let mut v = 0.0;
    for w in pts.windows(2) {
        let [a, b] = w else { continue };
        for k in 0..STEPS {
            let (t0, t1) = (k as f64 / STEPS as f64, (k + 1) as f64 / STEPS as f64);
            let (p0, p1) = (lerp(*a, *b, t0), lerp(*a, *b, t1));
            v += (p1 - p0).len() * section(seat, site, lerp(p0, p1, 0.5), r);
        }
    }
    v
}

/// A ball's half of radius `r` at `q`, less its share in the seat.
fn cap(seat: &Seat, site: &Site, q: Vec3, r: f64) -> f64 {
    2.0 / 3.0 * PI * r.powi(3) * section(seat, site, q, r) / (PI * r * r).max(1e-12)
}

/// Two round wires of radii `a` and `b` crossing square, axes meeting: the metal they share.
pub(super) fn crossing(a: f64, b: f64) -> f64 {
    let (lo, hi) = (a.min(b).max(0.0), a.max(b).max(0.0));
    let n = 32;
    let dx = lo / n as f64;
    let mut v = 0.0;
    for i in 0..n {
        let x = (i as f64 + 0.5) * dx;
        v += (lo * lo - x * x).max(0.0).sqrt() * (hi * hi - x * x).max(0.0).sqrt() * dx;
    }
    8.0 * v
}

fn lerp(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    a + (b - a) * t
}

fn inside_capsule(q: Vec3, a: Vec3, b: Vec3, r: f64) -> bool {
    let ab = b - a;
    let t = ((q - a).dot(ab) / ab.dot(ab).max(1e-12)).clamp(0.0, 1.0);
    (q - (a + ab * t)).len() <= r
}

/// A styled prong's top: its parts outside the seat, each counted once, and none of what the
/// leg's last run (`leg`, radius `r`) already holds.
fn top(seat: &Seat, site: &Site, parts: &[ProngPart], leg: (Vec3, Vec3), r: f64) -> f64 {
    let mut v = 0.0;
    for (i, part) in parts.iter().enumerate() {
        match *part {
            ProngPart::Cone { a, ra, b, rb } => {
                let n = 4 * STEPS;
                let len = (b - a).len();
                for k in 0..n {
                    let t = (k as f64 + 0.5) / n as f64;
                    v += len / n as f64 * section(seat, site, lerp(a, b, t), ra + (rb - ra) * t);
                }
                v += cap(seat, site, b, rb);
            }
            ProngPart::Bar { c, x, y, z, h } => {
                let n = BAR_SAMPLES;
                let cell = 8.0 * h.x * h.y * h.z / (n * n * n) as f64;
                let at = |k: usize| (k as f64 + 0.5) / n as f64 * 2.0 - 1.0;
                for (ix, iy, iz) in (0..n).flat_map(|ix| (0..n).flat_map(move |iy| (0..n).map(move |iz| (ix, iy, iz)))) {
                    let q = c + x * (at(ix) * h.x) + y * (at(iy) * h.y) + z * (at(iz) * h.z);
                    let earlier = parts.iter().take(i).any(|e| match *e {
                        ProngPart::Bar { c, x, y, z, h } => {
                            let d = q - c;
                            d.dot(x).abs() <= h.x && d.dot(y).abs() <= h.y && d.dot(z).abs() <= h.z
                        }
                        ProngPart::Cone { a, ra, b, rb } => inside_capsule(q, a, b, ra.max(rb)),
                    });
                    if !earlier && !inside_capsule(q, leg.0, leg.1, r) && seat.at(site, q) > 0.0 {
                        v += cell;
                    }
                }
            }
        }
    }
    v
}

/// The perimeter of an ellipse `l` by `w` (Ramanujan's).
fn ellipse_perimeter(l: f64, w: f64) -> f64 {
    let (a, b) = (l / 2.0, w / 2.0);
    let h = ((a - b) / (a + b).max(1e-12)).powi(2);
    PI * (a + b) * (1.0 + 3.0 * h / (10.0 + (4.0 - 3.0 * h).max(0.0).sqrt()))
}

/// The keel's half length a cut's pavilion runs down to (none when it comes to a point).
fn keel_half(cut: &str, l: f64, w: f64) -> f64 {
    let (long, short) = (l.max(w), l.min(w));
    if matches!(cut, "pear" | "heart" | "trillion" | "triangle" | "cabochon") || long <= 1.08 * short {
        return 0.0;
    }
    let share = if matches!(cut, "marquise" | "oval") { 0.6 } else { 1.0 };
    (long - short) / 2.0 * share
}

/// One worn piece's prong head and its base, mm³ (see the module's note).
pub(super) fn prong_head_volume(p: &PieceParams) -> f64 {
    let Some(cut) = p.cut_data() else { return 0.0 };
    let head = p.head();
    let (l, wd) = (p.stone_length, p.stone_width);
    let cab = cut.name == "cabochon";
    let (girdle, crown, pavilion) = if cab { (0.0, head.depth, 0.0) } else { proportions(head.depth) };
    let plate = head.halo.filter(|_| p.halo_sites().is_some()).map(|h| {
        let near = h.offset - h.melee / 2.0;
        ((near - 0.1).max(0.02), near + h.melee + 0.2, -h.under, -0.04 * h.melee)
    });
    let seat = Seat { reach: l.min(wd) / 2.0, girdle, crown, pavilion, table: table_ratio(cut), cab, plate };
    let r = head.prong / 2.0;
    let rail_r = 0.7 * r;
    let sites: Vec<Vec2> = p.prong_sites().unwrap_or_default().into_iter().filter(|s| s.is_finite()).collect();
    let styled = prongs::styled_sites(cut, l, wd, &sites, p.prong.style, head.prong);
    let rail_h = -(girdle / 2.0 + 0.5 * pavilion);
    let tip_h = head.prong_height() - head.girdle_height() - r;
    let (_, foot_h) = super::findings::foot(p, Vec2::ZERO);
    let spec = p.top_spec(&head, l.min(wd), cut);
    let plane = Plane { o: Vec3::ZERO, u: Vec3::new(1.0, 0.0, 0.0), v: Vec3::new(0.0, 1.0, 0.0), w: Vec3::new(0.0, 0.0, 1.0) };
    // Along the stone's length (Y) the pavilion runs down to a keel's end.
    let keel = keel_half(cut.name, l, wd);
    let along = if wd > l { Vec2::new(1.0, 0.0) } else { Vec2::new(0.0, 1.0) };
    let under = |q: Vec2| if q.dot(along) >= 0.0 { along * keel } else { along * -keel };
    let mut v = 0.0;
    for site in &styled {
        let dir = site.at.normalized();
        if dir.len() < 0.5 {
            continue;
        }
        let foot = site.at * PRONG_FOOT;
        let mut path = vec![Vec3::new(foot.x, foot.y, foot_h)];
        if !cab {
            let q = site.at.lerp(under(site.at), 0.5) + dir * (1.2 * rail_r);
            path.push(Vec3::new(q.x, q.y, rail_h));
        }
        path.push(Vec3::new(site.at.x, site.at.y, 0.0));
        let round = prongs::is_round(p.prong.style, site);
        if round {
            let tip = site.at - dir * (spec.cover - r);
            path.push(Vec3::new(tip.x, tip.y, tip_h));
        }
        let smooth = super::mesh::smooth_path(&path, 8);
        v += wire(&seat, site, &smooth, r);
        if round {
            if let Some(end) = smooth.last() {
                v += cap(&seat, site, *end, r);
            }
        } else {
            let n = smooth.len();
            let leg = (smooth.get(n.saturating_sub(2)).copied().unwrap_or(Vec3::ZERO), smooth.last().copied().unwrap_or(Vec3::ZERO));
            v += top(&seat, site, &prongs::top_parts(&plane, site, &spec), leg, r);
        }
        if !cab {
            v -= crossing(rail_r, r);
        }
    }
    if !cab {
        // The rail: half-way down the pavilion, just outside it.
        let len = 0.5 * ellipse_perimeter(l, wd) + 2.0 * keel + TAU * 1.2 * rail_r;
        let d = 1.2 * rail_r / seat.slope() - CLEARANCE;
        v += len * (PI * rail_r * rail_r - segment(rail_r, d));
    }
    // The base: a ring through the feet, and a spoke from each foot to the middle.
    let mut feet: Vec<Vec2> = sites.iter().map(|s| *s * PRONG_FOOT).collect();
    feet.sort_by(|a, b| a.y.atan2(a.x).total_cmp(&b.y.atan2(b.x)));
    let n = feet.len();
    if n >= 3 {
        let ring: f64 =
            (0..n).map(|i| (feet.get((i + 1) % n).copied().unwrap_or(Vec2::ZERO) - feet.get(i).copied().unwrap_or(Vec2::ZERO)).len()).sum();
        v += PI * r * r * ring;
        // Each prong's end and each spoke's end in the ring.
        v -= styled.len() as f64 * 8.0 / 3.0 * r.powi(3);
        v -= n as f64 * (8.0 / 3.0 * r.powi(3) + 2.0 / 3.0 * PI * r.powi(3));
    }
    let r3 = r.powi(3);
    for f in &feet {
        // A spoke from the ball at the middle; the part of its first radius outside that ball.
        v += PI * r * r * (f.len() - r).max(0.0) + PI * r3 / 3.0;
    }
    if n > 0 {
        v += 4.0 / 3.0 * PI * r3;
        // Neighbouring spokes share metal by the middle, the more the closer they lie.
        for i in 0..n {
            let (a, b) = (feet.get(i).copied().unwrap_or(Vec2::ZERO), feet.get((i + 1) % n).copied().unwrap_or(Vec2::ZERO));
            let theta = a.normalized().dot(b.normalized()).clamp(-1.0, 1.0).acos();
            if n >= 2 && theta > 0.2 && theta < PI - 1e-6 {
                v -= (4.0 * r3 / (3.0 * theta.sin()) - 2.0 / 3.0 * theta * r3).max(0.0);
            }
        }
    }
    if v.is_finite() { v.max(0.0) } else { 0.0 }
}

/// The metal `n` melee's seats take out of a halo's seat plate (from `−under` to `top`, under
/// the girdles' plane): each its pavilion's cone grown by the clearance, and the hole through
/// the rest of the plate under it, half the melee across.
pub(super) fn halo_seats(seat: &HaloSeat, n: usize) -> f64 {
    let r = seat.melee / 2.0;
    let (g, _, pav) = proportions(seat.depth);
    let (lo, hi) = (-seat.under, -0.04 * seat.melee);
    let sp = (r / pav.max(1e-6)).min(50.0);
    let k = (1.0 + sp * sp).sqrt();
    let steps = 32;
    let dh = (hi - lo).max(0.0) / steps as f64;
    let mut one = 0.0;
    for i in 0..steps {
        let h = lo + (i as f64 + 0.5) * dh;
        let cone = r + CLEARANCE * k - sp * (-g / 2.0 - h).max(0.0);
        let rr = cone.max(0.5 * r).max(0.0);
        one += PI * rr * rr * dh;
    }
    let v = one * n as f64;
    if v.is_finite() { v.max(0.0) } else { 0.0 }
}
