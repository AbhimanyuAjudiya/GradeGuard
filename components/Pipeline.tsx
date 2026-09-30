import { DECISION_ACTIONS, type Decision } from "@/types/decision";
import { DECISION_STYLE, gateFlags, layaUnsure } from "./decisionStyle";

const STAGES = ["Submission", "AI grader", "Consistency checks", "Laya", "Gates", "Decision"];

function decidingStage(d: Decision | null): string | null {
  if (d === null) return null;
  if (d.source === "guardrail") return "Consistency checks";
  if (gateFlags(d.flags).length > 0 || layaUnsure(d.flags)) return "Gates";
  return d.source === "laya" ? "Laya" : null;
}

export default function Pipeline({ decision, layaUnavailable }: { decision: Decision | null; layaUnavailable: boolean }) {
  const decidedBy = decidingStage(decision);
  return (
    <section aria-label="Decision pipeline" className="rounded-xl border border-zinc-200 bg-white p-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STAGES.map((stage) => (
          <li key={stage} className="flex items-center gap-2">
            <span
              aria-current={stage === decidedBy ? "step" : undefined}
              className={`rounded-lg border px-3 py-1.5 font-medium ${
                stage === decidedBy ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-700"
              } ${stage === "Laya" && layaUnavailable ? "border-dashed text-zinc-500 line-through" : ""}`}
            >
              {stage}
            </span>
            <span aria-hidden className="text-zinc-400">
              →
            </span>
          </li>
        ))}
        <li className="flex flex-wrap gap-1.5">
          {DECISION_ACTIONS.map((a) => {
            const s = DECISION_STYLE[a];
            const active = a === decision?.action;
            return (
              <span
                key={a}
                aria-current={active ? "true" : undefined}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                  active ? s.solid : "border-zinc-200 text-zinc-500"
                }`}
              >
                <span aria-hidden>{s.symbol}</span> {s.title}
              </span>
            );
          })}
        </li>
      </ol>
    </section>
  );
}
