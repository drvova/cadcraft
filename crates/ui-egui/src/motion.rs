//! The motion kit: the crate's transitions, so a state change glides instead of snapping.
//!
//! Cursor's feel is largely its transitions - `--default-transition-duration:.15s;
//! cubic-bezier(.4, 0, .2, 1)` on colour, background, border and opacity. egui has no CSS
//! transitions, so this module holds the small primitive a control calls each frame: an animated
//! value kept in the context's memory ([`value`], and its common case [`hover`]), the curve
//! ([`ease_out`]) and two blends ([`mix`], [`mix_color`]). A control paints the blended colour;
//! the drawn geometry never changes, so a fully hovered control is exactly the control it was.
//!
//! [`set_animations`] carries the app's "show animation effects" answer every frame, exactly like
//! [`crate::theme::set_active`] carries the theme. With it off, [`value`] and [`hover`] return
//! their target immediately - no partial states.

use std::cell::Cell;

/// Hover and press transitions: a state change this small reads best a touch quicker than
/// Cursor's default.
pub const DUR_FAST: f32 = 0.12;
/// Cursor's own default duration (`--default-transition-duration:.15s`).
pub const DUR_MED: f32 = 0.15;
/// Expansion and larger moves: long enough to read as a deliberate glide.
pub const DUR_SLOW: f32 = 0.25;

thread_local! {
    /// Whether the interface shows animation effects (set by the host each frame, as the theme
    /// is). On by default, as egui's own animations are.
    static ANIMATIONS: Cell<bool> = const { Cell::new(true) };
}

/// Per frame, exactly like [`crate::theme::set_active`]: the app's "show animation effects"
/// answer.
pub fn set_animations(on: bool) {
    ANIMATIONS.with(|a| a.set(on));
}

/// Whether animations are on.
pub fn animations() -> bool {
    ANIMATIONS.with(Cell::get)
}

/// The x control points of the curve; its y control points are 0 and 1.
const EASE_X1: f32 = 0.4;
const EASE_X2: f32 = 0.2;
/// How close the solved curve parameter has to be, in x.
const EASE_TOLERANCE: f32 = 1.0e-6;

/// cubic-bezier(.4, 0, .2, 1) - Cursor's `--default-transition-timing-function`. Endpoints exact
/// (0 -> 0, 1 -> 1), monotonic, no overshoot.
pub fn ease_out(t: f32) -> f32 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }
    bezier(solve_x(t), 0.0, 1.0).clamp(0.0, 1.0)
}

/// One axis of a cubic bezier from (0, 0) to (1, 1) whose control points sit at `p1` and `p2`.
fn bezier(u: f32, p1: f32, p2: f32) -> f32 {
    let v = 1.0 - u;
    3.0 * v * v * u * p1 + 3.0 * v * u * u * p2 + u * u * u
}

/// Its slope at `u`, for Newton's method.
fn bezier_slope(u: f32, p1: f32, p2: f32) -> f32 {
    let v = 1.0 - u;
    3.0 * v * v * p1 + 6.0 * v * u * (p2 - p1) + 3.0 * u * u * (1.0 - p2)
}

/// The curve parameter at which the x axis reaches `x` (0..1). Newton's method first; if a step
/// leaves the interval, halving it, so a solve always returns.
fn solve_x(x: f32) -> f32 {
    let mut u = x;
    for _ in 0..8 {
        let err = bezier(u, EASE_X1, EASE_X2) - x;
        if err.abs() < EASE_TOLERANCE {
            return u;
        }
        let slope = bezier_slope(u, EASE_X1, EASE_X2);
        if slope.abs() < EASE_TOLERANCE {
            break;
        }
        u = (u - err / slope).clamp(0.0, 1.0);
    }
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..24 {
        let err = bezier(u, EASE_X1, EASE_X2) - x;
        if err.abs() < EASE_TOLERANCE {
            break;
        }
        if err < 0.0 {
            low = u;
        } else {
            high = u;
        }
        u = 0.5 * (low + high);
    }
    u
}

