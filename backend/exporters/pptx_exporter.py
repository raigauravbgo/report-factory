"""
PPTX export engine — generates a PowerPoint deck from dashboard_data.

Slide master:
  Place BGO slide master at backend/exporters/bgo_slide_master.pptx.
  If not present, falls back to a clean BGO-branded blank presentation.
  No code change needed when the master is added — just drop the file.
"""
import io
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import ChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt, Emu

MASTER_PATH = Path(__file__).parent / "bgo_slide_master.pptx"

BGO_NAVY = RGBColor(0x1B, 0x23, 0x40)
BGO_TEAL = RGBColor(0x00, 0xB5, 0xAD)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
GRAY     = RGBColor(0x6B, 0x72, 0x80)
AMBER    = RGBColor(0xF5, 0x9E, 0x0B)

W = Inches(13.33)
H = Inches(7.5)


# ── helpers ───────────────────────────────────────────────────────────────────

def _text_box(slide, left, top, width, height, text, font_size=14,
              bold=False, color=None, bg_color=None, align=None):
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    txBox = slide.shapes.add_textbox(left, top, width, height)
    if bg_color:
        fill = txBox.fill
        fill.solid()
        fill.fore_color.rgb = bg_color
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    if align == "center":
        p.alignment = PP_ALIGN.CENTER
    elif align == "right":
        p.alignment = PP_ALIGN.RIGHT
    run = p.add_run()
    run.text = str(text)
    run.font.size = Pt(font_size)
    run.font.bold = bold
    run.font.color.rgb = color or GRAY
    return txBox


def _fmt_value(value, fmt="percentage"):
    if value is None:
        return "—"
    if fmt == "percentage":
        return f"{float(value) * 100:.1f}%"
    if fmt == "currency":
        return f"${float(value):,.0f}"
    return f"{float(value):,.1f}"


# ── slides ────────────────────────────────────────────────────────────────────

def _add_title_slide(prs, layout, data):
    slide = prs.slides.add_slide(layout)

    # Navy background
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = BGO_NAVY

    # Teal accent bar (left edge)
    bar = slide.shapes.add_shape(
        1,  # MSO_SHAPE_TYPE.RECTANGLE
        Inches(0), Inches(0), Inches(0.15), H
    )
    bar.fill.solid()
    bar.fill.fore_color.rgb = BGO_TEAL
    bar.line.fill.background()

    # BGO label
    _text_box(slide, Inches(0.4), Inches(0.3), Inches(4), Inches(0.5),
              "BGO Report Factory", font_size=11, color=BGO_TEAL)

    # Client name
    client = data.get("client_id") or "Report"
    _text_box(slide, Inches(0.4), Inches(2.5), Inches(10), Inches(1.2),
              client, font_size=40, bold=True, color=WHITE, align="left")

    # Template type
    template = (data.get("template_type") or "").replace("_", " ").title()
    _text_box(slide, Inches(0.4), Inches(3.8), Inches(8), Inches(0.6),
              template, font_size=18, color=BGO_TEAL)

    # Period
    period = ""
    if data.get("period_start") and data.get("period_end"):
        period = f"{data['period_start']}  →  {data['period_end']}"
    elif data.get("period_start"):
        period = data["period_start"]
    if period:
        _text_box(slide, Inches(0.4), Inches(4.5), Inches(8), Inches(0.5),
                  period, font_size=14, color=WHITE)

    # Footer
    _text_box(slide, Inches(0.4), Inches(7.0), Inches(6), Inches(0.4),
              "Confidential — BGO Internal", font_size=9, color=GRAY)


def _add_kpi_slide(prs, layout, kpi_tiles):
    slide = prs.slides.add_slide(layout)

    # Header bar
    header = slide.shapes.add_shape(1, 0, 0, W, Inches(0.9))
    header.fill.solid()
    header.fill.fore_color.rgb = BGO_NAVY
    header.line.fill.background()
    _text_box(slide, Inches(0.3), Inches(0.2), Inches(10), Inches(0.5),
              "KPI Summary", font_size=20, bold=True, color=WHITE)

    # KPI tiles — up to 4 per row
    cols = min(4, len(kpi_tiles))
    tile_w = Inches(12.5 / cols)
    tile_h = Inches(2.2)
    x_start = Inches(0.4)
    y_start = Inches(1.1)

    for i, kpi in enumerate(kpi_tiles[:8]):
        col = i % cols
        row = i // cols
        x = x_start + col * tile_w
        y = y_start + row * (tile_h + Inches(0.15))

        # Tile background
        tile = slide.shapes.add_shape(1, x, y, tile_w - Inches(0.1), tile_h)
        tile.fill.solid()
        tile.fill.fore_color.rgb = RGBColor(0xF4, 0xF6, 0xFA)
        tile.line.color.rgb = RGBColor(0xE5, 0xE7, 0xEB)

        # Teal top border
        accent = slide.shapes.add_shape(1, x, y, tile_w - Inches(0.1), Inches(0.05))
        accent.fill.solid()
        accent.fill.fore_color.rgb = BGO_TEAL
        accent.line.fill.background()

        # KPI label
        label = kpi.get("display_name") or kpi.get("kpi_id") or ""
        _text_box(slide, x + Inches(0.1), y + Inches(0.1),
                  tile_w - Inches(0.2), Inches(0.4),
                  label.replace("_", " ").upper(), font_size=8, color=GRAY)

        # KPI value
        value = _fmt_value(kpi.get("value"), kpi.get("format", "integer"))
        _text_box(slide, x + Inches(0.1), y + Inches(0.5),
                  tile_w - Inches(0.2), Inches(0.9),
                  value, font_size=28, bold=True, color=BGO_NAVY)

        # Flags
        if kpi.get("flags"):
            _text_box(slide, x + Inches(0.1), y + Inches(1.5),
                      tile_w - Inches(0.2), Inches(0.4),
                      f"⚠ {kpi['flags'][0]}", font_size=8, color=AMBER)


