import { decideAll } from "@/lib/decision/decision";
import { deriveSignals } from "@/lib/decision/signals";
import { mockGrade } from "@/lib/grader/mockGrader";
import { askLaya, LayaUnavailableError } from "@/lib/laya/client";
import { buildLayaState } from "@/lib/laya/questions";
import type { GradeResult, LayaAnswers } from "@/types/decision";
import type { TestCase } from "@/types/evaluation";

/** Submission → mock grader → signals → Laya → policies. Laya being unavailable yields laya: null, never a fabricated answer. */
export async function runPipeline(testCase: TestCase): Promise<GradeResult> {
  const { question, submission } = testCase;
  const t0 = performance.now();
  const aiGrade = mockGrade(submission);
  const graderMs = performance.now() - t0;

  const signals = deriveSignals({ question, submission, aiGrade });

  const t1 = performance.now();
  let laya: LayaAnswers | null = null;
  try {
    laya = await askLaya(signals);
  } catch (err) {
    if (!(err instanceof LayaUnavailableError)) throw err;
  }
  const layaMs = performance.now() - t1;

  const alternatives = decideAll(signals, laya);
  return {
    submission,
    question,
    aiGrade,
    signals,
    layaState: buildLayaState(signals),
    laya,
    decision: alternatives.gradeguard,
    alternatives,
    timing: { graderMs: Math.round(graderMs), layaMs: Math.round(layaMs), totalMs: Math.round(performance.now() - t0) },
  };
}
