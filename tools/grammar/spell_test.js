/* Tests for src/lib/spell_core.js with the shipped word list:
   node tools/grammar/spell_test.js
   7.43: scholarly vocabulary is known, names and the writer's own terms are
   left alone, and the common misspellings are still caught. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SP = require(path.join(ROOT, 'src', 'lib', 'spell_core.js'));
const D = SP.load(fs.readFileSync(path.join(ROOT, 'Inkwell-Android', 'app', 'src', 'main', 'assets', 'vendor', 'scowl-words.txt'), 'utf8'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }
const flags = t => SP.check(D, t, { margin: 0.2, maxScore: 1.35 });

/* scholarly words are words */
for (const w of ('deontological personhood generalizability electroconvulsive colorectal misrecognition reframe sociotechnical digitalization ' +
  'narratively disempowering microclimatic epistemic hermeneutic phenomenological intersubjectivity ontological teleological ' +
  'neuroethics operationalize transcranial metafunction declaratives infrastructurally neurotechnology heteronormative decolonial positionality').split(' '))
  ok('known: ' + w, SP.known(D, w));
/* by design, a formation one slip from a common word stays marked, so the
   slip is caught: "focalization" (localization), "intergrated" (integrated) */
for (const w of ['focalization', 'intergrated', 'transpotation', 'underound'])
  ok('marked, one slip from a common word: ' + w, !SP.known(D, w));

/* the common misspellings are not */
const MISS = { recieve: 'receive', seperate: 'separate', definately: 'definitely', occured: 'occurred', untill: 'until', thier: 'their', goverment: 'government',
  enviroment: 'environment', accomodate: 'accommodate', independant: 'independent', arguement: 'argument', begining: 'beginning', beleive: 'believe',
  neccessary: 'necessary', occurence: 'occurrence', wierd: 'weird', publically: 'publicly', accidently: 'accidentally', basicly: 'basically',
  unecessary: 'unnecessary', occuring: 'occurring', writting: 'writing', truely: 'truly', supercede: 'supersede', persue: 'pursue', wich: 'which' };
for (const [bad, good] of Object.entries(MISS)) {
  ok('unknown: ' + bad, !SP.known(D, bad));
  const e = flags('We noted that ' + bad + ' it was.')[0];
  ok('flagged: ' + bad, e && e.orig === bad && (e.fix === good || (e.alts || []).indexOf(good) >= 0), e);
}

/* names at the start of a sentence, and terms the writer uses often */
ok('a name at a sentence start is left alone', flags('Kraemer discusses a case. Ulya observes the same.').length === 0, flags('Kraemer discusses a case. Ulya observes the same.'));
ok('a slip at a sentence start is still caught', ((flags('Teh results were clear.')[0] || {}).alts || [])[0] === 'The', flags('Teh results were clear.'));
const term = 'Algorithmic glarbing shapes care. By glarbing I mean a structural relation. Glarbing persists; glarbing spreads.';
ok("the writer's term used often is left alone", flags(term).length === 0, flags(term));
ok('a term used once is still marked', flags('This glarbing shapes care.').length === 1);
ok('a repeated slip with a clear fix is still caught', flags('I recieve it, you recieve it, we recieve it.').filter(e => e.fix === 'receive').length === 3);
ok('rare words are never offered as corrections', flags('The resuls were clear.').every(e => (e.alts || []).every(a => (SP.level(D, a.toLowerCase()) < 80))));

/* the apparatus: hyphenated prefixes, Latin, Roman numerals */
for (const t of ['The socio-economic and neuro-ethical stakes.', 'It holds per se, in vitro and in situ.', 'See sections ii, iii and iv.'])
  ok('left alone: ' + t, flags(t).length === 0, flags(t));
ok('"vix" is not a numeral to the checker', flags('The vix result.').length === 1);

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
