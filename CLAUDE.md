# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**BGO Report Factory** — a self-service BI tool that lets operations users (Ops Managers, Team Leads, Program Managers) upload multiple Excel/CSV files and generate story-driven dashboards without relying on a centralised Power BI team.

Both the single-file and multi-file pipelines are end-to-end complete. The multi-file flow covers: deep profiling → schema relationship detection → AI interview (Flow 1 or ADK) → KPI selection → dimension selection → data validation → story-driven dashboard generation.

The schema mapping step includes AI-assisted table classification (fact / dimension / unknown) with user override, and a Virtual Dimension builder that synthesises a dimension table from shared columns when no Roster file was uploaded.

**Template fast-path:** After profiling, the upload page checks for saved templates at ≥ 95% column overlap. When a match is found the user can apply it and jump directly to a Review page — skipping the full interview/KPI/dimension pipeline.

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
| AI — default | OpenAI `gpt-4o-mini` | `LLM_PROVIDER=openai`; `config.py` code-default is `gpt-4o`, always override via `OPENAI_MODEL` in `.env` |
| AI — alternate | Anthropic `claude-sonnet-4-20250514` | `LLM_PROVIDER=anthropic` |
| AI — azure | Azure OpenAI | `LLM_PROVIDER=azure`; `USE_AZURE_OPENAI=true` |
| Charts | Recharts 3.8 | |
| Markdown rendering | react-markdown | Used in interview chat to render ADK agent responses |
| Export | openpyxl 3.1 (Excel) + python-pptx 1.0 (PPTX) | |
| Auth / security | python-jose + cryptography | JWT groundwork — SSO not yet enabled |
| Deployment | Railway | No direct GCP dependency |

---

## LLM Provider Switching

All AI calls go through `backend/services/ai_client.py`. Three providers supported — switch via `.env` only, no code change required. Every call is automatically logged to `llm_call_logs` via `services/observability.py`.

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

# ADK agent (for session interview — full end-to-end dashboard in chat)
ADK_ENABLED=false             # true = ADK agent handles the session interview, falls back to Flow 1
ADK_PROVIDER=openai           # openai (via LiteLLM) | anthropic
ADK_MODEL=gpt-4o-mini
```

**Provider precedence rule:** `LLM_PROVIDER=openai` always wins over `USE_AZURE_OPENAI=true`. Only set `LLM_PROVIDER=azure` explicitly to use Azure. Never call `openai.*` directly outside `ai_client.py`.

---

## Two Pipeline Paths

### Standard path (9 steps)
```
1. Multi-File Upload         POST /upload/batch — CSV + Excel simultaneously (up to 10 files)
2. Deep Profiling            encoding, delimiter, sheet names, column types, null/dupe counts
3. Schema Mapping            AI auto-classifies Dimension/Measure/Date/Key + grain; user editable
                             Includes table-type classification (fact/dimension/unknown) with override
                             Virtual Dimension builder available when no dimension file is uploaded
                             Relationship confirm: saves to sessionStorage only — does NOT mutate
                             the suggestions list (avoids index-shift bug in SchemaRelationships)
4. Relationship Detection    fuzzy column match, value overlap, cardinality across files
                             Detected relationships auto-saved to sessionStorage on page load
5. AI Interview              Two modes — see "Two Interview Modes" below
6. KPI Suggestion            scrollable checkable list, AI-first match then catalog fallback (≥0.55)
7. Dimension Selection       user picks which dimension columns drive breakdown charts
8. Data Validation           zero-value, null %, division-risk checks before dashboard
9. Dashboard Generation      story-driven sections via AI grouping; chart type editable per tile
                             Renders config.sections when present; falls back to flat layout for legacy
```

Interview (Step 5) is **optional** — user may skip directly to KPI selection (`POST /session/{id}/interview/skip`).

### Template fast-path (bypasses steps 5–8)
```
After Step 2 (all files profiled):
  Upload page → POST /api/templates/match (≥ 95% column overlap check)
  If match found → /session/{id}/review
    Review page loads saved template config (KPIs, date_column, granularity, dimensions, filters)
    User makes permanent (saved back to template) or session-only overrides
    Publish → POST /session/{id}/generate → Dashboard
