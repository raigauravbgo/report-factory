# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BGO Report Factory** — an AI-powered self-service BI tool that lets operations users (Ops Managers, Team Leads, Program Managers) upload Excel/CSV data and generate dashboards without relying on a centralized Power BI team. It is the first surface of the BGO AI Platform and the foundation for all future BGO AI agents.

Implementation is **in progress**. The backend (FastAPI + SQLite) and frontend (Next.js 16 + TypeScript + Tailwind) are both partially built.

## Actual Tech Stack (implemented)

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 + React + TypeScript + Tailwind CSS |
| Backend | FastAPI (Python 3.12) |
| Data Processing | Python + pandas |
| Database | SQLite (via SQLAlchemy + raw `db/database.py` helpers) |
| Storage | Local `/uploads` (S3 swap-in via `services/storage.py`) |
| AI / Agent | Google ADK (local) + Claude via Anthropic API (`claude-sonnet-4-20250514`) |
| Charts | Recharts |
| Formula Validation | asteval |

## Pipeline Flow (current + planned)

```
Multi-file Upload
  → Schema Mapping  (AI dtype/role/filter per file, user overrides)
  → Data Modeling   (AI fact/dim tables + PK/FK relationships, user overrides)
  → Interview       (optional — skip goes straight to KPI Selection)
  → KPI Selection   (AI-ranked catalog KPIs + custom KPIs)
  → Dimension Selection (from dimension tables only, AI-suggested)
  → Recipe          (dashboard config editor + formula validation)
  → Dashboard
```

## Backend Structure

```
backend/
├── main.py                        # FastAPI app + SQLite init + route registration
├── core/config.py                 # Settings (Anthropic, OpenAI, Azure, S3, DB)
├── core/database.py               # SQLAlchemy engine + session
├── db/database.py                 # Raw SQLite helpers (KPI CRUD, report CRUD, schema_memory)
├── db/schema.sql                  # SQLite schema (4 tables: report_requests, kpi_catalog, schema_memory, review_queue, agent_log)
├── models/                        # SQLAlchemy ORM models
│   ├── dataset.py, upload.py, staging_table.py
│   ├── report_recipe.py, kpi_definition.py, dashboard_config.py, processed_table.py
│   ├── column_schema.py           # NEW: one row per column per upload
│   └── data_model.py              # NEW: fact/dim classification + PK/FK relationships
├── schemas/
│   ├── upload.py                  # UploadResponse, ColumnProfile, ProfilingResult
│   └── interview.py               # RecipeConfig, InterviewResult, KpiSpec, ChartConfig
│                                  #   + NEW: ConfirmSchemaRequest, ConfirmDataModelRequest,
│                                  #          KpiSuggestion, DimensionSuggestion, ValidationResult
├── api/routes/
│   ├── upload.py                  # POST /upload (multi-file), GET /upload/dataset/{id}/schema, POST .../confirm
│   ├── interview.py               # POST /interview, POST /interview/skip, POST /interview/recipe
│   ├── kpis.py                    # GET/POST /api/kpis
│   ├── reports.py                 # Report lifecycle + review queue
│   ├── data_model.py              # NEW: POST /data-model/suggest, GET/POST /data-model/{dataset_id}
│   ├── kpi_suggestions.py         # NEW: POST /kpi-suggestions, POST /kpi-suggestions/select
│   ├── dimensions.py              # NEW: GET /dimensions/{dataset_id}, POST .../select
│   └── validate.py                # NEW: POST /validate/kpi-formula, POST /validate/recipe
├── services/
│   ├── ai_client.py               # OpenAI/Azure/Anthropic wrapper (chat_complete)
│   ├── ai_interview.py            # 5-step interview state machine
│   ├── parser.py                  # CSV/Excel → pandas → staging table
│   ├── profiler.py                # Type detection (date/numeric/categorical/text) + role suggestion
│   ├── recipe_generator.py        # generate() from interview + generate_from_context() for skip path
│   ├── storage.py                 # S3 or local file I/O
│   ├── schema_mapper.py           # NEW: 5-type dtype (int/float/boolean/text/date), filter candidates, AI pass
│   ├── data_modeler.py            # NEW: heuristic + AI fact/dim + PK/FK detection
│   ├── kpi_suggester.py           # NEW: score catalog KPIs by column match + AI re-ranking
│   ├── dimension_suggester.py     # NEW: dimension columns from confirmed dim tables only
│   └── validator.py               # NEW: validate_upload, validate_schema_mapping, validate_data_model,
│                                  #       validate_kpi_formula (asteval), validate_recipe, detect_schema_drift
├── agent/report_factory_agent/    # Google ADK 4-step agent (intake→discovery→standardise→generate)
├── catalog/kpis.json              # 99 BGO KPIs (collections, cx, sales, workforce, ops)
└── catalog/templates/             # 4 report templates (client_health, wbr_qbr, exec_scorecard, kpi_spotlight)
```

## Frontend Structure

