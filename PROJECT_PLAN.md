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
| Frontend | React + Vite (port 5173) | Same — deployed as Railway static service |
| Charts | Recharts | Same |
| Export | python-pptx against BGO slide master | Same |
| Column matching | `difflib.SequenceMatcher` fuzzy match | pgvector semantic search |
| File storage | Local `/uploads` | Railway Volume — `UPLOAD_DIR` env var points to volume mount, no code change |
| ETL / transforms | pandas in-memory per report | dbt Core (deferred — introduce when second data source joins, e.g. Workday + telephony) |
| Auth | None | BGO SSO (SAML/OAuth2) |
| Secrets | `.env` file | Railway environment variables |

---

## Project Structure

```
report-automation/
├── backend/
│   ├── main.py                        # FastAPI app — all routes, init_db() on startup
│   ├── agent/
│   │   └── report_factory_agent/
│   │       ├── __init__.py
│   │       ├── agent.py               # Root ADK agent — 5 tools registered
│   │       └── tools/
│   │           ├── define_kpi.py      # New KPI definition (user-defined, reviewed=false)
│   │           ├── intake.py          # Step 1: template + KPI selection
│   │           ├── data_discovery.py  # Step 2: Excel parsing + fuzzy mapping
│   │           ├── standardise.py     # Step 3: KPI computation + validation
│   │           └── generate.py        # Step 4: chart JSON + review queue entry
│   ├── catalog/
│   │   ├── kpis.json                  # 69 KPI definitions (BGO IP — versioned)
│   │   └── templates/
│   │       ├── client_health.json
│   │       ├── wbr_qbr.json
│   │       ├── exec_scorecard.json
│   │       └── kpi_spotlight.json
│   ├── db/
│   │   ├── schema.sql                 # SQLite schema — source of truth (5 tables)
│   │   └── database.py                # Raw sqlite3 helpers — no ORM
│   ├── exporters/
│   │   └── pptx_exporter.py           # python-pptx against BGO slide master (Week 2)
│   ├── seed_catalog.py                # Idempotent: loads kpis.json → kpi_catalog table
│   ├── requirements.txt
│   └── .env.example
└── frontend/                          # Next.js (PRD1 base — migrate to React+Vite in Week 3)
    └── app/
```

---

## SQLite Schema

6 tables. JSON stored as TEXT blobs. No ORM — raw SQL via `db/database.py`. `CREATE TABLE IF NOT EXISTS` makes `init_db()` idempotent — runs on every FastAPI startup.

```sql
CREATE TABLE report_requests ( ... );   -- UUID PK, status, intake_spec, column_mapping,
                                        -- computed_kpis, data_quality_flags, chat_history
                                        -- NOTE: file_path col retained for compat; use report_files for multi-file

CREATE TABLE report_files     ( ... );  -- id PK, request_id FK, file_path, filename, uploaded_at
                                        -- One row per uploaded file. Upload endpoint called once per file.

CREATE TABLE kpi_catalog      ( ... );  -- kpi_id PK, numerator, denominator, format, domain,
                                        -- expected_range, aliases, source_fields, reviewed

CREATE TABLE schema_memory    ( ... );  -- PK (client_id, template_type), mappings, use_count
                                        -- mappings JSON includes source_file per KPI for multi-file recall

CREATE TABLE review_queue     ( ... );  -- request_id FK, status, overrides, reviewer_notes

CREATE TABLE agent_log        ( ... );  -- request_id, step, input, output, latency_ms
```

**column_mapping structure** (stored as JSON on `report_requests`):
```json
{
  "kpi_id": {
    "raw_column":  "Column Name in Excel",
    "source_file": "filename.xlsx",
    "confidence":  0.85,
    "needs_review": false
  }
}
```
`source_file` is the filename from `report_files`. Data discovery scans all uploaded files and assigns each KPI to the file where the best column match was found.

Full DDL in `db/schema.sql`.

---

## API Routes

