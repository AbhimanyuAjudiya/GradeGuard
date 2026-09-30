import type { GradeResult } from "@/types/decision";
import { DECISION_STYLE, GATE_LABEL, HEADING, gateFlags, humanize, layaUnsure, pct } from "./decisionStyle";

function decidedBy({ decision, laya }: GradeResult): string {
  switch (decision.source) {
    case "guardrail": {
      const g = decision.flags.find((f) => f.startsWith("guardrail:"));
      return g ? `consistency check: ${humanize(g.slice("guardrail:".length))}` : "consistency check";
    }
    case "laya": {
      const choice = laya ? humanize(laya.route.choice) : "";
      const gates = gateFlags(decision.flags).map((f) => {
        const id = f.slice("gate:".length);
        return GATE_LABEL[id] ?? humanize(id);
      });
      if (gates.length) return `gates: ${gates.join(", ")}${laya ? ` (Laya chose ${choice})` : ""}`;
      if (layaUnsure(decision.flags)) return `Laya unsure (chose ${choice}), sent to a teacher`;
      return "Laya route";
    }
    case "fallback":
      return "fallback (Laya unavailable)";
    case "threshold":
      return "confidence threshold";
  }
}

function layaApproveP({ decision, laya }: GradeResult): string {
  if (decision.source === "guardrail") return "not used";
  return laya ? pct(laya.route.probabilities.auto_approve) : "unavailable";
}

export default function DecisionCard({ result }: { result: GradeResult }) {
  const { decision, laya, timing } = result;
  const s = DECISION_STYLE[decision.action];
  return (
    <section className={`rounded-xl border-2 p-5 ${s.card}`}>
      <h2 className={HEADING}>GradeGuard decision</h2>

      {laya === null && (
        <p className="mt-3 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700">
          <span className="font-semibold">Laya unavailable</span>: no decision made by Laya;{" "}
          {decision.source === "fallback" ? "fell back to human review." : "a consistency check decided."}
        </p>
      )}

      <p className={`mt-3 text-3xl font-bold uppercase tracking-tight ${s.text}`}>
        <span aria-hidden>{s.symbol}</span> {s.title}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-zinc-500">Laya P(auto-approve)</dt>
          <dd className="text-lg font-semibold tabular-nums">{layaApproveP(result)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Decided by</dt>
          <dd className="font-semibold">{decidedBy(result)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Primary reason</dt>
          <dd className="text-lg font-semibold">{humanize(decision.primaryReason)}</dd>
        </div>
      </dl>

      <p className="mt-4 text-sm leading-relaxed text-zinc-800">{decision.reason}</p>

      <p className="mt-4 text-xs tabular-nums text-zinc-500">
        grader {timing.graderMs} ms · Laya {timing.layaMs} ms · total {timing.totalMs} ms
      </p>
    </section>
  );
}
