import type {
  ChatMessage,
  ColumnSchemaOverride,
  ConfirmSchemaRequest,
  DashboardData,
  DataModelFkEntry,
  DataModelResponse,
  DataModelTableEntry,
  DatasetSchemaResponse,
  DimensionSuggestion,
  InterviewResponse,
  InterviewResult,
  KpiSpec,
  KpiSuggestion,
  ProfilingResult,
  RecipeConfig,
  RecipeResponse,
  UploadBatchResponse,
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
  // ── Legacy single-file (backward compat) ──────────────────────────────────
  uploadFile: (file: File, datasetName?: string): Promise<UploadBatchResponse> => {
    const form = new FormData();
    form.append("files", file);
    if (datasetName) form.append("dataset_name", datasetName);
    return request<UploadBatchResponse>("/upload", { method: "POST", body: form });
  },

  // ── Multi-file upload ──────────────────────────────────────────────────────
  uploadFiles: (files: File[], datasetName?: string): Promise<UploadBatchResponse> => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (datasetName) form.append("dataset_name", datasetName);
    return request<UploadBatchResponse>("/upload", { method: "POST", body: form });
  },

  getUpload: (uploadId: number): Promise<UploadResponse> =>
    request<UploadResponse>(`/upload/${uploadId}`),

  getProfile: (uploadId: number): Promise<ProfilingResult> =>
    request<ProfilingResult>(`/upload/${uploadId}/profile`),

  // ── Dataset-level ──────────────────────────────────────────────────────────
  getDatasetUploads: (datasetId: number): Promise<UploadBatchResponse> =>
    request<UploadBatchResponse>(`/upload/dataset/${datasetId}`),

  getDatasetSchema: (datasetId: number): Promise<DatasetSchemaResponse> =>
    request<DatasetSchemaResponse>(`/upload/dataset/${datasetId}/schema`),

  confirmSchema: (
    datasetId: number,
    requests: ConfirmSchemaRequest[],
  ): Promise<{ dataset_id: number; pipeline_stage: string; validation: ValidationResult }> =>
    request(`/upload/dataset/${datasetId}/schema/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requests),
    }),

  // ── Data modeling ──────────────────────────────────────────────────────────
  suggestDataModel: (datasetId: number): Promise<DataModelResponse> =>
    request<DataModelResponse>("/data-model/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId }),
    }),

  getDataModel: (datasetId: number): Promise<DataModelResponse> =>
    request<DataModelResponse>(`/data-model/${datasetId}`),

  confirmDataModel: (
    datasetId: number,
    tableOverrides: { upload_id: number; role: "fact" | "dimension" }[],
    pkOverrides: Record<string, string[]>,
    fkOverrides: Array<{
      from_upload_id: number;
      from_col: string;
      to_upload_id: number;
      to_col: string;
      confirmed: boolean;
    }>,
  ): Promise<{ dataset_id: number; pipeline_stage: string; data_model: DataModelResponse; validation: ValidationResult }> =>
    request(`/data-model/${datasetId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_id: datasetId,
        table_overrides: tableOverrides,
        pk_overrides: pkOverrides,
        fk_overrides: fkOverrides,
      }),
    }),

  // ── Interview ──────────────────────────────────────────────────────────────
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

  skipInterview: (datasetId: number): Promise<{ dataset_id: number; next_stage: string }> =>
    request("/interview/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId }),
    }),

  createRecipe: (uploadId: number, interviewResult: InterviewResult): Promise<RecipeResponse> =>
    request<RecipeResponse>("/interview/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, interview_result: interviewResult }),
    }),

  createRecipeFromContext: (datasetId: number): Promise<RecipeResponse> =>
    request<RecipeResponse>("/interview/recipe/from-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId }),
    }),

  getRecipe: (recipeId: number): Promise<RecipeResponse> =>
    request<RecipeResponse>(`/interview/recipe/${recipeId}`),

  approveRecipe: (recipeId: number, config: RecipeConfig, approvedBy = "user"): Promise<RecipeResponse> =>
    request<RecipeResponse>(`/interview/recipe/${recipeId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved_by: approvedBy, config }),
    }),

  // ── KPI Suggestions ────────────────────────────────────────────────────────
  getKpiSuggestions: (
    datasetId: number,
  ): Promise<{ dataset_id: number; suggestions: KpiSuggestion[]; total_catalog_count: number }> =>
    request("/kpi-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId }),
    }),

  selectKpis: (
    datasetId: number,
    selectedKpiIds: string[],
    customKpis: KpiSpec[],
  ): Promise<{ dataset_id: number; pipeline_stage: string; validation: ValidationResult }> =>
    request("/kpi-suggestions/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, selected_kpi_ids: selectedKpiIds, custom_kpis: customKpis }),
    }),

  // ── Dimensions ─────────────────────────────────────────────────────────────
  getDimensionSuggestions: (
    datasetId: number,
  ): Promise<{ dataset_id: number; suggestions: DimensionSuggestion[] }> =>
    request<{ dataset_id: number; suggestions: DimensionSuggestion[] }>(`/dimensions/${datasetId}`),

  selectDimensions: (
    datasetId: number,
    selectedDimensions: string[],
  ): Promise<{ dataset_id: number; selected_dimensions: string[]; pipeline_stage: string }> =>
    request(`/dimensions/${datasetId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, selected_dimensions: selectedDimensions }),
    }),

  // ── Dashboard ──────────────────────────────────────────────────────────────
  getDashboardData: (recipeId: number, filters: Record<string, string> = {}): Promise<DashboardData> => {
    const qs = Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => `f_${k}=${encodeURIComponent(v)}`)
      .join("&");
    return request<DashboardData>(`/dashboard/${recipeId}/data${qs ? `?${qs}` : ""}`);
  },

  // ── Validation ─────────────────────────────────────────────────────────────
  validateKpiFormula: (formula: string, availableColumns: string[]): Promise<ValidationResult> =>
    request<ValidationResult>("/validate/kpi-formula", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formula, available_columns: availableColumns }),
    }),

  validateRecipe: (config: RecipeConfig, availableColumns: string[]): Promise<ValidationResult> =>
    request<ValidationResult>("/validate/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, available_columns: availableColumns }),
    }),
};
