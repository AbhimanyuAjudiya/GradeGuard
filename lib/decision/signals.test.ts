import { describe, expect, it } from "vitest";
import type { AiGrade, GradingState, Question, StepAssessment, Transcription } from "@/types/grading";
import { CASES } from "@/lib/evaluation/cases";
import { buildLayaState } from "@/lib/laya/questions";
import { answerMatches, deriveSignals, normalizeAnswer } from "./signals";

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

const steps = (...st: StepAssessment["status"][]): StepAssessment[] => st.map((status, i) => ({ rubricStepId: `s${i + 1}`, status }));

function make(grade: Partial<AiGrade> = {}, transcription?: Transcription): GradingState {
  return {
    question,
    submission: { id: "t", questionId: "q1", answer: "2x = 6\nx = 3", workType: transcription ? "handwritten" : "typed", transcription },
    aiGrade: {
      score: 10,
      maxScore: 10,
      grade: "correct",
      confidence: 0.92,
      reasoning: "All steps correct.",
      feedback: "Nice work.",
      detectedIssues: [],
      steps: steps("met", "met", "met"),
      firstErrorStep: null,
      misconception: null,
      solutionPath: "reference",
      extractedFinalAnswer: "x = 3",
      ...grade,
    },
  };
}

describe("normalizeAnswer / answerMatches", () => {
  it("normalizes whitespace, case, unicode minus and fractions", () => {
    expect(normalizeAnswer(" X = −½. ")).toBe("x=-1/2");
    expect(normalizeAnswer("6 ÷ 2")).toBe("6/2");
  });
  it("drops the expected answer's leading variable assignment", () => {
    expect(answerMatches("3", question)).toBe(true);
    expect(answerMatches("X=3", question)).toBe(true);
    expect(answerMatches("x = 4", question)).toBe(false);
    expect(answerMatches("y = 3", question)).toBe(false);
    expect(answerMatches("", question)).toBe(false);
    expect(answerMatches(null, question)).toBeNull();
  });
  it("keeps assignments when the expected answer has none, and checks accepted answers", () => {
    const q = { ...question, expectedAnswer: "-1/2", acceptedAnswers: ["-0.5"] };
    expect(answerMatches("−½", q)).toBe(true);
    expect(answerMatches("-0.5", q)).toBe(true);
    expect(answerMatches("x = -1/2", q)).toBe(false);
  });
  const byQuestion = (id: string) => CASES.find((c) => c.question.id === id)!.question;
  it("matches multi-solution answers in any order", () => {
    const quad = byQuestion("q-quadratic-1"); // "x = 2 or x = -2", accepts "x = ±2", "2, -2"
    for (const a of ["x = -2, x = 2", "-2, 2", "x = 2 and x = -2", "±2"]) expect(answerMatches(a, quad), a).toBe(true);
    expect(answerMatches("x = 2, x = 3", quad)).toBe(false);
    expect(answerMatches("x = 2", quad)).toBe(false);
    const sys = byQuestion("q-system-1"); // "x = 7, y = 3"
    for (const a of ["y = 3 and x = 7", "x = 7; y = 3", "(7, 3)"]) expect(answerMatches(a, sys), a).toBe(true);
    expect(answerMatches("x = 3, y = 7", sys)).toBe(false);
  });
  it("does not match an answer to a different question (case-015)", () => {
    const c = CASES.find((k) => k.id === "case-015")!;
    expect(answerMatches(c.aiGrade.extractedFinalAnswer, c.question)).toBe(false); // "x = 3" vs "5/6"
  });
});

