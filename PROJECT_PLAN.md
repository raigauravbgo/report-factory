# Project Plan: BGO Report Factory

## Strategic Context

This is the first surface of the BGO AI Platform. The KPI catalog, schema memory data model, and ADK skill manifest pattern built here become the foundation every subsequent agent inherits — Hunter Point Capital's deal workflow, the voice collections agent, internal ops automation. Treat the catalog format and schema memory schema as public API: versioned, reviewed, intentional.

---

## Resolved Stack (Actual — diverges from PRD3 in some areas)

| Layer | Built | PRD3 Spec | Notes |
|---|---|---|---|
| Backend | FastAPI (Python) | FastAPI | ✅ Match |
| Database | SQLite (dev) | SQLite | ✅ Match — PostgreSQL in production |
| Agent | Google ADK 2.1.0 | Google ADK | ✅ Match (newer version) |
| LLM (default) | **OpenAI gpt-4o-mini** | Claude (Anthropic) | ⚠️ Diverged — OpenAI is default; Claude opt-in via `ADK_PROVIDER=anthropic` |
| ADK model switch | `ADK_PROVIDER` + `ADK_MODEL` in `.env` | Not in spec | ➕ Added |
| Observability | `adk web` (local) | `adk web` | ✅ Match |
| Frontend | **Next.js 16 App Router** | React + Vite | ⚠️ Diverged — Vite migration deferred indefinitely |
| Frontend port | **3000** | 5173 | ⚠️ Diverged |
| Charts | Recharts | Recharts | ✅ Match |
| Export | Excel (openpyxl ✅) + PPTX (python-pptx ✅ code built, ⏳ needs slide master) | python-pptx | ✅ Match (code done) |
| Column matching | `difflib.SequenceMatcher` fuzzy | SQLite FTS5 | ⚠️ Minor — functionally equivalent |
| File storage | Local `/local_uploads` | Local `/uploads` | ✅ Match |
| Auth | None (MVP) | None | ✅ Match |
| Secrets | `.env` file | `.env` file | ✅ Match |

---

## Two Flows in This Codebase

> **Both flows share the `/interview` endpoint.** `ADK_ENABLED=true` activates ADK agent; `ADK_ENABLED=false` (default) uses OpenAI. Flow 1 is always the automatic fallback if ADK fails.

### ✅ Flow 1 — Self-Service (Upload → Profile → Interview → Recipe → Dashboard)
Default flow. Uses OpenAI. Fully working end-to-end.
```
POST /upload → poll GET /upload/{id} → GET /upload/{id}/profile
  → POST /interview (OpenAI, ADK_ENABLED=false)
  → POST /interview/recipe → POST /interview/recipe/{id}/approve
  → GET /api/dashboard/{id}/data
  → GET /api/dashboard/{id}/export/excel
  → GET /api/dashboard/{id}/export/pptx
```

### ✅ Flow 2 — ADK Agent (active when ADK_ENABLED=true)
Same `/interview` endpoint, ADK agent primary, auto-falls back to Flow 1 on failure.
On first turn the agent receives column profile + upload_id; at Step 2 it calls
`run_data_discovery_from_upload(upload_id)` to get fuzzy-matched KPI suggestions.
```
POST /interview (ADK_ENABLED=true)
  → inject [FILE UPLOADED] context (columns, upload_id, date/dim/measure groups)
  → adk_runner.run_turn() → root_agent (LiteLLM/OpenAI or Claude)
  → run_intake (template + KPI selection, suggests based on column context)
  → run_data_discovery_from_upload(upload_id) ← NEW: uses staged profile, no re-parse
      fuzzy-matches all columns vs full 69-KPI catalog, returns confidence scores
      agent presents suggestions, user confirms/corrects before proceeding
  → run_standardise → run_generate → review_queue
```

---

## Project Structure (Current State)

