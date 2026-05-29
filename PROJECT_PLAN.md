# Project Plan: BGO Report Factory

## Strategic Context

This is the first surface of the BGO AI Platform. The KPI catalog, schema memory data model, and ADK skill manifest pattern built here become the foundation every subsequent agent inherits — Hunter Point Capital's deal workflow, the voice collections agent, internal ops automation. Treat the catalog format and schema memory schema as public API: versioned, reviewed, intentional. Getting these right in the MVP costs nothing extra. Unwinding them after five agents inherit from them is expensive.

---

## Resolved Stack

| Layer | MVP | Production |
|---|---|---|
| Backend | FastAPI (Python) | Same — deployed as Railway service |
| Database | SQLite | PostgreSQL via Railway plugin — change one `DATABASE_URL` line |
| Agent | Google ADK 1.32.0 local (`pip install google-adk`) | ADK on Railway — same code, `adk api_server` as Railway start command |
| LLM | Claude via Anthropic API (`claude-sonnet-4-20250514`) | Same |
| Observability | `adk web` local trace UI (built-in, zero setup) | Langfuse Cloud (managed, free tier 50k events/month) — swap 3 env vars |
| Frontend | Next.js App Router — Vite migration deferred indefinitely | Same |
| Charts | Recharts | Same |
| Export | OpenPyXL (Excel ✅) · python-pptx against BGO slide master (❌ pending) | Same |
| Column matching | `difflib.SequenceMatcher` fuzzy match | pgvector semantic search |
| File storage | Local `/local_uploads` | Railway Volume — `UPLOAD_DIR` env var points to volume mount, no code change |
| ETL / transforms | pandas in-memory per report | dbt Core (deferred — introduce when second data source joins) |
| Auth | None | BGO SSO (SAML/OAuth2) |
| Secrets | `.env` file | Railway environment variables |

---

## Two Flows in This Codebase

> **Architecture note:** Both flows share the same `/interview` endpoint. `ADK_ENABLED=true` in `.env` activates the ADK agent; `ADK_ENABLED=false` (default) uses OpenAI. Flow 1 is always the automatic fallback.

### ✅ Flow 1 — Self-Service (Upload → Profile → Interview → Recipe → Dashboard)
Uses OpenAI for the interview. Fully working end-to-end. Default when `ADK_ENABLED=false`.
```
POST /upload → GET /upload/{id} (poll) → GET /upload/{id}/profile
  → POST /interview (OpenAI chat turns)
  → POST /interview/recipe → POST /interview/recipe/{id}/approve
  → GET /api/dashboard/{id}/data → GET /api/dashboard/{id}/export/excel
```

### ✅ Flow 2 — ADK Agent (wired into /interview, ADK_ENABLED=true)
ADK agent activated via `ADK_ENABLED=true`. Falls back to Flow 1 on failure. Model switchable via `ADK_PROVIDER=openai|anthropic`.
```
POST /interview (ADK_ENABLED=true)
  → adk_runner.run_turn() → root_agent (LiteLLM/OpenAI or Claude)
  → run_intake → run_data_discovery → run_standardise → run_generate
  → review_queue
```

---

## Project Structure

