# Project Plan: BGO Report Factory

## Strategic Context

This is the first surface of the BGO AI Platform. The KPI catalog, schema memory data model, and ADK skill manifest pattern built here become the foundation every subsequent agent inherits — Hunter Point Capital's deal workflow, the voice collections agent, internal ops automation. Treat the catalog format and schema memory schema as public API: versioned, reviewed, intentional. Getting these right in the MVP costs nothing extra. Unwinding them after five agents inherit from them is expensive.

---

## Resolved Stack

| Layer | MVP | Production |
|---|---|---|
| Backend | FastAPI (Python) | Same |
| Database | SQLite | PostgreSQL on AWS RDS — change one `DATABASE_URL` line |
| Agent | Google ADK local (`pip install google-adk`) | ADK on AWS ECS Fargate — same code, different deployment target |
| LLM | Claude via Anthropic API (`claude-sonnet-4-20250514`) | Same |
| Observability | `adk web` local trace UI (built-in, zero setup) | Langfuse self-hosted — one config line swap |
| Frontend | React + Vite (port 5173) | Same |
| Charts | Recharts | Same |
| Export | python-pptx against BGO slide master | Same |
| Column matching | `difflib.SequenceMatcher` fuzzy match | pgvector semantic search |
| File storage | Local `/uploads` | AWS S3 — swap `save_file()` / `get_file()` helpers only |
| Auth | None | BGO SSO (SAML/OAuth2) |
| Secrets | `.env` file | AWS Secrets Manager |

---

## Project Structure

```
report-automation/
├── backend/
│   ├── main.py                        # FastAPI app, all routes
│   ├── agent/
│   │   └── report_factory_agent/
│   │       ├── __init__.py
│   │       ├── agent.py               # Root ADK agent definition
│   │       └── tools/
│   │           ├── intake.py          # Step 1: template + KPI selection
│   │           ├── data_discovery.py  # Step 2: Excel parsing + fuzzy mapping
│   │           ├── standardise.py     # Step 3: KPI computation + validation
│   │           └── generate.py        # Step 4: chart JSON + PPTX
│   ├── catalog/
│   │   ├── kpis.json                  # ~50 KPI definitions (BGO IP)
│   │   └── templates/
│   │       ├── client_health.json
│   │       ├── wbr_qbr.json
│   │       ├── exec_scorecard.json
│   │       └── kpi_spotlight.json
│   ├── db/
│   │   ├── schema.sql                 # SQLite schema (source of truth)
│   │   └── database.py                # DB connection + helpers
│   ├── exporters/
│   │   └── pptx_exporter.py           # python-pptx against BGO slide master
│   ├── seed_catalog.py                # One-time: loads kpis.json into kpi_catalog table
│   ├── requirements.txt
│   └── .env.example
└── frontend/                          # React + Vite app (port 5173)
    ├── src/
    │   ├── pages/
    │   │   ├── Library.jsx            # Dashboard library (home)
    │   │   ├── Intake.jsx             # Agent chat UI
    │   │   ├── MappingConfirm.jsx     # Column mapping confirmation
    │   │   ├── Dashboard.jsx          # Interactive dashboard view
    │   │   └── ReviewQueue.jsx        # Central team review interface
    │   ├── components/
    │   │   ├── charts/                # Recharts wrappers
    │   │   └── ui/                    # Buttons, badges, modals
    │   └── App.jsx
    └── package.json
```

---

## SQLite Schema

4 tables. JSON stored as TEXT blobs. No ORM — raw SQL via `db/database.py`.

```sql
CREATE TABLE report_requests (
    id            TEXT PRIMARY KEY,       -- UUID
    created_by    TEXT DEFAULT 'dev',
    template_type TEXT,
    client_id     TEXT,
    period_start  TEXT,
    period_end    TEXT,
    status        TEXT DEFAULT 'intake',  -- intake | mapping | computing | review | published
    intake_spec   TEXT,                   -- JSON
    column_mapping TEXT,                  -- JSON
    computed_kpis TEXT,                   -- JSON
    data_quality_flags TEXT,              -- JSON
    chat_history  TEXT,                   -- JSON
    file_path     TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE kpi_catalog (
    kpi_id        TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    description   TEXT,
    numerator     TEXT NOT NULL,
    denominator   TEXT NOT NULL,
    format        TEXT NOT NULL,          -- percentage | integer | currency | duration
    domain        TEXT NOT NULL,          -- collections | cx | sales | hr | finance | ops
    expected_range TEXT,                  -- JSON: {"min": 0, "max": 1}
    aliases       TEXT,                   -- JSON array
    source_fields TEXT,                   -- JSON array
    reviewed      INTEGER DEFAULT 0
);

CREATE TABLE schema_memory (
    client_id     TEXT NOT NULL,
    template_type TEXT NOT NULL,
    mappings      TEXT NOT NULL,          -- JSON
    approved_by   TEXT,
    use_count     INTEGER DEFAULT 0,
    PRIMARY KEY (client_id, template_type)
);

CREATE TABLE review_queue (
    id            TEXT PRIMARY KEY,
    request_id    TEXT REFERENCES report_requests(id),
    status        TEXT DEFAULT 'pending', -- pending | approved | approved_with_edits | rejected
    reviewer_notes TEXT,
    overrides     TEXT,                   -- JSON
    reviewed_at   TEXT
);
```

