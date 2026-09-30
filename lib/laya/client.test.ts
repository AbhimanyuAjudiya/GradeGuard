// Integration test against the real local Laya model (no network). Skips when the bundle is not on disk.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DECISION_ACTIONS, ESCALATION_REASONS } from "@/types/decision";
import type { GradingState, Question } from "@/types/grading";
import { deriveSignals } from "@/lib/decision/signals";
import { askLaya, bundleDir, closeLaya, getLayaStatus, hasBundle, loadLaya } from "./client";

const modelDir = bundleDir();
const bundled = hasBundle(modelDir);
if (!bundled) console.warn(`[client.test] skipped: no Laya bundle at ${modelDir}; run \`pnpm laya:download\``);

const question: Question = {
  id: "q1",
  text: "Solve 2x + 4 = 10",
  topic: "linear equations",
  expectedAnswer: "x = 3",
  acceptedAnswers: ["3"],
  rubric: [
    { id: "s1", description: "Subtract 4 from both sides", points: 4 },
    { id: "s2", description: "Divide by 2", points: 4 },
    { id: "s3", description: "Reach x = 3", points: 2 },
  ],
  maxScore: 10,
};

const clean: GradingState = {
  question,
  submission: { id: "clean", questionId: "q1", answer: "2x + 4 = 10\n2x = 6\nx = 3", workType: "typed" },
  aiGrade: {
    score: 10,
    maxScore: 10,
    grade: "correct",
    confidence: 0.95,
    reasoning: "Student subtracted 4, divided by 2 and reached x = 3. Every rubric step is met.",
    feedback: "Clear and correct.",
    detectedIssues: [],
    steps: [
      { rubricStepId: "s1", status: "met" },
      { rubricStepId: "s2", status: "met" },
      { rubricStepId: "s3", status: "met" },
    ],
    firstErrorStep: null,
    misconception: null,
    solutionPath: "reference",
    extractedFinalAnswer: "x = 3",
  },
};

const conflicting: GradingState = {
  question,
  submission: {
    id: "conflict",
    questionId: "q1",
    answer: "2x + 4 = 10\n2x = 6\nx = 5",
    workType: "handwritten",
    transcription: { confidence: 0.62, uncertainSpans: ["3 vs 5 on line 3", "+ vs - on line 1"] },
  },
  aiGrade: {
    score: 10,
    maxScore: 10,
    grade: "correct",
    confidence: 0.55,
    reasoning: "Setup and division look right; final line read as x = 5 but the work implies x = 3.",
    feedback: "Good work.",
    detectedIssues: ["transcription_uncertain"],
    steps: [
      { rubricStepId: "s1", status: "met" },
      { rubricStepId: "s2", status: "met" },
      { rubricStepId: "s3", status: "met" },
    ],
    firstErrorStep: null,
    misconception: null,
    solutionPath: "reference",
    extractedFinalAnswer: "x = 5",
  },
};

const sum = (p: Record<string, number>) => Object.values(p).reduce((a, b) => a + b, 0);

describe.skipIf(!bundled)("askLaya (real model)", () => {
  for (const [name, state] of [["clean", clean], ["conflicting", conflicting]] as const) {
    it(`returns well-formed answers for the ${name} state`, async () => {
      const a = await askLaya(deriveSignals(state));
      expect(getLayaStatus().state).toBe("ready");
      expect(DECISION_ACTIONS).toContain(a.route.choice);
      expect(ESCALATION_REASONS).toContain(a.reason.choice);
      expect(Object.keys(a.route.probabilities).sort()).toEqual([...DECISION_ACTIONS].sort());
      expect(Object.keys(a.reason.probabilities).sort()).toEqual([...ESCALATION_REASONS].sort());
      expect(sum(a.route.probabilities)).toBeCloseTo(1, 2);
      expect(sum(a.reason.probabilities)).toBeCloseTo(1, 2);
      expect(a.accept.probability).toBeGreaterThanOrEqual(0);
      expect(a.accept.probability).toBeLessThanOrEqual(1);
      expect(a.model).toBe("laya");
      expect(a.latencyMs).toBeGreaterThan(0);
      expect(a.inputTokens).toBeGreaterThan(0);
    });
  }

  it("closeLaya during a load closes the stale session and leaves the cache reusable", async () => {
    await closeLaya();
    const stale = loadLaya();
    await closeLaya();
    await expect(stale).rejects.toThrow("closed while loading");
    expect(getLayaStatus().state).toBe("idle");
    await askLaya(deriveSignals(clean));
    expect(getLayaStatus().state).toBe("ready");
  });
});

it("a partial bundle is not a bundle", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "laya-partial-"));
  writeFileSync(path.join(dir, "laya.onnx.data"), "");
  expect(hasBundle(dir)).toBe(false);
  rmSync(dir, { recursive: true });
});
