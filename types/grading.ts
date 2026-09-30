/**
 * Normalized grading state shared by the mock grader, signals, decision policies, evaluator and UI. Fields follow
 * Frizzle's public description: step-level rubric, first-error step, alternative paths, named misconceptions and
 * a separate transcription confidence for handwritten work.
 */

export type WorkType = "typed" | "handwritten";

export interface RubricStep {
  id: string; // "s1"
  description: string; // "Subtract 4 from both sides"
  points: number;
}

export interface Question {
  id: string;
  text: string;
  topic: string; // e.g. "linear equations"
  expectedAnswer: string; // canonical final answer, e.g. "x = 3"
  acceptedAnswers: string[]; // equivalent forms, e.g. ["3", "x=3"]; compared after normalization
  rubric: RubricStep[]; // ordered; points sum to maxScore
  maxScore: number;
}

/** Only present for handwritten work: what a transcription/OCR stage would report. */
export interface Transcription {
  confidence: number; // 0..1
  uncertainSpans: string[]; // substrings the OCR was unsure about, e.g. "5 vs S on line 2"
}

export interface StudentSubmission {
  id: string; // equals the test-case id
  questionId: string;
  answer: string; // the (transcribed) work, one step per line
  workType: WorkType;
  transcription?: Transcription;
}

export type GradeLabel = "correct" | "partially_correct" | "incorrect" | "unable_to_grade";

export type IssueTag =
  | "arithmetic_error"
  | "sign_error"
  | "error_propagation"
  | "misconception"
  | "incomplete_work"
  | "missing_steps"
  | "answer_only"
  | "blank"
  | "off_task"
  | "unclear_reasoning"
  | "alternative_method"
  | "transcription_uncertain";

export type StepStatus = "met" | "partial" | "missed";

export interface StepAssessment {
  rubricStepId: string;
  status: StepStatus;
  note?: string;
}

/** What the (mock) AI grader returns. No hidden chain-of-thought: `reasoning` is a short summary. */
export interface AiGrade {
  score: number;
  maxScore: number;
  grade: GradeLabel;
  confidence: number; // grader self-reported confidence, 0..1
  reasoning: string; // concise justification
  feedback: string; // student-facing feedback
  detectedIssues: IssueTag[];
  steps: StepAssessment[]; // one per rubric step, same order as the rubric
  firstErrorStep: string | null; // rubric step id where the error originated
  misconception: string | null; // named misconception, e.g. "sign error when isolating x"
  solutionPath: "reference" | "alternative" | "unknown";
  extractedFinalAnswer: string | null; // what the grader read as the student's final answer
}

export interface GradingState {
  question: Question;
  submission: StudentSubmission;
  aiGrade: AiGrade;
}