```

---

## Two Interview Modes

| | Flow 1 (step-by-step) | ADK Agent (AI-guided) |
|---|---|---|
| **When active** | `ADK_ENABLED=false` (default) or ADK fallback | `ADK_ENABLED=true` in `.env` |
| **Entry point** | `services/ai_interview.py:run_flow1()` | ADK agent in `agent/report_factory_agent/` |
| **Flow** | Q1 hard-coded → Q2–Q6 AI-generated from profiles | Agent discovers data → asks batched Q1–Q6 → suggests KPIs → suggests dimensions → generates dashboard — all in one chat |
| **UI indicator** | "Data Interview" header, "Question X of 6" step counter, teal progress bar | "AI-Guided Dashboard Setup" header, "AI Agent active" badge, indeterminate indigo pulse bar |
| **Response flag** | `is_adk_mode: false` | `is_adk_mode: true` — locked on first response, UI stays ADK even if later turns fall back |
| **Completion** | `completed=true` → user navigates to KPI page | Dashboard generated inside chat → "View Dashboard →" button appears (no auto-redirect) |
| **Fallback** | — | Any ADK exception → silent fallback to Flow 1; trace event written with status `error` |

**ADK Session Flow (when `ADK_ENABLED=true`):**
1. First turn injects `[DATASET UPLOADED]` context block. If `upload_ids` arrives empty (frontend race), backend DB-queries all uploads for the dataset as fallback.
2. Agent calls `run_data_discovery_from_upload(primary_upload_id)` → greets user with data summary
3. Agent asks Q1–Q6 (batched naturally, not as a numbered list)
4. Agent calls `run_session_kpi_suggest(dataset_id, upload_ids, interview_answers)`
5. Agent calls `run_session_dimensions(dataset_id)`
6. Agent calls `run_session_generate(dataset_id, selected_kpis, interview_result)`
7. Backend detects new `ReportRecipe` row (DB-poll: `id > pre_turn_max_id`) → returns `completed=true, recipe_id=N`
8. Frontend shows "View Dashboard →" button

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
│   ├── main.py                           FastAPI app — registers all routers + runs Alembic migrations on startup
│   ├── agent/report_factory_agent/       ADK agent (9 tools; enabled via ADK_ENABLED=true)
│   │   ├── agent.py                      root_agent definition; resolves model via ADK_PROVIDER/ADK_MODEL
│   │   │                                 Plain-language instructions — no markdown headers in agent output
│   │   └── tools/
│   │       ├── intake.py                 run_intake() — validates template + KPI list (legacy single-file)
│   │       ├── define_kpi.py             run_define_new_kpi() — creates user-defined KPI in catalog
│   │       ├── data_discovery.py         run_data_discovery() — file-path based discovery (pure ADK sessions)
│   │       ├── data_discovery_from_upload.py  run_data_discovery_from_upload() — loads staging profile, fuzzy-matches KPIs
│   │       ├── standardise.py            run_standardise() — compute KPI values from confirmed mapping (legacy)
│   │       ├── generate.py               run_generate() — builds chart-ready JSON, submits to review queue (legacy)
│   │       ├── session_kpi_suggest.py    run_session_kpi_suggest() — session-flow KPI suggestions; emits trace events
│   │       ├── session_dimensions.py     run_session_dimensions() — 4-branch star-schema dimension list; emits trace events
│   │       └── session_generate.py       run_session_generate() — calls generate_from_session(); emits trace events
│   ├── api/routes/
│   │   ├── upload.py                     single + batch upload, profiling poll, schema overrides, table-type patch
│   │   ├── session.py                    multi-file pipeline: relationships, interview (ADK + Flow 1 fallback),
│   │   │                                 KPI suggestions, dimensions (4-branch star-schema), virtual-dimension,
│   │   │                                 validate, generate
│   │   │                                 InterviewTurnResponse includes is_adk_mode: bool flag
│   │   │                                 First-turn fallback: DB-queries upload IDs when body.upload_ids is empty
│   │   ├── interview.py                  legacy single-file interview (ADK + Flow 1 fallback)
│   │   ├── dashboard.py                  dashboard data, filter values, excel/pptx export, config patch
│   │   │                                 Library endpoint: GET /api/dashboard → prefetched list for home page
│   │   ├── kpis.py                       catalog CRUD; custom KPI proposals (list/approve/reject)
│   │   │                                 POST /api/kpis/custom/{id}/approve writes to kpis.json with
│   │   │                                 file-rollback if DB commit fails
│   │   ├── templates.py                  report template CRUD + column-fingerprint matching
│   │   │                                 POST /api/templates/match → ≥ 95% column overlap scoring
│   │   ├── reports.py                    legacy report lifecycle + review queue
│   │   └── log.py                        frontend event logging
│   ├── catalog/
│   │   ├── kpis.json                     KPI definitions (87 KPIs; AI-approved custom KPIs append here)
│   │   └── templates/                    4 chart templates (client_health, wbr_qbr, exec_scorecard, kpi_spotlight)
│   ├── core/
│   │   ├── config.py                     pydantic-settings; reads .env from project root
│   │   └── database.py                   SQLAlchemy engine + get_db dependency
│   ├── models/                           SQLAlchemy ORM (all imported in main.py before create_all)
│   │   ├── dataset.py                    Dataset — session container for a batch of uploads
│   │   ├── upload.py                     Upload — one file per row; status: pending|profiling|profiled|failed
│   │   ├── staging_table.py              StagingTable — profile_data JSON + physical SQLite table name
│   │   ├── report_recipe.py              ReportRecipe — recipe config JSON (KPIs, date_col, sections, etc.)
│   │   ├── kpi_definition.py             KpiDefinition — per-recipe KPI rows
│   │   ├── dashboard_config.py           DashboardConfig — optional mutable overlay on recipe
│   │   ├── processed_table.py            ProcessedTable — post-compute results (legacy)
│   │   ├── custom_kpi_proposal.py        CustomKpiProposal — AI-generated KPIs pending ops approval
│   │   │                                 status: pending | approved | rejected
│   │   ├── report_template.py            ReportTemplate — saved config + file_fingerprints for column-overlap matching
│   │   ├── llm_call_log.py               LlmCallLog — every LLM API call logged (prompt hashed, never raw)
│   │   │                                 Fields: provider, model, task_type, prompt_hash, input_token_estimate,
│   │   │                                 output_token_estimate, latency_ms, status, error_message, created_at
│   │   └── agent_trace_event.py          AgentTraceEvent — per-step ADK pipeline trace
│   │                                     Fields: run_id, step_name, skill_name, status, confidence,
│   │                                     message, evidence_json, requires_review, created_at
│   │                                     Allowed statuses: success | warning | pending | error | blocked
│   ├── services/
│   │   ├── ai_client.py                  OpenAI / Anthropic / Azure abstraction; provider precedence fixed
│   │   │                                 chat_complete() accepts task_type="..." for llm_call_logs
│   │   │                                 Every call auto-logged via observability._log() (fire-and-forget)
│   │   ├── observability.py              LLM call logging + agent trace events
│   │   │                                 log_llm_call() — hashes prompt (SHA-256 first 16 chars), estimates tokens
│   │   │                                 create_trace_event() — validates status, writes AgentTraceEvent
│   │   │                                 Both functions are fire-and-forget: never raise, never crash callers
│   │   │                                 Raw prompt text and uploaded data are NEVER stored
│   │   ├── ai_interview.py               Flow 1 hybrid interview; run_flow1() + default_interview_result()
│   │   ├── adk_runner.py                 ADK runner (InMemorySessionService + Runner); disabled by default
│   │   │                                 run_turn() creates session on first use, returns agent text
│   │   │                                 Raises RuntimeError on failure → caller falls back to Flow 1
│   │   ├── parser.py                     CSV + Excel ingestion with chardet + csv.Sniffer; safe path traversal
│   │   ├── profiler.py                   column type detection, grain_score, semantic_tag
│   │   │                                 _is_metric_name() prevents low-cardinality metric cols (score/rating/
│   │   │                                 pct/count/volume) from being misclassified as categorical
│   │   ├── schema_relationships.py       cross-file FK/join inference; confidence capped at 0.95 ceiling
│   │   ├── kpi_suggester.py              AI-first KPI identification + catalog fallback (threshold 0.55)
│   │   ├── data_validator.py             pre-dashboard data quality checks; regex denominator extraction
│   │   ├── compute.py                    formula execution + cross-file JOINs; in-memory DF cache (120s TTL)
│   │   │                                 cardinality-based join key selection; cross-name value-overlap probe
│   │   │                                 _apply_same_dimension_enrichment() — LEFT JOIN filter propagation
│   │   │                                 4-branch relationship enrichment via _apply_relationships()
│   │   ├── virtual_dimension.py          builds synthetic dimension from shared fact-table columns
│   │   │                                 build_virtual_dimension() — pure function, no DB
│   │   │                                 store_virtual_dimension() — persists Upload + StagingTable
│   │   ├── session_generator.py          multi-file story-driven recipe generation
│   │   │                                 generate_from_session() — builds filename→staging map, persists all upload IDs
│   │   ├── recipe_generator.py           LEGACY — single-file only; not used in multi-file flow
│   │   └── storage.py                    local/S3 file storage; _safe_local_path() prevents path traversal
│   ├── tests/                            58 tests — all passing
│   │   ├── test_compute_per_kpi_filter.py    25 tests — enrichment, join key, cross-name, relationships
│   │   ├── test_get_dimensions.py             8 tests — 4-branch dimension priority (virtual→dim→shared→fallback)
│   │   ├── test_profiler_classify.py          6 tests — metric-name fix (score/rating/pct/count)
│   │   ├── test_schema_relationships.py       4 tests — same-name + cross-name value-overlap detection
│   │   ├── test_virtual_dimension.py         12 tests — build logic, stability filter, no hardcoding
│   │   └── test_virtual_dimension_endpoint.py  3 tests — store integration (SQLite + ORM)
│   ├── exporters/pptx_exporter.py
│   ├── seed_catalog.py                   seeds kpis.json into DB on startup (idempotent)
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/
    │   ├── page.tsx                      Dashboard Library — home page; lists all generated dashboards
    │   │                                 GET /api/dashboard → card grid with file names, KPIs, date
    │   ├── upload/page.tsx               Multi-file batch upload + per-file polling
    │   │                                 After profiling: POST /api/templates/match to detect saved templates
    │   │                                 Template match → "Use Template" button → /session/{id}/review
    │   │                                 No match → "Continue" → /session/{id}/schema (standard path)
    │   ├── session/[datasetId]/
    │   │   ├── schema/page.tsx           per-file schema mapping + table-type override UI
    │   │   │                             Virtual Dimension builder (amber button, success/error banner)
    │   │   │                             Relationship confirm: saves to sessionStorage + shows green
    │   │   │                             "confirmed" banner; Edit link restores the checklist
    │   │   │                             Race-safe sheet change via synchronous useRef guard
    │   │   ├── review/page.tsx           Template fast-path review — loads saved template from sessionStorage
    │   │   │                             Permanent override → PUT /api/templates/{id} (saves back to template)
    │   │   │                             Session override → only affects current generation
    │   │   │                             Publish → POST /session/{id}/generate → dashboard
    │   │   ├── interview/page.tsx        Dual-mode interview: Flow 1 (step counter + teal bar) or
    │   │   │                             ADK (AI agent badge + indigo pulse bar + wider chat bubbles)
    │   │   │                             is_adk_mode state locked on first response — survives fallback turns
    │   │   │                             First turn reads sessionStorage directly (not hook state) to get
    │   │   │                             upload IDs before useUploadIds effect fires (race prevention)
    │   │   │                             ADK completion → "View Dashboard →" footer (no auto-redirect)
    │   │   │                             Flow 1 completion → "Continue to KPI Selection →" footer
    │   │   │                             Assistant messages rendered as Markdown via react-markdown
    │   │   ├── kpis/page.tsx             checkable KPI list
    │   │   └── dimensions/page.tsx       dimension selection; guards against zero-KPI generation
    │   ├── dashboard/[recipeId]/page.tsx Story sections renderer (config.sections) + flat fallback
    │   │                                 wasLoaded pattern for first-load analytics vs filter-change routing
    │   ├── kpis/custom/page.tsx          Custom KPI proposals — list by status, approve/reject UI
    │   │                                 POST /api/kpis/custom/{id}/approve writes to kpis.json
    │   ├── recipe/[recipeId]/page.tsx    Legacy single-file recipe editor
    │   │                                 Per-instance uid ref (no global counter); debounce cleanup on unmount
    │   ├── interview/page.tsx            legacy single-file interview
    │   ├── profile/[uploadId]/page.tsx   legacy single-file profile view
    │   ├── reports/[reportId]/page.tsx   report detail view
    │   └── review-queue/page.tsx         ops review queue
    ├── components/
    │   ├── UploadZone.tsx                maxFiles: 10, onFiles callback
    │   ├── ColumnTable.tsx               semantic_tag + grain columns
    │   ├── SchemaRelationships.tsx       relationship card display + confirm button
    │   │                                 Confirm saves to sessionStorage only — does NOT call setRelationships()
    │   │                                 (avoids index-shift: filtered list shrinks indices, breaks checked state)
    │   ├── filters/FilterBar.tsx         dashboard filter bar
    │   ├── layout/DarkSidebar.tsx        app sidebar
    │   ├── ui/ChartCard.tsx              chart tile wrapper
    │   ├── ui/InsightPanel.tsx           narrative insight panel
    │   ├── ui/SectionHeader.tsx          dashboard section header
    │   ├── ui/TrendBadge.tsx             metric trend indicator
    │   └── kpis/KpiSummaryCard.tsx       KPI summary card
    └── lib/
        ├── api.ts                        typed API helpers; request() throws on !res.ok
        │                                 buildVirtualDimension() → POST /session/{id}/virtual-dimension
        │                                 updateTableType() → PATCH /upload/{id}/table-type
        ├── types.ts                      BatchUploadResponse, UploadStatus, extended ColumnProfile
        │                                 InterviewResponse includes is_adk_mode?: boolean
        ├── format.ts                     number/date formatting utilities
        └── logger.ts                     frontend event logging
```

