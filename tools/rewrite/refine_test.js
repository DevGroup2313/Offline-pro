/* Tests for src/lib/refine_core.js: node tools/rewrite/refine_test.js
   Every sentence here is checked by hand: the note it carries, and what the
   refiner must make of it (an alternative, a question, one note, or none). */
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const R = require(path.join(ROOT, 'src', 'lib', 'refine_core.js'));
const SP = require(path.join(ROOT, 'src', 'lib', 'spell_core.js'));
const D = SP.load(fs.readFileSync(path.join(ROOT, 'Inkwell-Android', 'app', 'src', 'main', 'assets', 'vendor', 'scowl-words.txt'), 'utf8'));
const SYN = { evidence: ['proof', 'support'] };
const H = { plain: w => SP.level(D, String(w).toLowerCase()) >= 0, syn: w => SYN[w.toLowerCase()] || [] };
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }
/* a note on the first (or the n-th) place a phrase appears */
function note(t, phrase, why, extra, nth) {
  let at = -1; for (let k = 0; k <= (nth || 0); k++) at = t.indexOf(phrase, at + 1);
  if (at < 0) throw new Error('no "' + phrase + '" in: ' + t);
  return Object.assign({ start: at, end: at + phrase.length, orig: phrase, fix: null, why: why, cat: 's' }, extra || {});
}
const one = (t, n) => R.refine(t, [n], H);
const apply = (t, e, alt) => t.slice(0, e.start) + (alt !== undefined ? alt : e.fix) + t.slice(e.end);
const PASV = 'Passive voice — the active form usually serves the reader better';

/* passive to active, with the doer named */
let t = 'Their existence was confirmed by one of the Vindolanda tablets.';
let r = one(t, note(t, 'was confirmed by', PASV));
ok('passive: past, agent with "of"', r.length === 1 && r[0].alts[0] === 'One of the Vindolanda tablets confirmed their existence', r);
ok('passive: the whole clause is replaced', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'One of the Vindolanda tablets confirmed their existence.', r[0] && apply(t, r[0], r[0].alts[0]));
t = 'Jens Espense was hired by the Tibetan Football Association to coach the team.';
r = one(t, note(t, 'was hired by', PASV));
ok('passive: a name keeps its capitals; the agent stops at "to"', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'The Tibetan Football Association hired Jens Espense to coach the team.', r);
t = 'Vacancies in the fiscal officership or on the board of trustees are filled by the remaining trustees.';
r = one(t, note(t, 'are filled by', PASV));
ok('passive: present, plural agent', r.length === 1 && r[0].alts[0] === 'The remaining trustees fill vacancies in the fiscal officership or on the board of trustees', r);
t = 'More complicated series with the Gregory coefficients were calculated by various authors.';
r = one(t, note(t, 'were calculated by', PASV));
ok('passive: a common first word loses its capital', r.length === 1 && r[0].alts[0] === 'Various authors calculated more complicated series with the Gregory coefficients', r);
t = 'It is the plan that was approved by the board.';
r = one(t, note(t, 'was approved by', PASV));
ok('passive: a relative clause', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'It is the plan that the board approved.', r);
t = 'The effect has been shown by several studies.';
r = one(t, note(t, 'been shown by', PASV));
ok('passive: perfect, from "been"', r.length === 1 && r[0].alts[0] === 'Several studies have shown the effect', r);
t = 'The rule was not enforced by the police.';
r = one(t, note(t, 'was not enforced by', PASV));
ok('passive: negative past', r.length === 1 && r[0].alts[0] === 'The police did not enforce the rule', r);
t = 'In 1990, the company was sold by its founder.';
r = one(t, note(t, 'was sold by', PASV));
ok('passive: after an opening phrase', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'In 1990, its founder sold the company.', r);
t = 'The plan that we made was approved by the council.';
r = one(t, note(t, 'was approved by', PASV));
ok('passive: a subject holding a clause is left alone (and the bare note goes)', r.length === 0, r);
t = 'The man who I met was hired by the firm.';
r = one(t, note(t, 'was hired by', PASV));
ok('passive: "who" inside the subject is left alone', r.length === 0, r);

