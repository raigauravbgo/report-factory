# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BGO Report Factory** — an AI-powered self-service BI tool that lets operations users (Ops Managers, Team Leads, Program Managers) upload Excel/CSV data and generate interactive dashboards without relying on a centralised Power BI team. It is the first surface of the BGO AI Platform and the foundation for all future BGO AI agents.

The full 8-step pipeline is **fully implemented** across backend (FastAPI + SQLite) and frontend (Next.js 16 + TypeScript + Tailwind).

---

## Actual Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2.4 + React 19 + TypeScript + Tailwind CSS 4 |
| Backend | FastAPI (Python 3.12) |
| Data Processing | Python + pandas 2.2.3 |
| Database | SQLite (via SQLAlchemy 2.0 + Alembic migrations + raw `db/database.py` helpers) |
| Storage | Local `/uploads` (S3 swap-in via `services/storage.py` + boto3) |
| AI / Agent | Google ADK (local) + Claude (`claude-sonnet-4-20250514`) via Anthropic API; OpenAI/Azure OpenAI powers the legacy interview path |
| Charts | Recharts 3.x |
| Formula Validation | asteval 1.0.5 |

> **Database note:** the app uses SQLite by default (`DATABASE_URL=sqlite:///...`). `core/database.py` calls `create_engine(settings.database_url)`, so PostgreSQL/MySQL work by changing `DATABASE_URL` (and adding the matching driver to `requirements.txt`). The backend `Dockerfile` pre-installs `default-libmysqlclient-dev` for that path. `docker-compose.yml` runs `api` (SQLite on a persisted volume) + `web` (Next.js).

---

## Pipeline Flow (fully implemented)

```
Multi-file Upload        → /upload
  → Schema Mapping       → /schema-mapping/{datasetId}
  → Data Modeling        → /data-modeling/{datasetId}
  → Interview (OPT)      → /interview?datasetId=X   ← skip button advances to KPI Selection
  → KPI Selection        → /kpi-selection/{datasetId}
  → Dimension Selection  → /dimension-selection/{datasetId}
  → Recipe Editor        → /recipe/{recipeId}
  → Dashboard            → /dashboard/{recipeId}
```

`datasets.pipeline_stage` is the single source of truth for where a dataset is in the pipeline.

---

## Repository Layout

```
bgo-reports-v1/
├── backend/                      # FastAPI app (see Backend Structure below)
├── frontend/                     # Next.js app (see Frontend Structure below)
├── docs/superpowers/             # specs/ and plans/ — design + implementation docs
│                                 #   (e.g. 2026-06-13 dashboard Enhanced View)
├── dashboard-preview.html        # Static prototype of the Enhanced View dashboard
├── dashboard-refiner/            # Claude SKILL.md — dashboard design review/refinement
├── kpi-dashboard-storytelling/   # Claude skill — KPI dashboard design + data storytelling
│                                 #   (SKILL.md + agents/ + references/)
├── docker-compose.yml            # Local stack: api (SQLite) + web (Next.js)
└── .env                          # Local config (gitignored)
```

`dashboard-refiner/` and `kpi-dashboard-storytelling/` are **Claude skill definitions, not runnable code** — they guide design/storytelling work on this repo.

---

## Backend Structure

