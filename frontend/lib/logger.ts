/**
 * Fire-and-forget frontend event logger.
 * Sends user interaction events to the backend which writes them to app.log.
 * NEVER throws, NEVER blocks the UI — logging failures are silently swallowed.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function logEvent(
  event: string,
  page: string,
  data?: Record<string, unknown>,
  ids?: { datasetId?: number; recipeId?: number },
): void {
  fetch(`${BASE_URL}/api/log/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event,
      page,
      data: data ?? {},
      dataset_id: ids?.datasetId ?? null,
      recipe_id: ids?.recipeId ?? null,
      ts: new Date().toISOString(),
    }),
  }).catch(() => {}); // silent fail — logging must never break the app
}
