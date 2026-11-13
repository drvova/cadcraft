//! The sheet and the solid are one piece: for a matrix of pieces, `PIECE` draws the sheet in a
//! session and `PIECEMESH` builds the solid from the parameters `PIECE` reported (through JSON
//! text, as the interface passes them), and the two must agree on everything they both show —
//! how many stones, where they sit, what the band weighs, how large the piece is.

use cadcraft_doc::{EntityKind, Handle};
use cadcraft_geom::{Bounds2, PI, TAU, Vec2, Vec3};
use serde_json::{Value, json};

use super::gem;
use super::mesh::{PartMesh, PieceMesh, Quality, piece_mesh, r3};
use super::mesh_tests::{extent, part, shells};
use super::piece_params::{PROFILES, PieceKind, PieceParams, Profile, table_ratio};
use crate::Session;

/// How far the tessellated band may fall short of the band's exact volume at draft quality: the
/// mesh is inscribed in the solid, so it is never over.
const BAND_TOLERANCE: f64 = 0.01;
/// How far under their nominal height the prongs' tips may be: their hemispherical caps lean in
/// over the stone, so the highest vertex is a little under the wire's reach.
const PRONG_TOLERANCE: f64 = 0.1;
/// How closely positions the sheet draws and the solid builds must agree (mm).
const EXACT: f64 = 1e-6;

/// One piece, as both commands made it.
struct Both {
    session: Session,
    /// `P` of the `PIECE` reply.
    sheet: Value,
    /// The parameters the solid was built from: the reply's `params`, read back from JSON text.
    params: PieceParams,
    /// The `PIECEMESH` reply for those parameters.
    reply: Value,
    mesh: PieceMesh,
}

/// Draw the sheet at `at` in a millimetre drawing, and build the solid from what it reported.
fn both(build: &Value) -> Both {
    let mut session = Session::new();
    session.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    let mut asked = build.clone();
    asked["at"] = json!([25.0, -10.0]);
    let sheet = session.execute("piece", &asked).unwrap_or_else(|e| panic!("PIECE {build}: {e}"))["piece"].clone();
    // The interface reads `piece {query: true}` and passes its `params` object straight on.
    let query = session.execute("piece", &json!({"query": true})).unwrap()["piece"].clone();
    assert_eq!(query, sheet, "{build}: the query is the piece that was built");
    let text = serde_json::to_string(&query["params"]).unwrap();
    let passed: Value = serde_json::from_str(&text).unwrap();
    let reply = session.execute("piecemesh", &passed).unwrap_or_else(|e| panic!("PIECEMESH {passed}: {e}"));
    let params = PieceParams::parse("piecemesh", &passed).unwrap();
    let mesh = piece_mesh(&params, Quality::Draft);
    Both { session, sheet, params, reply, mesh }
}

const AT: Vec2 = Vec2 { x: 25.0, y: -10.0 };

fn handles(p: &Value) -> Vec<Handle> {
    p["handles"].as_array().unwrap().iter().map(|h| Handle::parse_hex(h.as_str().unwrap()).unwrap()).collect()
}

/// One of the sheet's polylines, relative to the front view's centre.
struct Drawn {
    /// Its vertices.
    pts: Vec<Vec2>,
    /// Its true extents, arcs followed.
    bounds: Bounds2,
    closed: bool,
}

/// The sheet's polylines on a layer.
fn polylines(b: &Both, layer: &str) -> Vec<Drawn> {
    let d = b.session.doc().unwrap();
    handles(&b.sheet)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter(|e| e.common.layer == layer)
        .filter_map(|e| match &e.kind {
            EntityKind::LwPolyline(pl) => {
                let poly = cadcraft_geom::Polyline { vertices: pl.vertices.clone(), closed: pl.closed };
                let exact = poly.bounds();
                Some(Drawn {
                    pts: pl.vertices.iter().map(|v| v.p - AT).collect(),
                    bounds: Bounds2::from_points([exact.min - AT, exact.max - AT]),
                    closed: pl.closed,
                })
            }
            _ => None,
        })
        .collect()
}

/// The sheet's stones: each `GEM` insert's block and where it is.
fn inserts(b: &Both) -> Vec<(String, Vec2)> {
    let d = b.session.doc().unwrap();
    handles(&b.sheet)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter_map(|e| match &e.kind {
            EntityKind::Insert(i) if i.block.starts_with("GEM-") => Some((i.block.clone(), i.insert.xy() - AT)),
            _ => None,
        })
        .collect()
}

/// The sheet's prong circles in the plan: centre and radius.
fn prong_circles(b: &Both) -> Vec<(Vec2, f64)> {
    let d = b.session.doc().unwrap();
    handles(&b.sheet)
        .iter()
        .filter_map(|h| d.entity(*h))
        .filter(|e| e.common.layer == "Settings")
        .filter_map(|e| match &e.kind {
            EntityKind::Circle(c) => Some((c.center.xy() - AT, c.radius)),
            _ => None,
        })
        .collect()
}

fn bounds(pts: &[Vec2]) -> Bounds2 {
    Bounds2::from_points(pts.iter().copied())
}

/// The middle of a shell: the mean of its vertices (each once).
fn shell_centre(m: &PartMesh, shell: &[u32]) -> Vec3 {
    let mut seen: Vec<u32> = shell.to_vec();
    seen.sort_unstable();
    seen.dedup();
    let sum = seen.iter().fold(Vec3::ZERO, |acc, i| acc + m.positions[*i as usize]);
    sum * (1.0 / seen.len() as f64)
}

fn stone_shells(mesh: &PieceMesh, name: &str) -> usize {
    mesh.meshes.iter().find(|m| m.name == name).map_or(0, |m| shells(m).len())
}

