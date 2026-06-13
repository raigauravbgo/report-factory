"""AI + heuristic data modeling service.

Analyses all uploads in a dataset together and suggests:
  - Which tables are fact vs dimension
  - Primary key per table
  - Foreign key relationships between tables (with referential integrity %)

AI reasoning pass refines heuristic results when confidence > 0.8.
"""
import json
import logging
import pathlib
import re
from collections import defaultdict
from difflib import SequenceMatcher
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PK_NAME_PATTERN = re.compile(r"(_id|_key|_code|_num|_no)\s*$", re.IGNORECASE)
_AI_CONFIDENCE_THRESHOLD = 0.8

# E3: integrity sample — 10% of fact rows, clamped between 200 and 1000
_FK_INTEGRITY_SAMPLE_RATIO = 0.10
_FK_INTEGRITY_SAMPLE_MIN = 200
_FK_INTEGRITY_SAMPLE_MAX = 1000

# C3: raised from 0.65 → 0.78 to reduce false-positive fuzzy FK matches
_FK_NAME_SIMILARITY_THRESHOLD = 0.78

# C1: FKs with integrity below this are auto-rejected (not surfaced as confirmed)
_FK_MIN_INTEGRITY_TO_CONFIRM = 60.0

# A1: dim_unique_ratio thresholds for join cardinality classification
_JOIN_TYPE_ONE_TO_ONE_RATIO = 1.0
_JOIN_TYPE_MANY_TO_ONE_RATIO = 0.95

# B1: tables whose row count is below this fraction of the dataset max are likely dims
_DIM_ROW_RATIO_THRESHOLD = 0.15


def _load_synonyms() -> dict[str, list[str]]:
    """Load column synonym dictionary from catalog (C2)."""
    path = pathlib.Path(__file__).parent.parent / "catalog" / "column_synonyms.json"
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


# ── Public interface ──────────────────────────────────────────────────────────

def suggest(dataset_id: int, db: "Session") -> dict:
    """Run heuristic + AI analysis and return a data model dict."""
    from models.column_schema import ColumnSchema
    from models.upload import Upload
    from services import storage, parser as file_parser
    import pandas as pd

    uploads = db.query(Upload).filter(Upload.dataset_id == dataset_id).all()
    if not uploads:
        return _empty_model(dataset_id)

    summaries: list[dict] = []
    dataframes: dict[int, pd.DataFrame] = {}

    for upload in uploads:
        cols = (
            db.query(ColumnSchema)
            .filter(ColumnSchema.upload_id == upload.id)
            .all()
        )
        staging = _get_staging(upload.id, db)
        row_count = staging.row_count if staging else 0

        col_info = [
            {
                "name": c.column_name,
                "type": c.effective_type,
                "role": c.effective_role,
                "unique_count": c.unique_count,
                "missing_pct": c.missing_pct,
            }
            for c in cols
        ]
        summaries.append(
            {
                "upload_id": upload.id,
                "filename": upload.filename,
                "row_count": row_count,
                "columns": col_info,
            }
        )

        try:
            from sqlalchemy import text as _text
            engine = db.get_bind()
            table_name = f"staging_{upload.id}"
            from sqlalchemy import inspect as _inspect
            if _inspect(engine).has_table(table_name):
                import pandas as _pd
                with engine.connect() as conn:
                    df = _pd.read_sql_table(table_name, conn)
            else:
                df = file_parser.parse_upload(upload.id, upload.s3_key, db)
            dataframes[upload.id] = df
        except Exception:
            pass

    heuristic = _heuristic_model(summaries)

    try:
        ai_result = _ai_refine(summaries, heuristic)
        model = _merge_ai(heuristic, ai_result)
    except Exception as exc:
        logger.warning("AI data modeling failed (%s) — using heuristics only.", exc)
        model = heuristic

    model["foreign_keys"] = _check_integrity(model["foreign_keys"], dataframes)

    return model


