//! The piece card: one picture of the open drawing's piece, for an agent that otherwise sees
//! only JSON. Laid out by `slab/piece-card.slab`.

use cadcraft_engine::Session;

use crate::data::PieceData;
use crate::document::Document;
use crate::error::{Result, SurfaceError, guard};
use crate::generated::piece_card as doc;
use crate::render::{self, Picture, Theme};

/// How the card is drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CardOptions {
    /// Its width in layout units (clamped to 320–1200). The height is the card's own.
    pub width: u32,
    /// Pixels per unit for a PNG (clamped to 0.5–4).
    pub scale: f64,
    /// The palette.
    pub theme: Theme,
}

impl Default for CardOptions {
    /// 640 units wide at two pixels a unit — sharp where a chat client shows it at full width —
    /// in the dark palette.
    fn default() -> Self {
        CardOptions { width: 640, scale: 2.0, theme: Theme::Dark }
    }
}

impl CardOptions {
    fn width(&self) -> u32 {
        self.width.clamp(320, 1200)
    }
}

/// The card as a picture, with the data it shows.
#[derive(Debug, Clone, PartialEq)]
pub struct Card {
    /// The card.
    pub picture: Picture,
    /// What it shows.
    pub data: PieceData,
}

/// A filled card document, ready to draw.
fn filled(data: &PieceData) -> Result<doc::Doc> {
    // Decoding the document here proves the generated `Doc::new` cannot fail on the same bytes.
    Document::PieceCard.slir()?;
    guard("the piece card", || {
        let mut d = doc::Doc::new();
        let set = |ok: bool, param: &'static str| -> Result<()> {
            if ok { Ok(()) } else { Err(SurfaceError::Refused { document: "piece-card.slab", param }) }
        };
        set(d.set_drawing(&data.drawing.to_uppercase()), "drawing")?;
        set(d.set_title(&data.title), "title")?;
        set(d.set_subtitle(&data.subtitle), "subtitle")?;
        set(d.set_size_a(&data.size_a), "size_a")?;
        set(d.set_size_b(&data.size_b), "size_b")?;
        set(d.set_metal(&data.metal), "metal")?;
        set(d.set_metal_note(&data.metal_note), "metal_note")?;
        set(d.set_stone_count(&data.stone_count), "stone_count")?;
        set(d.set_stone_note(&data.carat), "stone_note")?;
        set(d.set_verdict(data.verdict()), "verdict")?;
        set(d.set_all_ok(data.all_ok()), "all_ok")?;
        set(d.set_has_piece(data.has_piece), "has_piece")?;
        set(d.set_has_stones(!data.stones.is_empty()), "has_stones")?;
        set(d.set_stones_more(&data.stones_more()), "stones_more")?;
        let checks: Vec<doc::ChecksItem> = data
            .checks
            .iter()
            .map(|c| doc::ChecksItem { key: None, name: c.name.clone(), verdict: c.verdict().into(), message: c.message.clone(), ok: c.ok })
            .collect();
        set(d.set_checks(&checks), "checks")?;
        let stones: Vec<doc::StonesItem> = data
            .stones
            .iter()
            .map(|s| doc::StonesItem { key: None, what: s.what.clone(), pcs: s.pcs.clone(), each_ct: s.each_ct.clone(), ct: s.ct.clone() })
            .collect();
        set(d.set_stones(&stones), "stones")?;
        set(d.set_has_cost(data.cost.is_some()), "has_cost")?;
        if let Some(cost) = &data.cost {
            set(d.set_cost_total(&format!("{} {}", cost.currency, cost.total)), "cost_total")?;
            set(d.set_cost_figure(&cost.total), "cost_figure")?;
            set(d.set_cost_unit(&format!("{} · estimate", cost.currency)), "cost_unit")?;
            set(d.set_cost_note(&cost.note), "cost_note")?;
            let lines: Vec<doc::CostsItem> = cost
                .lines
                .iter()
                .map(|l| doc::CostsItem { key: None, what: l.what.clone(), qty: l.qty.clone(), rate: l.rate.clone(), amount: l.amount.clone() })
                .collect();
            set(d.set_costs(&lines), "costs")?;
        }
        Ok(d)
    })
}

/// The filled card document, for a test that draws it its own way.
#[cfg(test)]
pub(crate) fn filled_for_tests(data: &PieceData) -> Result<doc::Doc> {
    filled(data)
}

/// Draw the card for data already gathered. A PNG needs a font of the machine's
/// ([`crate::png_font`]); with none this is [`SurfaceError::NoFont`].
pub fn card_png(data: &PieceData, options: &CardOptions) -> Result<Picture> {
    let mut d = filled(data)?;
    let images = std::mem::take(&mut d.imgs);
    render::png(Document::PieceCard, &mut d.inst, &images, options.width(), options.scale, options.theme)
}

/// The card as an SVG, for data already gathered.
pub fn card_svg(data: &PieceData, options: &CardOptions) -> Result<String> {
    let mut d = filled(data)?;
    let images = std::mem::take(&mut d.imgs);
    render::svg(Document::PieceCard, &mut d.inst, &images, options.width(), options.theme)
}

/// Ask the engine about the open drawing's piece and draw its card. The drawing is not changed.
pub fn piece_card(session: &mut Session, options: &CardOptions) -> Result<Card> {
    let data = PieceData::gather(session);
    let picture = card_png(&data, options)?;
    Ok(Card { picture, data })
}
