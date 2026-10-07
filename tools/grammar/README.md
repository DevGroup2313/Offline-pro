# Stage C: Inkwell against Grammarly, measured

## What can and cannot be compared

Grammarly runs on Grammarly's servers and could not be run here, so no
side-by-side score against Grammarly exists in this record. What follows
measures Inkwell's own engines with the standard method for grammar
correction (ERRANT span-based F0.5), finds where they fall short, closes the
gaps that can be closed offline, and measures again on data that was not used
for any choice.

## Data (used for measurement only; not in this repository)

- Write & Improve (W&I), the learner-essay part of the BEA-2019 shared task
  development set (non-commercial research licence). 3,396 sentences, split
  at random into a tuning half (`wi_tune`) and a report half (`wi_report`).
  The LOCNESS part was left out: its licence is stricter.
- CoNLL-2014 test set, 1,312 sentences, both annotators, converted to ERRANT
  with `conll_errant.py`. Never used for a choice.
- 3,000 correct English Wikipedia sentences: 1,500 for tuning, 1,500 for the
  report. Here every change counts against a system (an upper bound: some
  Wikipedia sentences have real slips, and some changes fix them).

## Measures

- Precision: the share of a system's fixes that match a human corrector's.
- Recall: the share of the human correctors' fixes the system made.
- F0.5: the usual single score, weighting precision twice as much as recall.
- Correct text changed: the share of correct Wikipedia sentences a system
  gave at least one suggestion.

`score.py` re-tokenises only the words a system changed, so tokenisation adds
no false edits (checked: a system that changes nothing scores 0 false
positives on every set).

## Findings on the tuning sets

1. The rules engine is precise but catches about 1% of learner errors
   (precision 58%, recall 0.9%). It was built for careful academic writing.
2. Inkwell had no dictionary spelling checker, only a list of common
   misspellings. Spelling is one of the commonest learner errors.
3. The small grammar model GECToR (removed from the app in 7.33 at the
   writer's request) was the strongest engine measured: F0.5 0.42 at its old
   setting, 0.48 at a less cautious one.
4. The grammar model was only ever used for "Fix selection"; its suggestions
   never reached the list.
5. The Fire tablet's writing model (LFM2.5 1.2B), used as a proofreader with
   the app's prompt and safety filter, is weaker than GECToR at correcting
   (W&I report half: precision 56.6%, recall 14.3%, F0.5 0.356). Adding its
   fixes to GECToR's raised recall (28% against 23%) but lowered precision
   (61% against 69%), for the same F0.5.

## What changed in the app

- A dictionary spelling checker (`src/lib/spell_core.js`), offline, on every
  device: SCOWL word lists (British, American and Canadian spellings,
  171,223 words; permissive licence, `vendor/SCOWL-LICENCE.txt`), suggestions
  ranked by keyboard slips and word frequency, run-together words ("alot",
  "eventhough"), names written in lower case ("sunday"). A word it is unsure
  of is marked with suggestions and no fix. Citations, web addresses and the
  References section are skipped. "Add to dictionary" on the card and in the
  hover bubble; a switch and the word list in Studio, Rules. About 2 to 6 ms
  per check of a 1,100-word document.
- The grammar model, if it is offered again, would now read every paragraph
  live and its suggestions would join the list; its confidence setting is
  0.7. It stays removed until the writer decides.

## Results on the report sets (not used for any choice)

Inkwell as shipped (rules, and from 7.36 the spelling checker):

| Set | Before 7.36: P / R / F0.5 | 7.36: P / R / F0.5 |
|---|---|---|
| W&I report half (1,698 sentences) | 67.7% / 1.3% / 0.061 | 63.2% / 3.4% / 0.140 |
| CoNLL-2014 (1,312 sentences) | 46.2% / 0.3% / 0.015 | 78.6% / 5.0% / 0.199 |
| Correct Wikipedia changed (1,500) | 1.6% | 3.5% |

Spelling alone on the W&I report half (ERRANT category R:SPELL): 63% of
its fixes match a human's, and it fixes 48% of the spelling errors (on the
tuning half, where its settings were chosen: 68% and 56%).

For the record, the engines the app does not run by default:

| Engine (W&I report half) | P | R | F0.5 | Correct text changed |
|---|---|---|---|---|
| GECToR at 0.8, with rules (the 7.32 app) | 71.9% | 16.4% | 0.428 | 5.6% |
| GECToR at 0.7, rules and spelling | 69.3% | 23.4% | 0.498 | 9.9% |
| LFM2.5 1.2B (the Fire's writing model), filtered | 56.6% | 14.3% | 0.356 | not measured |

On CoNLL-2014, GECToR at 0.7 with rules and spelling: precision 76.7%,
recall 28.9%, F0.5 0.576 (the 7.32 app: 81.7%, 21.8%, 0.527).

## Features beyond correctness (Grammarly, as described in 2026 reviews)

Present in Inkwell before Stage C: clarity and wordiness notes, passive
voice, readability, tone rewrites and hedging checks, goals, a thesaurus,
rewriting with your own prompt and a prompt library, drafting, reader
reactions, a reviewer that raises objections, citations in Zotero's styles,
British and American variants, lessons on every card.

Added in Stage C: the spelling checker; an authorship report (how much of a
page was typed, pasted, written by a model, accepted from suggestions,
dictated or inserted by Inkwell, with a list of the pasted, dictated and
model-written passages, and a report to save).

Not offered, and why:
- A plagiarism check against the web needs the web and a commercial index;
  Inkwell compares a page with your own library only.
- An AI-text detector: Inkwell explains why no detector can prove
  authorship; the authorship report records how the text was written instead.
- An essay grader with a rubric: not yet built.

## Reproducing

`prep.py` (data), `conll_errant.py`, `score.py`, `runrules.mjs` (the real
page), `runspell.js`, `rungector.mjs`, `runllm.py` (llama-server), `combine.js`
(the sources together, as the app combines them), `cleanrate.js`. Paths in
the scripts point at the measurement folder used on 7 October 2026.