/* passive with no doer: the question builds the sentence */
t = 'These orders were countermanded the day after her arrival.';
r = one(t, note(t, 'were countermanded', 'Possible passive voice'));
ok('agentless: a question', r.length === 1 && r[0].ask && r[0].ask.q === 'Who did it?', r);
let b = r[0] && R.build(r[0], 'the admiral');
ok('agentless: the answer builds the active sentence', b && apply(t, b) === 'The admiral countermanded these orders the day after her arrival.', b && apply(t, b));
ok('agentless: an empty answer builds nothing', r[0] && R.build(r[0], '  ') === null);
t = 'The samples are analysed in the lab.';
r = one(t, note(t, 'are analysed', 'Possible passive voice'));
b = r[0] && R.build(r[0], 'the technician');
ok('agentless: present, singular doer', b && apply(t, b) === 'The technician analyses the samples in the lab.', b && apply(t, b));
b = r[0] && R.build(r[0], 'we');
ok('agentless: present, "we"', b && apply(t, b) === 'We analyse the samples in the lab.', b && apply(t, b));
t = 'The results can be seen in Table 2.';
r = one(t, note(t, 'can be seen', 'Possible passive voice'));
b = r[0] && R.build(r[0], 'the reader');
ok('agentless: a modal', b && apply(t, b) === 'The reader can see the results in Table 2.', b && apply(t, b));
t = 'It was found that the rate fell.';
r = one(t, note(t, 'was found', 'Possible passive voice'));
b = r[0] && R.build(r[0], 'we');
ok('agentless: "It was found that"', b && apply(t, b) === 'We found that the rate fell.', b && apply(t, b));
t = 'He said that the plan was approved.';
r = one(t, note(t, 'was approved', 'Possible passive voice'));
b = r[0] && R.build(r[0], 'The board');
ok('agentless: mid-sentence, a typed capital is lowered', b && apply(t, b) === 'He said that the board approved the plan.', b && apply(t, b));
t = 'The sagittarius was armed with a composite bow.';
ok('stative: "was armed" goes', one(t, note(t, 'was armed', 'Possible passive voice')).length === 0);
t = 'Balderas was born in Mexico City.';
ok('stative: "was born" goes', one(t, note(t, 'was born', 'Possible passive voice')).length === 0);
t = 'An article asked whether this was related to the curse.';
ok('stative: "was related" goes', one(t, note(t, 'was related', 'Possible passive voice')).length === 0);

/* nominalisations */
const NOMW = 'Nominalisation — the verb form is usually stronger and shorter';
t = 'The fault was responsible for the exhumation of late rocks.';
r = one(t, note(t, 'the exhumation of', NOMW));
ok('nominalisation: the -ing form', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'The fault was responsible for exhuming late rocks.', r);
t = 'Maps were set to night for the duration of the event.';
r = one(t, note(t, 'the duration of', NOMW));
ok('nominalisation: "for the duration of" becomes "during"', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'Maps were set to night during the event.', r);
t = 'The population of the town grew.';
ok('nominalisation: a noun that is not an action goes', one(t, note(t, 'The population of', NOMW)).length === 0);

/* contractions */
t = 'but it\'s definitely not true';
r = one(t, note(t, "it's", 'Contraction: expand in formal prose'));
ok('contraction: it is', r.length === 1 && r[0].fix === 'it is', r);
t = 'It\'s been a long day.';
r = one(t, note(t, "It's", 'Contraction — the formal register usually writes it out'));
ok('contraction: it has (before "been")', r.length === 1 && r[0].fix === 'It has', r);
t = 'I\'d go.';
r = one(t, note(t, "I'd", 'Contraction: expand in formal prose'));
ok('contraction: two readings for "\'d"', r.length === 1 && r[0].alts.join('|') === 'I would|I had', r);

/* "the fact that" */
const FACT = 'Wordy frame: restructure or delete';
t = 'Despite the fact that it rained, we went.';
r = one(t, note(t, 'the fact that', FACT, { cat: 'c' }));
ok('fact that: despite', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'Although it rained, we went.', r);
t = 'This is obvious from the fact that people care.';
r = one(t, note(t, 'the fact that', FACT, { cat: 'c' }));
ok('fact that: from', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'This is obvious because people care.', r);
t = 'The point is the fact that prices rose.';
r = one(t, note(t, 'the fact that', FACT, { cat: 'c' }));
ok('fact that: is that', r.length === 1 && apply(t, r[0], r[0].alts[0]) === 'The point is that prices rose.', r);