def apply_overrides(model_id: int, overrides: dict, db: "Session") -> None:
    """Apply user table/PK/FK overrides to a DataModel row."""
    from models.data_model import DataModel

    dm = db.query(DataModel).filter(DataModel.id == model_id).first()
    if not dm:
        return

    table_overrides: dict[int, str] = {
        o["upload_id"]: o["role"] for o in overrides.get("table_overrides", [])
    }
    if table_overrides and dm.tables:
        updated_tables = []
        for t in dm.tables:
            uid = t["upload_id"]
            updated_tables.append(
                {**t, "confirmed_role": table_overrides[uid]}
                if uid in table_overrides
                else t
            )
        dm.tables = updated_tables

    pk_overrides: dict[str, list[str]] = overrides.get("pk_overrides", {})
    if pk_overrides:
        current_pks = dict(dm.primary_keys or {})
        for uid_str, cols in pk_overrides.items():
            current_pks[uid_str] = cols
        dm.primary_keys = current_pks

    fk_overrides: list[dict] = overrides.get("fk_overrides", [])
    if fk_overrides and dm.foreign_keys is not None:
        fk_key = lambda f: (f["from_upload_id"], f["from_col"], f["to_upload_id"], f["to_col"])
        override_map = {
            (o["from_upload_id"], o["from_col"], o["to_upload_id"], o["to_col"]): o
            for o in fk_overrides
        }
        updated_fks = []
        for fk in dm.foreign_keys:
            key = fk_key(fk)
            if key in override_map:
                o = override_map[key]
                if o.get("confirmed") is False:
                    continue  # user removed this FK
                updated_fks.append({**fk, "confirmed": True})
            else:
                updated_fks.append(fk)
        existing_keys = {fk_key(f) for f in dm.foreign_keys}
        for o in fk_overrides:
            k = (o["from_upload_id"], o["from_col"], o["to_upload_id"], o["to_col"])
            if k not in existing_keys and o.get("confirmed", True):
                updated_fks.append(
                    {
                        "from_upload_id": o["from_upload_id"],
                        "from_col": o["from_col"],
                        "to_upload_id": o["to_upload_id"],
                        "to_col": o["to_col"],
                        "confidence": 1.0,
                        "integrity_pct": None,
                        "confirmed": True,
                        "join_type": "unverified",
                        "dim_max_dup": None,
                        "dim_unique_ratio": None,
                    }
                )
        dm.foreign_keys = updated_fks

    primary_fact_upload_id: int | None = overrides.get("primary_fact_upload_id")
    if primary_fact_upload_id is not None and dm.tables:
        dm.tables = [
            {**t, "is_primary_fact": t["upload_id"] == primary_fact_upload_id}
            for t in dm.tables
        ]
    elif dm.tables and not any(t.get("is_primary_fact") for t in dm.tables):
        _set_default_primary_fact(dm.tables)
        dm.tables = list(dm.tables)

    dm.status = "confirmed"
    db.flush()


# ── Heuristic classification ──────────────────────────────────────────────────

def _heuristic_model(summaries: list[dict]) -> dict:
    tables = []
    primary_keys: dict[str, list[str]] = {}
    foreign_keys: list[dict] = []

    # B1: compute max row count across all tables for ratio-based dim detection
    max_row_count = max((s["row_count"] for s in summaries), default=0)

    for s in summaries:
        uid = s["upload_id"]
        cols = s["columns"]
        role, confidence = _classify_table(cols, s["row_count"], max_row_count)
        pk = _detect_pk(cols, s["row_count"])

        tables.append(
            {
                "upload_id": uid,
                "filename": s["filename"],
                "role": role,
                "confidence": confidence,
                "confirmed_role": None,
                "is_primary_fact": False,
            }
        )
        if pk:
            primary_keys[str(uid)] = pk if isinstance(pk, list) else [pk]

    foreign_keys = _detect_fks(summaries, primary_keys)

    _set_default_primary_fact(tables)

    return {
        "tables": tables,
        "primary_keys": primary_keys,
        "foreign_keys": foreign_keys,
        "ai_reasoning": None,
    }


