# BGO Report Factory — Product Requirements Document

**Status:** Draft v1.0  
**Owner:** Data & AI Platform  
**Last updated:** May 2026  
**Phase:** 1 — Internal MVP  

---

## 1. Problem Statement

BGO's central data team is the single bottleneck for all operational reporting. Every client health dashboard, WBR/QBR deck, and KPI report is built manually — one client at a time. The result is a 3–4 month queue per dashboard type, 40+ clients waiting, and a highly skilled team spending most of its time on repeatable data plumbing rather than analysis.

**Pain points:**
- Ops team leads and support groups cannot self-serve reports — they raise tickets and wait
- Each client requires bespoke schema design even when the underlying KPI structure is identical
- The Executive Scorecard and similar recurring reports are rebuilt manually every cycle
- No institutional memory: column mappings learned for one client are not reused for the next
- PowerPoint QBR/WBR decks are assembled by hand from multiple data sources

**Goal:** A self-serve web application where any BGO user can describe what they need, upload their data, and receive a live interactive dashboard and/or PowerPoint deck — without raising a ticket or waiting for the central team. The central team shifts from builders to reviewers and platform owners.

---

## 2. Users

| User | Role | Primary use case |
|---|---|---|
| Ops team leads | Collections, CX, sales ops | Client health dashboards, WBR/QBR decks |
| Support group leads | HR, Finance, Workforce Mgmt | Functional KPI reports, headcount dashboards |
| Senior leadership | C-suite, VPs | Executive Scorecard (Workday-sourced) |
| Central data team | Reviewers & platform owners | KPI mapping sign-off, output review, catalog management |

---

## 3. Scope — Phase 1 (MVP)

### In scope
- AI interview agent that captures report requirements through a structured conversation
- Excel file upload as primary data source
- Workday connector for employee/payroll data (Executive Scorecard template)
- Column mapping agent with confirmation step
- KPI catalog with pre-defined metrics (name, numerator, denominator, source field)
- 4 report templates: Client Health Dashboard, WBR/QBR Report, Executive Scorecard, KPI Spotlight
- In-app interactive dashboard rendering (no Power BI dependency)
- PowerPoint export against BGO-branded template
- Human review queue: KPI mapping review + output sign-off
- Schema memory: reviewed mappings stored and reused for future runs
- Langfuse observability: every agent action traced with human feedback loop

### Out of scope (Phase 2+)
- Telephony/TCM connector
- CRM connector
- Client-side data sources
- Fully autonomous publish (Phase 1 always routes through review queue)
- Natural language querying of dashboards
- Multi-agent orchestration across report types
- External client-facing deployment

---

## 4. Report Templates

Each template is a structured schema with a defined KPI set. Clients may vary which KPIs are included, but the schema structure is consistent across clients.

### 4.1 Client Health Dashboard
**Audience:** Ops team leads, client success  
**Cadence:** Weekly  
**KPIs:** Contact rate, PTP%, PTP kept%, resolution rate, right party contact rate, compliance flags, agent-level performance breakdown  
**Data sources:** Excel upload (primary), TCM telephony (Phase 2)  
**Visualisations:** Trend lines (weekly), bar breakdown by agent/campaign, compliance flag count, comparison vs. prior period  

### 4.2 WBR / QBR Report
**Audience:** Client stakeholders, ops leadership  
**Cadence:** Weekly (WBR), Quarterly (QBR)  
**KPIs:** All Client Health KPIs plus SLA attainment, headcount, attrition, CSAT (if available)  
**Data sources:** Excel upload, Workday (headcount/attrition)  
**Visualisations:** Summary scorecard, trend charts, wins/risks section, talking points  
**Output:** In-app dashboard + PowerPoint export (BGO template)  

### 4.3 Executive Scorecard
**Audience:** Senior leadership (C-suite, VPs)  
**Cadence:** Monthly  
**KPIs:** Revenue, headcount by site, attrition rate, paid vs. productive hours, open roles, utilisation  
**Data sources:** Workday (primary), Excel supplement  
**Visualisations:** KPI tiles with trend indicators, site-level breakdown, month-over-month delta  

