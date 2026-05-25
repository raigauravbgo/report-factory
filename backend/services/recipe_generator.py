import re

from schemas.interview import ChartConfig, InterviewResult, KpiSpec, RecipeConfig


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
        for kpi in result.kpis[:2]:
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
    )