/* cutting a phrase */
t = 'It should be noted that the sample was small.';
r = one(t, note(t, 'It should be noted that', 'Throat-clearing: say the point', { cat: 'c' }));
ok('cut: a sentence that began with it begins with a capital', r.length === 1 && apply(t, r[0]) === 'The sample was small.', r);
t = 'The results, undoubtedly, show a rise.';
r = one(t, note(t, 'undoubtedly', '“Undoubtedly” doubts the reader instead of the proof'));
ok('cut: a phrase between commas', r.length === 1 && apply(t, r[0]) === 'The results show a rise.', r[0] && apply(t, r[0]));
t = 'I think people should travel.';
r = one(t, note(t, 'I think ', 'Hedge (confidence)', { fix: '' }));
ok('cut: a deletion at a sentence start capitalises the next word', r.length === 1 && apply(t, r[0]) === 'People should travel.', r[0] && apply(t, r[0]));
t = 'This is, needless to say, true.';
r = one(t, note(t, 'needless to say', '“Needless to say” announces a redundancy; cut, or name the point'));
ok('cut: between commas again', r.length === 1 && apply(t, r[0]) === 'This is true.', r[0] && apply(t, r[0]));

/* one note per place */
t = 'So, if i have time.';
r = R.refine(t, [note(t, 'i', 'Capital I', { fix: 'I', cat: 'g' }, 0), note(t, 'i', 'Capitalise the pronoun I', { cat: 'g' }, 0)], H);
ok('dedupe: capital I once, with its fix', r.length === 1 && r[0].fix === 'I', r);
t = 'He studies in order to stand out.';
r = R.refine(t, [note(t, 'in order to', 'Wordy phrase', { fix: 'to', cat: 'c' }), note(t, 'in order to', '“To” alone carries it; the extra words only weigh', { cat: 'c' })], H);
ok('dedupe: "in order to" once', r.length === 1 && r[0].fix === 'to', r);
t = 'We have a lot of paper.';
r = R.refine(t, [note(t, 'a lot of', 'Register: informal quantifier', { fix: 'a considerable amount of', cat: 'c' }), note(t, 'lot of', '“Many”, “much”, or the number itself', { alts: ['many', 'much'] }), note(t, 'a lot of', 'Register — “much of”, “many”, or “a great deal of”')], H);
ok('dedupe: "a lot of" once', r.length === 1 && r[0].fix === 'a considerable amount of', r);
t = 'Even more relevant is the fact that images mislead.';
r = R.refine(t, [note(t, 'the fact that', FACT, { cat: 'c' }), note(t, 'the fact that', 'Wordiness — “the fact that” rarely earns its keep')], H);
ok('dedupe: "the fact that" once', r.length === 1, r);
t = 'culture and and fit';
r = R.refine(t, [note(t, 'and and', 'Repeated word', { fix: 'and', cat: 'g' }), note(t, 'and and', 'Doubled word', { cat: 'g' })], H);
ok('dedupe: a doubled word once', r.length === 1 && r[0].fix === 'and', r);
t = 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z a b c d e f g h i j k l m n o p q r s t u v w.';
r = R.refine(t, [{ start: 0, end: 1, orig: 'A', fix: null, why: 'Long sentence: 50 words, and the reader can hear it running', cat: 'c' }, { start: 0, end: 40, orig: t.slice(0, 40), fix: null, why: 'Long sentence (50 words); a full stop would help the reader', cat: 's' }], H);
ok('dedupe: two long-sentence notes become none when there is no place to split', r.length === 0, r);
t = 'abcdefghij klmnopqrst';
r = R.refine(t, [{ start: 0, end: 10, orig: 'abcdefghij', fix: 'X', why: 'Spelling', cat: 'g' }, { start: 5, end: 21, orig: 'fghij klmnopqrst', fix: 'Y', why: 'Your rule: test', cat: 'r' }], H);
ok('dedupe: overlapping fixes never both stay fixes', r.length === 2 && r.filter(e => typeof e.fix === 'string').length === 1 && r.some(e => e.tryAlts), r);
ok('dedupe: a note with no place is dropped', R.refine('abc', [{ start: NaN, end: NaN, why: 'x', cat: 'g' }], H).length === 0);

