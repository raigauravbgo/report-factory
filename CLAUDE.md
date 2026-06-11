# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BGO Report Factory** — a self-service BI tool that lets operations users (Ops Managers, Team Leads, Program Managers) upload multiple Excel/CSV files and generate story-driven dashboards without relying on a centralised Power BI team.

Both the single-file and multi-file pipelines are end-to-end complete. The multi-file flow covers: deep profiling → schema relationship detection → hybrid AI interview (Flow 1) → KPI selection → dimension selection → data validation → story-driven dashboard generation.

**Reference documents:**
- [PRD3.md](PRD3.md) — product requirements (single source of truth)
- [project_plan1.md](project_plan1.md) — task tracker (checkboxes per phase)

---

## Current Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4 | Port 3000 |
| Backend | FastAPI 0.136, Python | Port 8000 |
| Agent framework | Google ADK 2.1.0 + LiteLLM 1.85 | Python-only; LiteLLM routes OpenAI calls inside ADK |
| ORM / migrations | SQLAlchemy 2.0 + Alembic | |
| Database | SQLite (dev) → PostgreSQL (prod) | `DATABASE_URL` in `.env` |
| File storage | Local `backend/local_uploads/` (dev) | S3 via boto3 (prod); `S3_BUCKET` in `.env` |
| AI — default | OpenAI `gpt-4o-mini` | `LLM_PROVIDER=openai`; `config.py` defaults to `gpt-4o`, override via `OPENAI_MODEL` |
| AI — alternate | Anthropic `claude-sonnet-4-20250514` | `LLM_PROVIDER=anthropic` |
| AI — azure | Azure OpenAI | `LLM_PROVIDER=azure`; `USE_AZURE_OPENAI=true` |
| Charts | Recharts 3.8 | |
| Export | openpyxl 3.1 (Excel) + python-pptx 1.0 (PPTX) | |
| Deployment | Railway | No direct GCP dependency |

---

## LLM Provider Switching

All AI calls go through `backend/services/ai_client.py`. Three providers supported — switch via `.env` only, no code change required.

```
LLM_PROVIDER=openai           # or: anthropic | azure
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini      # config.py code-default is gpt-4o; always set this in .env
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
# Azure OpenAI (optional)
USE_AZURE_OPENAI=true
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_DEPLOYMENT=...
```

Never call `openai.*` directly outside `ai_client.py`.

---

## 9-Step Pipeline

```
1. Multi-File Upload         POST /upload/batch — CSV + Excel simultaneously (up to 10 files)
2. Deep Profiling            encoding, delimiter, sheet names, column types, null/dupe counts
3. Schema Mapping            AI auto-classifies Dimension/Measure/Date/Key + grain; user editable
4. Relationship Detection    fuzzy column match, value overlap, cardinality across files
5. AI Interview (Flow 1)     side-panel chatbot — Q1 hard-coded, Q2+ dynamic from column profile
6. KPI Suggestion            scrollable checkable list, AI-first match then catalog fallback (≥0.55)
7. Dimension Selection       user picks which dimension columns drive breakdown charts
8. Data Validation           zero-value, null %, division-risk checks before dashboard
9. Dashboard Generation      story-driven sections via AI grouping; chart type editable per tile
```

Interview (Step 5) is **optional** — user may skip directly to KPI selection (`POST /session/{id}/interview/skip`).

---

## Two Interview Flows

| | Flow 1 (current) | Flow 2 (deferred) |
|---|---|---|
| Status | Build and test first | Do NOT start until Flow 1 is end-to-end tested |
| Q1 | Hard-coded: "What type of data does this represent?" | Same |
| Q2–Q6 | AI-generated dynamically from column profiles | Fully agent-driven |

---

## Upload Limits (enforced in `services/parser.py`)