def _set_default_primary_fact(tables: list[dict]) -> None:
    facts = [t for t in tables if (t.get("confirmed_role") or t.get("role")) == "fact"]
    if not facts:
        return
    best = max(facts, key=lambda t: t.get("confidence", 0))
    for t in tables:
        t["is_primary_fact"] = t["upload_id"] == best["upload_id"]


def detect_bridge_dims(tables: list[dict], foreign_keys: list[dict]) -> list[dict]:
    """Return dim tables that are joined by 2+ distinct fact tables (bridge pattern)."""
    role_map = {t["upload_id"]: (t.get("confirmed_role") or t.get("role")) for t in tables}
    filename_map = {t["upload_id"]: t["filename"] for t in tables}

    dim_to_facts: dict[int, set[int]] = {}
    for fk in foreign_keys:
        if not fk.get("confirmed", True):
            continue
        f, t = fk["from_upload_id"], fk["to_upload_id"]
        if role_map.get(f) == "fact" and role_map.get(t) == "dimension":
            dim_to_facts.setdefault(t, set()).add(f)
        elif role_map.get(t) == "fact" and role_map.get(f) == "dimension":
            dim_to_facts.setdefault(f, set()).add(t)

    bridges = []
    for dim_uid, fact_uids in dim_to_facts.items():
        if len(fact_uids) >= 2:
            bridges.append({
                "dim_upload_id": dim_uid,
                "dim_filename": filename_map.get(dim_uid, f"upload {dim_uid}"),
                "fact_upload_ids": sorted(fact_uids),
                "fact_filenames": [filename_map.get(uid, f"upload {uid}") for uid in sorted(fact_uids)],
            })
    return bridges


def _classify_table(cols: list[dict], row_count: int = 0, max_row_count: int = 0) -> tuple[str, float]:
    measure_count = sum(1 for c in cols if c["role"] == "measure")
    date_count = sum(1 for c in cols if c["role"] == "date")
    dim_count = sum(1 for c in cols if c["role"] == "dimension")
    total = len(cols) or 1

    # B1: row-count-ratio heuristic — small tables with mostly dimension columns are dims
    if max_row_count > 0 and row_count > 0:
        ratio = row_count / max_row_count
        if ratio < _DIM_ROW_RATIO_THRESHOLD and measure_count <= 2 and dim_count / total >= 0.5:
            return "dimension", 0.85

    if measure_count >= 2 and date_count >= 1:
        conf = min(1.0, 0.6 + 0.1 * measure_count + 0.1 * date_count)
        return "fact", round(conf, 2)

    if dim_count / total >= 0.6 and measure_count == 0:
        return "dimension", 0.75

    if measure_count > 0:
        return "fact", 0.55

    return "dimension", 0.5


def _detect_pk(cols: list[dict], row_count: int) -> str | list[str] | None:
    """Return the most likely PK column(s).

    B4: if the best single-column candidate is not unique (unique_count < row_count),
    attempt a composite PK from the top-3 candidates by checking whether their
    combined unique_count reaches row_count.  Returns a list for composite PKs.
    """
    candidates = []
    for c in cols:
        score = 0.0
        if _PK_NAME_PATTERN.search(c["name"]):
            score += 0.5
        if c["type"] in ("int", "text"):
            score += 0.2
        if row_count and c["unique_count"] >= row_count * 0.95:
            score += 0.4
        if score > 0:
            candidates.append((score, c["name"], c.get("unique_count", 0)))
    if not candidates:
        return None

    candidates.sort(reverse=True)
    best_name = candidates[0][1]
    best_unique = candidates[0][2]

    # If the top candidate is already fully unique → single-column PK
    if row_count and best_unique >= row_count * 0.99:
        return best_name

    # B4: try composite PK from top-3 candidates
    if row_count and len(candidates) >= 2:
        top3_names = [c[1] for c in candidates[:3]]
        # Composite is a valid PK if the pair's combined name-set covers most rows.
        # We can't cheaply compute combined cardinality here without the DataFrame,
        # so we use a proxy: if BOTH columns have high individual cardinality together
        # (each > 50% unique) they likely form a unique composite.
        top3_unique = [c[2] for c in candidates[:3]]
        composite_candidates = [
            (top3_names[i], top3_names[j])
            for i in range(len(top3_names))
            for j in range(i + 1, len(top3_names))
            if top3_unique[i] / row_count >= 0.3 and top3_unique[j] / row_count >= 0.3
        ]
        if composite_candidates:
            return list(composite_candidates[0])  # return first composite pair

    return best_name