---

## Key Patterns

**Profiling:** `services/profiler.py` — heuristic column type detection, `grain_score` (`unique_count / row_count`), pattern-based `semantic_tag`. User overrides in schema mapping UI; saved back to `StagingTable.profile_data`.

**Profiler metric-name fix:** Columns whose names contain metric keywords (`score`, `rating`, `pct`, `percent`, `rate`, `count`, `volume`, `avg`, `average`, `qty`, `quantity`) are always classified as `numeric/measure` even when `unique_count ≤ 5`. Without this fix, columns like `csat_score` (0/1 binary) or `adherence_pct` (90/95/100) were misclassified as categorical and hidden from the KPI suggester. The check is in `_is_metric_name(name)` at the top of `profiler.py`.

**KPI matching:** `services/kpi_suggester.py` — AI-first: sends column names + sample rows to LLM; LLM returns full KPI dicts with formula, aggregation, format. `SequenceMatcher` against `catalog/kpis.json` is fallback only when AI fails (threshold 0.55). Supports AI-generated custom KPIs not in catalog — these create `CustomKpiProposal` records (status: `pending`) awaiting ops approval via `/api/kpis/custom/{id}/approve`. **KPI suggestions are scoped to uploaded files for that session** — different file combinations yield different KPI lists.

**Table classification:** `services/compute.py` uses AI to classify each uploaded table as `fact` or `dimension`. Users can override via `PATCH /upload/{id}/table-type`. Classification stored in `StagingTable.profile_data["table_type"]` governs which tables are fact vs lookup during compute.

