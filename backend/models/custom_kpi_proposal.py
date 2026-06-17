from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class CustomKpiProposal(Base):
    """Tracks AI-generated (source='ai') KPIs used in recipes, pending ops approval.

    On approval the formula (possibly edited) is written to catalog/kpis.json so
    future sessions can suggest it without the user rebuilding it from scratch.
    """

    __tablename__ = "custom_kpi_proposals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kpi_id: Mapped[str] = mapped_column(String(128), nullable=False)
    display_name: Mapped[str] = mapped_column(String(256), nullable=False)
    formula: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str] = mapped_column(String(1024), nullable=True, default="")
    domain: Mapped[str] = mapped_column(String(64), nullable=True, default="")
    aggregation: Mapped[str] = mapped_column(String(64), nullable=True, default="")
    format: Mapped[str] = mapped_column(String(32), nullable=True, default="decimal")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    dataset_id: Mapped[int] = mapped_column(Integer, ForeignKey("datasets.id"), nullable=True)
    recipe_id: Mapped[int] = mapped_column(Integer, ForeignKey("report_recipes.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
