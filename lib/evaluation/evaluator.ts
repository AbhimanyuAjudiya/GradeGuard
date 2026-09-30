import { CASES } from "@/lib/evaluation/cases";
import { computeMetrics } from "@/lib/evaluation/metrics";
import { runPipeline } from "@/lib/pipeline";
import { POLICY_IDS, type PolicyId } from "@/types/decision";
import type { EvalCaseResult, EvalMetrics, EvalReport } from "@/types/evaluation";

export async function evaluateAll(): Promise<EvalReport> {
  const t0 = performance.now();
  const results: EvalCaseResult[] = [];
  // Sequential on purpose: Laya is a single in-process ONNX session.
  for (const c of CASES) {
    const r = await runPipeline(c);
    results.push({
      caseId: c.id,
      description: c.description,
      category: c.category,
      expected: c.expectedDecision,
      expectedReason: c.expectedReason,
      decisions: r.alternatives,
      correct: Object.fromEntries(
        POLICY_IDS.map((p) => [p, r.alternatives[p].action === c.expectedDecision]),
      ) as Record<PolicyId, boolean>,
      signals: r.signals,
      laya: r.laya,
    });
  }

  const policies = Object.fromEntries(
    POLICY_IDS.map((p) => [
      p,
      computeMetrics(
        results.map((r) => ({
          expected: r.expected,
          predicted: r.decisions[p].action,
          expectedReason: r.expectedReason,
          predictedReason: r.decisions[p].primaryReason,
        })),
      ),
    ]),
  ) as Record<PolicyId, EvalMetrics>;

  return {
    policies,
    cases: results,
    layaAvailable: results.every((r) => r.laya !== null),
    durationMs: performance.now() - t0,
    generatedAt: new Date().toISOString(),
  };
}
