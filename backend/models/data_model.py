from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base


class DataModel(Base):
    """Stores AI-suggested + user-confirmed data model for a dataset.

    tables JSON shape:
      [{"upload_id": 1, "filename": "x.xlsx", "role": "fact|dimension",
        "confidence": 0.9, "confirmed_role": null}]

    primary_keys JSON shape:
      {"1": ["id_col"]}   # key is upload_id as string

    foreign_keys JSON shape:
      [{"from_upload_id": 1, "from_col": "client_id",
        "to_upload_id": 2, "to_col": "id",
        "confidence": 0.85, "integrity_pct": 97.3,
        "confirmed": true}]
    """
    __tablename__ = "data_models"

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(
        ForeignKey("datasets.id"), nullable=False, unique=True, index=True
    )
    # ai_suggested | confirmed
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ai_suggested")

    tables: Mapped[list | None] = mapped_column(JSON, nullable=True)
    primary_keys: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    foreign_keys: Mapped[list | None] = mapped_column(JSON, nullable=True)
    ai_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