/// Everything every kind must agree on: the parameters, the stone count, the band's weight and
/// the band's size.
fn agree(b: &Both, what: &str) {
    let (sheet, reply, mesh, p) = (&b.sheet, &b.reply, &b.mesh, &b.params);
    // The solid echoes the piece it was handed: the sheet's parameters, system and all.
    assert_eq!(reply["params"], sheet["params"], "{what}: the solid relabelled the piece");
    assert_eq!(reply["size"], sheet["size"], "{what}");
    assert_eq!(p.json(), sheet["params"], "{what}: the parameters do not read back as themselves");

    // One stone count: the sheet's, the solid's, and the shells that are actually there.
    let count = sheet["stones"]["count"].as_u64().unwrap();
    assert_eq!(reply["stones"].as_u64().unwrap(), count, "{what}: the sheet and the solid count different stones");
    assert_eq!(u64::from(mesh.stones), count, "{what}");
    let shown = stone_shells(mesh, "centre stone") + stone_shells(mesh, "side stones") + stone_shells(mesh, "melee");
    assert_eq!(shown as u64, count, "{what}: {shown} stone shells for {count} stones");
    assert_eq!(inserts(b).len() as u64, count, "{what}: the sheet's GEM inserts");
    if sheet["stones"].get("fits").is_some() {
        assert_eq!(reply["fits"], sheet["stones"]["fits"], "{what}: how many fit");
    } else {
        assert!(reply.get("fits").is_none(), "{what}");
    }

    // One metal weight: the band's, the same number in both replies.
    assert_eq!(reply["metal"]["grams"], sheet["metal"]["grams"], "{what}: two metal weights for one piece");
    assert_eq!(reply["metal"]["name"], sheet["metal"]["name"], "{what}");
    assert_eq!(reply["metal"]["density"], sheet["metal"]["density"], "{what}");
    let grams = sheet["metal"]["grams"].as_f64().unwrap();
    assert!((p.band_grams() - grams).abs() < 5.1e-4, "{what}");
    // And the band as tessellated weighs that, within the tessellation: inscribed, so never over.
    let band = part(mesh, "band");
    let meshed = band.volume() / 1000.0 * p.density;
    // (Against the weight before the reply rounds it to a milligram.)
    let exact = p.band_grams();
    assert!(meshed <= exact && (exact - meshed) / exact < BAND_TOLERANCE, "{what}: the band's mesh weighs {meshed} g, the piece {exact} g");
    assert_eq!(shells(band).len(), 1, "{what}");
    if p.kind == super::piece_params::PieceKind::Band {
        let all = reply["metal"]["shells"]["grams"].as_f64().unwrap();
        assert!((all - meshed).abs() < 1e-3, "{what}: a plain band's shells are the band");
    }

    // One size. The sheet: the finger and the outside as the front view's two circles, the
    // section `width` × `wall`, the plan `outer` × `width`. The solid: the band's extents.
    let d = b.session.doc().unwrap();
    let ring = handles(sheet).iter().filter_map(|h| d.entity(*h)).find_map(|e| match &e.kind {
        EntityKind::Insert(i) if i.block == "RING-PIECE" => Some(i.block.clone()),
        _ => None,
    });
    let mut radii: Vec<f64> = d
        .block(&ring.unwrap_or_else(|| panic!("{what}: no front view")))
        .unwrap()
        .entities
        .iter()
        .filter_map(|e| match &e.kind {
            EntityKind::Circle(c) => Some(c.radius),
            _ => None,
        })
        .collect();
    radii.sort_by(f64::total_cmp);
    let (inner, outer) = (radii[0], radii[1]);
    // The section stands to the right of the front view; the plan is the first thing under it
    // (an eternity band's layout is lower still).
    let metal: Vec<Bounds2> = polylines(b, "Metal").iter().map(|d| d.bounds).collect();
    let section = *metal.iter().find(|m| m.min.x >= outer).unwrap_or_else(|| panic!("{what}: no section"));
    let plan = *metal.iter().filter(|m| m.max.y <= -outer).max_by(|a, b| a.max.y.total_cmp(&b.max.y)).unwrap_or_else(|| panic!("{what}: no plan"));
    assert_eq!(metal.len(), if p.kind == super::piece_params::PieceKind::Eternity { 3 } else { 2 }, "{what}");
    let (width, wall) = (section.max.x - section.min.x, section.max.y - section.min.y);
    assert!((plan.max.x - plan.min.x - 2.0 * outer).abs() < EXACT && (plan.max.y - plan.min.y - width).abs() < EXACT, "{what}: the plan");
    assert!((outer - inner - wall).abs() < EXACT, "{what}: the section is {wall} high, the front view {} thick", outer - inner);
    for axis in [0, 1] {
        let (lo, hi) = extent(band, axis);
        assert!(
            (hi - outer).abs() < EXACT && (lo + outer).abs() < EXACT,
            "{what}: the band spans {lo}..{hi} on axis {axis}, the sheet's outside is {outer}"
        );
    }
    let (lo, hi) = extent(band, 2);
    assert!(
        (hi - width / 2.0).abs() < EXACT && (lo + width / 2.0).abs() < EXACT,
        "{what}: the band is {lo}..{hi} along the finger, the sheet {width} wide"
    );
    let nearest = band.positions.iter().map(|q| q.x.hypot(q.y)).fold(f64::INFINITY, f64::min);
    assert!((nearest - inner).abs() < EXACT, "{what}: the finger is {inner}, the band's inside {nearest}");
    // The section the sheet draws is the one the solid revolves: every band vertex is on or
    // inside the outline.
    let drawn = p.section();
    assert!((drawn.width - width).abs() < EXACT && (drawn.wall - wall).abs() < EXACT, "{what}");
    for q in &band.positions {
        let radius = q.x.hypot(q.y);
        assert!(radius <= inner + drawn.height_at(q.z) + EXACT, "{what}: a band vertex at z {} stands outside the sheet's section", q.z);
    }
    let (lo, hi) = (reply["bounds"]["min"].clone(), reply["bounds"]["max"].clone());
    if p.kind == super::piece_params::PieceKind::Band {
        assert_eq!(lo, json!([r3(-outer), r3(-outer), r3(-width / 2.0)]), "{what}");
        assert_eq!(hi, json!([r3(outer), r3(outer), r3(width / 2.0)]), "{what}");
    }
    if p.kind == super::piece_params::PieceKind::Eternity {
        // The stones' flat tables and the beads between them stand a little proud of the band.
        let low = lo[1].as_f64().unwrap();
        assert!(low <= r3(-outer) && low > -outer - 0.5, "{what}: the lowest point is {low}, the band's {}", -outer);
    } else {
        assert_eq!(lo[1], json!(r3(-outer)), "{what}: nothing hangs under the band");
    }
}

