import type {
  AnalysisStatusResponse,
  ChatMessage,
  DashboardResult,
  InterviewResponse,
  InterviewResult,
  KpiDefinition,
  MappingConfirmResponse,
  MappingEntry,
  MappingResponse,
  ProfilingResult,
  RecipeConfig,
  RecipeResponse,
  UploadResponse,
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
  uploadFile: (file: File, fileType = "unknown", datasetName?: string): Promise<UploadResponse> => {
    const form = new FormData();
    form.append("file", file);
    form.append("file_type", fileType);
    if (datasetName) form.append("dataset_name", datasetName);
    return request<UploadResponse>("/upload", { method: "POST", body: form });
  },

  getUpload: (uploadId: number): Promise<UploadResponse> =>
    request<UploadResponse>(`/upload/${uploadId}`),

  getProfile: (uploadId: number): Promise<ProfilingResult> =>
    request<ProfilingResult>(`/upload/${uploadId}/profile`),

  sendInterviewMessage: (
    uploadId: number,
    message: string,
    history: ChatMessage[],
  ): Promise<InterviewResponse> =>
    request<InterviewResponse>("/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, message, history }),
    }),

  createRecipe: (
    uploadId: number,
    interviewResult: InterviewResult,
  ): Promise<RecipeResponse> =>
    request<RecipeResponse>("/interview/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, interview_result: interviewResult }),
    }),

  getRecipe: (recipeId: number): Promise<RecipeResponse> =>
    request<RecipeResponse>(`/interview/recipe/${recipeId}`),

  approveRecipe: (
    recipeId: number,
    config: RecipeConfig,
    approvedBy = "user",
  ): Promise<RecipeResponse> =>
    request<RecipeResponse>(`/interview/recipe/${recipeId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved_by: approvedBy, config }),
    }),

  // ── Column Mapping ────────────────────────────────────────────────────────

  getMapping: (uploadId: number): Promise<MappingResponse> =>
    request<MappingResponse>(`/upload/${uploadId}/mapping`),

  confirmMapping: (
    uploadId: number,
    mapping: Record<string, MappingEntry>,
  ): Promise<MappingConfirmResponse> =>
    request<MappingConfirmResponse>(`/upload/${uploadId}/mapping/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping }),
    }),

  // ── Analysis / Dashboard ──────────────────────────────────────────────────

  startAnalysis: (uploadId: number, kpiIds: string[]): Promise<{ upload_id: number; recipe_id: number; status: string }> =>
    request(`/api/sessions/${uploadId}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kpi_ids: kpiIds }),
    }),

  getAnalysisStatus: (uploadId: number): Promise<AnalysisStatusResponse> =>
    request<AnalysisStatusResponse>(`/api/sessions/${uploadId}/status`),

  getDashboard: (uploadId: number): Promise<DashboardResult> =>
    request<DashboardResult>(`/api/sessions/${uploadId}/dashboard`),

  exportExcel: (uploadId: number): string =>
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/sessions/${uploadId}/export/excel`,

  exportPptx: (uploadId: number): string =>
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/sessions/${uploadId}/export/pptx`,

  // ── KPI Registry ─────────────────────────────────────────────────────────

  getRegistryColumns: (): Promise<{ columns: string[] }> =>
    request<{ columns: string[] }>("/api/registry/columns"),

  getRegistryKpis: (): Promise<{ kpis: KpiDefinition[] }> =>
    request<{ kpis: KpiDefinition[] }>("/api/registry/kpis"),
};
