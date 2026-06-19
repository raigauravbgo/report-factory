"""
Session-aware dashboard generation tool for the ADK agent.

Calls generate_from_session() with the confirmed KPIs, dimensions, and
interview result collected during the ADK conversation. Returns a
[DASHBOARD_READY recipe_id=N] signal that the frontend detects to
auto-navigate to the generated dashboard.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))


def run_session_generate(
    dataset_id: int,
    selected_kpis: list[dict],
    interview_result: dict,
    confirmed_relationships: list[dict] | None = None,
) -> dict:
    """
    Generates a ReportRecipe for a multi-file session and returns the recipe_id.

    IMPORTANT: Only call this AFTER the user has explicitly confirmed:
    1. The KPI list (from run_session_kpi_suggest)
    2. The dimension list (from run_session_dimensions)

    The returned message contains [DASHBOARD_READY recipe_id=N] — return it
    verbatim to the user so the frontend can detect and navigate to the dashboard.

    Args:
        dataset_id: The dataset ID from the [DATASET UPLOADED] context block.
        selected_kpis: List of confirmed KPI dicts. Each must have at minimum:
            kpi_id, display_name, formula. Optional: aggregation, format, domain.
        interview_result: Dict with keys collected during Q1-Q6:
            date_column, dimensions (list of confirmed dimension names),
            granularity, domain, filters (optional).
        confirmed_relationships: Optional list of cross-file relationship dicts
            from relationship detection. Pass [] if not available.

    Returns:
        Dict with:
          - status: "dashboard_generated"
          - recipe_id: int
          - dashboard_url: "/dashboard/{recipe_id}"
          - message: contains [DASHBOARD_READY recipe_id=N] — return this verbatim
    """
    from core.database import SessionLocal
    from services.observability import create_trace_event
    from services.session_generator import generate_from_session

    run_id = f"session_{dataset_id}"

    if not selected_kpis:
        create_trace_event(
            run_id=run_id, step_name="generate", skill_name="run_session_generate",
            status="blocked", message="Generation blocked — no KPIs confirmed",
            evidence_json={"dataset_id": dataset_id},
            requires_review=True,
        )
        return {
            "error": (
                "selected_kpis is empty. You must confirm at least one KPI with the user "
                "before calling run_session_generate."
            )
        }

    create_trace_event(
        run_id=run_id, step_name="generate", skill_name="run_session_generate",
        status="pending", message="Starting dashboard generation",
        evidence_json={
            "dataset_id": dataset_id,
            "kpi_count": len(selected_kpis),
            "dimension_count": len(interview_result.get("dimensions") or []),
        },
    )

    db = SessionLocal()
    try:
        recipe_id = generate_from_session(
            dataset_id=dataset_id,
            selected_kpis=selected_kpis,
            confirmed_relationships=confirmed_relationships or [],
            interview_result=interview_result,
            db=db,
        )
        create_trace_event(
            run_id=run_id, step_name="generate", skill_name="run_session_generate",
            status="success",
            confidence=1.0,
            message=f"Dashboard generated — recipe_id={recipe_id}",
            evidence_json={
                "dataset_id": dataset_id,
                "recipe_id": recipe_id,
                "kpi_count": len(selected_kpis),
                "dimension_count": len(interview_result.get("dimensions") or []),
            },
        )
        return {
            "status": "dashboard_generated",
            "recipe_id": recipe_id,
            "dashboard_url": f"/dashboard/{recipe_id}",
            "kpi_count": len(selected_kpis),
            "dimension_count": len(interview_result.get("dimensions") or []),
            "message": (
                f"[DASHBOARD_READY recipe_id={recipe_id}]  "
                f"Your dashboard is ready! It includes {len(selected_kpis)} KPI(s) "
                f"with {len(interview_result.get('dimensions') or [])} dimension breakdown(s). "
                f"Navigate to /dashboard/{recipe_id} to view it."
            ),
        }
    except Exception as exc:
        create_trace_event(
            run_id=run_id, step_name="generate", skill_name="run_session_generate",
            status="error", message=f"Generation failed: {exc}",
            evidence_json={"dataset_id": dataset_id, "kpi_count": len(selected_kpis)},
            requires_review=True,
        )
        return {
            "error": f"Dashboard generation failed: {exc}",
            "hint": (
                "Check that dataset_id is correct, all files are profiled, "
                "and selected_kpis contains valid formula strings."
            ),
        }
    finally:
        db.close()