/// A solitaire: the head's height, the stone, its prongs and its halo.
fn agree_solitaire(b: &Both, what: &str) {
    let (mesh, p) = (&b.mesh, &b.params);
    let outer = p.outer() / 2.0;
    // Where the head stands: the band's outside in the middle of its width (the outside radius
    // itself, but in the hollow of a concave band).
    let top = p.crown();
    assert!(top <= outer + EXACT && (p.profile == Profile::Concave || (top - outer).abs() < EXACT), "{what}");
    // The sheet's front view: the one closed polyline on Stones is the stone's side profile.
    let stones = polylines(b, "Stones");
    assert_eq!(stones.len(), 1, "{what}");
    let side = stones[0].bounds;
    let stone = part(mesh, "centre stone");
    let (low, high) = extent(stone, 1);
    assert!((side.max.y - high).abs() < EXACT, "{what}: the sheet's table is {} over the centre, the solid's {high}", side.max.y);
    assert!((side.min.y - low).abs() < EXACT, "{what}: the sheet's culet is at {}, the solid's at {low}", side.min.y);
    assert!(low - top >= 0.5 - EXACT, "{what}: the culet is {} over the band", low - top);
    // The head's height over the band: the table, to the micron.
    let head = p.head();
    assert!((high - top - (head.clear + head.depth)).abs() < EXACT, "{what}");
    // The stone is as wide in the solid as on the sheet (a faceted outline is inscribed in it).
    let (x0, x1) = extent(stone, 0);
    assert!((side.max.x - side.min.x - p.stone_width).abs() < EXACT, "{what}");
    assert!(
        x1 - x0 <= p.stone_width + EXACT && x1 - x0 > p.stone_width - 0.05,
        "{what}: the stone is {} across, the sheet's {}",
        x1 - x0,
        p.stone_width
    );
    let (z0, z1) = extent(stone, 2);
    assert!(z1 - z0 <= p.stone_length + EXACT && z1 - z0 > p.stone_length - 0.05, "{what}: the stone is {} long", z1 - z0);

    // The prongs: as many, the same wire, standing on the same points of the girdle, as high.
    let circles = prong_circles(b);
    let prongs = part(mesh, "prongs");
    assert_eq!(circles.len(), p.prongs as usize, "{what}: the sheet's prongs");
    assert_eq!(shells(prongs).len(), circles.len(), "{what}: the sheet draws {} prongs", circles.len());
    let placed = inserts(b);
    // The centre stone is the first stone the sheet places, in the plan under the front view.
    let centre_at = placed.first().map(|(_, at)| *at).unwrap_or_else(|| panic!("{what}: the centre stone is not in the plan"));
    assert!(centre_at.x.abs() < 1e-9 && centre_at.y < -outer, "{what}: {centre_at:?}");
    let girdle_y = top + head.girdle_height();
    for (c, r) in &circles {
        assert!((r - head.prong / 2.0).abs() < 1e-9, "{what}: the prong wire");
        // The plan's y runs against the solid's z (the stone's length is along the finger).
        let site = *c - centre_at;
        let on_girdle = Vec3::new(site.x, girdle_y, -site.y);
        let nearest = prongs.positions.iter().map(|q| (*q - on_girdle).len()).fold(f64::INFINITY, f64::min);
        // The wire's section there is centred on the site, so its surface is one wire radius
        // away (where the wire bends, the inside of the bend comes a little nearer).
        assert!(
            nearest <= r + EXACT && nearest > 0.5 * r,
            "{what}: no prong stands on the sheet's site {site:?} (the nearest metal is {nearest} away, the wire's radius {r})"
        );
    }
    let lines: Vec<Bounds2> = polylines(b, "Settings").iter().filter(|d| !d.closed).map(|d| d.bounds).collect();
    assert_eq!(lines.len(), 2, "{what}: the two prongs the front view shows");
    let (_, tips) = extent(prongs, 1);
    for line in &lines {
        assert!((line.max.y - (top + head.prong_height())).abs() < EXACT, "{what}");
        assert!(
            tips <= line.max.y + EXACT && tips > line.max.y - PRONG_TOLERANCE,
            "{what}: the solid's prongs reach {tips}, the sheet's {}",
            line.max.y
        );
    }

    // The halo: the same number of melee at the same places.
    let melee: Vec<Vec2> = placed.iter().map(|(_, at)| *at - centre_at).filter(|at| at.len() > 1e-9).collect();
    assert_eq!(melee.len() + 1, placed.len(), "{what}: one centre stone");
    match p.halo {
        None => {
            assert!(melee.is_empty(), "{what}");
            assert!(mesh.meshes.iter().all(|m| m.name != "melee" && m.name != "halo seat"), "{what}");
        }
        Some(h) => {
            let small = part(mesh, "melee");
            let centres: Vec<Vec3> = shells(small).iter().map(|s| shell_centre(small, s)).collect();
            assert_eq!(centres.len(), melee.len(), "{what}: the sheet has {} halo stones", melee.len());
            for at in &melee {
                let found = centres.iter().any(|c| (c.x - at.x).abs() < 1e-6 && (c.z + at.y).abs() < 1e-6);
                assert!(found, "{what}: no halo stone in the solid at the sheet's {at:?}");
            }
            // Each is `h` across at its girdle, on the centre stone's girdle plane.
            let (y0, y1) = extent(small, 1);
            let depth = gem::default_depth(gem::cut_of("round").unwrap(), h);
            assert!((y1 - y0 - depth).abs() < EXACT, "{what}: the melee are {} deep", y1 - y0);
            assert!((y1 - (girdle_y + 0.28 * depth)).abs() < EXACT, "{what}");
            // And every pair keeps the gap, in the solid as on the sheet.
            for (i, a) in centres.iter().enumerate() {
                for c in centres.iter().skip(i + 1) {
                    assert!((*a - *c).len() >= h + p.gap - 1e-6, "{what}: two halo stones {} apart", (*a - *c).len());
                }
            }
            let (seat_low, _) = extent(part(mesh, "halo seat"), 1);
            assert!(seat_low >= top + 0.5 - EXACT, "{what}: the halo's seat fouls the band");
        }
    }
}

