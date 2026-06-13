"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SchemaColumnTable from "@/components/SchemaColumnTable";
import ValidationPanel from "@/components/ValidationPanel";
import { api } from "@/lib/api";
import type {
  ColumnSchemaOverride,
  DatasetSchemaResponse,
  FileSchemaEntry,
  SchemaDetectedType,
  SchemaRole,
  ValidationResult,
} from "@/lib/types";

interface PageProps {
  params: Promise<{ datasetId: string }>;
}

type Override = {
  column_name: string;
  detected_type?: SchemaDetectedType;
  role?: SchemaRole;
  is_filter_candidate?: boolean;
};

export default function SchemaMappingPage({ params }: PageProps) {
  const { datasetId } = use(params);
  const router = useRouter();

  const [schema, setSchema] = useState<DatasetSchemaResponse | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  // overrides keyed by upload_id → column_name → override
  const [overrides, setOverrides] = useState<Record<number, Record<string, Override>>>({});
  // tracks which files have had overrides "saved" (local confirmation)
  const [savedFiles, setSavedFiles] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDatasetSchema(Number(datasetId))
      .then((data) => {
        setSchema(data);
        // Poll until all uploads are ai_suggested or confirmed
        const anyPending = data.uploads.some(
          (u) => u.schema_mapping_status === "pending" || u.status === "pending" || u.status === "profiling"
        );
        if (anyPending) {
          setTimeout(() => window.location.reload(), 3000);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [datasetId]);

  function setOverride(
    uploadId: number,
    colName: string,
    patch: Partial<Override>,
  ) {
    setOverrides((prev) => ({
      ...prev,
      [uploadId]: {
        ...(prev[uploadId] ?? {}),
        [colName]: { column_name: colName, ...(prev[uploadId]?.[colName] ?? {}), ...patch },
      },
    }));
  }

  async function handleConfirm() {
    if (!schema) return;
    setSaving(true);
    try {
      const requests = schema.uploads.map((file) => ({
        upload_id: file.upload_id,
        overrides: Object.values(overrides[file.upload_id] ?? {}).filter(
          (o) => o.detected_type !== undefined || o.role !== undefined || o.is_filter_candidate !== undefined
        ) as ColumnSchemaOverride[],
      }));
      const res = await api.confirmSchema(Number(datasetId), requests);
      if (res.validation && !res.validation.valid) {
        setValidation(res.validation);
        setSaving(false);
        return;
      }
      router.push(`/data-modeling/${datasetId}`);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!schema) return null;

  const activeFile: FileSchemaEntry | undefined = schema.uploads[activeTab];
  const allReady = schema.uploads.every((u) => u.schema_mapping_status !== "pending");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Schema Mapping</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI has classified each column. Review and override any suggestions before continuing.
          </p>
        </div>
        <button
          onClick={handleConfirm}
          disabled={saving || !allReady}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Confirm Schema →"}
        </button>
      </div>

      {validation && <ValidationPanel validation={validation} className="mb-6" />}

      {!allReady && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          AI is analysing your files…
        </div>
      )}

      {/* File tabs */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        {schema.uploads.map((file, i) => (
          <button
            key={file.upload_id}
            onClick={() => setActiveTab(i)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors",
              i === activeTab
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700",
            ].join(" ")}
          >
            {file.filename}
            {file.schema_mapping_status === "ai_suggested" && (
              <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-green-400" title="AI suggestions ready" />
            )}
          </button>
        ))}
      </div>

      {activeFile && (
        <>
          <SchemaColumnTable
            columns={activeFile.columns}
            overrides={overrides[activeFile.upload_id] ?? {}}
            onTypeChange={(col, type) => setOverride(activeFile.upload_id, col, { detected_type: type })}
            onRoleChange={(col, role) => setOverride(activeFile.upload_id, col, { role })}
            onFilterChange={(col, isFilter) => setOverride(activeFile.upload_id, col, { is_filter_candidate: isFilter })}
          />

          {/* Per-file save button */}
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Columns marked * have been overridden. Changes are saved locally until you confirm.
            </p>
            <div className="flex items-center gap-3">
              {savedFiles[activeFile.upload_id] && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Overrides saved for {activeFile.filename}
                </span>
              )}
              <button
                onClick={() =>
                  setSavedFiles((prev) => ({
                    ...prev,
                    [activeFile.upload_id]: activeFile.filename,
                  }))
                }
                className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-sm"
              >
                Save overrides
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function LoadingState() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        <p className="mt-4 text-sm text-gray-500">Loading schema…</p>
      </div>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
    </main>
  );
}