/// Linear blend: `a` at `t = 0`, `b` at `t = 1`, and nothing outside them.
pub fn mix(a: f32, b: f32, t: f32) -> f32 {
    if t <= 0.0 {
        return a;
    }
    if t >= 1.0 {
        return b;
    }
    a + (b - a) * t
}

/// A blend of two colours: `a` at `t = 0`, `b` at `t = 1`, exact at both ends. The blend runs in
/// premultiplied space (egui's own [`egui::Color32::lerp_to_gamma`]), so a fade through a
/// transparent end stays even.
pub fn mix_color(a: egui::Color32, b: egui::Color32, t: f32) -> egui::Color32 {
    if t <= 0.0 {
        return a;
    }
    if t >= 1.0 {
        return b;
    }
    a.lerp_to_gamma(b, t)
}

/// One animated value: the leg it is on, and when the leg started.
#[derive(Clone, Copy, Debug)]
struct Anim {
    from: f32,
    to: f32,
    start: f64,
    dur: f32,
}

impl Anim {
    /// A leg that has already arrived. First sight of an id snaps to its target, as egui's own
    /// animations do, so a control appears settled and only glides when its state changes.
    fn settled(value: f32, start: f64, dur: f32) -> Self {
        Self { from: value, to: value, start, dur }
    }

    /// The value this leg shows at `now`, half a frame ahead so the frame a leg starts on already
    /// shows movement rather than the value it left.
    fn at(&self, now: f64, dt: f32) -> f32 {
        if self.to == self.from {
            return self.to;
        }
        let elapsed = (now - self.start) as f32 + 0.5 * dt;
        mix(self.from, self.to, ease_out((elapsed / self.dur).clamp(0.0, 1.0)))
    }

    /// Start a new leg toward `to`, from where the value is now, so a reversal mid-glide keeps
    /// its position instead of jumping.
    fn retarget(&mut self, to: f32, now: f64, dur: f32, dt: f32) {
        let from = self.at(now, dt);
        *self = Self { from, to, start: now, dur };
    }
}

/// `0..1` animated toward `target` over `dur`, keyed by `id`; snaps when animations are off.
///
/// The value lives in the context's memory, so a control calls this every frame and paints with
/// the blend it returns. While the value is still moving the frame asks for a repaint, or the
/// glide would freeze whenever the app goes idle.
pub fn value(ui: &egui::Ui, id: egui::Id, target: f32, dur: f32) -> f32 {
    let (now, dt) = ui.input(|i| (i.time, i.predicted_dt));
    if !(animations() && dur.is_finite() && dur > 0.0) {
        // No partial states: land on the target and forget the leg in flight.
        ui.ctx().data_mut(|d| d.insert_temp(id, Anim::settled(target, now, dur)));
        return target;
    }
    let out = ui.ctx().data_mut(|d| {
        let a = d.get_temp_mut_or_insert_with(id, || Anim::settled(target, now, dur));
        if a.to != target || a.dur != dur {
            a.retarget(target, now, dur, dt);
        }
        a.at(now, dt)
    });
    if out != target {
        ui.ctx().request_repaint();
    }
    out
}

