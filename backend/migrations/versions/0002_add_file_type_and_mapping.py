"""add file_type, column_mapping, computed_kpis columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-26

"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # uploads: add file_type
    op.add_column("uploads", sa.Column("file_type", sa.String(64), nullable=False, server_default="unknown"))

    # staging_tables: add column_mapping, mapping_confirmed, available_kpis, blocked_kpis, upload_path
    op.add_column("staging_tables", sa.Column("column_mapping", sa.JSON, nullable=True))
    op.add_column("staging_tables", sa.Column("mapping_confirmed", sa.Integer, nullable=False, server_default="0"))
    op.add_column("staging_tables", sa.Column("available_kpis", sa.JSON, nullable=True))
    op.add_column("staging_tables", sa.Column("blocked_kpis", sa.JSON, nullable=True))
    op.add_column("staging_tables", sa.Column("upload_path", sa.String(512), nullable=True))

    # report_recipes: add upload_id, selected_kpi_ids, computed_kpis, analysis_status
    op.add_column("report_recipes", sa.Column("upload_id", sa.Integer, sa.ForeignKey("uploads.id"), nullable=True))
    op.add_column("report_recipes", sa.Column("selected_kpi_ids", sa.JSON, nullable=True))
    op.add_column("report_recipes", sa.Column("computed_kpis", sa.JSON, nullable=True))
    op.add_column("report_recipes", sa.Column("analysis_status", sa.String(32), nullable=False, server_default="pending"))


def downgrade() -> None:
    op.drop_column("report_recipes", "analysis_status")
    op.drop_column("report_recipes", "computed_kpis")
    op.drop_column("report_recipes", "selected_kpi_ids")
    op.drop_column("report_recipes", "upload_id")
    op.drop_column("staging_tables", "upload_path")
    op.drop_column("staging_tables", "blocked_kpis")
    op.drop_column("staging_tables", "available_kpis")
    op.drop_column("staging_tables", "mapping_confirmed")
    op.drop_column("staging_tables", "column_mapping")
    op.drop_column("uploads", "file_type")
