"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-30
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_datasets_client_id", "datasets", ["client_id"])

    op.create_table(
        "uploads",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("dataset_id", sa.Integer, sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("s3_key", sa.String(512), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_uploads_client_id", "uploads", ["client_id"])

    op.create_table(
        "report_recipes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("dataset_id", sa.Integer, sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("config", sa.JSON, nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("approved_by", sa.String(128), nullable=True),
        sa.Column("approved_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_report_recipes_client_id", "report_recipes", ["client_id"])

    op.create_table(
        "staging_tables",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("upload_id", sa.Integer, sa.ForeignKey("uploads.id"), nullable=False, unique=True),
        sa.Column("table_name", sa.String(128), nullable=False),
        sa.Column("row_count", sa.Integer, nullable=False),
        sa.Column("column_count", sa.Integer, nullable=False),
        sa.Column("duplicate_row_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("profile_data", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_staging_tables_client_id", "staging_tables", ["client_id"])

    op.create_table(
        "processed_tables",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("staging_id", sa.Integer, sa.ForeignKey("staging_tables.id"), nullable=False, unique=True),
        sa.Column("recipe_id", sa.Integer, sa.ForeignKey("report_recipes.id"), nullable=False),
        sa.Column("table_name", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_processed_tables_client_id", "processed_tables", ["client_id"])

    op.create_table(
        "kpi_definitions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("recipe_id", sa.Integer, sa.ForeignKey("report_recipes.id"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("formula", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("ix_kpi_definitions_client_id", "kpi_definitions", ["client_id"])

    op.create_table(
        "dashboard_configs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("recipe_id", sa.Integer, sa.ForeignKey("report_recipes.id"), nullable=False, unique=True),
        sa.Column("layout", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_dashboard_configs_client_id", "dashboard_configs", ["client_id"])


def downgrade() -> None:
    op.drop_table("dashboard_configs")
    op.drop_table("kpi_definitions")
    op.drop_table("processed_tables")
    op.drop_table("staging_tables")
    op.drop_table("report_recipes")
    op.drop_table("uploads")
    op.drop_table("datasets")
