import { beforeAll, describe, expect, it, vi } from "vitest";
import { CASES } from "@/lib/evaluation/cases";
import { runPipeline } from "@/lib/pipeline";
import { POLICY_IDS, type Decision, type DecisionAction, type EscalationReason, type GradeResult, type LayaAnswers, type PolicyId } from "@/types/decision";
import type { TestCase } from "@/types/evaluation";
import { evaluateAll } from "./evaluator";

// Keep the real pipeline (grader, ONNX Laya session) and case fixtures out of this unit test.
vi.mock("@/lib/pipeline", () => ({ runPipeline: vi.fn() }));
vi.mock("@/lib/evaluation/cases", () => ({ CASES: [] }));

const fakeCase = (id: string, expectedDecision: DecisionAction, expectedReason: EscalationReason = "none") =>
  ({ id, description: `fake ${id}`, category: "correct", expectedDecision, expectedReason }) as TestCase;

beforeAll(() => {
  CASES.push(fakeCase("c1", "auto_approve"), fakeCase("c2", "human_review", "low_confidence"), fakeCase("c3", "flag_ambiguous", "insufficient_evidence"));
});

// Predicted action per case, per policy.
const predicted: Record<string, Record<PolicyId, DecisionAction>> = {
  c1: { threshold_baseline: "auto_approve", rules_only: "auto_approve", laya_only: "human_review", gradeguard_no_laya: "auto_approve", gradeguard: "auto_approve" },
  c2: { threshold_baseline: "auto_approve", rules_only: "human_review", laya_only: "human_review", gradeguard_no_laya: "auto_approve", gradeguard: "human_review" },
  c3: { threshold_baseline: "human_review", rules_only: "regrade", laya_only: "flag_ambiguous", gradeguard_no_laya: "human_review", gradeguard: "flag_ambiguous" },
};

const decision = (policy: PolicyId, action: DecisionAction): Decision => ({
  action,
  confidence: 0.9,
  reason: "fake",
  primaryReason: action === "auto_approve" ? "none" : "low_confidence",
  flags: [],
  source: "laya",
  policy,
});

function fakeRun(layaFor: (id: string) => LayaAnswers | null) {
  let inFlight = 0;
  const run = async (c: TestCase) => {
    run.maxInFlight = Math.max(run.maxInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const alternatives = Object.fromEntries(POLICY_IDS.map((p) => [p, decision(p, predicted[c.id][p])])) as Record<PolicyId, Decision>;
    return { alternatives, decision: alternatives.gradeguard, signals: {}, laya: layaFor(c.id) } as unknown as GradeResult;
  };
  run.maxInFlight = 0;
  return run;
}

const someLaya = {} as LayaAnswers;

describe("evaluateAll", () => {
  it("builds per-case results and per-policy metrics, running cases sequentially", async () => {
    const run = fakeRun(() => someLaya);
    vi.mocked(runPipeline).mockImplementation(run);
    const report = await evaluateAll();

    expect(run.maxInFlight).toBe(1);
    expect(report.cases.map((c) => c.caseId)).toEqual(["c1", "c2", "c3"]);
    expect(report.cases[0]).toMatchObject({
      description: "fake c1",
      category: "correct",
      expected: "auto_approve",
      expectedReason: "none",
      correct: { threshold_baseline: true, rules_only: true, laya_only: false, gradeguard_no_laya: true, gradeguard: true },
    });
    expect(report.cases[2].decisions.laya_only.action).toBe("flag_ambiguous");

    expect(Object.keys(report.policies)).toEqual([...POLICY_IDS]);
    expect(report.policies.threshold_baseline.accuracy).toBeCloseTo(1 / 3);
    expect(report.policies.rules_only.accuracy).toBeCloseTo(2 / 3);
    expect(report.policies.laya_only.accuracy).toBeCloseTo(2 / 3);
    expect(report.policies.gradeguard_no_laya.accuracy).toBeCloseTo(1 / 3);
    expect(report.policies.gradeguard.accuracy).toBe(1);
    expect(report.policies.gradeguard.reasonAccuracy).toEqual({ correct: 1, total: 2, value: 0.5 }); // c2 right, c3 wrong reason
    expect(report.policies.threshold_baseline.falseAutoApprovals).toBe(1);
    expect(report.policies.laya_only.unnecessaryHumanReviews).toBe(1);

    expect(report.layaAvailable).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });

  it("reports layaAvailable false when any case ran without Laya", async () => {
    vi.mocked(runPipeline).mockImplementation(fakeRun((id) => (id === "c2" ? null : someLaya)));
    const report = await evaluateAll();
    expect(report.layaAvailable).toBe(false);
    expect(report.cases[1].laya).toBeNull();
  });
});
