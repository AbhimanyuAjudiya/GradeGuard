import type { AiGrade, GradeLabel, IssueTag, Question, StudentSubmission } from "./grading";

export const DECISION_ACTIONS = ["auto_approve", "human_review", "regrade", "flag_ambiguous"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const ESCALATION_REASONS = [
  "low_confidence",
  "grade_reasoning_conflict",
  "possible_grading_error",
  "incomplete_work",
  "ambiguous_reasoning",
  "unusual_solution_path",
  "transcription_issue",
  "insufficient_evidence",
  "laya_unavailable", // fallback only: Laya could not be loaded, so no Laya-sourced decision exists
  "none",
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export type Level = "low" | "medium" | "high";

/**
 * Structured signals derived deterministically from a GradingState (lib/decision/signals.ts).
 * The guardrails, gates and soft rules read these, and the UI shows them in "Decision Details".
 * Laya is not sent this object: it gets the compact state from buildLayaState(signals) (see GradeResult.layaState).
 * reasoningQuality and partialCredit are display-only: no rule reads them.
 */
export interface DecisionSignals {
  aiConfidence: number; // 0..1, copied from the grader
  confidenceBand: Level; // bucketed aiConfidence
  answerCorrectness: GradeLabel; // the grader's label
  finalAnswerMatchesExpected: boolean | null; // deterministic cross-check of extractedFinalAnswer vs question; null when no final answer
  gradeConsistentWithAnswer: boolean; // grade label agrees with the cross-check (false = grader contradicts itself)
  scoreConsistentWithRubric: boolean; // score is close to the points implied by step statuses
  reasoningQuality: Level; // from step statuses + issues
  workCompleteness: "complete" | "partial" | "minimal" | "none";
  ambiguity: Level;
  transcriptionRisk: "none" | "possible" | "likely"; // from submission.transcription
  partialCredit: boolean; // 0 < score < maxScore
  alternativeSolutionPath: boolean;
  detectedIssues: IssueTag[];
  firstErrorStep: string | null;
  misconception: string | null;
}

/** Normalized answers from one Laya `systemOne` call (lib/laya/client.ts). */
export interface LayaAnswers {
  route: { choice: DecisionAction; probabilities: Record<DecisionAction, number> };
  accept: { probability: number }; // P(true) for "can be accepted without a teacher checking it"
  reason: { choice: EscalationReason; probabilities: Record<EscalationReason, number> };
  model: string;
  /** usage.input_tokens summed over the three questions; Laya's 512-token limit applies to each question. */
  inputTokens: number;
  latencyMs: number;
}

/**
 * Routing policies compared by the evaluator.
 * - threshold_baseline: what a pipeline does without a decision layer (auto-approve above a fixed AI-confidence threshold, otherwise human review)
 * - rules_only: the hard guardrails plus hand-written soft rules, no Laya
 * - laya_only: Laya's raw `route` choice, nothing around it
 * - gradeguard_no_laya: ablation. gradeguard with Laya replaced by a constant auto_approve (p = 1, accept = 1), so only the guardrails and gates act
 * - gradeguard: Laya's choice wrapped in the guardrails and gates (the product decision)
 */
export const POLICY_IDS = ["threshold_baseline", "rules_only", "laya_only", "gradeguard_no_laya", "gradeguard"] as const;
export type PolicyId = (typeof POLICY_IDS)[number];

export interface Decision {
  action: DecisionAction;
  /** 0..1 per policy: the grader's confidence for threshold_baseline, P of Laya's choice for laya_only, P(auto_approve) for a gradeguard Laya auto-approve, 1 - P(auto_approve) for a gradeguard Laya escalation, 1 for rules and the ablation, 0 for the fallback. Not calibrated and not shown in the UI. */
  confidence: number;
  reason: string; // one or two plain sentences for the UI
  primaryReason: EscalationReason; // "none" when auto_approve
  flags: string[]; // human-readable signal flags / guardrails that fired
  /** laya: Laya's route stood (possibly gated). guardrail: a deterministic rule decided. threshold: the baseline. fallback: Laya unavailable, no guardrail fired. */
  source: "laya" | "guardrail" | "threshold" | "fallback";
  policy: PolicyId;
}

export type LayaStatus =
  | { state: "not_downloaded" }
  | { state: "idle" } // bundle on disk, not loaded yet
  | { state: "downloading"; receivedBytes: number; totalBytes: number | null; file: string }
  | { state: "loading" }
  | { state: "ready"; modelDir: string; loadMs: number }
  | { state: "error"; message: string };

/** Response of POST /api/grade. */
export interface GradeResult {
  submission: StudentSubmission;
  question: Question;
  aiGrade: AiGrade;
  signals: DecisionSignals;
  layaState: Record<string, unknown>; // exactly what buildLayaState sent (or would send) to Laya
  laya: LayaAnswers | null; // null only when Laya is unavailable; the UI must then say so, never fabricate
  decision: Decision; // the `gradeguard` policy decision
  alternatives: Record<PolicyId, Decision>; // every policy's decision for the same state (explainability)
  timing: { graderMs: number; layaMs: number; totalMs: number };
}
