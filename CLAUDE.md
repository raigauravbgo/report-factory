# Executive Dashboard — AI-Powered Self-Service BI Tool

## Project Overview

An AI-agent-driven self-service analytics platform that allows non-technical ops users to upload raw data files (CSV/Excel), automatically understand the schema, derive KPIs, and generate interactive dashboards — with no human-in-the-loop data engineering required.

**Core problem being solved:** Dashboard creation currently requires multiple handoffs (ops → BI team → data team → analysis → delivery). This tool eliminates those intermediary steps, enabling ops leaders to go directly from raw data to a live dashboard.

---

## Repository Structure

```
d:\dashboard\
├── backend/                    ← FastAPI backend (unified from both codebases)
│   ├── main.py                 ← Application entry point; registers all routers
│   ├── requirements.txt        ← Python dependencies
│   ├── seed_catalog.py         ← Seeds SQLite kpi_catalog from catalog/kpis.json
│   ├── core/                   ← Config (Pydantic Settings) + SQLAlchemy engine
│   ├── api/routes/             ← upload, interview, kpis, reports, analysis, export, registry
│   ├── models/                 ← SQLAlchemy ORM models (Upload, StagingTable, ReportRecipe, …)
│   ├── schemas/                ← Pydantic request/response models
│   ├── services/               ← parser, profiler, ai_interview, schema_inference, storage
│   ├── medallion/              ← bronze.py, silver.py, gold.py (data pipeline)
│   ├── kpi_registry/           ← KPIRegistry class + synonyms.yaml + definitions/*.yaml
│   ├── export/                 ← excel_export.py, pptx_export.py
│   ├── catalog/                ← kpis.json (unified 192-KPI catalog)
│   ├── db/                     ← SQLite helpers (schema.sql, database.py)
│   ├── migrations/             ← Alembic migrations (0001, 0002)
│   └── agent/                  ← ADK root agent with 5 tools
│
├── frontend/                   ← Next.js 16 + React + TypeScript + Tailwind + Recharts
│   ├── app/
│   │   ├── upload/             ← Step 1: File drop + file type label
│   │   ├── profile/[uploadId]/ ← Step 2: Column type/role review
│   │   ├── mapping/[uploadId]/ ← Step 3: AI-mapped column review + confirm
│   │   ├── kpis/               ← Step 4: KPI selection (available/blocked)
│   │   ├── dashboard/[id]/     ← Step 5: KPI cards + Recharts + export buttons
│   │   ├── interview/          ← Alt path: 5-step AI interview → recipe
│   │   └── recipe/[id]/        ← Alt path: recipe review + approval
│   ├── components/
│   │   ├── UploadZone.tsx      ← Drag-drop file input
│   │   ├── ColumnTable.tsx     ← Column profile table with role overrides
│   │   ├── MappingTable.tsx    ← AI mapping review with confidence bars
│   │   ├── KpiSelector.tsx     ← Available/blocked KPI card grid
│   │   ├── KpiCard.tsx         ← Scalar KPI tile
│   │   └── ChartCard.tsx       ← Recharts wrapper (bar/line/pie/table)
│   └── lib/
│       ├── api.ts              ← Typed fetch wrapper for all API endpoints
│       └── types.ts            ← TypeScript interfaces
│
├── migrate_yaml_kpis.py        ← One-time script: YAML KPIs → unified catalog/kpis.json
├── docker-compose.yml          ← API + MySQL (MySQL optional; SQLite is default)
├── Procfile                    ← Railway deployment entry point
└── .env.example                ← Environment variable template
```

---

## Architecture

### User Flow — Two Paths

**Primary (Direct) Path:**
```
Upload → Profile → Map Columns → Confirm Mapping
→ Select KPIs → Run Analysis → Dashboard → Export
```

**AI Interview Path (for reusable recipes):**
```
Upload → Profile → AI Interview → Recipe Review → Approve
→ Dashboard → Export
```

Both paths converge at `/dashboard/[recipeId]`.

### Medallion Data Layers

| Layer | File | Responsibility |
|-------|------|----------------|
| **Bronze** | `backend/medallion/bronze.py` | Read raw CSV/Excel; return DataFrame + metadata |
| **Silver** | `backend/medallion/silver.py` | Rename columns per mapping, deduplicate, parse dates |
| **Gold** | `backend/medallion/gold.py` | Apply KPI formulas; return value + optional breakdown |

### KPI Registry Pipeline

```
YAML files (definitions/*.yaml)
  ↓ migrate_yaml_kpis.py (one-time)
catalog/kpis.json  (192 KPIs, unified format)
  ↓ seed_catalog.py (on startup)
SQLite kpi_catalog table
  ↓ GET /api/kpis or KPIRegistry class
Dashboard + KPI selection UI
```

