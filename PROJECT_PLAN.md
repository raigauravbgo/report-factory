# Project Plan: BGO Report Factory

## Strategic Context

This is the first surface of the BGO AI Platform. The KPI catalog, schema memory data model, and ADK skill manifest pattern built here become the foundation every subsequent agent inherits — Hunter Point Capital's deal workflow, the voice collections agent, internal ops automation. Treat the catalog format and schema memory schema as public API: versioned, reviewed, intentional.

---

## Implementation Status

| Sprint | Scope | Status |
|--------|-------|--------|
| Sprint 1 | DB models, migration, Pydantic schemas, validator, validate route | ✅ Done |
| Sprint 2 | schema_mapper.py, multi-file upload route, dataset schema endpoints | ✅ Done |
| Sprint 3 | data_modeler.py, data_model route | ✅ Done |
| Sprint 4 | kpi_suggester.py, dimension_suggester.py, kpi-suggestions route, dimensions route, recipe skip path, generate_from_context() | ✅ Done |
| Sprint 5 | Multi-file UploadZone, upload page, SchemaColumnTable, schema-mapping page, data-modeling page, lib/api.ts + lib/types.ts | ✅ Done |
| Sprint 6 | KpiCard, FormulaInput, ValidationPanel, kpi-selection page, dimension-selection page, enhanced interview + recipe pages | ✅ Done |

---

## New Pipeline Flow (implemented)

```
Multi-file Upload  (/upload)
  → Schema Mapping  (/schema-mapping/{datasetId})
  → Data Modeling   (/data-modeling/{datasetId})
  → Interview       (/interview?datasetId=X)   ← optional; skip button available
  → KPI Selection   (/kpi-selection/{datasetId})
  → Dimension Select (/dimension-selection/{datasetId})
  → Recipe          (/recipe/{recipeId})
  → Dashboard       (/dashboard/{recipeId})
```

---

## Resolved Stack

| Layer | MVP | Production |
|---|---|---|
| Backend | FastAPI (Python 3.12) | Same |
| Database | SQLite + SQLAlchemy ORM + Alembic migrations | PostgreSQL — change one `DATABASE_URL` line |
| Agent | Google ADK local | ADK on AWS ECS Fargate |
| LLM | Claude via Anthropic API (`claude-sonnet-4-20250514`) | Same |
| Frontend | Next.js 16 + TypeScript + Tailwind | Migrate to React + Vite (PROJECT_PLAN Week 3) |
| Charts | Recharts | Same |
| Formula validation | asteval (sandboxed) | Same |
| File storage | Local `/uploads` → swap to S3 via `services/storage.py` | AWS S3 |
| Auth | None | BGO SSO |

---

## Backend File Map

