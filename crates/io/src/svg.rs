//! SVG export of a space (vector, for the web and documents).

use std::fmt::Write as _;

use cadcraft_color::Rgb;
use cadcraft_doc::{Drawing, Space};
use cadcraft_geom::Bounds2;
use cadcraft_render::Kind;

/// Export with a white background (colour 7 prints black), fitted to the extents.
pub fn export(d: &Drawing, space: &Space) -> String {
    export_window(d, space, None)
}

/// Export showing exactly `window` (the `viewBox`; geometry outside it is clipped by the viewer),
/// or the extents with a 2% margin when `window` is `None`. Objects are drawn with their
/// transparency, as on screen.
pub fn export_window(d: &Drawing, space: &Space, window: Option<Bounds2>) -> String {
    export_window_with(d, space, window, true)
}

/// [`export_window`], drawing transparency only when `transparency` is on (plots).
pub fn export_window_with(d: &Drawing, space: &Space, window: Option<Bounds2>, transparency: bool) -> String {
    let list = cadcraft_render::build(d, space, &cadcraft_render::Options { transparency, ..cadcraft_render::Options::default() });
    export_list(&list, window)
}

/// ` opacity="…"` for a transparent primitive (none for an opaque one or a wipeout's mask).
fn opacity(p: &cadcraft_render::DPrim) -> String {
    if p.kind == Kind::Mask || p.transparency == 0 {
        return String::new();
    }
    format!(r#" opacity="{:.2}""#, f64::from(p.alpha()) / 255.0)
}

/// Write a display list (as [`export_window`] does for a space's own).
pub fn export_list(list: &cadcraft_render::DisplayList, window: Option<Bounds2>) -> String {
    let window = window.filter(|w| !w.is_empty());
    let b = window.unwrap_or(list.bounds);
    // A single point (or a zero-size window) has no extent: show a unit box centred on it.
    let point = !b.is_empty() && b.width().max(b.height()) <= 1e-9;
    let (w, h) = if b.is_empty() {
        (1.0, 1.0)
    } else if point {
        (0.0, 0.0)
    } else {
        (b.width().max(1e-9), b.height().max(1e-9))
    };
    let m = if point {
        0.5
    } else if window.is_some() {
        0.0
    } else {
        (w.max(h)) * 0.02
    };
    let (x0, y1) = if b.is_empty() { (0.0, 1.0) } else { (b.min.x - m, b.max.y + m) };
    let vw = w + 2.0 * m;
    let vh = h + 2.0 * m;
    let stroke = vw.max(vh) / 1500.0;
    // Decimals: at least 6, more when the stroke would otherwise lose its leading digits.
    let dp = (3.0 - stroke.log10().floor()).clamp(6.0, 15.0) as usize;
    let mut s = String::new();
    let _ = write!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw:.dp$} {vh:.dp$}" width="{:.0}" height="{:.0}"><rect width="100%" height="100%" fill="white"/>"#,
        1600.0,
        1600.0 * vh / vw
    );
    let white = Rgb(255, 255, 255);
    let tx = |x: f64| x - x0;
    let ty = |y: f64| y1 - y;
    // Raster images draw first (they sit under the linework, as on screen) and each clipped one
    // needs a clip path, so the definitions go in a `<defs>` ahead of them.
    let clips = image_clips(list, x0, y1);
    if !clips.is_empty() {
        s.push_str("<defs>");
        s.push_str(&clips);
        s.push_str("</defs>");
    }
    let mut image_n = 0usize;
    for p in &list.prims {
        if p.kind != Kind::Image {
            continue;
        }
        let Some(ip) = list.image(p.start) else { continue };
        image_n += 1;
        let Some(el) = image_element(ip, list, x0, y1, p.alpha(), image_n) else { continue };
        s.push_str(&el);
    }
    for p in &list.prims {
        let c = p.display_rgb(white).hex();
        let op = opacity(p);
        let pts = list.points(p);
        match p.kind {
            // Drawn above, before the linework.
            Kind::Image => {}
            Kind::Polyline => {
                let _ = write!(
                    s,
                    r#"<polyline fill="none" stroke="{c}"{op} stroke-width="{stroke:.dp$}" stroke-linecap="round" stroke-linejoin="round" points=""#
                );
                for q in pts {
                    let _ = write!(s, "{:.dp$},{:.dp$} ", tx(q.x), ty(q.y));
                }
                s.push_str(r#""/>"#);
            }
            Kind::Tris | Kind::Mask => {
                // A wipeout's mask hides what lies under it with the white background.
                let c = if p.kind == Kind::Mask { white.hex() } else { c };
                let _ = write!(s, r#"<path fill="{c}"{op} d=""#);
                for t in pts.chunks(3) {
                    if let [a, b2, cc] = t {
                        let _ =
                            write!(s, "M{:.dp$} {:.dp$}L{:.dp$} {:.dp$}L{:.dp$} {:.dp$}Z", tx(a.x), ty(a.y), tx(b2.x), ty(b2.y), tx(cc.x), ty(cc.y));
                    }
                }
                s.push_str(r#""/>"#);
            }
            Kind::Point => {
                if let Some(q) = pts.first() {
                    let _ = write!(s, r#"<circle cx="{:.dp$}" cy="{:.dp$}" r="{:.dp$}" fill="{c}"{op}/>"#, tx(q.x), ty(q.y), stroke);
                }
            }
            Kind::Infinite { ray } => {
                if let (Some(bp), Some(dir)) = (pts.first(), pts.get(1)) {
                    // A window can lie far from the base point: reach past it.
                    let far = (vw + vh) * 2.0 + if window.is_some() { bp.dist(b.center()) } else { 0.0 };
                    let a = if ray { *bp } else { *bp - *dir * far };
                    let e = *bp + *dir * far;
                    let _ = write!(
                        s,
                        r#"<line x1="{:.dp$}" y1="{:.dp$}" x2="{:.dp$}" y2="{:.dp$}" stroke="{c}"{op} stroke-width="{stroke:.dp$}"/>"#,
                        tx(a.x),
                        ty(a.y),
                        tx(e.x),
                        ty(e.y)
                    );
                }
            }
        }
    }
    s.push_str("</svg>");
    s
}

/// Base64 (standard alphabet, padded): a PNG data URI cannot hold raw bytes.
fn base64(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= c.len() {
                let v = (n >> (18 - 6 * i)) & 0x3F;
                out.push(char::from(ALPHABET[v as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// `<clipPath>` definitions for the images in `list` whose visible region is not their whole
/// quad, or an empty string. The ids (`clip-1`, `clip-2`…) count the images that draw pixels,
/// matching [`image_element`]'s own numbering.
fn image_clips(list: &cadcraft_render::DisplayList, x0: f64, y1: f64) -> String {
    let mut s = String::new();
    let mut n = 0usize;
    for p in &list.prims {
        if p.kind != Kind::Image {
            continue;
        }
        let Some(ip) = list.image(p.start) else { continue };
        if ip.pixels.is_none() {
            continue;
        }
        n += 1;
        if ip.region_is_quad(list) {
            continue;
        }
        let _ = write!(s, r#"<clipPath id="clip-{n}" clipPathUnits="userSpaceOnUse"><path d=""#);
        for t in ip.triangles() {
            let _ = write!(s, "M{:.6} {:.6}L{:.6} {:.6}L{:.6} {:.6}Z", t[0].x - x0, y1 - t[0].y, t[1].x - x0, y1 - t[1].y, t[2].x - x0, y1 - t[2].y);
        }
        s.push_str(r#""/></clipPath>"#);
    }
    s
}

/// The `<image>` element of one image primitive: its pixels as a base64 PNG, placed by the
/// affine map from image pixels to user space and clipped to the primitive's region when that
/// is not the whole quad. `None` when the pixels could not be encoded (the frame still draws).
fn image_element(ip: &cadcraft_render::ImagePrim, list: &cadcraft_render::DisplayList, x0: f64, y1: f64, alpha: u8, n: usize) -> Option<String> {
    let data = ip.pixels.as_ref()?;
    let [lower_left, lower_right, _, upper_left] = ip.corners(list)?;
    if ip.size.x <= 0.0 || ip.size.y <= 0.0 {
        return None;
    }
    // Image pixels (x right, y down) → user space: the image's row 0 is its top, at the quad's
    // upper-left corner.
    let ex = (lower_right - lower_left) / ip.size.x;
    let ey = (upper_left - lower_left) / ip.size.y;
    let m = [ex.x, -ex.y, -ey.x, ey.y, upper_left.x - x0, y1 - upper_left.y];
    let mut png = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(&mut png);
    use image::ImageEncoder as _;
    enc.write_image(&data.rgba, data.width, data.height, image::ExtendedColorType::Rgba8).ok()?;
    let clip = if ip.region_is_quad(list) { String::new() } else { format!(r#" clip-path="url(#clip-{n})""#) };
    let op = if ip.opacity == 255 { String::new() } else { format!(r#" opacity="{:.3}""#, f64::from(ip.opacity) / 255.0 * f64::from(alpha) / 255.0) };
    Some(format!(
        r#"<image x="0" y="0" width="{:.6}" height="{:.6}" preserveAspectRatio="none" transform="matrix({:.6} {:.6} {:.6} {:.6} {:.6} {:.6})"{clip}{op} href="data:image/png;base64,{}"/>"#,
        ip.size.x,
        ip.size.y,
        m[0],
        m[1],
        m[2],
        m[3],
        m[4],
        m[5],
        base64(&png)
    ))
}
