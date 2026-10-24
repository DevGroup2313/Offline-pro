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

/* 7.52: measured on the Write & Improve halves (tools/grammar/README.md) */
const fixOf = t => (flags(t)[0] || {}).fix;
/* the common word stands clear of a rare one at the same distance */
for (const [bad, good] of [['throug', 'through'], ['goingo', 'going'], ['privte', 'private'], ['knies', 'knees'], ['cooporation', 'cooperation'], ['depands', 'depends']])
  ok('7.52 clear of the rare word: ' + bad, fixOf('I think ' + bad + ' is here.') === good, flags('I think ' + bad + ' is here.'));
/* a long word two slips from its only common candidate */
for (const [bad, good] of [['lenguaje', 'language'], ['nesesary', 'necessary'], ['prfesional', 'professional'], ['atencion', 'attention'], ['chilfen', 'children']])
  ok('7.52 two slips, one common candidate: ' + bad, fixOf('I think ' + bad + ' is here.') === good, flags('I think ' + bad + ' is here.'));
/* and not a rare one, nor a short word */
ok('7.52 a rare candidate is not forced: frigo', fixOf('I think frigo is here.') == null);
ok('7.52 beyond two slips the word is only marked: syntaxis', fixOf('I think syntaxis is here.') == null && (flags('I think syntaxis is here.')[0] || {}).alts[0] === 'syntax');
/* a neighbouring key costs about what a letter left out costs: neither wins alone */
for (const w of ['healty', 'amoung', 'eaily', 'creats']) ok('7.52 a near key and a letter left out stay a question: ' + w, fixOf('I think ' + w + ' is here.') == null, flags('I think ' + w + ' is here.'));
ok('7.52 a compound of known words is not forced: callsign', fixOf('The callsign is here.') == null);
ok('7.52 a detached prefix is left alone', flags('I have a pre - intermediate level and pre historic graves.').length === 0);
ok('7.52 a term glossed in brackets is left alone', flags('He wore a manica (a heavy linen wrapping) on his arm.').length === 0);
ok('7.52 a term the sentence defines is left alone', flags('The falx was a curved blade that was sharp.').length === 0);
ok('7.52 the small words of other languages inside names are left alone', flags('We drove to Ca los Cans and Tignes les Boisses for los Picarones.').length === 0, flags('We drove to Ca los Cans and Tignes les Boisses for los Picarones.'));
ok('7.52 a slip at the first letter is rarer: nopal, susage', fixOf('I ate nopal there.') == null && fixOf('I ate susage there.') == null, [flags('I ate nopal there.'), flags('I ate susage there.')]);
ok('7.52 a word of the middle level is still reached: burguers, diabete', fixOf('I ate burguers there.') === 'burgers' && fixOf('He has diabete now.') === 'diabetes', [flags('I ate burguers there.'), flags('He has diabete now.')]);
ok('7.52 a short capital at a sentence start is a name: Maon', flags('Maon, according to Joshua, was a town.').every(e => e.fix == null));
ok('7.52 "i\'m" is left to the capital rule', flags("and i'm here now.").length === 0, flags("and i'm here now."));
ok('7.52 loanwords without their accents are words', flags('They met in cafes and ate jalapenos with a certain naivete.').length === 0);
ok('7.52 a short word keeps its caution: thay', fixOf('I think thay is here.') == null);
/* three slips in a row are slips, not a phrase of another language */
{
  const r = flags('Alongside with its development, the ablity of travalling has easened to such a scale.');
  ok('7.52 a run of slips stays marked', r.length === 3 && r[0].fix === 'ability' && r[1].fix === 'travelling', r);
}
for (const t of ['He wrote il buio e il miele on the wall.', 'The phrase substantia individua rationalis is his.', 'She called it a “buon giorno” moment.'])
  ok('7.52 a phrase of another language is left alone: ' + t, flags(t).length === 0, flags(t));

/* 7.52: the lesson of a spelling fix is the word itself */
const les = (a, b) => (SP.lesson(a, b) || [''])[0];
ok('lesson: a classic word', les('nesesary', 'necessary').indexOf('one c, two s') > 0, les('nesesary', 'necessary'));
ok('lesson: the classic word inflected', les('recieving', 'receiving').indexOf('except after c') > 0, les('recieving', 'receiving'));
ok('lesson: a letter missing', les('throug', 'through') === 'Through ends in -ough: th-r-ough.' || les('throug', 'through') === 'The “h” was missing: through.', les('throug', 'through'));
ok('lesson: an extra letter', les('goingo', 'going') === 'An extra “o”: going, not goingo.', les('goingo', 'going'));
ok('lesson: a vowel for another', les('depands', 'depends') === 'The vowel is “e”, not “a”: depends.', les('depands', 'depends'));
ok('lesson: a doubled letter', les('comitted', 'committed') === 'Double “m”: committed.', les('comitted', 'committed'));
ok('lesson: one letter, not two', les('untill', 'until').indexOf('one l') > 0 && les('occassion', 'occasion').indexOf('two c, one s') > 0 && les('dinning', 'dining') === 'One “n”, not two: dining.', [les('untill', 'until'), les('dinning', 'dining')]);
ok('lesson: two letters swapped', les('thier', 'their').indexOf('e before i') > 0, les('thier', 'their'));
ok('lesson: i before e', les('acheive', 'achieve').indexOf('i before e') === 0, les('acheive', 'achieve'));
ok('lesson: two words', les('everysite', 'every site') === 'Two words, not one: every site.', les('everysite', 'every site'));
ok('lesson: a larger slip', les('atencion', 'attention').indexOf('Attention') === 0, les('atencion', 'attention'));
ok('lesson: the tricky part named', les('lenguaje', 'language').indexOf('Language') === 0 && les('distation', 'dictation') === 'The letter is “c”, not “s”: dictation.' && les('tempature', 'temperature') === 'The letters “er” were missing: temperature.', [les('lenguaje', 'language'), les('distation', 'dictation')]);
ok('lesson: a capital alone is no lesson', SP.lesson('the', 'The') === null);
ok('lesson: the example keeps the writer\'s case', (SP.lesson('Peple', 'People') || [])[1] === 'Peple → People');

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