---

## API Routes

```
# Report lifecycle
POST   /api/reports/                    Create request, return request_id
GET    /api/reports/{id}                Get state + chat history
POST   /api/reports/{id}/chat           Send message to intake agent
POST   /api/reports/{id}/upload         Upload Excel file
POST   /api/reports/{id}/confirm-mapping  Confirm or override column mapping
GET    /api/reports/{id}/dashboard      Get computed KPIs + chart config JSON

# Review queue
GET    /api/review-queue                List pending items
POST   /api/review-queue/{id}/approve   Approve (optionally with overrides)
POST   /api/review-queue/{id}/reject    Reject with comment

# KPI catalog
GET    /api/kpis                        List all KPIs
GET    /api/kpis?domain={domain}        Filter by domain

# Export
GET    /api/reports/{id}/pptx           Download generated PPTX
```

---

## Week 1 — Backend + Agent Steps 1 & 2

**Checkpoint:** Full intake conversation in Postman → upload Excel → column mapping draft returned.

### Infrastructure & Schema
- [~] FastAPI app running — **exists, but built on old 7-table Alembic schema; replace with `db/schema.sql` + raw SQLite via `db/database.py`**
- [x] SQLite database (switched from MySQL)
- [x] Local file storage (`/uploads` fallback in `services/storage.py`)
- [ ] Drop Alembic; replace with `db/schema.sql` applied on startup via `database.py`
- [ ] `seed_catalog.py` — loads `catalog/kpis.json` into `kpi_catalog` table on first run

### KPI Catalog (BGO IP — get right from day one)
- [ ] `catalog/kpis.json` — seed with ~50 BGO KPIs (collections, CX, HR, finance, ops)
  - 3 starter KPIs already defined in PRD3: `contact_rate`, `ptp_rate`, `ptp_kept_rate`
  - Remaining ~47 to be sourced from central data team's existing Power BI / Excel reports
- [ ] Catalog format locked: `kpi_id`, `display_name`, `numerator`, `denominator`, `format`, `domain`, `expected_range`, `aliases`, `source_fields`, `reviewed`
- [ ] `GET /api/kpis` and `GET /api/kpis?domain=` endpoints

### Template JSON Files
- [ ] `catalog/templates/client_health.json` — required/optional KPIs, required dimensions, chart configs
- [ ] `catalog/templates/wbr_qbr.json`
- [ ] `catalog/templates/exec_scorecard.json`
- [ ] `catalog/templates/kpi_spotlight.json`

### ADK Agent — Setup
- [ ] `pip install google-adk` added to `requirements.txt`
- [ ] `agent/report_factory_agent/agent.py` — root ADK agent definition with Claude as model, 4 `FunctionTool` tools registered
- [ ] `adk web` verified working locally (trace UI at localhost:8001)
- [ ] `adk api_server` integrated with FastAPI — `POST /api/reports/{id}/chat` proxies to ADK

### Agent Step 1 — Intake (`tools/intake.py`)
- [~] Claude conversation loop exists (`services/ai_interview.py`) — **needs to be replaced with ADK `FunctionTool` pattern; template-driven instead of free-form**
- [ ] `run_intake(template_type, client_id, period_start, period_end, kpi_list)` → validates inputs against catalog, returns `intake_spec`
- [ ] Template selected → load template JSON schema into agent context
- [ ] KPI list validated against `kpi_catalog` (only `reviewed=1` KPIs used in auto-mapping)
- [ ] `intake_spec` written to `report_requests` record; status → `mapping`

