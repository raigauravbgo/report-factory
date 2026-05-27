# BGO Report Factory — Product Requirements Document

**Version:** 2.0  
**Owner:** Data & AI Platform  
**Last updated:** May 2026  
**Philosophy:** MVP first. Prove the loop. Scale the infrastructure later.

---

## Quick Start — Read This First

This PRD has two environments:

| | MVP | Production |
|---|---|---|
| **Goal** | Prove the agent loop works | Scale to all BGO users |
| **Infrastructure** | Local Python + SQLite | AWS ECS + RDS + Airbyte |
| **IT involvement** | None | Required |
| **Time to first demo** | 2–3 weeks | 8–10 weeks |
| **Who runs it** | 1–2 devs on laptops | Platform team |

**Start with the MVP.** Don't touch the production section until you have five real reports reviewed and published. The agent logic, KPI catalog, templates, and review flow are identical in both environments — only the infrastructure changes.

---

## 1. Problem Statement

BGO's central data team is the single bottleneck for all operational reporting. Every client health dashboard, WBR/QBR deck, and KPI report is built manually — one client at a time. The result is a 3–4 month queue per dashboard type, 40+ clients waiting, and a skilled team spending most of its time on repeatable data plumbing rather than analysis.

**The goal:** A self-serve web app where any BGO user describes what they need, uploads their data, and gets a live interactive dashboard and/or PowerPoint deck — without raising a ticket. The central team shifts from builders to reviewers.

---

## 1.5 Strategic Context — What This Actually Is

This MVP is described as a reporting tool. It is more than that.

**This is the first surface of the BGO AI Platform.** Every component built here — the ADK skill manifest format, the KPI catalog, the schema memory pattern, the review queue, the Langfuse observability layer — becomes foundation that subsequent agents inherit from. Hunter Point Capital's SharePoint → DealCloud workflow will reuse the same skill registry, the same connector pattern, the same review queue. The voice collections agent under the Agentic Comms initiative will reuse the same observability layer and HITL design. Every internal agent that follows will sit on top of the same data layer integration with DataPilot.

**The KPI catalog is the compounding moat.** Every reviewed KPI added to the catalog is proprietary BGO IP that pure-play AI vendors do not have. After 50 reviewed reports across 10 clients, BGO has a structured analytics vocabulary that maps directly to BGO's domain expertise in collections, CX, and ops. After 500 reports, this is genuinely defensible IP — the kind of asset that takes years for a competitor to replicate even with superior models.

**Discipline implications for the build team.** Some shortcuts that would be fine for a throwaway MVP are not fine for a foundation. Specifically: the schema memory data model needs to be right from day one because every future agent will read from it. The KPI catalog format needs to be right because it becomes the universal vocabulary across BGO's analytics work. The skill manifest pattern needs to be the same one Hunter Point and voice agents will use. None of this slows down the MVP — but it shifts the bar from "make it work" to "make it work in a way the next ten agents can build on."

Build it. Ship it. But ship it knowing what it is.

---

## 2. Users

| User | Primary use case |
|---|---|
| Ops team leads | Client health dashboards, WBR/QBR decks |
| Support group leads (HR, Finance, WFM) | Functional KPI reports |
| Senior leadership | Executive Scorecard |
| Central data team | KPI mapping review, output sign-off, catalog management |

---

## 3. The Agent Loop

The entire product is one loop. Every sprint decision should be evaluated against how well it serves this loop.

```
User describes need
       ↓
Agent interviews user (template, client, KPIs, data source)
       ↓
User uploads Excel (or agent pulls from Workday)
       ↓
Agent maps columns → user confirms
       ↓
Agent computes KPIs from catalog definitions
       ↓
Agent renders dashboard + generates PPTX
       ↓
Central team reviews (KPI mapping + output)
       ↓
Published to user's dashboard library
       ↓
Schema mapping saved → next run skips mapping step
```

Build this loop end-to-end before adding anything else.

---

## 4. MVP — Local Development Build

### 4.1 What the MVP is

A working version of the agent loop running on a local machine. No cloud infrastructure. No IT tickets. One dev can set it up in under an hour.