Adding a new KPI: drop a YAML entry in `backend/kpi_registry/definitions/`, re-run
`python migrate_yaml_kpis.py` and `python backend/seed_catalog.py`. No code changes required.

---

## Data Models

| Model | Table | Key Columns |
|-------|-------|-------------|
| `Dataset` | `datasets` | client_id, name |
| `Upload` | `uploads` | client_id, dataset_id, s3_key, filename, **file_type**, status |
| `StagingTable` | `staging_tables` | upload_id, profile_data, **column_mapping**, **available_kpis**, **blocked_kpis** |
| `ReportRecipe` | `report_recipes` | upload_id, config, **selected_kpi_ids**, **computed_kpis**, **analysis_status** |
| `KpiDefinition` | `kpi_definitions` | recipe_id, name, formula |
| `DashboardConfig` | `dashboard_configs` | recipe_id, layout (JSON) |

SQLite also holds: `report_requests`, `kpi_catalog`, `schema_memory`, `review_queue`, `agent_log`

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/upload` | Upload file + file_type; triggers async parse → profile → schema inference |
| GET | `/upload/{id}` | Poll upload status |
| GET | `/upload/{id}/profile` | Get column profile (wait until status=profiled) |
| GET | `/upload/{id}/mapping` | Get AI-inferred column mapping |
| POST | `/upload/{id}/mapping/confirm` | Confirm mapping; evaluate KPI feasibility |
| POST | `/api/sessions/{id}/analyze` | Start bronze→silver→gold analysis |
| GET | `/api/sessions/{id}/status` | Poll analysis status |
| GET | `/api/sessions/{id}/dashboard` | Get computed KPI results |
| GET | `/api/sessions/{id}/export/excel` | Download Excel export |
| GET | `/api/sessions/{id}/export/pptx` | Download PowerPoint export |
| GET/POST | `/api/kpis` | KPI catalog CRUD |
| POST | `/api/kpis/{id}/review` | Mark KPI as central-team-reviewed |
| POST | `/interview` | Single turn of 5-step AI interview |
| POST | `/interview/recipe` | Create recipe from interview result |
| GET | `/interview/recipe/{id}` | Get recipe |
| POST | `/interview/recipe/{id}/approve` | Approve recipe (triggers gold computation) |
| GET | `/api/registry/columns` | All canonical column names |
| GET | `/api/registry/kpis` | All KPIs from YAML registry |
| GET/POST | `/api/reports` | Full ADK agent review queue workflow |
| GET | `/health` | Health check |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, Recharts 3 |
| Backend | FastAPI 0.115, Python 3.11+, Uvicorn |
| AI — Schema Inference | OpenAI gpt-4o-mini (with fallback if no API key) |
| AI — Interview/Agent | OpenAI gpt-4o / Azure OpenAI / Claude (ADK agent) |
| Data Processing | pandas 2.2, bronze/silver/gold medallion pipeline |
| KPI Formula Engine | 20+ formula types in gold.py + numerator/denominator model |
| KPI Registry | 192 KPIs across 11 domains — YAML authoring → SQLite storage |
| File Storage | S3 (boto3) with local filesystem fallback |
| Database | SQLite (default) / MySQL (optional, set DATABASE_URL) |
| ORM / Migrations | SQLAlchemy 2.0, Alembic |
| Export | openpyxl (Excel), python-pptx (PowerPoint) |
| Deployment | Railway (Procfile: `uvicorn backend.main:app`) |

---

## Development Setup

### Backend
```bash
cd d:\dashboard\backend
pip install -r requirements.txt
python seed_catalog.py          # populate SQLite kpi_catalog
uvicorn main:app --reload       # starts at http://localhost:8000
# API docs: http://localhost:8000/docs
```

### Frontend (Next.js)
```bash
cd d:\dashboard\report-factory-master\frontend
npm install
npm run dev                     # starts at http://localhost:3000
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` in `frontend/.env.local`.

### Environment Variables (.env)
```
DATABASE_URL=sqlite:///./dev.db   # or mysql://... for production
OPENAI_API_KEY=sk-...             # required for AI schema inference + interview
S3_BUCKET=local                   # set to real bucket for S3 storage
AWS_ACCESS_KEY_ID=                # leave empty for local filesystem fallback
```

---

## Non-Goals

- Not a Power BI replacement or wrapper.
- Not a fixed-schema dashboard — everything is data-driven.
- Not a real-time streaming tool — batch upload per session.
- Not multi-source join (single file per session for MVP).

---

## Domain Coverage

192 KPIs across: Collections, CX/Call Center, Sales/Revenue, Workforce, Retail, Work Avoidance, Generic/Ops.
All KPIs are domain-agnostic from the system's perspective — a new domain needs only a new YAML file.
