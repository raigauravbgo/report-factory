"""staging_table: add deep profiling columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("staging_tables") as batch_op:
        batch_op.add_column(sa.Column("encoding", sa.String(32), nullable=True))
        batch_op.add_column(sa.Column("delimiter", sa.String(4), nullable=True))
        batch_op.add_column(sa.Column("sheet_names", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("active_sheet", sa.String(256), nullable=True))
        batch_op.add_column(sa.Column("grain_columns", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("staging_tables") as batch_op:
        batch_op.drop_column("grain_columns")
        batch_op.drop_column("active_sheet")
        batch_op.drop_column("sheet_names")
        batch_op.drop_column("delimiter")
        batch_op.drop_column("encoding")
