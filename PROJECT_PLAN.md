# Project Plan: BGO Report Factory

## Strategic Context

This is the first surface of the BGO AI Platform. The KPI catalog, schema memory data model, and ADK skill manifest pattern built here become the foundation every subsequent agent inherits — Hunter Point Capital's deal workflow, the voice collections agent, internal ops automation. Treat the catalog format and schema memory schema as public API: versioned, reviewed, intentional.

---

## Implementation Status

| Sprint | Scope | Status |
|--------|-------|--------|
| Sprint 1 | DB models (column_schema, data_model), migration 0002, Pydantic schemas, validator service, validate route | ✅ Done |
| Sprint 2 | schema_mapper.py, multi-file upload route, dataset schema endpoints (GET schema, POST confirm) | ✅ Done |
| Sprint 3 | data_modeler.py, data_model route (suggest + confirm) | ✅ Done |
| Sprint 4 | kpi_suggester.py, dimension_suggester.py, kpi-suggestions route, dimensions route, recipe skip path, generate_from_context() | ✅ Done |
| Sprint 5 | Multi-file UploadZone, upload page, SchemaColumnTable, schema-mapping page, data-modeling page, lib/api.ts + lib/types.ts | ✅ Done |
| Sprint 6 | KpiCard, FormulaInput, ValidationPanel, kpi-selection page, dimension-selection page, enhanced interview + recipe pages | ✅ Done |
| Sprint 7 | dashboard route (GET /dashboard/{id}/data), dashboard page (metrics, charts, insights), AppShell sidebar nav | ✅ Done |
| Sprint 8 | Dashboard insights refactor — replaced period comparison with top-performer benchmark insights | ✅ Done |
| Sprint 9 | Multi-fact data modeling — join cardinality (1:1 / many:1 / many:many), bridge-dimension detection, primary-fact selection, multi-file dashboard joins | ✅ Done |
| Sprint 10 | Dashboard **Enhanced View** — tabbed layout (Overview / Trends / Drivers / Actions), KPI delta + sparklines, decision-narrative insights, data-quality panel | ✅ Done |
| Sprint 11 | Catalog expansion to 70 KPIs + `column_synonyms.json` field-alias resolution | ✅ Done |

**All 8 pipeline stages are fully implemented end-to-end.** Spec + plan for the Enhanced View live in `docs/superpowers/`.

---

## Pipeline Flow

```
Multi-file Upload  (/upload)
  → Schema Mapping        (/schema-mapping/{datasetId})
  → Data Modeling         (/data-modeling/{datasetId})
  → Interview (optional)  (/interview?datasetId=X)   ← skip → KPI Selection
  → KPI Selection         (/kpi-selection/{datasetId})
  → Dimension Selection   (/dimension-selection/{datasetId})
  → Recipe Editor         (/recipe/{recipeId})
  → Dashboard             (/dashboard/{recipeId})
```

---

## Resolved Stack

| Layer | MVP (current) | Production path |
|---|---|---|
| Backend | FastAPI (Python 3.12) | Same |
| Database | SQLite + SQLAlchemy 2.0 + Alembic | PostgreSQL/MySQL — change `DATABASE_URL` + add driver |
| Agent | Google ADK local (5 tools, Claude Sonnet 4) | ADK on AWS ECS Fargate |
| LLM | Claude via Anthropic API (`claude-sonnet-4-20250514`); OpenAI/Azure for legacy interview | Same |
| Frontend | Next.js 16.2 + TypeScript + Tailwind CSS 4 | Same (no Vite migration planned) |
| Charts | Recharts 3.x | Same |
| Formula validation | asteval (sandboxed) | Same |
| File storage | Local `/uploads` → swap to S3 via `services/storage.py` | AWS S3 |
| Auth | None | BGO SSO |

---

## Backend File Map