```
report-factory/
├── backend/
│   ├── main.py                          ✅ FastAPI — all routes, init_db() + seed on startup
│   ├── agent/
│   │   └── report_factory_agent/
│   │       ├── agent.py                 ✅ Root ADK agent — 5 tools registered
│   │       └── tools/
│   │           ├── define_kpi.py        ✅ New KPI definition (user-defined, reviewed=false)
│   │           ├── intake.py            ✅ Step 1: template + KPI selection
│   │           ├── data_discovery.py    ✅ Step 2: Excel parsing + fuzzy mapping
│   │           ├── standardise.py       ✅ Step 3: KPI computation + validation
│   │           └── generate.py          ✅ Step 4: chart JSON + review queue entry
│   ├── api/routes/
│   │   ├── upload.py                    ✅ File upload + background profiling
│   │   ├── interview.py                 ✅ ADK-primary + OpenAI fallback + recipe creation
│   │   ├── kpis.py                      ✅ KPI catalog CRUD + review flag
│   │   ├── reports.py                   ✅ ADK report lifecycle + review queue
│   │   └── dashboard.py                 ✅ NEW — KPI computation + Excel export
│   ├── services/
│   │   ├── compute.py                   ✅ NEW — formula evaluator, time series, breakdown, insights
│   │   ├── adk_runner.py                ✅ NEW — ADK session runner, session creation, Flow 1 fallback
│   │   ├── ai_interview.py              ✅ OpenAI 5-step interview engine (Flow 1 + fallback)
│   │   ├── profiler.py                  ✅ Column type detection
│   │   ├── parser.py                    ✅ Excel/CSV → SQLite staging table
│   │   ├── recipe_generator.py          ✅ Interview result → RecipeConfig + chart layout
│   │   └── storage.py                   ✅ Local file storage (S3-ready)
│   ├── catalog/
│   │   ├── kpis.json                    ✅ 69 KPI definitions (BGO IP — versioned)
│   │   └── templates/                   ✅ 4 templates (client_health, wbr_qbr, exec_scorecard, kpi_spotlight)
│   ├── db/
│   │   ├── schema.sql                   ✅ SQLite schema — 5 tables (Flow 2 / ADK)
│   │   └── database.py                  ✅ Raw sqlite3 helpers — no ORM
│   ├── models/                          ✅ SQLAlchemy ORM models (Flow 1)
│   ├── exporters/
│   │   └── pptx_exporter.py             ❌ NOT BUILT — python-pptx stub only
│   └── seed_catalog.py                  ✅ Idempotent — auto-runs on every startup
├── frontend/
│   ├── app/
│   │   ├── layout.tsx                   ✅ Root layout with DarkSidebar
│   │   ├── upload/page.tsx              ✅ File upload with step indicator
│   │   ├── profile/[uploadId]/page.tsx  ✅ Column profile review → interview
│   │   ├── interview/page.tsx           ✅ Chat interview (ADK primary, OpenAI fallback)
│   │   ├── recipe/[recipeId]/page.tsx   ✅ Recipe review + edit + approve
│   │   └── dashboard/[recipeId]/page.tsx ✅ Full dashboard — KPI cards, charts, insights
│   └── components/
│       ├── layout/DarkSidebar.tsx       ✅ NEW — navy #1B2340 fixed sidebar
│       ├── kpis/KpiSummaryCard.tsx      ✅ NEW — large value card with trend badge
│       ├── ui/ChartCard.tsx             ✅ NEW — chart wrapper with takeaway sentence
│       ├── ui/SectionHeader.tsx         ✅ NEW — teal left-border section label
│       ├── ui/TrendBadge.tsx            ✅ NEW — up/down/flat pill indicator
│       ├── ui/InsightPanel.tsx          ✅ NEW — executive insights (severity levels)
│       └── filters/FilterBar.tsx        ✅ NEW — dimension/filter dropdowns
```

---

## Status by Area

### ✅ Complete — Flow 1 Self-Service

| Feature | Notes |
|---|---|
| File upload (.xlsx/.csv ≤ 50MB) | Local storage, S3-ready |
| Background column profiling | Type detection, missing %, sample values |
| Profile review page | Column type/role review before interview |
| OpenAI 5-step interview | Date column → KPIs → Dimensions → Granularity → Filters |
| Recipe generation | KPIs, chart layout, column mappings |
| Recipe review + approve/re-edit | Edit button unlocks after approval |
| KPI formula computation | Handles ratio, mean(), sum(), plain column |
| Time series chart data | Daily/weekly/monthly resampling |
| Dimension breakdown chart data | Top-20 groups, bar chart |
| Executive insights (auto-generated) | Finding→Narrative→Decision framework, 4 severity levels |
| Dashboard page | KPI cards, line charts, bar charts, config summary |
| Excel export | 3 sheets: KPI Summary, Time Series, Breakdown |
| KPI catalog auto-seeded on startup | 69 KPIs, idempotent |
| Dark sidebar UI + design system | DarkSidebar, KpiSummaryCard, ChartCard, InsightPanel, FilterBar |

---

### ✅ Complete — Flow 2 ADK Agent

| Feature | Notes |
|---|---|
| `run_intake` | Template + KPI validation, writes intake_spec to DB |
| `run_define_new_kpi` | User-defined KPI, reviewed=false |
| `run_data_discovery` | Fuzzy column mapping via difflib, confidence scores |
| `run_standardise` | KPI compute + range validation + data quality flags |
| `run_generate` | Chart JSON + review queue entry |
| Review queue API | List, approve (+ overrides + promote_kpis), reject, new-kpis |
| Schema memory API | Save on approve, check endpoint |
| KPI catalog API | CRUD + reviewed flag |
| ADK wired into `/interview` | `services/adk_runner.py` — session management, ADK 2.x session creation fix |
| OpenAI fallback | Auto-falls back to Flow 1 on any ADK failure; logged as warning |
| Dynamic model provider | `ADK_PROVIDER=openai` (LiteLLM) or `ADK_PROVIDER=anthropic` (Claude) — `.env` only |
| `ADK_ENABLED` flag | `false` = OpenAI only; `true` = ADK primary + fallback |

