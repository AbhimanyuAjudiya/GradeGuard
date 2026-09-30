import type { TestCase } from "@/types/evaluation";
import { DECISION_STYLE, HEADING, humanize } from "./decisionStyle";

export type CaseSummary = Pick<TestCase, "id" | "description" | "category" | "expectedDecision">;

export default function SubmissionSelector({
  cases,
  selectedId,
  loading,
  hasResult,
  layaReady,
  onSelect,
  onRun,
}: {
  cases: CaseSummary[];
  selectedId: string;
  loading: boolean;
  hasResult: boolean;
  layaReady: boolean;
  onSelect: (id: string) => void;
  onRun: () => void;
}) {
  const current = cases.find((c) => c.id === selectedId);
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <label htmlFor="submission" className={HEADING}>
        Select submission
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <select
          id="submission"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} · {c.description}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRun}
          disabled={!current}
          aria-busy={loading}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 aria-busy:opacity-70"
        >
          {hasResult ? "Run again" : "Run"}
        </button>
      </div>
      <p className="mt-2 min-h-5 text-xs text-zinc-500" aria-live="polite">
        {loading
          ? `Running grader → Laya…${layaReady ? "" : " (waiting for the Laya model; see the status above)"}`
          : current &&
            `category: ${humanize(current.category)} · teacher-expected outcome: ${DECISION_STYLE[current.expectedDecision].title}`}
      </p>
    </section>
  );
}
