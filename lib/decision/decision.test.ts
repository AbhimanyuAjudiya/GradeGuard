import { describe, expect, it } from "vitest";
import { DECISION_ACTIONS, POLICY_IDS, type DecisionAction, type DecisionSignals, type LayaAnswers } from "@/types/decision";
import { CASES } from "@/lib/evaluation/cases";
import { mockGrade } from "@/lib/grader/mockGrader";
import { THRESHOLDS, decide, decideAll } from "./decision";
import { deriveSignals } from "./signals";

const clean: DecisionSignals = {
  aiConfidence: 0.95,
  confidenceBand: "high",
  answerCorrectness: "correct",
  finalAnswerMatchesExpected: true,
  gradeConsistentWithAnswer: true,
  scoreConsistentWithRubric: true,
  reasoningQuality: "high",
  workCompleteness: "complete",
  ambiguity: "low",
  transcriptionRisk: "none",
  partialCredit: false,
  alternativeSolutionPath: false,
  detectedIssues: [],
  firstErrorStep: null,
  misconception: null,
};
const sig = (over: Partial<DecisionSignals>): DecisionSignals => ({ ...clean, ...over });

/** Fake Laya answers: `route` is the chosen action and its probability; the rest is spread evenly. */
function laya(route: DecisionAction, p: number, over: { accept?: number } = {}): LayaAnswers {
  const rest = (1 - p) / (DECISION_ACTIONS.length - 1);
  const probabilities = Object.fromEntries(DECISION_ACTIONS.map((a) => [a, a === route ? p : rest])) as Record<DecisionAction, number>;
  return {
    route: { choice: route, probabilities },
    accept: { probability: over.accept ?? 0.7 },
    reason: { choice: "none", probabilities: {} as LayaAnswers["reason"]["probabilities"] },
    model: "laya",
    inputTokens: 600,
    latencyMs: 500,
  };
}
const approve = laya("auto_approve", 0.8);
const gg = (s: DecisionSignals, l: LayaAnswers | null = approve) => decide(s, l, "gradeguard");

describe("laya === null", () => {
  it.each(["gradeguard", "laya_only"] as const)("%s falls back to human review without inventing a Laya answer", (policy) => {
    const d = decide(clean, null, policy);
    expect(d).toMatchObject({ action: "human_review", primaryReason: "laya_unavailable", source: "fallback", confidence: 0, flags: ["laya_unavailable"], policy });
    expect(d.reason).toBe("Laya was unavailable and no guardrail applied, so the grade defaults to human review.");
  });
  it("gradeguard still runs the guardrails first", () => {
    expect(gg(sig({ scoreConsistentWithRubric: false }), null)).toMatchObject({ action: "regrade", primaryReason: "possible_grading_error", source: "guardrail", confidence: 1 });
    expect(gg(sig({ transcriptionRisk: "likely" }), null)).toMatchObject({ action: "flag_ambiguous", source: "guardrail" });
  });
  it("still decides the Laya-free policies", () => {
    const all = decideAll(clean, null);
    expect(all.rules_only.action).toBe("auto_approve");
    expect(all.threshold_baseline.action).toBe("auto_approve");
    expect(all.gradeguard_no_laya.action).toBe("auto_approve");
  });
});

describe("gradeguard_no_laya (ablation)", () => {
  const ab = (s: DecisionSignals) => decide(s, null, "gradeguard_no_laya");
  it("is gradeguard with Laya pinned to auto_approve at p 1, accept 1", () => {
    expect(ab(clean)).toMatchObject({ action: "auto_approve", primaryReason: "none", source: "guardrail", confidence: 1, policy: "gradeguard_no_laya" });
    expect(ab(clean).reason).toContain("The constant stand-in for Laya agrees");
    // ignores the real Laya answer entirely
    expect(decide(clean, laya("regrade", 0.9), "gradeguard_no_laya").action).toBe("auto_approve");
  });
  it("keeps the guardrails and the non-Laya gates", () => {
    expect(ab(sig({ gradeConsistentWithAnswer: false }))).toMatchObject({ action: "regrade", source: "guardrail", policy: "gradeguard_no_laya" });
    expect(ab(sig({ workCompleteness: "minimal" }))).toMatchObject({ action: "human_review", primaryReason: "incomplete_work" });
    const d = ab(sig({ aiConfidence: 0.7, confidenceBand: "medium" }));
    expect(d).toMatchObject({ action: "human_review", primaryReason: "low_confidence", confidence: 1 });
    expect(d.flags).toEqual(["laya_reason:none", "gate:ai_confidence"]);
  });
});

