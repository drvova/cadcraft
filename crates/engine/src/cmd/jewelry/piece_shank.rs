//! The sheet of the shank shapes (`PIECE`): a rail band's front view following its rail, a split
//! shank's arms in the plan and the section, cathedral arches in the front view, a cable's strands
//! in the section and the plan; and each one's check. The numbers are [`super::super::shank`]'s.

use cadcraft_geom::{PI, TAU, Vec2};
use serde_json::Value;

use super::super::cable::MIN_STRAND;
use super::super::shank::{self, MIN_ARM};
use super::*;

/// Steps round a shaped band's outline in the front view.
const STEPS: usize = 360;

/// What a shank shape adds to the sheet.
#[derive(Default)]
pub(super) struct ShankSheet {
    pub shapes: Vec<(On, Shape)>,
    /// The plan's shapes in place of the band's rectangle.
    pub plan: Option<Vec<(On, Shape)>>,
    pub checks: Vec<Value>,
    /// The section view in place of the band's own, and how wide it is.
    pub sections: Option<(Vec<(On, Shape)>, f64)>,
    pub front_reach: f64,
    pub plan_reach: f64,
    /// How far the front view reaches below its middle.
    pub down: f64,
}

/// The RING block's two outlines when the shank is not round: the inside and the outside.
pub(super) fn front_ring(p: &PieceParams) -> Option<Vec<EntityKind>> {
    let poly = |pts: Vec<Vec2>| helpers::lwpoly(pts.into_iter().map(|q| PolyVertex::with_bulge(q, 0.0)).collect(), true);
    let sh = &p.shape;
    if let Some(rail) = &sh.rail {
        return Some(vec![poly(rail.scaled(p.inner())), poly(rail.outside(p.inner(), p.wall, STEPS))]);
    }
    if sh.cathedral.is_some() {
        let ro = p.outer() / 2.0;
        let outside = (0..STEPS)
            .map(|k| {
                let theta = TAU * k as f64 / STEPS as f64;
                Vec2::new(theta.sin(), theta.cos()) * (ro + sh.lift() * sh.s(theta))
            })
            .collect();
        return Some(vec![EntityKind::Circle(cadcraft_doc::Circle { center: Vec3::ZERO, radius: p.inner() / 2.0 }), poly(outside)]);
    }
    None
}