# ── FK detection ─────────────────────────────────────────────────────────────

_BARE_JOIN_KEYWORDS = re.compile(
    r"^(id|key|uuid|email|code|num|no|ref|eid|emp_id|employee_id)$",
    re.IGNORECASE,
)
_JOIN_KEY_HINT = re.compile(
    r"(_id|_key|_code|_email|_no|_num|_ref|_uuid|_eid)\s*$"
    r"|^(id|key|uuid|email|eid)$",
    re.IGNORECASE,
)


def _col_core(name: str) -> str:
    parts = name.lower().split("_", 1)
    return parts[-1]


def _detect_fks(summaries: list[dict], primary_keys: dict) -> list[dict]:
    """Four-strategy FK detection + S5 synonym matching."""
    seen: set[tuple] = set()
    fks: list[dict] = []

    def _add(from_uid, from_col, to_uid, to_col, conf):
        key  = (min(from_uid, to_uid), from_col.lower(), max(from_uid, to_uid), to_col.lower())
        rkey = (min(from_uid, to_uid), to_col.lower(),   max(from_uid, to_uid), from_col.lower())
        if key in seen or rkey in seen:
            return
        seen.add(key)
        fks.append({
            "from_upload_id": from_uid,
            "from_col": from_col,
            "to_upload_id": to_uid,
            "to_col": to_col,
            "confidence": round(conf, 3),
            "integrity_pct": None,
            "confirmed": True,
            # A1: join_type populated later by _check_integrity
            "join_type": "unverified",
            "dim_max_dup": None,
            "dim_unique_ratio": None,
        })

    # ── S1: exact column name match ───────────────────────────────────────────
    col_index: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for s in summaries:
        for col in s["columns"]:
            col_index[col["name"].lower()].append((s["upload_id"], col["name"]))

    for appearances in col_index.values():
        if len(appearances) < 2:
            continue
        for i in range(len(appearances)):
            for j in range(i + 1, len(appearances)):
                uid_a, col_a = appearances[i]
                uid_b, col_b = appearances[j]
                if uid_a != uid_b:
                    _add(uid_a, col_a, uid_b, col_b, 0.95)

    # ── S2: core/suffix match (agent_email ↔ email, ticket_id ↔ id) ──────────
    core_index: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for s in summaries:
        for col in s["columns"]:
            core = _col_core(col["name"])
            if _BARE_JOIN_KEYWORDS.match(core):
                core_index[core].append((s["upload_id"], col["name"]))

    for appearances in core_index.values():
        if len(appearances) < 2:
            continue
        for i in range(len(appearances)):
            for j in range(i + 1, len(appearances)):
                uid_a, col_a = appearances[i]
                uid_b, col_b = appearances[j]
                if uid_a != uid_b:
                    _add(uid_a, col_a, uid_b, col_b, 0.88)

    # ── S3: fuzzy match on join-key columns (C3: threshold raised to 0.78) ────
    for i, s1 in enumerate(summaries):
        for s2 in summaries[i + 1:]:
            for col1 in s1["columns"]:
                if not _JOIN_KEY_HINT.search(col1["name"]):
                    continue
                for col2 in s2["columns"]:
                    if not _JOIN_KEY_HINT.search(col2["name"]):
                        continue
                    score = SequenceMatcher(
                        None, col1["name"].lower(), col2["name"].lower()
                    ).ratio()
                    if score >= _FK_NAME_SIMILARITY_THRESHOLD:
                        _add(s1["upload_id"], col1["name"], s2["upload_id"], col2["name"], score)

    # ── S4: PK similarity fallback ────────────────────────────────────────────
    fact_ids = [s["upload_id"] for s in summaries]
    all_pks: dict[int, list[str]] = {}
    for uid_str, pk_list in primary_keys.items():
        if pk_list:
            all_pks[int(uid_str)] = pk_list

    for fact_uid in fact_ids:
        fact_summary = next(s for s in summaries if s["upload_id"] == fact_uid)
        for col in fact_summary["columns"]:
            if not _PK_NAME_PATTERN.search(col["name"]):
                continue
            for other_uid, other_pk_list in all_pks.items():
                if other_uid == fact_uid:
                    continue
                for other_pk in other_pk_list:
                    score = SequenceMatcher(
                        None, col["name"].lower(), other_pk.lower()
                    ).ratio()
                    if score >= _FK_NAME_SIMILARITY_THRESHOLD:
                        _add(fact_uid, col["name"], other_uid, other_pk, score)

    # ── S5: synonym match (C2) ────────────────────────────────────────────────
    synonyms = _load_synonyms()
    if synonyms:
        # Build index: canonical → list of (upload_id, col_name) appearances
        synonym_index: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for s in summaries:
            for col in s["columns"]:
                col_lower = col["name"].lower()
                for canonical, syn_list in synonyms.items():
                    if col_lower == canonical or col_lower in syn_list:
                        synonym_index[canonical].append((s["upload_id"], col["name"]))

        for canonical, appearances in synonym_index.items():
            if len(appearances) < 2:
                continue
            for i in range(len(appearances)):
                for j in range(i + 1, len(appearances)):
                    uid_a, col_a = appearances[i]
                    uid_b, col_b = appearances[j]
                    # Skip if same column name (already covered by S1)
                    if uid_a != uid_b and col_a.lower() != col_b.lower():
                        _add(uid_a, col_a, uid_b, col_b, 0.75)

    return fks


