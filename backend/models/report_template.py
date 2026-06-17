from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, JSON
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class ReportTemplate(Base):
    """A saved report configuration that can be reapplied to new uploads.

    file_fingerprints stores a list of column-name sets — one per file slot —
    used to match new uploads against this template at ≥ 95% overlap.

    Example file_fingerprints:
      [
        {"slot": 0, "columns": ["agent_email", "qa_score", "date_graded", ...]},
        {"slot": 1, "columns": ["agent_email", "location", "team", ...]}
      ]
    """

    __tablename__ = "report_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False)
    file_fingerprints: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    source_recipe_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("report_recipes.id"), nullable=True
    )
    source_dataset_id: Mapped[int] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
