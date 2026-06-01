import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.database import get_db
from models.report_recipe import ReportRecipe
from models.staging_table import StagingTable
from services.compute import compute_dashboard

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _get_recipe_and_staging(recipe_id: int, db: Session):
    recipe = db.query(ReportRecipe).filter(ReportRecipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found.")
    config = recipe.config
    upload_id = config.get("upload_id")
    if not upload_id:
        raise HTTPException(400, "Recipe has no upload_id.")
    staging = db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()
    if not staging:
        raise HTTPException(404, "Staging data not found. Re-upload the file.")
    return recipe, config, staging


@router.get("/{recipe_id}/data")
def get_dashboard_data(recipe_id: int, db: Session = Depends(get_db)):
    recipe, config, staging = _get_recipe_and_staging(recipe_id, db)
    try:
        result = compute_dashboard(config, staging.table_name)
    except Exception as e:
        raise HTTPException(500, f"Computation failed: {e}")
    return {
        "recipe_id": recipe_id,
        "config": config,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        **result,
    }


@router.get("/{recipe_id}/export/excel")
def export_excel(recipe_id: int, db: Session = Depends(get_db)):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    recipe, config, staging = _get_recipe_and_staging(recipe_id, db)
    try:
        result = compute_dashboard(config, staging.table_name)
    except Exception as e:
        raise HTTPException(500, f"Computation failed: {e}")

    wb = openpyxl.Workbook()

    # Sheet 1: KPI Summary
    ws = wb.active
    ws.title = "KPI Summary"
    header_fill = PatternFill("solid", fgColor="3B82F6")
    header_font = Font(bold=True, color="FFFFFF")

    ws.append(["KPI", "Value", "Formula"])
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")

    for kpi in result["kpi_summaries"]:
        val = kpi["value"]
        if val is not None and "/" in kpi["formula"]:
            val = f"{val * 100:.1f}%"
        elif val is not None:
            val = round(val, 2)
        ws.append([kpi["name"], val, kpi["formula"]])

    ws.column_dimensions["A"].width = 25
    ws.column_dimensions["B"].width = 15
    ws.column_dimensions["C"].width = 35

    # Sheet 2: Time Series
    if result["time_series"]:
        ws2 = wb.create_sheet("Time Series")
        for ts in result["time_series"]:
            ws2.append([ts["kpi"]])
            ws2.cell(ws2.max_row, 1).font = Font(bold=True)
            ws2.append(["Date", "Value"])
            for cell in ws2[ws2.max_row]:
                cell.fill = header_fill
                cell.font = header_font
            for point in ts["data"]:
                ws2.append([point["date"], point["value"]])
            ws2.append([])
        ws2.column_dimensions["A"].width = 18
        ws2.column_dimensions["B"].width = 15

    # Sheet 3: Breakdown
    if result["breakdown"]:
        ws3 = wb.create_sheet("Breakdown")
        for bk in result["breakdown"]:
            ws3.append([f"{bk['kpi']} by {bk['dimension']}"])
            ws3.cell(ws3.max_row, 1).font = Font(bold=True)
            ws3.append([bk["dimension"], "Value"])
            for cell in ws3[ws3.max_row]:
                cell.fill = header_fill
                cell.font = header_font
            for point in bk["data"]:
                ws3.append([point["label"], point["value"]])
            ws3.append([])
        ws3.column_dimensions["A"].width = 25
        ws3.column_dimensions["B"].width = 15

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=dashboard_recipe_{recipe_id}.xlsx"},
    )


@router.get("/{recipe_id}/export/pptx")
def export_pptx(recipe_id: int, db: Session = Depends(get_db)):
    from exporters.pptx_exporter import generate_pptx

    recipe, config, staging = _get_recipe_and_staging(recipe_id, db)
    try:
        result = compute_dashboard(config, staging.table_name)
    except Exception as e:
        raise HTTPException(500, f"Computation failed: {e}")

    dashboard_data = {
        "template_type": config.get("granularity", ""),
        "client_id": f"Recipe #{recipe_id}",
        "period_start": None,
        "period_end": None,
        "kpi_tiles": [
            {
                "kpi_id": k["name"],
                "display_name": k["name"].replace("_", " ").title(),
                "value": k["value"],
                "format": "percentage" if "/" in k["formula"] else "integer",
                "flags": [],
            }
            for k in result["kpi_summaries"]
        ],
        "charts": [
            {**ts, "type": "line"}
            for ts in result["time_series"]
        ] + [
            {**bk, "type": "bar", "title": f"{bk['kpi']} by {bk['dimension']}"}
            for bk in result["breakdown"]
        ],
        "data_quality_flags": [],
    }

    pptx_bytes = generate_pptx(dashboard_data)
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f"attachment; filename=dashboard_recipe_{recipe_id}.pptx"},
    )