```
backend/
├── main.py                        # FastAPI app — all routes registered here
├── core/config.py                 # Settings (Anthropic, OpenAI, S3, DB, app_env)
├── core/database.py               # SQLAlchemy engine + SessionLocal + get_db()
├── db/
│   ├── schema.sql                 # SQLite schema (4 original PRD3 tables)
│   └── database.py                # Raw SQLite helpers (KPI CRUD, schema_memory, review_queue)
├── models/                        # SQLAlchemy ORM models
│   ├── dataset.py                 # +pipeline_stage, +pipeline_context
│   ├── upload.py                  # +schema_mapping_status
│   ├── column_schema.py           # NEW — ai_* columns + confirmed_* overrides (audit trail)
│   ├── data_model.py              # NEW — tables/primary_keys/foreign_keys as JSON
│   ├── staging_table.py, report_recipe.py, kpi_definition.py, dashboard_config.py, processed_table.py
├── schemas/
│   ├── upload.py                  # UploadResponse, UploadBatchResponse, ProfilingResult
│   └── interview.py               # RecipeConfig (extended), all new pipeline schemas
├── api/routes/
│   ├── upload.py                  # Multi-file POST /upload + dataset schema endpoints
│   ├── data_model.py              # NEW — /data-model/suggest, /{id}, /{id}/confirm
│   ├── kpi_suggestions.py         # NEW — /kpi-suggestions, /kpi-suggestions/select
│   ├── dimensions.py              # NEW — /dimensions/{id}, /dimensions/{id}/select
│   ├── validate.py                # NEW — /validate/kpi-formula, /validate/recipe
│   ├── interview.py               # +/interview/skip, +/interview/recipe/from-context
│   ├── kpis.py, reports.py        # Unchanged
├── services/
│   ├── schema_mapper.py           # NEW — 5-type classification + AI pass + apply_overrides()
│   ├── data_modeler.py            # NEW — heuristic + AI fact/dim + PK/FK + integrity check
│   ├── kpi_suggester.py           # NEW — catalog scoring + AI re-ranking
│   ├── dimension_suggester.py     # NEW — dim-table-only columns + AI annotation
│   ├── validator.py               # NEW — validate_upload/schema/data_model/kpi_formula/recipe/drift
│   ├── recipe_generator.py        # +generate_from_context() for skip path
│   ├── ai_client.py, ai_interview.py, parser.py, profiler.py, storage.py  # Unchanged
├── migrations/versions/
│   ├── 0001_initial_schema.py     # Original 7 tables
│   └── 0002_schema_mapping_and_data_model.py  # NEW — column_schemas, data_models, new columns
├── catalog/
│   ├── kpis.json                  # 99 BGO KPIs (collections, cx, sales, workforce, ops)
│   └── templates/                 # 4 report templates
└── agent/report_factory_agent/    # Google ADK 4-step agent (unchanged)
```

---

## Frontend File Map

```
frontend/
├── app/
│   ├── upload/page.tsx                        # Multi-file upload → /schema-mapping/{id}
│   ├── schema-mapping/[datasetId]/page.tsx    # NEW — AI schema review per file
│   ├── data-modeling/[datasetId]/page.tsx     # NEW — Fact/dim + PK/FK review
│   ├── interview/page.tsx                     # +skip button → /kpi-selection/{id}
│   ├── kpi-selection/[datasetId]/page.tsx     # NEW — AI KPI ranking + custom KPIs
│   ├── dimension-selection/[datasetId]/page.tsx # NEW — Dim columns only
│   ├── recipe/[recipeId]/page.tsx             # Enhanced — chart type editor + formula validation
│   └── profile/[uploadId]/page.tsx            # Legacy (kept for backward compat)
├── components/
│   ├── UploadZone.tsx             # Multi-file drag-drop (onFiles prop)
│   ├── SchemaColumnTable.tsx      # NEW — 5-type badges, role dropdown, filter checkbox
│   ├── KpiCard.tsx                # NEW — relevance bar + domain badge + toggle
│   ├── ValidationPanel.tsx        # NEW — errors/warnings from ValidationResult
│   ├── FormulaInput.tsx           # NEW — live formula validation with 500ms debounce
│   └── ColumnTable.tsx            # Legacy (profile page)
└── lib/
    ├── api.ts                     # All new methods (uploadFiles, confirmSchema, suggestDataModel, etc.)
    └── types.ts                   # All new interfaces (ColumnSchemaEntry, DataModelResponse, etc.)
```

---

## API Endpoints (complete)

