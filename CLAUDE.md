# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI Reporting Copilot** — a self-service BI tool that lets operations users (Ops Managers, Team Leads, Program Managers) upload Excel/CSV data and generate dashboards without relying on a centralized Power BI team.

This project is currently in the **specification/planning phase**. The only existing artifact is [PRD.md](PRD.md). Implementation has not started.

## Planned Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + React |
| Backend | Node.js or FastAPI (TBD) |
| Data Processing | Python + pandas |
| Database | MySQL |
| Storage | AWS S3 |
| AI | OpenAI / Azure OpenAI |
| Charts | ECharts or Recharts |

## Architecture

The system follows a **7-step pipeline** driven by user-uploaded files:

```
Upload (S3 + MySQL staging) → Data Profiling → AI Interview (chat UI)
  → Recipe Generation → Dashboard Rendering → Recipe Storage → Future Refresh
```

**Core modules to build:**
- **File Upload Module** — accepts `.xlsx`/`.csv` (≤50MB), stores to S3, parses into MySQL staging table
- **Data Profiling Engine** — detects column types, date fields, candidate dimensions/measures
- **AI Interview Module** — chat UI with prompt templates; extracts structured config from user responses
- **Transformation Engine** — pandas-based; column renaming, filtering, grouping, aggregation, derived columns
- **KPI Engine** — formula-based metric definitions (e.g. `conversion_rate = payments / contacts`)
- **Dashboard Engine** — renders line/bar/table/KPI-card charts with date + dimension filters
- **Report Recipe Storage** — saves mappings, transformations, KPIs, and layout as reusable JSON config
- **Validation Engine** — schema matching on re-upload; missing column detection; data anomaly warnings
- **Refresh Engine** — triggered on new upload; recomputes datasets and updates dashboards

## API Endpoints

```
POST /upload
POST /profile
POST /ai-interview
POST /generate-recipe
POST /approve-recipe
GET  /dashboard/{id}
POST /refresh
```

## Data Model

MySQL tables: `datasets`, `uploads`, `staging_tables`, `processed_tables`, `report_recipes`, `kpi_definitions`, `dashboard_configs`

## MVP Scope

- **Week 1-2:** Upload + profiling + basic UI
- **Week 3-4:** AI interview + recipe creation
- **Week 5:** Dashboard rendering
- **Week 6:** Refresh + validation

**Explicitly out of scope for MVP:** multi-source joins, scheduled refresh, PDF/PPT export, cross-client analytics, predictive analytics.

## Key Constraints

- Datasets up to ~500k rows must perform acceptably
- Multi-client data isolation is required (security + compliance)
- All KPI definitions must be auditable (track changes)
- Failed transformations must be retryable
- Human approval is required before a recipe is applied (no fully automated pipeline)
