# BGO Report Factory — Product Requirements Document

**Version:** 3.1  
**Owner:** Data & AI Platform  
**Last updated:** June 2026  
**Philosophy:** MVP is live. Prove the loop with real clients. Harden and scale next.

---

## Quick Reference

| | Current State | Next Phase |
|---|---|---|
| **Status** | Multi-file pipeline end-to-end complete + ADK agent interview live | Production hardening + PostgreSQL |
| **Infrastructure** | Railway (FastAPI + Next.js + SQLite) | PostgreSQL + S3 on Railway |
| **Who uses it** | Internal BGO ops users | Same + SSO onboarding |
| **Setup** | `uvicorn main:app` + `npm run dev` | No change |
| **Pipeline** | 9-step multi-file flow + AI-guided (ADK) shortcut | Same + scheduled refresh |

---

## 1. Problem Statement

BGO's central data team is the single bottleneck for all operational reporting. Every client health dashboard, WBR/QBR deck, and KPI report is built manually — one client at a time. The result is a 3–4 month queue per dashboard type, 40+ clients waiting, and a skilled team spending most of its time on repeatable data plumbing rather than analysis.

**The goal:** A self-serve web app where any BGO user uploads their data and gets a live interactive dashboard and/or PowerPoint deck — without raising a ticket. The central team shifts from builders to reviewers.

**Where we are today:** The core loop is working and extended. A user can upload up to 10 CSV/Excel files simultaneously, watch the AI profile and relate them, then choose between two interview paths:

- **Flow 1 (step-by-step):** Answer 5–6 structured questions, select KPIs, choose dimensions, generate dashboard — approximately 10 minutes.
- **ADK Agent (AI-guided):** A conversational AI agent handles the entire flow — data discovery, interview, KPI selection, dimension selection, and dashboard generation — all in one chat session. The dashboard is generated without leaving the interview page.

The Virtual Dimension builder handles the common case where no Roster/dimension file was uploaded — extracting shared agent attributes from fact tables automatically.

---

## 1.5 Strategic Context — What This Actually Is

This product is described as a reporting tool. It is more than that.

**This is the first surface of the BGO AI Platform.** Every component built here — the KPI catalog, the schema memory pattern, the review queue, the multi-file join logic, the observability layer — becomes foundation that subsequent agents inherit from. The KPI catalog is the compounding moat: every reviewed KPI is proprietary BGO IP that maps directly to BGO's domain expertise in collections, CX, and ops.

**Discipline implications for the build team.** The schema memory data model, the KPI catalog format, and the cardinality-based dimension inference algorithm must remain stable — every future agent reads from them. The anti-hardcoding principle (cardinality-based join keys, no column name assumptions) is not optional — it is what makes the tool work for any client's file format.

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

## 3. The 9-Step Pipeline

The entire product is one pipeline. Every decision should serve the end-to-end flow.

```
1. Multi-File Upload         Upload 1–10 CSV/Excel files simultaneously
         ↓
2. Deep Profiling            Auto-detect column types, grain, semantic tags per file
         ↓
3. Schema Mapping            User confirms types, overrides table classification (fact/dimension)
                             Build Virtual Dimension if no Roster file uploaded
                             Confirm cross-file relationships (saved to sessionStorage; UI shows
                             green "confirmed" banner — does not mutate the displayed list)
         ↓
4. Relationship Detection    AI infers FK, same-dimension, shared-key links across files
         ↓
5. AI Interview (optional)   Two modes — Flow 1 step-by-step OR ADK agent (full chat flow)
         ↓
6. KPI Selection             AI suggests formulas from columns; user selects and orders
                             (bypassed when ADK agent handles the full session)
         ↓
7. Dimension Selection       User picks which categorical columns drive breakdown charts
                             (bypassed when ADK agent handles the full session)
         ↓
8. Data Validation           Pre-flight: null %, division-risk, grain duplicate checks
         ↓
9. Dashboard Generation      Story sections (AI-grouped KPIs) + filter bar + export
```

Interview (Step 5) is optional — users may skip to KPI selection directly. When the ADK agent is enabled, steps 6 and 7 happen inside the chat conversation; the wizard pages are bypassed.

---

## 4. Current Implementation

