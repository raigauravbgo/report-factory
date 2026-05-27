# Executive Dashboard — Application Flow

Here's the full flow with every file's role:

---

## Application Flow

### Step 1 — User Opens the App

**[`main.py`](main.py)** is the entry point. It creates the FastAPI app, registers all API route groups under `/api`, serves the frontend folder as static files, and returns `index.html` at `/`.

---

### Step 2 — Upload Files (Frontend)

**[`frontend/index.html`](frontend/index.html)** renders the 4-step wizard UI. Only the active step panel is visible at a time.

**[`frontend/js/app.js`](frontend/js/app.js)** is the global state manager. It holds `sessionId`, `currentStep`, `mappingData`, `selectedKpis`, etc. `goToStep(n)` controls which panel is shown. `notify()` shows toast messages.

**[`frontend/js/upload.js`](frontend/js/upload.js)** handles the drag-and-drop zone and file list in Step 1. When the user clicks **Upload**, it sends a `POST /api/sessions` request with the files and their labeled types (call log, revenue, etc.).

---

### Step 3 — Backend Receives Files

**[`app/api/upload.py`](app/api/upload.py)** handles `POST /api/sessions`. It saves each uploaded file to disk, calls the orchestrator to process them, and returns `session_id` + `mapping_suggestions`.

**[`app/agent/orchestrator.py`](app/agent/orchestrator.py)** is the pipeline coordinator. `create_session()` generates a UUID and creates the folder structure (`sessions/{id}/bronze/silver/gold/exports/`). `process_upload()` calls the bronze layer to read the file, then calls the AI agent for column mapping.

**[`app/medallion/bronze.py`](app/medallion/bronze.py)** is Layer 1 — raw ingestion. It reads the CSV or Excel file as-is into a pandas DataFrame and returns the column list + sample rows. No transformations here.

**[`app/agent/schema_inference.py`](app/agent/schema_inference.py)** calls **OpenAI (`gpt-4o-mini`)** with the column names and sample values. It returns a mapping of each raw column → canonical snake_case name with a confidence score (0–1) and status (`auto`, `review_needed`, `ignored`). If no API key is set, `orchestrator.py` falls back to `_fallback_mapping()` which just lowercases and underscores the names.

**[`app/config.py`](app/config.py)** loads environment variables from `.env` — including `OPENAI_API_KEY`, storage paths, and file size limits.

---

### Step 4 — Column Mapping Review (Frontend)

Back in the browser, **[`frontend/js/upload.js`](frontend/js/upload.js)** passes the mapping suggestions to `Mapping.init()` and calls `App.goToStep(2)`.

**[`frontend/js/mapping.js`](frontend/js/mapping.js)** renders the mapping table in Step 2. Each row shows the original column name, an editable canonical name input, a confidence bar, and a status badge. The user can override any mapping manually before proceeding.

When the user clicks **Confirm & Continue**, it sends `POST /api/sessions/{id}/mapping/confirm` with the final mapping.

---

### Step 5 — Data Quality & KPI Feasibility

**[`app/api/mapping.py`](app/api/mapping.py)** handles the confirm endpoint. It calls `orchestrator.confirm_mapping()`.

Back in **[`app/agent/orchestrator.py`](app/agent/orchestrator.py)**, `confirm_mapping()` extracts all confirmed canonical column names and passes them to the KPI registry.

**[`app/kpi_registry/registry.py`](app/kpi_registry/registry.py)** loads all `.yaml` definition files from the `definitions/` folder. `evaluate_feasibility()` compares the available columns against each KPI's `required_columns` and returns two lists: which KPIs are **available** and which are **blocked** (with the missing columns named).

**KPI definition files:**
- **[`app/kpi_registry/definitions/collections.yaml`](app/kpi_registry/definitions/collections.yaml)** — 8 KPIs for contact center/collections domain
- **[`app/kpi_registry/definitions/revenue.yaml`](app/kpi_registry/definitions/revenue.yaml)** — 6 KPIs for revenue analysis
- **[`app/kpi_registry/definitions/generic.yaml`](app/kpi_registry/definitions/generic.yaml)** — 4 universal KPIs (record count, date range, daily volume, segment breakdown) that work with almost any data

