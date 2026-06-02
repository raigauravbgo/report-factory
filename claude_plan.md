# Plan: Multi-File Upload → Enhanced Schema Mapping → AI Interview → KPI Suggestion → Dashboard

## Context

The current system supports a single-file upload → 5-step AI interview → dashboard flow. The user wants to expand this into a full multi-file data pipeline where multiple CSVs/Excel files can be uploaded together, each gets deeply profiled (encoding, delimiters, sheets, grain), schema relationships are inferred across files, each file gets its own AI interview, KPIs are suggested from the catalog, and the final dashboard draws from all sources.

---

## Overview of New Wizard Flow

```
Step 1: Multi-File Upload
  ↓
Step 2: Schema Mapping (per file — auto-classified, editable)
  - File metadata: sheets, encoding, delimiter, row counts
  - Column type + semantic role (editable)
  - Grain level selection (multi-select + AI suggestion)
  ↓
Step 3: Schema Relationship Detection (cross-file)
  ↓
Step 4: AI Interview (per file)
  ↓
Step 5: KPI Suggestions (catalog match + interview context)
  ↓
Step 6: Dashboard Generation
```

---

## Phase 1 — Multi-File Upload

### Backend

**`api/routes/upload.py`**
- Add `POST /upload/batch` endpoint accepting `files: List[UploadFile]` and an optional `session_name`
- Creates one `Dataset` record as the session container
- Calls `parser.parse_upload()` + `profiler.profile()` in a background task for each file
- Returns `{ session_id, uploads: [{upload_id, filename, status}] }`

**`models/dataset.py`**
- Ensure `Dataset` already holds multiple `Upload` records via relationship (it does — no schema change needed)
- Add `session_name` optional field to `Dataset`

### Frontend

**`components/UploadZone.tsx`**
- Change `maxFiles: 1` → `maxFiles: 10`
- Show a file list below the drop zone (filename, size, remove button)
- Accept `.csv`, `.xlsx`, `.xls`

**`app/upload/page.tsx`**
- Replace single-file upload with batch upload call to `POST /upload/batch`
- Track per-file status with polling on each `upload_id`
- Show per-file progress bar/status badge (pending / profiling / profiled / failed)
- "Continue" button enabled only when all files are `profiled`
- On continue → navigate to `/session/{sessionId}/schema`

---

## Phase 2 — Enhanced Profiling

### Backend

**`services/parser.py`**
- Detect CSV encoding using `chardet` before reading (add `chardet` to `requirements.txt`)
- Use `csv.Sniffer` to detect delimiter (`,`, `;`, `\t`, `|`)
- For Excel: read all sheet names via `pd.ExcelFile(path).sheet_names`; let user pick sheet (default: first sheet)
- Store detected `encoding`, `delimiter`, `sheet_names`, `active_sheet` on `StagingTable`

**`services/profiler.py`**  (extend `ColumnProfile`)
- Add `grain_score` field: `unique_count / row_count` — columns with score ≥ 0.95 are grain candidates
- Add `semantic_tag` field: AI-inferred tags from column name patterns (e.g., "agent_id" → `entity_key`, "call_date" → `time_key`, "revenue" → `financial_metric`)
- Add AI-assisted grain suggestion: after profiling all columns, call OpenAI with column names + types + sample values to recommend which columns (alone or combined) form the grain
- Return `grain_suggestions: List[str]` in `ProfilingResult`

**`schemas/upload.py`**
- Extend `ColumnProfile`: add `grain_score`, `semantic_tag`
- Extend `ProfilingResult`: add `encoding`, `delimiter`, `sheet_names`, `active_sheet`, `grain_suggestions`

**New `GET /upload/{upload_id}/file-meta`** — returns raw file metadata (encoding, sheets, delimiter, row counts) separate from column profile, for quick display

### Frontend

**New page: `app/session/[sessionId]/schema/page.tsx`**
- Tabbed interface — one tab per uploaded file
- Each tab shows:
  - **File metadata bar**: encoding, delimiter, active sheet (dropdown if Excel multi-sheet), row count, column count
  - **Column table** (extended `ColumnTable.tsx`): existing columns + new `semantic_tag` column + `grain_score` indicator
  - **Grain Level selector**: multi-select checkboxes listing all columns; AI suggestions pre-checked (highlighted with "AI suggested" badge); user can override

