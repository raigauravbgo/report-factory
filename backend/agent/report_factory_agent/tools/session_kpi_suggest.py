"""
Session-aware KPI suggestion tool for the ADK agent.

Bridges the multi-file session pipeline into the ADK agent by calling
the production kpi_suggester service against the dataset's staging profiles.
This is the session-flow replacement for run_data_discovery_from_upload
at the KPI selection step.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))


def run_session_kpi_suggest(
    dataset_id: int,
    upload_ids: list[int],
    interview_answers: dict,
) -> dict:
    """
    Suggests KPIs for a multi-file session using the production kpi_suggester service.

    Call this AFTER the user has answered Q1-Q6 (date column, dimensions, domain, etc.)
    so that interview_answers can guide the KPI matching (domain filtering).

    Args:
        dataset_id: The dataset ID from the [DATASET UPLOADED] context block.
        upload_ids: List of upload IDs for the files in this session.
        interview_answers: Dict with keys like date_column, dimensions, domain,
            granularity — collected during the Q1-Q6 interview phase.

    Returns:
        Dict with:
          - status: "kpi_suggestions_ready"
          - count: total number of suggestions
          - kpis: list of KPI dicts (kpi_id, display_name, formula, confidence, domain)
          - message: human-readable summary for the agent to present
    """
    from core.database import SessionLocal
    from models.staging_table import StagingTable
    from models.upload import Upload
    from services.kpi_suggester import suggest
    from services.observability import create_trace_event

    run_id = f"session_{dataset_id}"
    create_trace_event(
        run_id=run_id, step_name="kpi_suggest", skill_name="run_session_kpi_suggest",
        status="pending", message="Starting KPI suggestion from staging profiles",
        evidence_json={"dataset_id": dataset_id, "upload_ids": upload_ids},
    )

    db = SessionLocal()
    try:
        query = (
            db.query(StagingTable)
            .join(Upload, StagingTable.upload_id == Upload.id)
            .filter(Upload.dataset_id == dataset_id)
        )
        if upload_ids:
            query = query.filter(Upload.id.in_(upload_ids))

        staging_rows = query.all()
        if not staging_rows:
            return {
                "error": (
                    f"No profiled staging data found for dataset_id={dataset_id}. "
                    "Ensure all files have finished profiling before calling this tool."
                )
            }

        profiles = [
            {
                **st.profile_data,
                "filename": st.upload.filename,
                "staging_table_name": st.table_name,
            }
            for st in staging_rows
            if st.profile_data
        ]

        if not profiles:
            create_trace_event(
                run_id=run_id, step_name="kpi_suggest", skill_name="run_session_kpi_suggest",
                status="error", message="No profile data found for dataset",
                evidence_json={"dataset_id": dataset_id},
            )
            return {"error": f"All uploads for dataset_id={dataset_id} have empty profile data."}

        suggestions = suggest(profiles, interview_answers)

        kpi_list = []
        for s in suggestions:
            if hasattr(s, "model_dump"):
                kpi_list.append(s.model_dump())
            elif hasattr(s, "__dict__"):
                kpi_list.append(dict(s.__dict__))
            else:
                kpi_list.append(dict(s))

        high_conf = [k for k in kpi_list if k.get("confidence", 0) >= 0.75]
        needs_review = [k for k in kpi_list if k.get("confidence", 0) < 0.75]

        summary_lines = [
            f"Found {len(kpi_list)} KPI suggestions across {len(profiles)} file(s).",
            f"{len(high_conf)} high-confidence (≥75%) and {len(needs_review)} lower-confidence.",
        ]
        if high_conf:
            top = high_conf[:5]
            summary_lines.append(
                "Top suggestions: "
                + ", ".join(
                    f"{k['display_name']} ({int(k.get('confidence', 0) * 100)}%)"
                    for k in top
                )
            )

        avg_confidence = sum(k.get("confidence", 0) for k in kpi_list) / len(kpi_list) if kpi_list else 0.0
        create_trace_event(
            run_id=run_id, step_name="kpi_suggest", skill_name="run_session_kpi_suggest",
            status="success",
            confidence=round(avg_confidence, 3),
            message=f"Suggested {len(kpi_list)} KPIs ({len(high_conf)} high-confidence)",
            evidence_json={
                "dataset_id": dataset_id,
                "kpi_count": len(kpi_list),
                "high_confidence_count": len(high_conf),
                "needs_review_count": len(needs_review),
                "domains": list({k.get("domain") for k in kpi_list if k.get("domain")}),
            },
            requires_review=len(needs_review) > 0,
        )
        return {
            "status": "kpi_suggestions_ready",
            "count": len(kpi_list),
            "kpis": kpi_list,
            "high_confidence_count": len(high_conf),
            "needs_review_count": len(needs_review),
            "summary": " ".join(summary_lines),
            "message": (
                f"KPI suggestions ready. {summary_lines[0]} {summary_lines[1]} "
                "Present the full list to the user, grouped by domain. "
                "Let them deselect any KPIs they don't want. "
                "For KPIs not in the list, ask for formula and call run_define_new_kpi. "
                "Do NOT call run_session_generate until the user has confirmed the KPI list."
            ),
        }
    finally:
        db.close()