### Agent Step 2 — Data Discovery (`tools/data_discovery.py`)
- [~] Excel parsing via pandas exists (`services/parser.py`) — **keep logic, restructure as ADK tool**
- [~] Column type detection exists (`services/profiler.py`) — **repurpose: fuzzy-match headers against `source_fields` and `aliases` from catalog, not general profiling**
- [ ] `parse_excel(file_path)` → headers + 5 sample rows + row count
- [ ] `auto_map_columns(headers, kpi_list, kpi_catalog)` → `{kpi_id: {raw_column, confidence, needs_review}}` using `difflib.SequenceMatcher`; anything below 0.7 flagged
- [ ] `column_mapping` draft written to `report_requests`; status → `mapping`
- [ ] `POST /api/reports/{id}/upload` — saves file to `/uploads/{request_id}/`, triggers Step 2

---

## Week 2 — Steps 3 & 4 + Review Queue + Schema Memory

**Checkpoint:** Full loop via API only — intake → upload → confirm mapping → chart JSON → PPTX download → approve in review queue.

### Agent Step 3 — Standardise & Compute (`tools/standardise.py`)
- [~] KPI formula evaluation exists (`services/kpi_engine.py`) — **replace free-form `asteval` with catalog-driven numerator ÷ denominator**
- [ ] `POST /api/reports/{id}/confirm-mapping` — accepts user overrides, triggers Step 3
- [ ] `compute_kpis(file_path, column_mapping, kpi_catalog, kpi_list)` → `{kpi_id: {value, flags}}`
- [ ] Range validation against `expected_range` from catalog — flags are non-blocking
- [ ] Division-by-zero guard
- [ ] `computed_kpis` + `data_quality_flags` written to `report_requests`; status → `computing` → `review`
- [ ] ADK traces visible in `adk web` for this step (inputs, outputs, latency)

### Agent Step 4 — Generate (`tools/generate.py`)
- [ ] Build chart-ready JSON from `computed_kpis` + template `charts` config
- [ ] `GET /api/reports/{id}/dashboard` — returns chart JSON for frontend
- [ ] PPTX export (`exporters/pptx_exporter.py`) — python-pptx against BGO slide master
- [ ] `GET /api/reports/{id}/pptx` — triggers export, streams file
- [ ] Review queue entry written; status → `review`

### Review Queue
- [~] Basic approve/reject endpoints exist (`api/routes/interview.py`) — **rebuild under new schema; add approve-with-edits and KPI value overrides**
- [ ] `GET /api/review-queue` — list pending items with template, client, period, flags summary
- [ ] `POST /api/review-queue/{id}/approve` — publishes dashboard, saves mapping to `schema_memory`, increments `use_count`
- [ ] `POST /api/review-queue/{id}/approve` with `overrides` body — override specific KPI values before publishing
- [ ] `POST /api/review-queue/{id}/reject` — reject with comment; status → `rejected`

### Schema Memory
- [ ] On approve: write `(client_id, template_type, mappings)` to `schema_memory`
- [ ] On Step 2 start: check `schema_memory` for `(client_id, template_type)` — if found, pre-fill mapping and skip fuzzy match; present stored mapping for one-click confirm
- [ ] `use_count` incremented on each recall
- [ ] Auto-approval path (Phase 1.5): design constraint — schema_memory structure must support it from day one (conditions: stored mapping exists + headers match exactly + all KPIs in range + no flags). Do not build the auto-approval gate yet; do not break the path to it.

---

## Week 3 — Frontend + Pilot

**Checkpoint:** Demo to leadership. MVP exit gate signed off.

### Frontend Migration
- [~] Upload + profiling UI exists in Next.js — **migrate to React + Vite; keep upload/profile components, connect to new API routes**
- [~] Interview chat UI exists in Next.js — **migrate; reconnect to ADK-backed `/api/reports/{id}/chat`**
- [ ] Scaffold React + Vite app (`npm create vite@latest frontend -- --template react`)
- [ ] React Router for client-side routing

### Screen: Library (`pages/Library.jsx`)
- [ ] Grid of user's `report_requests` — card per report showing template, client, period, status badge
- [ ] Status badges: Intake / Mapping / Computing / Review / Published
- [ ] Filter by template type and client
- [ ] "New Report" button → `/intake`

### Screen: Intake Chat (`pages/Intake.jsx`)
- [~] Chat UI exists (Next.js) — **migrate; wire to `POST /api/reports/{id}/chat`**
- [ ] Progress stepper: Intake → Mapping → Computing → Review → Done
- [ ] Inline KPI checklist when agent asks about metrics (loaded from `GET /api/kpis`)
- [ ] File upload dropzone appears when agent asks for data source
- [ ] On intake complete: redirect to `/mapping/{id}`

