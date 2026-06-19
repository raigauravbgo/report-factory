from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String

from core.database import Base


class LlmCallLog(Base):
    __tablename__ = "llm_call_logs"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, nullable=False)
    model = Column(String, nullable=False)
    task_type = Column(String, nullable=False, default="unknown")
    prompt_hash = Column(String(16), nullable=True)   # SHA-256 prefix only — never raw prompt
    input_token_estimate = Column(Integer, nullable=True)
    output_token_estimate = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    status = Column(String, nullable=False, default="success")
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