```
backend/
├── main.py                        # FastAPI app — 9 routers registered, CORS, /health, init_db()
├── core/
│   ├── config.py                  # Pydantic settings (Anthropic, OpenAI, Azure, S3, DB, app_env)
│   └── database.py                # SQLAlchemy engine + SessionLocal + get_db()
├── db/
│   ├── schema.sql                 # SQLite schema — 5 original tables (report_requests, kpi_catalog,
│   │                              #   schema_memory, review_queue, agent_log)
│   └── database.py                # Raw SQLite helpers (KPI CRUD, report CRUD, schema_memory)
├── models/                        # SQLAlchemy ORM models
│   ├── dataset.py                 # datasets table — +pipeline_stage, +pipeline_context (JSON)
│   ├── upload.py                  # uploads table — +schema_mapping_status
│   ├── column_schema.py           # column_schemas — ai_* (immutable) + confirmed_* (nullable overrides)
│   ├── data_model.py              # data_models — tables/primary_keys/foreign_keys as JSON blobs
│   ├── staging_table.py           # staging_tables — profile_data JSON
│   ├── report_recipe.py           # report_recipes — config JSON, approved_at
│   ├── kpi_definition.py          # kpi_definitions — name, formula per recipe
│   ├── dashboard_config.py        # dashboard_configs — layout JSON per recipe
│   └── processed_table.py        # processed_tables — staging → recipe link
├── schemas/
│   ├── upload.py                  # UploadResponse, UploadBatchResponse, ColumnProfile, ProfilingResult,
│   │                              #   DatasetSchemaResponse, ConfirmSchemaRequest
│   └── interview.py               # RecipeConfig (central contract), KpiSpec, ChartConfig,
│                                  #   InterviewResult, KpiSuggestion, DimensionSuggestion, ValidationResult
├── api/routes/
│   ├── upload.py                  # POST /upload, GET /upload/{id}/profile, dataset schema endpoints
│   ├── data_model.py              # POST /data-model/suggest, GET + POST /{dataset_id}/confirm
│   ├── kpi_suggestions.py         # POST /kpi-suggestions, POST /kpi-suggestions/select
│   ├── dimensions.py              # GET /dimensions/{id}, POST /dimensions/{id}/select
│   ├── validate.py                # POST /validate/kpi-formula, POST /validate/recipe
│   ├── dashboard.py               # GET /dashboard/{recipe_id}/data (metrics, time-series, insights)
│   ├── interview.py               # POST /interview, /interview/skip, /interview/recipe/from-context
│   ├── kpis.py                    # GET/POST /api/kpis, POST /api/kpis/{id}/review
│   └── reports.py                 # Legacy PRD3 report lifecycle + review queue
├── services/
│   ├── schema_mapper.py           # 5-type dtype classification (int/float/boolean/text/date),
│   │                              #   filter candidates, optional AI refinement pass
│   ├── data_modeler.py            # Heuristic + AI fact/dim classification, 4-strategy FK detection,
│   │                              #   referential integrity check (samples FK values), join cardinality
│   │                              #   (1:1 / many:1 / many:many), bridge-dimension detection
│   ├── kpi_suggester.py           # Scores catalog KPIs by column match, optional AI re-ranking
│   ├── dimension_suggester.py     # Dimension columns from confirmed dim tables only, optional AI labels
│   ├── validator.py               # validate_upload, validate_schema_mapping, validate_data_model,
│   │                              #   validate_kpi_formula (asteval), validate_recipe, detect_schema_drift
│   ├── recipe_generator.py        # generate() from InterviewResult; generate_from_context() for skip path
│   ├── ai_interview.py            # 5-step interview state machine → InterviewResult
│   ├── ai_client.py               # OpenAI / Azure OpenAI wrapper (chat_complete, JSON mode)
│   ├── parser.py                  # CSV/Excel → pandas → staging_* table
│   ├── profiler.py                # Column type detection (date/numeric/categorical/text) + role suggestion
│   └── storage.py                 # S3 or local file I/O
├── migrations/versions/
│   ├── 0001_initial_schema.py     # Original 7 ORM tables
│   └── 0002_schema_mapping_and_data_model.py  # column_schemas, data_models, +pipeline_stage,
│                                              #   +pipeline_context, +schema_mapping_status
├── catalog/
│   ├── kpis.json                  # 70 BGO KPIs (collections 30, cx 20, workforce 13, sales 7) — do not alter structure
│   ├── column_synonyms.json       # Field-name aliases → canonical KPI source fields (schema mapping aid)
│   └── templates/                 # 4 report templates (client_health, wbr_qbr, exec_scorecard, kpi_spotlight)
├── seed_catalog.py                # Seed kpi_catalog table from kpis.json
├── inspect_recipes.py             # Dev utility — dump stored recipes
├── Dockerfile                     # python:3.12-slim + libmysqlclient; runs uvicorn on :8000
└── agent/report_factory_agent/    # Google ADK 5-tool agent
    ├── agent.py                   # Root agent (claude-sonnet-4-20250514)
    └── tools/                     # intake, data_discovery, define_kpi, standardise, generate
```

---

## Frontend Structure