```
# Report lifecycle
POST   /api/reports/                         Create request, return request_id
GET    /api/reports/                         List all reports (filter by created_by)
GET    /api/reports/{id}                     Get state + chat history
POST   /api/reports/{id}/upload              Upload one Excel file — call once per file, N files allowed
GET    /api/reports/{id}/files               List all uploaded files for this report
POST   /api/reports/{id}/upload/done         Signal that all files are uploaded → triggers data discovery
POST   /api/reports/{id}/confirm-mapping     Accept/override column mapping
GET    /api/reports/{id}/dashboard           Get computed KPIs + chart config JSON
GET    /api/reports/{id}/schema-memory       Check if stored mapping exists for client+template
GET    /api/reports/{id}/pptx                Download generated PPTX (Week 2)

# Review queue
GET    /api/reports/review-queue/list                    List (filter by status)
GET    /api/reports/review-queue/{id}/new-kpis           User-defined KPIs pending review
POST   /api/reports/review-queue/{id}/approve            Approve + save schema memory
                                                         body: {overrides, reviewer_notes, promote_kpis}
POST   /api/reports/review-queue/{id}/reject             Reject with comment

# KPI catalog
GET    /api/kpis                             List all KPIs (filter: ?domain= ?reviewed=)
GET    /api/kpis/{kpi_id}                    Single KPI detail
POST   /api/kpis                             Create KPI manually (central data team)
POST   /api/kpis/{kpi_id}/review             Mark KPI reviewed=true/false
```

---

## Week 1 — Backend + Agent Steps 1 & 2 ✅ COMPLETE

**Checkpoint:** Full intake conversation in Postman → upload Excel → column mapping draft returned.

### Infrastructure & Schema
- [x] FastAPI app with new `db/schema.sql` + raw SQLite via `db/database.py` — `init_db()` runs on startup
- [x] SQLite database (switched from MySQL/Docker)
- [x] Local file storage (`local_uploads/` — `UPLOAD_DIR` env var, points to Railway Volume in production)
- [x] Old Alembic/SQLAlchemy layer retained for existing upload/interview routes; new PRD3 routes use raw SQLite only
- [x] `seed_catalog.py` — idempotent, clears and re-inserts catalog; run once from `backend/`
- [ ] Add `report_files` table to `db/schema.sql` — one row per uploaded file per report
- [ ] `POST /api/reports/{id}/upload/done` — signals all files uploaded, triggers `run_data_discovery` across all files
- [ ] `GET /api/reports/{id}/files` — list uploaded files for a report

### KPI Catalog
- [x] `catalog/kpis.json` — **69 BGO KPIs** seeded across 4 domains:
  - `collections` (30): contact rate, PTP, net collected, dialler metrics, website payments, etc.
  - `cx` (20): QA score, CSAT, compliance, coaching, Affirm Care KPIs
  - `sales` (7): opportunity rate, offer rate, close rate (Lumen)
  - `workforce` (12): login/productive/paid hours, adherence, attrition, PVP %, etc.
  - 3 KPIs marked `reviewed=false` (interval_compliance, tardiness_pct, overtime_hours) — formula TBD
- [x] Catalog format locked: `kpi_id`, `display_name`, `numerator`, `denominator` (`_none_` for pure sums), `format`, `domain`, `expected_range`, `aliases`, `source_fields`, `reviewed`
- [x] `GET /api/kpis`, `GET /api/kpis?domain=`, `GET /api/kpis?reviewed=`, `GET /api/kpis/{id}`
- [x] `POST /api/kpis` — central team can add KPIs manually
- [x] `POST /api/kpis/{id}/review` — promotes user-defined KPI to reviewed=true

### Template JSON Files
- [x] `catalog/templates/client_health.json` — collections, required: contact_rate, ptp_rate, ptp_kept_rate
- [x] `catalog/templates/wbr_qbr.json` — collections, required + SLA KPIs
- [x] `catalog/templates/exec_scorecard.json` — workforce, required: login/productive/paid hours, occupancy
- [x] `catalog/templates/kpi_spotlight.json` — any domain, user selects KPI + one dimension