### 4.4 KPI Spotlight
**Audience:** Any team lead  
**Cadence:** Ad hoc  
**KPIs:** Single metric, user-defined (maps to KPI catalog)  
**Data sources:** Excel upload  
**Visualisations:** Trend line, breakdown by configurable dimension (agent, site, campaign, date), benchmark comparison if available  

---

## 5. Agent Flow

The core agent runs 4 sequential steps. Each step is a discrete ADK skill with its own YAML manifest, inputs, outputs, and HITL gate.

### Step 1 — Requirements Intake
**Trigger:** User clicks "New Report" in the app  
**Agent behaviour:**
1. Ask: what type of report? (present 4 template options)
2. Load the selected template schema
3. Ask: which client or business unit?
4. Ask: what time period?
5. Ask: any KPIs you want to add or remove from the standard set? (show default list)
6. Ask: where is your data? (Excel upload / Workday / flag as manual)

**Output:** `intake_spec` — a structured JSON object with template type, client ID, date range, KPI list, and data source

**Failure mode:** If the user's answers are ambiguous (e.g. KPI name not in catalog), agent asks one clarifying question before proceeding. Does not guess.

### Step 2 — Data Discovery
**Trigger:** `intake_spec` produced  
**Agent behaviour (Excel path):**
1. Accept file upload
2. Parse headers using Pandas
3. Attempt automatic column mapping against the template schema (fuzzy match on column names + data type inference)
4. Present mapping to user: "I mapped these columns — please confirm or correct"
5. Flag any required columns not found

**Agent behaviour (Workday path):**
1. Call Workday MCP connector with date range and entity filters
2. Map response fields to template schema
3. Confirm with user

**Output:** `data_mapping` — confirmed column-to-schema mapping, raw data reference, list of unmapped/flagged columns

**Failure mode:** If fewer than 70% of required columns are mapped automatically, escalate to review queue with a note rather than proceeding.

### Step 3 — Standardise & KPI Compute
**Trigger:** `data_mapping` confirmed  
**Agent behaviour:**
1. Apply column mapping, normalise data types, handle nulls per template rules
2. Compute each KPI in the confirmed KPI list using catalog definitions (numerator ÷ denominator)
3. Run validation checks: no division by zero, values within expected range, period-over-period delta not exceeding 50% without a flag
4. Store normalised data in PostgreSQL (medallion lake, silver layer)
5. Store column mapping in schema memory (pgvector) keyed by client ID + template type

**Output:** `computed_kpis` — validated KPI values with metadata (period, client, data quality flags)

**Failure mode:** Any validation failure raises a data quality flag. Flag is shown in the review queue and in the output dashboard. Agent does not block on flags — it surfaces them.

### Step 4 — Generate & Queue
**Trigger:** `computed_kpis` produced  
**Agent behaviour:**
1. Render dashboard using chart config from template (Recharts components)
2. If PowerPoint requested: generate PPTX using python-pptx against BGO slide master
3. Write output record to review queue with: client, template, data quality flags, KPI mapping summary, rendered preview
4. Notify reviewer (email or in-app notification)

**Output:** Dashboard rendered in app, PPTX file (if requested), review queue entry created

---

## 6. Review Queue

The review queue is the central team's primary interface.

**Each queue entry shows:**
- Report metadata: client, template, period, requested by, timestamp
- KPI mapping summary: each KPI with its source column, computed value, and a flag if it was manually confirmed vs. auto-mapped
- Data quality flags: any validation failures or anomalies
- Rendered dashboard preview
- PPTX preview (if applicable)

**Reviewer actions:**
- Approve — publishes dashboard to requester's library, locks schema mapping in memory
- Approve with edits — reviewer can override individual KPI values or chart config before publishing
- Reject with comment — sends back to requester with explanation
- Add KPI to catalog — if a new KPI was defined during intake, reviewer can formalise it into the catalog

**Target review time:** Under 30 minutes per report (vs. 3–4 months today for initial schema design)

---

## 7. KPI Catalog Schema

Every KPI in the system is a structured record. The catalog is the authoritative source — if a KPI isn't in the catalog, the agent asks the user to define it, and the reviewer formalises it.

