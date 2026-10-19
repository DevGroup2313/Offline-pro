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
/* by design, a formation by a prefix one slip from a common word stays
   marked, so the slip is caught: "intergrated" (integrated). 7.47: a word
   built by a suffix from a known one is a word, though one slip from
   another ("focalization", the term of narrative theory, is not
   "localization"; "interiority" is not "inferiority") */
for (const w of ['intergrated', 'transpotation', 'underound'])
  ok('marked, one slip from a common word: ' + w, !SP.known(D, w));
/* 7.47: words of published articles the checker "corrected" before */
for (const w of ('focalization attaches logics triaging cognitions interiority personalist enaction intubation relatedly schemas determinisms ' +
  'principlism tokenist lowercased interweaved devitalization miscrediting predesigned atemporal reposited travelled').split(' '))
  ok('7.47 known: ' + w, SP.known(D, w));
/* 7.47: British forms of known words */
for (const w of 'foetal aetiological paediatric weaponised pre-emptive focusses co-operate'.split(' ')) ok('7.47 British: ' + w, SP.known(D, w));
/* 7.47: and the forms made the wrong way stay marked */
for (const w of 'attachs studys teached childs catched thinked analysises'.split(' ')) ok('7.47 still marked: ' + w, !SP.known(D, w));

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

/* 7.49: the writer's own dictionary */
{
  const D2 = SP.load(fs.readFileSync(path.join(ROOT, 'Inkwell-Android', 'app', 'src', 'main', 'assets', 'vendor', 'scowl-words.txt'), 'utf8'));
  const fl = t => SP.check(D2, t, { margin: 0.2, maxScore: 1.35 });
  ok('an unknown term is marked first', fl('Foucault names it biopowr here.').length === 1);
  SP.addWords(D2, ['biopowr', 'Gadamer', 'Nkrumah']);
  ok('a word added is known', fl('Foucault names it biopowr here.').length === 0, fl('Foucault names it biopowr here.'));
  ok('a slip in an added name is corrected to it', (fl('As Gadamar argues, health hides.')[0] || {}).fix === 'Gadamer', fl('As Gadamar argues, health hides.'));
  ok('a rare name the list knows becomes one to correct to', (fl('Writers such as Kwame Nkrumahh wrote on it.')[0] || {}).fix === 'Nkrumah', fl('Writers such as Kwame Nkrumahh wrote on it.'));
  SP.dropWord(D2, 'biopowr');
  ok('a word removed is marked again', fl('Foucault names it biopowr here.').length === 1);
  SP.dropWord(D2, 'Nkrumah');
  ok('a name removed goes back to rare', !(fl('Writers such as Kwame Nkrumahh wrote on it.')[0] || {}).fix);
  SP.addWords(D2, ['the', 'The']);
  ok('a word the list knows is left as it was', SP.level(D2, 'the') !== 15);
}

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
