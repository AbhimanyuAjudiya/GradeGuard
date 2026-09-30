// Runs every synthetic case through the real local Laya (mockGrade -> deriveSignals -> askLaya -> decideAll)
// and asserts that each case yields well-formed decisions, that each question sequence stays inside Laya's
// 512-token window, and that gradeguard never auto-approves a case a teacher should see. The per-case table
// and per-policy accuracy are `pnpm eval`'s job. Skips when the bundle is not on disk.
import { expect, it } from "vitest";
import { DECISION_ACTIONS, ESCALATION_REASONS, POLICY_IDS } from "@/types/decision";
import { CASES } from "@/lib/evaluation/cases";
import { mockGrade } from "@/lib/grader/mockGrader";
import { askLaya, bundleDir, hasBundle, loadLaya } from "@/lib/laya/client";
import { LAYA_QUESTIONS, buildLayaState } from "@/lib/laya/questions";
import { decideAll } from "./decision";
import { deriveSignals } from "./signals";

const modelDir = bundleDir();
const bundled = hasBundle(modelDir);
if (!bundled) console.warn(`[decision.integration] skipped: no Laya bundle at ${modelDir}; run \`pnpm laya:download\``);

it.skipIf(!bundled)("every policy decides every case well-formed with the real Laya; gradeguard has no false auto-approvals", async () => {
  const model = await loadLaya();
  const falseAutoApprovals: string[] = [];

  for (const c of CASES) {
    const signals = deriveSignals({ question: c.question, submission: c.submission, aiGrade: mockGrade(c.submission) });
    const d = decideAll(signals, await askLaya(signals));

    // usage.input_tokens sums the 3 question sequences; the 512-token window applies to each sequence.
    for (const [id, q] of Object.entries(LAYA_QUESTIONS)) {
      const perQuestion = (await model.systemOne(buildLayaState(signals), { [id]: q })).usage.input_tokens;
      expect(perQuestion, `${c.id} ${id}`).toBeLessThan(model.config.max_len);
    }
    for (const p of POLICY_IDS) {
      expect(d[p].policy).toBe(p);
      expect(DECISION_ACTIONS).toContain(d[p].action);
      expect(ESCALATION_REASONS).toContain(d[p].primaryReason);
      expect((d[p].action === "auto_approve") === (d[p].primaryReason === "none")).toBe(true);
      expect(d[p].confidence).toBeGreaterThanOrEqual(0);
      expect(d[p].confidence).toBeLessThanOrEqual(1);
      expect(d[p].reason.length).toBeGreaterThan(0);
    }
    if (d.gradeguard.action === "auto_approve" && c.expectedDecision !== "auto_approve") falseAutoApprovals.push(c.id);
  }

  expect(falseAutoApprovals).toEqual([]);
});