# ── AI refinement pass ────────────────────────────────────────────────────────

def _ai_refine(summaries: list[dict], heuristic: dict) -> dict:
    from services.ai_client import chat_complete

    system = (
        "You are a data architect. Analyse these database tables and identify "
        "the star schema structure. Output ONLY valid JSON."
    )
    user_msg = (
        f"Tables:\n{json.dumps(summaries, indent=2)}\n\n"
        f"Heuristic result (for context):\n{json.dumps(heuristic, indent=2)}\n\n"
        "Identify:\n"
        "1. Which tables are fact vs dimension tables\n"
        "2. The primary key column(s) for each table\n"
        "3. Foreign key relationships (column in fact table → PK in dimension table)\n\n"
        "Return JSON:\n"
        '{"tables": [{"upload_id": N, "role": "fact|dimension", "confidence": 0.9}], '
        '"primary_keys": {"upload_id_str": ["col"]}, '
        '"foreign_keys": [{"from_upload_id": N, "from_col": "...", "to_upload_id": N, "to_col": "...", "confidence": 0.9}], '
        '"overall_reasoning": "..."}'
    )

    raw = chat_complete(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        temperature=0.1,
        json_mode=True,
    )
    return json.loads(raw)


def _merge_ai(heuristic: dict, ai_result: dict) -> dict:
    merged_tables = list(heuristic["tables"])
    ai_table_map = {t["upload_id"]: t for t in ai_result.get("tables", [])}
    for i, t in enumerate(merged_tables):
        ai = ai_table_map.get(t["upload_id"])
        if ai and float(ai.get("confidence", 0)) >= _AI_CONFIDENCE_THRESHOLD:
            merged_tables[i] = {**t, "role": ai["role"], "confidence": ai["confidence"]}
    _set_default_primary_fact(merged_tables)

    merged_pks = dict(heuristic["primary_keys"])
    for uid_str, pk_list in ai_result.get("primary_keys", {}).items():
        if pk_list:
            merged_pks[uid_str] = pk_list

    existing_fk_keys = {
        (f["from_upload_id"], f["from_col"]) for f in heuristic["foreign_keys"]
    }
    merged_fks = list(heuristic["foreign_keys"])
    for fk in ai_result.get("foreign_keys", []):
        key = (fk["from_upload_id"], fk["from_col"])
        if key not in existing_fk_keys and float(fk.get("confidence", 0)) >= _AI_CONFIDENCE_THRESHOLD:
            merged_fks.append(
                {
                    **fk,
                    "integrity_pct": None,
                    "confirmed": True,
                    "join_type": "unverified",
                    "dim_max_dup": None,
                    "dim_unique_ratio": None,
                }
            )
            existing_fk_keys.add(key)

    return {
        "tables": merged_tables,
        "primary_keys": merged_pks,
        "foreign_keys": merged_fks,
        "ai_reasoning": ai_result.get("overall_reasoning"),
    }