/// A three-stone ring: the three stones, each in its own head at the shared angle, as high, as
/// wide and with its prongs on the same points of its girdle in the sheet and in the solid.
fn agree_threestone(b: &Both, what: &str) {
    let (mesh, p, sheet) = (&b.mesh, &b.params, &b.sheet);
    let (outer, top) = (p.outer() / 2.0, p.crown());
    let sides = p.sides();
    assert!(sides.fits && sides.angle > 0.0 && sides.angle <= super::piece_params::MAX_SIDE_ANGLE, "{what}: {sides:?}");
    assert_eq!(sheet["stones"]["count"], json!(3), "{what}");
    assert!(sheet["stones"].get("fits").is_none(), "{what}");
    // The plan: the centre stone first, under the front view, and a side stone each side of it.
    let placed = inserts(b);
    assert_eq!(placed.len(), 3, "{what}");
    let centre_at = placed[0].1;
    assert!(centre_at.x.abs() < 1e-9 && centre_at.y < -outer, "{what}: {centre_at:?}");
    assert_eq!(placed[1].0, placed[2].0, "{what}: the two side stones are one stone");
    let stones = polylines(b, "Stones");
    assert_eq!(stones.len(), 3, "{what}: three side profiles in the front view");
    let circles = prong_circles(b);
    assert_eq!(circles.len() as u32, p.prongs + 2 * p.side_prongs, "{what}: the sheet's prongs");
    let prongs = part(mesh, "prongs");
    let wires = shells(prongs);
    assert_eq!(wires.len(), circles.len(), "{what}: the solid's prongs");
    assert_eq!(shells(part(mesh, "centre stone")).len(), 1, "{what}");
    let beside = part(mesh, "side stones");
    let side_shells = shells(beside);
    assert_eq!(side_shells.len(), 2, "{what}");
    assert!(mesh.meshes.iter().all(|m| m.name != "melee" && m.name != "halo seat"), "{what}: a three-stone ring has no halo");
    let lines: Vec<Vec<Vec2>> = polylines(b, "Settings").into_iter().filter(|d| !d.closed).map(|d| d.pts).collect();
    assert_eq!(lines.len(), 6, "{what}: the two prongs the front view shows of each head");
    let flat = |q: &Vec3| Vec2::new(q.x, q.y);
    let centre_positions: Vec<Vec3> = part(mesh, "centre stone").positions.clone();
    let (side_length, side_width) = p.side_size();
    assert!((sides.length - side_length).abs() < 1e-12 && (sides.width - side_width).abs() < 1e-12, "{what}");
    let seats = [
        (Vec2::new(0.0, 1.0), Vec2::new(1.0, 0.0), p.head(), p.stone_length, p.stone_width, p.prong_sites().unwrap(), false),
        (sides.out(1.0), sides.across(1.0), sides.head, side_length, side_width, p.side_prong_sites().unwrap(), true),
        (sides.out(-1.0), sides.across(-1.0), sides.head, side_length, side_width, p.side_prong_sites().unwrap(), true),
    ];
    for (out, across, head, length, width, sites, side) in &seats {
        // The sheet's profile that stands along this direction.
        let drawn = stones
            .iter()
            .find(|d| {
                let middle = d.pts.iter().fold(Vec2::ZERO, |acc, q| acc + *q) * (1.0 / d.pts.len() as f64);
                (middle.normalized() - *out).len() < 1e-6
            })
            .unwrap_or_else(|| panic!("{what}: no side profile stands along {out:?}"));
        let span = |pts: &mut dyn Iterator<Item = f64>| pts.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| (lo.min(v), hi.max(v)));
        let (low, mut high) = span(&mut drawn.pts.iter().map(|q| q.dot(*out)));
        assert!((low - (top + head.clear)).abs() < EXACT, "{what}: the sheet's culet is {low} out, the head's {}", top + head.clear);
        // (A cabochon's top is on its dome's arc, between two vertices: read it where the head is
        // upright, and take the head's word where it leans.)
        let cab = if *side { p.side_cut_data().is_some_and(|c| c.name == "cabochon") } else { p.cut == "cabochon" };
        if cab {
            high = if *side { top + head.clear + head.depth } else { drawn.bounds.max.y };
        }
        assert!((high - (top + head.clear + head.depth)).abs() < EXACT, "{what}: the sheet's table is {high} out");
        // The solid's stone that stands there: as high, as wide, as long.
        let solid: Vec<Vec3> = if *side {
            let shell = side_shells
                .iter()
                .find(|s| flat(&shell_centre(beside, s)).normalized().dot(*out) > 1.0 - 1e-9)
                .unwrap_or_else(|| panic!("{what}: no side stone stands along {out:?}"));
            shell.iter().map(|i| beside.positions[*i as usize]).collect()
        } else {
            centre_positions.clone()
        };
        let (solid_low, solid_high) = span(&mut solid.iter().map(|q| flat(q).dot(*out)));
        assert!(
            (solid_low - low).abs() < EXACT && (solid_high - high).abs() < EXACT,
            "{what}: the solid's stone spans {solid_low}..{solid_high}, the sheet's {low}..{high}"
        );
        let (x0, x1) = span(&mut solid.iter().map(|q| flat(q).dot(*across)));
        let (d0, d1) = span(&mut drawn.pts.iter().map(|q| q.dot(*across)));
        assert!((d1 - d0 - width).abs() < EXACT, "{what}: the sheet's stone is {} across", d1 - d0);
        assert!(x1 - x0 <= width + EXACT && x1 - x0 > width - 0.05, "{what}: the solid's stone is {} across, the sheet's {width}", x1 - x0);
        let (z0, z1) = span(&mut solid.iter().map(|q| q.z));
        assert!(z1 - z0 <= length + EXACT && z1 - z0 > length - 0.05, "{what}: the solid's stone is {} long, the sheet's {length}", z1 - z0);
        // Its place in the plan: its girdle's middle, seen from above.
        let girdle = top + head.girdle_height();
        let plan_at = centre_at + Vec2::new(out.x * girdle, 0.0);
        assert!(placed.iter().any(|(_, at)| (*at - plan_at).len() < 1e-9), "{what}: no stone in the plan at {plan_at:?}");
        // Its prongs: where the shared sites put them, in the plan and on the solid's girdle.
        let wire = head.prong / 2.0;
        let mut stood: Vec<Vec3> = Vec::new();
        for site in sites {
            assert!(
                circles.iter().any(|(c, r)| (*c - (plan_at + *site)).len() < 1e-9 && (r - wire).abs() < 1e-9),
                "{what}: no prong in the plan at {site:?} of the stone along {out:?}"
            );
            let on_girdle = Vec3::new(out.x, out.y, 0.0) * girdle + Vec3::new(across.x, across.y, 0.0) * site.x + Vec3::new(0.0, 0.0, -site.y);
            let nearest = prongs.positions.iter().map(|q| (*q - on_girdle).len()).fold(f64::INFINITY, f64::min);
            assert!(
                nearest <= wire + EXACT && nearest > 0.5 * wire,
                "{what}: no prong stands on {site:?} of the stone along {out:?} ({nearest} away)"
            );
            stood.push(on_girdle);
        }
        // The prongs' tips: the front view's two lines end at them, and the solid's reach them.
        let tip = top + head.prong_height();
        for sign in [-1.0, 1.0] {
            let end = *across * (sign * width / 2.0) + *out * tip;
            assert!(lines.iter().any(|pts| pts.last().is_some_and(|q| (*q - end).len() < EXACT)), "{what}: no prong line ends at {end:?}");
        }
        let reached = wires
            .iter()
            // A wire is this head's when it passes through one of this head's sites.
            .filter(|s| s.iter().any(|i| stood.iter().any(|at| (prongs.positions[*i as usize] - *at).len() <= wire + EXACT)))
            .flat_map(|s| s.iter().map(|i| flat(&prongs.positions[*i as usize]).dot(*out)))
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(reached <= tip + EXACT && reached > tip - PRONG_TOLERANCE, "{what}: the prongs along {out:?} reach {reached}, the sheet's {tip}");
        // The side stones keep clear of the centre stone by what the sheet's check reports.
        if *side && p.cut != "cabochon" && p.side_cut_data().is_some_and(|c| c.name != "cabochon") {
            let nearest = solid.iter().flat_map(|q| centre_positions.iter().map(move |c| (*q - *c).len())).fold(f64::INFINITY, f64::min);
            assert!(nearest >= sides.apart - 1e-6, "{what}: the stones are {nearest} apart in the solid, {} on the sheet", sides.apart);
        }
    }
    assert!(sides.between() + 1e-6 >= p.gap, "{what}: {} mm of metal between the settings, {} asked", sides.between(), p.gap);
    let spacing = sheet["checks"].as_array().unwrap().iter().find(|c| c["id"] == "spacing").unwrap();
    assert_eq!(spacing["ok"], true, "{what}: {spacing}");
    assert!(spacing["message"].as_str().unwrap().contains(&super::fmt_mm(sides.angle.to_degrees())), "{what}: {spacing}");
}