**Dimension priority (star-schema):** `GET /session/{id}/dimensions` in `session.py` uses a 4-branch priority:
1. **Virtual dimension tables** (`table_type == "virtual_dimension"`) — highest authority; use their columns only
2. **Real dimension tables** (`table_type == "dimension"`) — second priority
3. **Shared columns** — columns appearing in ≥ 2 fact/unknown tables (genuinely shared)
4. **Fallback** — all dimension-role columns (single-file or fully heterogeneous datasets)

Columns with `semantic_tag` in `{entity_key, time_key, financial_metric}` are excluded from dimension results at all branches. The same 4-branch logic is replicated in `tools/session_dimensions.py` for ADK use.

**Compute cross-file JOIN:** `services/compute.py` executes formulas against staging data. Join key selection is **purely cardinality-based** — the column with highest cardinality among same-name candidates is selected. If no same-name column exists, a cross-name value-overlap probe finds matching columns by comparing value sets. `_apply_same_dimension_enrichment()` propagates missing filter columns via LEFT JOIN before concatenation. `_apply_relationships()` enriches all fact tables using confirmed relationships — not just the first.

**Virtual Dimension:** `services/virtual_dimension.py` synthesises a dimension table when no Roster/dimension file was uploaded.
- `build_virtual_dimension(staging_dfs, min_tables)` — pure function, no DB. Finds non-numeric columns shared across ≥ `min_tables` tables, stacks rows, picks entity key as the **highest-cardinality column**. For `min_tables=1` applies a stability filter: only columns with ≤ 1 unique value per entity group are kept.
- `store_virtual_dimension(dataset_id, staging_dfs, db, engine, client_id)` — persists the result. Auto-detects `effective_min_tables = 1` for single-file, `2` for multi-file. Creates `Upload(filename="__virtual_dimension__")` + `StagingTable(profile_data["table_type"]="virtual_dimension")`. Must call `db.commit()` before `df.to_sql()` to avoid SQLite write-lock.