### 4.1 Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4 | Port 3000 |
| Backend | FastAPI 0.136, Python | Port 8000 |
| Agent framework | Google ADK 2.1.0 + LiteLLM 1.85 | Python-only; LiteLLM routes all LLM calls |
| ORM / migrations | SQLAlchemy 2.0 + Alembic | |
| Database | SQLite (dev) → PostgreSQL (prod) | `DATABASE_URL` in `.env` |
| File storage | Local `backend/local_uploads/` (dev) | S3 via boto3 (prod) |
| AI — default | OpenAI `gpt-4o-mini` | `LLM_PROVIDER=openai`; override via `OPENAI_MODEL` |
| AI — alternate | Anthropic `claude-sonnet-4-20250514` | `LLM_PROVIDER=anthropic` |
| AI — azure | Azure OpenAI | `LLM_PROVIDER=azure` |
| Charts | Recharts 3.8 | |
| Markdown rendering | react-markdown | Interview chat — renders ADK agent responses |
| Export | openpyxl 3.1 (Excel) + python-pptx 1.0 (PPTX) | |
| Deployment | Railway | |

All AI calls are routed through `backend/services/ai_client.py`. Every call is logged to `llm_call_logs` via `services/observability.py`. Switch provider via `.env` only — no code changes required.

### 4.2 Setup

```bash
# Prerequisites: Python 3.11+, Node 18+, OpenAI API key (or Anthropic/Azure)

# Backend
cd backend
python -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # set LLM_PROVIDER, API key, OPENAI_MODEL=gpt-4o-mini
uvicorn main:app --reload   # port 8000

# Frontend
cd frontend
npm install
npm run dev   # port 3000
```

Open `localhost:3000`. Upload files at `/upload`. Done.

**ADK agent (optional):** Set `ADK_ENABLED=true`, `ADK_PROVIDER=openai`, `ADK_MODEL=gpt-4o-mini` in `.env`. When enabled, the session interview uses the AI agent to complete the entire flow in chat. Disable to revert to the Flow 1 step-by-step interview.

### 4.3 Project Structure