#[test]
fn a_three_stone_ring_is_one_three_stone_ring() {
    let stones = [
        json!({}),
        json!({"stoneWidth": 5, "gap": 0}),
        json!({"sideWidth": 3, "sideProngs": 6}),
        json!({"cut": "oval", "stoneLength": 8, "stoneWidth": 6, "prongs": 4}),
        json!({"cut": "emerald", "stoneLength": 7, "stoneWidth": 5, "prongs": 4, "sideCut": "trillion", "sideWidth": 3, "sideLength": 3, "sideProngs": 3}),
        json!({"sideCut": "pear", "sideLength": 4.5, "sideWidth": 3}),
        json!({"cut": "princess", "stoneWidth": 5, "prongs": 4, "sideCut": "baguette", "sideLength": 4, "sideWidth": 2}),
        json!({"cut": "cushion", "stoneWidth": 6, "prongs": 4, "sideCut": "round", "sideWidth": 3.5, "sideLength": 3.5, "sideProngs": 8}),
        json!({"stone": "sapphire", "sideWidth": 4.5, "gap": 0.4}),
        json!({"cut": "cabochon", "stoneLength": 8, "stoneWidth": 6, "stone": "opal", "sideWidth": 3.5}),
        json!({"cut": "marquise", "stoneLength": 10, "stoneWidth": 5, "prongs": 4, "sideCut": "cabochon", "sideLength": 4, "sideWidth": 3}),
        // A stored halo is not a three-stone ring's: it is kept and not drawn.
        json!({"halo": true}),
        // Side stones as large as the centre.
        json!({"stoneWidth": 4, "sideWidth": 4}),
    ];
    let bands = [
        json!({}),
        json!({"profile": "dome"}),
        json!({"size": 4, "wall": 2.5, "width": 3.0}),
        json!({"system": "eu", "size": 62, "wall": 2.0, "width": 3.0, "profile": "comfort"}),
        json!({"profile": "court", "width": 4.0}),
        json!({"profile": "knife", "width": 3.0, "metal": "platinum"}),
        json!({"profile": "bevel", "width": 5.0}),
        json!({"profile": "concave", "width": 4.0, "wall": 2.0, "hollow": 0.6}),
    ];
    let mut n = 0;
    for stone in &stones {
        for band in &bands {
            let build = with(&with(&json!({"kind": "threestone"}), stone), band);
            let b = both(&build);
            let what = build.to_string();
            agree(&b, &what);
            agree_threestone(&b, &what);
            n += 1;
        }
    }
    assert_eq!(n, stones.len() * bands.len());
}

/// The angle of a direction clockwise from 12 o'clock, in 0..2π.
fn clock(x: f64, y: f64) -> f64 {
    x.atan2(y).rem_euclid(TAU)
}

fn agree_eternity(b: &Both, what: &str) {
    let (mesh, p, sheet) = (&b.mesh, &b.params, &b.sheet);
    let outer = p.outer() / 2.0;
    let count = sheet["stones"]["count"].as_u64().unwrap() as usize;
    let row = p.eternity_row();
    // The tables' radius: the band's outside in the middle of its width.
    let top = row.top;
    assert!((top - p.crown()).abs() < 1e-12 && top <= outer + EXACT && (p.profile == Profile::Concave || (top - outer).abs() < EXACT), "{what}");
    assert_eq!(sheet["stones"]["fits"], json!(row.fits), "{what}");
    assert_eq!(count, row.count(p.count) as usize, "{what}");
    // The sheet's front view: one side profile to a stone, inside the outside circle's reach.
    // (The table is flat, so its corners stand a hair outside the circle.)
    let reach = outer.hypot(p.melee / 2.0) + EXACT;
    let profiles: Vec<Vec<Vec2>> = polylines(b, "Stones").into_iter().map(|d| d.pts).filter(|pts| pts.iter().all(|q| q.len() <= reach)).collect();
    assert_eq!(profiles.len(), count, "{what}: the front view's stones");
    let small = part(mesh, "melee");
    let solids = shells(small);
    assert_eq!(solids.len(), count, "{what}");
    // Where each sits: the angle of its middle, and how deep it reaches into the band.
    let middle = |pts: &[Vec2]| {
        let b = pts.iter().fold(Vec2::ZERO, |acc, q| acc + *q) * (1.0 / pts.len() as f64);
        clock(b.x, b.y)
    };
    let mut drawn: Vec<f64> = profiles.iter().map(|pts| middle(pts)).collect();
    let mut built: Vec<f64> = solids
        .iter()
        .map(|s| {
            let c = shell_centre(small, s);
            clock(c.x, c.y)
        })
        .collect();
    // A stone at 12 o'clock may read as 0 or as a hair under a full turn.
    for a in drawn.iter_mut().chain(built.iter_mut()) {
        if TAU - *a < 1e-6 {
            *a = 0.0;
        }
    }
    drawn.sort_by(f64::total_cmp);
    built.sort_by(f64::total_cmp);
    for (i, (a, c)) in drawn.iter().zip(&built).enumerate() {
        assert!((a - c).abs() < 1e-6, "{what}: stone {i} is at {a} rad on the sheet and {c} rad in the solid");
        let want = TAU * i as f64 / count as f64;
        assert!((a - want).abs() < 1e-6, "{what}: stone {i} at {a}, evenly spaced it is at {want}");
    }
    // The first stone is at 12 o'clock in both.
    assert!(drawn[0].abs() < 1e-6 && built[0].abs() < 1e-6, "{what}");
    // Tables level with the outside, culets a depth inside it: in both.
    let deepest = |pts: &[Vec2]| pts.iter().map(|q| q.len()).fold(f64::INFINITY, f64::min);
    // (A cabochon's base is flat: its corners are the profile's deepest vertices.)
    let cab = p.cut == "cabochon";
    let drawn_deepest = if cab { (top - row.depth).hypot(p.melee / 2.0) } else { top - row.depth };
    for pts in &profiles {
        assert!((deepest(pts) - drawn_deepest).abs() < EXACT, "{what}: a sheet stone reaches {}", deepest(pts));
    }
    let nearest = small.positions.iter().map(|q| q.x.hypot(q.y)).fold(f64::INFINITY, f64::min);
    assert!((nearest - (top - row.depth)).abs() < EXACT, "{what}: the solid's stones reach {nearest}, the sheet's {}", top - row.depth);
    let (_, table) = extent(small, 1);
    assert!((table - top).abs() < EXACT, "{what}: the table at 12 o'clock is at {table}, the band's outside at {top}");
    // The layout's pitch is the girdle circle's, the circle the solid's girdles lie on.
    let mut xs: Vec<f64> = inserts(b).iter().map(|(_, at)| at.x).collect();
    xs.sort_by(f64::total_cmp);
    assert_eq!(xs.len(), count, "{what}");
    for w in xs.windows(2) {
        assert!((w[1] - w[0] - TAU * row.radius / count as f64).abs() < 1e-6, "{what}: the layout's pitch");
    }
    if gem::cut_of(&p.cut).is_some_and(|c| c.is_circle(p.melee, p.melee) && c.name != "cabochon") {
        // A brilliant's girdle is a ring of vertices at `radius` from the axis of the stone.
        let far = small
            .positions
            .iter()
            .filter(|q| q.x.abs() < 1e-9 && q.y > 0.0)
            .map(|q| (q.y, q.z.abs()))
            .fold((0.0, 0.0), |a, c| if c.1 > a.1 { c } else { a });
        assert!(
            (far.1 - p.melee / 2.0).abs() < EXACT && (far.0 - row.radius).abs() < 0.02 * row.depth + EXACT,
            "{what}: the 12 o'clock girdle at {far:?}, not {}",
            row.radius
        );
    }
    // The metal the sheet's spacing check reports between neighbours is the gap between the
    // solid's neighbouring girdles: the chord between their near edges on the girdle circle.
    if count >= 2 && row.fits > 0 {
        let step = PI / count as f64;
        let edge = (p.melee / (2.0 * row.radius)).atan();
        let near = 2.0 * row.radius.hypot(p.melee / 2.0) * (step - edge).sin();
        assert!((row.between(count as u32) - near).abs() < 1e-12, "{what}");
        assert!(near + 1e-9 >= p.gap, "{what}: {near} mm between girdles, {} asked", p.gap);
        let spacing = b.sheet["checks"].as_array().unwrap().iter().find(|c| c["id"] == "spacing").unwrap();
        assert_eq!(spacing["ok"], true, "{what}: {spacing}");
    }
}

