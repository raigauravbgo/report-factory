"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "@/lib/api";
import { logEvent } from "@/lib/logger";
import type { ChatMessage, InterviewResult } from "@/lib/types";

const MAX_STEPS = 6;

function useUploadIds(datasetId: string): { uploadIds: number[]; filenames: string[] } {
  // Start empty so server and client produce identical initial HTML (no hydration mismatch).
  // sessionStorage is client-only; reading it during render causes server/client divergence.
  const [state, setState] = useState<{ uploadIds: number[]; filenames: string[] }>({
    uploadIds: [],
    filenames: [],
  });

  useEffect(() => {
    const stored = sessionStorage.getItem(`dataset_${datasetId}_uploads`);
    if (!stored) return;
    try {
      const parsed: { uploadId: number; filename: string }[] = JSON.parse(stored);
      setState({
        uploadIds: parsed.map((p) => p.uploadId),
        filenames: parsed.map((p) => p.filename),
      });
    } catch {
      // ignore corrupted sessionStorage
    }
  }, [datasetId]);

  return state;
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
  // ADK session flow: locked on first turn — stays true even if later turns fall back to Flow 1
  const [isAdkMode, setIsAdkMode] = useState(false);
  // ADK session flow: set when the agent has generated a dashboard directly
  const [adkRecipeId, setAdkRecipeId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // H16: Prevent effect from re-firing on page re-visit (React StrictMode runs effects twice)
  const initializedRef = useRef(false);

  // Start: fire first turn to get Q1.
  // Read upload IDs directly from sessionStorage here — the useUploadIds hook
  // populates state in its own useEffect which races with this one on mount.
  // Relying on `uploadIds` state would always send an empty list on the first turn.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let initialUploadIds: number[] = [];
    try {
      const stored = sessionStorage.getItem(`dataset_${datasetId}_uploads`);
      if (stored) {
        const parsed: { uploadId: number; filename: string }[] = JSON.parse(stored);
        initialUploadIds = parsed.map((p) => p.uploadId);
      }
    } catch { /* ignore corrupted sessionStorage */ }
    sendTurn("", [], initialUploadIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // M9: Check ref is still mounted before scrolling
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history]);

  async function sendTurn(userMessage: string, currentHistory: ChatMessage[], overrideUploadIds?: number[]) {
    setSending(true);
    try {
      const res = await api.sendInterviewMessage(
        Number(datasetId),
        userMessage,
        currentHistory,
        overrideUploadIds ?? uploadIds,
      );
      const newHistory: ChatMessage[] = [
        ...currentHistory,
        ...(userMessage ? [{ role: "user" as const, content: userMessage }] : []),
        { role: "assistant" as const, content: res.message },
      ];
      setHistory(newHistory);
      // Lock ADK mode on first response — prevents UI from flipping if a later turn falls back
      if (res.is_adk_mode) setIsAdkMode(true);
      // H12: Use functional update to avoid stale closure on fallback increment
      setStep((prev) => res.step_index ?? prev + 1);
      if (res.completed && res.interview_result) {
        // ADK session flow: backend detected that run_session_generate was called.
        // Show a "View Dashboard" button — do NOT auto-redirect so the user can
        // still read the agent's final message.
        const recipeId = (res.interview_result as unknown as Record<string, unknown>).recipe_id;
        if (typeof recipeId === "number") {
          setCompleted(true);
          setAdkRecipeId(recipeId);
          logEvent("adk_session_dashboard_generated", "interview", {
            recipe_id: recipeId,
            total_turns: newHistory.filter((m) => m.role === "user").length,
          }, { datasetId: Number(datasetId) });
          return;
        }

        // Flow 1: store result so KPI/Dimensions pages can read it from sessionStorage.
        setCompleted(true);
        setResult(res.interview_result);
        sessionStorage.setItem(`dataset_${datasetId}_interview`, JSON.stringify(res.interview_result));
        logEvent("interview_completed", "interview", {
          total_turns: newHistory.filter((m) => m.role === "user").length,
          date_column: res.interview_result.date_column,
          dimensions: res.interview_result.dimensions,
          granularity: res.interview_result.granularity,
        }, { datasetId: Number(datasetId) });
      } else if (userMessage) {
        logEvent("interview_message_sent", "interview", {
          step: res.step_index,
          message_length: userMessage.length,
          message_preview: userMessage.slice(0, 100),
        }, { datasetId: Number(datasetId) });
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
    logEvent("interview_skipped", "interview", {}, { datasetId: Number(datasetId) });
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
          <h1 className="text-lg font-bold text-[#1B2340]">
            {isAdkMode ? "AI-Guided Dashboard Setup" : "Data Interview"}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {filenames.length > 0 ? filenames.join(", ") : "All uploaded files"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdkMode && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              AI Agent active
            </span>
          )}
          {!isAdkMode && (
            <button
              onClick={handleSkip}
              className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
            >
              Skip Interview → KPI Selection
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex gap-0">
        {/* Chat panel */}
        <div className="flex-1 flex flex-col max-w-2xl">
          {/* Progress indicator */}
          <div className="px-6 pt-4 pb-2">
            {isAdkMode ? (
              <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                <span className="text-indigo-600 font-medium">
                  {completed ? "Session complete" : "AI agent is guiding you through the setup"}
                </span>
                <span>{completed ? "Complete ✓" : "In progress"}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                <span>Question {Math.max(step, 1)} of {MAX_STEPS}</span>
                <span>{completed ? "Complete ✓" : "In progress"}</span>
              </div>
            )}
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              {isAdkMode ? (
                /* Indeterminate pulse for ADK — agent controls the flow, not a fixed step count */
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    completed ? "bg-indigo-500 w-full" : "bg-indigo-400 w-1/3 animate-pulse"
                  }`}
                />
              ) : (
                <div
                  className="h-full rounded-full bg-teal-500 transition-all duration-500"
                  style={{ width: `${completed ? 100 : progressPct}%` }}
                />
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {history.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "max-w-sm bg-[#1B2340] text-white rounded-br-sm"
                      : isAdkMode
                        ? "max-w-lg bg-gray-100 text-gray-800 rounded-bl-sm"
                        : "max-w-sm bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        code: ({ children }) => <code className="bg-gray-200 rounded px-1 font-mono text-xs">{children}</code>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
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

          {/* Input / completion footer */}
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
          ) : adkRecipeId !== null ? (
            /* ADK session flow — dashboard was generated inside the chat */
            <div className="border-t border-[#1B2340]/20 px-6 py-4 bg-[#1B2340]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Dashboard ready</p>
                  <p className="text-xs text-white/60 mt-0.5">
                    Recipe #{adkRecipeId} · generated by AI agent
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/dashboard/${adkRecipeId}`)}
                  className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#1B2340] text-sm font-bold hover:bg-white/90 transition-colors shadow-sm"
                >
                  View Dashboard
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            /* Flow 1 — interview collected context, continue to wizard */
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