/* comma splices */
const SPL = 'Possible comma splice: use a full stop, a semicolon, or a joining word';
t = 'The results were clear, they showed a strong effect.';
r = one(t, note(t, ',', SPL, { cat: 'c' }));
ok('splice: a semicolon or a full stop', r.length === 1 && r[0].alts.join('|') === '; they|. They' && apply(t, r[0], r[0].alts[1]) === 'The results were clear. They showed a strong effect.', r);
t = 'Even if we are failed, We have to try.';
ok('splice: a clause with "if" is no splice', one(t, note(t, ',', SPL, { cat: 'c' })).length === 0);
t = 'Due to the stark realism it presented, it was impossible to persuade anyone.';
ok('splice: an opening "due to" is no splice', one(t, note(t, ',', SPL, { cat: 'c' })).length === 0);
t = 'Bodies are touched up and therefore, they do not resemble reality.';
ok('splice: "and therefore," is no splice', one(t, note(t, ',', SPL, { cat: 'c' })).length === 0);

/* which and that */
t = 'the plan which we made';
r = one(t, note(t, 'which', '“Which” restricting is accepted British usage; “that” restricts in the stricter style — the desk only notes'));
ok('which: "that" to try', r.length === 1 && r[0].alts[0] === 'that', r);
t = 'it is highly unlikely, that the company will tell';
r = one(t, note(t, 'unlikely, that', '“Which” carries the comma; “that” begins a restriction and takes none', { fix: 'unlikely, which', cat: 'c' }));
ok('which: the comma before "that" goes (the old fix was wrong)', r.length === 1 && r[0].fix === 'unlikely that', r);

/* long sentences and paragraphs */
t = 'The committee met on Tuesday to discuss the budget for the coming year in great detail with every department head, and the members agreed that the proposal needed further work before it could be sent to the board for its final approval next month.';
r = one(t, { start: 0, end: 3, orig: 'The', fix: null, why: 'Long sentence: 47 words, and the reader can hear it running', cat: 'c' });
ok('long sentence: split at ", and the"', r.length === 1 && r[0].alts[0] === '. The' && /head\. The members agreed/.test(apply(t, r[0], r[0].alts[0])), r);
const S1 = 'The first part of the argument sets out the problem in plain terms for the reader. ';
let para = ''; for (let k = 0; k < 6; k++) para += S1;
para += 'However, the second part turns to the evidence and weighs it with care. '; for (let k = 0; k < 6; k++) para += S1;
para = para.trim();
r = one(para, { start: 0, end: 3, orig: 'The', fix: null, why: 'Long paragraph: 200 words. A turn of the argument is a place to break it', cat: 'c' });
ok('long paragraph: break before "However"', r.length === 1 && r[0].alts[0] === '\n\n' && /reader\.\n\nHowever, the second/.test(apply(para, r[0], '\n\n')), r);

/* repetition */
t = 'The evidence shows that the evidence is weak.';
r = one(t, note(t, 'evidence', '"evidence" repeats within one sentence; a pronoun or a synonym may read better', { cat: 'c' }, 1));
ok('repetition: synonyms for the second use', r.length === 1 && r[0].alts.join('|') === 'proof|support', r);
t = 'They made NASCAR Heat and NASCAR The Game.';
ok('repetition: a name is no repetition', one(t, note(t, 'NASCAR', '"NASCAR" repeats within one sentence; a pronoun or a synonym may read better', { cat: 'c' }, 1)).length === 0);

