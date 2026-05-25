import json

from schemas.interview import InterviewResult, KpiSpec, STEP_LABELS
from schemas.upload import ProfilingResult
from services.ai_client import chat_complete


def _system_prompt(profile: ProfilingResult) -> str:
    col_lines = []
    for col in profile.columns:
        sample = col.sample_values[:2] if col.sample_values else []
        col_lines.append(
            f"  - {col.name!r}: {col.detected_type}, role={col.suggested_role}"
            + (f", e.g. {sample}" if sample else "")
        )

    return f"""You are a report configuration assistant helping a user build a dashboard.

The uploaded file has these columns:
{chr(10).join(col_lines)}

Collect the following 5 items IN ORDER — never skip ahead:
1. DATE COLUMN — which column is the date/time period?
2. KPIs — what metrics should the report track? For each KPI get a name and formula using column names and arithmetic (e.g. "conversion_rate = payments / contacts"). Collect 1–5 KPIs.
3. DIMENSIONS — which columns should group or break down the data? (e.g. agent, team, campaign)
4. GRANULARITY — daily, weekly, or monthly?
5. FILTERS — which columns should be available as filters? (User may say "none" — that is fine.)

Rules:
- Ask about one item at a time. Be concise — one short question per reply.
- If an answer is ambiguous, ask one clarifying question before moving on.
- When all 5 items are confirmed, output the text [INTERVIEW_COMPLETE] at the end of your reply."""


def _extract(history: list[dict], profile: ProfilingResult) -> dict:
    col_names = [c.name for c in profile.columns]
    prompt = f"""Extract the report configuration confirmed in the conversation below.
Return ONLY valid JSON matching this schema exactly:
{{
  "date_column": "<column name or null>",
  "kpis": [{{"name": "<name>", "formula": "<formula>"}}],
  "dimensions": ["<col>"],
  "granularity": "<daily|weekly|monthly or null>",
  "filters": ["<col>"]
}}

Rules:
- Use null for items not yet discussed.
- Use [] for kpis/dimensions/filters only if the user explicitly said none are needed.
- Column names must match exactly from: {col_names}

Conversation:
{_fmt(history)}"""

    raw = chat_complete(
        [{"role": "user", "content": prompt}],
        temperature=0.0,
        json_mode=True,
    )
    try:
        return json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return {"date_column": None, "kpis": None, "dimensions": None, "granularity": None, "filters": None}


def _fmt(history: list[dict]) -> str:
    lines = []
    for m in history:
        label = "User" if m["role"] == "user" else "Assistant"
        lines.append(f"{label}: {m['content']}")
    return "\n".join(lines)


def _step(extracted: dict) -> int:
    if not extracted.get("date_column"):
        return 1
    if not extracted.get("kpis"):
        return 2
    if not extracted.get("dimensions"):
        return 3
    if not extracted.get("granularity"):
        return 4
    if extracted.get("filters") is None:
        return 5
    return 5


def _complete(extracted: dict) -> bool:
    return (
        bool(extracted.get("date_column"))
        and bool(extracted.get("kpis"))
        and bool(extracted.get("dimensions"))
        and bool(extracted.get("granularity"))
        and extracted.get("filters") is not None
    )


def _to_result(extracted: dict) -> InterviewResult:
    return InterviewResult(
        date_column=extracted["date_column"],
        kpis=[KpiSpec(**k) for k in (extracted.get("kpis") or [])],
        dimensions=extracted.get("dimensions") or [],
        granularity=extracted["granularity"],
        filters=extracted.get("filters") or [],
    )


def run(
    message: str,
    history: list[dict],
    profile: ProfilingResult,
) -> tuple[str, int, bool, InterviewResult | None]:
    """One turn of the interview. Returns (ai_message, step_index, completed, result_or_None)."""
    messages: list[dict] = [{"role": "system", "content": _system_prompt(profile)}]
    messages.extend(history)
    if message:
        messages.append({"role": "user", "content": message})

    ai_response = chat_complete(messages, temperature=0.4)
    display = ai_response.replace("[INTERVIEW_COMPLETE]", "").strip()

    updated = list(history)
    if message:
        updated.append({"role": "user", "content": message})
    updated.append({"role": "assistant", "content": ai_response})

    extracted = _extract(updated, profile)
    step = _step(extracted)
    done = _complete(extracted) or "[INTERVIEW_COMPLETE]" in ai_response

    return display, step, done, (_to_result(extracted) if done else None)