The MVP is **not** a toy — it runs against real BGO data, is used by real internal teams, and produces real dashboards. It is production-quality agent logic on development-grade infrastructure.

### 4.2 Setup — Zero to Running in Under One Hour

**Prerequisites:** Python 3.11+, Node 18+, an Anthropic API key. That's it.

```bash
# 1. Clone the repo
git clone https://github.com/bgo/report-factory
cd report-factory

# 2. Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt   # includes google-adk
cp .env.example .env              # add ANTHROPIC_API_KEY and MODEL=claude-sonnet-4-20250514
python seed_catalog.py            # loads KPI catalog into SQLite
uvicorn main:app --reload         # FastAPI on localhost:8000

# 3. ADK debug UI (optional but recommended — new terminal)
cd backend
adk web                           # agent trace viewer on localhost:8001

# 4. Frontend (new terminal)
cd frontend
npm install
npm run dev                       # runs on localhost:5173
```

Open `localhost:5173`. You should see the Report Factory app. Done.

### 4.3 MVP Tech Stack

Everything runs in a single Python process. No containers. No provisioned services.

| Layer | MVP choice | Why |
|---|---|---|
| Backend | FastAPI (Python) | One file to start, zero config |
| Database | SQLite | No setup, same SQL as PostgreSQL, swap later with one config line |
| Agent | Google ADK (local) | Runs via `pip install google-adk` — no GCP needed. Built-in session state, HITL, and local debug UI (`adk web`) |
| LLM | Claude via Anthropic API | Only external dependency |
| Frontend | React + Vite | Fast setup, same code goes to production |
| Charts | Recharts | Works in browser, no server-side rendering needed |
| PowerPoint export | python-pptx | Pure Python, no dependencies |
| Schema/vector memory | SQLite FTS5 (fuzzy search) | Good enough for MVP column mapping; swap to pgvector in production |
| File storage | Local filesystem (`/uploads`) | No S3 needed for MVP |
| Auth | None (MVP) | Add SSO in production |
| Observability | ADK local debug UI (`adk web`) | Built-in trace viewer per run — inputs, tool calls, outputs, latency. No setup. |

### 4.4 MVP Project Structure

```
report-factory/
├── backend/
│   ├── main.py                  # FastAPI app, all routes
│   ├── agent/
│   │   └── report_factory_agent/
│   │       ├── __init__.py
│   │       ├── agent.py             # Root ADK agent definition
│   │       └── tools/
│   │           ├── intake.py            # Step 1: requirements interview
│   │           ├── data_discovery.py    # Step 2: Excel parsing + column mapping
│   │           ├── standardise.py       # Step 3: KPI computation + validation
│   │           └── generate.py          # Step 4: dashboard data + PPTX
│   ├── catalog/
│   │   ├── kpis.json            # KPI catalog seed data
│   │   └── templates/           # Template schemas (one JSON per template)
│   │       ├── client_health.json
│   │       ├── wbr_qbr.json
│   │       ├── exec_scorecard.json
│   │       └── kpi_spotlight.json
│   ├── db/
│   │   ├── schema.sql           # SQLite schema
│   │   └── database.py          # DB connection + helpers
│   ├── exporters/
│   │   └── pptx_exporter.py     # python-pptx export
│   ├── seed_catalog.py          # One-time KPI catalog seeder
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Library.jsx          # Dashboard library (home)
    │   │   ├── Intake.jsx           # Agent interview chat UI
    │   │   ├── MappingConfirm.jsx   # Column mapping confirmation
    │   │   ├── Dashboard.jsx        # Interactive dashboard view
    │   │   └── ReviewQueue.jsx      # Central team review interface
    │   ├── components/
    │   │   ├── charts/              # Recharts wrappers per chart type
    │   │   └── ui/                  # Buttons, badges, modals
    │   └── App.jsx
    └── package.json
```

### 4.5 Agent Implementation — ADK (local)

ADK runs locally via `pip install google-adk`. No GCP account, no cloud setup. It provides session state management, HITL checkpoints, and a local debug UI out of the box — replacing the hand-rolled state machine and SQLite log table from a plain Python approach.

**Install:**
```bash
pip install google-adk
```