describe("gradeguard hard guardrails override Laya", () => {
  it.each([
    ["no work", sig({ workCompleteness: "none" }), "flag_ambiguous", "insufficient_evidence"],
    ["blank", sig({ detectedIssues: ["blank"] }), "flag_ambiguous", "insufficient_evidence"],
    ["off task", sig({ detectedIssues: ["off_task"] }), "flag_ambiguous", "insufficient_evidence"],
    ["likely transcription error", sig({ transcriptionRisk: "likely" }), "flag_ambiguous", "transcription_issue"],
    ["grade contradicts answer", sig({ gradeConsistentWithAnswer: false, finalAnswerMatchesExpected: false }), "regrade", "grade_reasoning_conflict"],
    ["score contradicts rubric", sig({ scoreConsistentWithRubric: false }), "regrade", "possible_grading_error"],
  ] as const)("%s", (_, s, action, primaryReason) => {
    for (const policy of ["gradeguard", "rules_only"] as const) {
      expect(decide(s, approve, policy)).toMatchObject({ action, primaryReason, source: "guardrail", confidence: 1 });
    }
  });
  it("applies them in order: no work beats every other guardrail", () => {
    const s = sig({ workCompleteness: "none", transcriptionRisk: "likely", gradeConsistentWithAnswer: false, scoreConsistentWithRubric: false });
    expect(gg(s).primaryReason).toBe("insufficient_evidence");
    expect(gg(sig({ transcriptionRisk: "likely", gradeConsistentWithAnswer: false })).primaryReason).toBe("transcription_issue");
    expect(gg(sig({ gradeConsistentWithAnswer: false, scoreConsistentWithRubric: false })).primaryReason).toBe("grade_reasoning_conflict");
  });
});

describe("gradeguard auto-approve gate", () => {
  it("approves when Laya, its accept answer and the grader all clear the gate", () => {
    expect(gg(clean)).toMatchObject({ action: "auto_approve", primaryReason: "none", source: "laya", confidence: 0.8 });
  });
  it.each([
    ["route_p", sig({}), laya("auto_approve", THRESHOLDS.autoApproveRouteP - 0.01)],
    ["accept_p", sig({}), laya("auto_approve", 0.8, { accept: THRESHOLDS.autoApproveAcceptP - 0.01 })],
    ["ai_confidence", sig({ aiConfidence: THRESHOLDS.autoApproveAiConfidence - 0.01 }), approve],
  ] as const)("fails on %s", (gate, s, l) => {
    const d = gg(s, l);
    expect(d).toMatchObject({ action: "human_review", primaryReason: "low_confidence", source: "laya" });
    expect(d.flags).toContain(`gate:${gate}`);
    expect(d.confidence).toBe(1 - l.route.probabilities.auto_approve);
  });
  it("names every failing gate with its value and threshold", () => {
    const d = gg(sig({ aiConfidence: 0.68 }), laya("auto_approve", 0.446, { accept: 0.48 }));
    expect(d.flags).toEqual(expect.arrayContaining(["gate:route_p", "gate:accept_p", "gate:ai_confidence"]));
    expect(d.reason).toBe(
      "Laya leaned to auto-approve, but Laya's P(auto_approve) 0.446 is below the 0.45 gate and accept P 0.480 is below 0.5 and grader confidence 0.68 is below 0.8.",
    );
  });
  it("takes the reason from a matching soft rule when a gate fails", () => {
    const d = gg(sig({ aiConfidence: 0.68, confidenceBand: "medium", alternativeSolutionPath: true }));
    expect(d).toMatchObject({ action: "human_review", primaryReason: "unusual_solution_path", source: "laya" });
    expect(d.reason).toBe(
      "The student used a non-reference method and the grader's confidence is only 0.68. Laya leaned to auto-approve, but grader confidence 0.68 is below 0.8.",
    );
  });
  it("sends minimal work to a teacher even when every numeric gate passes (show your work)", () => {
    const d = gg(sig({ workCompleteness: "minimal", answerCorrectness: "partially_correct" }));
    expect(d).toMatchObject({ action: "human_review", primaryReason: "incomplete_work", source: "laya" });
    expect(d.flags).toContain("gate:work_shown");
    expect(d.reason).toBe("The answer may be right, but almost no work is shown, so credit for the steps is the teacher's call.");
    expect(d.confidence).toBeCloseTo(0.2); // 1 - P(auto_approve)
  });
  it("passes exactly at the thresholds", () => {
    const s = sig({ aiConfidence: THRESHOLDS.autoApproveAiConfidence });
    expect(gg(s, laya("auto_approve", THRESHOLDS.autoApproveRouteP, { accept: THRESHOLDS.autoApproveAcceptP })).action).toBe("auto_approve");
  });
});

