# BGO Report Factory

Self-service BI tool for BGO operations teams. Upload multiple Excel/CSV files, answer a few questions, and get a live interactive dashboard — no Power BI ticket required.

---

## What It Does

| Step | Name | Description |
|---|---|---|
| 1 | **Multi-File Upload** | Upload up to 10 Excel/CSV files simultaneously (≤ 50MB each) |
| 2 | **Deep Profiling** | Auto-detects encoding, delimiter, sheet names, column types, null %, duplicates, and grain candidates |
| 3 | **Schema Mapping** | AI classifies each column as Dimension / Measure / Date / Key; user can override table type (Fact / Dimension / Unknown); Virtual Dimension builder synthesises a dimension table from shared fact columns when no Roster file is uploaded |
| 4 | **Relationship Detection** | Fuzzy-matches column names and value sets across files to suggest join keys; user confirms in the UI |
| 5 | **AI Interview** | **Two modes:** (a) **Flow 1** — step-by-step chatbot, Q1 fixed, Q2–Q6 dynamically generated from column profiles; (b) **ADK Agent** — conversational AI completes the full flow (data discovery → interview → KPI + dimension selection → dashboard generation) in one chat |
| 6 | **KPI Selection** | AI-first suggestions from 87-KPI catalog; add custom KPIs inline *(bypassed in ADK agent mode)* |
| 7 | **Dimension Selection** | Pick which categorical columns drive breakdown charts *(bypassed in ADK agent mode)* |
| 8 | **Data Validation** | Checks for zero-value denominators, high null %, duplicate grain keys before generating the dashboard |
| 9 | **Dashboard** | Story-driven KPI sections, trend charts, dimension breakdowns, Excel + PPTX export |

**Template fast-path:** After profiling, if a saved template matches your files at ≥ 95% column overlap, a "Use Template" button skips steps 5–8 and takes you to a Review page where you can tweak config before generating.

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
- Seeds all 87 BGO KPIs into the catalog

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

## ADK Agent (AI-Guided Interview)

When `ADK_ENABLED=true` in `.env`, the session interview page switches from the step-by-step Flow 1 chatbot to an AI agent that handles the entire pipeline in one conversation — data discovery, interview, KPI selection, dimension selection, and dashboard generation.

The agent runs 9 tools: 6 legacy single-file tools + 3 new session-flow tools (`run_session_kpi_suggest`, `run_session_dimensions`, `run_session_generate`). Every LLM call and agent step is logged to the `llm_call_logs` and `agent_trace_events` tables (prompt text is never stored — only a SHA-256 hash).

```env
# Enable ADK agent mode
ADK_ENABLED=true
ADK_PROVIDER=openai
ADK_MODEL=gpt-4o-mini
```

Set `ADK_ENABLED=false` (default) to use Flow 1 step-by-step. Both modes produce identical dashboards.

**ADK Debug UI:**

```powershell
cd backend
adk web --port 8001
```

