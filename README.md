# GradeGuard

GradeGuard is a small prototype of the check that sits after an AI math grader and decides which grades a teacher needs to see. It does not grade anything. It reads the grader's output, runs a few deterministic consistency checks, asks [Laya](https://github.com/NandhaKishorM/laya) (a small decision model that runs locally) three typed questions, and routes each grade to one of four outcomes: auto-approve, human review, regrade, or flag the page. It is modelled on what [Frizzle](https://www.frizzle.com/) says publicly about its grading workflow. The grader is a mock and all student work is synthetic.

**Result on 18 synthetic cases.** A plain confidence threshold routes 11 of 18 correctly and auto-approves two grades a teacher should have seen. Four deterministic checks plus the auto-approve gates get 17 of 18 with no false auto-approvals. Adding zero-shot Laya gets 16 of 18: it changes one decision, and gets it wrong. The checks do the work today. Laya is the part that would need fine-tuning on teacher-override data to earn its place.

## Why

An AI grader already returns a grade, a short reasoning, feedback and a confidence. Most grades do not need a second grading model. They need a cheap check on whether the grade can be trusted enough to skip the teacher. A confidence threshold misses the grades that are confident and still wrong about themselves: a "correct" label on a wrong final answer, a score that disagrees with the grader's own rubric marks, a grade that rests on a misread handwritten sign.

The signals follow what Frizzle describes publicly:

| Frizzle says | GradeGuard signal | Cases |
|---|---|---|
| reads every step, not just the final answer | per-step rubric marks and a score-vs-rubric check | 010 |
| credits multiple valid approaches | `alternativeSolutionPath` | 005, 013, 018 |
| partial credit | step marks, `partialCredit` | 004, 010, 011 |
| named misconceptions | `misconception` | 002, 014 |
| shows where the thinking went off | `firstErrorStep`, `error_propagation` | 004, 011 |
| low-confidence pages get a human check | `transcriptionRisk`, kept separate from grader confidence | 009, 016 |

## How a decision is made

```
Submission → AI grader (mock) → Consistency checks → Laya → Gates → Decision
                                                                    ├ auto_approve
                                                                    ├ human_review
                                                                    ├ regrade
                                                                    └ flag_ambiguous
```

1. **Signals** (`lib/decision/signals.ts`) are deterministic: a final-answer cross-check (order-free, handles ±), the score against the points implied by the grader's own step marks, completeness, ambiguity, and transcription risk for handwritten work.
2. **Hard guardrails** run first and Laya cannot override them: no work → flag; likely transcription error → flag; grade contradicts the final-answer check → regrade; score contradicts the rubric marks → regrade.
3. **Laya** (`lib/laya/`) gets one call with three typed questions on a compact JSON state about the grade's reliability: grader confidence, evidence, concerns. It is not sent the question, the answers or the grade label. With those in the state, zero-shot Laya judged the student instead of the grade.

   | question | type | used for |
   |---|---|---|
   | What should happen next with this AI grading result? | choice over the four outcomes | the route and its probabilities |
   | Can this AI grade be accepted without a teacher checking it? | yes/no | P(yes) |
   | What is the main reason this grade needs escalation? | choice over eight reasons plus none | shown, not routed on |

4. **Gates** on a Laya auto-approve. Almost no work shown → teacher. Laya's P(auto-approve) below 0.45, accept P below 0.5, or grader confidence below 0.8 → teacher. A Laya regrade or flag that no deterministic signal supports also goes to a teacher, and so does any Laya choice it gives less than 0.35 probability.
5. If Laya cannot load, the guardrails still run and everything else goes to a teacher. Nothing fabricates a Laya answer.

`auto_approve` means no teacher attention needed, not released to students. `regrade` means send the grade back with the detected contradiction attached. `flag_ambiguous` means the page, not the grade, is the problem. Frizzle does not document a regrade step; those two outcomes are this prototype's design.

## Why Laya

Laya (Convai Innovations, Apache-2.0) is a non-autoregressive decision model: a state plus typed questions in, a probability per option out, in one forward pass. There is no text to parse. The three questions take about 0.3 s per case on a laptop CPU and the model runs in-process, so nothing leaves the machine.