```json
{
  "kpi_id": "ptp_rate",
  "display_name": "PTP Rate",
  "description": "Percentage of contacts resulting in a promise to pay",
  "numerator": "ptp_count",
  "denominator": "total_contacts",
  "format": "percentage",
  "domain": "collections",
  "expected_range": { "min": 0, "max": 1 },
  "aliases": ["promise to pay %", "PTP %", "promise rate"],
  "source_fields": ["ptp_count", "ptps", "promises"],
  "created_by": "central_data_team",
  "reviewed": true
}
```

**Fields:**
- `kpi_id` — snake_case unique identifier
- `display_name` — human-readable label used in dashboards and decks
- `numerator` / `denominator` — canonical field names after schema mapping
- `format` — `percentage`, `integer`, `currency`, `duration`
- `domain` — `collections`, `cx`, `sales`, `hr`, `finance`, `ops`
- `expected_range` — used for validation; values outside range trigger a flag
- `aliases` — list of alternate names the agent uses for fuzzy matching during intake
- `source_fields` — common raw column names for auto-mapping
- `reviewed` — only reviewed KPIs are used in auto-mapping; new KPIs start as `reviewed: false`

---

## 8. Schema Memory

Schema memory stores confirmed column mappings per client and template, so returning users skip the mapping step.

**Storage:** pgvector (already in DataPilot PostgreSQL)  
**Key:** `{client_id}_{template_type}`  
**Record:**

```json
{
  "client_id": "acme_collections_cr",
  "template": "client_health_dashboard",
  "mappings": {
    "contact_rate": "contact_rate_pct",
    "ptp_count": "kept_arrangements",
    "total_contacts": "total_dials"
  },
  "approved_by": "reviewer@bgo.com",
  "approved_at": "2026-05-01T10:00:00Z",
  "use_count": 4
}
```

On future runs for the same client + template, the agent presents the stored mapping for confirmation (one-click confirm) rather than re-running auto-mapping from scratch.

---

## 9. Tech Stack

### Frontend
- **Framework:** React (Vite)
- **Charts:** Recharts (primary), Apache ECharts for complex visualisations
- **Styling:** Tailwind CSS
- **State:** Zustand
- **Auth:** BGO SSO (SAML/OAuth2)

### Agent Layer
- **Framework:** Google ADK
- **Runtime:** AWS ECS (Fargate) — stays AWS-native, no GCP dependency
- **Skills:** YAML manifest per step, version-controlled in GitHub
- **LLM:** Claude via Anthropic API (primary); ADK model-agnostic
- **HITL:** ADK human-in-the-loop checkpoints at Steps 2 and 4

### Observability
- **Tracing:** Langfuse (self-hosted on AWS)
- **Every agent action logs:** step name, inputs, tool calls, outputs, latency, model used, token count
- **Human feedback:** reviewer approve/reject feeds back to Langfuse eval dataset
- **Evals:** golden dataset of 20 known-answer report runs built during pilot week

### Data Layer
- **Ingestion:** Pandas (Excel), Airbyte (Workday connector — existing DataPilot setup)
- **Storage:** PostgreSQL (RDS) — medallion architecture (bronze/silver/gold)
- **Transformation:** dbt (existing DataPilot pipelines)
- **Semantic/vector:** pgvector (schema memory + KPI catalog semantic search)
- **NL query (Phase 2):** Vanna 2.0

### Export
- **PowerPoint:** python-pptx against BGO slide master (.pptx template file)
- **Chart images:** Playwright headless screenshot → embedded in PPTX

### Infrastructure
- **Cloud:** AWS (ECS, RDS, S3, Secrets Manager, CloudWatch)
- **Dev sandbox:** AWS WorkSpaces (existing secure sandbox)
- **CI/CD:** GitHub Actions
- **Secrets:** AWS Secrets Manager

---

## 10. Data Model

### Core tables