```
report-factory/
├── backend/
│   ├── main.py                              ✅ FastAPI app — routers, CORS, init_db(), seed on startup
│   ├── agent/
│   │   ├── __init__.py                      ✅ Exports root_agent (required by adk web discovery)
│   │   └── report_factory_agent/
│   │       ├── agent.py                     ✅ Root ADK agent — LiteLlm(openai) or Anthropic via _resolve_model()
│   │       └── tools/
│   │           ├── define_kpi.py            ✅ User-defined KPI (reviewed=false)
│   │           ├── intake.py                ✅ Template + KPI validation → intake_spec
│   │           ├── data_discovery.py              ✅ Schema memory pre-fill → fuzzy column mapping (pure Flow 2)
│   │           ├── data_discovery_from_upload.py  ✅ NEW — Flow 1→2 bridge: staged profile → 69-KPI fuzzy match
│   │           ├── standardise.py                 ✅ KPI compute + range validation + flags
│   │           └── generate.py                    ✅ Chart JSON + review queue entry
│   ├── api/routes/
│   │   ├── upload.py                        ✅ POST /upload, GET /upload/{id}, GET /upload/{id}/profile
│   │   ├── interview.py                     ✅ POST /interview (ADK+fallback), recipe CRUD + approve
│   │   ├── kpis.py                          ✅ GET/POST /api/kpis, GET /api/kpis/{id}, POST review
│   │   ├── reports.py                       ✅ /api/reports lifecycle + review queue (11 endpoints)
│   │   └── dashboard.py                     ✅ /api/dashboard/{id}/data + export/excel + export/pptx
│   ├── services/
│   │   ├── compute.py                       ✅ KPI formula engine, time series, breakdown, insights
│   │   ├── adk_runner.py                    ✅ ADK session runner — ADK 2.x session creation, fallback
│   │   ├── ai_interview.py                  ✅ OpenAI 5-step interview (Flow 1 + fallback)
│   │   ├── ai_client.py                     ✅ OpenAI/Azure wrapper
│   │   ├── profiler.py                      ✅ Column type detection
│   │   ├── parser.py                        ✅ Excel/CSV → SQLite staging table
│   │   ├── recipe_generator.py              ✅ InterviewResult → RecipeConfig + chart layout
│   │   └── storage.py                       ✅ Local file storage (S3-ready)
│   ├── exporters/
│   │   ├── __init__.py                      ✅
│   │   └── pptx_exporter.py                 ✅ PPTX deck (title + KPI tiles + charts + flags slides)
│   │       └── bgo_slide_master.pptx        ⏳ NOT YET — place here when Marketing provides file
│   ├── catalog/
│   │   ├── kpis.json                        ✅ 69 BGO KPI definitions (collections, cx, sales, workforce)
│   │   └── templates/                       ✅ 4 templates: client_health, wbr_qbr, exec_scorecard, kpi_spotlight
│   ├── db/
│   │   ├── schema.sql                       ✅ 5 tables: report_requests, kpi_catalog, schema_memory, review_queue, agent_log
│   │   └── database.py                      ✅ Raw sqlite3 helpers
│   ├── models/                              ✅ SQLAlchemy ORM (datasets, uploads, staging_tables, report_recipes, kpi_definitions)
│   ├── core/
│   │   ├── config.py                        ✅ Pydantic settings — DB, S3, OpenAI, ADK, Azure flags
│   │   └── database.py                      ✅ SQLAlchemy engine + SessionLocal
│   ├── migrations/                          ✅ Alembic migration (0001_initial_schema)
│   ├── seed_catalog.py                      ✅ Idempotent KPI seeder — auto-runs on startup
│   ├── requirements.txt                     ✅ Fully synced with installed versions
│   └── .env.example                         ✅ Documents all flags incl. ADK_ENABLED, ADK_PROVIDER
└── frontend/                                Next.js 16 App Router (not React + Vite as in PRD3)
    ├── app/
    │   ├── layout.tsx                       ✅ DarkSidebar + #F4F6FA bg
    │   ├── page.tsx                         ✅ Library — report grid, status badges, template/status filters
    │   ├── upload/page.tsx                  ✅ File upload with 5-step indicator
    │   ├── profile/[uploadId]/page.tsx      ✅ Column type/role review before interview
    │   ├── interview/page.tsx               ✅ 5-step chat (ADK primary, OpenAI fallback)
    │   ├── recipe/[recipeId]/page.tsx       ✅ Recipe review, edit KPIs + mappings, approve
    │   ├── dashboard/[recipeId]/page.tsx    ✅ KPI cards, line/bar charts, insights, Excel+PPTX export
    │   ├── review-queue/page.tsx            ✅ List+detail panel, approve/reject with reviewer notes
    │   └── reports/[reportId]/page.tsx      ✅ ADK report detail — mapping confirmation table, confidence scores
    ├── components/
    │   ├── layout/DarkSidebar.tsx           ✅ Navy #1B2340 — Library, Upload, Review Queue
    │   ├── kpis/KpiSummaryCard.tsx          ✅ Large value card with optional trend badge
    │   ├── ui/ChartCard.tsx                 ✅ Chart wrapper with takeaway sentence
    │   ├── ui/SectionHeader.tsx             ✅ Teal left-border section label
    │   ├── ui/TrendBadge.tsx                ✅ Up/down/flat pill indicator
    │   ├── ui/InsightPanel.tsx              ✅ Executive insights (4 severity levels)
    │   ├── filters/FilterBar.tsx            ✅ Dimension/filter dropdown bar
    │   ├── ColumnTable.tsx                  ✅ Profile column review table
    │   └── UploadZone.tsx                   ✅ Drag-drop upload area (react-dropzone)
    └── lib/
        ├── api.ts                           ✅ Typed API client (7 methods)
        ├── types.ts                         ✅ All shared TypeScript interfaces
        └── format.ts                        ✅ KPI value formatter (%, K, M, ratio)
```

