# BGO Report Factory — Frontend

Next.js 16 App Router frontend for the BGO Report Factory self-service BI tool.

**Backend required:** Start the FastAPI backend at `http://localhost:8000` before running the frontend.

---

## Setup

```bash
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Key Pages

| Route | Description |
|---|---|
| `/` | Dashboard Library — list of all generated dashboards |
| `/upload` | Multi-file batch upload (up to 10 CSV/Excel files); polls profiling status per file; auto-checks for saved templates at ≥ 95% column overlap |
| `/session/[id]/schema` | Per-file schema mapping: column role/type overrides, table-type (Fact/Dimension/Unknown), Virtual Dimension builder, relationship confirmation |
| `/session/[id]/review` | Template fast-path review: inspect and override saved template config before generating |
| `/session/[id]/interview` | **Dual-mode interview:** ADK agent chat (indigo badge, Markdown rendering, wide bubbles) OR Flow 1 step-by-step chatbot (teal progress bar, skip link) |
| `/session/[id]/kpis` | KPI checklist — AI-suggested + custom KPI builder (Flow 1 path; bypassed in ADK mode) |
| `/session/[id]/dimensions` | Dimension selection — two-panel drag UI (Flow 1 path; bypassed in ADK mode) |
| `/dashboard/[recipeId]` | Story sections, KPI summary cards, trend charts, breakdown charts, filter bar, Excel/PPTX export |
| `/kpis/custom` | Custom KPI proposal approve/reject UI (central data team) |
| `/review-queue` | Report review queue (central data team) |

---

## Architecture Notes

**App Router only.** All pages use `"use client"` for pages with state or data fetching. There are no server components in the session flow — all data comes from the FastAPI backend via `lib/api.ts`.

**Session state.** The pipeline passes state between pages via `sessionStorage`, not URL params or a global store. Keys:
- `dataset_{id}_uploads` — upload IDs + filenames from the batch upload response
- `dataset_{id}_relationships` — confirmed cross-file relationships (JSON)
- `dataset_{id}_interview` — Flow 1 interview result (date column, dimensions, etc.)
- `dataset_{id}_template` — matched template config (template fast-path)

**Interview page hydration.** The `useUploadIds` hook reads `sessionStorage` in a `useEffect`, not during render, to avoid server/client HTML mismatch. The init `useEffect` reads `sessionStorage` directly (not via the hook state) to avoid a race condition where the hook's effect hasn't run yet when the first API call fires.

**Relationship confirm.** `SchemaRelationships` calls `onConfirm(confirmedList)`. The parent (`schema/page.tsx`) saves the list to `sessionStorage` and shows a green banner — it does **not** call `setRelationships(confirmed)`. Mutating the suggestion list would shift array indices and cause subsequently-toggled items to appear unchecked.

**ADK mode locking.** `isAdkMode` state in `interview/page.tsx` is set to `true` on the first response with `is_adk_mode: true` and never reset. This prevents the UI from flipping back to Flow 1 styling if a later turn falls back to Flow 1 on the backend.

---

## Tech Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Charts | Recharts 3.8 |
| Markdown | react-markdown (interview assistant messages) |
| HTTP | Native `fetch` via `lib/api.ts` |

---

## Development Commands

```bash
npm run dev      # Development server (port 3000, hot reload)
npm run build    # Production build
npm run lint     # ESLint
npm run start    # Serve production build
```

TypeScript is checked at build time. Run `npx tsc --noEmit` to check types without building.
