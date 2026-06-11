# Dashboard UI Checklist

## Executive Readiness

- The top section answers: What changed? Is it good or bad? What should we do?
- Each KPI card shows value, delta, target gap, status, and period.
- The dashboard has one primary story, not equal visual weight for every chart.
- The user can identify the biggest risk within 10 seconds.
- Every chart has a takeaway sentence.

## Layout

- Use a 12-column responsive grid or the existing layout system.
- Put global filters above all affected content.
- Keep summary and KPI cards above detailed diagnostics.
- Group related charts under business questions, not data sources.
- Avoid dense chart walls; use progressive disclosure for details.

## Chart Selection

- Line chart: trend over time.
- Bar chart: category comparison or ranking.
- Stacked bar: composition across categories when totals matter.
- Heatmap/table: many categories with status or variance.
- Scatter: relationship between two numeric variables.
- Avoid pie/donut unless showing a small, clear part-to-whole relationship.

## UX States

- Loading state explains what data is being loaded.
- Empty state explains what filter or data condition caused no result.
- Error state gives a retry or recovery path.
- Data freshness is visible.
- Export/share behavior is available when executives need it.

## Accessibility

- Use semantic headings in page order.
- Do not rely only on color for status.
- Use readable contrast.
- Provide chart labels, table captions, and aria labels where appropriate.
- Ensure controls are keyboard accessible.