fn sizes() -> Vec<Value> {
    vec![
        json!({"system": "us", "size": 4}),
        json!({}),
        json!({"system": "us", "size": 9.25}),
        json!({"system": "eu", "size": 58}),
        json!({"system": "uk", "size": "T"}),
        json!({"system": "jp", "size": 9}),
    ]
}

fn with(base: &Value, more: &Value) -> Value {
    let mut out = base.clone();
    for (k, v) in more.as_object().unwrap() {
        out[k] = v.clone();
    }
    out
}

#[test]
fn a_band_is_one_band() {
    let mut n = 0;
    for size in sizes() {
        for profile in ["flat", "dome"] {
            // A low dome, a true half-round, a high dome, the thinnest and the thickest.
            for (wall, width) in [(1.8, 2.2), (1.0, 4.0), (1.5, 3.0), (2.5, 3.0), (0.3, 0.5), (10.0, 30.0), (0.3, 30.0)] {
                for metal in ["gold18", "platinum"] {
                    let build = with(&size, &json!({"kind": "band", "profile": profile, "wall": wall, "width": width, "metal": metal}));
                    let b = both(&build);
                    agree(&b, &build.to_string());
                    n += 1;
                }
            }
        }
    }
    assert_eq!(n, 6 * 2 * 7 * 2);
}

/// A band of each shape a profile takes: a usual one, a wide low one and a tall narrow one, with
/// the profile's own number left to its default, at its least and at the most the band allows.
fn shaped_bands(profile: Profile) -> Vec<Value> {
    let mut out = Vec::new();
    for (wall, width) in [(1.8, 3.0), (1.5, 6.0), (2.5, 3.0)] {
        let band = json!({"profile": profile.name(), "wall": wall, "width": width});
        out.push(band.clone());
        if let Some(key) = profile.key() {
            let (most, _) = profile.most(width, wall);
            for number in [0.05, most] {
                let mut shaped = band.clone();
                shaped[key] = json!(number);
                out.push(shaped);
            }
        }
    }
    out
}

#[test]
fn every_profile_is_one_band_in_every_kind() {
    let stones = [
        json!({"kind": "band"}),
        json!({"kind": "band", "system": "eu", "size": 58, "metal": "platinum"}),
        json!({"kind": "solitaire"}),
        json!({"kind": "solitaire", "halo": true, "size": 4}),
        json!({"kind": "solitaire", "cut": "oval", "stoneLength": 8, "stoneWidth": 6, "prongs": 4}),
        json!({"kind": "solitaire", "cut": "cabochon", "stoneLength": 8, "stoneWidth": 6, "stone": "opal", "halo": 1.0}),
        json!({"kind": "threestone"}),
        json!({"kind": "threestone", "cut": "oval", "stoneLength": 7, "stoneWidth": 5, "prongs": 4, "sideCut": "round", "sideWidth": 3, "sideLength": 3}),
        json!({"kind": "eternity", "melee": 1.3}),
        json!({"kind": "eternity", "melee": 2.0, "count": 12, "system": "uk", "size": "T"}),
        json!({"kind": "eternity", "cut": "princess", "melee": 1.5}),
        json!({"kind": "eternity", "cut": "cabochon", "melee": 2.0, "stone": "turquoise"}),
    ];
    let mut n = 0;
    for profile in PROFILES {
        for band in shaped_bands(profile) {
            for stone in &stones {
                let build = with(stone, &band);
                let b = both(&build);
                let what = build.to_string();
                agree(&b, &what);
                match b.params.kind {
                    PieceKind::Band => {}
                    PieceKind::Solitaire => agree_solitaire(&b, &what),
                    PieceKind::ThreeStone => agree_threestone(&b, &what),
                    PieceKind::Eternity => {
                        agree_eternity(&b, &what);
                        // One decision about a row on a band that falls away, in both.
                        let level = b.params.eternity_row().level();
                        let seat = b.sheet["checks"].as_array().unwrap().iter().find(|c| c["id"] == "stone-seat").unwrap();
                        let fell = seat["message"].as_str().unwrap().contains("no metal beside it");
                        let noted = b.reply["notes"].as_array().unwrap().iter().any(|note| note.as_str().unwrap().contains("the row has no seat"));
                        assert_eq!(noted, !level, "{what}: {}", b.reply["notes"]);
                        assert!(level || seat["ok"] == false, "{what}: {seat}");
                        assert!(!fell || !level, "{what}: {seat}");
                    }
                }
                assert_eq!(b.sheet["params"]["profile"], profile.name(), "{what}");
                n += 1;
            }
        }
    }
    println!("{n} pieces over every profile");
    // Two profiles with one shape each and five with three, on three bands, under twelve pieces.
    assert_eq!(n, (2 + 5 * 3) * 3 * stones.len());
}

#[test]
fn a_solitaire_is_one_solitaire() {
    let stones = [
        json!({}),
        json!({"stoneWidth": 4.0}),
        json!({"stoneWidth": 9.0, "prongs": 4}),
        json!({"cut": "oval", "stoneLength": 8, "stoneWidth": 6}),
        json!({"cut": "oval", "stoneLength": 6, "stoneWidth": 6, "prongs": 8}),
        json!({"cut": "princess", "stoneWidth": 5.5, "prongs": 4}),
        json!({"cut": "emerald", "stoneLength": 7, "stoneWidth": 5, "prongs": 4, "stone": "emerald"}),
        json!({"cut": "marquise", "stoneLength": 10, "stoneWidth": 5, "prongs": 4}),
        json!({"cut": "pear", "stoneLength": 8, "stoneWidth": 5, "prongs": 5, "stone": "sapphire"}),
        json!({"cut": "cushion", "stoneWidth": 6, "prongs": 4}),
        json!({"cut": "heart", "stoneWidth": 6, "prongs": 5}),
        json!({"cut": "trillion", "stoneWidth": 6, "prongs": 4}),
        json!({"cut": "trillion", "stoneWidth": 6, "prongs": 3}),
        json!({"cut": "radiant", "stoneLength": 7, "stoneWidth": 5, "prongs": 4}),
        json!({"cut": "baguette", "stoneLength": 6, "stoneWidth": 3, "prongs": 4}),
        json!({"cut": "cabochon", "stoneLength": 8, "stoneWidth": 6, "stone": "opal"}),
        json!({"cut": "cabochon", "stoneLength": 3, "stoneWidth": 3, "prongs": 3}),
    ];
    let halos =
        [json!({}), json!({"halo": true}), json!({"halo": 1.0, "gap": 0.1}), json!({"halo": 2.0, "gap": 0.35}), json!({"halo": 3.0, "gap": 0})];
    let bands = [
        json!({}),
        json!({"profile": "dome"}),
        json!({"system": "eu", "size": 58, "wall": 1.2, "width": 4.0, "profile": "dome"}),
        json!({"size": 4, "wall": 2.5, "width": 3.0}),
    ];
    let mut n = 0;
    let mut haloed = 0;
    for (i, stone) in stones.iter().enumerate() {
        for (j, halo) in halos.iter().enumerate() {
            // Every stone on the first band; the other bands take the stones in turn.
            for (k, band) in bands.iter().enumerate() {
                if k != 0 && (i + j + k) % 4 != 0 {
                    continue;
                }
                let build = with(&with(&with(&json!({"kind": "solitaire"}), stone), halo), band);
                let b = both(&build);
                let what = build.to_string();
                agree(&b, &what);
                agree_solitaire(&b, &what);
                n += 1;
                if b.params.halo.is_some() {
                    haloed += 1;
                    assert!(b.sheet["stones"]["count"].as_u64().unwrap() >= 4, "{what}");
                }
            }
        }
    }
    println!("{n} solitaires, {haloed} with a halo");
    assert!(n >= stones.len() * halos.len() && haloed > 60);
}