**Run the agent locally (debug UI on localhost:8000):**
```bash
adk web
```

**Run via API (for FastAPI integration):**
```bash
adk api_server   # exposes ADK as a local REST API your FastAPI backend calls
```

**Project structure change — `agent/` becomes ADK format:**

```
backend/
└── agent/
    ├── report_factory_agent/
    │   ├── __init__.py
    │   ├── agent.py          # Root agent definition
    │   └── tools/
    │       ├── intake.py         # Step 1: requirements interview tool
    │       ├── data_discovery.py # Step 2: Excel parsing + column mapping tool
    │       ├── standardise.py    # Step 3: KPI computation tool
    │       └── generate.py       # Step 4: dashboard + PPTX tool
    └── .env                  # ANTHROPIC_API_KEY + MODEL
```

**Root agent definition:**

```python
# agent/report_factory_agent/agent.py
from google.adk.agents import Agent
from .tools.intake import intake_tool
from .tools.data_discovery import data_discovery_tool
from .tools.standardise import standardise_tool
from .tools.generate import generate_tool

root_agent = Agent(
    name="report_factory_agent",
    model="claude-sonnet-4-20250514",   # ADK is model-agnostic — swap here only
    description="BGO Report Factory: interviews users, ingests Excel, computes KPIs, generates dashboards and PPTX.",
    instruction="""
    You are the BGO Report Factory assistant. Guide the user through building a report
    in four steps: intake, data discovery, KPI computation, and generation.

    Always complete steps in order. After intake is confirmed, ask the user to upload
    their Excel file. After column mapping is confirmed by the user, proceed to compute.
    Never skip the user confirmation step on column mapping.
    """,
    tools=[intake_tool, data_discovery_tool, standardise_tool, generate_tool],
)
```

**Example tool (Step 1 — intake):**

```python
# agent/report_factory_agent/tools/intake.py
import json
from google.adk.tools import FunctionTool
from db.database import get_kpi_catalog

def run_intake(template_type: str, client_id: str, period_start: str,
               period_end: str, kpi_list: list[str]) -> dict:
    """
    Validates and stores the intake specification once the user has confirmed
    all required fields: template type, client, period, and KPI list.

    Args:
        template_type: One of client_health_dashboard, wbr_qbr, exec_scorecard, kpi_spotlight
        client_id: Client identifier string
        period_start: Start date in YYYY-MM-DD format
        period_end: End date in YYYY-MM-DD format
        kpi_list: List of KPI IDs from the catalog

    Returns:
        Confirmed intake_spec dict, or error message if validation fails.
    """
    valid_templates = ["client_health_dashboard", "wbr_qbr", "exec_scorecard", "kpi_spotlight"]
    if template_type not in valid_templates:
        return {"error": f"Unknown template. Choose from: {valid_templates}"}

    catalog_ids = [k["kpi_id"] for k in get_kpi_catalog()]
    invalid_kpis = [k for k in kpi_list if k not in catalog_ids]
    if invalid_kpis:
        return {"error": f"KPI IDs not in catalog: {invalid_kpis}"}

    return {
        "status": "intake_complete",
        "intake_spec": {
            "template_type": template_type,
            "client_id": client_id,
            "period_start": period_start,
            "period_end": period_end,
            "kpi_list": kpi_list,
            "data_source": "excel_upload"
        }
    }

intake_tool = FunctionTool(run_intake)
```

The `data_discovery`, `standardise`, and `generate` tools follow the same pattern — plain Python functions wrapped with `FunctionTool`. The function logic (Pandas parsing, fuzzy matching, KPI computation, python-pptx export) is identical to before. ADK handles session state, tool routing, and the conversation loop.

**ADK handles what you'd otherwise hand-roll:**
- Session state persists across turns automatically — no manual `chat_history` threading
- HITL checkpoint: add `human_in_the_loop=True` on the mapping confirmation step
- `adk web` gives a full trace UI locally: every tool call, input, output, and latency visible per session