def _add_chart_slide(prs, layout, chart_cfg):
    slide = prs.slides.add_slide(layout)

    # Header
    header = slide.shapes.add_shape(1, 0, 0, W, Inches(0.9))
    header.fill.solid()
    header.fill.fore_color.rgb = BGO_NAVY
    header.line.fill.background()

    title = chart_cfg.get("title") or chart_cfg.get("kpi") or "Chart"
    _text_box(slide, Inches(0.3), Inches(0.2), Inches(12), Inches(0.5),
              title, font_size=20, bold=True, color=WHITE)

    series_data = chart_cfg.get("data") or chart_cfg.get("series") or []
    if not series_data:
        _text_box(slide, Inches(0.5), Inches(2), Inches(10), Inches(1),
                  "No data available for this chart.", font_size=14, color=GRAY)
        return

    # Build chart data
    cd = ChartData()
    chart_type = chart_cfg.get("type", "line")

    if chart_type == "line" and series_data and isinstance(series_data[0], dict) and "date" in series_data[0]:
        # Time series
        categories = [p.get("date", "") for p in series_data]
        values = [p.get("value") for p in series_data]
        cd.categories = categories
        cd.add_series(title, values)
        xl_type = XL_CHART_TYPE.LINE
    else:
        # Breakdown bar
        categories = [p.get("label", str(i)) for i, p in enumerate(series_data)]
        values = [p.get("value") for p in series_data]
        cd.categories = categories
        cd.add_series(title, values)
        xl_type = XL_CHART_TYPE.BAR_CLUSTERED

    chart_shape = slide.shapes.add_chart(
        xl_type, Inches(0.5), Inches(1.1), Inches(12.3), Inches(5.8), cd
    )
    chart = chart_shape.chart
    chart.has_legend = False

    # Style series
    series = chart.series[0]
    series.format.line.color.rgb = BGO_TEAL
    try:
        series.format.fill.solid()
        series.format.fill.fore_color.rgb = BGO_TEAL
    except Exception:
        pass


def _add_flags_slide(prs, layout, flags):
    slide = prs.slides.add_slide(layout)

    header = slide.shapes.add_shape(1, 0, 0, W, Inches(0.9))
    header.fill.solid()
    header.fill.fore_color.rgb = BGO_NAVY
    header.line.fill.background()
    _text_box(slide, Inches(0.3), Inches(0.2), Inches(10), Inches(0.5),
              "Data Quality Flags", font_size=20, bold=True, color=WHITE)

    for i, flag in enumerate(flags[:10]):
        y = Inches(1.1) + i * Inches(0.55)
        _text_box(slide, Inches(0.5), y, Inches(12), Inches(0.45),
                  f"⚠  {flag}", font_size=13, color=AMBER)


# ── public API ────────────────────────────────────────────────────────────────

def generate_pptx(dashboard_data: dict) -> bytes:
    """
    Build a PPTX deck from dashboard_data and return raw bytes.
    Uses BGO slide master if present at exporters/bgo_slide_master.pptx,
    otherwise falls back to a clean BGO-branded blank presentation.
    """
    if MASTER_PATH.exists():
        prs = Presentation(str(MASTER_PATH))
    else:
        prs = Presentation()
        prs.slide_width = W
        prs.slide_height = H
    layout = prs.slide_layouts[min(6, len(prs.slide_layouts) - 1)]

    _add_title_slide(prs, layout, dashboard_data)

    if dashboard_data.get("kpi_tiles"):
        _add_kpi_slide(prs, layout, dashboard_data["kpi_tiles"])

    for chart in dashboard_data.get("charts", []):
        _add_chart_slide(prs, layout, chart)

    if dashboard_data.get("data_quality_flags"):
        _add_flags_slide(prs, layout, dashboard_data["data_quality_flags"])

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf.read()