```
backend/
├── main.py                        # FastAPI app — 9 routers, CORS, /health, init_db()
├── core/config.py                 # Pydantic settings (Anthropic, OpenAI, Azure, S3, DB, app_env)
├── core/database.py               # SQLAlchemy engine + SessionLocal + get_db()
├── db/
│   ├── schema.sql                 # SQLite schema (5 original tables)
│   └── database.py                # Raw SQLite helpers (KPI CRUD, schema_memory, review_queue)
├── models/
│   ├── dataset.py                 # +pipeline_stage (8 stages), +pipeline_context (JSON)
│   ├── upload.py                  # +schema_mapping_status
│   ├── column_schema.py           # NEW — ai_* columns + confirmed_* overrides (audit trail)
│   ├── data_model.py              # NEW — tables/primary_keys/foreign_keys as JSON
│   └── staging_table.py, report_recipe.py, kpi_definition.py, dashboard_config.py, processed_table.py
├── schemas/
│   ├── upload.py                  # UploadResponse, UploadBatchResponse, ProfilingResult, DatasetSchemaResponse
│   └── interview.py               # RecipeConfig (central contract), all pipeline schemas
├── api/routes/
│   ├── upload.py                  # Multi-file POST /upload + schema confirm endpoints
│   ├── data_model.py              # NEW — /data-model/suggest, /{id}, /{id}/confirm
│   ├── kpi_suggestions.py         # NEW — /kpi-suggestions, /kpi-suggestions/select
│   ├── dimensions.py              # NEW — /dimensions/{id}, /dimensions/{id}/select
│   ├── validate.py                # NEW — /validate/kpi-formula, /validate/recipe
│   ├── dashboard.py               # NEW — GET /dashboard/{id}/data with insights engine
│   ├── interview.py               # +/interview/skip, +/interview/recipe/from-context
│   └── kpis.py, reports.py        # Unchanged (legacy catalog + report flow)
├── services/
│   ├── schema_mapper.py           # NEW — 5-type classification + AI pass + apply_overrides()
│   ├── data_modeler.py            # NEW — heuristic + AI fact/dim + PK/FK + integrity + join cardinality + bridge dims
│   ├── kpi_suggester.py           # NEW — catalog scoring + AI re-ranking
│   ├── dimension_suggester.py     # NEW — dim-table-only columns + AI annotation
│   ├── validator.py               # NEW — 6 validation functions incl. asteval + drift detection
│   ├── recipe_generator.py        # +generate_from_context() for skip path
│   └── ai_client.py, ai_interview.py, parser.py, profiler.py, storage.py  # Unchanged
├── migrations/versions/
│   ├── 0001_initial_schema.py     # Original 7 ORM tables
│   └── 0002_schema_mapping_and_data_model.py  # NEW — column_schemas, data_models, new columns
├── catalog/
│   ├── kpis.json                  # 70 BGO KPIs (collections 30, cx 20, workforce 13, sales 7)
│   ├── column_synonyms.json       # NEW — field-name aliases → canonical KPI source fields
│   └── templates/                 # 4 report templates
├── seed_catalog.py                # Seed kpi_catalog from kpis.json
├── inspect_recipes.py             # Dev utility — dump stored recipes
├── Dockerfile                     # python:3.12-slim, uvicorn on :8000
└── agent/report_factory_agent/    # Google ADK 5-tool agent
    ├── agent.py                   # Root agent (claude-sonnet-4-20250514)
    └── tools/                     # intake, data_discovery, define_kpi, standardise, generate
```

---

## Frontend File Map

```
frontend/
├── app/
│   ├── page.tsx                                  # Redirects to /upload
│   ├── layout.tsx                                # AppShell wrapper, Geist fonts
│   ├── upload/page.tsx                           # Multi-file → polls → /schema-mapping/{id}
│   ├── schema-mapping/[datasetId]/page.tsx       # NEW — per-file AI schema review + overrides
│   ├── data-modeling/[datasetId]/page.tsx        # NEW — fact/dim + PK/FK review
│   ├── interview/page.tsx                        # +skip button → /kpi-selection/{id}
│   ├── kpi-selection/[datasetId]/page.tsx        # NEW — AI KPI ranking + custom KPIs
│   ├── dimension-selection/[datasetId]/page.tsx  # NEW — dim columns grouped by table
│   ├── recipe/[recipeId]/page.tsx                # Enhanced — chart editor + formula validation
│   ├── dashboard/[recipeId]/page.tsx             # NEW — Classic + Enhanced View (Overview/Trends/
│   │                                             #   Drivers/Actions tabs), deltas, sparklines, insights
│   └── profile/[uploadId]/page.tsx               # Legacy (backward compat)
├── components/
│   ├── AppShell.tsx               # NEW — pipeline sidebar (8 steps + progress indicators)
│   ├── UploadZone.tsx             # Multi-file drag-drop (onFiles prop)
│   ├── SchemaColumnTable.tsx      # NEW — 5-type badges, role/filter dropdowns, override highlight
│   ├── KpiCard.tsx                # NEW — relevance bar + domain badge + toggle
│   ├── ValidationPanel.tsx        # NEW — errors/warnings from ValidationResult
│   ├── FormulaInput.tsx           # NEW — live formula validation, 500 ms debounce
│   └── ColumnTable.tsx            # Legacy (profile page)
└── lib/
    ├── api.ts                     # All 23 API client methods
    └── types.ts                   # All TypeScript interfaces (30+ types)
```

