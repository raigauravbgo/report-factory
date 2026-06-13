from datetime import datetime
from sqlalchemy import String, DateTime, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Tracks where in the pipeline this dataset currently is
    # upload|schema_mapping|data_modeling|interview|kpi_selection|dimension_selection|recipe|dashboard
    pipeline_stage: Mapped[str] = mapped_column(String(64), nullable=False, default="upload")
    # Persists KPI/dimension selections before the recipe is finalised
    pipeline_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    uploads: Mapped[list["Upload"]] = relationship(back_populates="dataset")
    recipes: Mapped[list["ReportRecipe"]] = relationship(back_populates="dataset")