#[test]
fn an_eternity_band_is_one_eternity_band() {
    let rows = [
        json!({}),
        json!({"melee": 1.3, "gap": 0.15}),
        json!({"melee": 2.5, "width": 3.2, "wall": 2.0}),
        json!({"melee": 0.8, "gap": 0, "width": 1.5}),
        json!({"melee": 3.0, "gap": 0.35, "width": 4.0, "wall": 2.4}),
        json!({"cut": "princess", "melee": 2, "width": 3, "wall": 2}),
        json!({"cut": "oval", "melee": 1.5, "stone": "ruby"}),
        json!({"cut": "cabochon", "melee": 2.0, "width": 3.0, "stone": "turquoise"}),
        json!({"cut": "emerald", "melee": 2.0, "width": 3.0, "wall": 2.0}),
        json!({"cut": "trillion", "melee": 2.0, "width": 3.0}),
        json!({"cut": "heart", "melee": 2.2, "width": 3.0}),
    ];
    let mut n = 0;
    for size in sizes() {
        for profile in ["flat", "dome"] {
            for row in &rows {
                let auto = with(&with(&size, &json!({"kind": "eternity", "profile": profile})), row);
                let b = both(&auto);
                let what = auto.to_string();
                agree(&b, &what);
                agree_eternity(&b, &what);
                assert_eq!(b.sheet["params"]["count"], Value::Null, "{what}");
                let fits = b.sheet["stones"]["fits"].as_u64().unwrap();
                assert_eq!(b.sheet["stones"]["count"], json!(fits), "{what}: an automatic count is the most that fit");
                assert!(!b.reply["notes"].as_array().unwrap().iter().any(|note| note.as_str().unwrap().contains("overlap")), "{what}");
                n += 1;
                // Explicit counts: one stone, a few, and exactly as many as fit.
                for count in [1, 2, 7, fits / 2, fits] {
                    let build = with(&auto, &json!({"count": count}));
                    let b = both(&build);
                    let what = build.to_string();
                    agree(&b, &what);
                    agree_eternity(&b, &what);
                    assert_eq!(b.sheet["stones"]["count"], json!(count), "{what}");
                    assert_eq!(b.reply["stones"], json!(count), "{what}");
                    n += 1;
                }
                // One more than fits: the sheet refuses it and names the number; the solid, a
                // viewer, builds it and says the same number in its notes.
                let over = with(&auto, &json!({"count": fits + 1}));
                let mut s = Session::new();
                let refused = s.execute("piece", &over).unwrap_err().to_string();
                assert!(refused.contains(&format!("{fits} fit")), "{over}: {refused}");
                let shown = s.execute("piecemesh", &over).unwrap();
                assert_eq!(shown["stones"], json!(fits + 1), "{over}");
                assert_eq!(shown["fits"], json!(fits), "{over}");
                let notes = shown["notes"].as_array().unwrap();
                assert!(
                    notes.iter().any(|note| note.as_str().is_some_and(|t| t.contains(&format!("at most {fits} do")) && t.contains("PIECE refuses"))),
                    "{over}: {notes:?}"
                );
            }
        }
    }
    assert_eq!(n, 6 * 2 * rows.len() * 6);
}

#[test]
fn the_parameters_read_back_as_the_same_piece() {
    let mut pieces = vec![
        json!({"kind": "band"}),
        json!({"kind": "band", "size": 6}),
        json!({"kind": "band", "size": 0}),
        json!({"kind": "band", "size": 16}),
        json!({"kind": "band", "size": 6.1}),
        json!({"kind": "band", "size": 7.123456789123}),
        json!({"kind": "solitaire", "system": "eu", "size": 54, "halo": true, "cut": "pear", "stoneLength": 8, "stoneWidth": 5}),
        json!({"kind": "eternity", "system": "uk", "size": "M", "count": 20, "profile": "dome"}),
        json!({"kind": "eternity", "system": "jp", "size": 12, "melee": 1.3}),
        json!({"kind": "band", "system": "cn", "size": 14, "metal": "platinum"}),
    ];
    for quarter in 0..=64 {
        pieces.push(json!({"kind": "band", "size": f64::from(quarter) / 4.0}));
    }
    for build in &pieces {
        let p = PieceParams::parse("test", build).unwrap_or_else(|e| panic!("{build}: {e}"));
        let stored = p.json();
        // Through text, as a drawing stores it and the interface passes it.
        let read: Value = serde_json::from_str(&serde_json::to_string(&stored).unwrap()).unwrap();
        let q = PieceParams::parse("test", &read).unwrap();
        assert_eq!(q, p, "{build}: not the same piece after a round trip");
        assert_eq!(q.json(), stored, "{build}");
        // The size is free of float noise, and it is the US number whatever system it came in.
        let us = stored["size"].as_f64().unwrap();
        assert_eq!(us, (us * 1e9).round() / 1e9, "{build}: {us}");
        assert_eq!(stored["system"], "us", "{build}");
        // The system the piece was given in is kept, not relabelled as US.
        let given = build.get("system").and_then(Value::as_str).unwrap_or("us");
        assert_eq!(stored["sizeSystem"], given, "{build}");
        assert_eq!(q.system, given, "{build}");
        assert_eq!(q.size.eu, p.size.eu);
    }
    assert_eq!(PieceParams::parse("test", &json!({"kind": "band"})).unwrap().json()["size"], json!(6.0), "US 6 reads 6, not 5.999999999999997");
    // PIECEMESH echoes the piece it was handed without relabelling it.
    let mut s = Session::new();
    let r = s.execute("piecemesh", &json!({"kind": "band", "system": "eu", "size": 54})).unwrap();
    assert_eq!(r["params"]["sizeSystem"], "eu");
    assert_eq!(r["params"]["system"], "us");
    assert_eq!(r["size"]["eu"], json!(54));
    let again = s.execute("piecemesh", &r["params"]).unwrap();
    assert_eq!(again["params"], r["params"]);
    assert_eq!(again["size"], r["size"]);
    assert_eq!(again["meshes"], r["meshes"]);
    // `sizeSystem` only labels: a `system` beside it still says what `size` is in.
    let p = PieceParams::parse("test", &json!({"kind": "band", "system": "eu", "size": 54, "sizeSystem": "jp"})).unwrap();
    assert_eq!((p.size.eu, p.system.as_str()), (54, "jp"));
    let p = PieceParams::parse("test", &json!({"kind": "band", "system": "eu", "size": 54, "sizeSystem": "martian"})).unwrap();
    assert_eq!(p.system, "us", "a system that is not one reads as US, as it always has");
}

