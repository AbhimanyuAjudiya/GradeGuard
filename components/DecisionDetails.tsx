import { DECISION_ACTIONS, POLICY_IDS, type DecisionSignals, type GradeResult } from "@/types/decision";
import { DECISION_STYLE, HEADING, POLICY_NAME, humanize, pct } from "./decisionStyle";

const SIGNAL_LABELS: Record<keyof DecisionSignals, string> = {
  aiConfidence: "Grader confidence",
  confidenceBand: "Confidence band",
  answerCorrectness: "Answer correctness",
  finalAnswerMatchesExpected: "Final answer matches expected",
  gradeConsistentWithAnswer: "Grade consistent with answer",
  scoreConsistentWithRubric: "Score consistent with rubric",
  reasoningQuality: "Reasoning quality",
  workCompleteness: "Work completeness",
  ambiguity: "Ambiguity",
  transcriptionRisk: "Transcription risk",
  partialCredit: "Partial credit",
  alternativeSolutionPath: "Alternative solution path",
  detectedIssues: "Detected issues",
  firstErrorStep: "First error step",
  misconception: "Misconception",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "number") return v.toFixed(2);
  if (Array.isArray(v)) return v.length ? v.map(String).map(humanize).join(", ") : "none";
  return humanize(String(v));
}

const TH = "px-2 py-1.5 text-left font-medium text-zinc-500";
const TD = "px-2 py-1.5";

export default function DecisionDetails({ result }: { result: GradeResult }) {
  const { signals, layaState, laya, alternatives } = result;
  const topReasons = laya
    ? Object.entries(laya.reason.probabilities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
    : [];

  return (
    <section className="space-y-5 rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="text-base font-semibold">Decision details</h2>

      <div>
        <h3 className={HEADING}>Deterministic signals</h3>
        <table className="mt-2 w-full text-sm">
          <tbody className="divide-y divide-zinc-100">
            {(Object.keys(SIGNAL_LABELS) as (keyof DecisionSignals)[]).map((k) => (
              <tr key={k}>
                <td className="py-1 pr-3 text-zinc-500">{SIGNAL_LABELS[k]}</td>
                <td className="py-1 font-mono text-xs text-zinc-900">{fmt(signals[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className={HEADING}>State sent to Laya</h3>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed">
          {JSON.stringify(layaState, null, 2)}
        </pre>
      </div>

      <div>
        <h3 className={HEADING}>Laya answers</h3>
        {laya ? (
          <div className="mt-2 space-y-3 text-sm">
            <div className="space-y-1.5">
              <p className="text-zinc-500">Route</p>
              {DECISION_ACTIONS.map((a) => {
                const p = laya.route.probabilities[a] ?? 0;
                const chosen = a === laya.route.choice;
                return (
                  <div key={a} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-xs">
                    <span className={chosen ? "font-semibold text-zinc-900" : "text-zinc-500"}>{DECISION_STYLE[a].title}</span>
                    <div className="h-2 rounded bg-zinc-100">
                      <div className={`h-2 rounded ${chosen ? DECISION_STYLE[a].bar : "bg-zinc-300"}`} style={{ width: pct(p) }} />
                    </div>
                    <span className={`text-right tabular-nums ${chosen ? "font-semibold" : "text-zinc-500"}`}>{p.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <dt className="text-zinc-500">Accept P</dt>
                <dd className="font-mono">{laya.accept.probability.toFixed(2)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-zinc-500">Reason</dt>
                <dd>
                  <span className="font-semibold">{humanize(laya.reason.choice)}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {topReasons.map(([r, p]) => `${humanize(r)} ${p.toFixed(2)}`).join(" · ")}
                  </span>
                </dd>
              </div>
            </dl>
            <p className="text-xs tabular-nums text-zinc-500">
              model {laya.model} · {laya.inputTokens} input tokens · {laya.latencyMs} ms
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">Laya was unavailable, so there are no Laya answers for this submission.</p>
        )}
      </div>

      <div>
        <h3 className={HEADING}>All policies on this submission</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200">
              <tr>
                <th className={TH}>Policy</th>
                <th className={TH}>Action</th>
                <th className={TH}>Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {POLICY_IDS.map((p) => {
                const d = alternatives[p];
                return (
                  <tr key={p} className={p === "gradeguard" ? "bg-zinc-50 font-medium" : ""}>
                    <td className={TD}>{POLICY_NAME[p]}</td>
                    <td className={`${TD} ${DECISION_STYLE[d.action].text}`}>
                      {DECISION_STYLE[d.action].symbol} {DECISION_STYLE[d.action].title}
                    </td>
                    <td className={`${TD} text-zinc-500`}>{d.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
