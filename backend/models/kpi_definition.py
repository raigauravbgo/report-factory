from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class KpiDefinition(Base):
    __tablename__ = "kpi_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("report_recipes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    formula: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    recipe: Mapped["ReportRecipe"] = relationship(back_populates="kpi_definitions")