```python
# agent/data_discovery.py — Step 2
import pandas as pd
from difflib import SequenceMatcher

def parse_excel(file_path: str) -> dict:
    """Read Excel file, return headers and sample rows."""
    df = pd.read_excel(file_path, nrows=5)
    full_df = pd.read_excel(file_path)
    return {
        "headers": list(df.columns),
        "sample": df.head(3).to_dict(orient="records"),
        "row_count": len(full_df)
    }

def auto_map_columns(headers: list, kpi_list: list, kpi_catalog: list) -> dict:
    """
    Fuzzy-match Excel column headers to KPI source fields.
    Returns: {kpi_id: {"raw_column": str, "confidence": float, "needs_review": bool}}
    """
    mapping = {}
    relevant_kpis = [k for k in kpi_catalog if k['kpi_id'] in kpi_list]

    for kpi in relevant_kpis:
        best_match = None
        best_score = 0
        candidates = kpi.get('source_fields', []) + [kpi['numerator'], kpi['denominator']]

        for header in headers:
            for candidate in candidates:
                score = SequenceMatcher(None, header.lower(), candidate.lower()).ratio()
                if score > best_score:
                    best_score = score
                    best_match = header

        mapping[kpi['kpi_id']] = {
            "raw_column": best_match,
            "confidence": round(best_score, 2),
            "needs_review": best_score < 0.7
        }

    return mapping
```

```python
# agent/standardise.py — Step 3
import pandas as pd

def compute_kpis(file_path: str, column_mapping: dict, kpi_catalog: list, kpi_list: list) -> dict:
    """
    Apply confirmed mapping, compute KPI values, run validation.
    Returns: {kpi_id: {"value": float, "flags": list}}
    """
    df = pd.read_excel(file_path)
    kpi_defs = {k['kpi_id']: k for k in kpi_catalog if k['kpi_id'] in kpi_list}
    results = {}

    for kpi_id, kpi_def in kpi_defs.items():
        flags = []
        mapping = column_mapping.get(kpi_id, {})
        num_col = mapping.get('numerator_column')
        den_col = mapping.get('denominator_column')

        if not num_col or not den_col:
            results[kpi_id] = {"value": None, "flags": [f"Missing column mapping for {kpi_id}"]}
            continue

        numerator = df[num_col].sum()
        denominator = df[den_col].sum()

        if denominator == 0:
            results[kpi_id] = {"value": None, "flags": ["Division by zero — check denominator column"]}
            continue

        value = numerator / denominator
        expected = kpi_def.get('expected_range', {})

        if expected.get('min') is not None and value < expected['min']:
            flags.append(f"Value {value:.3f} below expected min {expected['min']}")
        if expected.get('max') is not None and value > expected['max']:
            flags.append(f"Value {value:.3f} above expected max {expected['max']}")

        results[kpi_id] = {"value": round(value, 4), "flags": flags}

    return results
```

### 4.6 MVP API Routes

```
# Report lifecycle
POST   /api/reports/                      Create request, return request_id
GET    /api/reports/{id}                  Get state + chat history
POST   /api/reports/{id}/chat             Send message to intake agent
POST   /api/reports/{id}/upload           Upload Excel file
POST   /api/reports/{id}/confirm-mapping  Confirm or override column mapping
GET    /api/reports/{id}/dashboard        Get computed KPIs + chart config JSON

# Review queue
GET    /api/review-queue                  List pending items
POST   /api/review-queue/{id}/approve     Approve (optionally with overrides)
POST   /api/review-queue/{id}/reject      Reject with comment

# KPI catalog
GET    /api/kpis                          List all KPIs
GET    /api/kpis?domain={domain}          Filter by domain

# Export
GET    /api/reports/{id}/pptx             Download generated PPTX file
```

### 4.7 SQLite Schema

