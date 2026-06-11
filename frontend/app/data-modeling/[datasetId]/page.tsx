"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ValidationPanel from "@/components/ValidationPanel";
import { api } from "@/lib/api";
import type {
  DataModelFkEntry,
  DataModelResponse,
  ValidationResult,
} from "@/lib/types";

interface PageProps {
  params: Promise<{ datasetId: string }>;
}

interface FkDraft {
  from_upload_id: number;
  from_col: string;
  to_upload_id: number;
  to_col: string;
}

export default function DataModelingPage({ params }: PageProps) {
  const { datasetId } = use(params);
  const router = useRouter();

  const [model, setModel] = useState<DataModelResponse | null>(null);
  const [tableRoles, setTableRoles] = useState<Record<number, "fact" | "dimension">>({});
  const [pkOverrides, setPkOverrides] = useState<Record<string, string>>({});
  const [removedFks, setRemovedFks] = useState<Set<string>>(new Set());
  const [addedFks, setAddedFks] = useState<DataModelFkEntry[]>([]);
  const [draft, setDraft] = useState<FkDraft | null>(null);
  const [colsByUpload, setColsByUpload] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSuggesting(true);

    async function fetchModel(): Promise<DataModelResponse> {
      // 1. Return existing model if already created
      try {
        return await api.getDataModel(Number(datasetId));
      } catch {}

      // 2. Trigger AI suggestion (may be slow)
      try {
        return await api.suggestDataModel(Number(datasetId));
      } catch {}

      // 3. Suggestion may have succeeded server-side but the response timed out —
      //    poll GET until the model appears (up to ~10s)
      for (let i = 0; i < 5; i++) {
        if (cancelled) throw new Error("cancelled");
        await new Promise((r) => setTimeout(r, 2000));
        try {
          return await api.getDataModel(Number(datasetId));
        } catch {}
      }
      throw new Error("Unable to load data model. Please refresh the page.");
    }

    Promise.all([fetchModel(), api.getDatasetSchema(Number(datasetId))])
      .then(([data, schema]) => {
        if (cancelled) return;
        setModel(data);
        setTableRoles(
          Object.fromEntries(
            data.tables.map((t) => [t.upload_id, (t.confirmed_role ?? t.role) as "fact" | "dimension"])
          )
        );
        const pks: Record<string, string> = {};
        for (const [uid, cols] of Object.entries(data.primary_keys ?? {})) {
          if ((cols as string[])[0]) pks[uid] = (cols as string[])[0];
        }
        setPkOverrides(pks);
        if (data.validation) setValidation(data.validation);

        const cols: Record<number, string[]> = {};
        for (const upload of schema.uploads) {
          cols[upload.upload_id] = upload.columns.map((c) => c.column_name);
        }
        setColsByUpload(cols);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) { setSuggesting(false); setLoading(false); } });

    return () => { cancelled = true; };
  }, [datasetId]);

  function fkKey(fk: DataModelFkEntry) {
    return `${fk.from_upload_id}:${fk.from_col}>${fk.to_upload_id}:${fk.to_col}`;
  }

  function filenameFor(uploadId: number) {
    return model?.tables.find((t) => t.upload_id === uploadId)?.filename ?? `upload ${uploadId}`;
  }

  function openDraft() {
    if (!model || model.tables.length < 2) return;
    const [a, b] = model.tables;
    setDraft({
      from_upload_id: a.upload_id,
      from_col: colsByUpload[a.upload_id]?.[0] ?? "",
      to_upload_id: b.upload_id,
      to_col: colsByUpload[b.upload_id]?.[0] ?? "",
    });
  }

  function commitDraft() {
    if (!draft || !draft.from_col || !draft.to_col) return;
    if (draft.from_upload_id === draft.to_upload_id) return;
    setAddedFks((prev) => [
      ...prev,
      { ...draft, confidence: 1.0, integrity_pct: null, confirmed: true },
    ]);
    setDraft(null);
  }

  async function handleConfirm() {
    if (!model) return;
    setSaving(true);
    try {
      const tableOverrides = model.tables
        .filter((t) => tableRoles[t.upload_id] !== (t.confirmed_role ?? t.role))
        .map((t) => ({ upload_id: t.upload_id, role: tableRoles[t.upload_id] }));

      const pkForAPI: Record<string, string[]> = {};
      for (const [uid, col] of Object.entries(pkOverrides)) {
        if (col) pkForAPI[uid] = [col];
      }

      const fkOverrides = [
        ...(model.foreign_keys ?? [])
          .filter((fk) => removedFks.has(fkKey(fk)))
          .map((fk) => ({ ...fk, confirmed: false })),
        ...addedFks.map((fk) => ({ ...fk, confirmed: true })),
      ];

      const res = await api.confirmDataModel(Number(datasetId), tableOverrides, pkForAPI, fkOverrides);
      if (res.validation?.errors?.some((e: { severity: string }) => e.severity === "error")) {
        setValidation(res.validation);
        setSaving(false);
        return;
      }
      router.push(`/interview?datasetId=${datasetId}`);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  if (loading || suggesting) return <LoadingState label={suggesting ? "AI is analysing your tables…" : "Loading…"} />;
  if (error) return <ErrorState message={error} />;
  if (!model) return null;

  const aiVisibleFks = (model.foreign_keys ?? []).filter((fk) => !removedFks.has(fkKey(fk)));
  const allVisibleFks = [...aiVisibleFks, ...addedFks];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Data Modeling</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI has identified fact/dimension tables and relationships. Review and adjust before continuing.
          </p>
          {model.ai_reasoning && (
            <p className="mt-2 text-xs text-gray-400 italic">{model.ai_reasoning}</p>
          )}
        </div>
        <button
          onClick={handleConfirm}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Confirm Model →"}
        </button>
      </div>

      {validation && <ValidationPanel validation={validation} className="mb-6" />}

      {/* Tables */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-gray-700">Tables</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {model.tables.map((t) => {
            const role = tableRoles[t.upload_id] ?? t.role;
            const cols = colsByUpload[t.upload_id] ?? [];
            const currentPk = pkOverrides[String(t.upload_id)] ?? "";
            return (
              <div
                key={t.upload_id}
                className={[
                  "rounded-lg border px-4 py-3 space-y-3",
                  role === "fact" ? "border-orange-200 bg-orange-50" : "border-indigo-200 bg-indigo-50",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800 truncate mr-2">{t.filename}</span>
                  <select
                    value={role}
                    onChange={(e) =>
                      setTableRoles((prev) => ({ ...prev, [t.upload_id]: e.target.value as "fact" | "dimension" }))
                    }
                    className="shrink-0 rounded border border-gray-200 bg-white px-2 py-1 text-xs"
                  >
                    <option value="fact">Fact</option>
                    <option value="dimension">Dimension</option>
                  </select>
                </div>

                <p className="text-xs text-gray-400">Confidence: {(t.confidence * 100).toFixed(0)}%</p>

                <div className="flex items-center gap-2">
                  <label className="shrink-0 text-xs font-medium text-gray-600">Primary key</label>
                  {cols.length > 0 ? (
                    <select
                      value={currentPk}
                      onChange={(e) =>
                        setPkOverrides((prev) => ({ ...prev, [String(t.upload_id)]: e.target.value }))
                      }
                      className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs min-w-0"
                    >
                      <option value="">— none —</option>
                      {cols.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-mono text-xs text-gray-500">{currentPk || "—"}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Relationships */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-700">
            Relationships
            <span className="ml-2 text-sm font-normal text-gray-400">({allVisibleFks.length})</span>
          </h2>
          <button
            onClick={openDraft}
            disabled={!model || model.tables.length < 2}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            + Add relationship
          </button>
        </div>

        <div className="space-y-2">
          {/* AI-detected FKs */}
          {aiVisibleFks.map((fk) => (
            <FkRow
              key={fkKey(fk)}
              fk={fk}
              fromFile={filenameFor(fk.from_upload_id)}
              toFile={filenameFor(fk.to_upload_id)}
              editable={false}
              onRemove={() => setRemovedFks((prev) => new Set([...prev, fkKey(fk)]))}
            />
          ))}

          {/* Manually added FKs */}
          {addedFks.map((fk, i) => (
            <FkRow
              key={`added-${i}`}
              fk={fk}
              fromFile={filenameFor(fk.from_upload_id)}
              toFile={filenameFor(fk.to_upload_id)}
              fromCols={colsByUpload[fk.from_upload_id] ?? []}
              toCols={colsByUpload[fk.to_upload_id] ?? []}
              editable={true}
              isManual={true}
              onChange={(updated) =>
                setAddedFks((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...updated } : f)))
              }
              onRemove={() => setAddedFks((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}

          {/* New FK draft */}
          {draft && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 px-4 py-3 text-sm">
              <select
                value={draft.from_upload_id}
                onChange={(e) => {
                  const uid = Number(e.target.value);
                  setDraft((d) => d ? { ...d, from_upload_id: uid, from_col: colsByUpload[uid]?.[0] ?? "" } : d);
                }}
                className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                {model.tables.map((t) => (
                  <option key={t.upload_id} value={t.upload_id}>{t.filename}</option>
                ))}
              </select>

              <select
                value={draft.from_col}
                onChange={(e) => setDraft((d) => d ? { ...d, from_col: e.target.value } : d)}
                className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                <option value="">— column —</option>
                {(colsByUpload[draft.from_upload_id] ?? []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <span className="text-gray-400 text-xs font-medium">→</span>

              <select
                value={draft.to_upload_id}
                onChange={(e) => {
                  const uid = Number(e.target.value);
                  setDraft((d) => d ? { ...d, to_upload_id: uid, to_col: colsByUpload[uid]?.[0] ?? "" } : d);
                }}
                className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                {model.tables.map((t) => (
                  <option key={t.upload_id} value={t.upload_id}>{t.filename}</option>
                ))}
              </select>

              <select
                value={draft.to_col}
                onChange={(e) => setDraft((d) => d ? { ...d, to_col: e.target.value } : d)}
                className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                <option value="">— column —</option>
                {(colsByUpload[draft.to_upload_id] ?? []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <button
                onClick={commitDraft}
                disabled={!draft.from_col || !draft.to_col || draft.from_upload_id === draft.to_upload_id}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                Add
              </button>
              <button
                onClick={() => setDraft(null)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          )}

          {allVisibleFks.length === 0 && !draft && (
            <p className="text-sm text-gray-400">
              No relationships detected. Click "Add relationship" to define one manually.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface FkRowProps {
  fk: DataModelFkEntry;
  fromFile: string;
  toFile: string;
  fromCols?: string[];
  toCols?: string[];
  editable: boolean;
  isManual?: boolean;
  onChange?: (updated: Partial<DataModelFkEntry>) => void;
  onRemove: () => void;
}

function FkRow({ fk, fromFile, toFile, fromCols, toCols, editable, isManual, onChange, onRemove }: FkRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
      <span className="text-xs font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded shrink-0">
        {fromFile}
      </span>

      {editable && fromCols?.length ? (
        <select
          value={fk.from_col}
          onChange={(e) => onChange?.({ from_col: e.target.value })}
          className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          {fromCols.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <span className="font-mono text-xs text-gray-700">{fk.from_col}</span>
      )}

      <span className="text-gray-400 text-xs font-medium shrink-0">→</span>

      <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">
        {toFile}
      </span>

      {editable && toCols?.length ? (
        <select
          value={fk.to_col}
          onChange={(e) => onChange?.({ to_col: e.target.value })}
          className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
        >
          {toCols.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <span className="font-mono text-xs text-gray-700">{fk.to_col}</span>
      )}

      <div className="ml-auto flex items-center gap-3 shrink-0">
        {fk.integrity_pct !== null && fk.integrity_pct !== undefined && (
          <span className={`text-xs ${fk.integrity_pct >= 90 ? "text-green-600" : "text-amber-600"}`}>
            {fk.integrity_pct.toFixed(0)}% match
          </span>
        )}
        {isManual ? (
          <span className="text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">manual</span>
        ) : (
          <span className="text-xs text-gray-400">{(fk.confidence * 100).toFixed(0)}% conf</span>
        )}
        <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-600">
          Remove
        </button>
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        <p className="mt-4 text-sm text-gray-500">{label}</p>
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