Open [http://localhost:8001](http://localhost:8001) → select **agent** → New Session. Traces every tool call, input, output, and latency.

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
│   ├── agent/report_factory_agent/   Google ADK agent + 9 tools
│   │   ├── agent.py                  root_agent; plain conversational instructions
│   │   └── tools/
│   │       ├── data_discovery_from_upload.py  Primary session-flow tool (data profiling)
│   │       ├── session_kpi_suggest.py         Multi-file KPI suggestion tool
│   │       ├── session_dimensions.py          Multi-file dimension list tool
│   │       ├── session_generate.py            Multi-file dashboard generation tool
│   │       └── ... (5 legacy single-file tools)
│   ├── api/routes/
│   │   ├── upload.py             POST /upload, POST /upload/batch, PATCH /upload/{id}/table-type
│   │   ├── session.py            Full multi-file pipeline: relationships, interview (ADK or Flow 1),
│   │   │                         kpi-suggestions, dimensions, virtual-dimension, validate, generate
│   │   ├── interview.py          Legacy single-file interview
│   │   ├── dashboard.py          GET /api/dashboard/{id}/data + exports
│   │   ├── kpis.py               KPI catalog CRUD + custom proposal approve/reject
│   │   ├── templates.py          Saved templates + ≥95% column-overlap matching
│   │   └── reports.py            Review queue endpoints
│   ├── catalog/
│   │   ├── kpis.json             87 BGO KPI definitions (collections, CX, sales, workforce)
│   │   └── templates/            4 templates: client_health, wbr_qbr, exec_scorecard, kpi_spotlight
│   ├── migrations/               Alembic schema migrations
│   ├── models/
│   │   ├── dataset.py, upload.py, staging_table.py, report_recipe.py  (core pipeline)
│   │   ├── report_template.py    Saved templates + column fingerprints
│   │   ├── llm_call_log.py       Observability: per-LLM-call audit log (prompt hashed, never raw)
│   │   └── agent_trace_event.py  Observability: per-step ADK pipeline trace
│   ├── services/
│   │   ├── ai_client.py          LLM provider router (OpenAI / Anthropic / Azure); logs every call
│   │   ├── observability.py      log_llm_call() + create_trace_event(); fire-and-forget
│   │   ├── ai_interview.py       Flow 1 hybrid interview (Q1 fixed, Q2+ dynamic)
│   │   ├── adk_runner.py         ADK Runner + InMemorySessionService wrapper
│   │   ├── profiler.py           Column type, semantic tag, grain score, metric-name fix
│   │   ├── schema_relationships.py  Cross-file FK / shared-key inference (confidence ≤ 0.95)
│   │   ├── kpi_suggester.py      AI-first KPI matching + catalog fallback (threshold 0.55)
│   │   ├── virtual_dimension.py  Synthetic dimension from shared fact columns
│   │   ├── data_validator.py     Pre-dashboard zero-denom, null, dupe checks
│   │   ├── session_generator.py  Story-driven recipe generation from session state
│   │   ├── compute.py            KPI formula engine, cross-file JOINs, DF cache (120s TTL)
│   │   └── recipe_generator.py   LEGACY single-file recipe generator
│   ├── tests/                    58 tests (all passing) — pytest tests/ -v
│   ├── exporters/pptx_exporter.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── upload/page.tsx           Multi-file batch upload + template match check
│   │   ├── session/[datasetId]/
│   │   │   ├── schema/page.tsx       Per-file column mapping, table-type override,
│   │   │   │                         Virtual Dimension builder, relationship confirm
│   │   │   ├── review/page.tsx       Template fast-path: review saved config before generating
│   │   │   ├── interview/page.tsx    Dual-mode: ADK agent chat OR Flow 1 step-by-step chatbot
│   │   │   ├── kpis/page.tsx         KPI checklist (Flow 1 path; bypassed in ADK mode)
│   │   │   └── dimensions/page.tsx   Dimension selection (Flow 1 path; bypassed in ADK mode)
│   │   ├── dashboard/[recipeId]/     Story sections, KPI cards, trend charts, filters, export
│   │   ├── recipe/[recipeId]/        Recipe review and approval
│   │   ├── kpis/custom/page.tsx      Custom KPI proposal approve/reject UI
│   │   └── review-queue/             Central team review interface
│   ├── components/
│   │   ├── UploadZone.tsx            Multi-file dropzone (up to 10 files)
│   │   ├── ColumnTable.tsx           Column review with semantic tag + grain score
│   │   └── SchemaRelationships.tsx   Relationship confirm: saves to sessionStorage (no list mutation)
│   └── lib/
│       ├── api.ts                    Typed API client for all endpoints
│       └── types.ts                  TypeScript interfaces (InterviewResponse.is_adk_mode included)
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

**`ADK_ENABLED=true` but interview uses Flow 1 anyway**
→ Check the backend terminal for `SESSION_ADK_FALLBACK` or `WARNING ADK failed` log entries — the session route silently falls back to Flow 1 on any ADK exception. Common causes: missing `OPENAI_API_KEY`, ADK session not initialized, or an exception in a session tool. The UI shows the ADK "AI Agent active" badge if the first turn succeeded in ADK mode.

**Schema mapping page shows "Session expired"**
→ The page reads upload IDs from `sessionStorage`. If you navigated directly to the URL without going through the upload page, go back to `/upload` and re-upload your files.

**Frontend shows "TypeError: Failed to fetch"**
→ Confirm the backend is running at `http://localhost:8000/health` and that `frontend/.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:8000`.

**`adk web` shows no response**
→ Set `OPENAI_API_KEY` explicitly before running: `$env:OPENAI_API_KEY = "sk-proj-..."`
