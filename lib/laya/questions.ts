import type { Question } from "@receptron/laya";
import type { DecisionAction, DecisionSignals, EscalationReason } from "@/types/decision";

// Option order follows DECISION_ACTIONS / ESCALATION_REASONS; descriptions stay short (48-token cap per option).
const ROUTES: Record<DecisionAction, string> = {
  auto_approve: "the AI grade is reliable and needs no teacher attention",
  human_review: "a teacher should check or adjust the grade",
  regrade: "the grader contradicts itself, so grade the work again",
  flag_ambiguous: "the student work is unclear, blank or unreadable",
};

// laya_unavailable is not an option: it is the fallback reason when Laya itself is missing.
const REASONS: Record<Exclude<EscalationReason, "laya_unavailable">, string> = {
  low_confidence: "the grader is unsure of its own grade",
  grade_reasoning_conflict: "the grade contradicts the final answer check",
  possible_grading_error: "the score does not match the rubric steps",
  incomplete_work: "work is missing, partial or answer only",
  ambiguous_reasoning: "the student's reasoning is unclear",
  unusual_solution_path: "a valid but non-standard method",
  transcription_issue: "the handwriting may have been misread",
  insufficient_evidence: "not enough work shown to judge",
  none: "no escalation needed",
};

/** The three typed questions sent in one systemOne call. Every noul carries explicit true/false criteria. */
export const LAYA_QUESTIONS = {
  route: {
    type: "choice",
    instructions: "What should happen next with this AI grading result?",
    criteria: ROUTES,
  },
  accept: {
    type: "noul",
    instructions: "Can this AI grade be accepted without a teacher checking it?",
    criteria: {
      true: "confident, consistent grade on clear, complete work with no conflicts",
      false: "low confidence, a conflict, unclear or missing work, or a transcription risk",
    },
  },
  reason: {
    type: "choice",
    instructions: "What is the main reason this grade needs escalation?",
    criteria: REASONS,
  },
} satisfies Record<string, Question>;

/**
 * Compact JSON state for Laya (512 tokens per question, header included). It describes how reliable the
 * grade is, not whether the student is right: when the grade label, answers and issue tags were included,
 * zero-shot Laya judged the student and sent confident grades of wrong answers to regrade.
 */
export function buildLayaState(signals: DecisionSignals): Record<string, unknown> {
  const s = signals;
  const concerns = [
    s.confidenceBand !== "high" && `${s.confidenceBand} grader confidence`,
    !s.gradeConsistentWithAnswer && "grade contradicts final answer check",
    !s.scoreConsistentWithRubric && "score does not match rubric steps",
    s.workCompleteness !== "complete" && `work ${s.workCompleteness}`,
    s.ambiguity !== "low" && `${s.ambiguity} ambiguity`,
    s.transcriptionRisk !== "none" && `transcription risk ${s.transcriptionRisk}`,
    s.alternativeSolutionPath && "alternative solution path",
  ].filter((c): c is string => typeof c === "string");
  // Mostly evidence about the grade's consistency. Two items (first error step pinpointed, misconception
  // named) appear only when the student erred, so they do leak whether the student is right.
  const evidence = [
    s.gradeConsistentWithAnswer && s.finalAnswerMatchesExpected !== null && "grader verdict agrees with an independent final-answer check",
    s.scoreConsistentWithRubric && "score matches the rubric step marks",
    s.workCompleteness === "complete" && "work is complete",
    s.transcriptionRisk === "none" && "no transcription risk",
    s.ambiguity === "low" && "work is unambiguous",
    s.firstErrorStep && "grader pinpoints the step where the error starts",
    s.misconception && "known misconception named by the grader",
    !s.alternativeSolutionPath && "reference solution method",
  ].filter((e): e is string => typeof e === "string");
  return {
    graderConfidence: `${Math.round(s.aiConfidence * 100)}%`,
    evidence: evidence.length ? evidence : ["none"],
    concerns: concerns.length ? concerns : ["none"],
  };
}