### Screen: Mapping Confirmation (`pages/MappingConfirm.jsx`)
- [~] Column table exists (Next.js `ColumnTable.tsx`) — **migrate; replace profile-based display with KPI mapping display**
- [ ] Table: raw column | matched KPI | confidence score | override dropdown
- [ ] Red highlight for confidence < 0.7 or missing required KPI
- [ ] "Confirm mapping" → `POST /api/reports/{id}/confirm-mapping` → triggers Step 3

### Screen: Dashboard View (`pages/Dashboard.jsx`)
- [ ] Full-page Recharts render driven by `GET /api/reports/{id}/dashboard` chart JSON
- [ ] Template-driven layout (line charts for trends, bar for breakdowns, KPI tiles)
- [ ] Filter bar: date range, agent, site (template-dependent)
- [ ] Data quality flags shown as inline yellow warnings
- [ ] "Export PPTX" button → `GET /api/reports/{id}/pptx`

### Screen: Review Queue (`pages/ReviewQueue.jsx`)
- [ ] List view: pending items with template, client, period, requester, timestamp
- [ ] Detail view: KPI mapping table (raw column → KPI → value → confidence → flags), dashboard preview, PPTX link
- [ ] Approve / Approve with edits (override KPI values inline) / Reject with comment

### Pilot (3 real reports)
- [ ] 3 reports across at least 2 internal teams using real BGO Excel data
- [ ] Review queue exercised by central data team reviewer
- [ ] Schema memory tested: second run for same client + template skips mapping step
- [ ] Before/after time noted (vs. current ticket queue)

---

## Platform Reusability Gate (end of Week 3 — before MVP locks)

Walk through these two use cases on paper against the ADK skill manifest format and connector pattern. If either surfaces a gap, fix before the MVP exit gate.

**Hunter Point Capital:** Files from SharePoint + email → standardise → validate Excel formulas → compare to prior month → upload to DealCloud via API. Questions: does the ADK `FunctionTool` pattern describe this workflow without modification? Can SharePoint and DealCloud be added as connectors without changing the base interface? Does "validation passed, ready to upload" fit the review queue state model?

**Voice collections agent:** Real-time debtor conversation, FDCPA-compliant scripting, intent detection, payment capture, post-call summary. Questions: does the skill manifest support voice tools (Deepgram, ElevenLabs) the same way it supports text tools? Are compliance guardrails expressible at the platform level, not buried in the skill?

---

## MVP Exit Gate

- [ ] Dev can clone repo and run the full app in under one hour with no external services
- [ ] Agent completes the full loop for at least 3 reports with real BGO Excel data
- [ ] Client Health Dashboard template renders correctly in-app
- [ ] Review queue works: approve, reject, and approve-with-edits all function
- [ ] Schema memory saves on approval and skips mapping step on second run for same client
- [ ] PPTX export produces a valid file using the BGO slide master
- [ ] ADK traces visible in `adk web` for every step with latency — enough to debug any failure
- [ ] Platform reusability gate passed (Hunter Point + voice agent walkthroughs)

---

## Production Migration (after MVP exit gate)

Same code. Infrastructure swap only. Do in order; test after each step.

1. **SQLite → PostgreSQL:** change `DATABASE_URL`. SQLAlchemy (or raw psycopg2) handles the rest.
2. **Local storage → S3:** update `save_file()` and `get_file()` in storage helpers only.
3. **ADK local → ADK on ECS:** point ADK deployment config at ECS Fargate instead of `adk api_server` local. Agent code unchanged.
4. **Langfuse:** replace `adk web` with Langfuse trace exporter — one config line. Reviewer approve/reject feeds Langfuse eval dataset.
5. **SSO:** add FastAPI middleware + BGO SSO provider config.

---

## Open Questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| 1 | Can we get the BGO PowerPoint slide master as a `.pptx` file? | Marketing / Data team | Week 1 |
| 2 | Who on the central data team is the Phase 1 pilot reviewer? | Data team lead | Week 2 |
| 3 | Which ~50 KPIs seed the catalog? Can existing Power BI / Excel files be used as reference? | Data team | Week 1 |
| 4 | Anthropic API key — shared team account or individual dev keys for MVP? | Platform lead | Day 1 |
| 5 | `client_id` naming convention — must be consistent for schema memory keys | Data team | Week 1 |
| 6 | Executive Scorecard: can Workday data be exported to Excel for MVP, or is API access needed from day one? | Workday admin | Week 2 |
| 7 | Hunter Point data schema — deal IDs, PortCo identifiers, financial metrics — different enough to require platform-level changes to the skill manifest format? | Hunter Point lead + Platform | Sprint 3 |