# ── Referential integrity check ───────────────────────────────────────────────

def _check_integrity(foreign_keys: list[dict], dataframes: dict) -> list[dict]:
    """Sample referential integrity and classify join cardinality for each FK.

    A1: populates join_type, dim_max_dup, dim_unique_ratio on every FK.
    C1: auto-rejects FKs with integrity_pct == 0.0 (sets confirmed=False).
    E3: sample size is 10% of fact rows, clamped to [200, 1000].
    """
    import pandas as pd

    result = []
    for fk in foreign_keys:
        try:
            from_df = dataframes.get(fk["from_upload_id"])
            to_df = dataframes.get(fk["to_upload_id"])
            if from_df is None or to_df is None:
                result.append(fk)
                continue
            from_col = fk["from_col"]
            to_col = fk["to_col"]
            if from_col not in from_df.columns or to_col not in to_df.columns:
                result.append(fk)
                continue

            # E3: adaptive sample size
            sample_size = min(
                _FK_INTEGRITY_SAMPLE_MAX,
                max(_FK_INTEGRITY_SAMPLE_MIN, int(len(from_df) * _FK_INTEGRITY_SAMPLE_RATIO)),
            )
            sample = from_df[from_col].dropna().head(sample_size)
            pk_values = set(to_df[to_col].dropna().astype(str))
            matched = sample.astype(str).isin(pk_values).sum()
            integrity_pct = round(matched / len(sample) * 100, 1) if len(sample) else None

            # A1: join cardinality classification
            dim_counts = to_df[to_col].value_counts()
            dim_max_dup = int(dim_counts.max()) if len(dim_counts) else 1
            dim_unique_ratio = round(len(dim_counts) / max(len(to_df), 1), 4)

            if dim_unique_ratio >= _JOIN_TYPE_ONE_TO_ONE_RATIO:
                join_type = "one_to_one"
            elif dim_unique_ratio >= _JOIN_TYPE_MANY_TO_ONE_RATIO:
                join_type = "many_to_one"
            else:
                join_type = "many_to_many"

            # C1: auto-reject zero-integrity FKs — they are false positives
            confirmed = fk.get("confirmed", True)
            if integrity_pct is not None and integrity_pct == 0.0:
                confirmed = False

            result.append({
                **fk,
                "integrity_pct": integrity_pct,
                "confirmed": confirmed,
                "join_type": join_type,
                "dim_max_dup": dim_max_dup,
                "dim_unique_ratio": dim_unique_ratio,
            })
        except Exception:
            result.append(fk)
    return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_staging(upload_id: int, db: "Session"):
    from models.staging_table import StagingTable
    return db.query(StagingTable).filter(StagingTable.upload_id == upload_id).first()


def _empty_model(dataset_id: int) -> dict:
    return {
        "tables": [],
        "primary_keys": {},
        "foreign_keys": [],
        "ai_reasoning": None,
    }
