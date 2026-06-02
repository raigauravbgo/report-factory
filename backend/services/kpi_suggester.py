from __future__ import annotations

import json
import os
from difflib import SequenceMatcher
from pathlib import Path


_CATALOG_PATH = Path(__file__).parent.parent / "catalog" / "kpis.json"
_catalog_cache: list[dict] | None = None


def _load_catalog() -> list[dict]:
    global _catalog_cache
    if _catalog_cache is None:
        with open(_CATALOG_PATH, encoding="utf-8") as f:
            _catalog_cache = json.load(f)
    return _catalog_cache


def suggest(profiles: list[dict], interview_answers: dict) -> list[dict]:
    """
    Match uploaded column names against the KPI catalog.
    Returns a ranked list of KpiSuggestion dicts.
    """
    catalog = _load_catalog()
    col_names = [c["name"] for p in profiles for c in p.get("columns", [])]
    domain_filter = _extract_domain(interview_answers)
    interview_text = _interview_text(interview_answers).lower()

    results: list[dict] = []

    for kpi in catalog:
        kpi_domain = kpi.get("domain", "")

        # Build a list of field names to match against from the KPI definition
        candidates: list[str] = []
        candidates.extend(kpi.get("source_fields") or [])
        candidates.extend(kpi.get("aliases") or [])
        if kpi.get("numerator"):
            candidates.append(kpi["numerator"])
        if kpi.get("denominator"):
            candidates.append(kpi["denominator"])

        best_score = 0.0
        matched_cols: dict[str, str] = {}

        for col in col_names:
            for candidate in candidates:
                score = SequenceMatcher(None, col.lower(), candidate.lower()).ratio()
                if score > best_score:
                    best_score = score
                if score > 0.65:
                    matched_cols[candidate] = col

        # Interview context boost: if the interview mentions this KPI's name or key fields
        boost = 0.0
        kpi_lower = kpi.get("kpi_id", "").replace("_", " ")
        if kpi_lower in interview_text or kpi.get("display_name", "").lower() in interview_text:
            boost = 0.15

        final_score = min(best_score + boost, 1.0)

        if final_score < 0.4:
            continue

        results.append({
            "kpi_id": kpi["kpi_id"],
            "display_name": kpi.get("display_name", kpi["kpi_id"]),
            "formula": f"{kpi.get('numerator', '?')} / {kpi.get('denominator', '?')}",
            "confidence": round(final_score, 2),
            "matched_columns": matched_cols,
            "source": "catalog",
            "domain": kpi_domain,
            "description": kpi.get("description", ""),
        })

    # Add custom KPIs from interview if user defined formulas
    for custom in _extract_custom_kpis(interview_answers):
        results.append({
            "kpi_id": f"custom_{custom['name'].lower().replace(' ', '_')}",
            "display_name": custom["name"],
            "formula": custom.get("formula", ""),
            "confidence": 1.0,
            "matched_columns": {},
            "source": "interview",
            "domain": domain_filter or "custom",
            "description": "User-defined KPI",
        })

    # Sort: interview-sourced first, then by confidence
    results.sort(key=lambda r: (r["source"] != "interview", -r["confidence"]))

    # Apply domain filter if available (keep all but rank matching domain higher)
    if domain_filter:
        results.sort(
            key=lambda r: (r["domain"] != domain_filter, r["source"] != "interview", -r["confidence"])
        )

    return results


def _extract_domain(interview_answers: dict) -> str:
    """Try to infer domain from Q1 answer."""
    domain_q = interview_answers.get("domain") or interview_answers.get("q1") or ""
    domain_q = domain_q.lower()
    if any(w in domain_q for w in ["collect", "debt", "payment", "ptp"]):
        return "collections"
    if any(w in domain_q for w in ["cx", "customer", "support", "csat", "nps"]):
        return "cx"
    if any(w in domain_q for w in ["workforce", "hr", "agent", "headcount", "attrition"]):
        return "workforce"
    if any(w in domain_q for w in ["sales", "revenue", "lead", "pipeline"]):
        return "sales"
    return ""


def _interview_text(answers: dict) -> str:
    return " ".join(str(v) for v in answers.values() if v)


def _extract_custom_kpis(answers: dict) -> list[dict]:
    """Extract user-defined KPI specs from interview answers."""
    kpis = answers.get("kpis") or []
    if isinstance(kpis, list):
        return [k for k in kpis if isinstance(k, dict) and k.get("name")]
    return []
