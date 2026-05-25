from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class DashboardConfig(Base):
    __tablename__ = "dashboard_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("report_recipes.id"), nullable=False, unique=True)
    layout: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    recipe: Mapped["ReportRecipe"] = relationship(back_populates="dashboard_config")
