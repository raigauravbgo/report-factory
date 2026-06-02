// ── Upload / Profile ─────────────────────────────────────────────────────────

export type UploadStatus = "pending" | "profiling" | "profiled" | "failed";

export interface UploadResponse {
  id: number;
  dataset_id: number;
  filename: string;
  status: UploadStatus;
  error_message?: string | null;
  created_at: string;
}

export interface BatchUploadItem {
  upload_id: number;
  filename: string;
  status: UploadStatus;
}

export interface BatchUploadResponse {
  dataset_id: number;
  uploads: BatchUploadItem[];
}

export interface DatasetResponse {
  id: number;
  client_id: string;
  name: string;
  created_at: string;
}

export type DetectedType = "date" | "numeric" | "categorical" | "text";
export type SuggestedRole = "date" | "dimension" | "measure";
export type ColumnRole = "date" | "dimension" | "measure" | "ignore";
export type SemanticTag =
  | "entity_key"
  | "time_key"
  | "financial_metric"
  | "dimension"
  | "text"
  | "ignore";

export interface ColumnProfile {
  name: string;
  raw_dtype: string;
  detected_type: DetectedType;
  suggested_role: SuggestedRole;
  missing_count: number;
  missing_pct: number;
  unique_count: number;
  sample_values: unknown[];
  // Extended deep profiling fields
  semantic_tag: SemanticTag;
  grain_score: number;
  grain_candidate: boolean;
}

export interface ProfilingResult {
  upload_id: number;
  row_count: number;
  duplicate_row_count: number;
  columns: ColumnProfile[];
  // File-level metadata
  encoding: string;
  delimiter: string;
  sheet_names: string[];
  active_sheet: string;
  grain_suggestions: string[];
}

export interface ColumnSchemaOverride {
  name: string;
  detected_type?: DetectedType;
  suggested_role?: ColumnRole;
  semantic_tag?: SemanticTag;
  in_grain?: boolean;
}

export interface SaveSchemaOverridesRequest {
  column_overrides: ColumnSchemaOverride[];
  active_sheet?: string;
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

// ── Session (multi-file flow) ─────────────────────────────────────────────────

export interface RelationshipSuggestion {
  file_a: string;
  col_a: string;
  file_b: string;
  col_b: string;
  confidence: number;
  relationship_type: "pk_fk" | "same_dimension" | "shared_key";
}

export interface KpiSuggestion {
  kpi_id: string;
  display_name: string;
  formula: string;
  confidence: number;
  matched_columns: Record<string, string>;
  source: "catalog" | "interview";
  domain?: string;
}

export interface ValidationWarning {
  severity: "error" | "warning";
  column: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationWarning[];
  warnings: ValidationWarning[];
  passed: boolean;
}

// ── Recipe ───────────────────────────────────────────────────────────────────

export interface ChartConfig {
  type: "line" | "bar";
  kpi: string;
  title: string;
  group_by?: string;
}

export interface DashboardSection {
  id: string;
  title: string;
  kpis: string[];
  chart_type: "kpi_card" | "line" | "bar" | "table";
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
  sections?: DashboardSection[];
}

export interface RecipeResponse {
  id: number;
  dataset_id: number;
  config: RecipeConfig;
  version: number;
  approved_at: string | null;
}