### ADK Agent — Setup
- [x] `google-adk>=1.0.0` + `anthropic>=0.30.0` in `requirements.txt` (installed: google-adk 1.32.0)
- [x] `agent/report_factory_agent/agent.py` — root ADK `Agent` with `claude-sonnet-4-20250514`, 5 tools registered as plain callables (ADK 1.x accepts `Callable` directly)
- [ ] `adk web` end-to-end trace verification (pending Week 2 checkpoint)
- [ ] `POST /api/reports/{id}/chat` — FastAPI proxy to ADK (pending)

### Agent Step 1 — Intake (`tools/intake.py`)
- [x] `run_intake(request_id, template_type, client_id, period_start, period_end, kpi_list)` — validates template + KPI IDs, writes `intake_spec` to DB, status → `awaiting_upload`
- [x] Missing KPIs return helpful error directing to `run_define_new_kpi` — not a hard block
- [x] Unreviewed (user-defined) KPIs allowed; surfaced in response as `unreviewed_kpis`
- [x] `run_define_new_kpi(display_name, numerator, denominator, format, domain, ...)` — creates catalog entry with `reviewed=false`; kpi_id auto-generated from display_name; collision-safe
- [x] Agent instruction covers the new-KPI interview branch (5 questions → define → proceed)

### Agent Step 2 — Data Discovery (`tools/data_discovery.py`)
- [x] `run_data_discovery(request_id, file_path)` — reads Excel via pandas, extracts headers + 5 sample rows + row count
- [x] Fuzzy column mapping via `difflib.SequenceMatcher` against `source_fields` + `aliases` + numerator/denominator per KPI; confidence < 0.7 flagged `needs_review=true`
- [x] `column_mapping` draft written to `report_requests`; status → `awaiting_mapping_confirmation`
- [x] `POST /api/reports/{id}/upload` — multipart file save to `local_uploads/{request_id}/`
- [ ] **Multi-file update:** `run_data_discovery` to scan all files in `report_files` for the request — aggregate headers across all files, assign each KPI to the file where the best match is found, record `source_file` in `column_mapping`
- [ ] `column_mapping` updated to include `source_file` field: `{kpi_id: {raw_column, source_file, confidence, needs_review}}`

---

## Week 2 — Steps 3 & 4 + Review Queue + Schema Memory

**Checkpoint:** Full loop via API only — intake → upload → confirm mapping → chart JSON → PPTX download → approve in review queue.

### Agent Step 3 — Standardise & Compute (`tools/standardise.py`)
- [x] `run_standardise(request_id, confirmed_mapping?)` — applies mapping, computes numerator/denominator per KPI, handles `_none_` denominator (pure sum), division-by-zero guard
- [x] Range validation against `expected_range` from catalog — flags are non-blocking
- [x] `computed_kpis` + `data_quality_flags` written to DB; status → `computed`
- [x] Step logged to `agent_log` with latency_ms
- [x] `POST /api/reports/{id}/confirm-mapping` — merges overrides, triggers Step 3 (manual) or agent calls `run_standardise` directly
- [ ] **Multi-file update:** `run_standardise` to open the correct file per KPI using `source_file` from `column_mapping` rather than a single `file_path`
- [ ] ADK traces verified in `adk web` (pending full end-to-end test)

### Agent Step 4 — Generate (`tools/generate.py`)
- [x] Chart-ready JSON built from `computed_kpis` + template `charts` config — KPI tiles + chart series per template chart definition
- [x] Review queue entry created automatically; status → `review`
- [x] `GET /api/reports/{id}/dashboard` — returns chart JSON (available once status = computed/review/approved)
- [x] Step logged to `agent_log`
- [ ] PPTX export (`exporters/pptx_exporter.py`) — `pptx_path` currently returns `null`; **needs `python-pptx` implementation + BGO slide master**
- [ ] `GET /api/reports/{id}/pptx` — stream PPTX file (pending above)

### Review Queue
- [x] `GET /api/reports/review-queue/list` — list by status (default: pending); includes report fields via JOIN
- [x] `POST /api/reports/review-queue/{id}/approve` — saves schema memory, sets status=approved, supports `overrides` + `promote_kpis` in body
- [x] `POST /api/reports/review-queue/{id}/reject` — sets status=rejected with reviewer_notes
- [x] `GET /api/reports/review-queue/{id}/new-kpis` — returns unreviewed KPIs associated with this report