**Report Templates:** `api/routes/templates.py` — saves a recipe's config + per-file column fingerprints as a `ReportTemplate`. On next upload, `POST /api/templates/match` scores each template by column overlap per slot (must be ≥ 95% for all slots to match). The upload page auto-matches and offers a "Use Template" shortcut. The Review page (`/session/{id}/review`) lets the user make permanent (saved back via `PUT /api/templates/{id}`) or session-only overrides before generating.

**Custom KPI Approval:** `api/routes/kpis.py` — `POST /api/kpis/custom/{id}/approve` writes the entry to `catalog/kpis.json`, then commits the DB. If the DB commit fails, the file write is rolled back (old catalog text is restored) to keep file and DB in sync.

**Recipe → Dashboard:** `services/session_generator.py` (multi-file flow) groups KPIs into story sections (Overview / Performance Trends / Breakdown Analysis / Data Quality) via AI prompt, then falls back to a single "Dashboard Overview" section if AI fails. The generated recipe stores sections in `config.sections`. Dashboard renderer (`dashboard/[recipeId]/page.tsx`) renders `config.sections` when present, falls back to flat layout for legacy recipes. `services/recipe_generator.py` is **legacy** — single-file only, not used in multi-file flow.

**ADK Agent (session flow):** `agent/report_factory_agent/` contains the ADK root agent with **9 tools** (6 legacy + 3 session-flow). When `ADK_ENABLED=true`, the session interview route tries ADK first via `adk_runner.run_turn()`, falls back to Flow 1 on any failure. Dashboard completion is detected by DB-polling (`ReportRecipe.id > pre_turn_max_id` after `db.expire_all()`). The `[DASHBOARD_READY recipe_id=N]` token regex is kept as a secondary fallback.