**`components/ColumnTable.tsx`** (extend)
- Add `Semantic Tag` column (badge, editable via dropdown: `entity_key`, `time_key`, `financial_metric`, `dimension`, `text`, `ignore`)
- Add `Grain Candidate` column: shows grain score bar (0–100%) + checkbox to include in grain key

---

## Phase 3 — Schema Relationship Detection

### Backend

**New `services/schema_relationships.py`**
- Input: list of staging table names (one per upload)
- Step 1 — Column name match: find columns with identical or fuzzy-matching names across files (SequenceMatcher > 0.85)
- Step 2 — Value set overlap: for categorical columns, compute Jaccard similarity of value sets; score ≥ 0.6 → probable FK relationship
- Step 3 — Cardinality match: if column A in file 1 (dimension, low cardinality) matches values in column B in file 2 → suggest join key
- Output: `List[RelationshipSuggestion]` = `{ file_a, col_a, file_b, col_b, confidence, relationship_type (pk_fk | same_dimension | shared_key) }`

**New `POST /session/{session_id}/relationships`**
- Triggers `schema_relationships.infer(session_id)`
- Returns relationship suggestions

### Frontend

**Component: `components/SchemaRelationships.tsx`** (new)
- Shows relationship suggestions as cards: "Column X in File A looks like it links to Column Y in File B (confidence: 87%)"
- User can confirm or dismiss each relationship
- Confirmed relationships stored in session state and passed to interview/recipe generation

---

## Phase 4 — AI Interview (Per File)

### Backend

**`services/ai_interview.py`** (extend)
- Add `multi_file` mode: accepts `upload_ids: List[int]` instead of single `upload_id`
- Per-file interview: runs one full 5-step interview per file; context includes that file's column profiles + grain selections + any confirmed relationships
- System prompt updated to include: "You are interviewing about file `{filename}`. It has {N} rows and the following columns: …"
- Add step 0: **File purpose** — "What does this file represent? (e.g., call logs, payment records, agent roster)"

**`api/routes/interview.py`** (extend)
- `POST /interview` — accept optional `file_index` param to track which file the current interview is for
- `GET /session/{session_id}/interviews` — list interview state per file (not started / in progress / complete)

### Frontend

**`app/session/[sessionId]/interview/page.tsx`** (new)
- File tab switcher at top (one tab per uploaded file)
- Each tab: full chat UI (existing design pattern from `app/interview/page.tsx`)
- Step progress bar per file
- Sidebar shows completion status per file: ✓ complete, ○ in progress, — not started
- "Continue to KPI Suggestions" button enabled only when all files have `completed: true`

---

## Phase 5 — KPI Suggestions

### Backend

**New `services/kpi_suggester.py`**
- Input: list of `upload_id`s + their interview results
- Step 1 — Column-to-catalog fuzzy match: for each column, match against all KPI `source_fields` and `aliases` in `catalog/kpis.json` using SequenceMatcher (existing pattern from `agent/tools/data_discovery_from_upload.py`)
- Step 2 — Interview context boost: if interview result mentions a KPI name or formula component, boost that KPI's score
- Step 3 — Domain filter: use file's AI-assigned domain (collections / cx / sales / workforce / ops) to rank catalog KPIs
- Output: `List[KpiSuggestion]` = `{ kpi_id, display_name, formula, confidence, matched_columns: {numerator_col, denominator_col}, source: "catalog"|"interview" }`

**New `POST /session/{session_id}/kpi-suggestions`**
- Calls `kpi_suggester.suggest(session_id)` after all interviews are complete
- Returns ranked list of suggested KPIs

### Frontend

**New `app/session/[sessionId]/kpis/page.tsx`**
- **Two-panel slicer layout**:
  - **Left panel — Available KPIs listbox**: scrollable list of all suggested KPIs, grouped by domain (Collections / CX / Sales / Workforce / Ops); each row shows KPI name, formula, confidence score badge, and "Catalog" or "Interview" source tag; clicking a row moves it to the right panel
  - **Right panel — Selected KPIs listbox**: ordered list of chosen KPIs; drag to reorder; click × to remove back to available