```sql
-- db/schema.sql

CREATE TABLE report_requests (
    id          TEXT PRIMARY KEY,
    created_by  TEXT DEFAULT 'dev',
    template_type TEXT,
    client_id   TEXT,
    period_start TEXT,
    period_end  TEXT,
    status      TEXT DEFAULT 'intake',
    intake_spec TEXT,           -- JSON
    column_mapping TEXT,        -- JSON
    computed_kpis TEXT,         -- JSON
    data_quality_flags TEXT,    -- JSON
    chat_history TEXT,          -- JSON
    file_path   TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE kpi_catalog (
    kpi_id       TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description  TEXT,
    numerator    TEXT NOT NULL,
    denominator  TEXT NOT NULL,
    format       TEXT NOT NULL,   -- percentage | integer | currency | duration
    domain       TEXT NOT NULL,   -- collections | cx | sales | hr | finance | ops
    expected_range TEXT,          -- JSON: {"min": 0, "max": 1}
    aliases      TEXT,            -- JSON array
    source_fields TEXT,           -- JSON array
    reviewed     INTEGER DEFAULT 0
);

CREATE TABLE schema_memory (
    client_id     TEXT NOT NULL,
    template_type TEXT NOT NULL,
    mappings      TEXT NOT NULL,  -- JSON
    approved_by   TEXT,
    use_count     INTEGER DEFAULT 0,
    PRIMARY KEY (client_id, template_type)
);

CREATE TABLE review_queue (
    id          TEXT PRIMARY KEY,
    request_id  TEXT REFERENCES report_requests(id),
    status      TEXT DEFAULT 'pending',  -- pending | approved | rejected
    reviewer_notes TEXT,
    overrides   TEXT,                    -- JSON
    reviewed_at TEXT
);

CREATE TABLE agent_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  TEXT,
    step        TEXT,
    input       TEXT,
    output      TEXT,
    latency_ms  INTEGER,
    created_at  TEXT DEFAULT (datetime('now'))
);
```

### 4.8 KPI Catalog Seed

**The catalog is a strategic asset, not a config file.** Every reviewed KPI in this catalog is proprietary BGO IP — a structured definition of how BGO measures collections, CX, and operational performance. The catalog format must be stable from day one because it becomes the universal vocabulary across every future agent: Hunter Point's deal metrics, the voice collections agent's compliance signals, the Executive Scorecard's people metrics. Treat additions to the catalog the same way an engineering team treats public API changes — versioned, reviewed, intentional.

```json
[
  {
    "kpi_id": "contact_rate",
    "display_name": "Contact Rate",
    "description": "Percentage of dialled accounts where a live contact was made",
    "numerator": "live_contacts",
    "denominator": "total_dials",
    "format": "percentage",
    "domain": "collections",
    "expected_range": { "min": 0, "max": 1 },
    "aliases": ["contact rate %", "live contact rate", "LCP"],
    "source_fields": ["live_contacts", "contacts", "rpc_count", "total_contacts"]
  },
  {
    "kpi_id": "ptp_rate",
    "display_name": "PTP Rate",
    "description": "Percentage of contacts resulting in a promise to pay",
    "numerator": "ptp_count",
    "denominator": "live_contacts",
    "format": "percentage",
    "domain": "collections",
    "expected_range": { "min": 0, "max": 1 },
    "aliases": ["promise to pay %", "PTP %", "promise rate"],
    "source_fields": ["ptp_count", "ptps", "promises", "kept_arrangements"]
  },
  {
    "kpi_id": "ptp_kept_rate",
    "display_name": "PTP Kept Rate",
    "description": "Percentage of promises to pay that were honoured",
    "numerator": "ptp_kept",
    "denominator": "ptp_count",
    "format": "percentage",
    "domain": "collections",
    "expected_range": { "min": 0, "max": 1 },
    "aliases": ["kept rate", "promise kept %", "PTP kept"],
    "source_fields": ["ptp_kept", "kept_ptps", "honoured_arrangements"]
  }
]
```

Seed the remaining ~47 KPIs from existing BGO dashboards in the same format. The central data team owns this list.

### 4.9 Template Schema Format