The quality result is returned to the frontend.

---

### Step 6 — KPI Selection (Frontend)

**[`frontend/js/mapping.js`](frontend/js/mapping.js)** receives the quality result and calls `Dashboard.initKpiSelection()`, then `App.goToStep(3)`.

**[`frontend/js/dashboard.js`](frontend/js/dashboard.js)** renders Step 3 — available KPI cards (all pre-selected, clickable to deselect) and blocked KPI cards (greyed out with reason). When the user clicks **Run Analysis**, it sends `POST /api/sessions/{id}/analyze` with the chosen KPI IDs.

---

### Step 7 — Analysis Pipeline Runs

**[`app/api/analysis.py`](app/api/analysis.py)** handles the analyze endpoint. It starts `orchestrator.run_analysis()` as a **background task** (non-blocking) and immediately returns. The frontend then polls `GET /api/sessions/{id}/status` every 1.5 seconds.

**[`app/agent/orchestrator.py`](app/agent/orchestrator.py)** `run_analysis()` runs the full pipeline:

1. Re-reads each file through **[`app/medallion/bronze.py`](app/medallion/bronze.py)** (raw read)
2. Passes to **[`app/medallion/silver.py`](app/medallion/silver.py)** — Layer 2 (cleaning): renames columns to canonical names, drops ignored columns, deduplicates rows, parses date columns
3. Passes to **[`app/medallion/gold.py`](app/medallion/gold.py)** — Layer 3 (KPI computation): for each selected KPI, looks up its formula (`sum(col)`, `count_by_date`, `sum_by_client`, etc.) and computes the result + optional breakdown dict

When complete, status is set to `"complete"` and results are saved to `state.json`.

---

### Step 8 — Dashboard Renders (Frontend)

The poll in **[`frontend/js/dashboard.js`](frontend/js/dashboard.js)** detects `analysis_status === "complete"` and fetches `GET /api/sessions/{id}/dashboard`. It then renders:
- **Scalar KPIs** (single value) → `.kpi-result-card` tiles
- **KPIs with breakdowns** → Chart.js canvas (bar, line, or pie based on `chart_type` in the YAML)

**[`frontend/css/styles.css`](frontend/css/styles.css)** provides all the visual styling — CSS variables for the color palette, step indicator states, confidence bar colors, chart card layout, notification animations.

---

### Step 9 — Export

**[`frontend/js/dashboard.js`](frontend/js/dashboard.js)** export buttons redirect the browser to the export URLs, triggering a file download.

**[`app/api/export.py`](app/api/export.py)** handles both routes and streams the generated files.

**[`app/export/excel_export.py`](app/export/excel_export.py)** uses `openpyxl` to build a `.xlsx` with a styled header row, KPI summary rows, and inline breakdown tables.

**[`app/export/pptx_export.py`](app/export/pptx_export.py)** uses `python-pptx` to build a `.pptx` with a title slide, KPI summary slide, and one slide per KPI breakdown.

---

## Summary Map

```
Browser                    Backend                        Storage
──────                    ───────                        ───────
index.html                main.py (router hub)
  app.js (state)
  upload.js          →    api/upload.py
                              orchestrator.py
                                bronze.py              uploads/{file}
                                schema_inference.py    (OpenAI API)
  mapping.js         →    api/mapping.py
                              orchestrator.py
                                registry.py            kpi definitions/*.yaml
  dashboard.js       →    api/analysis.py
    (polls status)            orchestrator.py (bg)
                                bronze → silver → gold  sessions/{id}/state.json
  dashboard.js       →    api/analysis.py (results)
  (export buttons)   →    api/export.py
                              excel_export.py / pptx_export.py
```