---

## Complete Status by Area

### ✅ Done — Infrastructure & Setup

| Item | Detail |
|---|---|
| Dependency conflicts fixed | fastapi 0.124.1, pydantic 2.13.4, uvicorn 0.34.0 — all synced |
| SQLite auto-created on startup | `Base.metadata.create_all()` + `init_db()` both run |
| KPI catalog auto-seeded on startup | 69 KPIs, idempotent |
| `.env` structure clean | Root `.env` + `frontend/.env.local` + `backend/.env.example` |
| `requirements.txt` fully synced | Matches exactly what's installed |
| `litellm` added | Required for ADK LiteLlm OpenAI provider |
| `python-pptx` added | PPTX generation |

---

### ✅ Done — Backend Flow 1 (Self-Service)

| Feature | Notes |
|---|---|
| File upload (.xlsx/.csv ≤ 50MB) | Local storage, S3-ready |
| Background column profiling | Type detection, missing %, sample values |
| OpenAI 5-step interview | Date column → KPIs → Dimensions → Granularity → Filters |
| Recipe generation | KPIs, chart layout, column mappings |
| Recipe approve + re-edit | Edit button unlocks after approval |
| KPI formula computation | Handles ratio, mean(), sum(), plain column, SUM(col), mean(col) |
| Time series resampling | Daily / weekly / monthly via pandas |
| Dimension breakdown | Top-20 groups |
| Executive insights | Finding→Narrative→Decision framework, 4 severity levels |
| Excel export | 3 sheets: KPI Summary, Time Series, Breakdown |
| PPTX export (code) | Title + KPI tiles + chart slides + flags slide; BGO branding ready |
| Dashboard filter wiring | `GET /filter-values` loads real options; filters applied server-side; empty state + inline error |

---

### ✅ Done — Backend Flow 2 (ADK Agent)

