/** `pnpm eval [--json]`: route every synthetic case through every policy and print the metrics. */
import { evaluateAll } from "@/lib/evaluation/evaluator";
import { closeLaya, getLayaStatus } from "@/lib/laya/client";
import { DECISION_ACTIONS, POLICY_IDS } from "@/types/decision";
import type { EvalReport } from "@/types/evaluation";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const row = (cells: Array<[string | number, number]>) => cells.map(([v, w]) => String(v).padEnd(w)).join(" ").trimEnd();

function printTables(report: EvalReport) {
  const n = report.cases.length;
  console.log(`\nGradeGuard evaluation: ${n} cases\n`);

  console.log("Per-policy metrics");
  const mw: Array<[string, number]> = [
    ["policy", 19], ["accuracy", 14], ["HR prec", 8], ["HR rec", 8], ["esc prec", 9], ["esc rec", 8], ["false auto", 11], ["unneeded HR", 11], ["reason acc", 10],
  ];
  console.log(row(mw));
  for (const p of POLICY_IDS) {
    const m = report.policies[p];
    const vals = [p, `${m.correct}/${m.total} ${pct(m.accuracy)}`, pct(m.humanReview.precision), pct(m.humanReview.recall),
      pct(m.escalation.precision), pct(m.escalation.recall), m.falseAutoApprovals, m.unnecessaryHumanReviews, `${m.reasonAccuracy.correct}/${m.reasonAccuracy.total}`];
    console.log(row(vals.map((v, i): [string | number, number] => [v, mw[i][1]])));
  }
  console.log("(precision/recall with an empty denominator are shown as 0.0%)");
  console.log("(reason acc: primaryReason = expected reason, over cases routed to the expected non-auto_approve action)");

  console.log("\nPer-case routing (✓ = matches expected)");
  const pw = 19; // longest policy id + 1
  console.log(row([["id", 10], ["category", 17], ["expected", 15], ...POLICY_IDS.map((p): [string, number] => [p, pw]), ["gradeguard reason", 0]]));
  for (const c of report.cases) {
    const preds = POLICY_IDS.map((p): [string, number] => [`${c.decisions[p].action} ${c.correct[p] ? "✓" : "✗"}`, pw]);
    console.log(row([[c.caseId, 10], [c.category, 17], [c.expected, 15], ...preds, [c.decisions.gradeguard.primaryReason, 0]]));
  }

  console.log("\ngradeguard confusion matrix (rows = expected, cols = predicted)");
  console.log(row([["", 15], ...DECISION_ACTIONS.map((a): [string, number] => [a, 15])]));
  for (const e of DECISION_ACTIONS) {
    const conf = report.policies.gradeguard.confusion[e];
    console.log(row([[e, 15], ...DECISION_ACTIONS.map((p): [number, number] => [conf[p], 15])]));
  }

  const latencies = report.cases.flatMap((c) => (c.laya ? [c.laya.latencyMs] : []));
  const meanLaya = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const status = getLayaStatus();
  console.log(`\nTotal time: ${report.durationMs.toFixed(0)} ms`);
  console.log(`Mean Laya latency: ${meanLaya === null ? "n/a" : `${meanLaya.toFixed(0)} ms`} over ${latencies.length}/${n} cases`);
  if (status.state === "ready") console.log(`Laya model load: ${status.loadMs.toFixed(0)} ms (included in total time)`);
}

async function main(): Promise<number> {
  const report = await evaluateAll();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printTables(report);

  let code = 0;
  if (!report.layaAvailable) {
    const missing = report.cases.filter((c) => c.laya === null).map((c) => c.caseId);
    console.error(`\nLaya was unavailable for ${missing.length}/${report.cases.length} cases (${missing.join(", ")}).`);
    console.error(`Laya status: ${JSON.stringify(getLayaStatus())}`);
    console.error("Run `pnpm laya:download` first; laya_only/gradeguard results above are not a Laya evaluation.");
    code = 1;
  }
  // Release the ONNX session before exiting: otherwise onnxruntime-node intermittently aborts during
  // process teardown ("libc++abi ... recursive_mutex lock failed"), turning a clean run into a crash.
  await closeLaya();
  return code;
}

// Exit only after stdout drains: on macOS a piped stdout is async, and process.exit would truncate `--json | jq`.
main().then(
  (code) => process.stdout.write("", () => process.exit(code)),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