**Observability:** `services/observability.py` — all LLM calls are logged to `llm_call_logs` (prompt hashed, never raw); ADK session steps write `agent_trace_events` (pending → success/warning/error/blocked). Both functions are fire-and-forget — they catch all exceptions internally so they never crash calling services. Raw prompt text and uploaded data are never stored.

**Schema memory:** On recipe approval, column mappings saved to `schema_memory` (keyed by `client_id + template_type`). Second run with same client + template skips fuzzy matching.

**SQLite locking:** When writing a staging table via pandas `to_sql`, always call `db.commit()` first to release the SQLAlchemy session write lock before pandas opens a second connection. Failure to do so causes `OperationalError: database is locked`.

**DataFrame cache:** `services/compute.py` keeps an in-memory cache of staging DataFrames keyed by table names (`_staging_cache`, TTL = 120s). Call `invalidate_staging_cache(table_names)` after re-upload to evict stale entries. Cache key changes automatically when a table is re-uploaded (new `staging_N` name).

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

## Test Suite (58 tests, all passing)

```
backend/tests/
├── test_compute_per_kpi_filter.py    25 tests
│   Covers: same-dimension enrichment, join key selection, cross-name value-overlap,
│           LEFT JOIN with duplicate key guard, 3-table datasets, table classification,
│           cross-name donor key as filter col, relationship enrichment across all fact
│           tables, auto-flip reversed PK/FK direction, low-cardinality PK/FK guard
│
├── test_get_dimensions.py             8 tests
│   Covers: 4-branch priority (virtual → real dim → shared → fallback),
│           table_count badge, excluded semantic tags, sort order
│
├── test_profiler_classify.py          6 tests
│   Covers: csat_score binary→measure, avg_csat_rating→measure, csat_survey_volume→measure,
│           is_deleted stays categorical, qa_score string-numeric→measure, adherence_pct→measure
│
├── test_schema_relationships.py       4 tests
│   Covers: same-name relationship detection, cross-name value-overlap detection,
│           no false positive below threshold, three-file cross-name detection
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

Run all tests from `backend/` using the project virtualenv:
```bash
# Windows (project uses new-env/)
backend\new-env\Scripts\python.exe -m pytest tests/ -v