---

### ✅ Complete — Frontend Screens

| Item | Notes |
|---|---|
| Library / Home page (`/`) | Grid of all reports, status badges, template + status filters, New Report button |
| Report Detail page (`/reports/[reportId]`) | Mapping confirmation table with confidence scores + override inputs |
| Review Queue frontend (`/review-queue`) | List panel + detail panel, approve/reject with reviewer notes |
| Mapping Confirmation | Inline in `/reports/[reportId]` — flags low-confidence items in amber |

### ❌ Pending — Remaining Items

| Item | Priority | Notes |
|---|---|---|
| PPTX export | High | **Blocked — needs BGO `.pptx` slide master from Marketing** |
| `adk web` trace verification | Medium | Run full loop with `ADK_ENABLED=true`, check traces at `localhost:8001` |
| Multi-file support | Low | One Excel per report in MVP — deferred |
| 3 pilot reports with real BGO data | Low | Operational task — run once Review Queue UI is exercised |

---

### ❌ Pending — Multi-File Support

| Item | Priority | Notes |
|---|---|---|
| `report_files` table in `db/schema.sql` | Medium | One row per uploaded file per report |
| `POST /api/reports/{id}/upload/done` | Medium | Signals all files uploaded, triggers discovery |
| `GET /api/reports/{id}/files` | Medium | List uploaded files for a report |
| `run_data_discovery` multi-file scan | Medium | Assign each KPI to best-matching source file |
| `column_mapping` `source_file` field | Medium | `{kpi_id: {raw_column, source_file, confidence, needs_review}}` |
| `run_standardise` multi-file read | Medium | Open correct file per KPI via `source_file` |
| Schema memory multi-file recall | Low | Validate all referenced filenames present before pre-filling |

---

### ❌ Pending — Export & Observability

| Item | Priority | Notes |
|---|---|---|
| PPTX export (`exporters/pptx_exporter.py`) | High | **Blocked on BGO `.pptx` slide master file from Marketing** |
| `GET /api/reports/{id}/pptx` stream endpoint | High | Depends on above |
| PPTX download button on Dashboard | Medium | Excel button exists; PPTX button to be added alongside |
| Schema memory pre-fill in `run_data_discovery` | Medium | Check schema_memory on start → skip fuzzy if match found |
| ADK traces in `adk web` with latency | Medium | Zero setup once `ANTHROPIC_API_KEY` is set correctly |
| Langfuse integration | Low | Production only — swap `agent_log` writes |

---

### ❌ Pending — Pilot & MVP Exit Gate

| Gate | Status | Blocker |
|---|---|---|
| Dev can clone + run full app in < 1 hour | ⚠️ ~1.5 hrs currently | pip memory issue on Windows; needs better setup docs |
| Agent completes full loop for 3 reports | ⚠️ ADK wired, needs real BGO data test | Set `ADK_ENABLED=true`, upload real Excel, complete full conversation |
| Client Health Dashboard template renders | ⚠️ ADK active; template routing via agent instruction | ADK asks for template type — verify client_health renders correctly |
| Review queue: approve, reject, approve-with-edits | ✅ Done | Frontend at `/review-queue` — list, detail, approve/reject with notes |
| Schema memory saves + skips mapping on second run | ✅ Done | Pre-fill implemented in `run_data_discovery` — uses stored mapping if all columns present |
| PPTX export produces valid file | ❌ Not done | BGO `.pptx` slide master file required |
| ADK traces visible in `adk web` for every step | ❌ Not done | Needs end-to-end test |
| Platform reusability gate (Hunter Point + voice) | ❌ Not done | Paper review pending |
| 3 pilot reports with real BGO Excel data | ❌ Not done | Flow 2 must be wired up first |

---

## API Routes — Current State

