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
  is_filter: boolean;
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
  // AI-suggested table classification; user can override in the schema step
  table_type?: "fact" | "dimension" | "unknown";
}

export interface ColumnSchemaOverride {
  name: string;
  detected_type?: DetectedType;
  suggested_role?: ColumnRole;
  semantic_tag?: SemanticTag;
  in_grain?: boolean;
  in_filter?: boolean;
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
  aggregation?: string;
  format?: string;
}

export interface InterviewResult {
  domain?: string | null;
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
  is_adk_mode?: boolean;
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
  source: "catalog" | "interview" | "ai";
  domain?: string;
  aggregation?: string;
  description?: string;
}

export interface DimensionColumn {
  name: string;
  source_file: string;
  semantic_tag: string | null;
  unique_count: number;
  sample_values: string[];
  table_count: number;
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

// ── Dashboard (Enhanced View) ─────────────────────────────────────────────────

export interface DashboardMetric {
  id: number;
  name: string;
  value: number;
  delta: number | null;
  delta_pct: number | null;
  status: "good" | "warning" | "risk" | "neutral";
  direction: "higher_is_better" | "lower_is_better";
  prior_value: number | null;
  count: number;
  period: string | null;
  formula: string;
  format: string;
}

export interface DashboardInsight {
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  finding: string;
  driver: string;
  impact: string;
  action: string | null;
}

export interface DataQuality {
  status: "ok" | "warning";
  date_coverage: string | null;
  most_recent_date: string | null;
  warnings: string[];
}

export interface DashboardData {
  recipe_id: number;
  config: RecipeConfig;
  active_filters: Record<string, string>;
  active_granularity: string;
  generated_at: string;
  // Classic fields
  kpi_summaries: Array<{ name: string; value: number | null; formula: string; format?: string }>;
  time_series: Array<{ kpi: string; data: Array<{ date: string; value: number }> }>;
  breakdown: Array<{ kpi: string; dimension: string; data: Array<{ label: string; value: number }> }>;
  // Enhanced fields
  metrics: DashboardMetric[];
  time_series_dict: Record<string, Array<{ period: string; value: number }>>;
  dimension_breakdowns: Record<string, Record<string, Array<{ name: string; value: number }>>>;
  dimension_spreads: Record<string, number>;
  data_quality: DataQuality;
  row_count: number;
  approved: boolean;
  insights: DashboardInsight[];
}