---

## API Endpoints (complete)

```
# Upload
POST /upload                                      Multi-file → UploadBatchResponse
GET  /upload/{upload_id}                          Single upload status
GET  /upload/{upload_id}/profile                  Legacy profiling result
GET  /upload/dataset/{dataset_id}                 Poll all upload statuses
GET  /upload/dataset/{dataset_id}/schema          AI schema suggestions for all files
POST /upload/dataset/{dataset_id}/schema/confirm  Apply user overrides, advance pipeline

# Data Modeling
POST /data-model/suggest                          AI fact/dim + PK/FK suggestion
GET  /data-model/{dataset_id}                     Get DataModel
POST /data-model/{dataset_id}/confirm             Apply overrides, advance pipeline

# Interview
POST /interview                                   Chat turn
POST /interview/skip                              Skip → advance to kpi_selection
POST /interview/recipe                            Generate recipe from interview
POST /interview/recipe/from-context              Generate recipe when interview skipped
GET  /interview/recipe/{id}
POST /interview/recipe/{id}/approve

# KPI + Dimensions
POST /kpi-suggestions                             AI-ranked catalog KPIs
POST /kpi-suggestions/select                      Save selection + validate custom formulas
GET  /dimensions/{dataset_id}                     Dim columns from dim tables only
POST /dimensions/{dataset_id}/select              Save selection

# Validation
POST /validate/kpi-formula                        Live formula check (asteval)
POST /validate/recipe                             Full recipe validation

# Dashboard
GET  /dashboard/{recipe_id}/data                  Aggregated KPI + insights (accepts ?f_col=val)

# KPI Catalog
GET  /api/kpis                                    List + filter by domain/reviewed
GET  /api/kpis/{id}
POST /api/kpis                                    Create custom KPI
POST /api/kpis/{id}/review                        Mark as reviewed

# Reports + Review Queue (legacy)
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

GET  /health
```

---

## Data Validation Coverage

| Stage | Validation | Blocking? |
|-------|-----------|----------|
| File drop (client) | Extension (.xlsx/.csv), size ≤ 50 MB | Yes |
| `POST /upload` | Encoding, header row, magic bytes | Yes (400) |
| Schema confirm | Duplicate column names; fact table needs ≥1 date + ≥1 measure | Error blocks |
| Data model confirm | Circular FK; referential integrity < 90% | Warning only |
| Custom KPI (live) | `FormulaInput` 500 ms debounce → `POST /validate/kpi-formula` | Live feedback |
| `POST /kpi-suggestions/select` | All custom KPI formulas validated server-side | 422 |
| Recipe approve | `hasFormulaErrors()` client-side + `POST /validate/recipe` | Blocks approve |
| Dashboard refresh | `detect_schema_drift()` on re-upload | Warning banner |

---

## Database Schema

### Original tables (`db/schema.sql`)
- `report_requests`, `kpi_catalog`, `schema_memory`, `review_queue`, `agent_log`

### SQLAlchemy ORM tables (migrations 0001 + 0002)
- `datasets` — +`pipeline_stage`, +`pipeline_context`
- `uploads` — +`schema_mapping_status`
- `staging_tables`, `report_recipes`, `kpi_definitions`, `dashboard_configs`, `processed_tables`
- `column_schemas` — **NEW (0002)**: `ai_*` immutable + `confirmed_*` nullable audit trail
- `data_models` — **NEW (0002)**: JSON blobs for tables/PKs/FKs

---

## Open Questions

1. BGO PowerPoint slide master file — needed for PPTX export endpoint
2. Central data team pilot reviewer — needed for review queue testing
3. Anthropic API key — shared org key or individual user keys?
4. `client_id` naming convention — user email, team ID, or SSO subject?
5. Workday data: Excel export for MVP or direct API access?
6. Hunter Point Capital data schema differences — review before multi-tenant rollout

---

## Next Steps

- [ ] Run `alembic upgrade head` to apply migration 0002 on new environments
- [ ] Set `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`) in `.env`
- [ ] Test full pipeline end-to-end with real BGO Excel data (both interview + skip paths)
- [ ] Enable AI enhancement passes (set `use_ai=True`) in schema_mapper, data_modeler, kpi_suggester
- [ ] Implement PPTX export endpoint + download button on recipe/dashboard pages
- [ ] Add BGO SSO authentication layer
- [ ] PostgreSQL migration for production deployment (change `DATABASE_URL` only)
- [ ] S3 storage — set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` in `.env`
- [ ] Multi-tenant hardening — enforce `client_id` isolation at query level
