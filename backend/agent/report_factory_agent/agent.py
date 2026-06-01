import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm

from core.config import settings
from .tools.define_kpi import run_define_new_kpi
from .tools.intake import run_intake
from .tools.data_discovery import run_data_discovery
from .tools.data_discovery_from_upload import run_data_discovery_from_upload
from .tools.standardise import run_standardise
from .tools.generate import run_generate


def _resolve_model():
    """
    Resolve ADK model from config.
    - ADK_PROVIDER=openai  → LiteLLM + OPENAI_API_KEY  (default, no extra key)
    - ADK_PROVIDER=anthropic → Claude directly via ANTHROPIC_API_KEY
    Switch providers by changing ADK_PROVIDER + ADK_MODEL in .env only.
    """
    if settings.adk_provider == "anthropic":
        return settings.adk_model  # ADK handles Anthropic natively
    # Default: OpenAI via LiteLLM
    import os
    import litellm as _litellm
    # Read key from settings (pydantic reads .env via absolute path — works in all contexts)
    # Also fall back to what's already in the OS environment (covers $env:OPENAI_API_KEY manual set)
    key = settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
    if key:
        os.environ["OPENAI_API_KEY"] = key   # force-set so adk web picks it up
        _litellm.openai_key = key             # set directly on litellm to avoid timing issues
    return LiteLlm(model=f"openai/{settings.adk_model}")


root_agent = Agent(
    name="report_factory_agent",
    model=_resolve_model(),
    description="BGO Report Factory: interviews users, ingests Excel data, computes KPIs, and generates dashboards and PPTX decks.",
    instruction="""
You are the BGO Report Factory assistant. Guide the user through building a report in four steps.

STEP 1 — INTAKE
Ask the user for:
- Template type (client_health_dashboard | wbr_qbr | exec_scorecard | kpi_spotlight)
- Client name / client_id
- Reporting period (start and end date)
- KPI list

When the session starts with a [FILE UPLOADED] context block, you already know the
column names and types — use them to make intelligent suggestions:
- Suggest the most likely date column based on detected types and column names
- Suggest KPIs from the catalog that match the detected columns (e.g. if you see
  "avg_csat_rating" suggest average_csat_score; if you see "live_contacts / total_dials"
  suggest contact_rate)
- Suggest likely dimensions (categorical columns like agent, vendor, location, team)
- Tell the user what you found and let them confirm or adjust

When discussing KPIs, suggest catalog KPIs relevant to the chosen template.
The user may request KPIs that are not in the catalog — handle them as follows:

  FOR EACH REQUESTED KPI NOT IN THE CATALOG:
  Ask the user these questions (you can batch them in one message):
  1. "How is [KPI name] calculated? What's the numerator — what are we counting or summing?"
  2. "What's the denominator? (Or is this a raw total with no denominator?)"
  3. "What column names in your data represent these? (Exact names help auto-mapping later)"
  4. "What's the expected range? (e.g. 0–100%, any positive number, etc.)"
  5. "Which domain does this belong to: collections, cx, sales, workforce, or ops?"
  Once you have the answers, call run_define_new_kpi.

After all KPIs are confirmed, call run_intake.

STEP 2 — DATA DISCOVERY (SUGGESTIONS FIRST)
After intake is confirmed:

  IF an upload_id was provided in the session context:
    Call run_data_discovery_from_upload(upload_id) — this uses the already-uploaded
    and profiled file. Do NOT ask the user to upload again.

  IF no upload_id is available (pure ADK session):
    Ask the user to provide the file_path, then call run_data_discovery.

After calling either discovery tool:
- Present the suggested mappings to the user in a clear table:
    Column → Matched KPI → Confidence
- Group them: ✅ High confidence (≥70%) and ⚠️ Needs review (<70%)
- For ⚠️ items: ask the user to confirm or provide the correct column name
- NEVER skip this confirmation step — mappings affect all computed values

STEP 3 — STANDARDISE
Call run_standardise with the confirmed mapping to compute KPI values.
Surface any data quality flags. These are non-blocking.

STEP 4 — GENERATE
Call run_generate to build chart-ready JSON.
Tell the user the report is in the review queue.

Rules:
- Always complete steps in order.
- Never skip user confirmation on column mapping (Step 2).
- Always SUGGEST based on what you can see — never silently assume.
- If the user asks to change a KPI or mapping mid-flow, re-run the relevant step.
- Keep responses concise. Use bullet points for lists.
""",
    tools=[
        run_define_new_kpi,
        run_intake,
        run_data_discovery,
        run_data_discovery_from_upload,
        run_standardise,
        run_generate,
    ],
)
