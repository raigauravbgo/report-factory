"""
Observability helpers — LLM call logging and agent trace events.

Design constraints:
- NEVER store raw prompt text or user-uploaded data in any log table.
- Prompts are reduced to a short SHA-256 prefix (prompt_hash) only.
- Token counts are estimates (chars / 4) — not exact API counts.
- All functions are fire-and-forget: exceptions are caught and logged to
  the Python logger so they never crash the calling service.
"""
from __future__ import annotations

import hashlib
import logging

logger = logging.getLogger(__name__)

_ALLOWED_STATUSES = frozenset({"success", "warning", "pending", "error", "blocked"})


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: 1 token ≈ 4 characters."""
    return max(1, len(text) // 4)


def _hash_prompt(text: str) -> str:
    """First 16 hex chars of SHA-256 — enough for dedup, safe to store."""
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:16]


def log_llm_call(
    provider: str,
    model: str,
    task_type: str,
    prompt: str,
    response: str,
    latency_ms: int,
    status: str = "success",
    error_message: str | None = None,
) -> None:
    """
    Log one LLM API call.  Prompt is hashed; raw text is never written to DB.
    Safe to call from any service — failures are swallowed and logged only.
    """
    try:
        from core.database import SessionLocal
        from models.llm_call_log import LlmCallLog

        db = SessionLocal()
        try:
            entry = LlmCallLog(
                provider=provider,
                model=model,
                task_type=task_type,
                prompt_hash=_hash_prompt(prompt),
                input_token_estimate=_estimate_tokens(prompt),
                output_token_estimate=_estimate_tokens(response),
                latency_ms=latency_ms,
                status=status,
                error_message=(error_message or "")[:500] or None,
            )
            db.add(entry)
            db.commit()
        finally:
            db.close()
    except Exception as exc:
        logger.warning("observability.log_llm_call failed: %s", exc)


def create_trace_event(
    run_id: str,
    step_name: str,
    skill_name: str,
    status: str,
    confidence: float | None = None,
    message: str = "",
    evidence_json: dict | None = None,
    requires_review: bool = False,
) -> None:
    """
    Create an agent trace event.

    Args:
        run_id:         Session identifier, e.g. "session_47".
        step_name:      Pipeline stage, e.g. "kpi_suggest", "dimensions", "generate".
        skill_name:     Function/tool name, e.g. "run_session_kpi_suggest".
        status:         One of: success | warning | pending | error | blocked.
        confidence:     Optional 0-1 score for the result quality.
        message:        Human-readable summary of what happened.
        evidence_json:  Structured metadata (counts, column names, etc.)
                        — no raw user-uploaded cell data.
        requires_review: True when a human should inspect this event.
    """
    if status not in _ALLOWED_STATUSES:
        logger.warning("create_trace_event: invalid status %r — using 'error'", status)
        status = "error"
    try:
        from core.database import SessionLocal
        from models.agent_trace_event import AgentTraceEvent

        db = SessionLocal()
        try:
            event = AgentTraceEvent(
                run_id=run_id,
                step_name=step_name,
                skill_name=skill_name,
                status=status,
                confidence=confidence,
                message=(message or "")[:1000],
                evidence_json=evidence_json,
                requires_review=requires_review,
            )
            db.add(event)
            db.commit()
        finally:
            db.close()
    except Exception as exc:
        logger.warning("observability.create_trace_event failed: %s", exc)
