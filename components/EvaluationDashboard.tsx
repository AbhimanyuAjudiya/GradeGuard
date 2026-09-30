import { useEffect, useState } from "react";
import { POLICY_IDS, type PolicyId } from "@/types/decision";
import type { EvalMetrics, EvalReport } from "@/types/evaluation";
import { DECISION_STYLE, HEADING, POLICY_NAME, pct } from "./decisionStyle";

const POLICY_INFO: Record<PolicyId, string> = {
  threshold_baseline: "Auto-approve above a fixed grader confidence, otherwise human review",
  rules_only: "Consistency checks and hand-written rules, no Laya",
  laya_only: "Laya's raw route, nothing around it",
  gradeguard_no_laya: "GradeGuard with Laya replaced by a constant auto-approve",
  gradeguard: "Checks, then Laya's route, then the auto-approve gates",
};

const TH = "px-2 py-2 text-left font-medium text-zinc-500 whitespace-nowrap";
const TD = "px-2 py-2 tabular-nums";

function tiles(m: EvalMetrics): Array<[string, string, boolean?]> {
  return [
    ["Total cases", String(m.total)],
    ["Routed as expected", String(m.correct)],
    ["Misrouted", String(m.incorrect), m.incorrect > 0],
    ["Accuracy", pct(m.accuracy)],
    ["Human-review precision", pct(m.humanReview.precision)],
    ["Human-review recall", pct(m.humanReview.recall)],
    ["False auto-approvals", String(m.falseAutoApprovals), m.falseAutoApprovals > 0],
    ["Unnecessary human reviews", String(m.unnecessaryHumanReviews), m.unnecessaryHumanReviews > 0],
  ];
}

export default function EvaluationDashboard({
  caseCount,
  onSelectCase,
}: {
  caseCount: number;
  onSelectCase: (id: string) => void;
}) {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function evaluate() {
    setRunning(true);
    setElapsed(0);
    setError(null);
    try {
      const res = await fetch("/api/evaluate", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Evaluation failed (HTTP ${res.status})`);
      setReport(body as EvalReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-5 rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Evaluation</h2>
          <p className="text-sm text-zinc-500">Routing decision vs. the teacher-expected outcome for every synthetic case.</p>
        </div>
        <button
          type="button"
          onClick={evaluate}
          disabled={running}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {running ? `Evaluating… ${elapsed} s` : `Run evaluation (${caseCount} cases)`}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      {report && (
        <>
          {!report.layaAvailable && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              ⚠ Laya was unavailable during this run. Laya-based policies fell back to human review, so their numbers do
              not reflect Laya.
            </p>
          )}

          <div>
            <h3 className={HEADING}>GradeGuard policy</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tiles(report.policies.gradeguard).map(([label, value, bad]) => (
                <div key={label} className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className={`text-2xl font-semibold tabular-nums ${bad ? "text-rose-700" : ""}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className={HEADING}>Policy comparison</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200">
                  <tr>
                    <th className={TH}>Policy</th>
                    <th className={TH}>Routed as expected</th>
                    <th className={TH}>Misrouted</th>
                    <th className={TH}>Accuracy</th>
                    <th className={TH}>Review precision</th>
                    <th className={TH}>Review recall</th>
                    <th className={TH}>False auto-approvals</th>
                    <th className={TH}>Unnecessary reviews</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {POLICY_IDS.map((p) => {
                    const m = report.policies[p];
                    return (
                      <tr key={p} className={p === "gradeguard" ? "bg-zinc-50 font-medium" : ""}>
                        <td className="px-2 py-2">
                          <span>{POLICY_NAME[p]}</span>
                          <span className="block text-xs font-normal text-zinc-500">{POLICY_INFO[p]}</span>
                        </td>
                        <td className={TD}>
                          {m.correct}/{m.total}
                        </td>
                        <td className={TD}>{m.incorrect}</td>
                        <td className={TD}>{pct(m.accuracy)}</td>
                        <td className={TD}>{pct(m.humanReview.precision)}</td>
                        <td className={TD}>{pct(m.humanReview.recall)}</td>
                        <td className={`${TD} ${m.falseAutoApprovals > 0 ? "text-rose-700" : ""}`}>{m.falseAutoApprovals}</td>
                        <td className={TD}>{m.unnecessaryHumanReviews}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Rules, gates and the Laya prompt were all tuned on these same {report.cases.length} synthetic cases. There is no held-out set.
            </p>
          </div>

          <div>
            <h3 className={HEADING}>Per case</h3>
            <p className="mt-1 text-xs text-zinc-500">Click a row to load that case above.</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200">
                  <tr>
                    <th className={TH}>Case</th>
                    <th className={TH}>Description</th>
                    <th className={TH}>Expected</th>
                    {POLICY_IDS.map((p) => (
                      <th key={p} className={TH}>
                        {POLICY_NAME[p]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {report.cases.map((c) => (
                    <tr key={c.caseId} onClick={() => onSelectCase(c.caseId)} className="cursor-pointer hover:bg-zinc-50">
                      <td className="px-2 py-2 whitespace-nowrap">
                        <button type="button" className="font-mono text-xs underline-offset-2 hover:underline">
                          {c.caseId}
                        </button>
                      </td>
                      <td className="px-2 py-2 min-w-48">{c.description}</td>
                      <td className={`px-2 py-2 whitespace-nowrap font-medium ${DECISION_STYLE[c.expected].text}`}>
                        {DECISION_STYLE[c.expected].title}
                      </td>
                      {POLICY_IDS.map((p) => {
                        const ok = c.correct[p];
                        return (
                          <td
                            key={p}
                            className={`px-2 py-2 whitespace-nowrap ${ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
                          >
                            {ok ? "✓" : "✗"} {DECISION_STYLE[c.decisions[p].action].title}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              {report.cases.length} cases in {(report.durationMs / 1000).toFixed(1)} s · generated{" "}
              {new Date(report.generatedAt).toLocaleTimeString()}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
