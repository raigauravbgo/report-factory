import type {
  BatchUploadResponse,
  ChatMessage,
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
  return res.json() as Promise<T>;
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

  getKpiSuggestions: (datasetId: number, uploadIds: number[]): Promise<KpiSuggestion[]> =>
    request<KpiSuggestion[]>(`/session/${datasetId}/kpi-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_ids: uploadIds }),
    }),

  validateData: (datasetId: number, selectedKpiIds: string[]): Promise<ValidationResult> =>
    request<ValidationResult>(`/session/${datasetId}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_kpi_ids: selectedKpiIds }),
    }),

  generateDashboard: (
    datasetId: number,
    selectedKpiIds: string[],
    confirmedRelationships: unknown[],
  ): Promise<{ recipe_id: number }> =>
    request<{ recipe_id: number }>(`/session/${datasetId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_kpi_ids: selectedKpiIds, confirmed_relationships: confirmedRelationships }),
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
};
