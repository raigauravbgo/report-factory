# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BGO Report Factory** — a self-service BI tool that lets operations users (Ops Managers, Team Leads, Program Managers) upload multiple Excel/CSV files and generate story-driven dashboards without relying on a centralised Power BI team.

The working end-to-end flow (single-file upload → AI interview → dashboard) is complete. Active work expands this into a multi-file pipeline: deep profiling, schema relationship detection, hybrid AI interview (Flow 1), checkable KPI selection, data validation, and story-driven dashboard generation.

**Reference documents:**
- [PRD3.md](PRD3.md) — product requirements (single source of truth)
- [project_plan1.md](project_plan1.md) — task tracker (checkboxes per phase)

---

## Current Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16 App Router | Port 3000 |
| Backend | FastAPI (Python) | Port 8000 |
| Agent framework | Google ADK 2.1.0 | Python-only; no GCP/AWS dependency |
| Database | SQLite (dev) → PostgreSQL (prod) | `DATABASE_URL` in `.env` |
| File storage | Local `backend/local_uploads/` (dev) | Railway Volume in prod |
| AI — default | OpenAI `gpt-4o-mini` | `LLM_PROVIDER=openai` |
| AI — alternate | Anthropic `claude-sonnet-4-20250514` | `LLM_PROVIDER=anthropic` |
| Charts | Recharts | |
| Export | openpyxl (Excel) + python-pptx (PPTX) | |
| Deployment | Railway | No AWS or GCP dependencies |

---

## LLM Provider Switching

All AI calls go through `backend/services/ai_client.py`. Switch providers via `.env` only — no code change required.

```
LLM_PROVIDER=openai           # or: anthropic
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Never call `openai.*` directly outside `ai_client.py`.

---

## 8-Step Pipeline

```
1. Multi-File Upload         POST /upload/batch — CSV + Excel simultaneously (up to 10 files)
2. Deep Profiling            encoding, delimiter, sheet names, column types, null/dupe counts
3. Schema Mapping            AI auto-classifies Dimension/Measure/Date/Key + grain; user editable
4. Relationship Detection    fuzzy column match, value overlap, cardinality across files
5. AI Interview (Flow 1)     side-panel chatbot — Q1 hard-coded, Q2+ dynamic from column profile
6. KPI Suggestion            scrollable checkable list, semantic match against KPI registry
7. Data Validation           zero-value, null %, division-risk checks before dashboard
8. Dashboard Generation      story-driven sections via template; chart type editable per tile
```

Interview (Step 5) is **optional** — user may skip directly to KPI selection.

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
│   ├── agent/report_factory_agent/       ADK agent + 6 tools
│   ├── api/routes/                       upload, interview, kpis, reports, dashboard
│   ├── catalog/
│   │   ├── kpis.json                     69 KPI definitions
│   │   └── templates/                    4 templates (client_health, wbr_qbr, exec_scorecard, kpi_spotlight)
│   ├── core/                             config.py, database.py
│   ├── models/                           SQLAlchemy ORM (Dataset, Upload, StagingTable, ReportRecipe, ...)
│   ├── services/                         ai_interview, ai_client, parser, profiler, compute, recipe_generator, ...
│   │   ├── schema_relationships.py       NEW — cross-file join/FK inference
│   │   ├── kpi_suggester.py              NEW — catalog fuzzy match + interview boost
│   │   └── data_validator.py             NEW — pre-dashboard data quality checks
│   ├── exporters/pptx_exporter.py
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── upload/page.tsx               Multi-file batch upload + per-file status
    │   ├── session/[datasetId]/
    │   │   ├── schema/page.tsx           NEW — per-file schema mapping UI
    │   │   ├── interview/page.tsx        NEW — hybrid Flow 1 chatbot
    │   │   └── kpis/page.tsx             NEW — checkable KPI list
    │   ├── dashboard/[recipeId]/page.tsx Story-driven sections + chart type switcher
    │   └── ...existing pages unchanged
    ├── components/
    │   ├── UploadZone.tsx                maxFiles: 10, onFiles callback
    │   ├── ColumnTable.tsx               + semantic_tag + grain columns
    │   └── SchemaRelationships.tsx       NEW — relationship card display
    └── lib/
        ├── api.ts                        + batch upload + session endpoints
        └── types.ts                      + BatchUploadResponse, extended ColumnProfile
```

---

## Key Patterns

**Profiling:** `services/profiler.py` — heuristic column type detection, `grain_score` (`unique_count / row_count`), pattern-based `semantic_tag`. User overrides in schema mapping UI; saved back to `StagingTable.profile_data`.

**KPI matching:** `services/kpi_suggester.py` — `SequenceMatcher` against `source_fields` + `aliases` in `catalog/kpis.json`. Confidence < 0.7 = manual dropdown fallback.

**Recipe → Dashboard:** `services/recipe_generator.py` groups KPIs into story sections (Overview / Performance Trends / Breakdown / Data Quality) via AI prompt. `services/compute.py` executes formulas against staging data, with optional cross-file JOIN if relationships confirmed.

**Schema memory:** On recipe approval, column mappings saved to `schema_memory` (keyed by `client_id + template_type`). Second run with same client + template skips fuzzy matching.

---

## API Routes

```
# Upload
POST   /upload                            Single file (keep for backwards compatibility)
POST   /upload/batch                      Batch multi-file upload → returns dataset_id + upload list
GET    /upload/{id}                       Poll profiling status
GET    /upload/{id}/profile               Column profile data
POST   /upload/{id}/schema                Save user schema overrides

# Session (new multi-file flow)
POST   /session/{id}/relationships        Infer cross-file relationships
POST   /session/{id}/interview            Flow 1 hybrid interview
GET    /session/{id}/interview/state      Interview step + collected answers
POST   /session/{id}/kpi-suggestions      Suggest KPIs from catalog + interview
POST   /session/{id}/validate             Pre-dashboard data validation
POST   /session/{id}/generate             Create recipe + navigate to dashboard

# Interview + Recipe (existing)
POST   /interview                         ADK primary + OpenAI fallback
POST   /interview/recipe
GET    /interview/recipe/{id}
POST   /interview/recipe/{id}/approve

# Dashboard (existing)
GET    /api/dashboard/{id}/data
GET    /api/dashboard/{id}/filter-values
GET    /api/dashboard/{id}/export/excel
GET    /api/dashboard/{id}/export/pptx

# KPI Catalog + Review Queue (existing)
GET/POST /api/kpis
GET      /api/reports/review-queue/list
POST     /api/reports/review-queue/{id}/approve
POST     /api/reports/review-queue/{id}/reject
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
