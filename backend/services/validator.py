"""Centralised validation service.

Each function returns a ValidationResult. Errors block progression;
warnings are surfaced in the UI but do not stop the flow.
"""
import io
import re
from collections import defaultdict
from typing import TYPE_CHECKING

from schemas.interview import ValidationError, ValidationResult

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


# ── Upload validation ─────────────────────────────────────────────────────────

# Excel magic bytes (PK\x03\x04 = ZIP header used by .xlsx)
_XLSX_MAGIC = b"PK\x03\x04"
_MAX_SIZE_MB = 50


def validate_upload(filename: str, size_bytes: int, content_bytes: bytes) -> ValidationResult:
    errors: list[ValidationError] = []

    # Extension check
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in {".xlsx", ".csv"}:
        errors.append(
            ValidationError(
                field="filename",
                message=f"Unsupported file type '{ext}'. Only .xlsx and .csv are accepted.",
                severity="error",
            )
        )

    # Size check
    if size_bytes > _MAX_SIZE_MB * 1024 * 1024:
        errors.append(
            ValidationError(
                field="file",
                message=f"File exceeds {_MAX_SIZE_MB} MB limit ({size_bytes / 1_048_576:.1f} MB).",
                severity="error",
            )
        )

    # Magic bytes vs extension mismatch
    if ext == ".xlsx" and not content_bytes[:4].startswith(_XLSX_MAGIC):
        errors.append(
            ValidationError(
                field="file",
                message="File has .xlsx extension but does not appear to be a valid Excel file.",
                severity="error",
            )
        )

    # Encoding check for CSV
    if ext == ".csv":
        sample = content_bytes[:4096]
        try:
            sample.decode("utf-8")
        except UnicodeDecodeError:
            try:
                sample.decode("latin-1")
            except UnicodeDecodeError:
                errors.append(
                    ValidationError(
                        field="file",
                        message="CSV encoding could not be determined. Please re-save as UTF-8.",
                        severity="warning",
                    )
                )

    return ValidationResult(valid=not any(e.severity == "error" for e in errors), errors=errors)


# ── Schema mapping validation ─────────────────────────────────────────────────

def validate_schema_mapping(dataset_id: int, db: "Session") -> ValidationResult:
    from models.column_schema import ColumnSchema
    from models.upload import Upload

    errors: list[ValidationError] = []

    upload_ids = [
        row.id
        for row in db.query(Upload.id).filter(Upload.dataset_id == dataset_id).all()
    ]
    if not upload_ids:
        errors.append(
            ValidationError(field="dataset", message="No uploads found for this dataset.", severity="error")
        )
        return ValidationResult(valid=False, errors=errors)

    cols = (
        db.query(ColumnSchema)
        .filter(ColumnSchema.upload_id.in_(upload_ids))
        .all()
    )

    # Duplicate column names across files
    name_to_uploads: dict[str, list[int]] = defaultdict(list)
    for c in cols:
        name_to_uploads[c.column_name].append(c.upload_id)
    for name, uids in name_to_uploads.items():
        if len(set(uids)) > 1:
            errors.append(
                ValidationError(
                    field=name,
                    message=f"Column '{name}' appears in {len(set(uids))} files. Consider renaming to avoid ambiguity.",
                    severity="warning",
                )
            )

    # Every fact-table upload must have at least one date and one measure
    from models.data_model import DataModel
    dm = db.query(DataModel).filter(DataModel.dataset_id == dataset_id).first()
    fact_upload_ids: set[int] = set()
    if dm and dm.tables:
        fact_upload_ids = {
            t["upload_id"] for t in dm.tables
            if (t.get("confirmed_role") or t.get("role")) == "fact"
        }
    else:
        # If no data model yet, treat all uploads as potential fact tables
        fact_upload_ids = set(upload_ids)

    for uid in fact_upload_ids:
        file_cols = [c for c in cols if c.upload_id == uid]
        effective_roles = {c.effective_role for c in file_cols}
        if "date" not in effective_roles:
            upload_name = next((c.column_name for c in file_cols), f"upload {uid}")
            errors.append(
                ValidationError(
                    field=f"upload_{uid}",
                    message="Fact table has no date column. Mark at least one column as role 'date'.",
                    severity="error",
                )
            )
        if "measure" not in effective_roles:
            errors.append(
                ValidationError(
                    field=f"upload_{uid}",
                    message="Fact table has no measure column. Mark at least one column as role 'measure'.",
                    severity="warning",
                )
            )

    return ValidationResult(valid=not any(e.severity == "error" for e in errors), errors=errors)


# ── Data model validation ─────────────────────────────────────────────────────

