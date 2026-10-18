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

On CoNLL-2014 the Fire's writing model scores 67.1% / 20.4% / 0.460.

The same 600 randomly chosen sentences of the W&I report half, every model
through the app's safety filter, with the app's proofreading prompt:

| Engine | P | R | F0.5 |
|---|---|---|---|
| GECToR at 0.7 | 74.0% | 21.1% | 0.493 |
| Qwen3 4B Instruct 2507 (the laptop's measured model) | 59.7% | 23.2% | 0.454 |
| LFM2.5 1.2B (the Fire's model) | 54.5% | 13.5% | 0.339 |
| GECToR, Qwen3 4B, rules and spelling together | 62.4% | 31.7% | 0.522 |

The laptop's "Correct" goes through the companion server's own /api/correct,
whose prompt differs from the one measured here; these rows measure the
models, not that endpoint.

On CoNLL-2014, GECToR at 0.7 with rules and spelling: precision 76.7%,
recall 28.9%, F0.5 0.576 (the 7.32 app: 81.7%, 21.8%, 0.527).

## 7.42: the learner-error checks (stage G2)

The writer's report: "the grammar editor ignores a lot of errors". Measured
again on the tuning half with the whole page pipeline (rules, the gate, the
spelling checker and, from 7.42, the note refiner), the 7.41 app found
4.1% of the learner errors (precision 66.8%). The gold edits by type, on
that half (3,382 edits): missing punctuation 12.5% (369 of them commas),
word choice 11%, prepositions 6.7%, verb tense 5.6%, missing articles 5.4%,
verbs 4.9%, capitals and spacing 4.2%, extra articles 4%, spelling 3.8%,
nouns 3.8%, a noun's number 3.4%.

`src/lib/learner_core.js` adds nine families of checks, each written to
fire only where the fix is certain, with word lists made from the lexicon
(`tools/grammar/learner_lists.mjs`, writing `src/lib/learner_data.js`):
subject-verb agreement (pronoun, plural-noun and singular-noun subjects;
"everyone"; the subjunctive and the collective nouns left alone), verb
forms (after a modal, "did", "to"; enjoy + -ing; want + to; the -ing form
after a preposition, only where a noun could not read the same), a missing
am/is/are, a past marker or a past sentence with a present verb, a noun's
number after many/every/this/one of the, articles and prepositions in fixed
phrases, words run together or split, and the commas learners leave out
(after an opener, after a fronted clause, before "but" and "so" joining two
clauses, after "two years ago"). Each family was scored alone on the tuning
half and on correct text, and its false alarms read and removed; then the
whole was checked on the report half, which no choice was made from.

The whole page pipeline, correctness fixes only ("g"), ERRANT span-based:

| Set | 7.41: TP / FP, P / R / F0.5 | 7.42: TP / FP, P / R / F0.5 |
|---|---|---|
| W&I tuning half (1,698 sentences) | 135 / 67, 66.8% / 4.1% / 0.164 | 226 / 117, 65.9% / 6.8% / 0.241 |
| W&I report half (1,698 sentences) | 148 / 69, 68.2% / 4.6% / 0.181 | 212 / 119, 64.1% / 6.6% / 0.233 |
| Correct Wikipedia changed, tuning (1,500) | 64 (4.3%) | 73 (4.9%) |
| Correct Wikipedia changed, report (1,500) | 55 (3.7%) | 77 (5.1%) |

By type on the report half, 7.42 (precision / recall): capitals and spacing
85% / 28%, spelling 63% / 46%, punctuation 69% / 11%, a noun's number 80% /
7%, verb tense 80% / 4%, agreement 44% / 10%, prepositions 45% / 3%. The
learner checks alone, on the report half: 101 fixes matching a human's, 84
not (55%), 26 of 1,500 correct sentences touched (1.7%); on the tuning half
124 / 65 (66%) and 13 (0.9%).

What this is and is not: the app now finds about one learner error in
fifteen offline, where it found one in twenty-four; two of three of its
fixes are the human corrector's. A neural corrector finds far more (GECToR,
above: one in four, with three of four fixes right), and Grammarly more
still; the rules cannot reach that. Most of what is still missed is word
choice, articles, prepositions and tense inside sentences with no marker,
which need a model of the sentence's meaning. The grammar model stays
available in Engine for those who want it; the writer asked for the
offline rules to hold their own first, and this is where they stand.

The tests: `node tools/grammar/learner_test.js` (91 sentences by hand).
The measurement: `runpage.mjs` in the stage folder (the real page), then
`score.py` and `errant_compare -cat 2`.

## Features beyond correctness (Grammarly, as described in 2026 reviews)

Present in Inkwell before Stage C: clarity and wordiness notes, passive
voice, readability, tone rewrites and hedging checks, goals, a thesaurus,
rewriting with your own prompt and a prompt library, drafting, reader
reactions, a reviewer that raises objections, citations in Zotero's styles,
British and American variants, lessons on every card.

Added in Stage C: the spelling checker; the rubric grader (below); an authorship report (how much of a
page was typed, pasted, written by a model, accepted from suggestions,
dictated or inserted by Inkwell, with a list of the pasted, dictated and
model-written passages, and a report to save).

Not offered, and why:
- A plagiarism check against the web needs the web and a commercial index;
  Inkwell compares a page with your own library only.
- An AI-text detector: Inkwell explains why no detector can prove
  authorship; the authorship report records how the text was written instead.
- An essay grader: built in Stage C (Coach, "Grade against a rubric").
  Templates or your own criteria; each criterion is marked 1 to 5 with
  feedback by the writing model Inkwell is running; Mechanics is counted by
  Inkwell's own checks; a quotation not found in the page, or a name or
  number the page lacks, is marked. In testing, the Fire's small model gave
  every criterion 5 out of 5 on a thesis excerpt, and often gave a mark with
  no feedback; the page says so. No measurement of grading accuracy was
  possible here (no marked essays to compare with).

## Reproducing

`prep.py` (data), `conll_errant.py`, `score.py`, `runrules.mjs` (the real
page), `runspell.js`, `rungector.mjs`, `runllm.py` (llama-server), `combine.js`
(the sources together, as the app combines them), `cleanrate.js`. Paths in
the scripts point at the measurement folder used on 7 October 2026.

## A fault found on the way: the laptop server's model died under two requests

While testing the grader through the companion server, its model runtime
(llama-server) stopped when two requests overlapped; every later request
failed until the server was restarted. From 7.36 the server runs the model
with one request at a time, queues the rest, and starts the runtime again
once if it has stopped. Tested: four requests at once all answered (1.5 s in
all); after the runtime was killed, the next request started it again and was
answered.

## The grammar model returns, in a careful form (opt-in)

At the writer's request ("only if it works well"), GECToR returns as an
opt-in download, only in a careful form chosen on the tuning half:
- the stricter setting (0.8);
- only the kinds of suggestion measured reliable (each 72% to 87% matching a
  human corrector on the tuning half): agreement, articles, prepositions,
  spelling, verb forms. Left out: capital letters (50%), words to add or
  remove (54% to 58%), general grammar (65%), commas (71%, and the most
  suggestions on correct text).

Held-out results:

| | P | R | F0.5 |
|---|---|---|---|
| W&I report half, careful model alone | 80.2% | 10.3% | 0.341 |
| W&I report half, with rules and spelling | 75.7% | 13.2% | 0.388 |
| CoNLL-2014, careful model alone | 85.7% | 17.5% | 0.482 |
| CoNLL-2014, with rules and spelling | 84.1% | 20.4% | 0.517 |

Correct Wikipedia sentences given a suggestion: 2.6% by the careful model
(5.9% with rules and spelling). The writer's own 5,486-word thesis: no
suggestion at all. With one error planted in each of 163 of its sentences
("is" for "are", "a" for "the" and so on), it restored 64 exactly and never
changed a sentence into anything but the original.

In the app (tested in Chromium): Engine, "Turn on the grammar model"; it
reads each paragraph when the writer pauses (about one second for a short
paragraph here) and adds its suggestions to the list; an unchanged
paragraph is never read again.

A fault found and fixed on the way: the shared script block the model's
worker loads now includes the spelling library, which assumed a global the
worker lacks; it stopped the worker (and would have stopped the in-window
writing model too) until fixed.

## 7.37: a learner's pack of rules, and the rewrites made safe

The rules caught 31 of the 3,309 errors marked in the tuning half. Most of
what learners get wrong (missing commas, word choice, prepositions, tense,
articles) needs the sentence's sense, which rules cannot read; a few classes
can be caught with certainty, and 7.37 adds them: irregular verbs given -ed
("buyed"), nouns with no plural ("informations"), irregular plurals
("childs"), a modal with "to" or the wrong form ("can to go", "didn't went",
"can gives"), "more better", a comma after an opening "However" or "In my
opinion", "people is", "everyday" as an adverb, "their is", and fixed
prepositions ("interested on", "discuss about", "explain me", "on my
opinion"). Forms that are themselves English words ("-leaved", "singed",
"ringed") and names ("Sayd") are excluded after a check on correct text.
The pronoun "i" is now capitalised wherever it stands alone, not only before
forty verbs; list markers and numerals ("(i)", "part i") are left alone.

Held out (not used for any choice):

| Set | 7.36 rules + spelling: P / R / F0.5 | 7.37 rules + spelling: P / R / F0.5 |
|---|---|---|
| W&I report half | 63.2% / 3.4% / 0.140 | 67.6% / 4.3% / 0.173 |
| CoNLL-2014 | 78.6% / 5.0% / 0.199 | 80.5% / 5.8% / 0.224 |
| Correct Wikipedia changed | 3.5% | 3.5% |

Rules alone: W&I 0.061 to 0.100 (precision 75.8%), CoNLL-2014 0.015 to 0.059.
The writer's thesis: no correctness suggestion from the rules, as before.

What this means plainly: with no model at all, Inkwell now finds about one
learner error in twenty-three, and about two in three of its suggestions
agree with a human corrector. For a fluent writer, whose slips are fewer and
of the kinds rules catch, the share is higher; no measurement of that exists
here. The careful grammar model (Engine, opt-in) remains the way to catch the
errors that need the sentence's sense.

The offline rewrites (Rewrite: Concise, Shorter, Professional, Scholarly,
Casual, Confident) were rewritten to keep meaning and grammar, with 143 test
cases (tools/rewrite/cases.js) and a reading of every change made to 600
Wikipedia sentences and the writer's thesis.

## 7.38: every prompt works offline, and says why

Before 7.38, "Rewrite with a prompt" needed a writing model: with none, it
said so and did nothing. Now every prompt in the library, and the writer's
own prompts where their words say what they ask, does something on the
device, with no model:

- Rule rewrites, each change listed with its reason ("Shorter, and it means
  the same: in order to → to"). New modes in `src/lib/rewrite_core.js`:
  Simplify, One idea per sentence, Active voice (the plain past only, where
  the one who acts is named after "by"), Neutral, and Hedged to the evidence.
  "Correct only" applies the grammar rules and the spelling checker, with the
  lesson for each fix.
- A coach (`src/lib/coach_core.js`) for what rules cannot write: Show, don't
  tell; Vivid and concrete; Signpost the argument; Topic sentence; Synthesis,
  not a list; Methodology; Abstract style; Rhythm; Expand; Warm; Diplomatic;
  absolute claims; softeners; long sentences; actions with no doer; judging
  words; Shorter by a third. It quotes the words it found, says how in one
  line, gives a marked example, and checks the writer's own try ("Your turn",
  "Check mine", "Use mine").
- A prompt Inkwell cannot answer offline ("Translate this into Welsh") is
  told so plainly.

Tests: `node tools/rewrite/run.js` (230 cases, traps included) and
`node tools/rewrite/coach_test.js` (38). Every change the new modes make to
the 600 Wikipedia sentences was read by hand; the first reading found five
faults (a fragment after a semicolon, a split inside brackets, a verb or a
"which" left on the wrong noun by Active voice), all fixed and kept as
tests. The older modes no longer reword a quotation that runs across
sentences ("Kramnik said, "A proper analysis must take into
consideration..."); otherwise they give exactly what they gave before.

The 7.38 rule fixes, measured on the held-out sets (rules and spelling):

| Set | 7.37: P / R / F0.5 | 7.38: P / R / F0.5 |
|---|---|---|
| W&I report half | 67.6% / 4.3% / 0.173 | 67.6% / 4.3% / 0.173 |
| CoNLL-2014 | 80.5% / 5.8% / 0.224 | 80.5% / 5.8% / 0.224 |
| Correct Wikipedia changed | 3.5% | 3.5% |

The fixes were to style and clarity notes; correctness is unchanged.

## 7.43: a scholarly standard (stage G3)

The question for this stage: what does Inkwell say about writing that is
already good? Measured on 40 open-access philosophy and ethics articles
(Philosophy, Ethics, and Humanities in Medicine, through Europe PMC;
247,426 words; never kept in this repository) and on a thesis
introduction, every note was read by kind; then on the learner sets of
7.42, so that nothing gained there was lost.

Notes per 1000 words on the published articles:

| | 7.42 | 7.43 |
|---|---|---|
| scholarly register | 32.7 | 6.6 |
| professional register | 23.2 | 6.4 |
| of which grammar and spelling (scholarly) | 3.0 | 2.1 |

What went, and why:

- "Weak word" (43% of all notes): every "also", "but", "use", "people",
  "mean", with "utilise", "commence" and "evince" offered. Now only the
  informal and the vague ("a lot of", "kind of", "stuff"), and an
  overused connector or intensifier (three times in 120 words).
- Spelling: SCOWL size 80 (filtered: never one slip from a common word),
  word formation, names at a sentence start, the writer's repeated terms,
  Latin and Roman numerals. 7.45 to 1.58 flags per 1000 words; the gold
  spelling errors of W&I+LOCNESS dev found 94.1% to 93.0%.
- The passive noted where it crowds a paragraph (3 of 5 sentences in the
  scholarly register), not wherever it stands; "the X-tion of" dropped.
- Restricting "which" (correct British and general usage) noted only
  under the US flag; never after a preposition ("under which").
- The Oxford comma rule (it misread "For example, Roberts and Sarangi").
- Hedges ("perhaps"), research questions, "I argue", "show", "points
  out", "the thing itself", "the common good", "NICE", "the very old":
  scholarly usage, no longer marked.
- Quotations: no note inside one, outside creative writing.
- A key term (four uses or more) is not a repetition to vary.
- Abbreviations ("p. 20", "qtd. in", "P. vivax") do not end sentences;
  a comma after an opening phrase is not a comma splice.

The learner checks (learner_core.js) on the articles: 168 notes to 18,
13 of them real errors in the articles ("a numbers of", "can not",
"ofthe", "However this"). 69 sentences from the articles are now tests
(learner_test.js, 160).

Nothing lost on learners. The whole page on the held-out W&I half
(ERRANT, cat "g" fixes): 212 true and 119 false fixes (P 64.1%) to 215
and 115 (P 65.2%, R 6.7%, F0.5 0.237). Correct Wikipedia sentences
touched: 77 to 67 of 1500.