```
report-factory/
├── backend/
│   ├── main.py                           FastAPI app entry point; imports all models for create_all
│   ├── agent/report_factory_agent/       ADK agent (9 tools; enabled via ADK_ENABLED=true)
│   │   ├── agent.py                      root_agent; plain-language instructions (no markdown headers)
│   │   └── tools/
│   │       ├── intake.py                 run_intake() — legacy single-file
│   │       ├── define_kpi.py             run_define_new_kpi() — custom KPI creation
│   │       ├── data_discovery.py         run_data_discovery() — file-path discovery
│   │       ├── data_discovery_from_upload.py  run_data_discovery_from_upload() — staging profile bridge
│   │       ├── standardise.py            run_standardise() — legacy single-file
│   │       ├── generate.py               run_generate() — legacy single-file
│   │       ├── session_kpi_suggest.py    run_session_kpi_suggest() — multi-file KPI suggestions
│   │       ├── session_dimensions.py     run_session_dimensions() — multi-file dimension list
│   │       └── session_generate.py       run_session_generate() — multi-file dashboard generation
│   ├── api/routes/                       upload, session, interview, kpis, reports,
│   │                                     dashboard, templates, log
│   ├── catalog/
│   │   ├── kpis.json                     87 KPI definitions
│   │   └── templates/                    4 chart templates
│   ├── core/                             config.py, database.py
│   ├── models/
│   │   ├── dataset.py                    Dataset — batch upload session
│   │   ├── upload.py                     Upload — one file per row
│   │   ├── staging_table.py              StagingTable — profile JSON + physical table name
│   │   ├── report_recipe.py              ReportRecipe — generated recipe config
│   │   ├── kpi_definition.py             KpiDefinition — per-recipe KPI rows
│   │   ├── dashboard_config.py           DashboardConfig — mutable overlay on recipe
│   │   ├── processed_table.py            ProcessedTable — legacy post-compute results
│   │   ├── custom_kpi_proposal.py        CustomKpiProposal — AI KPIs pending approval
│   │   ├── report_template.py            ReportTemplate — saved template + column fingerprints
│   │   ├── llm_call_log.py               LlmCallLog — per-call LLM audit log (prompt hashed)
│   │   └── agent_trace_event.py          AgentTraceEvent — per-step ADK pipeline trace
│   ├── services/
│   │   ├── ai_client.py                  LLM provider abstraction; logs every call via observability
│   │   ├── observability.py              log_llm_call() + create_trace_event(); fire-and-forget
│   │   ├── ai_interview.py               Flow 1 hybrid interview
│   │   ├── adk_runner.py                 ADK Runner + InMemorySessionService wrapper
│   │   ├── profiler.py                   Column type detection, grain_score, _is_metric_name() fix
│   │   ├── schema_relationships.py       Cross-file FK/join inference
│   │   ├── kpi_suggester.py              AI-first KPI identification + catalog fallback
│   │   ├── virtual_dimension.py          Synthetic dimension from shared fact columns
│   │   ├── compute.py                    Formula execution, cross-file JOINs, DF cache
│   │   ├── data_validator.py             Pre-dashboard data quality checks
│   │   ├── session_generator.py          Multi-file story-driven recipe generation
│   │   ├── parser.py                     CSV + Excel ingestion
│   │   ├── storage.py                    Local/S3 abstraction
│   │   └── recipe_generator.py           LEGACY — single-file only
│   ├── tests/                            58 tests (all passing)
│   ├── exporters/pptx_exporter.py
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── upload/page.tsx               Multi-file batch upload + template matching
    │   ├── session/[datasetId]/
    │   │   ├── schema/page.tsx           Schema mapping, table-type, VD builder, relationships
    │   │   ├── review/page.tsx           Template fast-path review page
    │   │   ├── interview/page.tsx        Dual-mode: Flow 1 step counter OR ADK agent chat
    │   │   ├── kpis/page.tsx             KPI selection (Flow 1 path)
    │   │   └── dimensions/page.tsx       Dimension selection (Flow 1 path)
    │   ├── dashboard/[recipeId]/page.tsx Story sections + filter bar + export
    │   └── review-queue/page.tsx         Central team review interface
    ├── components/
    │   ├── SchemaRelationships.tsx       Relationship confirm: saves to sessionStorage only
    │   ├── filters/FilterBar.tsx         Dimension/filter dropdown bar
    │   ├── ui/                           ChartCard, InsightPanel, SectionHeader, TrendBadge
    │   └── kpis/KpiSummaryCard.tsx
    └── lib/
        ├── api.ts                        All API client calls
        ├── types.ts                      TypeScript types (InterviewResponse.is_adk_mode)
        └── format.ts                     Number/date formatting
```

---

## 5. Report Templates

### 5.1 Client Health Dashboard
**Audience:** Ops team leads | **Cadence:** Weekly  
**Required KPIs:** Contact rate, PTP rate, PTP kept rate  
**Optional KPIs:** RPC rate, compliance flag rate, AHT  
**Data source:** Multi-file upload (activity data + optional roster)  
**Charts:** Contact rate trend, PTP rate trend, agent performance bar, story sections  
**Export:** Dashboard + PPTX + Excel  

### 5.2 WBR / QBR Report
**Audience:** Client stakeholders, ops leadership | **Cadence:** Weekly / Quarterly  
**Required KPIs:** All Client Health KPIs + SLA attainment  
**Optional KPIs:** Headcount, attrition, CSAT  
**Data source:** Multi-file upload  
**Charts:** Summary scorecard tiles, trend charts, breakdown by agent/site/team  
**Export:** Dashboard + PPTX (primary output)  

### 5.3 Executive Scorecard
**Audience:** C-suite, VPs | **Cadence:** Monthly  
**Required KPIs:** Headcount by site, attrition rate, paid vs. productive hours, utilisation  
**Data source:** Excel export from Workday (interim); Workday API direct (Phase 2)  
**Charts:** KPI tiles with MoM delta, site-level bar breakdown  
**Export:** Dashboard + PPTX  

### 5.4 KPI Spotlight
**Audience:** Any team lead | **Cadence:** Ad hoc  
**KPIs:** User selects from AI-suggested list based on uploaded data  
**Data source:** Single or multi-file upload  
**Charts:** Trend line, breakdown by one configurable dimension  
**Export:** Dashboard + Excel  

---

## 6. Pipeline Steps — Detailed

### Step 1 — Multi-File Upload
User uploads 1–10 CSV or Excel files simultaneously. Each file is parsed in the background. Upload limits: 200k rows, 50 MB, 200 columns per file. CSV encoding auto-detected via `chardet` + `csv.Sniffer` — never assumed comma-separated.

