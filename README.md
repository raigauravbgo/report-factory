# BGO Report Factory

Self-service BI tool for BGO operations teams. Upload multiple Excel/CSV files, answer a few questions, and get a live interactive dashboard — no Power BI ticket required.

---

## What It Does

| Step | Name | Description |
|---|---|---|
| 1 | **Multi-File Upload** | Upload up to 10 Excel/CSV files simultaneously (≤ 50MB each) |
| 2 | **Deep Profiling** | Auto-detects encoding, delimiter, sheet names, column types, null %, duplicates, and grain candidates |
| 3 | **Schema Mapping** | AI classifies each column as Dimension / Measure / Date / Key with semantic tags and grain scoring — fully editable |
| 4 | **Relationship Detection** | Fuzzy-matches column names and value sets across files to suggest join keys |
| 5 | **AI Interview** | Side-panel chatbot — Q1 is a fixed domain question; Q2+ are generated from your column profiles |
| 6 | **KPI Selection** | Scrollable checkable list matched against the 69-KPI catalog; add custom KPIs inline |
| 7 | **Data Validation** | Checks for zero-value denominators, high null %, duplicate grain keys before generating the dashboard |
| 8 | **Dashboard** | Story-driven KPI sections, trend charts, dimension breakdowns, Excel + PPTX export |

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Python | 3.12+ | `python --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Git | Any | `git --version` |

**API key required:** At minimum one of:
- OpenAI — `OPENAI_API_KEY` at [platform.openai.com](https://platform.openai.com)
- Anthropic — `ANTHROPIC_API_KEY` at [console.anthropic.com](https://console.anthropic.com)

---

## Setup — Step by Step

### 1. Clone the repo

```bash
git clone https://github.com/raigauravbgo/report-factory.git
cd report-factory
```

---

### 2. Backend

```powershell
cd backend

# Create virtual environment (Python 3.12 recommended)
python -m venv new-env

# Activate (Windows PowerShell)
.\new-env\Scripts\Activate.ps1

# Activate (Mac/Linux)
source new-env/bin/activate
```

#### Install dependencies

> **Windows users:** If `pip install -r requirements.txt` fails with a `MemoryError`, install in batches:

```powershell
# Batch 1 — core API
pip install fastapi==0.136.1 "uvicorn[standard]==0.47.0" pydantic==2.13.4 pydantic-settings==2.14.1 python-multipart==0.0.29 httpx==0.28.1

# Batch 2 — data processing
pip install pandas==2.3.0 openpyxl==3.1.5 chardet==5.2.0 python-pptx==1.0.2

# Batch 3 — database
pip install sqlalchemy==2.0.49 alembic==1.18.4

# Batch 4 — AI providers
pip install openai==2.37.0 anthropic==0.105.2 litellm==1.85.0

# Batch 5 — agent + storage + utilities
pip install google-adk==2.1.0 boto3==1.38.0 cryptography==48.0.0 "python-jose[cryptography]==3.5.0" asteval==1.0.8
```

> **Mac/Linux users:** A single command works:
> ```bash
> pip install -r requirements.txt
> ```

---

### 3. Configure environment

```powershell
# Copy the example env file to the project root
Copy-Item backend\.env.example .env    # Windows
# cp backend/.env.example .env         # Mac/Linux
```

Open `.env` and fill in your keys:

```env
# ── LLM Provider — pick one ───────────────────────────────────────────────────
LLM_PROVIDER=openai          # or: anthropic

# OpenAI (default)
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini

# Anthropic (set LLM_PROVIDER=anthropic to activate)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# ── Already set — no changes needed for local dev ─────────────────────────────
DATABASE_URL=sqlite:///./dev.db
ADK_ENABLED=false
MAX_UPLOAD_SIZE_MB=50
MAX_EXCEL_ROWS=200000
MAX_CSV_ROWS=200000
MAX_UPLOAD_FILES=10
MAX_COLUMNS_PER_FILE=200
```

Also create the frontend env file:

```powershell
# Windows
"NEXT_PUBLIC_API_URL=http://localhost:8000" | Out-File -Encoding utf8 frontend\.env.local

# Mac/Linux
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > frontend/.env.local
```

---

### 4. Start the backend

```powershell
# Must be run from inside backend/
cd backend
uvicorn main:app --reload --port 8000
```

Verify it's running: open [http://localhost:8000/health](http://localhost:8000/health)

```json
{"status": "ok", "app": "BGO Report Factory"}
```

The first startup automatically:
- Runs Alembic migrations to create / update all database tables
- Seeds all 69 BGO KPIs into the catalog

---

### 5. Start the frontend

Open a **new terminal**:

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the Report Library.

---

## Running the App

Two terminals must be running simultaneously:

| Terminal | Command | URL |
|---|---|---|
| Backend | `cd backend && uvicorn main:app --reload --port 8000` | http://localhost:8000 |
| Frontend | `cd frontend && npm run dev` | http://localhost:3000 |

---

## Switching LLM Provider

Edit `.env` — **no code changes needed**:

```env
# Use OpenAI (default)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini

# Use Anthropic Claude
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Restart the backend after changing `LLM_PROVIDER`. All AI calls (interview, profiling suggestions, KPI matching, dashboard section grouping) route through the selected provider.

---

## Upload Limits

| Constraint | Default | Env var |
|---|---|---|
| File size | 50 MB per file | `MAX_UPLOAD_SIZE_MB` |
| Excel rows | 200,000 | `MAX_EXCEL_ROWS` |
| CSV rows | 200,000 | `MAX_CSV_ROWS` |
| Files per batch | 10 | `MAX_UPLOAD_FILES` |
| Columns per file | 200 | `MAX_COLUMNS_PER_FILE` |