/* small grammar and style rules */
t = '12 people came.';
r = one(t, note(t, '12', 'Spell out a numeral at a sentence start', { cat: 'g' }));
ok('numeral: spelled out', r.length === 1 && r[0].alts[0] === 'Twelve', r);
t = '1. Introduction';
ok('numeral: a numbered heading is left alone', one(t, note(t, '1', 'Spell out a numeral at a sentence start', { cat: 'g' })).length === 0);
t = 'cars would not be of use in the future.';
r = one(t, note(t, 'in the future', 'Vague time — name the date if you can'));
ok('vague time: "later" to try, and a question', r.length === 1 && r[0].alts[0] === 'later' && r[0].ask, r);
ok('vague time: a year becomes "by 2030"', r[0] && R.build(r[0], '2030').fix === 'by 2030');
ok('vague time: a phrase is kept as typed', r[0] && R.build(r[0], 'in 2030').fix === 'in 2030');
t = 'Research shows that sleep matters.';
r = one(t, note(t, 'Research shows', '“Research shows” without a name is authority borrowed; cite the work'));
ok('cite: the source goes in', r[0] && R.build(r[0], 'Walker, 2017').fix === 'Research (Walker, 2017) shows', r);
t = 'This would have required him to pay.';
r = one(t, note(t, 'This would', 'Unclear reference — give “this” a noun to point at'));
b = r[0] && R.build(r[0], 'change');
ok('this: the noun goes in', b && apply(t, b) === 'This change would have required him to pay.', b);
t = 'they can not use it';
r = one(t, note(t, 'can not', '“Cannot” is the standard single word'));
ok('cannot', r.length === 1 && r[0].fix === 'cannot', r);
t = 'we can not only read but write';
ok('cannot: "can not only" is right', one(t, note(t, 'can not', '“Cannot” is the standard single word')).length === 0);
t = 'Firstly the bass eat menhaden.';
r = one(t, note(t, 'Firstly ', 'A comma follows these sentence openers', { cat: 'g' }));
ok('opener comma', r.length === 1 && r[0].fix === 'Firstly, ', r);
t = 'the number of persons are limited';
r = one(t, note(t, 'the number of persons are', '"The number of" takes a singular verb', { cat: 'g' }));
ok('the number of ... is', r.length === 1 && r[0].fix === 'the number of persons is', r);
t = 'the role of the soldier';
ok('reminder: a correct word is not a note', one(t, note(t, 'role of the', '"Role" (part) is correct; "roll" is the verb', { cat: 'c' })).length === 0);
t = 'tried to find out where';
r = one(t, note(t, 'find out', '"Discovers", "determines", or "ascertains" reads more formally'));
ok('find out', r.length === 1 && r[0].alts.join('|') === 'discover|determine|ascertain', r);
t = 'But i found out that';
r = one(t, note(t, 'found out', '"Discovers", "determines", or "ascertains" reads more formally'));
ok('found out', r.length === 1 && r[0].alts.join('|') === 'discovered|determined|ascertained', r);
t = 'First he shows that it works';
r = one(t, note(t, 'shows that', '"Demonstrates", "indicates", or "reveals" is stronger than "shows"', { cat: 'c' }));
ok('shows that', r.length === 1 && r[0].alts.join('|') === 'demonstrates that|indicates that|reveals that', r);
t = 'the quality was very unique';
r = one(t, note(t, 'very unique', 'Absolute adjective — unique takes no degree'));
ok('absolute adjective', r.length === 1 && r[0].alts[0] === 'unique', r);
t = 'I wanna go';
r = one(t, note(t, 'wanna', 'Informal word'));
ok('informal word', r.length === 1 && r[0].alts[0] === 'want to', r);
t = 'This example proves that facts matter.';
r = one(t, note(t, 'proves', 'Overclaim: demonstrate? suggest?'));
ok('proves', r.length === 1 && r[0].alts.join('|') === 'suggests|supports', r);
t = 'Two sentences. Two sentences.';
ok('a note with nothing concrete to offer goes', one(t, note(t, 'Two', 'Two sentences in a row begin the same way; vary the second opening', { cat: 'c' }, 1)).length === 0);
t = 'He spoke clearly.';
ok('a style note the table does not know, with nothing to offer, goes', one(t, note(t, 'clearly', 'Something new and unknown', { cat: 's' })).length === 0);
ok('a grammar note the table does not know stays', one(t, note(t, 'clearly', 'Something new and unknown', { cat: 'g' })).length === 1);

/* lessons by kind */
const L = w => (R.lesson(w) || [''])[0];
ok('lesson: concision', /short form/.test(L('"Can" is shorter and clearer')));
ok('lesson: redundancy', /already contain/.test(L('A gift is already free')));
ok('lesson: preposition', /preposition/.test(L('"Afraid of"')));
ok('lesson: verb form', /bare verb/.test(L('It is “should have”')));
ok('lesson: passive', /doer/.test(L('Possible passive voice')));
ok('lesson: idiom', /Fixed expressions/.test(L('Nip it in the bud')));
ok('lesson: confusable', /sound alike/.test(L('"Lose" is the verb; "loose" means not tight')));
ok('lesson: agreement', /match its subject/.test(L('"Neither" takes a singular verb')));
ok('lesson: none for an unknown kind', R.lesson('Zzz unknown') === null);

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