def validate_data_model(dataset_id: int, db: "Session") -> ValidationResult:
    from models.data_model import DataModel
    from models.column_schema import ColumnSchema
    import pandas as pd

    errors: list[ValidationError] = []

    dm = db.query(DataModel).filter(DataModel.dataset_id == dataset_id).first()
    if not dm or not dm.foreign_keys:
        return ValidationResult(valid=True, errors=[])

    fks: list[dict] = dm.foreign_keys or []

    # Circular FK detection using DFS
    graph: dict[int, list[int]] = defaultdict(list)
    for fk in fks:
        if fk.get("confirmed", True):
            graph[fk["from_upload_id"]].append(fk["to_upload_id"])

    def _has_cycle(node: int, visited: set, stack: set) -> bool:
        visited.add(node)
        stack.add(node)
        for neighbour in graph.get(node, []):
            if neighbour not in visited:
                if _has_cycle(neighbour, visited, stack):
                    return True
            elif neighbour in stack:
                return True
        stack.discard(node)
        return False

    visited_nodes: set[int] = set()
    for node in list(graph.keys()):
        if node not in visited_nodes:
            if _has_cycle(node, visited_nodes, set()):
                errors.append(
                    ValidationError(
                        field="foreign_keys",
                        message="Circular foreign key relationship detected. Please review the FK graph.",
                        severity="warning",
                    )
                )
                break

    # Referential integrity check (sample-based)
    for fk in fks:
        if not fk.get("confirmed", True):
            continue
        integrity_pct = fk.get("integrity_pct")
        if integrity_pct is not None and integrity_pct < 90.0:
            errors.append(
                ValidationError(
                    field=f"{fk['from_upload_id']}.{fk['from_col']}",
                    message=(
                        f"Only {integrity_pct:.0f}% of values in "
                        f"'{fk['from_col']}' exist in the referenced column "
                        f"'{fk['to_col']}'. This FK may be incorrect."
                    ),
                    severity="warning",
                )
            )

    # All warnings — never blocks
    return ValidationResult(valid=True, errors=errors)


# ── KPI formula validation ────────────────────────────────────────────────────

def validate_kpi_formula(formula: str, available_columns: list[str]) -> ValidationResult:
    """Validates a KPI formula using asteval's sandboxed interpreter.

    Injects dummy float values for each available column, then evaluates
    the formula. Reports unknown column references and syntax errors.
    """
    errors: list[ValidationError] = []

    if not formula or not formula.strip():
        errors.append(
            ValidationError(field="formula", message="Formula cannot be empty.", severity="error")
        )
        return ValidationResult(valid=False, errors=errors)

    try:
        from asteval import Interpreter
    except ImportError:
        # asteval not installed — skip formula validation gracefully
        return ValidationResult(valid=True, errors=[])

    aeval = Interpreter(minimal=True)

    # Inject dummy values for all available columns
    for col in available_columns:
        safe_name = re.sub(r"\W", "_", col)
        aeval.symtable[safe_name] = 1.0

    # Normalise formula: replace column names that contain spaces/special chars
    normalised = formula
    for col in sorted(available_columns, key=len, reverse=True):
        safe = re.sub(r"\W", "_", col)
        if col != safe:
            normalised = normalised.replace(col, safe)

    result = aeval(normalised)

    if aeval.error:
        for err in aeval.error:
            msg = str(err.get_error())
            if "NameError" in msg or "name" in msg.lower():
                # Extract the unknown name from the message
                match = re.search(r"'(\w+)'", msg)
                bad_name = match.group(1) if match else "unknown"
                errors.append(
                    ValidationError(
                        field="formula",
                        message=f"Column '{bad_name}' is not available in the schema.",
                        severity="error",
                    )
                )
            elif "ZeroDivisionError" in msg:
                errors.append(
                    ValidationError(
                        field="formula",
                        message="Formula may divide by zero. Consider wrapping denominator: e.g. contacts if contacts != 0 else 1.",
                        severity="warning",
                    )
                )
            else:
                errors.append(
                    ValidationError(field="formula", message=f"Formula error: {msg}", severity="error")
                )

    return ValidationResult(valid=not any(e.severity == "error" for e in errors), errors=errors)


# ── Recipe validation ─────────────────────────────────────────────────────────

def validate_recipe(config: dict, available_columns: list[str]) -> ValidationResult:
    errors: list[ValidationError] = []

    if not config.get("date_column"):
        errors.append(
            ValidationError(field="date_column", message="Recipe must have a date column.", severity="error")
        )
    elif config["date_column"] not in available_columns:
        errors.append(
            ValidationError(
                field="date_column",
                message=f"Date column '{config['date_column']}' not found in schema.",
                severity="error",
            )
        )

    if not config.get("kpis"):
        errors.append(
            ValidationError(field="kpis", message="Recipe must define at least one KPI.", severity="warning")
        )
    else:
        for kpi in config["kpis"]:
            result = validate_kpi_formula(kpi.get("formula", ""), available_columns)
            for e in result.errors:
                errors.append(
                    ValidationError(
                        field=f"kpi.{kpi.get('name', '?')}.formula",
                        message=e.message,
                        severity=e.severity,
                    )
                )

    return ValidationResult(valid=not any(e.severity == "error" for e in errors), errors=errors)


# ── Schema drift detection ────────────────────────────────────────────────────

def detect_schema_drift(upload_id: int, current_columns: list[str], db: "Session") -> ValidationResult:
    """Compares current columns against the confirmed schema at recipe time."""
    from models.column_schema import ColumnSchema

    errors: list[ValidationError] = []

    confirmed = db.query(ColumnSchema).filter(ColumnSchema.upload_id == upload_id).all()
    if not confirmed:
        return ValidationResult(valid=True, errors=[])

    confirmed_names = {c.column_name for c in confirmed}
    current_names = set(current_columns)

    missing = confirmed_names - current_names
    for col in sorted(missing):
        errors.append(
            ValidationError(
                field=col,
                message=f"Column '{col}' was present when the recipe was created but is missing in the new upload.",
                severity="error",
            )
        )

    added = current_names - confirmed_names
    for col in sorted(added):
        errors.append(
            ValidationError(
                field=col,
                message=f"New column '{col}' not in the original schema. It will be ignored unless the recipe is updated.",
                severity="warning",
            )
        )

    return ValidationResult(valid=not any(e.severity == "error" for e in errors), errors=errors)