- Domain filter chips above the left panel to narrow the list
- Search/filter input to search by KPI name or formula keyword
- "Add custom KPI" inline form at the bottom of the right panel (name + formula)
- Selected KPIs + custom KPIs passed to recipe generation

---

## Phase 6 — Dashboard Generation

### Backend

**`services/recipe_generator.py`** (extend)
- Accept multi-file context: `session_id`, list of interview results per file, confirmed relationships, selected KPIs
- Build `RecipeConfig` that references columns across multiple staging tables
- `column_mappings` now maps `{kpi_col: "staging_{id}.{col}"}` for cross-file columns

**`services/compute.py`** (extend)
- When a recipe references multiple staging tables, perform the join (based on confirmed relationships) before computing KPIs
- Fall back to computing per-file KPIs separately if no join key is confirmed

**`api/routes/dashboard.py`** (extend)
- `POST /session/{session_id}/generate` — triggers recipe creation from session state and redirects to dashboard

### Frontend

**`app/session/[sessionId]/dashboard/page.tsx`** (new, or reuse `app/dashboard/[recipeId]/page.tsx`)
- Same layout as existing dashboard
- KPI cards section groups KPIs by source file if they are file-specific
- Chart section: time series + breakdown charts
- Filter bar includes filters from all files

---

## New API Endpoints Summary

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/upload/batch` | Upload multiple files, returns session_id |
| GET | `/upload/{id}/file-meta` | Encoding, sheets, delimiter, row counts |
| POST | `/session/{id}/relationships` | Infer cross-file schema relationships |
| POST | `/interview` | (extended) Per-file interview with `file_index` |
| GET | `/session/{id}/interviews` | Interview completion state per file |
| POST | `/session/{id}/kpi-suggestions` | Suggest KPIs from catalog + interview |
| POST | `/session/{id}/generate` | Create recipe + dashboard from session |

---

## New Files to Create

**Backend:**
- `services/schema_relationships.py` — cross-file relationship inference
- `services/kpi_suggester.py` — catalog + interview KPI ranking

**Frontend:**
- `app/session/[sessionId]/schema/page.tsx` — multi-file schema mapping
- `app/session/[sessionId]/interview/page.tsx` — per-file interview
- `app/session/[sessionId]/kpis/page.tsx` — KPI selection
- `components/SchemaRelationships.tsx` — relationship display component

---

## Files to Modify

**Backend:**
- `api/routes/upload.py` — add `/upload/batch`, `/upload/{id}/file-meta`
- `services/parser.py` — encoding/delimiter/sheet detection
- `services/profiler.py` — grain_score, semantic_tag, AI grain suggestion
- `schemas/upload.py` — extend ColumnProfile + ProfilingResult
- `services/ai_interview.py` — multi-file interview support
- `api/routes/interview.py` — file_index param, session interview state
- `services/recipe_generator.py` — multi-file recipe
- `services/compute.py` — cross-file join for KPI computation
- `requirements.txt` — add `chardet`

**Frontend:**
- `components/UploadZone.tsx` — multi-file support
- `app/upload/page.tsx` — batch upload, per-file status
- `components/ColumnTable.tsx` — add semantic_tag + grain columns
- `lib/api.ts` — add new API methods
- `lib/types.ts` — extend types for new fields

---

## Verification

1. Upload 2–3 CSV/Excel files → all show profiling status individually
2. Open schema mapping → each file tab shows encoding, delimiter, grain suggestions from AI
3. Edit a column's role → override persists, amber asterisk shown
4. Grain level selector → AI pre-checks columns, user can override
5. Schema relationships page → FK/shared-dimension suggestions shown with confidence scores
6. Interview → complete interview for each file independently; sidebar shows all ✓
7. KPI suggestions page → catalog KPIs appear with matched columns; user selects subset
8. Dashboard generates → charts and KPI cards draw from all uploaded files

---

## Dependencies

- `chardet` (Python) — encoding detection
- All other libraries (pandas, OpenAI, SQLAlchemy, recharts) already installed