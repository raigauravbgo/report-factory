# Next.js + Python KPI Dashboard Patterns

## Recommended Response Envelope

Use this structure when shaping Python analytics output for frontend/API consumption:

```json
{
  "generatedAt": "2026-05-27T10:00:00Z",
  "filters": {
    "dateRange": { "start": "2026-05-01", "end": "2026-05-27" },
    "segments": []
  },
  "metrics": [
    {
      "id": "csat",
      "label": "CSAT",
      "value": 82.4,
      "unit": "%",
      "delta": -3.1,
      "deltaType": "percentage_point",
      "target": 85,
      "status": "risk",
      "direction": "higher_is_better"
    }
  ],
  "charts": [
    {
      "id": "csat_trend",
      "type": "line",
      "title": "CSAT trend",
      "xKey": "date",
      "series": [{ "key": "csat", "label": "CSAT", "unit": "%" }],
      "data": []
    }
  ],
  "insights": [
    {
      "severity": "high",
      "headline": "CSAT is below target for the third consecutive week",
      "finding": "CSAT declined 3.1 points versus the prior period.",
      "evidence": "The decline is concentrated in Billing and Technical Support.",
      "driver": "Repeat contacts increased in the same segments.",
      "impact": "Retention and escalation risk are elevated.",
      "decision": "Approve focused queue intervention this week.",
      "action": "Review Billing repeat-contact drivers and assign an owner."
    }
  ],
  "recommendations": [],
  "dataQuality": {
    "status": "ok",
    "warnings": []
  }
}
```

## Component Pattern

Prefer this component composition:

```text
DashboardPage
  DashboardHeader
  FilterBar
  ExecutiveSummary
  KpiCardGrid
  PrimaryTrendSection
  DriverAnalysisSection
  InsightPanel
  ActionRecommendationTable
```

## Python Analytics Pattern

Use pure functions first:

```python
def calculate_kpi_summary(df, metric_config, filters):
    """Return current value, comparison value, delta, target gap, and status."""
    ...


def build_executive_insights(kpi_summary, driver_summary):
    """Return narrative-ready insight objects using finding/evidence/driver/impact/decision/action."""
    ...
```

## API Pattern

Keep API responses stable:

- `GET /api/kpi-dashboard?start=...&end=...&segment=...`
- Validate query params.
- Call Python service, script, or precomputed analytics store depending on repo architecture.
- Return the response envelope without UI-specific formatting.

## Common Integration Options

- If Python runs offline, write analysis output to JSON and let Next.js consume it.
- If Python is a service, call it from a backend route and normalize the response.
- If Python is invoked from Node, isolate the subprocess call and handle timeout/error states.
- If data is in SQL, keep SQL extraction separate from KPI calculation.
