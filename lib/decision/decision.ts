import {
  DECISION_ACTIONS,
  ESCALATION_REASONS,
  POLICY_IDS,
  type Decision,
  type DecisionAction,
  type DecisionSignals,
  type EscalationReason,
  type LayaAnswers,
  type PolicyId,
} from "@/types/decision";

/**
 * Round values held fixed rather than fitted to individual evaluation cases, so a case near a gate
 * stays on whichever side it falls.
 */
export const THRESHOLDS = {
  /** Laya's P(auto_approve) must reach this before an auto-approve is honoured. */
  autoApproveRouteP: 0.45,
  /** Laya's `accept` answer, P("can be accepted without a teacher checking it"), must reach this. */
  autoApproveAcceptP: 0.5,
  /** The grader's own confidence must reach this: Laya never auto-approves a grade its grader doubts. */
  autoApproveAiConfidence: 0.8,
  /** Below this probability on its chosen action, Laya itself is unsure and the case goes to a teacher. */
  minRouteP: 0.35,
  /** threshold_baseline: auto-approve at or above this grader confidence, otherwise human review. */
  baselineAiConfidence: 0.85,
  /** Soft rules: below this grader confidence an alternative path or a carried-through error needs a teacher. */
  softRuleAiConfidence: 0.85,
} as const;

type Verdict = { action: DecisionAction; primaryReason: EscalationReason; flag: string; text: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number) => x.toFixed(2);
const f3 = (x: number) => x.toFixed(3);

/** Invariants a teacher would never want auto-approved. First match wins. */
function hardGuardrail(s: DecisionSignals): Verdict | null {
  if (s.workCompleteness === "none" || s.detectedIssues.includes("blank") || s.detectedIssues.includes("off_task"))
    return {
      action: "flag_ambiguous",
      primaryReason: "insufficient_evidence",
      flag: "guardrail:no_work",
      text: "No work for this problem was found (blank or off-task), so a score says nothing about what the student knows.",
    };
  if (s.transcriptionRisk === "likely")
    return {
      action: "flag_ambiguous",
      primaryReason: "transcription_issue",
      flag: "guardrail:transcription_likely",
      text: "The handwriting transcription is unreliable, so the grade may rest on misread work. Someone should check the original page.",
    };
  if (!s.gradeConsistentWithAnswer)
    return {
      action: "regrade",
      primaryReason: "grade_reasoning_conflict",
      flag: "guardrail:grade_contradicts_answer",
      text: `The grader says "${s.answerCorrectness}" but the final answer ${s.finalAnswerMatchesExpected ? "matches" : "does not match"} the expected answer, so the grade contradicts itself.`,
    };
  if (!s.scoreConsistentWithRubric)
    return {
      action: "regrade",
      primaryReason: "possible_grading_error",
      flag: "guardrail:score_contradicts_rubric",
      text: "The awarded score does not match the points implied by the grader's own rubric step marks.",
    };
  return null;
}

/**
 * Deterministic soft signals, most specific first. rules_only takes the first match as its decision;
 * gradeguard uses the first match only to explain a Laya escalation. Every action except the first is
 * human_review, so the order among them only changes which reason is shown.
 */
const SOFT_RULES: Array<{ when: (s: DecisionSignals) => boolean; action: DecisionAction; reason: EscalationReason; text: (s: DecisionSignals) => string }> = [
  {
    when: (s) => s.ambiguity === "high",
    action: "flag_ambiguous",
    reason: "ambiguous_reasoning",
    text: (s) => `Ambiguity is high and the grader's confidence is ${fmt(s.aiConfidence)}.`,
  },
  {
    when: (s) => s.transcriptionRisk === "possible",
    action: "human_review",
    reason: "transcription_issue",
    text: () => "The handwriting transcription may have misread part of the work.",
  },
  {
    when: (s) => s.detectedIssues.includes("unclear_reasoning"),
    action: "human_review",
    reason: "ambiguous_reasoning",
    text: (s) => `The grader flagged the student's reasoning as unclear and its confidence is ${fmt(s.aiConfidence)}.`,
  },
  {
    when: (s) => s.workCompleteness === "minimal" && s.answerCorrectness !== "incorrect",
    action: "human_review",
    reason: "incomplete_work",
    text: () => "Little or no work is shown, so whether the answer earns credit is the teacher's call.",
  },
  {
    when: (s) => s.alternativeSolutionPath && s.aiConfidence < THRESHOLDS.softRuleAiConfidence,
    action: "human_review",
    reason: "unusual_solution_path",
    text: (s) => `The student used a non-reference method and the grader's confidence is only ${fmt(s.aiConfidence)}.`,
  },
  {
    when: (s) => s.detectedIssues.includes("error_propagation") && s.aiConfidence < THRESHOLDS.softRuleAiConfidence,
    action: "human_review",
    reason: "possible_grading_error",
    text: (s) => `An early error was carried through the later steps and the grader's confidence is ${fmt(s.aiConfidence)}, so the partial credit may be unfair.`,
  },
  {
    when: (s) => s.confidenceBand !== "high",
    action: "human_review",
    reason: "low_confidence",
    text: (s) => `Grader confidence is ${fmt(s.aiConfidence)} (${s.confidenceBand}).`,
  },
];