After all files are profiled, the upload page checks for saved templates at ≥ 95% column overlap. A match offers a "Use Template" shortcut that jumps to the Review page, bypassing Steps 5–8.

### Step 2 — Deep Profiling
Per file, per column: `detected_type` (date/numeric/categorical/text), `suggested_role` (date/dimension/measure), `grain_score` (unique_count ÷ row_count), `semantic_tag` (entity_key/time_key/financial_metric/etc.), sample values, null %, duplicate row count.

**Metric-name fix:** Columns containing keywords (`score`, `rating`, `pct`, `percent`, `rate`, `count`, `volume`, `avg`, `average`, `qty`, `quantity`) are always classified as `numeric/measure` even when cardinality ≤ 5. This prevents `csat_score` (0/1 binary) and `adherence_pct` (90/95/100) from being hidden as dimensions and excluded from KPI suggestions.

### Step 3 — Schema Mapping
User reviews auto-classification in a tabbed per-file UI. Key capabilities:
- Override column role and semantic tag per column
- Override table type: **fact**, **dimension**, or **unknown** (AI-suggested, user-editable). Stored in `StagingTable.profile_data["table_type"]`.
- **Virtual Dimension Builder**: When all uploaded files are classified as fact/unknown, an amber prompt offers to build a synthetic dimension table from non-numeric columns shared across 2+ fact tables. Entity key = highest-cardinality shared column (purely data-driven, no name assumptions). Single-file mode applies a stability filter — only columns with ≤ 1 unique value per entity group are kept (e.g., agent name is stable across evaluations; rubric name is not).
- **Relationship confirmation**: User confirms detected cross-file joins. Confirmed list is saved to `sessionStorage`. The component does **not** mutate its own suggestion list after confirm (that would shift indices and cause a subsequent confirm to silently drop items). Instead, a green "confirmed" banner replaces the checklist, with an "Edit" link to reopen it.

### Step 4 — Relationship Detection
AI infers cross-file links: `pk_fk` (entity joins), `same_dimension` (same column role + tag), `shared_key` (value overlap). Confidence scored 0–1; threshold 0.6. User reviews and confirms relationships before dashboard generation.

### Step 5 — AI Interview (optional)

**Two modes — chosen by `ADK_ENABLED` in `.env`:**

**Flow 1 (step-by-step):** Side-panel chatbot. "Data Interview" header with "Question X of 6" step counter and teal progress bar. Q1 is hard-coded: "What type of data does this represent?" Q2–Q6 are AI-generated from column profiles (domain, date column, granularity, filters). Answers drive the recipe config. User may skip at any time. On completion: "Continue to KPI Selection →" footer.

