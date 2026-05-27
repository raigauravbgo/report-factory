from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class ReportRecipe(Base):
    __tablename__ = "report_recipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    upload_id: Mapped[int | None] = mapped_column(ForeignKey("uploads.id"), nullable=True)
    selected_kpi_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    computed_kpis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    analysis_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    approved_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    dataset: Mapped["Dataset"] = relationship(back_populates="recipes")
    kpi_definitions: Mapped[list["KpiDefinition"]] = relationship(back_populates="recipe")
    dashboard_config: Mapped["DashboardConfig | None"] = relationship(back_populates="recipe", uselist=False)
    processed_tables: Mapped[list["ProcessedTable"]] = relationship(back_populates="recipe")
