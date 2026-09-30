import type { GradeLabel, StepStatus } from "@/types/grading";
import type { GradeResult } from "@/types/decision";
import { HEADING, humanize, pct } from "./decisionStyle";

const GRADE_LABEL: Record<GradeLabel, string> = {
  correct: "Correct",
  partially_correct: "Partially correct",
  incorrect: "Incorrect",
  unable_to_grade: "Unable to grade",
};

const STEP_MARK: Record<StepStatus, { mark: string; className: string }> = {
  met: { mark: "✓", className: "text-emerald-600" },
  partial: { mark: "◐", className: "text-amber-600" },
  missed: { mark: "✗", className: "text-rose-600" },
};

const CHIP = "rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600";

export default function GradingResult({ result }: { result: GradeResult }) {
  const { question, submission, aiGrade: g } = result;
  const t = submission.transcription;
  const firstError = g.firstErrorStep && question.rubric.find((s) => s.id === g.firstErrorStep);

  return (
    <section className="space-y-5 rounded-xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className={HEADING}>Question</h2>
        <p className="mt-1 font-medium">{question.text}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {question.topic} · expected answer: <span className="font-mono">{question.expectedAnswer}</span>
        </p>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={HEADING}>Student work</h2>
          {submission.workType === "handwritten" && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
              handwritten{t && ` · transcription ${pct(t.confidence)}`}
            </span>
          )}
        </div>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-relaxed">
          {submission.answer.trim() || "(blank submission)"}
        </pre>
        {t && t.uncertainSpans.length > 0 && (
          <p className="mt-1 text-xs text-amber-800">Uncertain transcription: {t.uncertainSpans.join("; ")}</p>
        )}
      </div>

      <div className="space-y-4 border-t border-zinc-200 pt-4">
        <h2 className={HEADING}>AI grading</h2>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-zinc-500">Grade</dt>
            <dd className="font-semibold">{GRADE_LABEL[g.grade]}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Score</dt>
            <dd className="font-semibold tabular-nums">
              {g.score} / {g.maxScore}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Grader confidence</dt>
            <dd className="font-semibold tabular-nums">{pct(g.confidence)}</dd>
          </div>
        </dl>

        <div className="text-sm">
          <p className="text-zinc-500">Reasoning</p>
          <p className="mt-0.5 leading-relaxed">{g.reasoning}</p>
        </div>
        <div className="text-sm">
          <p className="text-zinc-500">Feedback</p>
          <p className="mt-0.5 leading-relaxed">{g.feedback}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-zinc-500">Issues:</span>
          {g.detectedIssues.length === 0 ? (
            <span className="text-zinc-400">none</span>
          ) : (
            g.detectedIssues.map((i) => (
              <span key={i} className={CHIP}>
                {humanize(i)}
              </span>
            ))
          )}
          {g.solutionPath === "alternative" && <span className={CHIP}>alternative solution path</span>}
        </div>

        <div className="text-sm">
          <p className="text-zinc-500">Rubric</p>
          <ol className="mt-1 space-y-1">
            {question.rubric.map((step) => {
              const a = g.steps.find((s) => s.rubricStepId === step.id);
              const m = a && STEP_MARK[a.status];
              return (
                <li key={step.id} className="flex gap-2">
                  <span aria-label={a?.status ?? "not assessed"} className={`w-4 shrink-0 text-center ${m?.className ?? "text-zinc-400"}`}>
                    {m?.mark ?? "–"}
                  </span>
                  <span className="min-w-0">
                    {step.description} <span className="text-xs text-zinc-400">({step.points} pt)</span>
                    {step.id === g.firstErrorStep && (
                      <span className="ml-1 rounded bg-rose-50 px-1 text-xs text-rose-700">first error</span>
                    )}
                    {a?.note && <span className="block text-xs text-zinc-500">{a.note}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {(g.misconception || firstError) && (
          <dl className="grid gap-2 rounded-lg border border-rose-100 bg-rose-50/60 p-3 text-sm sm:grid-cols-2">
            {g.misconception && (
              <div>
                <dt className="text-zinc-500">Misconception</dt>
                <dd>{g.misconception}</dd>
              </div>
            )}
            {firstError && (
              <div>
                <dt className="text-zinc-500">First error step</dt>
                <dd>{firstError.description}</dd>
              </div>
            )}
          </dl>
        )}

        {g.extractedFinalAnswer !== null && (
          <p className="text-xs text-zinc-500">
            Final answer read by grader: <span className="font-mono text-zinc-700">{g.extractedFinalAnswer}</span>
          </p>
        )}
      </div>
    </section>
  );
}
