-- BGO Report Factory — SQLite schema (PRD3)
-- Use CREATE TABLE IF NOT EXISTS so init_db() is idempotent.

CREATE TABLE IF NOT EXISTS report_requests (
    id           TEXT PRIMARY KEY,
    created_by   TEXT DEFAULT 'dev',
    template_type TEXT,
    client_id    TEXT,
    period_start TEXT,
    period_end   TEXT,
    status       TEXT DEFAULT 'intake',
    intake_spec  TEXT,           -- JSON
    column_mapping TEXT,         -- JSON
    computed_kpis  TEXT,         -- JSON
    data_quality_flags TEXT,     -- JSON
    chat_history   TEXT,         -- JSON
    file_path    TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_catalog (
    kpi_id        TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    description   TEXT,
    numerator     TEXT NOT NULL,
    denominator   TEXT NOT NULL,   -- "_none_" for pure sum/count KPIs
    format        TEXT NOT NULL,   -- percentage | integer | currency | duration
    domain        TEXT NOT NULL,   -- collections | cx | sales | workforce | ops
    expected_range TEXT,           -- JSON: {"min": 0, "max": 1} or null
    aliases       TEXT,            -- JSON array
    source_fields TEXT,            -- JSON array
    reviewed      INTEGER DEFAULT 0,
    aggregation   TEXT DEFAULT ''  -- ratio_of_sums | average | (empty = default sum/ratio)
);

CREATE TABLE IF NOT EXISTS schema_memory (
    client_id     TEXT NOT NULL,
    template_type TEXT NOT NULL,
    mappings      TEXT NOT NULL,   -- JSON
    approved_by   TEXT,
    use_count     INTEGER DEFAULT 0,
    updated_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (client_id, template_type)
);

CREATE TABLE IF NOT EXISTS review_queue (
    id             TEXT PRIMARY KEY,
    request_id     TEXT REFERENCES report_requests(id),
    status         TEXT DEFAULT 'pending',  -- pending | approved | rejected
    reviewer_notes TEXT,
    overrides      TEXT,                    -- JSON
    reviewed_at    TEXT
);

CREATE TABLE IF NOT EXISTS agent_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT,
    step       TEXT,
    input      TEXT,
    output     TEXT,
    latency_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);
