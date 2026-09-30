import type { AiGrade, StudentSubmission } from "@/types/grading";
import { getCase } from "@/lib/evaluation/cases";

/** Stands in for an LLM grader: returns the fixture recorded for this submission. */
export function mockGrade(submission: StudentSubmission): AiGrade {
  const fixture = getCase(submission.id);
  if (!fixture) throw new Error(`no grading fixture for ${submission.id}`);
  return fixture.aiGrade;
}