- This runs [`@receptron/laya`](https://github.com/receptron/laya), a third-party ONNX port of the English base checkpoint, because the official TypeScript packages are not on npm.
- The base checkpoint is weak zero-shot on custom decisions by the vendor's own benchmark (0.362 against a 0.461 majority baseline; the fine-tuned typed-decisions checkpoint reaches 0.766). The [Laya README](https://github.com/NandhaKishorM/laya/blob/main/README.md) calls it "a fast base to specialise, not a zero-shot decision engine".
- Its probabilities are uncalibrated and its `confidence` field is 1 minus normalized entropy, so the gates use `probabilities[choice]`.

## Evaluation

`lib/evaluation/cases.ts` holds 18 cases over nine questions, each with the outcome a teacher would want. Expected mix: 7 auto-approve, 5 teacher review, 2 regrade, 4 flag.

| id | case | expected |
|---|---|---|
| 001 | Complete, correct typed solution | auto_approve |
| 002 | Clearly wrong method, graded confidently and consistently | auto_approve |
| 003 | Correct final answer with no work shown | human_review |
| 004 | Correct method, sign dropped in the last step | auto_approve |
| 005 | Valid factoring solution where the reference takes square roots | auto_approve |
| 006 | Two different final answers written (x = 3 and x = 12) | flag_ambiguous |
| 007 | Grader unsure how to score an order-of-operations slip | human_review |
| 008 | Confident "correct" grade on a wrong final answer | regrade |
| 009 | Handwritten minus signs the transcription could not read | flag_ambiguous |
| 010 | Score contradicts the grader's own step marks | regrade |
| 011 | Early slip carried through consistently but penalised in every later step | human_review |
| 012 | Blank answer | flag_ambiguous |
| 013 | Valid completing-the-square solution penalised for not matching the rubric | human_review |
| 014 | Adds numerators and denominators | auto_approve |
| 015 | Work for a different problem | flag_ambiguous |
| 016 | Clean handwritten solution | auto_approve |
| 017 | Skipped substitution step, grader moderately confident | human_review |
| 018 | System solved by substitution where the reference uses elimination | auto_approve |

A wrong answer graded correctly and consistently (002, 014) is auto-approved on purpose: the layer judges the grade, not the student.

`pnpm eval` runs every case through five policies with the real local Laya:

| policy | routed as expected | HR precision | HR recall | false auto-approvals | unnecessary reviews |
|---|---|---|---|---|---|
| Confidence threshold (grader confidence ≥ 0.85) | 11/18 | 44% | 80% | 2 | 0 |
| Checks only (guardrails and hand-written rules) | 17/18 | 83% | 100% | 0 | 0 |
| Laya only (its raw route) | 9/18 | 0% | 0% | 8 | 0 |
| GradeGuard without Laya (constant auto-approve into the gates) | 17/18 | 83% | 100% | 0 | 0 |
| GradeGuard | 16/18 | 71% | 100% | 0 | 1 |

What this shows:

- The threshold auto-approves 008, a 96%-confident "correct" grade on x = 4 where the answer is x = 3. The answer cross-check catches it.
- Laya on its own is not a router. It picks auto-approve on 15 of 18 cases, two better than always answering auto-approve.
- Laya changes exactly one GradeGuard decision: case 002, where its P(auto-approve) is 0.446 against the 0.45 gate. Case 014, whose Laya input differs only by one point of grader confidence, passes at 0.454.
- Case 006 is the shared miss: two final answers on one page reads as medium ambiguity, so every policy except Laya-only (which auto-approves it) sends it to a teacher instead of flagging it.
- Rules, gates and the JSON sent to Laya were all chosen with these 18 cases in view. There is no held-out set, so none of this measures generalisation.

## Running locally

Node 22.12 or newer, pnpm 9, about 2 GB of RAM for the loaded model and 1.6 GB of disk for the weights.

```bash
nvm use              # or any Node 22.12 or newer
corepack enable
pnpm install
pnpm laya:download   # once; caches the ONNX bundle under ~/.cache/receptron-laya
pnpm dev             # http://localhost:3000
pnpm eval            # all 18 cases, five policies; --json for the full report
pnpm test            # vitest; the real-model tests skip if the bundle is missing
pnpm typecheck && pnpm lint
```

`LAYA_MODEL_DIR` points the app at a bundle elsewhere; `LAYA_CACHE` moves the cache. A grading request never starts the download. Without the bundle the API returns `laya: null` and the UI says so.

The API is three routes: `POST /api/grade` with `{ "submissionId": "case-008" }` returns the submission, the grade, the signals, the state sent to Laya, Laya's answers and every policy's decision; `GET /api/evaluate` returns the full report; `GET /api/laya/status` reports whether the model is loaded.

## Limitations

- The grader is a mock that returns a hand-written grade per case, and the 18 cases are hand-written too. Nothing here has seen real student work.
- No held-out set. The rules, thresholds and Laya prompt were tuned on the evaluation cases.
- Only the English base checkpoint, zero-shot, through a third-party ONNX port. The fine-tuned checkpoint is not reachable from Node.
- No OCR. Transcription confidence for handwritten cases is part of the fixture.
- One in-process Laya session, about 2 GB of RAM, no queue and no retry.

## Next steps

- Fine-tune the `laya-typed-decisions` checkpoint on teacher-override data (which grades teachers accepted or changed). That is the vendor's intended use and the only way Laya can beat the checks.
- Run the same harness on real grader outputs with a held-out split before trusting any threshold.
- Calibrate Laya's probabilities with fitted temperatures so the gates mean what they say.
