import { describe, expect, it } from "vitest";
import { computeMetrics } from "./metrics";
import type { DecisionAction, EscalationReason } from "@/types/decision";

const row = (expected: DecisionAction, predicted: DecisionAction, expectedReason: EscalationReason = "none", predictedReason: EscalationReason = "none") => ({
  expected,
  predicted,
  expectedReason,
  predictedReason,
});

describe("computeMetrics", () => {
  it("matches hand-computed values on a mixed 8-row set", () => {
    const m = computeMetrics([
      row("auto_approve", "auto_approve"),
      row("auto_approve", "human_review"), // unnecessary review, HR FP, escalation FP
      row("human_review", "human_review", "low_confidence", "low_confidence"), // HR TP; reason right
      row("human_review", "auto_approve"), // false auto-approval, HR FN
      row("regrade", "regrade", "possible_grading_error", "grade_reasoning_conflict"), // reason wrong
      row("regrade", "human_review", "possible_grading_error", "possible_grading_error"), // HR FP, still a correct escalation; wrong action, so not in reasonAccuracy
      row("flag_ambiguous", "auto_approve"), // false auto-approval
      row("flag_ambiguous", "flag_ambiguous", "insufficient_evidence", "insufficient_evidence"), // reason right
    ]);

    expect(m).toMatchObject({ total: 8, correct: 4, incorrect: 4, accuracy: 0.5 });
    expect(m.humanReview).toEqual({
      precision: 1 / 3,
      recall: 1 / 2,
      truePositives: 1,
      falsePositives: 2,
      falseNegatives: 1,
    });
    // escalated expected: rows 3-8 (6); escalated predicted: rows 2,3,5,6,8 (5); both: 3,5,6,8 (4)
    expect(m.escalation.precision).toBeCloseTo(4 / 5);
    expect(m.escalation.recall).toBeCloseTo(4 / 6);
    expect(m.falseAutoApprovals).toBe(2);
    expect(m.unnecessaryHumanReviews).toBe(1);
    // right escalation action: rows 3, 5, 8; right reason among them: 3, 8
    expect(m.reasonAccuracy).toEqual({ correct: 2, total: 3, value: 2 / 3 });
    expect(m.confusion).toEqual({
      auto_approve: { auto_approve: 1, human_review: 1, regrade: 0, flag_ambiguous: 0 },
      human_review: { auto_approve: 1, human_review: 1, regrade: 0, flag_ambiguous: 0 },
      regrade: { auto_approve: 0, human_review: 1, regrade: 1, flag_ambiguous: 0 },
      flag_ambiguous: { auto_approve: 1, human_review: 0, regrade: 0, flag_ambiguous: 1 },
    });
  });

  it("reports 0/0 precision and recall as 0", () => {
    const m = computeMetrics([row("auto_approve", "auto_approve"), row("auto_approve", "auto_approve")]);
    expect(m.accuracy).toBe(1);
    expect(m.humanReview).toMatchObject({ precision: 0, recall: 0 });
    expect(m.escalation).toEqual({ precision: 0, recall: 0 });
    expect(m.falseAutoApprovals).toBe(0);
    expect(m.reasonAccuracy).toEqual({ correct: 0, total: 0, value: 0 }); // auto_approve rows never count
  });

  it("handles an empty set with a zeroed 4x4 confusion matrix", () => {
    const m = computeMetrics([]);
    expect(m).toMatchObject({ total: 0, correct: 0, incorrect: 0, accuracy: 0, reasonAccuracy: { correct: 0, total: 0, value: 0 } });
    const cells = Object.values(m.confusion).flatMap((r) => Object.values(r));
    expect(cells).toEqual(Array(16).fill(0));
  });
});
