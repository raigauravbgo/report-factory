# BGO Report Factory

AI-powered self-service BI tool for BGO operations teams. Upload Excel/CSV files and generate interactive dashboards — no Power BI team required.

> First surface of the **BGO AI Platform**. The KPI catalog, schema memory, and pipeline architecture built here are inherited by all future BGO AI agents.

---

## What It Does

Users follow an 8-step guided pipeline:

```
Upload Files → Schema Mapping → Data Modeling → Interview (optional)
  → KPI Selection → Dimension Selection → Recipe Editor → Dashboard
```

At each step, AI suggests sensible defaults (column types, fact/dimension roles, relevant KPIs, dimensions to slice by). Users review and override any suggestion before advancing. The final output is an interactive dashboard with KPI scorecards, trend charts, segment breakdowns, and coaching insights.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2 + React 19 + TypeScript + Tailwind CSS 4 |
| Backend | FastAPI + Python 3.12 |
| Data | pandas 2.2 |
| Database | SQLite + SQLAlchemy 2.0 + Alembic |
| AI / LLM | Claude (`claude-sonnet-4-20250514`) via Anthropic API + OpenAI/Azure OpenAI |
| Agent | Google ADK (local) |
| Charts | Recharts 3.x |
| Formula sandbox | asteval |
| Storage | Local filesystem (S3-ready via `services/storage.py`) |

---

## Prerequisites

- Python 3.12+
- Node.js 20+
- An Anthropic API key (and optionally OpenAI or Azure OpenAI)

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/raigauravbgo/report-factory.git
cd report-factory
```

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Database (SQLite default — change to postgres:// for production)
DATABASE_URL=sqlite:///./report_factory.db

# Storage (leave blank for local filesystem)
S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_REGION=us-east-1

# LLM (optional — Anthropic is used by default)
OPENAI_API_KEY=
USE_AZURE_OPENAI=false
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=

# App
APP_ENV=development
MAX_UPLOAD_SIZE_MB=50
```

Run database migrations and start the server:

```bash
alembic upgrade head
uvicorn main:app --reload --port 8000
```

API is available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App is available at `http://localhost:3000`.

---

## Project Structure

```
report-factory/
├── backend/
│   ├── main.py                     # FastAPI app entrypoint
│   ├── core/                       # Config + DB session
│   ├── db/                         # Raw SQLite helpers + schema.sql
│   ├── models/                     # SQLAlchemy ORM models
│   ├── schemas/                    # Pydantic request/response schemas
│   ├── api/routes/                 # Route handlers (one file per domain)
│   ├── services/                   # Business logic layer
│   ├── migrations/                 # Alembic migration scripts
│   ├── catalog/kpis.json           # 58 BGO KPIs (proprietary — do not modify structure)
│   └── agent/report_factory_agent/ # Google ADK agent
└── frontend/
    ├── app/                        # Next.js App Router pages
    ├── components/                 # Reusable UI components
    └── lib/                        # API client (api.ts) + TypeScript types (types.ts)
```

---

## Pipeline — Step by Step

### Step 1 — Upload Files
Upload one or more `.xlsx` or `.csv` files (up to 50 MB each). All files in a batch form a single **dataset**. The backend parses each file into a staging table and runs column profiling in the background.

### Step 2 — Schema Mapping (`/schema-mapping/{datasetId}`)
AI classifies each column's data type (`int / float / boolean / text / date`), role (`measure / dimension / date`), and filter candidacy. Users review per-file tabs in `SchemaColumnTable` and override any suggestion. On confirm, the pipeline advances to data modeling.

**Validation:** fact table must have ≥1 date column and ≥1 measure; no duplicate column names across files.

### Step 3 — Data Modeling (`/data-modeling/{datasetId}`)
AI classifies each file as a **fact** or **dimension** table, detects primary keys, and infers foreign key relationships (4 detection strategies + referential integrity check). Users can change roles, set PKs, add/remove FK relationships.

**Validation:** circular FK graphs are flagged; referential integrity < 90% raises a warning.

### Step 4 — Interview (`/interview`) — Optional
A 5-step guided chat collects: date column, KPI definitions (name + formula), dimensions, time granularity, and filter columns. A **Skip** button bypasses this step entirely and proceeds to KPI Selection using AI defaults.