# macOS/Linux
source backend/venv/bin/activate
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
POST   /upload/{id}/schema                Save user schema overrides (also triggers sheet re-parse on active_sheet change)
PATCH  /upload/{id}/table-type            Override AI table classification (fact/dimension/unknown)
                                          Stores in StagingTable.profile_data["table_type"]

# Session (multi-file flow)
POST   /session/{id}/relationships        Infer cross-file relationships
POST   /session/{id}/interview            ADK agent (when enabled) or Flow 1 hybrid interview turn
                                          Response: {message, step_index, step_label, completed,
                                                    interview_result, is_adk_mode}
GET    /session/{id}/interview/state      Returns step=0 (stateless — state kept in frontend history)
POST   /session/{id}/interview/skip       Skip interview → default InterviewResult
POST   /session/{id}/kpi-suggestions      Suggest KPIs from catalog + interview context
GET    /session/{id}/dimensions           List dimension columns using 4-branch star-schema priority
POST   /session/{id}/virtual-dimension    Build + store virtual dimension from shared fact columns
                                          Returns: upload_id, table_name, row_count, column_count, columns[]
                                          422 if no qualifying common columns found
POST   /session/{id}/validate             Pre-dashboard data validation
POST   /session/{id}/generate             Create recipe + return recipe_id

# Report Templates
POST   /api/templates                     Save a recipe as a named reusable template (stores column fingerprints)
GET    /api/templates                     List all saved templates
POST   /api/templates/match              Match uploaded files to templates at ≥ 95% column overlap
GET    /api/templates/{id}               Get single template
PUT    /api/templates/{id}               Update template config (permanent override from Review page)
DELETE /api/templates/{id}               Delete template

# Interview + Recipe (legacy single-file)
POST   /interview                         ADK primary + Flow 1 fallback
POST   /interview/recipe
GET    /interview/recipe/{id}
POST   /interview/recipe/{id}/approve

# Dashboard
GET    /api/dashboard                     List all dashboards for Library page (prefetched, no N+1)
GET    /api/dashboard/{id}/data
GET    /api/dashboard/{id}/filter-values
GET    /api/dashboard/{id}/export/excel   Exports; uses KPI format field (not "/" in formula) for % formatting
GET    /api/dashboard/{id}/export/pptx
GET    /api/dashboard/{id}/validate-config   Pre-flight data integrity check
POST   /api/dashboard/{id}/validate-formula  Test-compute a single KPI formula
PATCH  /api/dashboard/{id}/config            Update mutable recipe config fields

# KPI Catalog
GET    /api/kpis                          List catalog KPIs (filter by domain, reviewed status)
POST   /api/kpis                          Create KPI manually
GET    /api/kpis/{id}
POST   /api/kpis/{id}/review              Mark KPI as reviewed/un-reviewed

# Custom KPI Proposals (AI-generated, pending approval)
GET    /api/kpis/custom                   List proposals filtered by status (pending|approved|rejected|all)
POST   /api/kpis/custom/{id}/approve      Approve: write to kpis.json + DB commit (with file rollback on DB failure)
POST   /api/kpis/custom/{id}/reject       Reject: mark as rejected, no catalog change

