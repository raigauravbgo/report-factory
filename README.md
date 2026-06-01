# BGO Report Factory

Self-service BI tool for BGO operations teams. Upload Excel/CSV data, answer a few questions, and get a live interactive dashboard — no Power BI ticket required.

---

## What It Does

1. **Upload** an Excel or CSV file (≤ 50MB)
2. **Profile** — columns are auto-detected (types, missing %, sample values)
3. **Interview** — AI chat collects date column, KPIs, dimensions, granularity, filters
4. **Recipe** — review and approve the generated report configuration
5. **Dashboard** — live KPI cards, trend charts, dimension breakdowns, Excel + PPTX export
6. **Review Queue** — central data team approves outputs before publishing

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Python | 3.10+ | `python --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Git | Any | `git --version` |

**Required API key:** OpenAI (`OPENAI_API_KEY`) — get one at [platform.openai.com](https://platform.openai.com)

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

# Create virtual environment
python -m venv venv

# Activate (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Activate (Mac/Linux)
source venv/bin/activate
```

#### Install dependencies

> **Windows users:** If `pip install -r requirements.txt` fails with a `MemoryError`, install in batches:

```powershell
# Batch 1 — core
pip install fastapi==0.136.1 "uvicorn[standard]==0.47.0" pydantic==2.13.4 pydantic-settings==2.14.1 python-multipart==0.0.29 httpx==0.28.1

# Batch 2 — data + export
pip install pandas==2.3.0 openpyxl==3.1.5 python-pptx==1.0.2 sqlalchemy==2.0.49 alembic==1.18.4

# Batch 3 — AI
pip install openai==2.37.0 anthropic==0.105.2 litellm==1.85.0

# Batch 4 — agent + storage
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

Open `.env` and fill in your API key:

```env
# Required
OPENAI_API_KEY=sk-proj-...        ← your OpenAI key

# Already set — no changes needed for local dev
DATABASE_URL=sqlite:///./dev.db
S3_BUCKET=local-storage
ADK_ENABLED=false
ADK_PROVIDER=openai
ADK_MODEL=gpt-4o-mini
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
uvicorn main:app --port 8000
```

Verify it's running: open [http://localhost:8000/health](http://localhost:8000/health)

You should see:
```json
{"status": "ok", "app": "BGO Report Factory"}
```

The first startup will:
- Create the SQLite database (`backend/dev.db`) automatically
- Seed all 69 BGO KPIs into the catalog

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

You need **two terminals running at the same time**:

| Terminal | Command | URL |
|---|---|---|
| Backend | `cd backend && uvicorn main:app --port 8000` | http://localhost:8000 |
| Frontend | `cd frontend && npm run dev` | http://localhost:3000 |

---

## Switching AI Providers

Edit the root `.env` file — no code changes needed:

```env
# Default — uses your existing OPENAI_API_KEY
ADK_ENABLED=false       # OpenAI only (Flow 1)
ADK_ENABLED=true        # ADK agent primary, OpenAI fallback

# To use Claude instead of OpenAI for the ADK agent:
ADK_PROVIDER=anthropic
ADK_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

---

## ADK Agent Debug UI (optional)

To see trace logs for every agent step:

```powershell
cd backend
$env:OPENAI_API_KEY = "sk-proj-..."   # set your key explicitly
adk web --port 8001
```

Open [http://localhost:8001](http://localhost:8001) → select **agent** → New Session.

---

## PPTX Export

The PPTX export code is built. To activate BGO branding:

1. Obtain the BGO PowerPoint slide master (`.pptx` file) from Marketing
2. Place it at `backend/exporters/bgo_slide_master.pptx`
3. Restart the backend — branding activates automatically

Without the slide master file, exports use a clean BGO-branded blank presentation.

---

## Project Structure

```
report-factory/
├── backend/           FastAPI + Python
│   ├── agent/         Google ADK agent + 5 tools
│   ├── api/routes/    HTTP endpoints
│   ├── catalog/       69 KPI definitions + 4 report templates
│   ├── exporters/     Excel + PPTX export
│   ├── services/      KPI computation, interview, profiling
│   └── db/            SQLite schema + helpers
├── frontend/          Next.js 16 App Router
│   ├── app/           8 pages (Library, Upload, Profile, Interview, Recipe, Dashboard, Review Queue, Report Detail)
│   └── components/    UI design system (sidebar, KPI cards, charts, filters)
└── .env               Root environment config (backend reads this)
```

Full technical details: see [PROJECT_PLAN.md](PROJECT_PLAN.md)

---

## Troubleshooting

**`pip install` fails with MemoryError (Windows)**
→ Install in batches (see Step 2 above). Ensure you have at least 4GB RAM free.

**`.\venv\Scripts\Activate.ps1` blocked by execution policy**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Backend starts but `/upload` returns 500**
→ Make sure `.env` is in the **project root** (not inside `backend/`), and you ran `uvicorn` from inside `backend/`.

**`ADK_ENABLED=true` but interview uses OpenAI anyway**
→ Check the backend terminal for `WARNING ADK failed` — it fell back to Flow 1. Common cause: missing `OPENAI_API_KEY` in the process environment.

**`adk web` shows no response**
→ Set `OPENAI_API_KEY` explicitly before running: `$env:OPENAI_API_KEY = "sk-proj-..."`

**Frontend shows "TypeError: Failed to fetch"**
→ Confirm the backend is running at `http://localhost:8000/health` and that `frontend/.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:8000`.