| Feature | Notes |
|---|---|
| `run_intake` | Template + KPI validation, writes intake_spec |
| `run_define_new_kpi` | User-defined KPI, reviewed=false |
| `run_data_discovery` | Schema memory pre-fill → fuzzy fallback (pure ADK / `adk web` path) |
| `run_data_discovery_from_upload` | **NEW** — Flow 1→2 bridge; loads staged profile, fuzzy-matches all columns vs 69-KPI catalog, returns confidence-scored suggestions grouped ✅ high / ⚠️ review |
| `run_standardise` | KPI compute + range validation + data quality flags |
| `run_generate` | Chart JSON + review queue entry |
| ADK wired into `/interview` | `adk_runner.py` — session management, ADK 2.x session creation fix |
| Column profile injected on first turn | Agent receives upload_id + all column names + date/dim/measure groupings |
| OpenAI fallback | Auto-falls back on any ADK failure, logged as warning |
| `ADK_ENABLED` flag | `.env` only — no code change to switch |
| `ADK_PROVIDER` flag | `openai` (LiteLLM) or `anthropic` (Claude) — `.env` only |
| `OPENAI_API_KEY` auto-resolved | Force-set from `.env` + `litellm.openai_key` — no manual `$env:` needed |
| `agent/__init__.py` exports `root_agent` | Required by `adk web` discovery — was missing, now fixed |
| Review queue API | List, approve, reject, promote KPIs, schema memory save |
| Schema memory pre-fill | Skips fuzzy match on 2nd run if stored mapping exists + headers match |
| KPI catalog API | Full CRUD + reviewed flag — adding KPIs to catalog auto-improves suggestions |

---

### ✅ Done — Frontend

| Screen | Path | Notes |
|---|---|---|
| Library / Home | `/` | All reports grid, status badges, template + status filters |
| Upload | `/upload` | 5-step indicator, drag-drop, polling |
| Profile | `/profile/[uploadId]` | Column type/role review, override dropdowns |
| Interview | `/interview` | 5-step chat, ADK primary / OpenAI fallback |
| Recipe | `/recipe/[recipeId]` | Edit KPIs + column names, approve/re-approve |
| Dashboard | `/dashboard/[recipeId]` | KPI cards, line/bar charts, insights, Excel+PPTX export, live dimension filters |
| Review Queue | `/review-queue` | List+detail, approve/reject, KPI table, flags |
| Report Detail | `/reports/[reportId]` | ADK mapping table, confidence, overrides, confirm button |

---

### ⏳ Pending — Blocked on External Dependency

| Item | Blocker | Action |
|---|---|---|
| PPTX BGO branding | BGO `.pptx` slide master from Marketing | Place file at `backend/exporters/bgo_slide_master.pptx` — no code change needed |

---

### ⏳ Pending — Operational Tasks (No Code Needed)

| Item | Action |
|---|---|
| ~~`adk web` trace verification~~ | ✅ Fixed — `agent/__init__.py` exports `root_agent`; `OPENAI_API_KEY` auto-resolved from `.env`. Run `cd backend && adk web --port 8001` |
| ~~Setup time < 1 hour~~ | ✅ README.md written — Windows batch install workaround, step-by-step guide, 6 troubleshooting scenarios |
| 3 pilot reports with real BGO data | Schedule session with ops team + data team reviewer; use `/review-queue` to approve |

---

### ⏳ Pending — Post-MVP / Deferred

| Item | When |
|---|---|
| Multi-file support (2+ Excel per report) | When a real user requests it |
| Platform reusability gate (Hunter Point + voice agent) | Paper review before MVP locks |
| Langfuse integration | Production only — swap `agent_log` writes |
| pgvector semantic column matching | Production upgrade — replace `difflib.SequenceMatcher` |
| BGO SSO (SAML/OAuth2) | Production only |
| Scheduled refresh | Explicitly out of MVP scope |

---

## API Routes — Complete Current State

