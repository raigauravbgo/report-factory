# Product Requirements Document (PRD)

## Product Name

AI Reporting Copilot (Operator Self-Service BI)

## Objective

Reduce dependency on centralized reporting (Power BI team) by enabling operations users to independently create and maintain simple dashboards and reports from raw Excel data using AI assistance.

## Problem Statement

* Ops teams frequently receive raw Excel data from clients or internal tools
* They lack skills/tools to transform data into dashboards
* Central BI team (Power BI) is a bottleneck
* Each new dashboard requires manual schema design + development
* Leads to delays, bandwidth constraints, and inefficiency

## Goals (MVP)

1. Enable ops users to upload Excel files
2. Use AI to guide users in defining reports
3. Automatically generate reusable report configurations ("report recipes")
4. Generate dashboards without Power BI
5. Allow repeat uploads to auto-refresh dashboards

## Non-Goals (MVP)

* Full enterprise BI replacement
* Highly complex multi-source data modeling
* Advanced predictive analytics
* Cross-client unified data warehouse

## Target Users

* Operations Managers
* Team Leads
* Program Managers

## Core Use Cases

1. Program Health Dashboard
2. KPI Trend Dashboard (daily/weekly/monthly)
3. Agent/Team Performance Dashboard
4. SLA / Operational Metrics Dashboard

---

## User Journey

### Step 1: Upload Data

* User uploads Excel (.xlsx/.csv)
* System stores raw file (S3)
* System parses into staging table

### Step 2: Data Profiling (Automated)

System detects:

* Column names
* Data types (date, numeric, categorical)
* Missing values
* Duplicate rows

### Step 3: AI Interview

AI asks structured questions:

* Which column represents date?
* What KPIs are needed?
* What dimensions matter? (agent, team, campaign)
* Required time granularity (daily/weekly/monthly)
* Filters required

### Step 4: Report Recipe Generation

System generates:

* Column mappings
* Transformation rules
* KPI definitions
* Aggregation logic
* Dashboard layout

User reviews and approves

### Step 5: Dashboard Creation

* Charts auto-generated
* Tables + KPIs displayed
* Filters enabled

### Step 6: Save Recipe

Stored as reusable configuration

### Step 7: Future Uploads

* User uploads new file
* System validates schema
* Applies transformations
* Updates dashboard automatically

---

## Functional Requirements

### 1. File Upload

* Accept .xlsx, .csv
* Max size limit (e.g., 50MB)
* Store in object storage (S3)

### 2. Data Parsing

* Convert to tabular format
* Store in staging MySQL table

### 3. Data Profiling Engine

* Detect data types
* Identify candidate date fields
* Suggest dimensions/measures

### 4. AI Interview Module

* Chat-based UI
* Prompt templates for structured questioning
* Capture responses into config

### 5. Transformation Engine

* Python (pandas)
* Support:

  * column renaming
  * filtering
  * grouping/aggregation
  * derived columns

### 6. KPI Engine

* Define metrics using formulas
* Example: conversion_rate = payments / contacts

### 7. Dashboard Engine

* Chart types:

  * Line
  * Bar
  * Table
  * KPI cards
* Filters and date selectors

### 8. Report Recipe Storage

Store as structured config:

* mappings
* transformations
* KPIs
* layout

### 9. Validation Engine

* Schema matching on re-upload
* Missing column detection
* Data anomaly warnings

### 10. Refresh Engine

* Trigger on upload
* Recompute datasets
* Update dashboards

---

## Non-Functional Requirements

### Performance

* Handle datasets up to ~500k rows

### Scalability

* Multi-client isolation

### Security

* Role-based access
* Client data isolation

### Reliability

* Retry failed transformations

### Auditability

* Track KPI definitions and changes

---

## Data Model (High-Level)

Tables:

* datasets
* uploads
* staging_tables
* processed_tables
* report_recipes
* kpi_definitions
* dashboard_configs

---

## Tech Stack

Frontend:

* Next.js
* React

Backend:

* Node.js or FastAPI

Data Processing:

* Python + pandas

Database:

* MySQL

Storage:

* AWS S3

AI Layer:

* OpenAI / Azure OpenAI

Charts:

* ECharts / Recharts

---

## API Endpoints (Sample)

POST /upload
POST /profile
POST /ai-interview
POST /generate-recipe
POST /approve-recipe
GET /dashboard/{id}
POST /refresh

---

## Risks

1. Messy Excel data
2. Incorrect KPI definitions
3. Schema drift across uploads
4. Over-reliance on AI without validation

---

## Mitigations

* Human approval step
* Validation rules
* Template-driven dashboards
* Strict schema checks

---

## Success Metrics

* Reduction in BI team requests
* Time to create dashboard
* Number of self-service dashboards created
* Adoption rate among ops users

---

## MVP Timeline

Week 1-2: Upload + profiling + basic UI
Week 3-4: AI interview + recipe creation
Week 5: Dashboard rendering
Week 6: Refresh + validation

---

## Future Enhancements

* Multi-file joins
* Scheduled refresh
* Export to PPT/PDF
* Integration with client systems
* Benchmarking across programs

---

## Summary

Build a constrained, template-driven AI-assisted reporting tool that enables ops users to create and maintain dashboards without dependency on centralized BI teams.