### Schema Memory
- [x] On approve: `save_schema_memory(client_id, template_type, mappings)` written; `use_count` incremented via `ON CONFLICT DO UPDATE`
- [x] `GET /api/reports/{id}/schema-memory` — check endpoint for frontend pre-fill
- [ ] Step 2 pre-fill: `run_data_discovery` to check `schema_memory` on start — if match found, return stored mapping (including `source_file` per KPI) with `source=schema_memory` flag, skip fuzzy match
- [ ] Multi-file schema memory: stored mappings include `source_file`; on recall, validate that all referenced filenames are present in the new upload set before pre-filling
- [ ] Auto-approval path (Phase 1.5): schema_memory structure already supports it (`use_count`, `updated_at`). Gate conditions: stored mapping + exact header match across all files + all KPIs in range + no flags. Do not build yet; do not break the path.

---

## Week 3 — Frontend + Pilot

**Checkpoint:** Demo to leadership. MVP exit gate signed off.

### Frontend Migration
- [~] Upload + profiling UI exists in Next.js (PRD1 base — kept, not yet migrated)
- [~] Interview chat UI exists in Next.js (PRD1 base — kept, not yet migrated)
- [ ] Scaffold React + Vite app (`npm create vite@latest frontend -- --template react`)
- [ ] React Router for client-side routing

### Screen: Library (`pages/Library.jsx`)
- [ ] Grid of `report_requests` — card per report showing template, client, period, status badge
- [ ] Status badges: Intake / Mapping / Computing / Review / Published
- [ ] Filter by template type and client
- [ ] "New Report" button → `/intake`

### Screen: Intake Chat (`pages/Intake.jsx`)
- [ ] Chat UI wired to `POST /api/reports/{id}/chat`
- [ ] Progress stepper: Intake → Mapping → Computing → Review → Done
- [ ] Inline KPI checklist loaded from `GET /api/kpis` when agent asks about metrics
- [ ] File upload dropzone appears when agent asks for data source
- [ ] On intake complete: redirect to `/mapping/{id}`

### Screen: Mapping Confirmation (`pages/MappingConfirm.jsx`)
- [ ] Table: raw column | matched KPI | confidence score | override dropdown
- [ ] Red highlight for confidence < 0.7 or missing required KPI
- [ ] "Confirm mapping" → `POST /api/reports/{id}/confirm-mapping` → triggers Step 3

### Screen: Dashboard View (`pages/Dashboard.jsx`)
- [ ] Recharts render driven by `GET /api/reports/{id}/dashboard` chart JSON
- [ ] Template-driven layout (line charts for trends, bar for breakdowns, KPI tiles)
- [ ] Data quality flags shown as inline yellow warnings
- [ ] "Export PPTX" button → `GET /api/reports/{id}/pptx`

### Screen: Review Queue (`pages/ReviewQueue.jsx`)
- [ ] List view: pending items with template, client, period, requester, timestamp
- [ ] Detail view: KPI mapping table (raw column → KPI → value → confidence → flags), dashboard preview, PPTX link, new-KPI section
- [ ] Approve / Approve with edits (override KPI values + promote new KPIs) / Reject with comment

### Pilot (3 real reports)
- [ ] 3 reports across at least 2 internal teams using real BGO Excel data
- [ ] Review queue exercised by central data team reviewer
- [ ] Schema memory tested: second run for same client + template skips mapping step
- [ ] Before/after time noted (vs. current ticket queue)

---

## Platform Reusability Gate (end of Week 3 — before MVP locks)

Walk through these two use cases on paper against the ADK skill manifest format and connector pattern. If either surfaces a gap, fix before the MVP exit gate.

**Hunter Point Capital:** Files from SharePoint + email → standardise → validate Excel formulas → compare to prior month → upload to DealCloud via API. Questions: does the ADK `FunctionTool` pattern describe this workflow without modification? Can SharePoint and DealCloud be added as connectors without changing the base interface? Does "validation passed, ready to upload" fit the review queue state model?