```
frontend/
├── app/
│   ├── upload/page.tsx                        # Multi-file upload → redirects to /schema-mapping/{datasetId}
│   ├── schema-mapping/[datasetId]/page.tsx    # NEW: AI schema review per file (dtype/role/filter)
│   ├── data-modeling/[datasetId]/page.tsx     # NEW: Fact/dim + PK/FK review and override
│   ├── interview/page.tsx                     # Optional chat interview (skip button)
│   ├── kpi-selection/[datasetId]/page.tsx     # NEW: AI-ranked KPI catalog + custom KPIs
│   ├── dimension-selection/[datasetId]/page.tsx # NEW: Dimensions from dim tables only
│   ├── recipe/[recipeId]/page.tsx             # Enhanced: chart config editor + formula validation
│   └── profile/[uploadId]/page.tsx            # Legacy: kept for backward compat
├── components/
│   ├── UploadZone.tsx             # Multi-file drag-drop
│   ├── ColumnTable.tsx            # Legacy column profile table
│   ├── SchemaColumnTable.tsx      # NEW: 5-type badges, role dropdown, filter checkbox
│   ├── DataModelDiagram.tsx       # NEW: SVG table cards + FK relationship lines
│   ├── KpiCard.tsx                # NEW: KPI suggestion card with relevance bar
│   ├── ValidationPanel.tsx        # NEW: Sticky error/warning panel from ValidationResult
│   └── FormulaInput.tsx           # NEW: Text input with live formula validation (debounced 500ms)
└── lib/
    ├── api.ts                     # API client (all new methods added)
    └── types.ts                   # TypeScript interfaces (extended for new schemas)
```

## API Endpoints

```
# Upload
POST /upload                              Multi-file upload → UploadBatchResponse
GET  /upload/dataset/{id}                 Poll all upload statuses
GET  /upload/dataset/{id}/schema          Get ColumnSchema records for all files
POST /upload/dataset/{id}/schema/confirm  Apply user overrides + advance pipeline_stage

# Data Modeling
POST /data-model/suggest                  AI fact/dim + PK/FK suggestion
GET  /data-model/{dataset_id}             Get DataModel
POST /data-model/{dataset_id}/confirm     Apply overrides + validation

# Interview
POST /interview                           Chat turn (single upload_id scope)
POST /interview/skip                      Skip interview → advance to kpi_selection
POST /interview/recipe                    Generate recipe (interview or skip path)
GET  /interview/recipe/{id}
POST /interview/recipe/{id}/approve

# KPI + Dimensions
POST /kpi-suggestions                     AI-ranked KPIs from catalog
POST /kpi-suggestions/select              Save selection + validate custom formulas
GET  /dimensions/{dataset_id}             Dimension columns from dim tables only
POST /dimensions/{dataset_id}/select      Save selection

# Validation
POST /validate/kpi-formula                Live formula check (asteval sandbox)
POST /validate/recipe                     Full recipe validation

# KPI Catalog
GET  /api/kpis                            List catalog KPIs (filter by domain/reviewed)
POST /api/kpis                            Create custom KPI
POST /api/kpis/{id}/review                Mark KPI reviewed

# Reports + Review Queue
POST /api/reports                         Create report request
GET  /api/reports/{id}
POST /api/reports/{id}/upload
POST /api/reports/{id}/confirm-mapping
GET  /api/reports/{id}/dashboard
GET  /api/reports/review-queue/list
POST /api/reports/review-queue/{id}/approve
POST /api/reports/review-queue/{id}/reject

# Other
GET  /health
```

## Database Schema (SQLite)

**Existing tables:** `report_requests`, `kpi_catalog`, `schema_memory`, `review_queue`, `agent_log`

**SQLAlchemy ORM tables:** `datasets`, `uploads`, `staging_tables`, `report_recipes`, `kpi_definitions`, `dashboard_configs`, `processed_tables`

**New tables (migration 0002):**
- `column_schemas` — one row per column per upload; stores `ai_detected_type` + nullable `confirmed_type` (audit trail pattern: `COALESCE(confirmed_*, ai_*)` for effective value)
- `data_models` — one row per dataset; `tables`/`primary_keys`/`foreign_keys` stored as JSON

**New columns on existing tables:**
- `uploads.schema_mapping_status` — `pending|ai_suggested|confirmed`
- `datasets.pipeline_stage` — `upload|schema_mapping|data_modeling|interview|kpi_selection|dimension_selection|recipe|dashboard`
- `datasets.pipeline_context` — JSON blob for KPI/dimension selections before recipe finalization

## Data Validation Points

| Stage | What is validated | Blocking? |
|-------|------------------|----------|
| File drop (client) | Extension (.xlsx/.csv), size ≤ 50MB | Yes |
| `POST /upload` | Encoding, header row, magic bytes | Yes (400) |
| Schema confirm | Duplicate column names across files; fact table needs ≥1 date + ≥1 measure | Error blocks |
| Data model confirm | Circular FK graph; FK referential integrity < 90% | Warning only |
| Custom KPI entry | Formula syntax + column existence via asteval | Blocks progression |
| Recipe generation | Required fields; KPI operands in confirmed columns | 422 |
| Recipe approve | All formulas valid; no unresolved errors | Blocks approve |
| Dashboard refresh | Schema drift (missing/renamed columns vs confirmed schema) | Warning banner |

## Key Constraints

- Files up to 50MB per upload, datasets up to ~500k rows
- Multi-client data isolation required (security + compliance)
- All KPI definitions must be auditable (confirmed_* nullable columns preserve AI suggestion)
- Human approval required before recipe is applied — no fully automated pipeline
- AI suggestions for schema/data model/KPIs/dimensions are all overridable by user
- Formula evaluation uses `asteval` sandbox (never raw `eval()`)
- `datasets.pipeline_stage` is the single source of truth for resuming an in-progress flow

## Key Files to Know

- `backend/catalog/kpis.json` — 99 BGO KPIs (proprietary IP, do not alter structure)
- `backend/db/schema.sql` — canonical SQLite schema (4 original tables)
- `backend/schemas/interview.py` — `RecipeConfig` is the central data contract for the recipe
- `backend/services/profiler.py` — existing type detection logic (extended by `schema_mapper.py`, not replaced)
- `backend/agent/report_factory_agent/agent.py` — Google ADK root agent (Claude Sonnet)
- `frontend/lib/types.ts` — all TypeScript interfaces
- `frontend/lib/api.ts` — all API client methods
