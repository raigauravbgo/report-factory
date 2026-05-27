---
name: kpi-dashboard-storytelling
description: next.js and python kpi dashboard design, analytics, and data storytelling support. use when the user asks claude code to build, review, or improve a kpi dashboard application; create or refactor next.js dashboard components, api routes, chart layouts, filters, cards, and executive ui; add or improve python kpi analysis scripts; translate dashboard findings into executive narratives, chart recommendations, decision briefs, root-cause insights, and finding-to-action reports.
---

# KPI Dashboard Storytelling

## Purpose

Use this skill to turn KPI dashboards into decision systems: clean Next.js UI, reliable Python-backed analytics, and executive narratives that explain what happened, why it matters, and what decision should happen next.

Optimize for Claude Code working inside a repository. Prefer concrete code changes, file-level recommendations, and testable implementation steps over generic dashboard advice.

## Operating Model

When invoked, work in this order unless the user requests a narrower task:

1. **Understand the business decision**: identify the audience, KPI owner, operating question, decision cadence, and action threshold.
2. **Inspect the implementation**: review Next.js pages/components, API routes/server actions, Python analysis scripts, schemas, sample data, and chart components.
3. **Assess the KPI logic**: verify metric definitions, numerator/denominator, grain, filters, date windows, baselines, targets, and edge cases.
4. **Design the dashboard UI**: organize the page into executive summary, KPI scorecards, trend diagnostics, segment/root-cause views, and action recommendations.
5. **Write or refactor code**: produce Next.js components, API contracts, Python analysis utilities, and narrative generation helpers as needed.
6. **Create the story layer**: convert findings into a concise narrative: headline, evidence, driver, business impact, decision, and next action.
7. **Validate the output**: check data consistency, loading/error states, accessibility, responsive layout, and whether every visualization supports a decision.

## Default Architecture Guidance

For a Next.js frontend/backend with Python analytics:

- Keep dashboard presentation in reusable React components: `KpiCard`, `TrendChart`, `SegmentBreakdown`, `InsightPanel`, `ExecutiveNarrative`, `ActionTable`, and `FilterBar`.
- Keep API routes or server actions responsible for fetching, validating, and shaping data, not for embedding business storytelling rules.
- Keep Python responsible for heavy KPI computation, statistical summaries, driver analysis, anomaly detection, cohort/segment summaries, and narrative-ready insight payloads.
- Return API payloads that separate `metrics`, `charts`, `insights`, `recommendations`, `metadata`, and `dataQuality`.
- Prefer typed contracts between Python/API/frontend. Use TypeScript interfaces or Zod schemas where the repo already uses them.
- Make narrative generation deterministic first. Use template-based executive language before adding LLM summarization.

See `references/nextjs-python-patterns.md` for implementation patterns.

## Dashboard Design Rules

Design dashboards around decisions, not data inventory.

Use this page structure by default:

1. **Executive headline**: one sentence that states the biggest business movement.
2. **Decision summary**: 3-5 bullets covering what changed, why it matters, and what to do.
3. **KPI scorecards**: current value, delta, target gap, status, and confidence/data freshness.
4. **Primary trend**: time-series chart against target, prior period, or baseline.
5. **Driver view**: segments, queues, channels, teams, locations, products, or cohorts explaining movement.
6. **Root-cause evidence**: supporting metrics, comments, operational events, or data-quality notes.
7. **Recommended actions**: owner, action, expected impact, urgency, and follow-up metric.

Use visual hierarchy:

- Put the most decision-relevant number at the top left.
- Avoid more than 5-7 top-level KPI cards on one screen.
- Pair every chart with a plain-language takeaway.
- Use color only for semantic status: good, warning, risk, neutral.
- Show uncertainty or data-quality caveats near the affected KPI, not hidden in a footer.
- Do not show decorative charts that do not support a decision.

See `references/dashboard-ui-checklist.md` for the review checklist.

## KPI Analysis Rules

Before writing insights, verify:

- Metric definition: numerator, denominator, aggregation, and exclusions.
- Grain: row-level entity and whether the aggregation matches the chart.
- Time window: current period, comparison period, rolling window, and timezone.
- Segmentation: whether filters change both numerator and denominator correctly.
- Baseline: target, prior period, same period last year, peer average, or forecast.
- Directionality: whether higher is better, lower is better, or range-bound.
- Significance: whether the change is material enough to recommend action.

Flag these issues clearly:

- Missing denominator or target.
- Mixed grain in the same chart.
- Percent change on small base counts.
- Average hiding segment-level underperformance.
- Filters that alter interpretation.
- Data freshness or incomplete period problems.

## Data Storytelling Framework

Use the **Finding → Narrative → Decision** structure.

For each important dashboard finding, produce:

- **Finding**: what changed, with metric, period, and comparison.
- **Evidence**: the chart, segment, or calculation that proves it.
- **Driver**: the most likely reason or contributing factor.
- **Impact**: the business consequence if it continues.
- **Decision**: the executive choice or tradeoff required.
- **Action**: owner-ready next step and follow-up KPI.

Example narrative shape:

```text
Headline: Resolution SLA risk increased this week, concentrated in Manila voice queues.
Evidence: SLA fell from 86% to 78%, while backlog aged 3+ days rose 22%.
Driver: The decline is concentrated in two queues with higher reassignment rates.
Impact: If unresolved, CSAT and repeat contact risk will increase next week.
Decision: Reallocate capacity from stable queues or approve temporary overtime.
Action: Move 3 agents for 5 business days and track SLA recovery daily.
```

See `references/storytelling-templates.md` for reusable templates.

## Code Generation Standards

When creating or modifying Next.js code:

- Match the existing router style: App Router or Pages Router.
- Use existing design system components before adding new UI primitives.
- Keep chart components data-driven and reusable.
- Include loading, empty, and error states.
- Make filters URL-shareable when the app pattern supports it.
- Use accessible labels, semantic headings, and keyboard-friendly controls.
- Avoid hardcoded demo numbers unless creating fixtures or examples clearly marked as sample data.

When creating or modifying Python code:

- Use functions with explicit inputs and outputs.
- Add docstrings for KPI definitions.
- Validate required columns and handle missing/null values.
- Return JSON-serializable objects for API consumption.
- Include unit-testable functions for metric calculations.
- Keep narrative strings separate from raw calculations where possible.

When creating API routes or backend handlers:

- Validate query parameters and date ranges.
- Return consistent response envelopes.
- Include `generatedAt`, `source`, `filters`, and `dataQuality` metadata.
- Keep frontend chart formatting independent from backend metric calculation.

## Output Formats

For dashboard review tasks, return:

```markdown
## Executive Dashboard Assessment
### What works
### Key gaps
### Recommended dashboard structure
### KPI logic risks
### UI improvements
### Code changes
### Executive narrative examples
### Validation checklist
```

For implementation tasks, return:

```markdown
## Implementation Plan
### Files to create or modify
### Data/API contract
### Component structure
### Python analytics changes
### Narrative logic
### Tests and validation
```

For data-story tasks, return:

```markdown
## Executive Narrative
### Headline
### Key findings
### Business impact
### Decisions needed
### Recommended actions
### Follow-up KPIs
```

## Quality Bar

The final answer or code should make the dashboard more executive-ready. A strong result is:

- Decision-oriented, not merely descriptive.
- Grounded in KPI definitions and data contracts.
- Clear enough for executives and specific enough for engineers.
- Implementable in a Next.js + Python codebase.
- Honest about missing data, weak evidence, and assumptions.