#[test]
fn a_stone_is_drawn_and_built_to_the_proportions_gem_draws() {
    // The table: the fraction of the width GEM draws on the stone's plan, in the sheet's side
    // profile and on the solid's crown alike.
    let mut s = Session::new();
    s.execute("setvar", &json!({"name": "INSUNITS", "value": 4})).unwrap();
    for cut in gem::CUTS {
        let (length, width) = (8.0 * cut_ratio(cut.name), 8.0);
        s.execute("gem", &json!({"at": [0, 0], "cut": cut.name, "length": length, "width": width})).unwrap();
        let d = s.doc().unwrap();
        let block = d
            .model
            .iter()
            .filter_map(|e| match &e.kind {
                EntityKind::Insert(i) if i.block.starts_with("GEM-") => Some(i.block.clone()),
                _ => None,
            })
            .last()
            .unwrap();
        let across: Vec<f64> = d
            .block(&block)
            .unwrap()
            .entities
            .iter()
            .filter_map(|e| super::entity_loop(e, 1.0))
            .map(|(pts, _)| {
                let b = bounds(&pts);
                b.max.x - b.min.x
            })
            .collect();
        assert_eq!(across.len(), 2, "{}: a girdle and a table", cut.name);
        let drawn = across[1] / across[0];
        assert!((drawn - table_ratio(cut)).abs() < 5e-3, "{}: GEM draws a table of {drawn}, the piece {}", cut.name, table_ratio(cut));
        if cut.name == "cabochon" {
            continue;
        }
        // The solid's crown: the vertices at the table's height span that fraction of the width.
        let p = PieceParams::parse("test", &json!({"kind": "solitaire", "cut": cut.name, "stoneLength": length, "stoneWidth": width})).unwrap();
        let mesh = piece_mesh(&p, Quality::Fine);
        let stone = part(&mesh, "centre stone");
        let (_, top) = extent(stone, 1);
        let table: Vec<f64> = stone.positions.iter().filter(|q| (q.y - top).abs() < 1e-9).map(|q| q.x).collect();
        let span = table.iter().copied().fold(f64::NEG_INFINITY, f64::max) - table.iter().copied().fold(f64::INFINITY, f64::min);
        assert!((span / width - table_ratio(cut)).abs() < 0.02, "{}: the solid's table is {} of the width", cut.name, span / width);
        // The sheet's side profile: its top edge is the table.
        let b = both(&json!({"kind": "solitaire", "cut": cut.name, "stoneLength": length, "stoneWidth": width}));
        let side = polylines(&b, "Stones").remove(0).pts;
        let high = bounds(&side).max.y;
        let edge: Vec<f64> = side.iter().filter(|q| (q.y - high).abs() < 1e-9).map(|q| q.x).collect();
        let span = edge.iter().copied().fold(f64::NEG_INFINITY, f64::max) - edge.iter().copied().fold(f64::INFINITY, f64::min);
        assert!((span / width - table_ratio(cut)).abs() < 1e-9, "{}: the sheet's table is {} of the width", cut.name, span / width);
        // And the depth is the cut's, split 26 / 4 / 70 in both.
        let depth = gem::default_depth(cut, width);
        let (low, _) = extent(stone, 1);
        assert!((top - low - depth).abs() < 1e-9 && (bounds(&side).max.y - bounds(&side).min.y - depth).abs() < 1e-9, "{}", cut.name);
        let girdle: Vec<f64> = side.iter().map(|q| q.y - bounds(&side).min.y).filter(|y| *y > 1e-9 && *y < depth - 1e-9).collect();
        let (g0, g1) = (girdle.iter().copied().fold(f64::INFINITY, f64::min), girdle.iter().copied().fold(0.0, f64::max));
        assert!((g0 - 0.70 * depth).abs() < 1e-9 && (g1 - 0.74 * depth).abs() < 1e-9, "{}: the sheet's girdle {g0}..{g1} of {depth}", cut.name);
        let widest = stone.positions.iter().map(|q| q.x.abs()).fold(0.0, f64::max);
        let at_girdle: Vec<f64> = stone.positions.iter().filter(|q| q.x.abs() > widest - 1e-9).map(|q| q.y - low).collect();
        let (m0, m1) = (at_girdle.iter().copied().fold(f64::INFINITY, f64::min), at_girdle.iter().copied().fold(0.0, f64::max));
        assert!((m0 - 0.70 * depth).abs() < 1e-9 && (m1 - 0.74 * depth).abs() < 1e-9, "{}: the solid's girdle {m0}..{m1} of {depth}", cut.name);
    }
}

/// The length a cut is usually bought in, to its width.
fn cut_ratio(name: &str) -> f64 {
    match name {
        "marquise" | "baguette" | "rect" => 2.0,
        "pear" => 1.5,
        "emerald" | "radiant" => 1.4,
        "oval" | "cabochon" => 4.0 / 3.0,
        _ => 1.0,
    }
}

#[test]
fn hostile_numbers_never_panic_in_the_shared_decisions() {
    // Parameters that never went through the parser: every shared decision still answers with a
    // number or with nothing, and the solid built from them is finite.
    let mut wild = PieceParams::parse("test", &json!({"kind": "solitaire", "halo": true})).unwrap();
    let nasty = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0, 0.0, 1e-300, 1e300];
    for a in nasty {
        for b in nasty {
            wild.wall = a;
            wild.width = b;
            wild.stone_width = a;
            wild.stone_length = b;
            wild.melee = a;
            wild.gap = b;
            wild.halo = Some(a);
            wild.prongs = u32::MAX;
            wild.count = Some(u32::MAX);
            let section = wild.section();
            let _ = (section.area(), section.centroid(), section.height_at(a), section.height_at(b), section.outline(), section.outside(usize::MAX));
            let _ = (wild.band_volume(), wild.band_grams(), wild.head(), wild.prong_sites(), wild.halo_sites());
            let row = wild.eternity_row();
            assert!(row.fits <= 400 && (1..=400).contains(&row.count(wild.count)) && (1..=400).contains(&row.count(None)));
            let _ = (row.between(0), row.between(u32::MAX));
            for cut in gem::CUTS {
                let _ = super::piece_params::halo_sites(cut, a, b, b, a);
                let _ = super::piece_params::prong_sites(cut, a, b, 0);
                let _ = super::piece_params::girdle_outline(cut, a, b);
            }
            for kind in [super::piece_params::PieceKind::Band, super::piece_params::PieceKind::Solitaire, super::piece_params::PieceKind::Eternity] {
                wild.kind = kind;
                let mesh = piece_mesh(&wild, Quality::Draft);
                assert!(mesh.meshes.iter().all(|m| m.positions.iter().all(|q| q.is_finite())), "{kind:?} {a} {b}");
                assert!(mesh.stones <= 401);
            }
        }
    }
    // A halo that cannot fit and an unknown cut answer with nothing rather than a guess.
    wild.cut = "no such cut".to_string();
    assert!(wild.cut_data().is_some_and(|c| c.name == "round"));
}