| Constraint | Limit | Env var |
|---|---|---|
| Excel rows | 200,000 max | `MAX_EXCEL_ROWS` |
| CSV rows | 200,000 max | `MAX_CSV_ROWS` |
| File size | 50 MB per file | `MAX_UPLOAD_SIZE_MB` |
| Columns per file | 200 max | `MAX_COLUMNS_PER_FILE` |
| Files per batch | 10 max | `MAX_UPLOAD_FILES` |

CSV encoding: always use `chardet` + `csv.Sniffer` — never assume comma-separated.

---

## Project Structure

```
report-factory/
├── backend/
│   ├── main.py                           FastAPI app
│   ├── agent/report_factory_agent/       ADK agent + 6 tools (intake, define_kpi, data_discovery,
│   │                                     data_discovery_from_upload, standardise, generate)
│   ├── api/routes/                       upload, interview, kpis, reports, dashboard, session, log
│   ├── catalog/
│   │   ├── kpis.json                     86 KPI definitions
│   │   └── templates/                    4 templates (client_health, wbr_qbr, exec_scorecard, kpi_spotlight)
│   ├── core/                             config.py, database.py
│   ├── models/                           SQLAlchemy ORM
│   │                                     Dataset, Upload, StagingTable, ReportRecipe,
│   │                                     ProcessedTable, KpiDefinition, DashboardConfig
│   ├── services/
│   │   ├── ai_client.py                  OpenAI / Anthropic / Azure abstraction
│   │   ├── ai_interview.py               Flow 1 hybrid interview
│   │   ├── adk_runner.py                 ADK agent orchestration (Flow 2, disabled by default)
│   │   ├── parser.py                     CSV + Excel ingestion
│   │   ├── profiler.py                   column type detection, grain_score, semantic_tag
│   │   ├── schema_relationships.py       cross-file FK/join inference
│   │   ├── kpi_suggester.py              AI-first KPI identification + catalog fallback
│   │   ├── data_validator.py             pre-dashboard data quality checks
│   │   ├── compute.py                    formula execution + cross-file JOINs
│   │   ├── recipe_generator.py           LEGACY — single-file only; superseded by session_generator
│   │   ├── session_generator.py          multi-file story-driven recipe generation
│   │   └── storage.py                    local/S3 file storage abstraction
│   ├── exporters/pptx_exporter.py
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── upload/page.tsx               Multi-file batch upload + per-file status
    │   ├── session/[datasetId]/
    │   │   ├── schema/page.tsx           per-file schema mapping UI
    │   │   ├── interview/page.tsx        hybrid Flow 1 chatbot
    │   │   ├── kpis/page.tsx             checkable KPI list
    │   │   └── dimensions/page.tsx       dimension selection for breakdown charts
    │   ├── dashboard/[recipeId]/page.tsx Story-driven sections + chart type switcher
    │   ├── interview/page.tsx            legacy single-file interview
    │   ├── profile/[uploadId]/page.tsx   legacy single-file profile view
    │   ├── recipe/[recipeId]/page.tsx    legacy single-file recipe view
    │   ├── reports/[reportId]/page.tsx   report detail view
    │   └── review-queue/page.tsx         ops review queue
    ├── components/
    │   ├── UploadZone.tsx                maxFiles: 10, onFiles callback
    │   ├── ColumnTable.tsx               semantic_tag + grain columns
    │   ├── SchemaRelationships.tsx       relationship card display
    │   ├── filters/FilterBar.tsx         dashboard filter bar
    │   ├── layout/DarkSidebar.tsx        app sidebar
    │   ├── ui/ChartCard.tsx              chart tile wrapper
    │   ├── ui/InsightPanel.tsx           narrative insight panel
    │   ├── ui/SectionHeader.tsx          dashboard section header
    │   ├── ui/TrendBadge.tsx             metric trend indicator
    │   └── kpis/KpiSummaryCard.tsx       KPI summary card
    └── lib/
        ├── api.ts                        batch upload + session endpoints
        ├── types.ts                      BatchUploadResponse, extended ColumnProfile
        ├── format.ts                     number/date formatting utilities
        └── logger.ts                     frontend logging
```

---

## Key Patterns

