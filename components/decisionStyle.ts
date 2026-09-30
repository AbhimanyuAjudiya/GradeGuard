import type { DecisionAction, PolicyId } from "@/types/decision";

export const DECISION_STYLE: Record<
  DecisionAction,
  { symbol: string; title: string; card: string; text: string; solid: string; bar: string }
> = {
  auto_approve: {
    symbol: "✓",
    title: "Auto-approve",
    card: "border-emerald-300 bg-emerald-50",
    text: "text-emerald-700",
    solid: "border-emerald-600 bg-emerald-600 text-white",
    bar: "bg-emerald-500",
  },
  human_review: {
    symbol: "⚠",
    title: "Human review",
    card: "border-amber-300 bg-amber-50",
    text: "text-amber-700",
    solid: "border-amber-600 bg-amber-600 text-white",
    bar: "bg-amber-500",
  },
  regrade: {
    symbol: "↻",
    title: "Regrade",
    card: "border-blue-300 bg-blue-50",
    text: "text-blue-700",
    solid: "border-blue-600 bg-blue-600 text-white",
    bar: "bg-blue-500",
  },
  flag_ambiguous: {
    symbol: "?",
    title: "Flag ambiguous",
    card: "border-rose-300 bg-rose-50",
    text: "text-rose-700",
    solid: "border-rose-600 bg-rose-600 text-white",
    bar: "bg-rose-500",
  },
};

export const POLICY_NAME: Record<PolicyId, string> = {
  threshold_baseline: "Confidence threshold",
  rules_only: "Checks only",
  laya_only: "Laya only",
  gradeguard_no_laya: "GradeGuard without Laya",
  gradeguard: "GradeGuard",
};

export const GATE_LABEL: Record<string, string> = {
  work_shown: "show your work",
  route_p: "Laya P(auto-approve)",
  accept_p: "Laya accept P",
  ai_confidence: "grader confidence",
};

export const HEADING = "text-xs font-semibold uppercase tracking-wider text-zinc-500";

export const pct = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "n/a");

export const humanize = (s: string) => s.replaceAll("_", " ");

export const gateFlags = (flags: string[]) => flags.filter((f) => f.startsWith("gate:"));

/** Laya picked an escalation it was unsure of, or one no deterministic signal supports, so a teacher gets it instead. */
export const layaUnsure = (flags: string[]) => flags.some((f) => f === "laya_unsure" || f.endsWith("_uncorroborated"));
