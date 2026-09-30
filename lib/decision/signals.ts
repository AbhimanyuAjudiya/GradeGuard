import type { GradingState, IssueTag, Question } from "@/types/grading";
import type { DecisionSignals, Level } from "@/types/decision";

/**
 * Canonical form for comparing final answers: Unicode NFKC (so "½" becomes "1⁄2"), every dash/minus
 * variant becomes "-", fraction slash and "÷" become "/", whitespace is removed, text is lowercased
 * and a trailing full stop is dropped. "X = −½." -> "x=-1/2".
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[−‒–—‐‑﹣－]/g, "-")
    .replace(/[⁄∕÷]/g, "/")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
}

/**
 * Deterministic cross-check of a final answer against `expectedAnswer` + `acceptedAnswers`.
 * Each answer is split into parts on ",", ";", " or " and " and ", and "±2" expands to {2, -2}. When the
 * normalized expected answer starts with a single-variable assignment ("x=3"), that leading "x=" is dropped
 * from every part, so "3", "x = 3" and "X=3" all match, and "-2, 2" matches "x = ±2". Parts compare as a
 * sorted list, so order does not matter. Returns null when there is no answer to check.
 */
export function answerMatches(answer: string | null, question: Question): boolean | null {
  if (answer === null) return null;
  const assignment = /^([a-z])=/.exec(normalizeAnswer(question.expectedAnswer))?.[0];
  const parts = (s: string) =>
    s
      .split(/[,;]|\s+(?:or|and)\s+/i)
      .map(normalizeAnswer)
      .flatMap((p) => {
        const pm = /^([a-z]=)?±(.+)$/.exec(p);
        return pm ? [`${pm[1] ?? ""}${pm[2]}`, `${pm[1] ?? ""}-${pm[2]}`] : [p];
      })
      .map((p) => (assignment && p.startsWith(assignment) ? p.slice(assignment.length) : p))
      .filter((p) => p !== "")
      .sort()
      .join(",");
  const given = parts(answer);
  if (given === "") return false;
  return [question.expectedAnswer, ...question.acceptedAnswers].some((t) => parts(t) === given);
}

const STEP_CREDIT = { met: 1, partial: 0.5, missed: 0 } as const;
const LEVELS: Level[] = ["low", "medium", "high"];

/**
 * Signals derived from a GradingState. Read by the guardrails, gates and soft rules and shown in Decision
 * Details; Laya gets the smaller buildLayaState(signals). Pure: same state in, same signals out.
 */
export function deriveSignals(state: GradingState): DecisionSignals {
  const { question, submission, aiGrade: g } = state;
  const has = (t: IssueTag) => g.detectedIssues.includes(t);

  // confidenceBand: < 0.6 low, < 0.8 medium, otherwise high.
  const confidenceBand: Level = g.confidence < 0.6 ? "low" : g.confidence < 0.8 ? "medium" : "high";

  // finalAnswerMatchesExpected: an independent check of the grader's extracted final answer (null when none).
  const finalAnswerMatchesExpected = answerMatches(g.extractedFinalAnswer, question);

  // gradeConsistentWithAnswer: the grade label contradicts the cross-check only when it says "correct"
  // but the answer does not match, or "incorrect" but it does. partially_correct / unable_to_grade and a
  // null cross-check never conflict.
  const gradeConsistentWithAnswer = !(
    (g.grade === "correct" && finalAnswerMatchesExpected === false) ||
    (g.grade === "incorrect" && finalAnswerMatchesExpected === true)
  );

  // scoreConsistentWithRubric: points implied by the step statuses (met = full, partial = half,
  // missed or unassessed = 0) must be within 20% of maxScore of the grader's score.
  const stepPoints = new Map(question.rubric.map((r) => [r.id, r.points]));
  const impliedScore = g.steps.reduce((sum, s) => sum + (stepPoints.get(s.rubricStepId) ?? 0) * STEP_CREDIT[s.status], 0);
  const scoreConsistentWithRubric = Math.abs(g.score - impliedScore) <= 0.2 * g.maxScore + 1e-9;

  // reasoningQuality: share of rubric credit earned across assessed steps (>= 0.8 high, >= 0.4 medium,
  // else low; no steps = low), then one level down for each of unclear_reasoning and missing_steps.
  const stepRatio = g.steps.length ? g.steps.reduce((sum, s) => sum + STEP_CREDIT[s.status], 0) / g.steps.length : 0;
  const reasoningBase = stepRatio >= 0.8 ? 2 : stepRatio >= 0.4 ? 1 : 0;
  const reasoningQuality = LEVELS[Math.max(0, reasoningBase - Number(has("unclear_reasoning")) - Number(has("missing_steps")))];

  // workCompleteness, first rule that applies:
  //   blank / off_task -> none; answer_only -> minimal; incomplete_work / missing_steps -> partial;
  //   otherwise missed steps with no identified first error are omitted (not wrong) work:
  //   all steps missed -> minimal, some missed -> partial; no steps assessed -> minimal; else complete.
  const missed = g.steps.filter((s) => s.status === "missed").length;
  const omitted = g.firstErrorStep === null ? missed : 0;
  const workCompleteness: DecisionSignals["workCompleteness"] =
    has("blank") || has("off_task")
      ? "none"
      : has("answer_only")
        ? "minimal"
        : has("incomplete_work") || has("missing_steps")
          ? "partial"
          : g.steps.length === 0 || omitted === g.steps.length
            ? "minimal"
            : omitted > 0
              ? "partial"
              : "complete";

  // ambiguity: unable_to_grade -> high. Otherwise count unclear_reasoning, off_task, blank and a low
  // confidence band: 2+ -> high, 1 -> medium, 0 -> low.
  const ambiguityHits = [has("unclear_reasoning"), has("off_task"), has("blank"), confidenceBand === "low"].filter(Boolean).length;
  const ambiguity: Level = g.grade === "unable_to_grade" || ambiguityHits >= 2 ? "high" : ambiguityHits === 1 ? "medium" : "low";

  // transcriptionRisk: none without a transcription, or at >= 0.85 confidence with no uncertain spans;
  // likely below 0.7 confidence or with 2+ uncertain spans; possible otherwise.
  const t = submission.transcription;
  const transcriptionRisk: DecisionSignals["transcriptionRisk"] =
    !t || (t.confidence >= 0.85 && t.uncertainSpans.length === 0)
      ? "none"
      : t.confidence < 0.7 || t.uncertainSpans.length >= 2
        ? "likely"
        : "possible";

  return {
    aiConfidence: g.confidence,
    confidenceBand,
    answerCorrectness: g.grade,
    finalAnswerMatchesExpected,
    gradeConsistentWithAnswer,
    scoreConsistentWithRubric,
    reasoningQuality,
    workCompleteness,
    ambiguity,
    transcriptionRisk,
    partialCredit: g.score > 0 && g.score < g.maxScore,
    // alternativeSolutionPath: the grader says it followed a non-reference path, or tagged alternative_method.
    alternativeSolutionPath: g.solutionPath === "alternative" || has("alternative_method"),
    detectedIssues: g.detectedIssues,
    firstErrorStep: g.firstErrorStep,
    misconception: g.misconception,
  };
}