```
frontend/
├── app/
│   ├── page.tsx                                  # Root — redirects to /upload
│   ├── layout.tsx                                # Root layout — AppShell wrapper, Geist fonts
│   ├── globals.css                               # Tailwind 4 import, CSS vars, scrollbar styling
│   ├── upload/page.tsx                           # Multi-file drop → polls until profiled → /schema-mapping/{id}
│   ├── schema-mapping/[datasetId]/page.tsx       # Per-file tabs, AI dtype/role/filter review, user overrides
│   ├── data-modeling/[datasetId]/page.tsx        # Fact/dim roles, PK assignment, FK graph management
│   ├── interview/page.tsx                        # 5-step chat interview (skip → /kpi-selection/{id})
│   ├── kpi-selection/[datasetId]/page.tsx        # AI-ranked catalog KPIs + custom KPIs with live formula check
│   ├── dimension-selection/[datasetId]/page.tsx  # Dim columns from dim tables, grouped by table
│   ├── recipe/[recipeId]/page.tsx                # KPI editor, chart layout, formula validation, approve
│   ├── dashboard/[recipeId]/page.tsx             # Classic + Enhanced View (Overview/Trends/Drivers/Actions
│   │                                             #   tabs), KPI cards w/ delta + sparklines, insights, filters
│   └── profile/[uploadId]/page.tsx               # Legacy column profiler (backward compat only)
├── components/
│   ├── AppShell.tsx           # Sidebar pipeline nav (8 steps with progress), top header, layout
│   ├── UploadZone.tsx         # react-dropzone, .csv/.xlsx only, 50 MB limit, multi-file
│   ├── SchemaColumnTable.tsx  # Type/role/filter dropdowns, override highlighting, scrollable
│   ├── KpiCard.tsx            # Catalog KPI card — domain badge, relevance bar, toggle select
│   ├── FormulaInput.tsx       # Live formula validation (500 ms debounce, green/red/amber states)
│   ├── ValidationPanel.tsx    # Sticky errors/warnings panel from ValidationResult
│   └── ColumnTable.tsx        # Legacy profile column table (profile page only)
└── lib/
    ├── api.ts                 # All 23 API client functions (uploadFiles → getDashboardData)
    └── types.ts               # All TypeScript interfaces (ColumnSchemaEntry, DataModelResponse,
                               #   DashboardData, DashboardInsight, RecipeConfig, etc.)
```

---

## API Endpoints

```
# Upload
POST /upload                                   Multi-file upload → UploadBatchResponse (201)
GET  /upload/{upload_id}                       Single upload status
GET  /upload/{upload_id}/profile               Legacy profiling result
GET  /upload/dataset/{dataset_id}              Poll all upload statuses in dataset
GET  /upload/dataset/{dataset_id}/schema       AI column schemas for all files
POST /upload/dataset/{dataset_id}/schema/confirm  Apply overrides → advance to data_modeling

# Data Modeling
POST /data-model/suggest                       AI fact/dim + PK/FK suggestion (201)
GET  /data-model/{dataset_id}                  Get DataModel
POST /data-model/{dataset_id}/confirm          Apply overrides → advance to interview

# Interview
POST /interview                                Chat turn → InterviewResponse
POST /interview/skip                           Skip interview → advance to kpi_selection
POST /interview/recipe                         Generate recipe from InterviewResult (201)
POST /interview/recipe/from-context            Generate recipe after skip path (201)
GET  /interview/recipe/{id}                    Get recipe
POST /interview/recipe/{id}/approve            Finalise recipe (sets approved_at)

# KPI & Dimensions
POST /kpi-suggestions                          AI-ranked catalog KPIs
POST /kpi-suggestions/select                   Save selection + validate custom formulas → advance to dimension_selection
GET  /dimensions/{dataset_id}                  Dimension columns from dim tables only
POST /dimensions/{dataset_id}/select           Save selection → advance to recipe

# Validation
POST /validate/kpi-formula                     Live formula check (asteval sandbox)
POST /validate/recipe                          Full recipe config validation

# Dashboard
GET  /dashboard/{recipe_id}/data               Aggregated KPI data, time-series, insights
                                               Accepts ?f_col=val filter query params

# KPI Catalog
GET  /api/kpis                                 List (filter: domain, reviewed)
GET  /api/kpis/{kpi_id}                        Single KPI
POST /api/kpis                                 Create custom KPI (201)
POST /api/kpis/{kpi_id}/review                 Mark reviewed/unreviewed

# Reports + Review Queue (legacy PRD3 flow)
POST /api/reports
GET  /api/reports/{id}
POST /api/reports/{id}/upload
POST /api/reports/{id}/confirm-mapping
GET  /api/reports/{id}/dashboard
GET  /api/reports/{id}/schema-memory
GET  /api/reports/review-queue/list
POST /api/reports/review-queue/{id}/approve
POST /api/reports/review-queue/{id}/reject
GET  /api/reports/review-queue/{id}/new-kpis

# Health
GET  /health                                   → {"status": "ok", "app": "BGO Report Factory"}
```

---

## Database Schema

### Raw SQLite tables (`db/schema.sql`) — initialised by `init_db()` on startup

| Table | Purpose |
|---|---|
| `report_requests` | Legacy PRD3 report state machine |
| `kpi_catalog` | 70 BGO KPIs (seeded from `catalog/kpis.json` via `seed_catalog.py`) |
| `schema_memory` | Client × template column mapping cache |
| `review_queue` | Pending human approvals |
| `agent_log` | ADK step trace |