const softRule = (s: DecisionSignals) => SOFT_RULES.find((r) => r.when(s)) ?? null;

/** Laya's reason for an escalation. Laya often escalates while answering reason "none"; "none" is reserved for auto_approve. */
const layaReason = (laya: LayaAnswers): EscalationReason => (laya.reason.choice === "none" ? "possible_grading_error" : laya.reason.choice);

const cleanText = (s: DecisionSignals) =>
  `The grader is ${pct(s.aiConfidence)} confident in a "${s.answerCorrectness}" grade that agrees with the answer check and its rubric marks.`;

function fromGuardrail(policy: PolicyId, v: Verdict): Decision {
  return { action: v.action, confidence: 1, reason: v.text, primaryReason: v.primaryReason, flags: [v.flag], source: "guardrail", policy };
}

function layaUnavailable(policy: PolicyId): Decision {
  return {
    action: "human_review",
    confidence: 0,
    reason: "Laya was unavailable and no guardrail applied, so the grade defaults to human review.",
    primaryReason: "laya_unavailable",
    flags: ["laya_unavailable"],
    source: "fallback",
    policy,
  };
}

/** Stand-in Laya answer for the no-Laya ablation: always auto_approve. */
const CONSTANT_APPROVE_LAYA: LayaAnswers = {
  route: { choice: "auto_approve", probabilities: Object.fromEntries(DECISION_ACTIONS.map((a) => [a, a === "auto_approve" ? 1 : 0])) as Record<DecisionAction, number> },
  accept: { probability: 1 },
  reason: { choice: "none", probabilities: Object.fromEntries(ESCALATION_REASONS.map((r) => [r, r === "none" ? 1 : 0])) as Record<EscalationReason, number> },
  model: "constant (no Laya)",
  inputTokens: 0,
  latencyMs: 0,
};

function thresholdBaseline(s: DecisionSignals): Decision {
  const ok = s.aiConfidence >= THRESHOLDS.baselineAiConfidence;
  return {
    action: ok ? "auto_approve" : "human_review",
    confidence: s.aiConfidence,
    reason: `Grader confidence ${fmt(s.aiConfidence)} is ${ok ? "at or above" : "below"} the ${THRESHOLDS.baselineAiConfidence} auto-approve threshold.`,
    primaryReason: ok ? "none" : "low_confidence",
    flags: ok ? [] : ["below_confidence_threshold"],
    source: "threshold",
    policy: "threshold_baseline",
  };
}

function rulesOnly(s: DecisionSignals): Decision {
  const hard = hardGuardrail(s);
  if (hard) return fromGuardrail("rules_only", hard);
  const r = softRule(s);
  if (r) return { action: r.action, confidence: 1, reason: r.text(s), primaryReason: r.reason, flags: [`rule:${r.reason}`], source: "guardrail", policy: "rules_only" };
  return { action: "auto_approve", confidence: 1, reason: cleanText(s), primaryReason: "none", flags: [], source: "guardrail", policy: "rules_only" };
}

function layaOnly(laya: LayaAnswers): Decision {
  const action = laya.route.choice;
  return {
    action,
    confidence: laya.route.probabilities[action],
    reason: `Laya's raw route choice is ${action} (p ${fmt(laya.route.probabilities[action])}), with no guardrails applied.`,
    primaryReason: action === "auto_approve" ? "none" : layaReason(laya),
    flags: [`laya_reason:${laya.reason.choice}`],
    source: "laya",
    policy: "laya_only",
  };
}

