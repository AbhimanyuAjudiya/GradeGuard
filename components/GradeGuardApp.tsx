"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { GradeResult, LayaStatus } from "@/types/decision";
import DecisionCard from "./DecisionCard";
import DecisionDetails from "./DecisionDetails";
import EvaluationDashboard from "./EvaluationDashboard";
import GradingResult from "./GradingResult";
import Pipeline from "./Pipeline";
import SubmissionSelector, { type CaseSummary } from "./SubmissionSelector";

function statusView(s: LayaStatus | null): { text: string; dot: string } {
  switch (s?.state) {
    case undefined:
      return { text: "Checking Laya…", dot: "bg-zinc-300" };
    case "not_downloaded":
    case "downloading": // the server never downloads; the bundle comes from `pnpm laya:download`
      return { text: "Laya model not downloaded (1.6 GB): run pnpm laya:download", dot: "bg-zinc-400" };
    case "idle":
    case "loading":
      return { text: "Loading Laya model…", dot: "bg-blue-500 animate-pulse" };
    case "ready":
      return { text: `Laya ready · loaded in ${(s.loadMs / 1000).toFixed(1)} s`, dot: "bg-emerald-500" };
    case "error":
      return { text: `Laya error: ${s.message}`, dot: "bg-rose-500" };
  }
}

export default function GradeGuardApp({ cases }: { cases: CaseSummary[] }) {
  const [selectedId, setSelectedId] = useState(cases[0]?.id ?? "");
  const [result, setResult] = useState<GradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LayaStatus | null>(null);
  const latestRun = useRef(0);

  // Show a decision on load: run the first case once Laya is ready, unless the user already ran one.
  const autoRun = useEffectEvent(() => {
    if (latestRun.current === 0 && cases[0]) run(cases[0].id);
  });

  // Poll every 2 s until the model is ready (loading the bundle takes a few seconds).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    async function poll() {
      let next: LayaStatus;
      try {
        const res = await fetch("/api/laya/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        next = (await res.json()) as LayaStatus;
      } catch (e) {
        next = { state: "error", message: `status check failed (${e instanceof Error ? e.message : String(e)})` };
      }
      if (stopped) return;
      setStatus(next);
      if (next.state === "ready") autoRun();
      else timer = setTimeout(poll, 2000);
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  async function run(id: string) {
    const runId = ++latestRun.current; // a newer run supersedes this one
    setSelectedId(id);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Grading failed (HTTP ${res.status})`);
      if (runId === latestRun.current) setResult(body as GradeResult);
    } catch (e) {
      if (runId === latestRun.current) {
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (runId === latestRun.current) setLoading(false);
    }
  }

  const view = statusView(status);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">GradeGuard</h1>
          <p className="text-sm text-zinc-500">Decision layer for an AI math grader</p>
        </div>
        <p
          aria-live="polite"
          className="flex max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700"
        >
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${view.dot}`} />
          <span className="min-w-0 break-words">{view.text}</span>
        </p>
      </header>

      <Pipeline decision={result?.decision ?? null} layaUnavailable={result !== null && result.laya === null} />

      <SubmissionSelector
        cases={cases}
        selectedId={selectedId}
        loading={loading}
        hasResult={result?.submission.id === selectedId}
        layaReady={status?.state === "ready"}
        onSelect={run}
        onRun={() => run(selectedId)}
      />

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {result ? (
        <div className={`grid grid-cols-1 gap-6 lg:grid-cols-2 ${loading ? "opacity-50" : ""}`}>
          <GradingResult result={result} />
          <div className="space-y-6">
            <DecisionCard result={result} />
            <DecisionDetails result={result} />
          </div>
        </div>
      ) : (
        !error && (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
            {loading ? "Running grader → Laya…" : "Pick a synthetic submission and press Run to see the AI grade and GradeGuard's decision."}
          </p>
        )
      )}

      <EvaluationDashboard
        caseCount={cases.length}
        onSelectCase={(id) => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          run(id);
        }}
      />
    </main>
  );
}