describe("gradeguard escalations chosen by Laya", () => {
  it("sends a low-probability choice to human review", () => {
    const d = gg(sig({ ambiguity: "medium" }), laya("flag_ambiguous", THRESHOLDS.minRouteP - 0.01));
    expect(d).toMatchObject({ action: "human_review", primaryReason: "low_confidence" });
    expect(d.flags).toContain("laya_unsure");
  });
  it("keeps a corroborated flag_ambiguous and explains it from the signals", () => {
    const d = gg(sig({ ambiguity: "medium", aiConfidence: 0.62, confidenceBand: "medium", detectedIssues: ["unclear_reasoning"] }), laya("flag_ambiguous", 0.7));
    expect(d).toMatchObject({ action: "flag_ambiguous", primaryReason: "ambiguous_reasoning", source: "laya" });
    expect(d.confidence).toBeCloseTo(0.9); // 1 - P(auto_approve) = 1 - 0.1
    expect(d.flags).toContain("laya_reason:none");
  });
  it("reports 1 - P(auto_approve) as the confidence of every Laya escalation", () => {
    const l = { ...laya("human_review", 0.5), route: { choice: "human_review" as const, probabilities: { auto_approve: 0.3, human_review: 0.5, regrade: 0.15, flag_ambiguous: 0.05 } } };
    expect(gg(clean, l).confidence).toBeCloseTo(0.7);
    expect(decide(clean, l, "laya_only").confidence).toBe(0.5); // laya_only keeps p[choice]
  });
  it("turns an uncorroborated flag_ambiguous into human review", () => {
    const d = gg(clean, laya("flag_ambiguous", 0.6));
    expect(d.action).toBe("human_review");
    expect(d.flags).toContain("flag_uncorroborated");
  });
  it("turns a regrade into human review when the grade-vs-answer and score-vs-rubric guardrails found no contradiction", () => {
    const d = gg(sig({ aiConfidence: 0.7, confidenceBand: "medium", detectedIssues: ["error_propagation"] }), laya("regrade", 0.5));
    expect(d).toMatchObject({ action: "human_review", primaryReason: "possible_grading_error" });
    expect(d.flags).toContain("regrade_uncorroborated");
  });
  it("prefers a deterministic reason and falls back to Laya's reason", () => {
    expect(gg(sig({ alternativeSolutionPath: true, aiConfidence: 0.55, confidenceBand: "low" }), laya("human_review", 0.5)).primaryReason).toBe("unusual_solution_path");
    const withReason = { ...laya("human_review", 0.5), reason: { ...approve.reason, choice: "incomplete_work" as const } };
    expect(gg(clean, withReason).primaryReason).toBe("incomplete_work");
    expect(gg(clean, laya("human_review", 0.5)).primaryReason).toBe("possible_grading_error"); // Laya said "none"
    const refuted = { ...laya("regrade", 0.5), reason: { ...approve.reason, choice: "grade_reasoning_conflict" as const } };
    expect(gg(clean, refuted).primaryReason).toBe("possible_grading_error"); // the grade-vs-answer guardrail found no conflict
  });
});

describe("laya_only", () => {
  it("is exactly Laya's route choice", () => {
    const d = decide(sig({ gradeConsistentWithAnswer: false }), laya("auto_approve", 0.3), "laya_only");
    expect(d).toMatchObject({ action: "auto_approve", confidence: 0.3, primaryReason: "none", source: "laya" });
    const withReason = { ...laya("regrade", 0.5), reason: { ...approve.reason, choice: "grade_reasoning_conflict" as const } };
    expect(decide(clean, withReason, "laya_only")).toMatchObject({ action: "regrade", primaryReason: "grade_reasoning_conflict" });
  });
});

