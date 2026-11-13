//! The merged solid for the caster.

use std::time::Instant;

use serde_json::{Value, json};

use super::mesh::*;
use super::piece_params::PieceParams;
use super::solid::*;

fn params(v: Value) -> PieceParams {
    PieceParams::parse("test", &v).unwrap()
}

#[test]
#[ignore]
fn probe() {
    for (what, v) in [
        ("band", json!({"kind": "band"})),
        ("solitaire", json!({"kind": "solitaire"})),
        ("halo", json!({"kind": "solitaire", "halo": true})),
        ("threestone", json!({"kind": "threestone"})),
        ("eternity", json!({"kind": "eternity"})),
    ] {
        let p = params(v);
        let m = piece_mesh(&p, Quality::Draft);
        for step in [0.2, 0.1] {
            let t = Instant::now();
            let r = solidify(&m.csg, step, 2_000_000);
            let ms = t.elapsed().as_millis();
            match r {
                Ok((s, c)) => eprintln!(
                    "{what} step {step}: {} tris vol {:.2} band {:.2} seats {} {ms} ms coarsened {c} step {}",
                    s.triangles(),
                    s.volume(),
                    p.band_volume(),
                    m.seats,
                    s.step
                ),
                Err(e) => eprintln!("{what} step {step}: ERR {e} {ms} ms"),
            }
        }
    }
}
