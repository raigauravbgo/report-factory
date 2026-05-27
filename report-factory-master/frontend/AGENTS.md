<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Frontend — BGO Executive Dashboard

## API Base URL

Backend runs at `http://localhost:8000`. Set `NEXT_PUBLIC_API_URL` in `.env.local` to override.
All API calls go through `lib/api.ts` — do not use fetch/axios inline.

## Page Routing

| Route | Purpose |
|-------|---------|
| `/upload` | File drop + file type dropdown → `POST /upload` |
| `/profile/[uploadId]` | Column type/role review → `GET /upload/{id}/profile` |
| `/mapping/[uploadId]` | AI mapping review + confirm → `GET/POST /upload/{id}/mapping` |
| `/kpis?uploadId=X` | KPI selection → `POST /api/sessions/{id}/analyze` |
| `/dashboard/[recipeId]?uploadId=X` | KPI cards + charts + export buttons |
| `/interview` | 5-step AI interview (alt path) |
| `/recipe/[recipeId]` | Recipe review + approval (alt path) |

## Navigation Flow

```
/upload → /profile/[id] → /mapping/[id] → /kpis?uploadId=X → /dashboard/[recipeId]?uploadId=X
                                       ↘ /interview → /recipe/[id] → same dashboard
```

## Components

| Component | Purpose |
|-----------|---------|
| `UploadZone.tsx` | Drag-drop file input |
| `ColumnTable.tsx` | Column profile with role overrides |
| `MappingTable.tsx` | AI mapping review — editable, confidence bars |
| `KpiSelector.tsx` | Available/blocked KPI card grid |
| `KpiCard.tsx` | Scalar KPI value tile |
| `ChartCard.tsx` | Recharts bar/line/pie/table renderer |

## Key Types

- `MappingEntry` — `{ canonical_name, confidence, status, reasoning }`
- `MappingConfirmResponse` — `{ available_kpis, blocked_kpis, recipe_id }`
- `KpiResult` — `{ kpi_id, name, value, breakdown, chart_type, unit, error? }`
- `FILE_TYPE_OPTIONS` — file type dropdown values for upload page
