import re
from typing import TYPE_CHECKING

from schemas.interview import ChartConfig, InterviewResult, KpiSpec, RecipeConfig

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def generate(upload_id: int, dataset_id: int, result: InterviewResult) -> RecipeConfig:
    # Collect all column names referenced across the recipe
    cols: set[str] = set()
    if result.date_column:
        cols.add(result.date_column)
    cols.update(result.dimensions)
    cols.update(result.filters)
    for kpi in result.kpis:
        # Extract bare identifiers from formula (skip operators and numbers)
        cols.update(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", kpi.formula))

    # Default display names: same as raw column name
    column_mappings = {c: c for c in sorted(cols)}

    # Build chart layout: one line chart per KPI + one bar chart per KPI × first dimension
    layout: list[ChartConfig] = []
    for kpi in result.kpis:
        layout.append(ChartConfig(
            type="line",
            kpi=kpi.name,
            title=kpi.name.replace("_", " ").title(),
        ))
    if result.dimensions:
        dim = result.dimensions[0]
        for kpi in result.kpis:
            layout.append(ChartConfig(
                type="bar",
                kpi=kpi.name,
                title=f"{kpi.name.replace('_', ' ').title()} by {dim}",
                group_by=dim,
            ))

    return RecipeConfig(
        upload_id=upload_id,
        dataset_id=dataset_id,
        column_mappings=column_mappings,
        date_column=result.date_column,
        granularity=result.granularity,
        dimensions=result.dimensions,
        filters=result.filters,
        kpis=result.kpis,
        chart_layout=layout,
        interview_skipped=False,
    )


def generate_from_context(dataset_id: int, db: "Session") -> RecipeConfig:
    """Build a RecipeConfig from AI context when the interview is skipped.

    Sources:
      - date_column  → confirmed date column from the fact table's column_schemas
      - granularity  → defaults to "weekly"
      - dimensions   → dataset.pipeline_context["selected_dimensions"]
      - filters      → columns with is_filter_candidate=True from dimension tables
      - kpis         → selected_kpi_ids + custom_kpis from pipeline_context
      - upload_ids   → all upload IDs in the dataset
    """
    from models.column_schema import ColumnSchema
    from models.data_model import DataModel
    from models.dataset import Dataset
    from models.upload import Upload
    from db.database import get_kpi_catalog

    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found.")

    context = dataset.pipeline_context or {}
    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    upload_ids = [u.id for u in uploads]
    fact_upload_id = upload_ids[0] if upload_ids else 0

    # Determine primary fact upload from data model using is_primary_fact flag
    dm = db.query(DataModel).filter(DataModel.dataset_id == dataset_id).first()
    dim_upload_ids: list[int] = []
    if dm and dm.tables:
        primary_fact: dict | None = None
        first_fact: dict | None = None
        for t in dm.tables:
            role = t.get("confirmed_role") or t.get("role")
            if role == "fact":
                if first_fact is None:
                    first_fact = t
                if t.get("is_primary_fact"):
                    primary_fact = t
            elif role == "dimension":
                dim_upload_ids.append(t["upload_id"])
        chosen = primary_fact or first_fact
        if chosen:
            fact_upload_id = chosen["upload_id"]

    # Find date column from fact table
    fact_cols = (
        db.query(ColumnSchema)
        .filter(ColumnSchema.upload_id == fact_upload_id)
        .all()
    )
    date_column = next(
        (c.column_name for c in fact_cols if c.effective_role == "date"),
        "",
    )

    # Selected dimensions and KPIs from pipeline context
    selected_dimensions: list[str] = context.get("selected_dimensions", [])

    # Filters: filter candidates from dimension tables that are NOT already selected as dimensions
    all_cols = db.query(ColumnSchema).filter(ColumnSchema.upload_id.in_(upload_ids)).all()
    filters: list[str] = [
        c.column_name
        for c in all_cols
        if c.upload_id in dim_upload_ids
        and c.effective_is_filter
        and c.column_name not in selected_dimensions
    ]
    selected_kpi_ids: list[str] = context.get("selected_kpi_ids", [])
    custom_kpis_raw: list[dict] = context.get("custom_kpis", [])
    kpi_source_map: dict[str, int] = context.get("kpi_source_map", {})

    # Build KpiSpec list from catalog selections
    catalog = {k["kpi_id"]: k for k in get_kpi_catalog()}
    resolved_formulas: dict[str, str] = context.get("resolved_kpi_formulas", {})
    kpis: list[KpiSpec] = []
    for kpi_id in selected_kpi_ids:
        if kpi_id in catalog:
            k = catalog[kpi_id]
            num = k.get("numerator", kpi_id)
            den = k.get("denominator", "_none_")
            formula = num if den == "_none_" or not den else f"{num} / {den}"
            source_uid = kpi_source_map.get(kpi_id)
            # D1: use resolved_formula (column-level) if available; keep catalog formula for audit
            resolved = resolved_formulas.get(kpi_id)
            kpis.append(KpiSpec(
                name=k["display_name"],
                formula=formula,
                upload_id=source_uid,
                resolved_formula=resolved,
            ))
    # Add custom KPIs — carry upload_id if stored in context
    for ck in custom_kpis_raw:
        source_uid = kpi_source_map.get(ck.get("name", "")) or ck.get("upload_id")
        kpis.append(KpiSpec(name=ck["name"], formula=ck["formula"], upload_id=source_uid))

    # Column mappings: only the columns actually used in the recipe
    _AGG_FUNCS = {"mean", "avg", "average", "sum", "count", "median", "max", "min"}
    relevant_cols: set[str] = set()
    if date_column:
        relevant_cols.add(date_column)
    relevant_cols.update(selected_dimensions)
    relevant_cols.update(filters)
    for kpi in kpis:
        relevant_cols.update(
            c for c in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", kpi.formula)
            if c.lower() not in _AGG_FUNCS
        )
    column_mappings = {c: c for c in sorted(relevant_cols)}

    # Default chart layout
    layout: list[ChartConfig] = []
    for kpi in kpis:
        layout.append(ChartConfig(type="line", kpi=kpi.name, title=kpi.name.replace("_", " ").title()))
    if selected_dimensions:
        dim = selected_dimensions[0]
        for kpi in kpis:
            layout.append(ChartConfig(
                type="bar",
                kpi=kpi.name,
                title=f"{kpi.name.replace('_', ' ').title()} by {dim}",
                group_by=dim,
            ))

    return RecipeConfig(
        upload_id=fact_upload_id,
        dataset_id=dataset_id,
        upload_ids=upload_ids,
        column_mappings=column_mappings,
        date_column=date_column,
        granularity="weekly",
        dimensions=selected_dimensions,
        filters=filters,
        kpis=kpis,
        chart_layout=layout,
        interview_skipped=True,
        selected_kpi_ids=selected_kpi_ids,
        dimension_table_upload_ids=dim_upload_ids,
        selected_dimensions=selected_dimensions,
    )
