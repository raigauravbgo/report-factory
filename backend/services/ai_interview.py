import json
import re

from schemas.interview import InterviewResult, KpiSpec, STEP_LABELS
from schemas.upload import ProfilingResult
from services.ai_client import chat_complete

# ── Flow 1: Hybrid interview (Q1 hard-coded, Q2+ dynamic from column profiles) ──

FLOW1_Q1 = (
    "What type of data does this file represent? "
    "(e.g. call logs, payment records, agent roster, CX interactions, workforce data, or something else?)"
)


def _flow1_system_prompt(profiles: list[dict]) -> str:
    """Build system prompt with all uploaded file column contexts."""
    file_sections = []
    for p in profiles:
        filename = p.get("filename", "unknown")
        cols = p.get("columns", [])
        col_lines = []
        for c in cols:
            sample = c.get("sample_values", [])[:2]
            col_lines.append(
                f"  - {c['name']!r}: {c.get('detected_type','?')}, role={c.get('suggested_role','?')}"
                + (f", e.g. {sample}" if sample else "")
            )
        file_sections.append(f"File: {filename}\n" + "\n".join(col_lines))

    return f"""You are a data analyst helping a user configure a dashboard.

The user has uploaded the following file(s):

{chr(10).join(file_sections)}

Your job is to ask the user up to 5 short, targeted questions to understand:
1. What the data represents (already asked as Q1)
2. Which columns are dates / time periods
3. Which columns they want to measure or track
4. Which columns they use for grouping or filtering (dimensions — e.g. agent name, team, queue, region)
5. Time granularity (daily / weekly / monthly)

Rules:
- Ask ONE short question at a time, tailored to the columns you see.
- Reference specific column names from the file to make questions concrete.
- If a column name strongly implies the answer (e.g. 'call_date'), pre-suggest it.
- You MUST ask about grouping/filtering columns (question 4) before outputting [INTERVIEW_COMPLETE].
- Only output [INTERVIEW_COMPLETE] once you have confirmed: date column, at least one metric, and at least one grouping column."""


def _flow1_extract(history: list[dict], profiles: list[dict]) -> dict:
    all_col_names = [c["name"] for p in profiles for c in p.get("columns", [])]
    prompt = f"""Extract the configuration confirmed so far from the conversation below.
Return ONLY valid JSON:
{{
  "domain": "<data domain or null>",
  "date_column": "<column name or null>",
  "kpis": [{{"name": "<name>", "formula": "<formula>"}}],
  "dimensions": ["<col>"],
  "granularity": "<daily|weekly|monthly or null>",
  "filters": ["<col>"]
}}
Column names available: {all_col_names}
Conversation:
{_fmt(history)}"""
    raw = chat_complete([{"role": "user", "content": prompt}], temperature=0.0, json_mode=True)
    try:
        return json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return {}


def run_flow1(
    message: str,
    history: list[dict],
    profiles: list[dict],
) -> tuple[str, int, bool, dict | None]:
    """
    One turn of Flow 1 hybrid interview.
    Returns (ai_message, step, completed, result_dict_or_None).
    Turn 1: returns Q1 (hard-coded). Turn 2+: AI generates contextual question.
    """
    # Turn 1 — always the hard-coded domain question
    if not history:
        return FLOW1_Q1, 1, False, None

    # Build messages for AI
    messages: list[dict] = [{"role": "system", "content": _flow1_system_prompt(profiles)}]
    messages.extend(history)
    if message:
        messages.append({"role": "user", "content": message})

    ai_response = chat_complete(messages, temperature=0.4)
    display = ai_response.replace("[INTERVIEW_COMPLETE]", "").strip()

    updated = list(history)
    if message:
        updated.append({"role": "user", "content": message})
    updated.append({"role": "assistant", "content": ai_response})

    done = "[INTERVIEW_COMPLETE]" in ai_response
    # H18: Base step on user-turn count, not assistant message count — prevents
    # the counter jumping when the AI sends follow-up clarifications without a user reply.
    step = min(len([m for m in updated if m["role"] == "user"]) + 1, 6)

    if done:
        extracted = _flow1_extract(updated, profiles)
        # Guard: ensure required fields were collected before closing the interview
        missing: list[str] = []
        if not extracted.get("date_column"):
            missing.append("which column contains the date or time period")
        if not extracted.get("dimensions"):
            missing.append("which columns to use for grouping or filtering (e.g. agent name, team, queue)")
        if missing:
            follow_up = "Before we wrap up — could you confirm " + " and ".join(missing) + "?"
            updated.append({"role": "assistant", "content": follow_up})
            return follow_up, step, False, None
        return display, step, True, extracted

    return display, step, False, None