/// The common case: 0 -> 1 while `target`, over [`DUR_FAST`].
pub fn hover(ui: &egui::Ui, id: egui::Id, target: bool) -> f32 {
    value(ui, id, if target { 1.0 } else { 0.0 }, DUR_FAST)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One frame with the clock at `time` seconds, as the crate's other tests run them. The
    /// font atlas deltas a fresh context emits are cleared, as the crate's other tests do.
    fn frame(ctx: &egui::Context, time: f64, run: impl FnMut(&mut egui::Ui)) -> egui::FullOutput {
        let mut output = ctx.run_ui(egui::RawInput { time: Some(time), ..Default::default() }, run);
        output.textures_delta.clear();
        output
    }

    /// The curve: endpoints exact, monotonic over 100 samples, never outside 0..1.
    #[test]
    fn ease_out_is_cursors_curve() {
        assert_eq!(ease_out(0.0), 0.0);
        assert_eq!(ease_out(1.0), 1.0);
        let mut previous = 0.0;
        for sample in 0..=100 {
            let value = ease_out(sample as f32 / 100.0);
            assert!((0.0..=1.0).contains(&value), "ease_out({sample}) left 0..1: {value}");
            assert!(value >= previous, "ease_out moved backwards at {sample}: {value} after {previous}");
            previous = value;
        }
    }

    /// A colour blend hits both ends exactly.
    #[test]
    fn mix_color_hits_both_ends() {
        let a = egui::Color32::from_rgba_unmultiplied(10, 20, 30, 40);
        let b = egui::Color32::from_rgba_unmultiplied(200, 150, 100, 255);
        assert_eq!(mix_color(a, b, 0.0), a);
        assert_eq!(mix_color(a, b, 1.0), b);
        // The halfway fade keeps the hue and only halves the alpha, premultiplied.
        let half = mix_color(egui::Color32::TRANSPARENT, b, 0.5);
        assert!(half.a() > 0 && half.a() < b.a(), "the fade is halfway: {}", half.a());
    }

    /// With animations off there are no partial states: the target, at once.
    #[test]
    fn animations_off_snaps_to_the_target() {
        let ctx = egui::Context::default();
        let id = egui::Id::unique("motion_test_gate");
        set_animations(false);
        let mut first = 0.0;
        frame(&ctx, 0.0, |ui| first = value(ui, id, 0.7, DUR_MED));
        assert_eq!(first, 0.7, "with animations off the first call is the target");
        let mut hovered = 0.0;
        frame(&ctx, 1.0 / 60.0, |ui| hovered = hover(ui, id, true));
        assert_eq!(hovered, 1.0, "a hover lands at once too");

        // The gate turning off mid-glide snaps the value the glide was holding.
        set_animations(true);
        let mut gliding = 0.0;
        frame(&ctx, 2.0 / 60.0, |ui| gliding = hover(ui, id, false));
        assert!(gliding > 0.0 && gliding < 1.0, "the glide is running: {gliding}");
        set_animations(false);
        let mut snapped = 0.0;
        frame(&ctx, 3.0 / 60.0, |ui| snapped = hover(ui, id, false));
        assert_eq!(snapped, 0.0, "with animations off the glide snaps to the target");
    }

    /// A hover glides: it moves on the first frame of the change, converges, never overshoots.
    #[test]
    fn hover_glides_toward_its_target() {
        let ctx = egui::Context::default();
        set_animations(true);
        let id = egui::Id::unique("motion_test_hover");
        let mut seen = Vec::new();
        for index in 0..16 {
            let target = index >= 2; // two frames at rest, then the pointer arrives
            let mut now = 0.0;
            let out = frame(&ctx, index as f64 / 60.0, |ui| now = hover(ui, id, target));
            seen.push(now);
            if index == 3 {
                assert!(out.viewport_output[&egui::ViewportId::ROOT].repaint_delay.is_zero(), "a glide asks for the next frame");
            }
        }
        assert_eq!(seen[0], 0.0);
        assert_eq!(seen[1], 0.0);
        assert!(seen[2] > 0.0 && seen[2] < 1.0, "the first frame of the hover shows a fraction, not the whole: {}", seen[2]);
        assert!(seen.windows(2).all(|pair| pair[1] >= pair[0] && pair[1] <= 1.0), "the value only moves toward 1: {seen:?}");
        assert!(seen.iter().any(|v| *v > 0.0 && *v < 1.0), "a partial state is shown while the fill fades");
        assert_eq!(seen[15], 1.0, "the glide settles exactly on 1");
    }

    /// Two ids do not share a value.
    #[test]
    fn ids_keep_their_own_values() {
        let ctx = egui::Context::default();
        set_animations(true);
        let left = egui::Id::unique("motion_test_left");
        let right = egui::Id::unique("motion_test_right");
        let mut latest = (0.0, 0.0);
        for index in 0..4 {
            let hovered = index >= 1;
            frame(&ctx, index as f64 / 60.0, |ui| {
                latest = (hover(ui, left, hovered), hover(ui, right, false));
            });
        }
        assert!(latest.0 > 0.0 && latest.0 < 1.0, "the left id is mid-glide: {}", latest.0);
        assert_eq!(latest.1, 0.0, "the right id never moved");
        assert_ne!(latest.0, latest.1);
    }
}
