import type {
  BatchUploadResponse,
  ChatMessage,
  DimensionColumn,
  InterviewResponse,
  InterviewResult,
  KpiSuggestion,
  ProfilingResult,
  RecipeConfig,
  RecipeResponse,
  RelationshipSuggestion,
  SaveSchemaOverridesRequest,
  UploadResponse,
  ValidationResult,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  // M5: Parse first, then guard against FastAPI error shapes ({detail: "..."})
  // that can arrive with a 2xx status (e.g. the 202 → 503 fix in upload.py)
  const data: unknown = await res.json();
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") throw new Error(d.detail);
    if (typeof d.message === "string" && d.status && typeof d.status === "string") {
      throw new Error(d.message);
    }
  }
  return data as T;
}

export const api = {
  // ── Upload (single — backwards compat) ──────────────────────────────────────
  uploadFile: (file: File, datasetName?: string): Promise<UploadResponse> => {
    const form = new FormData();
    form.append("file", file);
    if (datasetName) form.append("dataset_name", datasetName);
    return request<UploadResponse>("/upload", { method: "POST", body: form });
  },

  // ── Upload (batch) ───────────────────────────────────────────────────────────
  uploadBatch: (files: File[], datasetName?: string): Promise<BatchUploadResponse> => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (datasetName) form.append("dataset_name", datasetName);
    return request<BatchUploadResponse>("/upload/batch", { method: "POST", body: form });
  },

  getUpload: (uploadId: number): Promise<UploadResponse> =>
    request<UploadResponse>(`/upload/${uploadId}`),

  getProfile: (uploadId: number): Promise<ProfilingResult> =>
    request<ProfilingResult>(`/upload/${uploadId}/profile`),

  saveSchemaOverrides: (uploadId: number, body: SaveSchemaOverridesRequest): Promise<ProfilingResult> =>
    request<ProfilingResult>(`/upload/${uploadId}/schema`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  // ── Session endpoints ────────────────────────────────────────────────────────
  getRelationships: (datasetId: number): Promise<RelationshipSuggestion[]> =>
    request<RelationshipSuggestion[]>(`/session/${datasetId}/relationships`, { method: "POST" }),

  sendInterviewMessage: (
    datasetId: number,
    message: string,
    history: ChatMessage[],
    uploadIds: number[],
  ): Promise<InterviewResponse> =>
    request<InterviewResponse>(`/session/${datasetId}/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, upload_ids: uploadIds }),
    }),

  skipInterview: (datasetId: number): Promise<InterviewResult> =>
    request<InterviewResult>(`/session/${datasetId}/interview/skip`, { method: "POST" }),

  getKpiSuggestions: (
    datasetId: number,
    uploadIds: number[],
    interviewAnswers?: object,
  ): Promise<KpiSuggestion[]> =>
    request<KpiSuggestion[]>(`/session/${datasetId}/kpi-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_ids: uploadIds, interview_answers: interviewAnswers ?? {} }),
    }),

  getDimensions: (datasetId: number): Promise<DimensionColumn[]> =>
    request<DimensionColumn[]>(`/session/${datasetId}/dimensions`),

  validateData: (datasetId: number, selectedKpiIds: string[]): Promise<ValidationResult> =>
    request<ValidationResult>(`/session/${datasetId}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_kpi_ids: selectedKpiIds }),
    }),

  generateDashboard: (
    datasetId: number,
    selectedKpis: KpiSuggestion[],
    confirmedRelationships: unknown[],
    interviewResult?: InterviewResult | null,
  ): Promise<{ recipe_id: number }> =>
    request<{ recipe_id: number }>(`/session/${datasetId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_kpis: selectedKpis,
        confirmed_relationships: confirmedRelationships,
        interview_result: interviewResult ?? {},
      }),
    }),

  // ── Interview (legacy single-file) ─────────────────────────────────────────
  sendInterviewMessageLegacy: (
    uploadId: number,
    message: string,
    history: ChatMessage[],
  ): Promise<InterviewResponse> =>
    request<InterviewResponse>("/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, message, history }),
    }),

  createRecipe: (uploadId: number, interviewResult: InterviewResult): Promise<RecipeResponse> =>
    request<RecipeResponse>("/interview/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, interview_result: interviewResult }),
    }),

  getRecipe: (recipeId: number): Promise<RecipeResponse> =>
    request<RecipeResponse>(`/interview/recipe/${recipeId}`),

  approveRecipe: (recipeId: number, config: RecipeConfig, approvedBy = "user"): Promise<RecipeResponse> =>
    request<RecipeResponse>(`/interview/recipe/${recipeId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved_by: approvedBy, config }),
    }),

  updateRecipeConfig: (
    recipeId: number,
    patch: Partial<RecipeConfig>,
  ): Promise<{ status: string; updated: string[]; config: RecipeConfig }> =>
    request<{ status: string; updated: string[]; config: RecipeConfig }>(
      `/api/dashboard/${recipeId}/config`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),

  validateConfig: (
    recipeId: number,
  ): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    details: {
      date_span_days?: number | null;
      missing_filter_columns?: string[];
      high_cardinality_filters?: string[];
      failing_kpi_formulas?: string[];
    };
  }> =>
    request(`/api/dashboard/${recipeId}/validate-config`),

  validateFormula: (
    recipeId: number,
    formula: string,
  ): Promise<{ valid: boolean; preview_value: number | null; error: string | null }> =>
    request(`/api/dashboard/${recipeId}/validate-formula`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formula }),
    }),
};
