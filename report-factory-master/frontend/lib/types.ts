// ── Upload / Profile ─────────────────────────────────────────────────────────

export type UploadStatus =
  | "pending"
  | "profiling"
  | "profiled"
  | "failed"
  | "analyzing"
  | "complete";

export const FILE_TYPE_OPTIONS = [
  { value: "unknown", label: "Select file type…" },
  { value: "call_log", label: "Call Log" },
  { value: "revenue", label: "Revenue Data" },
  { value: "staffing", label: "Staffing Schedule" },
  { value: "customer_profile", label: "Customer Profile" },
  { value: "campaign", label: "Campaign Data" },
  { value: "lms", label: "LMS / Learning Data" },
  { value: "agent_session", label: "Agent Session" },
  { value: "agent_activity", label: "Agent Activity" },
  { value: "dialler", label: "Dialler Data" },
  { value: "other", label: "Other" },
] as const;

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

// ── Column Mapping ────────────────────────────────────────────────────────────

export type MappingStatus = "auto" | "review_needed" | "manual" | "ignored";

export interface MappingEntry {
  canonical_name: string;
  confidence: number;
  status: MappingStatus;
  reasoning: string;
}

export interface MappingResponse {
  upload_id: number;
  mapping: Record<string, MappingEntry>;
  confirmed: boolean;
}

export interface KpiFeasibilityBlocked {
  id: string;
  name: string;
  missing_columns: string[];
}

export interface MappingConfirmResponse {
  upload_id: number;
  recipe_id: number;
  available_kpis: string[];
  blocked_kpis: KpiFeasibilityBlocked[];
}

// ── Analysis / Dashboard ──────────────────────────────────────────────────────

export interface AnalysisStatusResponse {
  upload_id: number;
  status: UploadStatus;
  recipe_id: number | null;
}

export interface KpiResult {
  kpi_id: string;
  name: string;
  value: number | string | null;
  breakdown: Record<string, number> | null;
  chart_type: "bar" | "line" | "pie" | "card" | "table";
  unit: string;
  error?: string;
}

export interface DashboardResult {
  upload_id: number;
  recipe_id: number;
  status: string;
  kpi_results: KpiResult[];
}

// ── KPI Registry ──────────────────────────────────────────────────────────────

export interface KpiDefinition {
  kpi_id: string;
  display_name: string;
  description: string;
  domain: string;
  format: string;
  chart_type: string;
  unit: string;
  reviewed: boolean;
}