describe("rules_only soft rules", () => {
  it.each([
    ["ambiguity high", sig({ ambiguity: "high" }), "flag_ambiguous", "ambiguous_reasoning"],
    ["transcription possible", sig({ transcriptionRisk: "possible" }), "human_review", "transcription_issue"],
    ["unclear reasoning", sig({ detectedIssues: ["unclear_reasoning"] }), "human_review", "ambiguous_reasoning"],
    ["minimal work, not incorrect", sig({ workCompleteness: "minimal", answerCorrectness: "partially_correct" }), "human_review", "incomplete_work"],
    ["alternative path, unsure grader", sig({ alternativeSolutionPath: true, aiConfidence: 0.84 }), "human_review", "unusual_solution_path"],
    ["error propagation, unsure grader", sig({ detectedIssues: ["error_propagation"], aiConfidence: 0.84 }), "human_review", "possible_grading_error"],
    ["low band", sig({ aiConfidence: 0.5, confidenceBand: "low" }), "human_review", "low_confidence"],
    ["medium band", sig({ aiConfidence: 0.7, confidenceBand: "medium" }), "human_review", "low_confidence"],
    ["clean", clean, "auto_approve", "none"],
    ["minimal but incorrect", sig({ workCompleteness: "minimal", answerCorrectness: "incorrect" }), "auto_approve", "none"],
    ["confident alternative path", sig({ alternativeSolutionPath: true, aiConfidence: 0.9 }), "auto_approve", "none"],
  ] as const)("%s", (_, s, action, primaryReason) => {
    expect(decide(s, null, "rules_only")).toMatchObject({ action, primaryReason, source: "guardrail" });
  });
});

describe("threshold_baseline", () => {
  it("auto-approves at the threshold and reviews below it", () => {
    expect(decide(sig({ aiConfidence: THRESHOLDS.baselineAiConfidence }), null, "threshold_baseline")).toMatchObject({ action: "auto_approve", confidence: 0.85, source: "threshold" });
    expect(decide(sig({ aiConfidence: 0.84, gradeConsistentWithAnswer: false }), approve, "threshold_baseline")).toMatchObject({ action: "human_review", primaryReason: "low_confidence" });
  });
});

it("decideAll returns one well-formed decision per policy and is pure", () => {
  const s = sig({ aiConfidence: 0.7, confidenceBand: "medium" });
  const l = laya("regrade", 0.5);
  const all = decideAll(s, l);
  expect(Object.keys(all)).toEqual([...POLICY_IDS]);
  for (const p of POLICY_IDS) {
    expect(all[p].policy).toBe(p);
    expect(all[p].reason.length).toBeGreaterThan(0);
    expect(all[p].confidence).toBeGreaterThanOrEqual(0);
    expect(all[p].confidence).toBeLessThanOrEqual(1);
    expect((all[p].action === "auto_approve") === (all[p].primaryReason === "none")).toBe(true);
  }
  expect(decideAll(s, l)).toEqual(all);
});

// Laya-free regression over the real fixtures: a fixture, grader or signal change that moves a headline
// number fails here instead of silently. gradeguard is checked only where a guardrail decides (Laya stubbed).
describe("fixture regression", () => {
  const RULES_ONLY: Record<string, DecisionAction> = {
    "case-001": "auto_approve",
    "case-002": "auto_approve",
    "case-003": "human_review",
    "case-004": "auto_approve",
    "case-005": "auto_approve",
    "case-006": "human_review",
    "case-007": "human_review",
    "case-008": "regrade",
    "case-009": "flag_ambiguous",
    "case-010": "regrade",
    "case-011": "human_review",
    "case-012": "flag_ambiguous",
    "case-013": "human_review",
    "case-014": "auto_approve",
    "case-015": "flag_ambiguous",
    "case-016": "auto_approve",
    "case-017": "human_review",
    "case-018": "auto_approve",
  };
  const GUARDRAIL: Record<string, DecisionAction> = {
    "case-008": "regrade",
    "case-009": "flag_ambiguous",
    "case-010": "regrade",
    "case-012": "flag_ambiguous",
    "case-015": "flag_ambiguous",
  };
  it("covers every case", () => expect(CASES.map((c) => c.id)).toEqual(Object.keys(RULES_ONLY)));
  it.each(CASES.map((c) => [c.id, c] as const))("%s", (id, c) => {
    const s = deriveSignals({ question: c.question, submission: c.submission, aiGrade: mockGrade(c.submission) });
    expect(decide(s, null, "rules_only").action).toBe(RULES_ONLY[id]);
    const g = gg(s, approve);
    if (GUARDRAIL[id]) expect(g).toMatchObject({ action: GUARDRAIL[id], source: "guardrail" });
    else expect(g.source).toBe("laya");
  });
});