```
# Upload
POST /upload                                     Multi-file → UploadBatchResponse
GET  /upload/{upload_id}                         Single upload status
GET  /upload/{upload_id}/profile                 Legacy profiling result
GET  /upload/dataset/{dataset_id}                Poll all upload statuses
GET  /upload/dataset/{dataset_id}/schema         AI schema suggestions for all files
POST /upload/dataset/{dataset_id}/schema/confirm Apply user overrides, advance pipeline

# Data Modeling
POST /data-model/suggest                         AI fact/dim + PK/FK suggestion
GET  /data-model/{dataset_id}                    Get DataModel
POST /data-model/{dataset_id}/confirm            Apply overrides, advance pipeline

# Interview
POST /interview                                  Chat turn
POST /interview/skip                             Skip → advance to kpi_selection
POST /interview/recipe                           Generate recipe from interview
POST /interview/recipe/from-context             Generate recipe when interview skipped
GET  /interview/recipe/{id}
POST /interview/recipe/{id}/approve

# KPI + Dimensions
POST /kpi-suggestions                            AI-ranked catalog KPIs
POST /kpi-suggestions/select                     Save selection + validate custom formulas
GET  /dimensions/{dataset_id}                    Dim columns from dim tables only
POST /dimensions/{dataset_id}/select             Save selection

# Validation
POST /validate/kpi-formula                       Live formula check (asteval)
POST /validate/recipe                            Full recipe validation

# KPI Catalog
GET  /api/kpis                                   List + filter by domain/reviewed
POST /api/kpis                                   Create custom KPI
GET  /api/kpis/{id}
POST /api/kpis/{id}/review                       Mark as reviewed

# Reports + Review Queue
POST /api/reports                                Create report request
GET  /api/reports/{id}
POST /api/reports/{id}/upload
POST /api/reports/{id}/confirm-mapping
GET  /api/reports/{id}/dashboard
GET  /api/reports/review-queue/list
POST /api/reports/review-queue/{id}/approve
POST /api/reports/review-queue/{id}/reject
GET  /api/reports/{id}/schema-memory

# Health
GET  /health
```

---

## Data Validation Coverage

| Stage | Validation | Blocking? |
|-------|-----------|----------|
| File drop (client) | Extension, size ≤ 50MB | Yes |
| `POST /upload` | Encoding, header row, magic bytes | Yes (400) |
| Schema confirm | Duplicate column names; fact table needs ≥1 date + ≥1 measure | Error blocks |
| Data model confirm | Circular FK; referential integrity < 90% | Warning only |
| Custom KPI entry (live) | Formula syntax + column existence via asteval (FormulaInput) | Live feedback |
| `POST /kpi-suggestions/select` | All custom KPI formulas validated server-side | 422 |
| Recipe approve | hasFormulaErrors() check client-side; recipe validation endpoint | Blocks approve |
| Dashboard refresh | detect_schema_drift() on re-upload | Warning banner |

---

## Database Schema

### Original tables (db/schema.sql)
- `report_requests` — PRD3 report state machine
- `kpi_catalog` — 99 BGO KPIs (seeded by `seed_catalog.py`)
- `schema_memory` — client × template mapping cache
- `review_queue` — pending approvals
- `agent_log` — ADK step trace

### SQLAlchemy ORM tables (migrations/0001 + 0002)
- `datasets` — +pipeline_stage, +pipeline_context
- `uploads` — +schema_mapping_status
- `staging_tables`, `report_recipes`, `kpi_definitions`, `dashboard_configs`, `processed_tables`
- `column_schemas` — **NEW** (migration 0002)
- `data_models` — **NEW** (migration 0002)

---

## Running migrations

```bash
cd backend
alembic upgrade head
```

---

## Open Questions (from PRD3)

1. BGO PowerPoint slide master file — needed for PPTX export
2. Central data team pilot reviewer — needed for review queue testing
3. Remaining KPI definitions from data team (currently 99 seeded)
4. Anthropic API key — shared or individual?
5. `client_id` naming convention
6. Workday: Excel export for MVP or API access?
7. Hunter Point data schema differences (Sprint 3 gate)

---

## Next Steps

- [ ] Run `alembic upgrade head` to apply migration 0002
- [ ] Run `python seed_catalog.py` to populate kpi_catalog
- [ ] Set `ANTHROPIC_API_KEY` in `.env`
- [ ] Test full pipeline with real BGO Excel data (both interview + skip paths)
- [ ] Wire up AI enhancement passes in schema_mapper + data_modeler + kpi_suggester (use_ai=True)
- [ ] Build dashboard view page (`app/dashboard/[recipeId]/page.tsx`)
- [ ] Implement PPTX export endpoint + download button in recipe page
- [ ] Migrate frontend from Next.js 16 to React + Vite (per PROJECT_PLAN Week 3)
