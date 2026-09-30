import type { AiGrade, Question, StudentSubmission } from "./grading";
import type { Decision, DecisionAction, DecisionSignals, EscalationReason, LayaAnswers, PolicyId } from "./decision";

export type CaseCategory =
  | "correct"
  | "incorrect"
  | "weak_reasoning"
  | "arithmetic_slip"
  | "alternative_path"
  | "ambiguous"
  | "low_confidence"
  | "grader_conflict"
  | "transcription"
  | "partial_credit"
  | "incomplete"
  | "misconception";

/** A synthetic submission plus the mock grader's fixture and the expected human-review outcome. */
export interface TestCase {
  id: string; // "case-001"
  description: string; // "Complete, correct typed solution"
  category: CaseCategory;
  question: Question;
  submission: StudentSubmission;
  aiGrade: AiGrade; // what the mock grader returns for this submission
  expectedDecision: DecisionAction;
  expectedReason: EscalationReason; // "none" for auto_approve
  rationale: string; // why a teacher would want this outcome
}

export interface EvalMetrics {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number; // correct / total
  humanReview: { precision: number; recall: number; truePositives: number; falsePositives: number; falseNegatives: number };
  escalation: { precision: number; recall: number }; // positive class = any action other than auto_approve
  falseAutoApprovals: number; // predicted auto_approve, expected anything else
  unnecessaryHumanReviews: number; // predicted human_review, expected auto_approve
  /** Over the cases this policy escalated to the expected action: how often primaryReason equals expectedReason. value = correct / total, 0 when total is 0. */
  reasonAccuracy: { correct: number; total: number; value: number };
  confusion: Record<DecisionAction, Record<DecisionAction, number>>; // confusion[expected][predicted]
}

export interface EvalCaseResult {
  caseId: string;
  description: string;
  category: CaseCategory;
  expected: DecisionAction;
  expectedReason: EscalationReason;
  decisions: Record<PolicyId, Decision>;
  correct: Record<PolicyId, boolean>;
  signals: DecisionSignals;
  laya: LayaAnswers | null;
}

export interface EvalReport {
  policies: Record<PolicyId, EvalMetrics>;
  cases: EvalCaseResult[];
  layaAvailable: boolean;
  durationMs: number;
  generatedAt: string; // ISO timestamp
}
