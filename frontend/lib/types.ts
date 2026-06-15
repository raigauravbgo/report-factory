// ── Upload / Profile ─────────────────────────────────────────────────────────

export type UploadStatus = "pending" | "profiling" | "profiled" | "failed";
export type SchemaMappingStatus = "pending" | "ai_suggested" | "confirmed";

export interface UploadResponse {
  id: number;
  dataset_id: number;
  filename: string;
  status: UploadStatus;
  schema_mapping_status: SchemaMappingStatus;
  created_at: string;
}

export interface UploadBatchResponse {
  dataset_id: number;
  uploads: UploadResponse[];
}

export type DetectedType = "date" | "numeric" | "categorical" | "text";
export type SuggestedRole = "date" | "dimension" | "measure";
export type ColumnRole = "date" | "dimension" | "measure" | "ignore";

// Extended 5-type system used by schema mapper
export type SchemaDetectedType = "int" | "float" | "boolean" | "text" | "date";
export type SchemaRole = "measure" | "date" | "dimension" | "boolean";

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

// ── Schema Mapping ────────────────────────────────────────────────────────────

export interface ColumnSchemaEntry {
  id: number;
  upload_id: number;
  column_name: string;
  raw_dtype: string;
  ai_detected_type: SchemaDetectedType;
  ai_role: SchemaRole;
  ai_is_filter: boolean;
  ai_confidence: number;
  confirmed_type: SchemaDetectedType | null;
  confirmed_role: SchemaRole | null;
  confirmed_is_filter: boolean | null;
  effective_type: SchemaDetectedType;
  effective_role: SchemaRole;
  effective_is_filter: boolean;
  unique_count: number;
  missing_pct: number;
  sample_values: unknown[] | null;
}

export interface FileSchemaEntry {
  upload_id: number;
  filename: string;
  status: UploadStatus;
  schema_mapping_status: SchemaMappingStatus;
  columns: ColumnSchemaEntry[];
}

export interface DatasetSchemaResponse {
  dataset_id: number;
  uploads: FileSchemaEntry[];
}

export interface ColumnSchemaOverride {
  column_name: string;
  detected_type?: SchemaDetectedType;
  role?: SchemaRole;
  is_filter_candidate?: boolean;
}

export interface ConfirmSchemaRequest {
  upload_id: number;
  overrides: ColumnSchemaOverride[];
}

// ── Data Modeling ─────────────────────────────────────────────────────────────

export type TableRole = "fact" | "dimension";

export interface DataModelTableEntry {
  upload_id: number;
  filename: string;
  role: TableRole;
  confidence: number;
  confirmed_role: TableRole | null;
  is_primary_fact?: boolean;
}

export interface BridgeDim {
  dim_upload_id: number;
  dim_filename: string;
  fact_upload_ids: number[];
  fact_filenames: string[];
}

export interface DataModelFkEntry {
  from_upload_id: number;
  from_col: string;
  to_upload_id: number;
  to_col: string;
  confidence: number;
  integrity_pct: number | null;
  confirmed: boolean;
  // A1: join cardinality (populated after data_modeler runs; absent for legacy FKs)
  join_type?: "one_to_one" | "many_to_one" | "many_to_many" | "unverified";
  dim_max_dup?: number | null;
  dim_unique_ratio?: number | null;
}

export interface DataModelResponse {
  id: number;
  dataset_id: number;
  status: "ai_suggested" | "confirmed";
  tables: DataModelTableEntry[];
  primary_keys: Record<string, string[]>;
  foreign_keys: DataModelFkEntry[];
  ai_reasoning: string | null;
  bridge_dims?: BridgeDim[];
  validation: ValidationResult | null;
}

// ── Interview ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface KpiSpec {
  name: string;
  formula: string;
  upload_id?: number;
  resolved_formula?: string | null; // D1: column-resolved formula; overrides formula at eval time
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

// ── KPI Suggestions ──────────────────────────────────────────────────────────

export interface KpiSuggestion {
  kpi_id: string;
  display_name: string;
  domain: string;
  formula: string;
  relevance_score: number;
  reasoning: string;
  upload_id?: number;
}

// ── Dimension Suggestions ─────────────────────────────────────────────────────

export interface DimensionSuggestion {
  column_name: string;
  upload_id: number;
  table_name: string;
  display_label: string;
  is_recommended: boolean;
  reasoning: string;
}

// ── Recipe ───────────────────────────────────────────────────────────────────

export type ChartType = "line" | "bar" | "table" | "kpi_card";
export type NullHandling = "exclude_nulls" | "treat_as_zero" | "carry_forward";

export interface ChartConfig {
  type: ChartType;
  kpi: string;
  title: string;
  group_by?: string;
  null_handling?: NullHandling;
  show_breakdown?: boolean;
}

export interface RecipeConfig {
  upload_id: number;
  dataset_id: number;
  upload_ids: number[];
  interview_skipped: boolean;
  selected_kpi_ids: string[];
  dimension_table_upload_ids: number[];
  selected_dimensions: string[];
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

// ── Validation ────────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationError {
  field: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export type KpiStatus = "good" | "warning" | "risk" | "neutral";
export type InsightSeverity = "critical" | "high" | "medium" | "low";

export interface KpiSummaryCard {
  name: string;
  formula: string;
  value: number;
  count: number;
  null_count?: number; // E2: rows where formula returned NaN/null
  null_pct?: number;   // E2: percentage of null rows (0–100)
}

export interface DashboardMetric {
  id: string;
  name: string;
  formula: string;
  value: number;
  prior_value: number | null;
  delta: number | null;
  delta_pct: number | null;
  delta_type: "absolute" | "percentage_point";
  count: number;
  status: KpiStatus;
  direction: "higher_is_better" | "lower_is_better";
  period: string | null;
}

export interface DashboardInsight {
  severity: InsightSeverity;
  headline: string;
  finding: string;
  evidence: string;
  driver: string;
  impact: string;
  decision: string;
  action: string;
}

export interface DataQuality {
  status: "ok" | "warning" | "error";
  row_count: number;
  most_recent_date: string | null;
  date_coverage: string | null;
  warnings: string[];
}

export interface DashboardData {
  recipe_id: number;
  generated_at: string;
  row_count: number;
  approved: boolean;
  filters: { date_column: string; granularity: string; dimensions: string[] };
  filter_options: Record<string, string[]>;
  active_filters: Record<string, string>;
  metrics: DashboardMetric[];
  kpi_summaries: KpiSummaryCard[];
  time_series: Record<string, Array<{ period: string; value: number }>>;
  dimension_breakdowns: Record<string, Record<string, Array<{ name: string; value: number }>>>;
  dimension_spreads: Record<string, number>;
  insights: DashboardInsight[];
  data_quality: DataQuality;
}

// ── Pipeline stage ────────────────────────────────────────────────────────────

export type PipelineStage =
  | "upload"
  | "schema_mapping"
  | "data_modeling"
  | "interview"
  | "kpi_selection"
  | "dimension_selection"
  | "recipe"
  | "dashboard";