```sql
-- Report requests
CREATE TABLE report_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by VARCHAR NOT NULL,
  template_type VARCHAR NOT NULL,       -- client_health | wbr_qbr | exec_scorecard | kpi_spotlight
  client_id VARCHAR,
  period_start DATE,
  period_end DATE,
  status VARCHAR NOT NULL DEFAULT 'intake',  -- intake | mapping | computing | review | approved | rejected
  intake_spec JSONB,
  data_mapping JSONB,
  computed_kpis JSONB,
  data_quality_flags JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- KPI catalog
CREATE TABLE kpi_catalog (
  kpi_id VARCHAR PRIMARY KEY,
  display_name VARCHAR NOT NULL,
  description TEXT,
  numerator VARCHAR NOT NULL,
  denominator VARCHAR NOT NULL,
  format VARCHAR NOT NULL,              -- percentage | integer | currency | duration
  domain VARCHAR NOT NULL,
  expected_range JSONB,
  aliases JSONB,
  source_fields JSONB,
  reviewed BOOLEAN DEFAULT false,
  created_by VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Schema memory
CREATE TABLE schema_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR NOT NULL,
  template_type VARCHAR NOT NULL,
  mappings JSONB NOT NULL,
  approved_by VARCHAR NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  use_count INT DEFAULT 0,
  UNIQUE(client_id, template_type)
);

-- Review queue
CREATE TABLE review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES report_requests(id),
  reviewer_id VARCHAR,
  status VARCHAR DEFAULT 'pending',     -- pending | approved | approved_with_edits | rejected
  reviewer_notes TEXT,
  overrides JSONB,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Generated outputs
CREATE TABLE report_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES report_requests(id),
  output_type VARCHAR NOT NULL,         -- dashboard | pptx
  s3_path VARCHAR,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 11. API Endpoints

```
POST   /api/reports/                    Create new report request (start intake)
GET    /api/reports/{id}                Get report request status and data
PATCH  /api/reports/{id}                Update intake spec, confirm mapping, etc.
POST   /api/reports/{id}/upload         Upload Excel file for data discovery
GET    /api/reports/{id}/preview        Get rendered dashboard JSON for frontend

GET    /api/review-queue                List pending review items
POST   /api/review-queue/{id}/approve   Approve (optionally with overrides)
POST   /api/review-queue/{id}/reject    Reject with comment

GET    /api/kpis                        List KPI catalog
POST   /api/kpis                        Add new KPI (reviewer only)
PATCH  /api/kpis/{kpi_id}              Update KPI definition

GET    /api/schema-memory/{client_id}/{template}   Get stored mapping
POST   /api/schema-memory                          Store approved mapping