```json
{
  "template_id": "client_health_dashboard",
  "display_name": "Client Health Dashboard",
  "description": "Weekly client-level performance dashboard for collections clients",
  "domain": "collections",
  "required_kpis": ["contact_rate", "ptp_rate", "ptp_kept_rate"],
  "optional_kpis": ["rpc_rate", "compliance_flag_rate", "aht"],
  "required_dimensions": ["date", "agent_id"],
  "optional_dimensions": ["campaign", "site"],
  "charts": [
    {
      "chart_id": "contact_rate_trend",
      "type": "line",
      "title": "Contact Rate — Weekly Trend",
      "kpi": "contact_rate",
      "x_axis": "date",
      "y_format": "percentage"
    },
    {
      "chart_id": "ptp_rate_trend",
      "type": "line",
      "title": "PTP Rate — Weekly Trend",
      "kpi": "ptp_rate",
      "x_axis": "date",
      "y_format": "percentage"
    },
    {
      "chart_id": "agent_breakdown",
      "type": "bar",
      "title": "Contact Rate by Agent",
      "kpi": "contact_rate",
      "x_axis": "agent_id",
      "y_format": "percentage"
    }
  ]
}
```

### 4.10 MVP Exit Gate

- [ ] Dev can clone repo and run the full app in under one hour with no external services
- [ ] Agent completes the full loop for at least 3 reports with real BGO Excel data
- [ ] Client Health Dashboard template renders correctly in-app
- [ ] Review queue works: approve, reject, and override KPI mappings all function
- [ ] Schema memory saves on approval and skips mapping step on second run for same client
- [ ] PPTX export produces a valid file using the BGO slide master
- [ ] ADK traces visible in `adk web` for every step with latency — enough to debug any failure

---

## 5. Report Templates

### 5.1 Client Health Dashboard
**Audience:** Ops team leads | **Cadence:** Weekly  
**Required KPIs:** Contact rate, PTP rate, PTP kept rate  
**Optional KPIs:** RPC rate, compliance flag rate, AHT  
**Data source:** Excel upload  
**Charts:** Contact rate trend, PTP rate trend, agent performance bar  
**Export:** Dashboard + PPTX  

### 5.2 WBR / QBR Report
**Audience:** Client stakeholders, ops leadership | **Cadence:** Weekly / Quarterly  
**Required KPIs:** All Client Health KPIs + SLA attainment  
**Optional KPIs:** Headcount, attrition, CSAT  
**Data source:** Excel upload  
**Charts:** Summary scorecard tiles, trend charts, wins/risks section  
**Export:** Dashboard + PPTX (primary output)  

### 5.3 Executive Scorecard
**Audience:** C-suite, VPs | **Cadence:** Monthly  
**Required KPIs:** Headcount by site, attrition rate, paid vs. productive hours, utilisation  
**Data source:** Excel export from Workday (MVP interim); Workday API direct (production)  
**Charts:** KPI tiles with MoM delta, site-level bar breakdown  
**Export:** Dashboard + PPTX  

### 5.4 KPI Spotlight
**Audience:** Any team lead | **Cadence:** Ad hoc  
**KPIs:** Single metric, user selects from catalog  
**Data source:** Excel upload  
**Charts:** Trend line, breakdown by one configurable dimension  
**Export:** Dashboard only  

---

## 6. Agent Steps

### Step 1 — Intake
Multi-turn Claude conversation. Template loaded into system context once selected. Conversation ends when agent emits `<intake_complete>` block with all required fields. Full `chat_history` passed on every API call — no server-side session required.

### Step 2 — Data Discovery
Pandas reads headers and 5 sample rows from uploaded Excel. Fuzzy match (SequenceMatcher) against KPI `source_fields` from catalog. Confidence score per mapping. Anything below 0.7 flagged for user confirmation. User reviews mapping table before Step 3 runs. This is the only mandatory HITL gate.

### Step 3 — Standardise & Compute
Apply confirmed mapping. Compute each KPI (numerator ÷ denominator). Run range validation from catalog `expected_range`. Flag anomalies — flags are non-blocking, surfaced in review queue. Write to `computed_kpis` on the request record. Log step to `agent_log`.

### Step 4 — Generate
Build chart-ready JSON from `computed_kpis` and template chart config. Generate PPTX using python-pptx against BGO slide master. Write review queue entry. Notify reviewer. Request status → `review`.

---

## 7. Review Queue

**Reviewer sees per entry:**
- Template, client, period, requested by, timestamp
- KPI mapping table: raw column → KPI → computed value → confidence → flags
- Dashboard preview (read-only Recharts render)
- PPTX download link

