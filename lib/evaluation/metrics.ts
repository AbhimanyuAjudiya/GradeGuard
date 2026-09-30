import { DECISION_ACTIONS, type DecisionAction, type EscalationReason } from "@/types/decision";
import type { EvalMetrics } from "@/types/evaluation";

type Row = { expected: DecisionAction; predicted: DecisionAction; expectedReason: EscalationReason; predictedReason: EscalationReason };

// 0/0 is reported as 0: with no positives (or no positive predictions) there is nothing to credit.
const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);
const escalated = (a: DecisionAction) => a !== "auto_approve";

export function computeMetrics(rows: Row[]): EvalMetrics {
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const isHr = (a: DecisionAction) => a === "human_review";

  const correct = count((r) => r.expected === r.predicted);
  const truePositives = count((r) => isHr(r.expected) && isHr(r.predicted));
  const falsePositives = count((r) => !isHr(r.expected) && isHr(r.predicted));
  const falseNegatives = count((r) => isHr(r.expected) && !isHr(r.predicted));
  const escTp = count((r) => escalated(r.expected) && escalated(r.predicted));
  const escFp = count((r) => !escalated(r.expected) && escalated(r.predicted));
  const falseAutoApprovals = count((r) => escalated(r.expected) && !escalated(r.predicted));
  // reasonAccuracy: among escalations routed to the expected action, how often the stated reason is the expected one.
  const reasonTotal = count((r) => escalated(r.expected) && r.expected === r.predicted);
  const reasonCorrect = count((r) => escalated(r.expected) && r.expected === r.predicted && r.expectedReason === r.predictedReason);

  const confusion = Object.fromEntries(
    DECISION_ACTIONS.map((e) => [e, Object.fromEntries(DECISION_ACTIONS.map((p) => [p, 0]))]),
  ) as EvalMetrics["confusion"];
  for (const r of rows) confusion[r.expected][r.predicted]++;

  return {
    total: rows.length,
    correct,
    incorrect: rows.length - correct,
    accuracy: ratio(correct, rows.length),
    humanReview: {
      precision: ratio(truePositives, truePositives + falsePositives),
      recall: ratio(truePositives, truePositives + falseNegatives),
      truePositives,
      falsePositives,
      falseNegatives,
    },
    escalation: {
      precision: ratio(escTp, escTp + escFp),
      recall: ratio(escTp, escTp + falseAutoApprovals),
    },
    falseAutoApprovals,
    unnecessaryHumanReviews: count((r) => r.expected === "auto_approve" && isHr(r.predicted)),
    reasonAccuracy: { correct: reasonCorrect, total: reasonTotal, value: ratio(reasonCorrect, reasonTotal) },
    confusion,
  };
}