**ADK Agent (AI-guided):** A conversational agent handles data discovery through dashboard generation in one chat. "AI-Guided Dashboard Setup" header with an "AI Agent active" badge and an indeterminate indigo progress bar. The agent:
1. Calls `run_data_discovery_from_upload` to inspect the data, then greets the user with a plain-text summary
2. Asks up to 6 questions in natural batches (not as a rigid numbered list)
3. Calls `run_session_kpi_suggest` — presents KPI list for user confirmation
4. Calls `run_session_dimensions` — presents dimension list for confirmation
5. Calls `run_session_generate` — creates the recipe
6. Backend detects the new recipe via DB-poll and returns `completed=true, recipe_id=N`
7. Frontend shows "View Dashboard →" button (no auto-redirect — user can read the agent's final message first)

If ADK fails at any point, the session route silently falls back to Flow 1 and writes an `error` agent trace event. The UI stays in ADK mode (badge remains) — the `is_adk_mode` flag is locked on first response.

### Step 6 — KPI Selection
AI suggests KPIs by sending column names + sample rows to the LLM. The LLM returns full KPI definitions with formula, aggregation type, and display format. `SequenceMatcher` against `catalog/kpis.json` is the fallback when AI fails (threshold 0.55). **KPI suggestions are scoped to the files in the current session** — different file combinations yield different suggestions. User selects, reorders (drag-to-priority), and can add custom KPIs with name + formula.

*This step is bypassed when the ADK agent handles the session — KPI selection happens inside the chat conversation.*

### Step 7 — Dimension Selection
User picks which categorical columns drive breakdown charts. Two-panel UI (available vs. selected). Columns are grouped by source file and show cardinality badges and sample values. First selected dimension is designated "Primary" for default breakdowns.

*This step is bypassed when the ADK agent handles the session — dimension selection happens inside the chat conversation.*

### Step 8 — Data Validation
Pre-flight checks before recipe creation: denominator column null % (>80% → error, >20% → warning), grain key duplicates (>5% → error), measure column null % (>20% → warning), division-by-zero risk. Non-blocking — warnings are surfaced but do not prevent generation.

### Step 9 — Dashboard Generation
`session_generator.py` builds the recipe config and groups KPIs into story sections via an AI prompt. Sections map to business themes (Overview / Performance Trends / Breakdown Analysis / Data Quality). Config includes `upload_table_map`, `confirmed_relationships`, `cross_file_key_pairs`, `chart_layout`, and `sections`. The dashboard renderer uses `config.sections` when present (new multi-file recipes) and falls back to a flat layout for legacy single-file recipes.

---

## 7. Cross-File Join Architecture

This is the core technical capability that makes multi-file dashboards work.

### Join Strategies (applied in priority order)

1. **PK/FK joins**: Fact tables LEFT-JOIN to dimension/Roster tables on `confirmed_relationships` entries. Join key selection is cardinality-ranked — the column with the highest unique count among same-name candidates is the key. No column names are hardcoded anywhere.

2. **Same-dimension enrichment** (`_apply_same_dimension_enrichment()`): When a filter column is present in some fact tables but missing from others, it is propagated via LEFT JOIN before concatenation. Join key is again cardinality-ranked. If no same-name key exists, a cross-name value-overlap probe finds columns across tables whose value sets overlap ≥ 65%.

3. **Raw concat**: Fallback when no relationships exist. Independent fact tables are stacked.

### Anti-Hardcoding Principle (Critical)

**Never reference specific column names in backend logic.** End users upload files with arbitrary headers. Any code that references `agent_email`, `agent_id`, `roster_id`, etc. will break when a different client uploads files with different headers.

All entity/join key detection is:
- **Cardinality-based** — `max(cardinalities, key=lambda c: cardinalities[c])`
- **Type-based** — only non-numeric columns are eligible for dimension tables
- **Value-overlap-based** — cross-file joins use 65% value set overlap probing, not name matching

---

## 8. KPI Catalog

The catalog is a strategic asset — proprietary BGO IP defining how BGO measures collections, CX, and operational performance. 87 KPIs currently defined.

**Format (one entry):**

```json
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
}
```

**Formula syntax supported in AI-generated KPIs:**
- `column_name` — direct value
- `mean(col)` / `sum(col)` / `count(col)` — aggregated single column
- `col_a / col_b` — ratio (uses ratio-of-sums to avoid per-row averaging bias)
- `(col_a + col_b) / col_c` — compound numerator

**Catalog management rule:** Never add a KPI without a human review. Every reviewed KPI is a permanent BGO vocabulary entry. The central data team owns the catalog.

---

## 9. Review Queue

**Reviewer sees per entry:**
- Template, client, period, requested by, timestamp
- KPI mapping table: raw column → KPI → computed value → confidence → flags
- Dashboard preview (read-only render)
- PPTX and Excel download links

**Reviewer actions:**
- **Approve** — publishes dashboard, saves schema mapping to `schema_memory`
- **Approve with edits** — override specific KPI formulas before publishing
- **Reject with comment** — returns to requester with explanation
- **Add to catalog** — formalises a new KPI (sets `reviewed = 1`)

### Auto-Approval Path (deferred — design is stable, ship after 50 approved runs)

Skip human review when ALL are true:
- Schema mapping for `(client_id, template_type)` exists in `schema_memory` and was human-approved
- Excel headers match stored mapping exactly (no new/missing required columns)
- All KPI values within catalog `expected_range`
- No data quality flags raised in Step 8
- Template type and KPI list unchanged from last approved run

---

## 10. Frontend Screens

### Upload (`/upload`)
Drag-and-drop zone accepting up to 10 CSV/Excel files simultaneously. Per-file status badges (uploading / profiling / ready / error). Dataset name input. After profiling: template match check. "Use Template" button (if match) or "Continue to Schema" (standard path).

### Schema Mapping (`/session/[id]/schema`)
Tabbed per-file view. Each tab shows: table type selector (Fact / Dimension / Unknown), column table with role + semantic tag overrides, grain score. Relationship suggestions panel. When all files are fact/unknown: amber "No dimension table detected" notice with "Build Virtual Dimension" button. On VD success: green banner with row count + extracted column list. Relationship confirm replaces the checklist with a green "confirmed" banner; "Edit" link reopens it.

### Interview (`/session/[id]/interview`)

**Flow 1 mode:** Side-panel chatbot, "Data Interview" header, "Question X of 6" step counter, teal progress bar. "Skip Interview" link visible. On completion: "Continue to KPI Selection →" footer.

**ADK Agent mode:** "AI-Guided Dashboard Setup" header, pulsing "AI Agent active" badge, indeterminate indigo progress bar. Assistant messages rendered as Markdown (bold, lists, code spans). Wider chat bubbles for richer agent output. On completion: dark "View Dashboard →" footer.

### KPI Selection (`/session/[id]/kpis`)
*(Flow 1 path — bypassed in ADK mode)*  
AI-suggested KPI cards grouped by domain. Confidence badges. Drag-to-reorder. Custom KPI builder. "Continue" shows count of selected KPIs.

### Dimension Selection (`/session/[id]/dimensions`)
*(Flow 1 path — bypassed in ADK mode)*  
Two-panel layout: available (grouped by source file with cardinality badges) / selected (with "Primary" badge on first). "Generate Dashboard" button.

### Dashboard (`/dashboard/[recipeId]`)
**Filter bar** at top: dimension + filter column dropdowns, "Clear all" action.

**KPI Summary Cards** grid: colored value tile, formula in monospace, trend badge, null-value amber warning state.

**Story sections** (when `config.sections` present): KPIs grouped by business theme with section title. Each section contains its own time-series trend chart and breakdown bar chart. Falls back to flat layout for legacy single-file recipes.

**Trend charts**: Interactive Recharts LineChart with Brush zoom component, granularity toggle (daily/weekly/monthly).

**Breakdown charts**: Recharts BarChart, top performer callout.

**Insights panel**: Finding → Narrative → Decision entries, severity-colored.

**Export**: Excel (.xlsx) and PowerPoint (.pptx) buttons.

### Review Queue (`/review-queue`)
Central team only. List of pending items sorted by created_at. Approve / Approve with edits / Reject.

---

## 11. API Surface

```
# Upload
POST   /upload                            Single file (backwards compat)
POST   /upload/batch                      Batch upload → dataset_id + upload list
GET    /upload/{id}                       Poll profiling status
GET    /upload/{id}/profile               Column profile data
POST   /upload/{id}/schema                Save user schema overrides
PATCH  /upload/{id}/table-type            Override AI table classification (fact/dimension/unknown)

# Session (multi-file flow)
POST   /session/{id}/relationships        Infer cross-file relationships
POST   /session/{id}/interview            ADK agent or Flow 1 interview turn
                                          Response: {message, step_index, step_label,
                                                    completed, interview_result, is_adk_mode}
GET    /session/{id}/interview/state      Current step + collected answers
POST   /session/{id}/interview/skip       Skip interview → default result
POST   /session/{id}/kpi-suggestions      AI-suggest KPIs from column profiles
GET    /session/{id}/dimensions           List dimension columns across all uploads
POST   /session/{id}/virtual-dimension    Build + store virtual dimension
                                          Returns: upload_id, table_name, row_count,
                                                   column_count, columns[]
                                          422 if no qualifying common columns
POST   /session/{id}/validate             Pre-dashboard data validation
POST   /session/{id}/generate             Create recipe → recipe_id

# Report Templates
POST   /api/templates                     Save recipe as reusable template
GET    /api/templates                     List saved templates
POST   /api/templates/match              Match files to templates at ≥ 95% column overlap
GET    /api/templates/{id}               Get single template
PUT    /api/templates/{id}               Update template (permanent override)
DELETE /api/templates/{id}               Delete template

# Dashboard
GET    /api/dashboard                     List all dashboards (prefetched, no N+1)
GET    /api/dashboard/{id}/data           Full dashboard data with filter support
GET    /api/dashboard/{id}/filter-values  Populate filter dropdowns
GET    /api/dashboard/{id}/export/excel   Download .xlsx
GET    /api/dashboard/{id}/export/pptx    Download .pptx
GET    /api/dashboard/{id}/validate-config   Pre-flight integrity check
POST   /api/dashboard/{id}/validate-formula  Test-compute a single formula
PATCH  /api/dashboard/{id}/config            Update granularity, dimensions, filters, KPIs

# KPI Catalog
GET/POST /api/kpis
GET      /api/kpis/{id}
POST     /api/kpis/{id}/review
GET      /api/kpis/custom                 List custom proposals (status filter)
POST     /api/kpis/custom/{id}/approve    Approve: write kpis.json + DB commit
POST     /api/kpis/custom/{id}/reject     Reject

# Reports + Review Queue
POST   /api/reports
GET    /api/reports
GET    /api/reports/{id}
POST   /api/reports/{id}/upload
POST   /api/reports/{id}/confirm-mapping
GET    /api/reports/{id}/dashboard
GET    /api/reports/{id}/schema-memory
GET    /api/reports/review-queue/list
GET    /api/reports/review-queue/{id}/new-kpis
POST   /api/reports/review-queue/{id}/approve
POST   /api/reports/review-queue/{id}/reject

# Logging
POST   /api/log/event
```

---

## 12. Data Model

### Core ORM Models (`backend/models/`)

**`Dataset`** — One per batch upload session. Holds `client_id`, `name`, `created_at`.

**`Upload`** — One per file within a dataset. Holds `filename`, `s3_key`, `status` (uploading/profiling/profiled/error), `dataset_id`. Synthetic uploads with `filename="__virtual_dimension__"` represent built virtual dimensions.

**`StagingTable`** — Physical staging table reference per upload. Holds `table_name` (e.g. `staging_42`), `profile_data` (JSON — full column profiles + `table_type`), `row_count`, `column_count`.
- `profile_data["table_type"]` values: `"fact"`, `"dimension"`, `"unknown"`, `"virtual_dimension"`

**`ReportRecipe`** — Generated recipe config. Holds `config` (JSON — upload_ids, upload_table_map, date_column, granularity, dimensions, filters, kpis, sections, confirmed_relationships, cross_file_key_pairs, chart_layout), `approved_at`, `approved_by`.

**`KpiDefinition`** — One row per KPI catalog entry.

**`DashboardConfig`** — Mutable override layer on top of ReportRecipe.config.

**`CustomKpiProposal`** — AI-generated KPI pending ops approval. Status: `pending` | `approved` | `rejected`.

**`ReportTemplate`** — Saved template config + per-file column fingerprints for overlap matching.

### Observability Models

**`LlmCallLog`** — Written by `ai_client.py` for every LLM call across all services:
- `provider`, `model`, `task_type`
- `prompt_hash` — SHA-256 first 16 hex chars (raw prompt is **never** stored)
- `input_token_estimate`, `output_token_estimate` — `len(text) // 4` approximation
- `latency_ms`, `status` (success/error), `error_message`

**`AgentTraceEvent`** — Written by ADK session tools and `session.py` ADK branch:
- `run_id` — `"session_{dataset_id}"`
- `step_name` — `"interview_turn"` | `"kpi_suggest"` | `"dimensions"` | `"generate"`
- `skill_name` — exact function called
- `status` — `success` | `warning` | `pending` | `error` | `blocked`
- `confidence` — 0–1 quality score where applicable
- `evidence_json` — structured metadata (counts, column names) — no raw uploaded data
- `requires_review` — flagged when a human should inspect

### Schema Memory

On recipe approval, `schema_memory` saves the column mapping keyed by `(client_id, template_type)`. Second run with the same client + template loads the saved mapping and skips fuzzy matching.

### SQLite Locking Note

When writing a staging table via pandas `to_sql`, always call `db.commit()` first to release the SQLAlchemy session write lock before pandas opens a second connection. Failure causes `OperationalError: database is locked`.

---

## 13. Test Suite

58 backend tests, all passing. Run with the project virtualenv:

```bash
# Windows
backend\new-env\Scripts\python.exe -m pytest backend\tests\ -v

# macOS/Linux
cd backend && pytest tests/ -v
```

| File | Tests | Coverage |
|---|---|---|
| `test_compute_per_kpi_filter.py` | 25 | Same-dimension enrichment, join key selection, cross-name value-overlap, LEFT JOIN dedup guard, 3-table datasets, table classification, relationship enrichment, PK/FK direction auto-flip |
| `test_get_dimensions.py` | 8 | 4-branch priority (virtual → real dim → shared → fallback), table_count badge, excluded semantic tags, sort order |
| `test_profiler_classify.py` | 6 | `csat_score` binary→measure, `avg_csat_rating`→measure, `is_deleted` stays categorical, `adherence_pct`→measure |
| `test_schema_relationships.py` | 4 | Same-name relationship detection, cross-name value-overlap detection, no false positive below threshold |
| `test_virtual_dimension.py` | 12 | Common col inclusion, numeric exclusion, no-common→None, deduplication, entity key by cardinality, single-table stability filter, name-agnostic key detection |
| `test_virtual_dimension_endpoint.py` | 3 | StagingTable `table_type="virtual_dimension"`, None for no common cols, physical table readable |

---

## 14. Moving to Production

The agent logic, KPI catalog, templates, and frontend are identical between dev and prod — only infrastructure changes.

| Component | Current (dev) | Production |
|---|---|---|
| Database | SQLite | PostgreSQL (`DATABASE_URL` swap — no code changes) |
| File storage | Local `/local_uploads` | AWS S3 (`S3_BUCKET` + boto3 — one config line) |
| Deployment | Railway | Railway (same) or AWS ECS |
| Observability | `llm_call_logs` + `agent_trace_events` tables | Add Langfuse tracing alongside existing tables |
| Column matching | SequenceMatcher | pgvector semantic search |
| Auth | None | BGO SSO (SAML/OAuth2 FastAPI middleware) |
| Workday | Excel export interim | Airbyte connector |
| Secrets | `.env` file | Railway env vars or AWS Secrets Manager |

**Migration order:** PostgreSQL → S3 → Langfuse → SSO → Workday connector. Each swap is independent. Test after each.

---

## 15. What Is Not Supported (Current Phase)

- **Scheduled refresh** — user-triggered only; no cron runs
- **PDF export** — PPTX and Excel only
- **Multi-hop joins** — only single-level fact → dimension; remaining tables concatenated
- **Real-time / streaming data** — batch Excel/CSV only
- **Conditional aggregation** — `IF(condition, col_a, col_b)` not supported
- **Hierarchical dimensions** — flat grouping only
- **Client-facing portal** — internal BGO users only in Phase 1
- **Hunter Point Capital deployment** — after MVP exit gate with BGO internal users
- **SSO / authentication** — python-jose installed but not yet wired

---

## 16. Future Phases

**Phase 2 — Production infrastructure + expanded connectors**  
PostgreSQL + S3. Workday API direct. TCM telephony connector. CRM connector. Langfuse observability. SSO onboarding. Scheduled proactive report generation.

**Phase 3 — External deployment + natural language**  
Hunter Point Capital: SharePoint → validate → DealCloud workflow on the same platform. Client-facing self-serve portal. Natural language dashboard queries. Auto-approval path (after 50 reviewed runs).

**Phase 4 — Platform extension**  
Report Factory as billable BGO IP product. Voice collections agent reusing the same KPI catalog and review queue. Executive Scorecard self-service with Workday direct pull.

---

## 17. Open Questions

| # | Question | Owner | Priority |
|---|---|---|---|
| 1 | Which BGO clients should be the first 5 real sessions to validate the pipeline end-to-end? | Ops lead | Now |
| 2 | Review queue: who is the designated Phase 1 reviewer on the central data team? | Data team lead | Now |
| 3 | PostgreSQL migration timeline — SQLite limits concurrent writes in production | Platform lead | Sprint +1 |
| 4 | BGO PowerPoint slide master — does the current PPTX template match the approved master? | Marketing | Sprint +1 |
| 5 | `client_id` naming convention — must be consistent for schema memory keys to work | Data team | Now |
| 6 | Executive Scorecard: is Workday Excel export sufficient for Phase 1, or is API access needed from day one? | Workday admin | Phase 2 |
| 7 | Langfuse observability — self-hosted or cloud? Required before Phase 2 launch | Platform lead | Phase 2 |
| 8 | ADK agent: should the session interview default to ADK mode for all users, or remain opt-in via `.env`? | Product | Now |
