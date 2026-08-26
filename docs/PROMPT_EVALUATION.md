# Prompt Evaluation

**Purpose:** How to change an AI prompt in this repo and know whether the change helped
**Usage:** Read before editing anything in `lib/ai/prompts.ts` or `lib/ai/tools.ts`
**Last Updated:** 2026-08-26

---

## The problem

Every prompt change in this repo has shipped unmeasured. No output was compared before and
after — not once. That includes the five commits that removed venture-scale bias from the
verdict path (`ad732e0`, `3abefa4`, `415cf8a`, `21a5a04`, `9a53b61`).

That does not make those changes wrong. It makes them **arguments** rather than
**measurements**, and the distinction is worth keeping straight:

| Change | Basis | Strength |
|---|---|---|
| Canvas contrast ratios | WCAG luminance formula vs published thresholds | Measured. Also caught a regression: a proposed fix scored 1.06:1, *worse* than the 1.19:1 bug it replaced |
| Segment-link authorization | Logical proof — the id was validated or it wasn't | Measured |
| `{ error: undefined }` → `{}` | `node -e "JSON.stringify({error: undefined})"` | Measured |
| Dead code removal | `grep` returns empty | Measured |
| **Every prompt change** | Reasoning about what the prompt asks for | **Argued. Zero samples.** |

The arguments may well be right. The point is that nobody can currently tell.

## Before changing a prompt

1. **What construct is this asking the model to score?** "Would this excite investors?" and
   "can this segment fund the business?" are different questions, not different phrasings of
   one question.
2. **Whose goal does it assume?** A criterion that assumes venture ambition measures the
   wrong thing for a bootstrapped user, regardless of how well the model answers it.
3. **Is there a falsifiable prediction?** If you cannot state what you'd expect to see
   change, you cannot tell afterwards whether anything did.
4. **What might this break?** Prompt edits have side effects — see *Open risks* below.

## Three design rules for any evaluation

### 1. Judge with a different provider than you generate with

Same-family judges inflate their own family's output; the scores correlate with the
generator rather than with quality. This repo has `@ai-sdk/anthropic`, `@ai-sdk/openai`, and
a `DEEPSEEK_API_KEY` — use one to generate and a different one to judge.

### 2. Prefer deterministic checks over an LLM judge

Most of what you want to know is mechanically checkable. For `whatAbout` (the single open
question in the verdict):

- Does it reuse nouns that actually appear in the canvas content, or is it generic?
- Is it one sentence, ending in `?`
- Is it a disguised suggestion — does it open with "have you considered", "you should",
  "why not"? A suggestion in question form is not an open question.

Zero variance, no judge bias, costs nothing. Reach for an LLM judge only where semantic
judgement is genuinely unavoidable.

### 3. Calibrate thresholds against hand-labelled examples

"If the score is too low, change it" needs a definition of *low*. An invented rubric weight
plus an invented cutoff is exactly the 40/30/30 composite deleted in `9a53b61` — a product
judgement presented as a number — wearing a lab coat. Label examples by hand first, then set
the threshold from the observed spread.

## Do not fine-tune

Fine-tuning is the wrong tool here, and not only on cost grounds:

- **It would cement the bias.** The only data available is output generated *under* the
  biased prompt. Training on it teaches the model to reproduce "would this excite
  investors?" — moving the bias from one editable line of text into weights, where removing
  it is far harder.
- **There is no labelled data.** Zero canvases carry expert scores. A judgement task needs
  hundreds to thousands.
- **It forfeits cross-model judging**, which rule 1 depends on.
- The failure was never that the model *couldn't* do the task. It was being asked the wrong
  question. Wrong questions are fixed by editing the question.

Revisit only if a well-written prompt demonstrably cannot match expert judgement *and*
labelled data exists to prove it.

## Open risks from the current work

**`21a5a04` removed the 0-100 breakdown request from the verdict prompt.** Asking a model for
intermediate structured quantities can scaffold its qualitative reasoning — the numbers force
a commitment before the prose. Deleting that request may have made `factorsUp` /
`factorsDown` vaguer. **Untested.** This is the second experiment below.

**`ad732e0` replaced segment criterion 6** ("Investor attractiveness" → "Segment economics").
The old wording is vivid and produces a confident signal; the new one is more abstract and
may produce mushier scores. Also untested — this is the first experiment.

**Previously persisted scorecards keep their old criterion names** until re-scored. The UI
renders `criterion.name` from stored data, so old rows still display the old worldview.

## Next step: the segment-scoring differential

The only target with a falsifiable directional hypothesis. Run this before building any
standing harness — the fixtures and runner become the harness's foundation, so nothing is
wasted, but a result that changes your mind is worth more than a framework nobody runs.

**Setup**

- Two canvas fixtures: one venture-shaped (a marketplace with network effects) and one
  deliberately bootstrapped (niche B2B tool, ~$15k/mo, no growth story).
- Two prompt versions: current, and `git show ad732e0^:lib/ai/prompts.ts` — criterion 6 at
  line 420 reads "**Investor attractiveness** (weight 0.30)".
- N=5 per cell, 4 cells, ~20 calls.

**Prediction to falsify:** the old prompt penalises the bootstrapped canvas on criterion 6
relative to the venture canvas, and the new prompt narrows that gap. **If there is no
interaction, `ad732e0` was cosmetic** — and that finding should reshape the whole evaluation
effort rather than be explained away.

**Second experiment, only once the method has proved itself:** `factorsUp` / `factorsDown`
specificity, old vs new verdict prompt, same canvas. Measures the scaffolding risk above.
Specificity is checkable without a judge — do the factors cite concrete nouns from the
canvas, or generic filler ("market risk", "unproven demand")?

**Output is a findings table, not a passing test.** Run it as a scratch script. Do **not**
add it to `npm test`: it needs network, costs money, and varies run to run.

## Reusable code

| What | Where |
|---|---|
| Verdict prompt builder | `getViabilityPrompt` — lib/ai/prompts.ts:725 |
| Deep-dive prompt builder (segment scoring) | `buildDeepDivePrompt` — lib/ai/prompts.ts:565 |
| Model call with usage logging | `generateTextWithLogging` — lib/ai/logger.ts:84 |
| Model/tier selection | `getModelForPurpose` — lib/ai/models.ts:50 |
| Q/PTP derivation (score-free, count-based) | `deriveQptpFromViability` — lib/utils/evidence-counts.ts:27 |

## Related

- [lib/ai/PROMPT_TEMPLATES.md](../lib/ai/PROMPT_TEMPLATES.md) — the prompts themselves
- [docs/plans/2026-02-16-viability-score-system-design.md](plans/2026-02-16-viability-score-system-design.md) — **superseded**; describes the deleted 0-100 score