/// The shank shape's part of the sheet.
pub(super) fn sheet(p: &PieceParams, section: &Section) -> ShankSheet {
    let mut k = ShankSheet::default();
    let sh = &p.shape;
    let (ri, ro) = (p.inner() / 2.0, p.outer() / 2.0);
    if let Some(rail) = &sh.rail {
        let outside = rail.outside(p.inner(), p.wall, STEPS);
        k.front_reach = outside.iter().fold(0.0f64, |m, q| m.max(q.x.abs()));
        k.down = outside.iter().fold(0.0f64, |m, q| m.max(-q.y));
        k.plan = Some(vec![(On::Metal, rect(Vec2::ZERO, 2.0 * k.front_reach, p.width))]);
        let (narrow, wide, tall) = rail.spans(p.inner());
        let d = p.inner();
        let ok = narrow + 1e-9 >= 0.8 * d;
        k.checks.push(check(
            "rail",
            ok,
            format!(
                "The rail's inside is the finger's {} mm circumference, {} × {} mm; at its narrowest it is {} mm across, {} the 80 % of the {} mm finger a hand slips through",
                fmt_mm(PI * d),
                fmt_mm(wide),
                fmt_mm(tall),
                fmt_mm(narrow),
                if ok { "at or over" } else { "under" },
                fmt_mm(d)
            ),
        ));
    }
    if sh.cathedral.is_some() {
        // The arch's underside over the finger, from one shoulder to the other.
        let from = sh.span();
        let arch: Vec<(Vec2, f64)> = (0..=96)
            .map(|j| {
                let theta = -from + 2.0 * from * f64::from(j) / 96.0;
                (Vec2::new(theta.sin(), theta.cos()) * (ri + sh.lift() * sh.s(theta)), 0.0)
            })
            .collect();
        k.shapes.push((On::Metal, Shape::Poly { v: arch, closed: false }));
        let lift = sh.lift();
        let ok = lift <= 3.0 * p.wall + 1e-9;
        k.checks.push(check(
            "cathedral",
            ok,
            format!(
                "Cathedral shoulders rise {} mm in arches over {}° each side of the head{}",
                fmt_mm(lift),
                fmt_mm(sh.from),
                if ok {
                    format!(", within three walls ({} mm)", fmt_mm(3.0 * p.wall))
                } else {
                    format!(": over three walls ({} mm) the arches are weak; lower them or thicken the band", fmt_mm(3.0 * p.wall))
                }
            ),
        ));
    }
    if sh.split > 1 {
        let n = sh.split;
        let polys = shank::strips(&section.polygon(64), p.width, n);
        let arm = p.width / f64::from(n);
        let walls: Vec<f64> = (0..n)
            .map(|i| {
                let x = p.width * ((f64::from(i) + 0.5) / f64::from(n) - 0.5);
                section.height_at(x) - section.inside_at(x)
            })
            .collect();
        let wall = walls.iter().copied().fold(f64::INFINITY, f64::min);
        let ok = arm + 1e-9 >= MIN_ARM && wall + 1e-9 >= MIN_CAST_WALL;
        k.checks.push(check(
            "split",
            ok,
            format!(
                "The shank parts into {n} arms of {} mm, {} mm apart under the head, from {}° each side of it; the thinnest arm's wall is {} mm{}",
                fmt_mm(arm),
                fmt_mm(sh.gap),
                fmt_mm(sh.from),
                fmt_mm(wall),
                if ok {
                    format!(" (at or over {MIN_ARM} mm wide and {MIN_CAST_WALL} mm thick)")
                } else {
                    format!(": a bench wants every arm at least {MIN_ARM} mm wide and {MIN_CAST_WALL} mm thick; widen the band or split it in fewer")
                }
            ),
        ));
        // The section: the arms as they stand under the head.
        let spread = p.width + f64::from(n - 1) * sh.gap;
        let own: Vec<(On, Shape)> = polys
            .iter()
            .enumerate()
            .map(|(i, poly)| (On::Metal, closed(&poly.iter().map(|q| *q + Vec2::new(sh.shift(i as u32, 0.0), 0.0)).collect::<Vec<_>>())))
            .collect();
        k.sections = Some((own, spread));
        // The plan: the band's ends past the split, and each arm over the top.
        let from = sh.span().min(PI / 2.0);
        let top = ro + sh.lift();
        let mut plan = Vec::new();
        let edge = ro * from.sin();
        if ro - edge > 1e-6 {
            for sign in [-1.0, 1.0] {
                plan.push((On::Metal, rect(Vec2::new(sign * (ro + edge) / 2.0, 0.0), ro - edge, p.width)));
            }
        }
        for i in 0..n {
            let lo = p.width * (f64::from(i) / f64::from(n) - 0.5);
            let hi = p.width * (f64::from(i + 1) / f64::from(n) - 0.5);
            let steps = 48;
            let at = |j: usize| -from + 2.0 * from * j as f64 / steps as f64;
            let r = |theta: f64| ro + sh.lift() * sh.s(theta);
            let mut rim: Vec<Vec2> = (0..=steps).map(|j| Vec2::new(r(at(j)) * at(j).sin(), hi + sh.shift(i, at(j)))).collect();
            rim.extend((0..=steps).rev().map(|j| Vec2::new(r(at(j)) * at(j).sin(), lo + sh.shift(i, at(j)))));
            plan.push((On::Metal, closed(&rim)));
        }
        k.plan = Some(plan);
        k.plan_reach = spread / 2.0;
        k.front_reach = k.front_reach.max(top);
    }
    if let Some(c) = shank::cable(p) {
        let ok = c.wire + 1e-9 >= MIN_STRAND;
        k.checks.push(check(
            "cable",
            ok,
            format!(
                "{} strands of {} mm wire twisted {} times round the finger, a {} mm bundle{}",
                c.strands,
                fmt_mm(c.wire),
                c.turns,
                fmt_mm(c.bundle()),
                if ok {
                    format!(" (each strand at or over the {MIN_STRAND} mm a bench casts)")
                } else {
                    format!(": a strand under {MIN_STRAND} mm is too fine to cast reliably")
                }
            ),
        ));
        // The section at 12 o'clock: each strand's round wire.
        let base = ri;
        let own: Vec<(On, Shape)> = (0..c.strands)
            .map(|j| {
                let q = c.point(j, 0.0);
                (On::Metal, Shape::Circle { c: Vec2::new(q.z, q.y - base), r: c.wire / 2.0 })
            })
            .collect();
        k.sections = Some((own, c.bundle()));
        // The plan: each strand's axis over the top half, inside the bundle's outline.
        let mut plan = vec![(On::Metal, rect(Vec2::ZERO, 2.0 * ro, p.width))];
        for j in 0..c.strands {
            let steps = (c.turns as usize * 24).clamp(48, 2400);
            let v: Vec<(Vec2, f64)> = (0..=steps)
                .map(|i| {
                    let theta = -PI / 2.0 + PI * i as f64 / steps as f64;
                    let q = c.point(j, theta);
                    (Vec2::new(q.x, q.z), 0.0)
                })
                .collect();
            plan.push((On::Metal, Shape::Poly { v, closed: false }));
        }
        k.plan = Some(plan);
    }
    k
}
