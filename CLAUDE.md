# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BGO Report Factory** — a self-service BI tool that lets operations users (Ops Managers, Team Leads, Program Managers) upload multiple Excel/CSV files and generate story-driven dashboards without relying on a centralised Power BI team.

Both the single-file and multi-file pipelines are end-to-end complete. The multi-file flow covers: deep profiling → schema relationship detection → hybrid AI interview (Flow 1) → KPI selection → dimension selection → data validation → story-driven dashboard generation.

The schema mapping step now includes AI-assisted table classification (fact / dimension / unknown) with user override, and a Virtual Dimension builder that synthesises a dimension table from shared columns when no Roster file was uploaded.

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
                             Includes table-type classification (fact/dimension/unknown) with override
                             Virtual Dimension builder available when no dimension file is uploaded
4. Relationship Detection    fuzzy column match, value overlap, cardinality across files
                             Detected relationships auto-saved to sessionStorage on page load
5. AI Interview (Flow 1)     side-panel chatbot — Q1 hard-coded, Q2+ dynamic from column profile
6. KPI Suggestion            scrollable checkable list, AI-first match then catalog fallback (≥0.55)
7. Dimension Selection       user picks which dimension columns drive breakdown charts
8. Data Validation           zero-value, null %, division-risk checks before dashboard
9. Dashboard Generation      story-driven sections via AI grouping; chart type editable per tile
                             Renders config.sections when present; falls back to flat layout for legacy
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
│   │   │                                 _is_metric_name() prevents low-cardinality metric cols
│   │   │                                 from being misclassified as categorical
│   │   ├── schema_relationships.py       cross-file FK/join inference
│   │   ├── kpi_suggester.py              AI-first KPI identification + catalog fallback
│   │   ├── data_validator.py             pre-dashboard data quality checks
│   │   ├── compute.py                    formula execution + cross-file JOINs
│   │   │                                 dynamic join key (cardinality-ranked, no name hardcoding)
│   │   │                                 cross-name value-overlap probe for non-matching key names
│   │   │                                 _apply_same_dimension_enrichment() propagates missing
│   │   │                                 filter columns via LEFT JOIN before concat
│   │   ├── virtual_dimension.py          builds synthetic dimension from shared fact-table columns
│   │   │                                 build_virtual_dimension() — pure function, no DB
│   │   │                                 store_virtual_dimension() — persists Upload + StagingTable
│   │   ├── recipe_generator.py           LEGACY — single-file only; superseded by session_generator
│   │   ├── session_generator.py          multi-file story-driven recipe generation
│   │   └── storage.py                    local/S3 file storage abstraction
│   ├── tests/
│   │   ├── test_compute_per_kpi_filter.py   16 tests — enrichment, join key, table classification
│   │   ├── test_profiler_classify.py         6 tests — metric-name fix (score/rating/pct/count)
│   │   ├── test_virtual_dimension.py        12 tests — build logic, stability filter, no hardcoding
│   │   └── test_virtual_dimension_endpoint.py  3 tests — store integration (SQLite + ORM)
│   ├── exporters/pptx_exporter.py
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── upload/page.tsx               Multi-file batch upload + per-file status
    │   ├── session/[datasetId]/
    │   │   ├── schema/page.tsx           per-file schema mapping + table-type override UI
    │   │   │                             Virtual Dimension builder (amber button, success/error banner)
    │   │   │                             Auto-saves detected relationships to sessionStorage on load
    │   │   ├── interview/page.tsx        hybrid Flow 1 chatbot
    │   │   ├── kpis/page.tsx             checkable KPI list
    │   │   └── dimensions/page.tsx       dimension selection for breakdown charts
    │   ├── dashboard/[recipeId]/page.tsx Story sections renderer (config.sections) + flat fallback
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
        │                                 buildVirtualDimension() → POST /session/{id}/virtual-dimension
        │                                 updateTableType() → PATCH /upload/{id}/table-type
        ├── types.ts                      BatchUploadResponse, extended ColumnProfile
        ├── format.ts                     number/date formatting utilities
        └── logger.ts                     frontend logging