**Voice collections agent:** Real-time debtor conversation, FDCPA-compliant scripting, intent detection, payment capture, post-call summary. Questions: does the skill manifest support voice tools (Deepgram, ElevenLabs) the same way it supports text tools? Are compliance guardrails expressible at the platform level, not buried in the skill?

---

## MVP Exit Gate

- [ ] Dev can clone repo and run the full app in under one hour with no external services
- [ ] Agent completes the full loop for at least 3 reports with real BGO Excel data
- [ ] Client Health Dashboard template renders correctly in-app
- [ ] Review queue works: approve, reject, and approve-with-edits all function
- [ ] Schema memory saves on approval and skips mapping step on second run for same client
- [ ] PPTX export produces a valid file using the BGO slide master
- [ ] ADK traces visible in `adk web` for every step with latency — enough to debug any failure
- [ ] Platform reusability gate passed (Hunter Point + voice agent walkthroughs)

---

## Production Migration (after MVP exit gate)

Same code. Infrastructure swap only. Do in order; test after each step.

**Hosting: Railway**

1. **SQLite → PostgreSQL:** Add Railway PostgreSQL plugin to project. Set `DATABASE_URL` to the Railway-provided connection string. Raw SQL is PostgreSQL-compatible (`ON CONFLICT` syntax identical). No code changes.
2. **Local storage → Railway Volume:** Add a Railway Volume to the backend service. Set `UPLOAD_DIR` env var to the volume mount path (e.g. `/data/uploads`). No code changes — `UPLOAD_DIR` is already the only path reference.
3. **ADK local → Railway service:** Add a second Railway service running the same backend repo with start command `adk api_server`. Set `ADK_API_URL` env var on the FastAPI service to point to it. Agent code unchanged.
4. **Langfuse:** Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST=https://cloud.langfuse.com` in Railway env vars. Replace `agent_log` writes with Langfuse trace calls — one import swap. Reviewer approve/reject feeds Langfuse eval dataset.
5. **SSO:** Add FastAPI middleware + BGO SSO provider config.
6. **pgvector (optional):** Enable pgvector extension on Railway PostgreSQL. Replace `difflib.SequenceMatcher` fuzzy match with semantic column matching. Column mapping quality improves; no user-facing change.

**dbt Core (when second data source is live):**
When Workday or telephony data joins Excel uploads, load raw files into PostgreSQL staging tables and introduce dbt models for the silver/gold transformation layer. The `report_files` table already provides the source reference each dbt source will need. Schema design is dbt-ready from day one — no rework required at that point.

---

## Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | BGO PowerPoint slide master as `.pptx` file? | Marketing / Data team | **Blocking Week 2 PPTX export** |
| 2 | Who is the Phase 1 pilot reviewer on the central data team? | Data team lead | Needed by Week 2 |
| 3 | ~~Which ~50 KPIs seed the catalog?~~ | Data team | ✅ 69 KPIs seeded from `KPI's & Definition.xlsx` + Affirm Care |
| 4 | Anthropic API key — shared team account or individual dev keys? | Platform lead | Needed now |
| 5 | `client_id` naming convention for schema memory keys | Data team | Needed by Week 2 |
| 6 | Executive Scorecard: Workday Excel export interim or API from day one? | Workday admin | Needed by Week 2 |
| 7 | Hunter Point data schema — different enough to require platform changes? | Hunter Point lead | Needed by Week 3 |
| 8 | Confirm formulas for 3 pending KPIs: `interval_compliance`, `tardiness_pct`, `overtime_hours` | Data team | Needed before pilot |
| 9 | ~~AWS or Railway for production?~~ | Platform lead | ✅ Railway — Volumes for storage, managed PostgreSQL plugin |
| 10 | ~~Self-hosted Langfuse or cloud?~~ | Platform lead | ✅ Langfuse Cloud free tier |
| 11 | Typical number of Excel files per report? (informs upload UX — e.g. 2-3 files vs 10+) | Ops users | Needed for Week 3 frontend design |
