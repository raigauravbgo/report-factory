"""schema mapping and data model tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-11
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── New columns on existing tables ───────────────────────────────────────
    op.add_column(
        "datasets",
        sa.Column("pipeline_stage", sa.String(64), nullable=False, server_default="upload"),
    )
    op.add_column(
        "datasets",
        sa.Column("pipeline_context", sa.JSON, nullable=True),
    )
    op.add_column(
        "uploads",
        sa.Column(
            "schema_mapping_status", sa.String(32), nullable=False, server_default="pending"
        ),
    )

    # ── column_schemas ────────────────────────────────────────────────────────
    op.create_table(
        "column_schemas",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("upload_id", sa.Integer, sa.ForeignKey("uploads.id"), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("raw_dtype", sa.String(64), nullable=False),
        sa.Column("ai_detected_type", sa.String(32), nullable=False),
        sa.Column("ai_role", sa.String(32), nullable=False),
        sa.Column("ai_is_filter", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("ai_confidence", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("confirmed_type", sa.String(32), nullable=True),
        sa.Column("confirmed_role", sa.String(32), nullable=True),
        sa.Column("confirmed_is_filter", sa.Boolean, nullable=True),
        sa.Column("unique_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("missing_pct", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("sample_values", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_column_schemas_upload_id", "column_schemas", ["upload_id"])

    # ── data_models ───────────────────────────────────────────────────────────
    op.create_table(
        "data_models",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("dataset_id", sa.Integer, sa.ForeignKey("datasets.id"), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="ai_suggested"),
        sa.Column("tables", sa.JSON, nullable=True),
        sa.Column("primary_keys", sa.JSON, nullable=True),
        sa.Column("foreign_keys", sa.JSON, nullable=True),
        sa.Column("ai_reasoning", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_data_models_dataset_id", "data_models", ["dataset_id"])


def downgrade() -> None:
    op.drop_table("data_models")
    op.drop_table("column_schemas")
    op.drop_column("uploads", "schema_mapping_status")
    op.drop_column("datasets", "pipeline_context")
    op.drop_column("datasets", "pipeline_stage")
