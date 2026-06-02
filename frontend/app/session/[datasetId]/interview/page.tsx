"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage, InterviewResult } from "@/lib/types";

const MAX_STEPS = 6;

function useUploadIds(datasetId: string): { uploadIds: number[]; filenames: string[] } {
  const stored = typeof window !== "undefined"
    ? sessionStorage.getItem(`dataset_${datasetId}_uploads`)
    : null;
  if (!stored) return { uploadIds: [], filenames: [] };
  const parsed: { uploadId: number; filename: string }[] = JSON.parse(stored);
  return {
    uploadIds: parsed.map((p) => p.uploadId),
    filenames: parsed.map((p) => p.filename),
  };
}

export default function InterviewPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const router = useRouter();
  const { uploadIds, filenames } = useUploadIds(datasetId);

  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<InterviewResult | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Start: fire first turn to get Q1
  useEffect(() => {
    sendTurn("", []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function sendTurn(userMessage: string, currentHistory: ChatMessage[]) {
    setSending(true);
    try {
      const res = await api.sendInterviewMessage(
        Number(datasetId),
        userMessage,
        currentHistory,
        uploadIds,
      );
      const newHistory: ChatMessage[] = [
        ...currentHistory,
        ...(userMessage ? [{ role: "user" as const, content: userMessage }] : []),
        { role: "assistant" as const, content: res.message },
      ];
      setHistory(newHistory);
      setStep(res.step_index ?? step + 1);
      if (res.completed && res.interview_result) {
        setCompleted(true);
        setResult(res.interview_result);
        sessionStorage.setItem(`dataset_${datasetId}_interview`, JSON.stringify(res.interview_result));
      }
    } catch {
      setHistory((h) => [
        ...h,
        { role: "assistant", content: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSend() {
    if (!input.trim() || sending || completed) return;
    const msg = input.trim();
    setInput("");
    sendTurn(msg, history);
  }

  async function handleSkip() {
    try {
      const result = await api.skipInterview(Number(datasetId));
      sessionStorage.setItem(`dataset_${datasetId}_interview`, JSON.stringify(result));
    } catch { /* ignore */ }
    router.push(`/session/${datasetId}/kpis`);
  }

  function handleContinue() {
    router.push(`/session/${datasetId}/kpis`);
  }

  const progressPct = Math.min(((step - 1) / (MAX_STEPS - 1)) * 100, 100);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1B2340]">Data Interview</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {filenames.length > 0 ? filenames.join(", ") : "All uploaded files"}
          </p>
        </div>
        <button
          onClick={handleSkip}
          className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
        >
          Skip Interview → KPI Selection
        </button>
      </div>

      <div className="flex-1 flex gap-0">
        {/* Chat panel */}
        <div className="flex-1 flex flex-col max-w-2xl">
          {/* Progress bar */}
          <div className="px-6 pt-4 pb-2">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Question {Math.max(step, 1)} of {MAX_STEPS}</span>
              <span>{completed ? "Complete ✓" : "In progress"}</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-500"
                style={{ width: `${completed ? 100 : progressPct}%` }}
              />
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {history.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#1B2340] text-white rounded-br-sm"
                      : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {!completed ? (
            <div className="border-t border-gray-100 px-6 py-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder="Type your answer…"
                  disabled={sending}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2340] disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="px-4 py-2.5 rounded-xl bg-[#1B2340] text-white text-sm font-medium hover:bg-[#243060] disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-teal-50">
              <span className="text-sm text-teal-700 font-medium">Interview complete!</span>
              <button
                onClick={handleContinue}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700"
              >
                Continue to KPI Selection →
              </button>
            </div>
          )}
        </div>

        {/* Side panel — detected context */}
        <div className="w-72 border-l border-gray-100 bg-gray-50 p-5 hidden lg:block">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Files</p>
          {filenames.map((f) => (
            <div key={f} className="text-xs text-gray-600 mb-1 truncate">📄 {f}</div>
          ))}
          {result && (
            <div className="mt-6 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Collected</p>
              {result.date_column && (
                <div>
                  <p className="text-xs text-gray-400">Date column</p>
                  <p className="text-xs font-mono font-medium text-gray-700">{result.date_column}</p>
                </div>
              )}
              {result.dimensions.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400">Dimensions</p>
                  <p className="text-xs font-mono text-gray-700">{result.dimensions.join(", ")}</p>
                </div>
              )}
              {result.granularity && (
                <div>
                  <p className="text-xs text-gray-400">Granularity</p>
                  <p className="text-xs font-mono text-gray-700">{result.granularity}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