```
# ── Flow 1 — Self-Service ──────────────────────────────────────────────────
POST   /upload                                  ✅ Upload file → background profile
GET    /upload/{id}                             ✅ Poll profiling status
GET    /upload/{id}/profile                     ✅ Column profile data
POST   /interview                               ✅ ADK primary + OpenAI fallback (ADK_ENABLED flag)
POST   /interview/recipe                        ✅ Generate recipe from interview result
GET    /interview/recipe/{id}                   ✅ Get recipe config
POST   /interview/recipe/{id}/approve           ✅ Approve / re-approve recipe
GET    /api/dashboard/{id}/data                 ✅ Compute KPIs + charts + insights (generated_at)
GET    /api/dashboard/{id}/export/excel         ✅ Download Excel (3 sheets)
GET    /api/dashboard/{id}/export/pptx          ✅ Download PPTX (code built; BGO branding pending slide master)
GET    /api/dashboard/{id}/filter-values        ✅ Distinct values per dimension/filter column (populates FilterBar)

# ── Flow 2 — ADK Agent lifecycle ──────────────────────────────────────────
POST   /api/reports/                            ✅ Create report request (returns request_id)
GET    /api/reports/                            ✅ List reports (filter: ?created_by=)
GET    /api/reports/{id}                        ✅ Get report state + chat history
POST   /api/reports/{id}/upload                 ✅ Upload file to report
POST   /api/reports/{id}/confirm-mapping        ✅ Accept/override column mapping
GET    /api/reports/{id}/dashboard              ✅ Computed KPIs + chart JSON (requires status: computed|review|approved)
GET    /api/reports/{id}/schema-memory          ✅ Check schema memory for client+template

# ── Review Queue ───────────────────────────────────────────────────────────
GET    /api/reports/review-queue/list           ✅ List (filter: ?status=pending|approved|rejected)
GET    /api/reports/review-queue/{id}/new-kpis  ✅ User-defined KPIs pending review
POST   /api/reports/review-queue/{id}/approve   ✅ Approve + save schema memory + promote KPIs
POST   /api/reports/review-queue/{id}/reject    ✅ Reject with reviewer notes

# ── KPI Catalog ────────────────────────────────────────────────────────────
GET    /api/kpis                                ✅ List (filter: ?domain= ?reviewed=)
POST   /api/kpis                                ✅ Create manually
GET    /api/kpis/{id}                           ✅ Single KPI detail
POST   /api/kpis/{id}/review                    ✅ Mark reviewed=true/false

# ── Not built / Diverged from PRD3 ────────────────────────────────────────
POST   /api/reports/{id}/chat                   ⚠️ NOT BUILT — ADK runs via /interview (ADK_ENABLED=true)
GET    /api/reports/{id}/files                  ❌ Multi-file list (deferred)
POST   /api/reports/{id}/upload/done            ❌ Multi-file trigger (deferred)
GET    /health                                  ✅ Health check
```

---

## MVP Exit Gate — Current Status

| Gate | Status | Notes |
|---|---|---|
| Dev can clone + run in < 1 hour | ✅ Done | README.md covers Windows batch install, step-by-step setup, troubleshooting |
| Agent completes full loop for 3 reports | ⚠️ ADK wired + data-aware | Agent now sees column profile + gets KPI suggestions via `run_data_discovery_from_upload`; needs real BGO data test |
| Client Health Dashboard template renders | ⚠️ Working | Agent suggests template-relevant KPIs based on detected columns |
| Review queue: approve / reject / override | ✅ Done | Frontend at `/review-queue` |
| Schema memory skips mapping on 2nd run | ✅ Done | `run_data_discovery` pre-fill implemented |
| PPTX export produces valid file | ⚠️ Code done | Place `bgo_slide_master.pptx` → BGO branding active |
| ADK traces visible in `adk web` | ✅ Done | Fixed `agent/__init__.py` + OPENAI_API_KEY auto-resolution from `.env` |
| Platform reusability gate (Hunter Point + voice) | ❌ Pending | Paper review |
| 3 pilot reports with real BGO data | ❌ Pending | Needs pilot session with ops team |

---

## Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | BGO PowerPoint slide master `.pptx` | Marketing / Data team | **Blocking BGO-branded PPTX** |
| 2 | Who is the Phase 1 pilot reviewer? | Data team lead | Needed for pilot session |
| 3 | ~~Which KPIs seed the catalog?~~ | Data team | ✅ 69 KPIs seeded |
| 4 | Anthropic API key for Claude (optional) | Platform lead | Only needed if `ADK_PROVIDER=anthropic` |
| 5 | `client_id` naming convention for schema memory | Data team | Needed for schema memory pre-fill accuracy |
| 6 | Executive Scorecard: Workday Excel or API? | Workday admin | Needed by pilot |
| 7 | Hunter Point data schema differences? | Hunter Point lead | Pre-MVP paper review |
| 8 | Confirm formulas for 3 pending KPIs: `interval_compliance`, `tardiness_pct`, `overtime_hours` | Data team | Needed before pilot |
| 9 | ~~AWS or Railway for production?~~ | Platform lead | ✅ Railway |
| 10 | ~~Self-hosted Langfuse or cloud?~~ | Platform lead | ✅ Langfuse Cloud free tier |
| 11 | Typical number of Excel files per report? | Ops users | Informs multi-file UX (deferred) |
| 12 | ~~Should Flow 1 and Flow 2 merge into one UX?~~ | Product lead | ✅ Resolved — merged via `ADK_ENABLED` flag |

---

## Bugs Fixed / Corrections Made

| Bug | Root Cause | Fix |
|---|---|---|
| `fastapi==0.115.0` conflict with `google-adk` | `google-adk` requires `fastapi>=0.124.1` | Bumped fastapi + uvicorn versions |
| `infer_datetime_format` KeyError | Removed in pandas 2.0+ | Replaced with `format="mixed"` |
| `pd.Timestamp` not JSON serializable | Missing type handling in `_serialize()` | Added `pd.Timestamp.isoformat()` branch |
| `db.get_bind()` broken | Deprecated in SQLAlchemy 2.0 | Replaced with direct `engine` import |
| SQLAlchemy tables not created on startup | `Base.metadata.create_all()` never called | Added to `main.py` startup |
| `mean(avg_csat_rating)` computed as sum | `formula_agg()` didn't detect `mean()` pattern | Added `_MEAN_RE` regex detection |
| `agent/__init__.py` empty — `adk web` 500 error | ADK discovery searches `agent.root_agent` | Added `from .report_factory_agent import root_agent` |
| `OPENAI_API_KEY` not picked up by `adk web` | `setdefault` doesn't override existing empty key | Changed to force-set + `litellm.openai_key = key` |
| ADK agent unaware of uploaded file columns | Column profile never sent to agent session | Injected `[FILE UPLOADED]` context on first turn |
| ADK agent can't call `run_data_discovery` in hybrid flow | Tool needs `request_id` + `file_path`, not `upload_id` | Built `run_data_discovery_from_upload(upload_id)` bridge tool |
| Dashboard FilterBar options hardcoded "All" | No endpoint to fetch distinct column values | Added `GET /api/dashboard/{id}/filter-values` + backend filtering |
| Filter returning empty results crashed full page | Error state replaced entire dashboard | Separated `filterError` from page `error`; added empty state |

---

## Production Migration (after MVP exit gate)

Same code. Infrastructure swap only. Do in order; test after each step.

1. **SQLite → PostgreSQL:** Set `DATABASE_URL` to Railway PostgreSQL connection string. No code changes.
2. **Local storage → Railway Volume:** Set `UPLOAD_DIR` env var to volume mount path. No code changes.
3. **ADK → Railway service:** Add Railway service with `adk api_server` start command. Set `ADK_API_URL`.
4. **Langfuse:** Set 3 env vars. Replace `agent_log` writes with Langfuse trace calls.
5. **SSO:** Add FastAPI middleware + BGO SSO provider config.
6. **pgvector (optional):** Replace `difflib.SequenceMatcher` with semantic column matching.
