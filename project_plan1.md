# BGO Report Factory — Task Tracker

Status key: `[ ]` = todo · `[~]` = in progress · `[x]` = done · `[-]` = blocked/deferred

---

## Step 0 — Housekeeping

- [x] Update `CLAUDE.md` to reflect current stack and plan
- [x] Delete `PRD.md` and `PRD2.md` (already absent — superseded by `PRD3.md`)

---

## Step 1 — LLM Provider Switch

- [x] Extend `backend/services/ai_client.py` to read `LLM_PROVIDER` from `.env`
- [x] Route to OpenAI SDK when `LLM_PROVIDER=openai`
- [x] Route to Anthropic SDK when `LLM_PROVIDER=anthropic`
- [x] Route to Azure OpenAI when `LLM_PROVIDER=azure`
- [x] Add `LLM_PROVIDER`, `ANTHROPIC_MODEL` to `backend/core/config.py`
- [x] Update `backend/.env.example` with new vars

---

## Step 2 — Batch Upload (Backend)

- [x] Add `POST /upload/batch` accepting `files: List[UploadFile]` — `api/routes/upload.py`
- [x] Create single `Dataset` record as session container
- [x] Launch background `_parse_and_profile()` per file (reused existing function)
- [x] Return `{ dataset_id, uploads: [{upload_id, filename, status}] }`
- [x] Keep `POST /upload` unchanged (backwards compat)
- [x] CSV: `chardet` encoding detection + `csv.Sniffer` delimiter — `services/parser.py`
- [x] Excel: read all sheet names via `pd.ExcelFile` — `services/parser.py`
- [x] Store `encoding`, `delimiter`, `sheet_names`, `active_sheet` on StagingTable
- [x] Enforce row limits: 200k Excel, 200k CSV — `ValueError` with clear message
- [x] Add `chardet==5.2.0` to `requirements.txt`
- [x] Add fields to `models/staging_table.py`: `encoding`, `delimiter`, `sheet_names`, `active_sheet`, `grain_columns`
- [x] Create Alembic migration `0002_staging_table_deep_profiling.py`
- [x] Add `semantic_tag`, `grain_score`, `grain_candidate` to `services/profiler.py`
- [x] Add `grain_suggestions` (heuristic-based) to `services/profiler.py`
- [x] Extend `schemas/upload.py`: new `ColumnProfile` fields, `ProfilingResult` file-metadata fields
- [x] Add `BatchUploadResponse`, `SaveSchemaOverridesRequest` to `schemas/upload.py`
- [x] Add upload limit env vars to `config.py`: `MAX_EXCEL_ROWS`, `MAX_CSV_ROWS`, `MAX_UPLOAD_FILES`, `MAX_COLUMNS_PER_FILE`
- [x] Add `POST /upload/{id}/schema` endpoint for user overrides

---

## Step 2 — Batch Upload (Frontend)

- [x] Update `UploadZone.tsx`: `maxFiles: 10`, `onFiles: (files: File[]) => void` callback
- [x] Rewrite `app/upload/page.tsx`: batch upload, per-file status polling, navigate to `/session/{datasetId}/schema`
- [x] Store upload list in `sessionStorage` on navigate
- [x] Add `uploadBatch`, `getDataset`, `saveSchemaOverrides` to `lib/api.ts`
- [x] Extend `lib/types.ts`: `BatchUploadResponse`, `DatasetResponse`, extended `ColumnProfile`, session types

---

## Step 3 — Schema Mapping UI

- [x] `POST /upload/{upload_id}/schema` backend endpoint (done in Step 2)
- [x] Create `app/session/[datasetId]/schema/page.tsx`: per-file tabs, metadata bar, editable column table
- [x] Sheet switcher dropdown for Excel multi-sheet files
- [x] AI grain suggestion banner
- [x] Amber asterisk dirty-state indicator
- [x] "Continue to Interview" + "Skip Interview → KPI Selection" buttons
- [x] Extend `components/ColumnTable.tsx`: Semantic Tag dropdown + Grain score bar + grain checkbox