```

---

## Key Patterns

**Profiling:** `services/profiler.py` — heuristic column type detection, `grain_score` (`unique_count / row_count`), pattern-based `semantic_tag`. User overrides in schema mapping UI; saved back to `StagingTable.profile_data`.

**Profiler metric-name fix:** Columns whose names contain metric keywords (`score`, `rating`, `pct`, `percent`, `rate`, `count`, `volume`, `avg`, `average`, `qty`, `quantity`) are always classified as `numeric/measure` even when `unique_count ≤ 5`. Without this fix, columns like `csat_score` (0/1 binary) or `adherence_pct` (90/95/100) were misclassified as categorical and hidden from the KPI suggester. The check is in `_is_metric_name(name)` at the top of `profiler.py`.

**KPI matching:** `services/kpi_suggester.py` — AI-first: sends column names + sample rows to LLM; LLM returns full KPI dicts with formula, aggregation, format. `SequenceMatcher` against `catalog/kpis.json` is used only as fallback when AI fails (threshold 0.55). Supports AI-generated custom KPIs not in catalog. **KPI suggestions are scoped to uploaded files for that session** — different file combinations in different sessions will yield different KPI lists.

**Table classification:** `services/compute.py` uses AI to classify each uploaded table as `fact` or `dimension`. Users can override via `PATCH /upload/{id}/table-type`. Classification is stored in `StagingTable.profile_data["table_type"]` and governs which tables are treated as fact tables vs. dimension/lookup tables during compute.

**Compute cross-file JOIN:** `services/compute.py` executes formulas against staging data. Join key selection is **purely cardinality-based** — the column with highest cardinality among same-name candidates is selected as the join key. No column name assumptions are made. If no same-name column exists, a cross-name value-overlap probe finds matching columns by comparing value sets. `_apply_same_dimension_enrichment()` propagates missing filter columns via LEFT JOIN before concatenation so filters work across independently-structured fact tables.

**Virtual Dimension:** `services/virtual_dimension.py` synthesises a dimension table when no Roster/dimension file was uploaded.
- `build_virtual_dimension(staging_dfs, min_tables)` — pure function, no DB. Finds non-numeric columns shared across ≥ `min_tables` tables, stacks rows, picks entity key as the **highest-cardinality column** (purely cardinality-driven — no name assumptions). For `min_tables=1` applies a stability filter: only columns with ≤ 1 unique value per entity group are kept (excludes per-row evaluation columns like `rubric_name`).
- `store_virtual_dimension(dataset_id, staging_dfs, db, engine, client_id)` — persists the result. Auto-detects `effective_min_tables = 1` for single-file datasets, `2` for multi-file. Creates a synthetic `Upload` with `filename="__virtual_dimension__"` and a `StagingTable` with `profile_data["table_type"]="virtual_dimension"`. Must call `db.commit()` before `df.to_sql()` to avoid SQLite write-lock (two connections).
- The virtual dimension is then available for filter enrichment exactly like a real dimension file.

**Virtual Dimension UI:** `schema/page.tsx` shows an amber "Build Virtual Dimension" button when all files are classified as fact/unknown. On success it displays the row count and column list in a green banner. On failure it shows the error message. State: `vdBuilding`, `vdResult`, `vdError`.

**Recipe → Dashboard:** `services/session_generator.py` (multi-file flow) groups KPIs into story sections (Overview / Performance Trends / Breakdown Analysis / Data Quality) via AI prompt, then falls back to a single "Dashboard Overview" section if AI fails. The generated recipe stores sections in `config.sections`. The dashboard renderer (`dashboard/[recipeId]/page.tsx`) conditionally renders `config.sections` when present and falls back to a flat layout for legacy recipes that pre-date this field. `services/recipe_generator.py` is **legacy** — single-file only, not used in the multi-file flow.

**Schema memory:** On recipe approval, column mappings saved to `schema_memory` (keyed by `client_id + template_type`). Second run with same client + template skips fuzzy matching.

**SQLite locking:** When writing a staging table via pandas `to_sql`, always call `db.commit()` first to release the SQLAlchemy session write lock before pandas opens a second connection. Failure to do so causes `OperationalError: database is locked`.

---

## Anti-Hardcoding Principle (CRITICAL)

**Never hardcode column names, dimension names, or join keys anywhere in backend logic.**

End users upload files with arbitrary headers. Any code that references a specific column name (`agent_email`, `agent_id`, `roster_id`, etc.) will break when a different client uploads data with different headers.

All join key selection, entity detection, and dimension mapping must be:
- **Cardinality-based** — the column with the highest `unique_count` becomes the entity/join key
- **Type-based** — only non-numeric columns are eligible for dimension tables
- **Structure-based** — columns shared across ≥ N tables are common dimensions
- **Value-overlap-based** — cross-file joins use value set overlap probing, not name matching

The test `test_entity_key_detection_is_name_agnostic` in `test_virtual_dimension.py` uses columns named `staff_ref`, `full_name`, `skill_tag` (no email/id terminology) to prove the algorithm makes zero name assumptions.

---

## Test Suite (37 tests, all passing)

```
backend/tests/
├── test_compute_per_kpi_filter.py    16 tests
│   Covers: same-dimension enrichment, join key selection, cross-name value-overlap,
│           LEFT JOIN with duplicate key guard, 3-table datasets, table classification
│
├── test_profiler_classify.py          6 tests
│   Covers: csat_score binary→measure, avg_csat_rating→measure, csat_survey_volume→measure,
│           is_deleted stays categorical, qa_score string-numeric→measure, adherence_pct→measure
│
├── test_virtual_dimension.py         12 tests
│   Covers: common cols included, single-table cols excluded, numeric cols excluded,
│           no-common→None, empty→None, deduplication, entity key = highest cardinality,
│           min_tables=1 override, stability filter (stable included / unstable excluded),
│           name-agnostic entity key detection, single-file auto min_tables
│
└── test_virtual_dimension_endpoint.py  3 tests
    Covers: StagingTable created with table_type="virtual_dimension",
            returns None for no common cols, physical staging table readable after store
```

Run all tests from `backend/`:
```bash
pytest tests/ -v
```

---

## API Routes

```
# Upload
POST   /upload                            Single file (backwards compatibility)
POST   /upload/batch                      Batch multi-file upload → returns dataset_id + upload list
GET    /upload/{id}                       Poll profiling status
GET    /upload/{id}/profile               Column profile data
POST   /upload/{id}/schema                Save user schema overrides
PATCH  /upload/{id}/table-type            Override AI table classification (fact/dimension/unknown)
                                          Stores in StagingTable.profile_data["table_type"]

# Session (multi-file flow)
POST   /session/{id}/relationships        Infer cross-file relationships
POST   /session/{id}/interview            Flow 1 hybrid interview
GET    /session/{id}/interview/state      Interview step + collected answers
POST   /session/{id}/interview/skip       Skip interview → default result
POST   /session/{id}/kpi-suggestions      Suggest KPIs from catalog + interview
GET    /session/{id}/dimensions           List dimension columns across all uploads
POST   /session/{id}/virtual-dimension    Build + store virtual dimension from shared fact columns
                                          Returns: upload_id, table_name, row_count, column_count, columns[]
                                          422 if no qualifying common columns found
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