# Reports + Review Queue (legacy)
POST   /api/reports                          Create report
GET    /api/reports                          List reports
GET    /api/reports/{id}                     Get report by ID
POST   /api/reports/{id}/upload              Upload file to report (orphan-safe: deletes file on DB failure)
POST   /api/reports/{id}/confirm-mapping     Confirm column mapping
GET    /api/reports/{id}/dashboard           Get dashboard for report
GET    /api/reports/{id}/schema-memory       Check schema memory hit
GET    /api/reports/review-queue/list
GET    /api/reports/review-queue/{id}/new-kpis
POST   /api/reports/review-queue/{id}/approve
POST   /api/reports/review-queue/{id}/reject

# Logging
POST   /api/log/event                        Log frontend events
```

---

## ADK Agent Tools (9 total)

When `ADK_ENABLED=true`, the session interview route tries the ADK agent first and falls back to Flow 1 on any failure.

### Session-Flow Tools (multi-file pipeline — new)

| Tool | File | Purpose |
|---|---|---|
| `run_session_kpi_suggest` | `tools/session_kpi_suggest.py` | Calls `kpi_suggester.suggest()` against dataset staging profiles; emits pending→success/error trace events |
| `run_session_dimensions` | `tools/session_dimensions.py` | 4-branch star-schema dimension list (same logic as HTTP endpoint); emits pending→success/warning/error trace events |
| `run_session_generate` | `tools/session_generate.py` | Calls `session_generator.generate_from_session()`; emits pending→success/error/blocked trace events; returns `[DASHBOARD_READY recipe_id=N]` |

### Legacy Single-File Tools

| Tool | File | Purpose |
|---|---|---|
| `run_intake` | `tools/intake.py` | Validate template + KPI list, update report DB record |
| `run_define_new_kpi` | `tools/define_kpi.py` | Create user-defined KPI in catalog (reviewed=false) |
| `run_data_discovery` | `tools/data_discovery.py` | Discover KPI-column mappings from a file path |
| `run_data_discovery_from_upload` | `tools/data_discovery_from_upload.py` | Load staging profile + fuzzy-match KPI catalog; used as Step 1 in session flow |
| `run_standardise` | `tools/standardise.py` | Compute KPI values from confirmed column mapping |
| `run_generate` | `tools/generate.py` | Build chart-ready JSON, create review queue entry |

The runner (`services/adk_runner.py`) uses `google.adk.runners.Runner` + `InMemorySessionService`. Sessions are created explicitly on first use (ADK 2.x does not auto-create). `run_turn()` raises `RuntimeError` on failure — the session route catches this and falls back to Flow 1, writing an `error` trace event.

---

## Observability (llm_call_logs + agent_trace_events)

**`llm_call_logs`** — written by `ai_client.py` for every LLM call across all services (Flow 1 and ADK):
- `prompt_hash`: SHA-256 first 16 hex chars — enough for dedup, safe to store
- `input_token_estimate` / `output_token_estimate`: `len(text) // 4` approximation
- Raw prompt text is **never stored**

**`agent_trace_events`** — written by ADK session tools and `session.py` ADK branch:
- `run_id`: `"session_{dataset_id}"`
- `step_name`: `"interview_turn"` | `"kpi_suggest"` | `"dimensions"` | `"generate"`
- `status`: `success` | `warning` | `pending` | `error` | `blocked`
- `evidence_json`: structured metadata (counts, column names) — no raw cell data
- `requires_review`: flagged when the step produced uncertain or failed results

Both tables are auto-created via `Base.metadata.create_all()` — models are imported in `main.py`.

---

## Out of Scope (Current Phase)

- PostgreSQL migration (`DATABASE_URL` swap only — no code changes needed)
- pgvector semantic matching
- Langfuse observability (llm_call_logs + agent_trace_events are the interim solution)
- SSO / authentication (python-jose installed, not yet wired)
- Scheduled refresh
- PDF export (python-pptx placeholder returns `pptx_path: null`)
- Multi-hop joins (only single-level fact → dimension)