---

## Step 4 — Schema Relationship Detection

- [x] Create `services/schema_relationships.py`: column name fuzzy match + Jaccard overlap + cardinality
- [x] Create `api/routes/session.py` with `POST /session/{id}/relationships`
- [x] Register `session_router` in `main.py`
- [x] Create `components/SchemaRelationships.tsx`: relationship cards, confirm/dismiss, confidence score

---

## Step 5 — AI Interview (Hybrid Flow 1)

- [x] Add `FLOW1_Q1` constant to `services/ai_interview.py` (hard-coded domain question)
- [x] Add `run_flow1(message, history, profiles)` — Turn 1 = hard-coded Q1, Turn 2+ = AI-generated from columns
- [x] Add `default_interview_result(profiles)` — returns heuristic defaults for skip path
- [x] Add `POST /session/{id}/interview` + `GET /session/{id}/interview/state` + `POST /session/{id}/interview/skip` to `session.py`
- [x] Create `app/session/[datasetId]/interview/page.tsx`: side-panel chatbot, Q1 first, dynamic Q2+, skip button

---

## Step 6 — KPI Suggestion (Checkable List)

- [x] Create `services/kpi_suggester.py`: fuzzy match columns vs catalog, interview boost, domain filter
- [x] Add `POST /session/{id}/kpi-suggestions` to `session.py`
- [x] Create `app/session/[datasetId]/kpis/page.tsx`: two-panel checkable list, domain filter chips, search, drag-to-reorder, custom KPI form, double-click comment

---

## Step 7 — AI Data Validation

- [x] Create `services/data_validator.py`: zero-denom check, high null warning, dupe grain key error, date gap advisory
- [x] Add `POST /session/{id}/validate` to `session.py`
- [ ] Frontend: inline validation review step before "Generate Dashboard" button (hooked into kpis page — needs a dedicated validation UI component or step; deferred to polish pass)

---

## Step 8 — Story-Driven Dashboard Generation

- [x] Create `services/session_generator.py`: AI groups KPIs into story sections, builds `RecipeConfig` with `sections`
- [x] Add `POST /session/{id}/generate` to `session.py` (calls `session_generator.generate_from_session`)
- [x] Add `sections` array to all 4 templates in `catalog/templates/`
- [ ] `app/dashboard/[recipeId]/page.tsx`: render sections in order with section headers, per-KPI chart type switcher (deferred to polish pass — existing dashboard still works)

---

## Step 9 — KPI Registry & Templates

- [x] Add `sections` array to `client_health.json`
- [x] Add `sections` array to `wbr_qbr.json`
- [x] Add `sections` array to `exec_scorecard.json`
- [x] Add `sections` array to `kpi_spotlight.json`

---

## Step 10 — Stress Test & Limits (pending)

- [ ] Upload 200k row Excel — measure response time, fix timeouts if > 60s
- [ ] Upload 10 files simultaneously — confirm batch endpoint handles concurrency
- [ ] Upload file with 200 columns — confirm profiling completes without crash
- [ ] Confirm row-limit error shown clearly in UI when limit exceeded

---

## Polish Pass (deferred — skeleton works, UI needs finishing)

- [ ] Inline data validation step UI on kpis page (validation errors before generate button)
- [ ] Dashboard section headers + story order rendering
- [ ] Per-KPI chart type switcher on dashboard
- [ ] Run Alembic migration `0002` on dev.db (`alembic upgrade head`)

---

## Deferred (Do Not Start)

- [-] Flow 2 — dynamic AI interview (start only after Flow 1 is end-to-end tested)
- [-] PostgreSQL migration (change `DATABASE_URL` only; no code changes)
- [-] pgvector semantic matching (replace `difflib.SequenceMatcher` in production)
- [-] Langfuse observability integration
- [-] BGO SSO / authentication
- [-] Scheduled report refresh
- [-] Railway Volume / S3 production storage swap