**Reviewer actions:**
- **Approve** — publishes dashboard, saves schema mapping to `schema_memory`
- **Approve with edits** — override specific KPI values before publishing
- **Reject with comment** — returns to requester with explanation
- **Add to catalog** — formalises a new KPI (sets `reviewed = 1`)

### 7.1 Auto-Approval Path (Phase 1.5 — design now, ship after MVP)

Every report routing through human review is correct for the MVP — it builds reviewer confidence and seeds the schema memory. After 50+ approved runs of the same client + template combination, mandatory review becomes friction, not safety.

The auto-approval path skips human review when **all** of the following are true on a given run:

- Schema mapping for `(client_id, template_type)` exists in `schema_memory` and was approved by a human
- Excel headers on the new file match the stored mapping exactly — no new columns, no missing required columns
- All computed KPI values fall within the catalog `expected_range`
- No data quality flags raised in Step 3
- The template type and KPI list are unchanged from the stored mapping's last approved run

If any condition fails, the run routes to the review queue normally. Auto-approved runs are still logged in Langfuse and surface in the reviewer's dashboard as "auto-approved" with one-click revoke if something looks wrong.

The data model already supports this — the schema_memory `use_count` field tracks usage, and the validation logic in Step 3 already produces the flags needed for the gate. This subsection specifies the criteria now so the MVP build does not paint itself into a corner that has to be unwound later.

---

## 8. Frontend Screens

**Library** — Grid of user's reports. Status badge per card. Filter by template and client. "New Report" button.

**Intake Chat** — Conversational UI. Progress stepper at top (Intake → Mapping → Computing → Review → Done). Inline KPI checklist when agent asks about metrics. File upload dropzone when agent asks for data.

**Mapping Confirmation** — Table: raw column | matched KPI | confidence score | override dropdown. Red highlight for anything below 0.7 or missing. "Confirm" proceeds to Step 3.

**Dashboard View** — Full-page Recharts render. Template-driven layout. Filter bar (date, agent, site — template-dependent). Data quality flags as inline yellow warnings. "Export PPTX" button.

**Review Queue** — Central team only. List of pending items. Click to open detail: mapping summary + flags + dashboard preview + PPTX link. Approve / Approve with edits / Reject.

---

## 9. Sprint Plan

### Week 1 — Backend + agent Steps 1 and 2
- FastAPI app with SQLite schema
- KPI catalog seeded (~50 KPIs from existing BGO dashboards)
- 4 template JSON files
- Step 1: Claude intake conversation, `<intake_complete>` parsing
- Step 2: Excel upload, Pandas parsing, fuzzy column mapping

**Checkpoint:** Run a full intake in Postman. Upload Excel and see a column mapping draft returned.

### Week 2 — Steps 3 and 4 + review queue
- Step 3: KPI computation + validation
- Step 4: Chart JSON, PPTX export against BGO slide master
- Review queue endpoints: list, approve, reject
- Schema memory: save on approve, load on next run
- ADK traces visible in `adk web` for every step

**Checkpoint:** Full loop via API. Postman can intake → upload → confirm mapping → get chart JSON → download PPTX → approve in review queue.

### Week 3 — Frontend + pilot
- React app: all 5 screens built and connected
- End-to-end flow in browser
- 3 real reports run with internal BGO data
- Review queue exercised by central data team
- Bugs fixed, MVP exit gate assessed

**Checkpoint:** Demo to leadership. MVP exit gate criteria signed off.

---

## 10. Moving to Production

Once MVP exit gate is passed, the production migration is a configuration swap — not a rewrite. Agent logic, templates, KPI catalog, and frontend are identical. Only infrastructure changes.

| Component | MVP | Production |
|---|---|---|
| Database | SQLite | PostgreSQL on AWS RDS |
| File storage | Local `/uploads` | AWS S3 |
| Agent runtime | ADK local (`adk web` / `adk api_server`) | ADK on AWS ECS (Fargate) — same code, different deployment target |
| Observability | ADK local debug UI | Langfuse self-hosted (swap `adk web` for Langfuse trace exporter — one config line) |
| Column matching | SQLite FTS5 | pgvector semantic search |
| Auth | None | BGO SSO (SAML/OAuth2) |
| Workday | Excel export interim | Airbyte connector |
| Secrets | `.env` file | AWS Secrets Manager |
| CI/CD | Manual | GitHub Actions → ECS |

