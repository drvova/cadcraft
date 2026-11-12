//! The bench sheet as a designed page (SVG or PNG): what goes to the bench, or to a customer as
//! a quote. Laid out by `slab/tech-sheet.slab`; the views are the engine's own picture of the
//! drawing, handed to Slab as a runtime image.

use cadcraft_engine::Session;

use crate::data::PieceData;
use crate::document::Document;
use crate::error::{Result, SurfaceError, guard};
use crate::generated::tech_sheet as doc;
use crate::render::{self, Picture, Theme};

/// The name the document's `img` asks for.
const VIEW: &str = "view";
/// The views' box on the page, in layout units: the page's content width at the default page
/// width, by the height the document gives it.
const VIEW_UNITS: (u32, u32) = (714, 300);

/// How the sheet is drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SheetOptions {
    /// The page's width in layout units (CSS pixels in an SVG; clamped to 560–1600). The height
    /// is the sheet's own.
    pub width: u32,
    /// Pixels per unit for a PNG (clamped to 0.5–4).
    pub scale: f64,
    /// The palette.
    pub theme: Theme,
    /// Whether the sheet carries the drawing's views.
    pub views: bool,
}

impl Default for SheetOptions {
    /// An A4 page's width at 96 dpi (794 units), two pixels a unit, the light palette (it is
    /// paper), with the views.
    fn default() -> Self {
        SheetOptions { width: 794, scale: 2.0, theme: Theme::Light, views: true }
    }
}

impl SheetOptions {
    fn width(&self) -> u32 {
        self.width.clamp(560, 1600)
    }
}

/// The drawing as the engine draws it, for the sheet's views.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Views {
    /// A PNG.
    pub png: Vec<u8>,
    /// Its width in pixels.
    pub width: u32,
    /// Its height in pixels.
    pub height: u32,
}

impl Views {
    /// The open drawing's current space, fitted to its extents. `None` when there is no drawing,
    /// nothing in it to draw, or the engine cannot render it: the sheet then has no views.
    pub fn of(session: &Session) -> Option<Views> {
        let state = session.state().ok()?;
        state.doc.model.iter().next()?;
        // Two pixels a unit: sharp in the PNG at its default scale, and in an SVG zoomed to 200%.
        let (width, height) = (VIEW_UNITS.0 * 2, VIEW_UNITS.1 * 2);
        let png = cadcraft_io::png_framed(&state.doc, &state.space, width, height, None).ok()?;
        Some(Views { png, width, height })
    }
}

fn filled(data: &PieceData, views: Option<&Views>) -> Result<doc::Doc> {
    Document::TechSheet.slir()?;
    guard("the bench sheet", || {
        let mut d = doc::Doc::new();
        let set = |ok: bool, param: &'static str| -> Result<()> {
            if ok { Ok(()) } else { Err(SurfaceError::Refused { document: "tech-sheet.slab", param }) }
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

        // The views: a picture the kernel refuses (not a PNG of the size it says) is left out.
        let shown = views.is_some_and(|v| d.img_register(VIEW, v.width, v.height, 0, &v.png) >= 0);
        set(d.set_has_view(shown), "has_view")?;
        set(d.set_view(if shown { VIEW } else { "" }), "view")?;

        set(d.set_has_bands(!data.bands.is_empty()), "has_bands")?;
        let bands: Vec<doc::BandsItem> = data
            .bands
            .iter()
            .map(|b| doc::BandsItem {
                key: None,
                ring: if b.inside == crate::data::NONE { b.size.clone() } else { format!("{} · {} inside", b.size, b.inside) },
                metal: b.metal.clone(),
                width: b.width.clone(),
                wall: b.wall.clone(),
                grams: b.grams.clone(),
            })
            .collect();
        set(d.set_bands(&bands), "bands")?;

        set(d.set_has_stones(!data.stones.is_empty()), "has_stones")?;
        let stones: Vec<doc::StonesItem> = data
            .stones
            .iter()
            .map(|s| doc::StonesItem { key: None, what: s.what.clone(), pcs: s.pcs.clone(), each_ct: s.each_ct.clone(), ct: s.ct.clone() })
            .collect();
        set(d.set_stones(&stones), "stones")?;
        set(d.set_stones_more(&data.stones_more()), "stones_more")?;
        set(d.set_stone_total(&data.stone_count), "stone_total")?;
        set(d.set_carat_total(data.carat.trim_end_matches(" ct")), "carat_total")?;

        let checks: Vec<doc::ChecksItem> = data
            .checks
            .iter()
            .map(|c| doc::ChecksItem { key: None, name: c.name.clone(), verdict: c.verdict().into(), message: c.message.clone(), ok: c.ok })
            .collect();
        set(d.set_checks(&checks), "checks")?;

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

        set(d.set_has_warnings(!data.warnings.is_empty()), "has_warnings")?;
        let warnings: Vec<doc::WarningsItem> = data.warnings.iter().map(|w| doc::WarningsItem { key: None, message: w.clone() }).collect();
        set(d.set_warnings(&warnings), "warnings")?;
        Ok(d)
    })
}

/// The sheet as a standalone SVG, for data (and views) already gathered. The same data gives the
/// same bytes.
pub fn sheet_svg(data: &PieceData, views: Option<&Views>, options: &SheetOptions) -> Result<String> {
    let mut d = filled(data, views)?;
    let images = std::mem::take(&mut d.imgs);
    render::svg(Document::TechSheet, &mut d.inst, &images, options.width(), options.theme)
}

/// The sheet as a PNG, for data (and views) already gathered.
pub fn sheet_png(data: &PieceData, views: Option<&Views>, options: &SheetOptions) -> Result<Picture> {
    let mut d = filled(data, views)?;
    let images = std::mem::take(&mut d.imgs);
    render::png(Document::TechSheet, &mut d.inst, &images, options.width(), options.scale, options.theme)
}

/// The open drawing's bench sheet as an SVG page. The drawing is not changed.
pub fn tech_sheet_svg(session: &mut Session, options: &SheetOptions) -> Result<String> {
    let data = PieceData::gather(session);
    let views = if options.views { Views::of(session) } else { None };
    sheet_svg(&data, views.as_ref(), options)
}

/// The open drawing's bench sheet as a PNG page. The drawing is not changed.
pub fn tech_sheet_png(session: &mut Session, options: &SheetOptions) -> Result<Picture> {
    let data = PieceData::gather(session);
    let views = if options.views { Views::of(session) } else { None };
    sheet_png(&data, views.as_ref(), options)
}
