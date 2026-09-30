import { describe, expect, it } from "vitest";
import { CASES, getCase } from "@/lib/evaluation/cases";
import { mockGrade } from "@/lib/grader/mockGrader";

// Cases where the grader's score is deliberately out of line with its own step marks.
const DESIGNED_SCORE_MISMATCH = new Set(["case-010"]);

describe("synthetic test set", () => {
  it("has 18 cases with unique ids", () => {
    expect(CASES).toHaveLength(18);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(18);
  });

  it.each(CASES)("$id is well formed", (c) => {
    const { question, submission, aiGrade } = c;
    expect(aiGrade.steps.map((s) => s.rubricStepId)).toEqual(question.rubric.map((r) => r.id));
    expect(question.rubric.reduce((sum, r) => sum + r.points, 0)).toBe(question.maxScore);
    expect(aiGrade.maxScore).toBe(question.maxScore);
    expect(aiGrade.score).toBeGreaterThanOrEqual(0);
    expect(aiGrade.score).toBeLessThanOrEqual(aiGrade.maxScore);
    expect(aiGrade.confidence).toBeGreaterThanOrEqual(0);
    expect(aiGrade.confidence).toBeLessThanOrEqual(1);
    expect(c.expectedReason === "none").toBe(c.expectedDecision === "auto_approve");
    expect(submission.id).toBe(c.id);
    expect(submission.questionId).toBe(question.id);
    expect(submission.transcription !== undefined).toBe(submission.workType === "handwritten");
    if (!DESIGNED_SCORE_MISMATCH.has(c.id)) {
      const metPoints = question.rubric
        .filter((r, i) => aiGrade.steps[i].status === "met")
        .reduce((sum, r) => sum + r.points, 0);
      expect(aiGrade.score).toBe(metPoints);
    }
  });

  it("getCase finds by id", () => {
    expect(getCase("case-008")).toBe(CASES[7]);
    expect(getCase("case-999")).toBeUndefined();
  });
});

describe("mockGrade", () => {
  it("returns the fixture for every case", () => {
    for (const c of CASES) expect(mockGrade(c.submission)).toBe(c.aiGrade);
  });

  it("throws for an unknown submission", () => {
    const c = CASES[0];
    expect(() => mockGrade({ ...c.submission, id: "case-999" })).toThrow("no grading fixture for case-999");
  });
});
