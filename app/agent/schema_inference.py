"""Uses OpenAI to infer canonical column mappings from raw file headers and sample values."""
from __future__ import annotations

import json
import re

from openai import OpenAI

from app.config import settings

_client: OpenAI | None = None

_BASE_SYSTEM_PROMPT = """\
You are a data schema expert. Given a list of column names and sample values from an uploaded \
file, map each column to a canonical snake_case field name and return a confidence score.

Return ONLY a JSON object structured as:
{{
  "OriginalColName": {{
    "canonical_name": "snake_case_name",
    "confidence": 0.0-1.0,
    "status": "auto" | "review_needed" | "ignored",
    "reasoning": "one-line explanation"
  }}
}}

Rules:
- "auto" if confidence >= 0.80
- "review_needed" if confidence 0.40–0.79
- "ignored" if the column appears to be an internal system artifact with confidence < 0.40
- PREFER mapping to one of the known canonical names listed below — use them exactly as written.
- If no known canonical name fits, create a descriptive snake_case name.

Known canonical names this system uses:
{canonical_names}
"""


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


def infer_column_mapping(
    columns: list[str],
    sample_rows: list[dict],
    known_canonical_names: list[str] | None = None,
) -> dict:
    """Call OpenAI to map raw column names to canonical field names with confidence scores."""
    column_samples: dict[str, list[str]] = {}
    for col in columns:
        vals = [str(row[col]) for row in sample_rows if row.get(col) is not None]
        column_samples[col] = vals[:3]

    canonical_list = (
        "\n".join(f"  - {n}" for n in sorted(known_canonical_names))
        if known_canonical_names
        else "  (none provided)"
    )
    system_prompt = _BASE_SYSTEM_PROMPT.format(canonical_names=canonical_list)

    user_msg = f"Map these columns:\n{json.dumps(column_samples, indent=2)}\n\nReturn only valid JSON."

    response = _get_client().chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=2048,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
    )

    raw = response.choices[0].message.content.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def infer_kpi_interest(domain_context: str, available_kpis: list[dict]) -> list[str]:
    """Ask OpenAI which KPIs are most relevant for the given data context."""
    kpi_lines = "\n".join(
        f"- {k['id']}: {k['name']} — {k.get('description', '')}" for k in available_kpis
    )
    response = _get_client().chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": (
                    f'Given this data context: "{domain_context}"\n\n'
                    f"Available KPIs:\n{kpi_lines}\n\n"
                    "Return a JSON array of KPI IDs ordered by relevance. Return only JSON."
                ),
            }
        ],
    )
    raw = response.choices[0].message.content.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)
