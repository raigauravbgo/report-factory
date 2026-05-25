// ── Upload / Profile ─────────────────────────────────────────────────────────

export type UploadStatus = "pending" | "profiling" | "profiled" | "failed";

export interface UploadResponse {
  id: number;
  dataset_id: number;
  filename: string;
  status: UploadStatus;
  created_at: string;
}

export type DetectedType = "date" | "numeric" | "categorical" | "text";
export type SuggestedRole = "date" | "dimension" | "measure";
export type ColumnRole = "date" | "dimension" | "measure" | "ignore";

export interface ColumnProfile {
  name: string;
  raw_dtype: string;
  detected_type: DetectedType;
  suggested_role: SuggestedRole;
  missing_count: number;
  missing_pct: number;
  unique_count: number;
  sample_values: unknown[];
}

export interface ProfilingResult {
  upload_id: number;
  row_count: number;
  duplicate_row_count: number;
  columns: ColumnProfile[];
}

// ── Interview ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface KpiSpec {
  name: string;
  formula: string;
}

export interface InterviewResult {
  date_column: string;
  kpis: KpiSpec[];
  dimensions: string[];
  granularity: string;
  filters: string[];
}

export interface InterviewResponse {
  message: string;
  step_index: number;
  step_label: string;
  completed: boolean;
  interview_result: InterviewResult | null;
}

// ── Recipe ───────────────────────────────────────────────────────────────────

export interface ChartConfig {
  type: "line" | "bar";
  kpi: string;
  title: string;
  group_by?: string;
}

export interface RecipeConfig {
  upload_id: number;
  dataset_id: number;
  column_mappings: Record<string, string>;
  date_column: string;
  granularity: string;
  dimensions: string[];
  filters: string[];
  kpis: KpiSpec[];
  chart_layout: ChartConfig[];
}

export interface RecipeResponse {
  id: number;
  dataset_id: number;
  config: RecipeConfig;
  version: number;
  approved_at: string | null;
}
