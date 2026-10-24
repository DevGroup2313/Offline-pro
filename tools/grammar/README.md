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

## 7.50: the gaps (stage G4)

An audit of the 7.49 corrector on the W&I tuning half, by ERRANT error
type, listed where it was silent: a preposition missing its last word ("in
spite all") or the wrong dependent preposition ("interested on"), a missing
article before a singular count noun ("is experienced person"), a singular
after a quantity ("many problem"), the verb form after a modal, "do", "have"
or "to" ("will delighted", "have went", "a way to learning"), agreement with
a gerund, a country or a plural head noun ("Sharing rooms have", "the
chances of accident is"), a capital inside a sentence ("thinking It would")
and a few morphology slips ("nowaday", "interesting in", "everyday" as an
adverb). src/lib/gaps_core.js (INKGAPS) holds eight families for these,
wired into the page's rules after the learner checks. The lexicon (INKLEX)
confirms parts of speech when it has been read; without it, the lists and
the regular spellings serve. The page now reads the lexicon soon after the
desk opens on a computer with the memory for it (35 MB once read); a tablet
reads it the first time Alternatives or Rewrite asks, as before.
tools/grammar/gaps_test.js: 125 cases.

The first draft doubled the share of correct sentences changed (3.9% to
7.7%). Every new change on the correct sets was listed by its reason and
read. The plural-after-a-quantity rule was most of the fault (a word already
plural, "two years" to "yearses" with the lexicon's noun "years"; a noun
before the head, "two studio albums"; "the two leave", "both in"), with the
agreement rule reading "that public transport in future is" and "How does
the author create" as plain clauses, "many people" taken for a mass noun,
and "Bryant & May was" taken for the modal. Each got its guard and a test
(29 published sentences that must be left alone). Then the whole page, cat
"g" fixes, ERRANT span-based, against 7.49:

| set | 7.49 P / R / F0.5 | 7.50 P / R / F0.5 |
|---|---|---|
| W&I tuning half (1,698) | 66.1 / 7.7 / 0.261 | 67.0 / 8.6 / 0.284 |
| W&I report half (1,698) | 64.0 / 7.3 / 0.251 | 62.5 / 7.7 / 0.257 |
| CoNLL-2014 (1,312) | 75.6 / 7.3 / 0.262 | 73.9 / 7.6 / 0.270 |
| correct Wikipedia, tuning (1,500) | 58 changed (3.9%) | 64 (4.3%) |
| correct Wikipedia, report (1,500) | 72 changed (4.8%) | 73 (4.9%) |

The 41 new fixes on the tuning half, read one by one against the reference:
17 are the annotator's own change; 2 touch the same words another way
("there are a notice", where the annotator rewrote the clause); 22 the
token match counts false, of which 21 are right fixes the annotator did not
make or made inside a wider rewrite ("will delighted" to "will delight",
"Nowaday" to "Nowadays", "taking care by me" to "of", "the federal
government let" to "lets") and one was wrong ("When I arrived my uncle was
waiting" wants a comma, not "at": the rule no longer fires before a
possessive). Every gaps note carries a lesson (refine_core.js, by family)
and a family name, so the syllabus in Your patterns groups them.

## After 7.50: the comma after an opening phrase or clause (stage G6, first part)

The audit of the 7.50 corrector by error type (W&I tuning half): missing
punctuation 354 missed against 68 hit, nearly all commas, and the largest
group a comma after an opening phrase or clause ("In the same way I had",
"When I arrived my uncle was", "After some years the girl decided"). The
learner module's comma family (learner_core.js) saw an opener from its list,
a fronted clause before a pronoun subject, and "but" between clauses. It now
also sees a prepositional phrase of three words or more before a pronoun
subject, and an opening clause or phrase before a determiner and its noun,
where the main clause follows at once with its verb. A second subject and
verb soon after ("By the time I arrived the party was over", "On the day he
died the town mourned") leaves the edge uncertain and nothing is said; a
determiner's word that can only be a verb or a pronoun ("a topic that has",
"remarked that he") is not a subject; "I" after an opener is a subject, not
a name. Twenty-two more openers ("in the same way", "before that", "at the
moment", "in the future"), each refused when a preposition, "when", "which"
or "as" follows. The article rule allows an adverb before the adjective
("is a very beautiful place"), and the count-noun list gains the commonest
nouns it lacked (place, thing, area, name).

| set | 7.50 P / R / F0.5 | now |
|---|---|---|
| W&I tuning half | 67.0 / 8.6 / 0.284 | 66.2 / 9.0 / 0.291 |
| W&I report half | 62.5 / 7.7 / 0.257 | 62.1 / 7.9 / 0.261 |
| CoNLL-2014 | 73.9 / 7.6 / 0.270 | 74.0 / 7.7 / 0.271 |
| correct Wikipedia, tuning | 64 (4.3%) | 72 (4.8%) |
| correct Wikipedia, report | 73 (4.9%) | 76 (5.1%) |

The new changes on correct prose were read: all eleven are commas after a
short opening phrase that published prose often leaves out ("After his
recovery he was given", "On his left leg he wore"); the two wrong shapes of
the first draft are gone. On the tuning half, 20 of the 31 new fixes are the
annotator's own, and the eleven others are commas the annotator left ("In
this report we will", "On my vacation I went"). learner_test.js: 182.

## After 7.50: precision on published prose (stage G6, second part)

Every change the corrector made on the two correct Wikipedia sets (159 in
3,000 sentences) was listed by its reason and read. Most are what the
sets carry rather than faults of the rules: names and Latin the dictionary
lacks (41), spaces before a full stop or a comma left by the extraction
(40), rows that begin mid-sentence (16), and optional commas (15). The
rest were wrong, and each got its guard and a test:

- a collective noun with a plain verb ("the first team play") now gets the
  note without a fix, since British usage may treat a team, a government
  or a committee as plural ("every" and "each" still take the fix);
- a day or a year followed by a capitalised word is a title or an event
  ("at Saturday Night", "at 1997 Survivor Series"), not a preposition slip;
- a word with an inner capital before a capitalised word is a name
  ("uDiscover Music");
- "six home runs", "those top three teams": after a number, an -s word
  that may be a verb is the compound's head, not a verb;
- "what a journey this ends up being": a verb and its particle, not a
  plural noun after "this";
- "as they pleased", "than they expected": no verb is missing;
- "on the night" is the British idiom for the night of an event; only "in
  the night" becomes "at night".

| set | before P / R / F0.5 | after |
|---|---|---|
| W&I tuning half | 66.2 / 9.0 / 0.291 | 66.4 / 9.0 / 0.291 |
| W&I report half | 62.1 / 7.9 / 0.261 | 62.3 / 7.9 / 0.262 |
| CoNLL-2014 | 74.0 / 7.7 / 0.271 | 74.3 / 7.7 / 0.272 |
| correct Wikipedia, tuning | 72 (4.8%) | 68 (4.5%) |
| correct Wikipedia, report | 76 (5.1%) | 72 (4.8%) |

One real fix is given up: "the federal government let each state" keeps
its note and loses its fix. learner_test.js 188, gaps_test.js 130.

## After 7.51: the spelling fix (stage G6, third part)

The 7.50 audit put spelling (R:SPELL) among the larger silences: on the
Write & Improve tuning half the corrector made the annotator's own fix for
68 of 129 misspellings, offered a different word 16 times, and offered no
fix at all 45 times. Every silence and every wrong word was read with the
suggester's own scores (scratchpad spellgap.py and spellprobe.js). Three
causes stood out, and each was corrected in src/lib/spell_core.js:

- the cost of a candidate's rarity was too flat (0 to 0.7 across the
  SCOWL levels), so a common word one slip away did not stand clear of a
  rare one at the same distance, and the margin rule withheld the fix:
  "throug" (through, throng), "goingo" (going, gringo), "knies" (knees,
  kines), "privte" (private, privet). The costs are now 0, 0.08, 0.25,
  0.35, 0.6, 0.7, 0.85, 1.0 and 1.2 by level, and the margin is read
  without floating-point noise;
- a long word two slips from a very common word, with nothing else near,
  had no fix: "lenguaje", "nesesary", "prfesional", "atencion",
  "chilfen". It gets the fix when it has seven letters or more, the
  candidate is of the first level, of much the same length, stands 0.2
  clear of the next, and the word is not two known words run together
  ("callsign", "wheelset", "crewmembers");
- three unknown words with at most one short word between them were
  taken for a phrase of another language and left alone, which swallowed
  "the ablity of travalling has easened". A run in which two words or
  more are each one cheap slip from a common word is a run of slips, and
  stays marked; "il buio e il miele" has one such word at most and stays
  a phrase.

Two costs were recalibrated against the same sets. A neighbouring key
cost 0.75 and beat a letter left out (0.95): "healty" went to "health",
not "healthy"; "amoung" to "amount"; "eaily" to "daily"; "creats" to
"create". It now costs 0.9, so such pairs stay a question (both words
are offered, neither applied). A slip at the first letter costs 0.2 more
than one inside the word: "susage" is not "usage", "nopal" is not "opal",
"jhum" is not "hum".

The new fixes on the two correct sets were read in the same way, and
each misfire got its guard and a test: a prefix standing apart from its
word ("pre - intermediate", "pre historic"); a term glossed in brackets
("a manica (a heavy linen wrapping)") or defined by its sentence ("The
falx was a curved blade"); loanwords written without their accents
("cafes", "cliche", "jalapeno"); the small words of other languages
inside names ("Ca los Cans", "Tignes les Boisses"); a word of four
letters only for a slip within 1.0; a rare word (above level 35) only for
one cheap slip; a capital of four letters at a sentence's start is a name
("Maon"). The alternatives on a card keep to the candidates within 0.9 of
the best, so "necessary" is no longer offered beside "pessary".

| set | before P / R / F0.5 | after |
|---|---|---|
| W&I tuning half | 66.4 / 9.0 / 0.291 | 67.0 / 9.4 / 0.300 |
| W&I report half | 62.3 / 7.9 / 0.262 | 62.3 / 8.0 / 0.265 |
| CoNLL-2014 | 74.3 / 7.7 / 0.272 | 75.0 / 7.8 / 0.276 |
| correct Wikipedia, tuning | 68 (4.5%) | 60 (4.0%) |
| correct Wikipedia, report | 72 (4.8%) | 67 (4.5%) |

Spelling alone (the annotator's R:SPELL edits: the same word, a
different word, no fix):

| set | before | after |
|---|---|---|
| W&I tuning half (129) | 68 / 16 / 45 | 82 / 17 / 30 |
| W&I report half (140) | 64 / 22 / 54 | 66 / 25 / 49 |
| CoNLL-2014 (197) | 94 / 14 / 89 | 97 / 15 / 85 |

What remains is context: "thay" (that or they), "messagen" (message or
messages), "susage" (sausage, in a sentence about appetisers), "kneck"
(neck), and the words three slips away ("enoff", "ansiouns"). An
intermediate round that withheld every fix to a word above level 20
unless the slip was cheap lost right fixes on every set ("burgers",
"diabetes", "perspectives", "decorate") and was not kept.

The lesson of a spelling fix is now the word itself (INKSPELL.lesson):
for the classic words a line to remember them by ("Necessary: one c, two
s, as a shirt has one collar and two sleeves", "i before e, except after
c: receive"), for the rest the tricky part read off the slip ("The “h”
was missing: through", "Double “m”: committed", "The vowel is “e”, not
“a”: depends", "Two words, not one: every site"). The card, the line at
the foot after an accepted fix, and the practice's answer carry it.
spell_test.js 181.

## After 7.51: the small deterministic fixes (stage G6, fourth part)

The audit after the spelling stage listed the remaining silences by type.
The large ones are contextual (a preposition both forms of which are
acceptable, a tense across a sentence, an article by meaning, word
choice). What was deterministic was gathered into one stage, each item
with its guards and tests (learner_test.js 215, gaps_test.js 147,
spell_test.js 182):

- the comma after a connective, whatever follows it ("In my opinion big
  stars should", "On the one hand travel by car", "To sum it up I");
  "Of course not", "In general terms", "However much I try" and "As I
  mentioned in the beginning" take none;
- the comma before an instruction that follows an opening clause ("If
  you have the chance of learning a new language, do it"); not before a
  plural subject or an infinitive ("people say", "to go");
- the comma before "but" when a noun phrase follows ("buy a car, but the
  poor people will not"); not in "not the car but the bus";
- the space after a sentence's stop ("cold.but we went" to "cold. But we
  went"), with the capital; not inside an address, a file name, a
  decimal or an initial; after an abbreviation's stop the space alone;
- the full stop a paragraph lacks when another paragraph follows it (the
  last paragraph is still being written; headings, lists and titles are
  left alone);
- "in to" before a place or a result after a verb of motion or change
  ("get into the room", "divided into pieces"); not "log in to";
- a role noun's article after "is", "was", "become" or "as" ("when I was
  a student", "worked as an educator"); not the offices one person holds
  ("became president");
- "congratulations on", "a beginner at", "smile at" someone, "pray to"
  God.

Two faults in the page itself were found by the measurement, since the
library made the fixes and the page did not: the gate dropped the capital
of "i'm" because an apostrophe followed the i, and an older page rule
for the missing space claimed the span and then died in the gate, taking
the library's fix with it. And a correctness note from the libraries was
dropped whenever a clarity or style note stood on the same words ("In my
opinion" is also a wordiness note), so the comma never appeared; a
correctness note now takes the place of the style notes on its words.
That last change also let through fixes the page had always known but
never shown: "can not" to "cannot" (35 times on CoNLL-2014), "is very
beautiful place" to "is a very beautiful place", "a lots of" to "a lot
of", "one of the reason" to "reasons".

| set | before P / R / F0.5 | after |
|---|---|---|
| W&I tuning half | 67.0 / 9.4 / 0.300 | 66.5 / 9.9 / 0.311 |
| W&I report half | 62.3 / 8.0 / 0.265 | 62.5 / 8.4 / 0.273 |
| CoNLL-2014 | 75.0 / 7.8 / 0.276 | 74.1 / 7.9 / 0.276 |
| correct Wikipedia, tuning | 60 (4.0%) | 62 (4.1%) |
| correct Wikipedia, report | 67 (4.5%) | 67 (4.5%) |

The two new changes on correct prose are commas before "but" between
two complete clauses ("his work with taxonomy, but his ideas", "have
disappeared, but an adit can still be seen"), which the rule places and
the encyclopaedia's editors did not; both are standard, and the rule is
kept.

## After 7.51: the plural subject's verb, and lessons from the sentence itself (stage G7)

"My friends likes football", "their results shows": a determiner, a
plural noun the lexicon knows, then a verb with -s whose base is a common
verb. The verb takes its plain form; not when a verb or "of" follows
("its users needs are"), when the noun has a singular -s ("the news"), or
when a preposition stands before the determiner ("one of my friends
likes"). Two hits on the report half and CoNLL-2014, no new change on
correct prose.

A note's lesson was the family's general line. For agreement, number
after a quantity and the missing article it is now built from the
sentence (refine_core.js sentenceLesson): "“Results” means more than one,
so the verb is “were”: results were"; "After “there” the verb agrees with
what follows: “many reasons” means more than one, so “there are”";
"“Many” counts more than one, so the noun is plural: many problems";
"“One of the” picks one out of several, so the noun is plural"; "“Place”
is one thing you can count, so it takes “a”: a very beautiful place";
"“Educator” names a role one person holds, so it takes “an”"; "Only one
can be the best, so it takes “the”". Where the subject stands elsewhere
("the box of eggs is") or is a collective ("the team were"), the general
line stays. The card, the line at the foot after an accepted fix (read
before the page changes) and the practice's answer carry it.

An insertion at the head of a note that keeps its first word ("a" before
"student", beside "student,") was dropped as an overlap by the page and
by the refiner; both now stand, and Fix all applies the longer fix first.

| set | before P / R / F0.5 | after |
|---|---|---|
| W&I tuning half | 66.5 / 9.9 / 0.311 | 66.5 / 9.9 / 0.311 |
| W&I report half | 62.5 / 8.4 / 0.273 | 62.6 / 8.4 / 0.274 |
| CoNLL-2014 | 74.1 / 7.9 / 0.276 | 74.6 / 7.9 / 0.278 |
| correct Wikipedia, tuning | 62 (4.1%) | 62 (4.1%) |
| correct Wikipedia, report | 67 (4.5%) | 67 (4.5%) |

refine_test.js 100, gaps_test.js 153.

## After 7.51: under scrutiny on published prose, again (stage G3e)

The correct sets so far were encyclopaedic. The 40 published articles of
the 7.47 audit (247,426 words) were read again, in the scholarly register,
every correctness note by reason (scratchpad runprose.mjs): 554 notes, 408
with a fix. Scholarly prose misfires differently from an encyclopaedia,
and each shape got its guard and a test:

- abstract nouns given an article after a preposition and an adjective
  ("about epistemic agency", "on subjective experience", "at personal
  cost", "in great part"): a list of nouns as often uncountable as
  countable (DUAL) takes no article there; quantifiers and prepositions
  the lexicon calls adjectives ("no", "little", "through", "second") open
  no article either;
- "only", "first" and "best" used as adverbs ("is only really successful",
  "was first translated", "what is best for the body", "can be best
  understood"): the superlative or ordinal takes "the" only before its
  noun, never before a function word, a participle, an adverb or another
  adjective; an award's capital ("Best Director") is left alone;
- a title's capital ("Scent of a Woman", "The Sanitary and Social
  Geography"), two names joined ("Leech and Short"), a title at a
  sentence's head, and identity capitals a journal may keep ("Black
  patients", "Deaf culture");
- the noun "will" ("the will is the rational soul's faculty", "at will"),
  not the modal;
- a list's "(i)", and the pronoun I beside a word of another language
  ("nišan saman i bithe");
- "the The Sanitary and Social Geography": a title's "The" after "the" is
  no doubled word;
- plural objects taken for subjects ("his preferences and values is",
  "denying IVF to older women is", "reducing these effects is", "chief
  among these is"): a preposition, "and", "or" or an -ing word within the
  four words before leaves the verb alone;
- a transcript's code ("… P08") or a bracketed source ("(Gemini)") at a
  paragraph's end takes no full stop;
- a species after its genus initial ("P. malariae", "V. sativa"), and a
  learned term by its ending ("analepsis") is only marked, never two slips
  from a common word; -er nouns from verbs are words ("funders"); two
  words run together are split ("empiricalevidence", "governmentshould").

After the round, the articles carry 409 notes, 268 with a fix; what
remains is mostly what the texts carry (consistency of -ise and -ize,
missing spaces, comma splices, "e.g."), and 112 words the dictionary
lacks, marked without a fix.

| set | before P / R / F0.5 | after |
|---|---|---|
| W&I tuning half | 66.5 / 9.9 / 0.311 | 66.5 / 9.9 / 0.311 |
| W&I report half | 62.6 / 8.4 / 0.274 | 62.6 / 8.4 / 0.274 |
| CoNLL-2014 | 74.6 / 7.9 / 0.278 | 75.0 / 8.0 / 0.279 |
| correct Wikipedia, tuning | 62 (4.1%) | 62 (4.1%) |
| correct Wikipedia, report | 67 (4.5%) | 66 (4.4%) |

gaps_test.js 177, learner_test.js 217, spell_test.js 188.