Files exceeding these limits are rejected with a clear error message in the UI.

---

## ADK Agent Debug UI (optional)

To trace every agent step (inputs, tool calls, outputs, latency):

```powershell
cd backend
adk web --port 8001
```

Open [http://localhost:8001](http://localhost:8001) → select **agent** → New Session.

Requires `ADK_ENABLED=true` in `.env` for the agent to be active in the main flow.

---

## PPTX Export

The PPTX export is fully built. To activate BGO branding:

1. Obtain the BGO PowerPoint slide master (`.pptx`) from Marketing
2. Place it at `backend/exporters/bgo_slide_master.pptx`
3. Restart the backend — branding activates automatically

Without the slide master, exports use a clean blank presentation.

---

## Project Structure

```
report-factory/
├── backend/
│   ├── agent/                    Google ADK agent + 6 tools
│   ├── api/routes/
│   │   ├── upload.py             POST /upload, POST /upload/batch, POST /upload/{id}/schema
│   │   ├── session.py            POST /session/{id}/relationships|interview|kpi-suggestions|validate|generate
│   │   ├── interview.py          Legacy single-file interview + recipe endpoints
│   │   ├── dashboard.py          GET /api/dashboard/{id}/data + exports
│   │   ├── kpis.py               KPI catalog CRUD
│   │   └── reports.py            Review queue endpoints
│   ├── catalog/
│   │   ├── kpis.json             69 BGO KPI definitions (collections, CX, sales, workforce)
│   │   └── templates/            4 templates: client_health, wbr_qbr, exec_scorecard, kpi_spotlight
│   ├── migrations/               Alembic schema migrations
│   ├── models/                   SQLAlchemy ORM (Dataset, Upload, StagingTable, ReportRecipe, ...)
│   ├── services/
│   │   ├── ai_client.py          LLM provider router (OpenAI / Anthropic / Azure)
│   │   ├── ai_interview.py       Flow 1 hybrid interview (Q1 fixed, Q2+ dynamic)
│   │   ├── parser.py             CSV/Excel parser with chardet encoding + sniffer delimiter
│   │   ├── profiler.py           Column type, semantic tag, grain score detection
│   │   ├── schema_relationships.py  Cross-file FK / shared-key inference
│   │   ├── kpi_suggester.py      Catalog fuzzy match + interview context boost
│   │   ├── data_validator.py     Pre-dashboard zero-denom, null, dupe checks
│   │   ├── session_generator.py  Story-driven recipe generation from session state
│   │   ├── recipe_generator.py   Legacy single-file recipe generator
│   │   └── compute.py            KPI formula engine, time series, breakdowns
│   ├── exporters/pptx_exporter.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── upload/page.tsx           Multi-file batch upload with per-file status
│   │   ├── session/[datasetId]/
│   │   │   ├── schema/page.tsx       Per-file column mapping (editable roles, tags, grain)
│   │   │   ├── interview/page.tsx    Hybrid Flow 1 chatbot with skip option
│   │   │   └── kpis/page.tsx         Two-panel checkable KPI list with custom KPI form
│   │   ├── dashboard/[recipeId]/     KPI cards, charts, filters, Excel + PPTX export
│   │   ├── recipe/[recipeId]/        Recipe review and approval
│   │   ├── review-queue/             Central team review interface
│   │   └── ...legacy single-file pages
│   ├── components/
│   │   ├── UploadZone.tsx            Multi-file dropzone (up to 10 files)
│   │   ├── ColumnTable.tsx           Column review with semantic tag + grain score columns
│   │   └── SchemaRelationships.tsx   Cross-file relationship cards (confirm/dismiss)
│   └── lib/
│       ├── api.ts                    Typed API client (batch upload + all session endpoints)
│       └── types.ts                  TypeScript interfaces for all pipeline stages
├── project_plan1.md              Task tracker (per-step checkboxes)
├── PRD3.md                       Product requirements (single source of truth)
└── .env                          Root environment config (backend reads this)
```

---

## Troubleshooting

**File upload shows "Failed" with no error message**
→ Check the backend terminal for the actual exception. Common causes:
- `chardet` not installed: `pip install chardet==5.2.0`
- Alembic migration not applied: `cd backend && alembic stamp 0001 && alembic upgrade head`
- Row limit exceeded: file has more than `MAX_EXCEL_ROWS` / `MAX_CSV_ROWS`

**`pip install` fails with MemoryError (Windows)**
→ Install in batches (see Step 2 above). Ensure at least 4GB RAM is free.

**`.\new-env\Scripts\Activate.ps1` blocked by execution policy**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Backend starts but `/upload` returns 500**
→ Make sure `.env` is in the **project root** (not inside `backend/`), and run `uvicorn` from inside `backend/`.

**`LLM_PROVIDER=anthropic` but calls are still going to OpenAI**
→ Restart the backend after changing `.env`. Confirm `ANTHROPIC_API_KEY` is set and non-empty.

**`ADK_ENABLED=true` but interview uses OpenAI anyway**
→ Check the backend terminal for `WARNING ADK failed` — it auto-fell back to Flow 1. Common cause: missing `OPENAI_API_KEY` in the process environment.

**Schema mapping page shows "Session expired"**
→ The page reads upload IDs from `sessionStorage`. If you navigated directly to the URL without going through the upload page, go back to `/upload` and re-upload your files.

**Frontend shows "TypeError: Failed to fetch"**
→ Confirm the backend is running at `http://localhost:8000/health` and that `frontend/.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:8000`.

**`adk web` shows no response**
→ Set `OPENAI_API_KEY` explicitly before running: `$env:OPENAI_API_KEY = "sk-proj-..."`
