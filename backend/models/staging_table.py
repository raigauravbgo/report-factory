from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class StagingTable(Base):
    __tablename__ = "staging_tables"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    upload_id: Mapped[int] = mapped_column(ForeignKey("uploads.id"), nullable=False, unique=True)
    table_name: Mapped[str] = mapped_column(String(128), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False)
    duplicate_row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    profile_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Deep profiling metadata
    encoding: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delimiter: Mapped[str | None] = mapped_column(String(4), nullable=True)
    sheet_names: Mapped[list | None] = mapped_column(JSON, nullable=True)
    active_sheet: Mapped[str | None] = mapped_column(String(256), nullable=True)
    grain_columns: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    upload: Mapped["Upload"] = relationship(back_populates="staging_table")
    processed_table: Mapped["ProcessedTable | None"] = relationship(back_populates="staging_table", uselist=False)
