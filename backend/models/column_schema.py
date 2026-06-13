from datetime import datetime
from sqlalchemy import String, DateTime, Integer, Float, Boolean, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class ColumnSchema(Base):
    __tablename__ = "column_schemas"

    id: Mapped[int] = mapped_column(primary_key=True)
    upload_id: Mapped[int] = mapped_column(ForeignKey("uploads.id"), nullable=False, index=True)

    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_dtype: Mapped[str] = mapped_column(String(64), nullable=False)

    # AI-generated suggestions — never overwritten
    ai_detected_type: Mapped[str] = mapped_column(String(32), nullable=False)   # int|float|boolean|text|date
    ai_role: Mapped[str] = mapped_column(String(32), nullable=False)             # measure|date|dimension|boolean
    ai_is_filter: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    # User overrides — null means "accepted AI suggestion"
    confirmed_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    confirmed_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    confirmed_is_filter: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Stats
    unique_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    missing_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sample_values: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    @property
    def effective_type(self) -> str:
        return self.confirmed_type or self.ai_detected_type

    @property
    def effective_role(self) -> str:
        return self.confirmed_role or self.ai_role

    @property
    def effective_is_filter(self) -> bool:
        return self.confirmed_is_filter if self.confirmed_is_filter is not None else self.ai_is_filter
