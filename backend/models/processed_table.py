from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class ProcessedTable(Base):
    __tablename__ = "processed_tables"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    staging_id: Mapped[int] = mapped_column(ForeignKey("staging_tables.id"), nullable=False, unique=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("report_recipes.id"), nullable=False)
    table_name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    staging_table: Mapped["StagingTable"] = relationship(back_populates="processed_table")
    recipe: Mapped["ReportRecipe"] = relationship(back_populates="processed_tables")
