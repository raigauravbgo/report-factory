"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { ChatMessage, InterviewResult } from "@/lib/types";

const STEP_LABELS = [
  "Date column",
  "KPI definitions",
  "Dimensions",
  "Time granularity",
  "Filters",
];

export default function InterviewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const uploadId = Number(params.get("uploadId"));

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [stepIndex, setStepIndex] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [interviewResult, setInterviewResult] = useState<InterviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Kick off the interview on mount
  useEffect(() => {
    if (!uploadId) return;
    send("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(userMessage: string) {
    if (loading) return;
    setLoading(true);
    setError(null);

    const newHistory: ChatMessage[] = userMessage
      ? [...messages, { role: "user", content: userMessage }]
      : messages;

    if (userMessage) setMessages(newHistory);

    try {
      const res = await api.sendInterviewMessage(uploadId, userMessage, newHistory);
      setMessages([...newHistory, { role: "assistant", content: res.message }]);
      setStepIndex(res.step_index);
      if (res.completed && res.interview_result) {
        setDone(true);
        setInterviewResult(res.interview_result);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    await send(msg);
  }

  async function handleGenerateRecipe() {
    if (!interviewResult) return;
    setSaving(true);
    setError(null);
    try {
      const recipe = await api.createRecipe(uploadId, interviewResult);
      router.push(`/recipe/${recipe.id}`);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  if (!uploadId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-red-600">Missing upload ID. Go back and upload a file.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Report interview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Answer a few questions to configure your dashboard.
        </p>
      </div>

      {/* Step progress */}
      <ol className="flex gap-1">
        {STEP_LABELS.map((label, i) => {
          const idx = i + 1;
          const active = idx === stepIndex;
          const done_ = idx < stepIndex || done;
          return (
            <li key={label} className="flex-1 text-center">
              <div
                className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  done_
                    ? "bg-blue-600 text-white"
                    : active
                    ? "border-2 border-blue-600 text-blue-600"
                    : "border border-gray-300 text-gray-400"
                }`}
              >
                {done_ ? "✓" : idx}
              </div>
              <span
                className={`text-xs ${active ? "font-medium text-blue-600" : "text-gray-400"}`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Chat window */}
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 min-h-80 max-h-[28rem] overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "assistant"
                ? "self-start bg-white border border-gray-200 text-gray-800"
                : "self-end bg-blue-600 text-white"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="self-start flex items-center gap-2 text-sm text-gray-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      {done ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-green-700 flex-1">
            All done! Ready to generate your report recipe.
          </p>
          <button
            onClick={handleGenerateRecipe}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Generate recipe →"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Type your answer…"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </main>
  );
}