### SQLAlchemy ORM tables (Alembic migrations)

| Table | Migration | Key columns |
|---|---|---|
| `datasets` | 0001 + 0002 | `pipeline_stage` (8 values), `pipeline_context` (JSON) |
| `uploads` | 0001 + 0002 | `schema_mapping_status` (pending\|ai_suggested\|confirmed) |
| `staging_tables` | 0001 | `profile_data` JSON, row/column counts |
| `report_recipes` | 0001 | `config` JSON (RecipeConfig), `approved_at` |
| `kpi_definitions` | 0001 | `name`, `formula` per recipe |
| `dashboard_configs` | 0001 | `layout` JSON |
| `processed_tables` | 0001 | staging → recipe link |
| `column_schemas` | **0002** | `ai_*` (immutable AI suggestion) + `confirmed_*` (nullable user override) |
| `data_models` | **0002** | `tables`, `primary_keys`, `foreign_keys` as JSON; unique per `dataset_id` |

**Audit trail pattern:** `COALESCE(confirmed_type, ai_detected_type)` — AI suggestion is always preserved even after user override, enabling full audit. `ColumnSchema.effective_type/role/is_filter` properties encapsulate this.

---

## Data Validation Points

| Stage | What is validated | Blocking? |
|---|---|---|
| File drop (client) | Extension (.xlsx/.csv), size ≤ 50 MB | Yes |
| `POST /upload` | Encoding, header row, magic bytes | Yes (400) |
| Schema confirm | Duplicate column names across files; fact table needs ≥1 date + ≥1 measure | Error blocks |
| Data model confirm | Circular FK graph; FK referential integrity < 90% | Warning only |
| KPI formula (live, client) | `FormulaInput` debounced 500 ms via `POST /validate/kpi-formula` | Live feedback |
| `POST /kpi-suggestions/select` | All custom KPI formulas validated server-side (asteval) | 422 |
| Recipe approve | Client-side `hasFormulaErrors()` + `POST /validate/recipe` | Blocks approve |
| Dashboard refresh | `detect_schema_drift()` compares staging columns vs confirmed schema | Warning banner |

---

## Dashboard Insight Logic (`backend/api/routes/dashboard.py`)

Insights are **rule-based templates** — no LLM call on dashboard load. Each insight is emitted as a decision narrative with fields `severity`, `headline`, `finding`, `evidence`, `driver`, `impact`, `decision`, `action` (rendered in the Enhanced View **Actions** tab). Two shapes:

1. **Top Performer Benchmark** (dimension breakdown has ≥2 segments):
   - Finds top and bottom segment by KPI value
   - Severity based on spread as % of mean: < 5% → low, 5–15% → medium, > 15% → high
   - Shows: who leads, gap from average, full range, coaching action

2. **Absolute Value Snapshot** (no dimension data):
   - Shows current value, record count, period; nudges user to add a dimension filter
   - Severity always low

KPI scorecards also carry `prior_value`, `delta`, `delta_pct`, and a `status` (good / neutral / warning / risk). Multi-fact datasets are joined server-side: many-to-many joins are pre-aggregated, and secondary facts inherit dimension joins from the primary fact.

---

## Key Constraints

- Files up to 50 MB per upload; datasets up to ~500k rows
- Multi-client data isolation — all tables have `client_id`
- All KPI definitions must be auditable (`confirmed_*` nullable columns preserve AI suggestion)
- Human approval required before recipe is applied (`approved_at` must be set)
- AI suggestions for schema / data model / KPIs / dimensions are all user-overridable
- Formula evaluation uses `asteval` sandbox — never raw `eval()`
- `datasets.pipeline_stage` is the single source of truth for resuming an in-progress flow
- `catalog/kpis.json` is proprietary IP — do not alter structure

---

## Key Files to Know

| File | Why it matters |
|---|---|
| `backend/catalog/kpis.json` | 70 BGO KPIs — source of truth for all KPI suggestions |
| `backend/db/schema.sql` | Canonical SQLite schema (5 original tables) |
| `backend/schemas/interview.py` | `RecipeConfig` is the central data contract for the whole pipeline |
| `backend/api/routes/dashboard.py` | `_generate_insights()` — insight template logic lives here |
| `backend/services/profiler.py` | Existing type detection — extended by `schema_mapper.py`, not replaced |
| `backend/agent/report_factory_agent/agent.py` | Google ADK root agent |
| `frontend/lib/types.ts` | All TypeScript interfaces — start here for frontend data shapes |
| `frontend/lib/api.ts` | All 23 API client methods |
| `frontend/components/AppShell.tsx` | Pipeline sidebar navigation |