### Step 5 — KPI Selection (`/kpi-selection/{datasetId}`)
AI scores the 58-KPI catalog by column-name match and relevance. KPIs scoring ≥ 0.7 are pre-selected. Users can deselect catalog KPIs and add **custom KPIs** with their own formula. The `FormulaInput` component validates formulas live via the `asteval` sandbox.

### Step 6 — Dimension Selection (`/dimension-selection/{datasetId}`)
Shows dimension-role columns from confirmed **dimension tables only** (fact table dimensions are excluded). Columns are grouped by source table. AI recommends which to include. Users confirm their selection for dashboard slicing and grouping.

### Step 7 — Recipe Editor (`/recipe/{recipeId}`)
The recipe is the central config object (`RecipeConfig`). Users can edit KPI names and formulas, change chart types (`line / bar / table / kpi_card`), reorder charts, set null handling, and rename columns. All formula changes are validated live. Approving the recipe locks it and advances to the dashboard.

### Step 8 — Dashboard (`/dashboard/{recipeId}`)
Fully interactive dashboard with:
- **KPI scorecards** — current value, status badge (good/neutral/warning/risk)
- **Trend charts** — time-series per KPI (Recharts LineChart, mean reference line)
- **Driver charts** — horizontal bar charts per dimension × KPI
- **Benchmark insights** — for each KPI, highlights the top-performing segment and the gap from average; severity scales with spread width
- **Filter bar** — dynamic dropdowns per dimension column (re-fetches data on change)
- **Data quality strip** — coverage dates, row count, staleness and null warnings

---

## KPI Catalog

`backend/catalog/kpis.json` contains 58 pre-reviewed BGO KPIs across four domains:

| Domain | Count | Examples |
|---|---|---|
| collections | 24 | Contact Rate, PTP Rate, Net Collected, Penetration Rate |
| cx | 16 | QA Score, CSAT Score, Compliance %, Coaching % |
| sales | 6 | Close Rate, Offer Rate, Opportunity Rate |
| workforce | 11 | Schedule Adherence, Attrition %, Productive Hours |

Each KPI has: `kpi_id`, `display_name`, `description`, `numerator`, `denominator`, `format`, `domain`, `expected_range`, `aliases`, `source_fields`.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DATABASE_URL` | Yes | SQLite or PostgreSQL connection string |
| `OPENAI_API_KEY` | No | OpenAI fallback |
| `USE_AZURE_OPENAI` | No | Use Azure OpenAI instead of OpenAI direct |
| `AZURE_OPENAI_ENDPOINT` | No | Azure endpoint URL |
| `AZURE_OPENAI_API_KEY` | No | Azure API key |
| `AZURE_OPENAI_DEPLOYMENT` | No | Azure deployment name |
| `S3_BUCKET` | No | S3 bucket (blank = local filesystem) |
| `AWS_ACCESS_KEY_ID` | No | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | No | AWS credentials |
| `S3_REGION` | No | AWS region (default: `us-east-1`) |
| `APP_ENV` | No | `development` or `production` (default: `development`) |
| `MAX_UPLOAD_SIZE_MB` | No | Per-file upload limit (default: `50`) |

---

## Development Notes

- **Migrations:** Run `alembic upgrade head` after pulling changes. Migration `0002` adds `column_schemas`, `data_models` tables and new columns on `datasets` and `uploads`.
- **AI passes:** Schema mapping, data modeling, KPI suggestions, and dimension suggestions all have an optional AI enhancement pass (`use_ai=True`). In development these default to the rule-based path for speed.
- **Formula safety:** All KPI formulas are evaluated via `asteval` — never raw `eval()`. The same sandbox is used on both server-side validation and live client-side feedback.
- **Audit trail:** The `column_schemas` table stores both `ai_detected_*` and `confirmed_*` columns. `COALESCE(confirmed_*, ai_*)` gives the effective value. The AI suggestion is never overwritten, only shadowed.
- **`pipeline_stage`:** `datasets.pipeline_stage` is the single source of truth for where a dataset is in the flow. Use it to resume interrupted sessions.

---

## Contributing

Branch from `master`. Branch name convention: `{name}_{purpose}` (e.g. `nida_stagging`). Open a PR against `master` and request review from the data team before merging.
