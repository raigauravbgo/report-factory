from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, JSON, String

from core.database import Base

_ALLOWED_STATUSES = {"success", "warning", "pending", "error", "blocked"}


class AgentTraceEvent(Base):
    __tablename__ = "agent_trace_events"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, nullable=False, index=True)   # e.g. "session_47"
    step_name = Column(String, nullable=False)            # e.g. "kpi_suggest"
    skill_name = Column(String, nullable=False)           # e.g. "run_session_kpi_suggest"
    status = Column(String, nullable=False)               # success|warning|pending|error|blocked
    confidence = Column(Float, nullable=True)
    message = Column(String, nullable=True)
    evidence_json = Column(JSON, nullable=True)           # structured evidence, no raw upload data
    requires_review = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