function gradeguard(s: DecisionSignals, laya: LayaAnswers | null, policy: PolicyId): Decision {
  const hard = hardGuardrail(s);
  if (hard) return fromGuardrail(policy, hard);
  if (!laya) return layaUnavailable(policy);

  const ablation = policy === "gradeguard_no_laya";
  const choice = laya.route.choice;
  const p = laya.route.probabilities;
  const flags = [`laya_reason:${laya.reason.choice}`];
  const decision = (action: DecisionAction, primaryReason: EscalationReason, reason: string): Decision => ({
    action,
    confidence: ablation ? 1 : action === "auto_approve" ? p.auto_approve : 1 - p.auto_approve,
    reason,
    primaryReason,
    flags,
    // The ablation is decided by rules alone, so it is reported like a guardrail.
    source: ablation ? "guardrail" : "laya",
    policy,
  });

  if (choice === "auto_approve") {
    const who = ablation ? "The constant stand-in for Laya" : "Laya";
    // Show-your-work policy, not a tuned number: almost no work shown means the teacher decides on credit.
    if (s.workCompleteness === "minimal") {
      flags.push("gate:work_shown");
      return decision("human_review", "incomplete_work", "The answer may be right, but almost no work is shown, so credit for the steps is the teacher's call.");
    }
    const failed: string[] = [];
    if (p.auto_approve < THRESHOLDS.autoApproveRouteP) {
      flags.push("gate:route_p");
      failed.push(`Laya's P(auto_approve) ${f3(p.auto_approve)} is below the ${THRESHOLDS.autoApproveRouteP} gate`);
    }
    if (laya.accept.probability < THRESHOLDS.autoApproveAcceptP) {
      flags.push("gate:accept_p");
      failed.push(`accept P ${f3(laya.accept.probability)} is below ${THRESHOLDS.autoApproveAcceptP}`);
    }
    if (s.aiConfidence < THRESHOLDS.autoApproveAiConfidence) {
      flags.push("gate:ai_confidence");
      failed.push(`grader confidence ${fmt(s.aiConfidence)} is below ${THRESHOLDS.autoApproveAiConfidence}`);
    }
    if (failed.length === 0) return decision("auto_approve", "none", `${cleanText(s)} ${who} agrees (p ${fmt(p.auto_approve)}).`);
    const gates = `${who} leaned to auto-approve, but ${failed.join(" and ")}.`;
    const r = softRule(s);
    return decision("human_review", r?.reason ?? "low_confidence", r ? `${r.text(s)} ${gates}` : gates);
  }

  if (p[choice] < THRESHOLDS.minRouteP) {
    flags.push("laya_unsure");
    return decision("human_review", "low_confidence", `Laya is unsure: its top choice, ${choice}, has only p ${fmt(p[choice])}.`);
  }

  // A Laya regrade or flag needs deterministic support. The grade-vs-answer and score-vs-rubric guardrails
  // already found no contradiction, so a regrade goes to a teacher; so does a flag with low ambiguity and no
  // transcription risk.
  let action: DecisionAction = choice;
  if (choice === "regrade") {
    action = "human_review";
    flags.push("regrade_uncorroborated");
  } else if (choice === "flag_ambiguous" && s.ambiguity === "low" && s.transcriptionRisk === "none") {
    action = "human_review";
    flags.push("flag_uncorroborated");
  }

  const r = softRule(s);
  // Laya's reason is used only if the guardrails have not already ruled it out: they check contradictions,
  // likely misreads and missing work deterministically, and none of them fired.
  const refuted = ["grade_reasoning_conflict", "transcription_issue", "insufficient_evidence"].includes(laya.reason.choice);
  const primaryReason = r?.reason ?? (refuted ? "possible_grading_error" : layaReason(laya));
  const why = r ? r.text(s) : "No deterministic signal explains the doubt, but Laya would not accept the grade.";
  const routed = action === choice ? `Laya routes it to ${choice} (p ${fmt(p[choice])}).` : `Laya chose ${choice} (p ${fmt(p[choice])}); without supporting signals it goes to a teacher instead.`;
  return decision(action, primaryReason, `${why} ${routed}`);
}

/** One policy's decision. Pure: same (signals, laya) in, same Decision out. laya null = Laya unavailable. */
export function decide(signals: DecisionSignals, laya: LayaAnswers | null, policy: PolicyId): Decision {
  switch (policy) {
    case "threshold_baseline":
      return thresholdBaseline(signals);
    case "rules_only":
      return rulesOnly(signals);
    case "laya_only":
      return laya ? layaOnly(laya) : layaUnavailable(policy);
    case "gradeguard_no_laya":
      return gradeguard(signals, CONSTANT_APPROVE_LAYA, policy);
    case "gradeguard":
      return gradeguard(signals, laya, policy);
  }
}

export function decideAll(signals: DecisionSignals, laya: LayaAnswers | null): Record<PolicyId, Decision> {
  return Object.fromEntries(POLICY_IDS.map((p) => [p, decide(signals, laya, p)])) as Record<PolicyId, Decision>;
}