```
# ── Flow 1 — Self-Service (fully working) ─────────────────────────────────
POST   /upload                              ✅ File upload → background profile
GET    /upload/{id}                         ✅ Poll profiling status
GET    /upload/{id}/profile                 ✅ Column profile data
POST   /interview                           ✅ ADK agent primary (OpenAI fallback) — ADK_ENABLED flag
POST   /interview/recipe                    ✅ Generate recipe from interview result
GET    /interview/recipe/{id}               ✅ Get recipe config
POST   /interview/recipe/{id}/approve       ✅ Approve / re-approve recipe
GET    /api/dashboard/{id}/data             ✅ Compute KPIs + chart data + insights
GET    /api/dashboard/{id}/export/excel     ✅ Download formatted Excel (3 sheets)

# ── Flow 2 — ADK Agent (backend built, no frontend connection) ─────────────
POST   /api/reports/                        ✅ Create report request
GET    /api/reports/                        ✅ List reports (filter by created_by)
GET    /api/reports/{id}                    ✅ Get state + chat history
POST   /api/reports/{id}/upload             ✅ Upload one file
POST   /api/reports/{id}/confirm-mapping    ✅ Accept/override column mapping
GET    /api/reports/{id}/dashboard          ✅ Computed KPIs + chart JSON
GET    /api/reports/{id}/schema-memory      ✅ Check if stored mapping exists
GET    /api/reports/review-queue/list       ✅ List review queue (filter by status)
GET    /api/reports/review-queue/{id}/new-kpis ✅ User-defined KPIs pending review
POST   /api/reports/review-queue/{id}/approve  ✅ Approve + save schema memory
POST   /api/reports/review-queue/{id}/reject   ✅ Reject with reviewer notes

# ── KPI Catalog ────────────────────────────────────────────────────────────
GET    /api/kpis                            ✅ List (filter: ?domain= ?reviewed=)
POST   /api/kpis                            ✅ Create manually
GET    /api/kpis/{id}                       ✅ Single KPI detail
POST   /api/kpis/{id}/review                ✅ Mark reviewed=true/false

# ── Missing ────────────────────────────────────────────────────────────────
POST   /api/reports/{id}/chat               ⚠️ Not built as separate endpoint — ADK now runs via /interview (ADK_ENABLED=true)
GET    /api/reports/{id}/files              ❌ Multi-file list
POST   /api/reports/{id}/upload/done        ❌ Signal upload complete → trigger discovery
GET    /api/reports/{id}/pptx               ❌ PPTX download
```

---

## Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | BGO PowerPoint slide master as `.pptx` file? | Marketing / Data team | **Blocking PPTX export** |
| 2 | Who is the Phase 1 pilot reviewer on the central data team? | Data team lead | Needed for review queue pilot |
| 3 | ~~Which ~50 KPIs seed the catalog?~~ | Data team | ✅ 69 KPIs seeded from `KPI's & Definition.xlsx` + Affirm Care |
| 4 | Anthropic API key — shared team account or individual dev keys? | Platform lead | Needed for ADK agent (Flow 2) |
| 5 | `client_id` naming convention for schema memory keys | Data team | Needed by pilot |
| 6 | Executive Scorecard: Workday Excel export interim or API from day one? | Workday admin | Needed by pilot |
| 7 | Hunter Point data schema — different enough to require platform changes? | Hunter Point lead | Needed by Week 3 |
| 8 | Confirm formulas for 3 pending KPIs: `interval_compliance`, `tardiness_pct`, `overtime_hours` | Data team | Needed before pilot |
| 9 | ~~AWS or Railway for production?~~ | Platform lead | ✅ Railway — Volumes for storage, managed PostgreSQL plugin |
| 10 | ~~Self-hosted Langfuse or cloud?~~ | Platform lead | ✅ Langfuse Cloud free tier |
| 11 | Typical number of Excel files per report? (informs multi-file upload UX) | Ops users | Needed for multi-file design |
| 12 | ~~Should Flow 1 and Flow 2 merge?~~ | Product lead | ✅ Resolved — merged via `ADK_ENABLED` flag on `/interview` endpoint. Flow 1 is permanent fallback. |

---

## Production Migration (after MVP exit gate)

Same code. Infrastructure swap only. Do in order; test after each step.

1. **SQLite → PostgreSQL:** Add Railway PostgreSQL plugin. Set `DATABASE_URL`. Raw SQL is PostgreSQL-compatible (`ON CONFLICT` syntax identical). No code changes.
2. **Local storage → Railway Volume:** Add Railway Volume. Set `UPLOAD_DIR` to volume mount path (e.g. `/data/uploads`). No code changes.
3. **ADK local → Railway service:** Add second Railway service with start command `adk api_server`. Set `ADK_API_URL` env var on FastAPI service. Agent code unchanged.
4. **Langfuse:** Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`. Replace `agent_log` writes with Langfuse trace calls — one import swap.
5. **SSO:** Add FastAPI middleware + BGO SSO provider config.
6. **pgvector (optional):** Enable pgvector on Railway PostgreSQL. Replace `difflib.SequenceMatcher` with semantic column matching. No user-facing change.

**dbt Core (when second data source is live):**
When Workday or telephony data joins Excel uploads, load raw files into PostgreSQL staging tables and introduce dbt models for the silver/gold transformation layer. The `report_files` table already provides the source reference each dbt source will need. Schema design is dbt-ready from day one — no rework required at that point.
