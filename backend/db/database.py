import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Resolved relative to this file so it works regardless of cwd.
_DB_PATH = Path(__file__).resolve().parent.parent / "dev.db"
_SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


@contextmanager
def get_conn():
    """Yield an open sqlite3 connection, commit on success, rollback + close on error."""
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate_kpi_catalog() -> None:
    """Add columns to kpi_catalog that were introduced after the initial schema was deployed.
    Uses PRAGMA table_info so it is safe to run against both new and existing databases."""
    with get_conn() as conn:
        existing = {row[1] for row in conn.execute("PRAGMA table_info(kpi_catalog)").fetchall()}
        if "aggregation" not in existing:
            conn.execute("ALTER TABLE kpi_catalog ADD COLUMN aggregation TEXT DEFAULT ''")


def init_db() -> None:
    sql = _SCHEMA_PATH.read_text()
    with get_conn() as conn:
        conn.executescript(sql)
    # Run additive column migrations for tables not covered by Alembic
    _migrate_kpi_catalog()


def _deserialise_kpi(row: sqlite3.Row) -> dict:
    d = dict(row)
    for field in ("expected_range", "aliases", "source_fields"):
        raw = d.get(field)
        d[field] = json.loads(raw) if raw else ([] if field != "expected_range" else None)
    d["reviewed"] = bool(d.get("reviewed", 0))
    d.setdefault("aggregation", "")  # guard for rows written before column was added
    return d


def create_kpi(kpi: dict) -> dict:
    """Insert a new KPI into the catalog. reviewed=False by default (user-defined)."""
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO kpi_catalog
               (kpi_id, display_name, description, numerator, denominator,
                format, domain, expected_range, aliases, source_fields, reviewed,
                aggregation)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                kpi["kpi_id"],
                kpi["display_name"],
                kpi.get("description", ""),
                kpi["numerator"],
                kpi["denominator"],
                kpi["format"],
                kpi["domain"],
                json.dumps(kpi["expected_range"]) if kpi.get("expected_range") else None,
                json.dumps(kpi.get("aliases", [])),
                json.dumps(kpi.get("source_fields", [])),
                1 if kpi.get("reviewed") else 0,
                kpi.get("aggregation", ""),
            ),
        )
    return get_kpi_by_id(kpi["kpi_id"])


def set_kpi_reviewed(kpi_id: str, reviewed: bool = True) -> None:
    """Mark a user-defined KPI as reviewed/approved by the central data team."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE kpi_catalog SET reviewed = ? WHERE kpi_id = ?",
            (1 if reviewed else 0, kpi_id),
        )


def get_kpi_catalog(domain: str | None = None) -> list[dict]:
    with get_conn() as conn:
        if domain:
            rows = conn.execute(
                "SELECT * FROM kpi_catalog WHERE domain = ? ORDER BY domain, display_name",
                (domain,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM kpi_catalog ORDER BY domain, display_name"
            ).fetchall()
    return [_deserialise_kpi(r) for r in rows]


def get_kpi_by_id(kpi_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM kpi_catalog WHERE kpi_id = ?", (kpi_id,)
        ).fetchone()
    return _deserialise_kpi(row) if row else None


def get_report(request_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM report_requests WHERE id = ?", (request_id,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    for field in ("intake_spec", "column_mapping", "computed_kpis", "data_quality_flags", "chat_history"):
        raw = d.get(field)
        d[field] = json.loads(raw) if raw else None
    return d


def create_report(request_id: str, created_by: str = "dev") -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO report_requests (id, created_by) VALUES (?, ?)",
            (request_id, created_by),
        )
    return get_report(request_id)


def update_report(request_id: str, **fields) -> None:
    if not fields:
        return
    # Serialise any dict/list values to JSON.
    serialised = {
        k: json.dumps(v) if isinstance(v, (dict, list)) else v
        for k, v in fields.items()
    }
    serialised["updated_at"] = "datetime('now')"
    set_clause = ", ".join(
        f"{k} = datetime('now')" if v == "datetime('now')" else f"{k} = ?"
        for k, v in serialised.items()
    )
    values = [v for v in serialised.values() if v != "datetime('now')"]
    with get_conn() as conn:
        conn.execute(
            f"UPDATE report_requests SET {set_clause} WHERE id = ?",
            [*values, request_id],
        )


def list_reports(created_by: str | None = None) -> list[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM report_requests WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM report_requests ORDER BY created_at DESC"
            ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        for field in ("intake_spec", "column_mapping", "computed_kpis", "data_quality_flags", "chat_history"):
            raw = d.get(field)
            d[field] = json.loads(raw) if raw else None
        result.append(d)
    return result


def get_schema_memory(client_id: str, template_type: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM schema_memory WHERE client_id = ? AND template_type = ?",
            (client_id, template_type),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["mappings"] = json.loads(d["mappings"])
    return d


def save_schema_memory(client_id: str, template_type: str, mappings: dict, approved_by: str = "dev") -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO schema_memory (client_id, template_type, mappings, approved_by, use_count)
               VALUES (?, ?, ?, ?, 1)
               ON CONFLICT (client_id, template_type)
               DO UPDATE SET mappings = excluded.mappings,
                             approved_by = excluded.approved_by,
                             use_count = use_count + 1,
                             updated_at = datetime('now')""",
            (client_id, template_type, json.dumps(mappings), approved_by),
        )


def create_review_entry(entry_id: str, request_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO review_queue (id, request_id) VALUES (?, ?)",
            (entry_id, request_id),
        )


def get_review_queue(status: str | None = "pending") -> list[dict]:
    with get_conn() as conn:
        if status:
            rows = conn.execute(
                """SELECT rq.*, rr.template_type, rr.client_id, rr.period_start,
                          rr.period_end, rr.created_by, rr.computed_kpis, rr.data_quality_flags
                   FROM review_queue rq
                   JOIN report_requests rr ON rq.request_id = rr.id
                   WHERE rq.status = ?
                   ORDER BY rq.rowid DESC""",
                (status,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT rq.*, rr.template_type, rr.client_id, rr.period_start,
                          rr.period_end, rr.created_by, rr.computed_kpis, rr.data_quality_flags
                   FROM review_queue rq
                   JOIN report_requests rr ON rq.request_id = rr.id
                   ORDER BY rq.rowid DESC"""
            ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        for field in ("overrides", "computed_kpis", "data_quality_flags"):
            raw = d.get(field)
            d[field] = json.loads(raw) if raw else None
        result.append(d)
    return result


def update_review_entry(entry_id: str, status: str, reviewer_notes: str = "", overrides: dict | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            """UPDATE review_queue
               SET status = ?, reviewer_notes = ?, overrides = ?, reviewed_at = datetime('now')
               WHERE id = ?""",
            (status, reviewer_notes, json.dumps(overrides) if overrides else None, entry_id),
        )


def log_agent_step(request_id: str, step: str, input_data: any, output_data: any, latency_ms: int = 0) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO agent_log (request_id, step, input, output, latency_ms) VALUES (?, ?, ?, ?, ?)",
            (
                request_id,
                step,
                json.dumps(input_data) if not isinstance(input_data, str) else input_data,
                json.dumps(output_data) if not isinstance(output_data, str) else output_data,
                latency_ms,
            ),
        )