**Profiling:** `services/profiler.py` — heuristic column type detection, `grain_score` (`unique_count / row_count`), pattern-based `semantic_tag`. User overrides in schema mapping UI; saved back to `StagingTable.profile_data`.

**KPI matching:** `services/kpi_suggester.py` — AI-first: sends column names + sample rows to LLM; LLM returns full KPI dicts with formula, aggregation, format. `SequenceMatcher` against `catalog/kpis.json` is used only as fallback when AI fails (threshold 0.55). Supports AI-generated custom KPIs not in catalog.

**Recipe → Dashboard:** `services/session_generator.py` (multi-file flow) groups KPIs into story sections (Overview / Performance Trends / Breakdown Analysis / Data Quality) via AI prompt, then falls back to a single "Dashboard Overview" section if AI fails. `services/recipe_generator.py` is **legacy** — single-file only, not used in the multi-file flow. `services/compute.py` executes formulas against staging data, with cross-file LEFT JOIN when `confirmed_relationships` contain `pk_fk` entries.

**Schema memory:** On recipe approval, column mappings saved to `schema_memory` (keyed by `client_id + template_type`). Second run with same client + template skips fuzzy matching.

---

## API Routes

```
# Upload
POST   /upload                            Single file (backwards compatibility)
POST   /upload/batch                      Batch multi-file upload → returns dataset_id + upload list
GET    /upload/{id}                       Poll profiling status
GET    /upload/{id}/profile               Column profile data
POST   /upload/{id}/schema                Save user schema overrides

# Session (multi-file flow)
POST   /session/{id}/relationships        Infer cross-file relationships
POST   /session/{id}/interview            Flow 1 hybrid interview
GET    /session/{id}/interview/state      Interview step + collected answers
POST   /session/{id}/interview/skip       Skip interview → default result
POST   /session/{id}/kpi-suggestions      Suggest KPIs from catalog + interview
GET    /session/{id}/dimensions           List dimension columns across all uploads
POST   /session/{id}/validate             Pre-dashboard data validation
POST   /session/{id}/generate             Create recipe + navigate to dashboard

# Interview + Recipe (legacy single-file)
POST   /interview                         ADK primary + OpenAI fallback
POST   /interview/recipe
GET    /interview/recipe/{id}
POST   /interview/recipe/{id}/approve

# Dashboard
GET    /api/dashboard/{id}/data
GET    /api/dashboard/{id}/filter-values
GET    /api/dashboard/{id}/export/excel
GET    /api/dashboard/{id}/export/pptx
GET    /api/dashboard/{id}/validate-config   Pre-flight data integrity check
POST   /api/dashboard/{id}/validate-formula  Test-compute a single KPI formula
PATCH  /api/dashboard/{id}/config            Update mutable recipe config fields

# KPI Catalog
GET/POST /api/kpis
GET      /api/kpis/{id}
POST     /api/kpis/{id}/review               Mark KPI as reviewed/un-reviewed

# Reports + Review Queue
POST   /api/reports                          Create report
GET    /api/reports                          List reports
GET    /api/reports/{id}                     Get report by ID
POST   /api/reports/{id}/upload              Upload file to report
POST   /api/reports/{id}/confirm-mapping     Confirm column mapping
GET    /api/reports/{id}/dashboard           Get dashboard for report
GET    /api/reports/{id}/schema-memory       Check schema memory hit
GET    /api/reports/review-queue/list
GET    /api/reports/review-queue/{id}/new-kpis  Unreviewed KPIs for review entry
POST   /api/reports/review-queue/{id}/approve
POST   /api/reports/review-queue/{id}/reject

# Logging
POST   /api/log/event                        Log frontend events
```

---

## Out of Scope (Current Phase)

- Flow 2 dynamic interview (after Flow 1 is end-to-end tested)
- PostgreSQL migration (`DATABASE_URL` swap only — no code changes)
- pgvector semantic matching
- Langfuse observability
- SSO / authentication
- Scheduled refresh
- PDF export