**Migration order:**
1. SQLite → PostgreSQL: change `DATABASE_URL`. SQLAlchemy handles the rest.
2. Local storage → S3: update `save_file()` and `get_file()` helpers only.
3. Deploy ADK to ECS: the agent code is unchanged — point the ADK deployment config at ECS instead of `adk api_server` local. Same tools, same logic.
4. Add Langfuse: replace `agent_log` writes with Langfuse trace calls.
5. Add SSO: FastAPI middleware + provider config.

Each swap is independent. Do them in order. Test after each one.

### 10.1 Platform Reusability Check — validate before locking

The platform abstractions in this MVP — ADK skill manifest format, connector pattern, review queue, Langfuse observability, schema memory data model — will be reused by every agent that follows. Before the MVP locks (end of Sprint 3), validate the abstractions against the next two known use cases:

**Hunter Point Capital (next external deployment).** The workflow is: download files from SharePoint and email → run a script to standardise data and validate Excel formulas → compare to last month's report → upload to DealCloud via API. Walk through this workflow using the Report Factory's components on paper. The ADK skill manifest format should describe the workflow without modification. The connector pattern should accommodate SharePoint and DealCloud as new connectors without changing the base interface. The review queue should handle "validation passed, ready to upload" as a state. If any of these require platform changes, make them now — not after the MVP ships.

**Voice collections agent (next internal initiative).** The workflow is: real-time conversation with a debtor, FDCPA-compliant scripting, intent detection, payment capture, post-call summary. Walk through this on paper as well. The ADK skill manifest should support voice tools (Deepgram, ElevenLabs) the same way it supports text tools. The Langfuse observability should capture conversation turns with the same structure as agent steps. The compliance guardrails need to be expressible at the platform level, not buried inside the skill — this is the one area most likely to surface a gap.

**If both walkthroughs pass without abstraction changes, the platform foundation is ready.** If either surfaces a gap, fix it before the MVP exit gate. The cost of changing these abstractions later — once five agents inherit from them — is significantly higher than the cost of fixing them now.

---

## 11. Open Questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| 1 | Can we get the BGO PowerPoint slide master as a `.pptx` file? | Marketing / Data team | Week 1 |
| 2 | Who on the central data team is the Phase 1 pilot reviewer? | Data team lead | Week 2 |
| 3 | Which ~50 KPIs seed the catalog? Can existing Power BI / Excel files be used as reference? | Data team | Week 1 |
| 4 | Anthropic API key — shared team account or individual dev keys for MVP? | Platform lead | Day 1 |
| 5 | `client_id` naming convention — needs to be consistent for schema memory keys | Data team | Week 1 |
| 6 | Executive Scorecard: can Workday data be exported to Excel for MVP, or is API access needed from day one? | Workday admin | Week 2 |
| 7 | What naming conventions does Hunter Point's data use (deal IDs, PortCo identifiers, financial metrics)? Is the schema different enough from BGO's internal data to require platform-level changes to the skill manifest format? | Hunter Point lead + Platform | Sprint 3 |

---

## 12. What This Is Not

- **Not Power BI** — dashboards live in this app
- **Not a free-form query tool** — structured templates only in Phase 1
- **Not multi-source** — one Excel file per report in MVP
- **Not client-facing** — internal BGO users only in Phase 1
- **Not always-on** — user-triggered only; no scheduled runs in MVP
- **Not Hunter Point** — separate deployment on same platform, after MVP exit gate

---

## 13. Future Phases

**Phase 2 — Production infrastructure + expanded connectors**  
Migrate to AWS stack per Section 10. Workday API direct. TCM telephony connector. CRM connector. Natural language dashboard queries (Vanna 2.0). Scheduled proactive report generation.

**Phase 3 — External deployment**  
Hunter Point Capital: SharePoint → validate → DealCloud agentic workflow. Client-facing self-serve portal. Report Factory as billable BGO IP product.