describe("deriveSignals", () => {
  it("clean confident correct case", () => {
    expect(deriveSignals(make())).toEqual({
      aiConfidence: 0.92,
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
    });
  });

  it("confidenceBand boundaries", () => {
    expect(deriveSignals(make({ confidence: 0.59 })).confidenceBand).toBe("low");
    expect(deriveSignals(make({ confidence: 0.6 })).confidenceBand).toBe("medium");
    expect(deriveSignals(make({ confidence: 0.79 })).confidenceBand).toBe("medium");
    expect(deriveSignals(make({ confidence: 0.8 })).confidenceBand).toBe("high");
  });

  it("gradeConsistentWithAnswer", () => {
    expect(deriveSignals(make({ extractedFinalAnswer: "x = 4" })).gradeConsistentWithAnswer).toBe(false);
    expect(deriveSignals(make({ grade: "incorrect", score: 0, steps: steps("missed", "missed", "missed") })).gradeConsistentWithAnswer).toBe(false);
    expect(deriveSignals(make({ grade: "incorrect", extractedFinalAnswer: "x = 4" })).gradeConsistentWithAnswer).toBe(true);
    expect(deriveSignals(make({ grade: "partially_correct", extractedFinalAnswer: "x = 4" })).gradeConsistentWithAnswer).toBe(true);
    expect(deriveSignals(make({ grade: "unable_to_grade" })).gradeConsistentWithAnswer).toBe(true);
    const noAnswer = deriveSignals(make({ extractedFinalAnswer: null }));
    expect(noAnswer.finalAnswerMatchesExpected).toBeNull();
    expect(noAnswer.gradeConsistentWithAnswer).toBe(true);
  });

  it("scoreConsistentWithRubric within 20% of maxScore", () => {
    // implied = 4 + 2 + 0 = 6
    const partial = { steps: steps("met", "partial", "missed"), firstErrorStep: "s2" };
    expect(deriveSignals(make({ ...partial, score: 8 })).scoreConsistentWithRubric).toBe(true);
    expect(deriveSignals(make({ ...partial, score: 4 })).scoreConsistentWithRubric).toBe(true);
    expect(deriveSignals(make({ ...partial, score: 9 })).scoreConsistentWithRubric).toBe(false);
    expect(deriveSignals(make({ ...partial, score: 3 })).scoreConsistentWithRubric).toBe(false);
  });

  it("reasoningQuality from step ratio, demoted by unclear_reasoning / missing_steps", () => {
    expect(deriveSignals(make({ steps: steps("met", "partial", "missed"), firstErrorStep: "s2" })).reasoningQuality).toBe("medium");
    expect(deriveSignals(make({ steps: steps("missed", "missed", "partial"), firstErrorStep: "s1" })).reasoningQuality).toBe("low");
    expect(deriveSignals(make({ steps: [] })).reasoningQuality).toBe("low");
    expect(deriveSignals(make({ detectedIssues: ["unclear_reasoning"] })).reasoningQuality).toBe("medium");
    expect(deriveSignals(make({ detectedIssues: ["unclear_reasoning", "missing_steps"] })).reasoningQuality).toBe("low");
  });

  it("workCompleteness", () => {
    const wc = (g: Partial<AiGrade>) => deriveSignals(make(g)).workCompleteness;
    expect(wc({ detectedIssues: ["blank"] })).toBe("none");
    expect(wc({ detectedIssues: ["off_task", "answer_only"] })).toBe("none");
    expect(wc({ detectedIssues: ["answer_only", "missing_steps"] })).toBe("minimal");
    expect(wc({ detectedIssues: ["incomplete_work"] })).toBe("partial");
    expect(wc({ detectedIssues: ["missing_steps"] })).toBe("partial");
    expect(wc({ steps: steps("missed", "missed", "missed") })).toBe("minimal");
    expect(wc({ steps: [] })).toBe("minimal");
    expect(wc({ steps: steps("met", "met", "missed") })).toBe("partial");
    // missed steps after an identified error are wrong work, not omitted work
    expect(wc({ steps: steps("met", "missed", "missed"), firstErrorStep: "s2" })).toBe("complete");
  });

  it("ambiguity", () => {
    const amb = (g: Partial<AiGrade>) => deriveSignals(make(g)).ambiguity;
    expect(amb({ grade: "unable_to_grade" })).toBe("high");
    expect(amb({ detectedIssues: ["unclear_reasoning"], confidence: 0.5 })).toBe("high");
    expect(amb({ detectedIssues: ["blank", "off_task"] })).toBe("high");
    expect(amb({ detectedIssues: ["unclear_reasoning"] })).toBe("medium");
    expect(amb({ confidence: 0.55 })).toBe("medium");
    expect(amb({ confidence: 0.7 })).toBe("low");
  });

  it("transcriptionRisk", () => {
    const tr = (t?: Transcription) => deriveSignals(make({}, t)).transcriptionRisk;
    expect(tr()).toBe("none");
    expect(tr({ confidence: 0.9, uncertainSpans: [] })).toBe("none");
    expect(tr({ confidence: 0.9, uncertainSpans: ["5 vs S"] })).toBe("possible");
    expect(tr({ confidence: 0.8, uncertainSpans: [] })).toBe("possible");
    expect(tr({ confidence: 0.69, uncertainSpans: [] })).toBe("likely");
    expect(tr({ confidence: 0.95, uncertainSpans: ["5 vs S", "- vs ="] })).toBe("likely");
  });

  it("partialCredit, alternativeSolutionPath and copied fields", () => {
    const s = deriveSignals(
      make({ score: 6, detectedIssues: ["sign_error"], firstErrorStep: "s2", misconception: "sign error", solutionPath: "alternative" }),
    );
    expect(s.partialCredit).toBe(true);
    expect(s.alternativeSolutionPath).toBe(true);
    expect(s.firstErrorStep).toBe("s2");
    expect(s.misconception).toBe("sign error");
    expect(s.detectedIssues).toEqual(["sign_error"]);
    expect(deriveSignals(make({ score: 0 })).partialCredit).toBe(false);
    expect(deriveSignals(make({ detectedIssues: ["alternative_method"] })).alternativeSolutionPath).toBe(true);
  });
});

describe("buildLayaState concerns", () => {
  const concerns = (st: GradingState) => buildLayaState(deriveSignals(st)).concerns;
  it("lists deterministic concerns, or none", () => {
    expect(concerns(make())).toEqual(["none"]);
    expect(concerns(make({ confidence: 0.5, extractedFinalAnswer: "x = 5" }, { confidence: 0.6, uncertainSpans: [] }))).toEqual([
      "low grader confidence",
      "grade contradicts final answer check",
      "medium ambiguity",
      "transcription risk likely",
    ]);
  });
});