GET    /api/outputs/{id}/dashboard      Serve dashboard data
GET    /api/outputs/{id}/pptx           Download PPTX file
```

---

## 12. Frontend Screens

### 12.1 Dashboard Library (home)
- Grid of user's published dashboards and in-progress requests
- Filter by template type, client, status
- "New Report" button → starts intake flow
- Status badges: Draft / In Review / Published

### 12.2 Intake Chat
- Conversational interface with the agent
- Message bubbles for agent questions and user responses
- Inline KPI selector (checkbox list from catalog) when agent asks about KPIs
- File upload drop zone when agent asks for data source
- Progress indicator: Intake → Mapping → Computing → Review → Published

### 12.3 Column Mapping Confirmation
- Table showing: raw column name | mapped KPI | confidence score
- User can override any mapping via dropdown (searches KPI catalog)
- Required columns not found highlighted in red
- "Confirm mapping" button proceeds to Step 3

### 12.4 Dashboard View
- Full-page interactive dashboard using Recharts
- Filters: date range, agent, site, campaign (template-dependent)
- "Export to PowerPoint" button
- Data quality flags shown as inline warnings
- "Share" button generates a view-only link

### 12.5 Review Queue (central team only)
- List view of pending items with requester, template, client, timestamp
- Click to open review detail: mapping summary, flags, dashboard preview, PPTX preview
- Approve / Approve with edits / Reject actions
- "Add KPI to catalog" action for new KPI definitions

---

## 13. Sprint Plan

### Pre-sprint (Weeks 1–2) — ADK spike, Ankit's AI engineering team
- Build one toy agent end-to-end against DataPilot PostgreSQL
- Validate ADK runtime on AWS ECS
- Langfuse traces working and visible
- Confirm Workday MCP connector connectivity
- **Gate:** One agent run fully traced in Langfuse before Tiger team starts

### Sprint 1 (Weeks 3–4) — Agent core
- ADK skill manifests for Steps 1–3 (intake, data discovery, standardise)
- Excel ingestion via Pandas, column mapping with fuzzy match
- KPI catalog seeded from existing BGO dashboard definitions (~50 KPIs)
- PostgreSQL schema live (all 5 tables)
- Basic REST API (report_requests CRUD)

### Sprint 2 (Weeks 5–6) — Output layer
- React app scaffolded with auth
- Intake chat UI (Step 1 conversational flow)
- Column mapping confirmation screen
- Recharts dashboard render for Client Health template
- python-pptx export (Client Health template only)
- Review queue (basic list + approve/reject)

### Sprint 3 (Weeks 7–8) — Integration & remaining templates
- Steps 1–4 end-to-end pipeline working
- Workday connector integrated (Executive Scorecard template)
- All 4 templates rendering in app
- Schema memory read/write live
- Langfuse human feedback loop wired to review queue actions
- PPTX export for WBR/QBR template

### Sprint 4 (Weeks 9–10) — Pilot & hardening
- 5 real reports across 3 internal teams (target: ops, HR, and one leadership report)
- Before/after time measurement instrumented
- Data quality flag logic tested against real data edge cases
- Bug fixes from pilot feedback
- Eval dataset of 20 golden runs built and passing

---

## 14. Exit Gate

Phase 1 is complete when **all** of the following are true:

- [ ] Agent completes the full 4-step flow for at least 5 distinct reports across 3 different internal teams
- [ ] Central team review time per report is under 30 minutes
- [ ] All 4 templates live and exercised with real data
- [ ] Workday connector working for Executive Scorecard
- [ ] Langfuse traces, evals, and human feedback loop active and producing data
- [ ] Schema mappings from all 5 pilot reports stored in memory and confirmed reusable on a second run
- [ ] Zero data quality flags dismissed without review (all flags visible to reviewer)

---

## 15. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Agent step latency (Steps 1–3) | < 10 seconds per step |
| Dashboard render time | < 3 seconds on first load |
| PPTX generation time | < 30 seconds |
| Excel file size limit | 50 MB |
| Concurrent users (Phase 1) | Up to 20 |
| Data isolation | Per-client row-level security in PostgreSQL |
| Auth | BGO SSO only — no public access |
| Audit trail | Every agent action and reviewer decision logged in Langfuse + CloudWatch |
| Uptime (pilot) | Best-effort; no SLA in Phase 1 |

---

## 16. Open Questions

| # | Question | Owner | Priority |
|---|---|---|---|
| 1 | What is the BGO SSO provider — SAML or OAuth2? Who owns the integration? | IT / Platform | High |
| 2 | Is the BGO PowerPoint slide master file available as a .pptx template? Who owns it? | Marketing / Data team | High |
| 3 | Which Workday fields are accessible via API? Does the existing Airbyte connector cover Executive Scorecard KPIs? | DataPilot / Workday admin | High |
| 4 | Who is the nominated reviewer on the central data team for Phase 1 pilot? | Data team lead | Medium |
| 5 | What is the naming convention for client IDs used across systems? (Needed for schema memory keys) | Data team | Medium |
| 6 | Should the KPI catalog seed (~50 KPIs) be extracted from existing Power BI / Excel reports, or documented manually? | Data team | Medium |
| 7 | Do we need multi-language support for any templates in Phase 1? | Ops leadership | Low |

---

## 17. Future Phases (reference only)

**Phase 2 — Agentic expansion**
- TCM telephony connector
- CRM connector (Salesforce)
- Natural language dashboard querying (Vanna 2.0)
- Proactive report generation (scheduled agent runs, no user prompt)
- Hunter Point Capital / external client deployment

**Phase 3 — Scale**
- Full AI-enabled operations floor
- Client-facing self-serve portal
- AI adoption consulting entry point
- Report Factory as billable BGO IP product