_MAX_FILTER_UNIQUES = 50  # columns with more distinct values are too wide for a useful dropdown

# Tokens that identify non-filterable columns (PII, identifiers, contact fields).
# Checked against each underscore/hyphen-separated token in the column name so that
# snake_case names like "affirm_email" or "agent_id" are caught reliably.
# Note: \b word-boundary does NOT work here because "_" is \w in Python regex,
# so "affirm_email" has no boundary before "email".
_BAD_FILTER_TOKENS: frozenset[str] = frozenset({
    "email", "mail", "phone", "mobile", "fax", "address",
    "url", "link", "password", "token", "hash",
    "id", "key", "code", "num", "number", "ref",
    "uuid", "guid",
})


def _is_bad_filter_col(col_name: str) -> bool:
    """Return True if any token in the column name matches a PII/identifier pattern."""
    parts = re.split(r"[_\-\s]+", col_name.lower())
    return bool(_BAD_FILTER_TOKENS.intersection(parts))


def default_interview_result(profiles: list[dict]) -> dict:
    """
    Return a minimal InterviewResult from schema-mapping data (skip-interview path).

    Filter selection — ONLY from explicit schema markings (is_filter=True).
    No heuristic fallback: if the user marked no filters, the result has no filters.
    This respects user intent; filters can always be added later in the recipe editor.

    Note: _is_bad_filter_col is NOT applied to user-selected filters because the user
    explicitly chose those columns — second-guessing them causes silent data loss
    (e.g. "agent_code" rejected because "code" is a bad token).
    Heuristic filter detection is retained for fallback but only applied when the user
    has not explicitly marked any filters at all AND the schema has not been saved.
    """
    date_col = None
    dimensions: list[str] = []
    user_filters: list[str] = []   # explicitly marked is_filter=True in Schema Mapping

    for p in profiles:
        for c in p.get("columns", []):
            col_name = c["name"]
            detected_type = c.get("detected_type", "")
            suggested_role = c.get("suggested_role", "")
            semantic_tag = c.get("semantic_tag", "")

            if detected_type == "date" and not date_col:
                date_col = col_name
                continue

            if suggested_role == "dimension" and semantic_tag not in ("entity_key", "time_key", "financial_metric"):
                dimensions.append(col_name)

            # Respect all user-explicitly-selected filters without any name-based rejection.
            # The bad-token check was silently dropping valid business filters like
            # "agent_code", "supervisor_id", "activity_type_code".
            if c.get("is_filter"):
                user_filters.append(col_name)

    return {
        "domain": None,
        "date_column": date_col,
        "kpis": [],
        "dimensions": dimensions[:5],
        "granularity": "monthly",
        "filters": user_filters,   # exact set the user chose; empty = no filters
    }


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
    # H17: filters must be a list (not None, not [None]). An empty list [] is valid
    # (user explicitly said no filters). [None] means AI returned null in the array
    # which indicates the AI hasn't confirmed filters yet.
    filters = extracted.get("filters")
    filters_confirmed = isinstance(filters, list) and filters != [None]
    return (
        bool(extracted.get("date_column"))
        and bool(extracted.get("kpis"))
        and bool(extracted.get("dimensions"))
        and bool(extracted.get("granularity"))
        and filters_confirmed
    )


def _to_result(extracted: dict) -> InterviewResult:
    # H1: Preserve domain field collected in Q1
    return InterviewResult(
        domain=extracted.get("domain"),
        date_column=extracted["date_column"],
        kpis=[KpiSpec(**k) for k in (extracted.get("kpis") or [])],
        dimensions=extracted.get("dimensions") or [],
        granularity=extracted["granularity"],
        filters=[f for f in (extracted.get("filters") or []) if f is not None],
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
    done = _complete(extracted)

    return display, step, done, (_to_result(extracted) if done else None)
