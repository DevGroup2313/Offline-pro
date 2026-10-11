/* Tests for src/lib/paraphrase_core.js, synonyms_core.js and lexicon_core.js:
   node tools/rewrite/para_test.js
   Each case is one that was wrong in a test on real sentences (Wikipedia,
   student essays) and was fixed, or one the writer asked for by name. */
const path = require('path'), fs = require('fs');
const lib = n => path.join(__dirname, '..', '..', 'src', 'lib', n);
const X = require(lib('lexicon_core.js'));
const P = require(lib('paraphrase_core.js'));
const S = require(lib('synonyms_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }
const texts = (a) => a.map(o => o.text);
const style = (t, st) => texts(P.restyle(t, st));
const all = (t) => ['scholarly', 'professional', 'casual', 'plain'].reduce((a, st) => a.concat(style(t, st)), []);
const words = (w, s) => [].concat.apply([], P.wordAlternatives(w, s).map(g => g.words));

/* without the lexicon: idioms, pairs and the common list still work */
ok('idiom without lexicon', texts(P.idiomVersions('He lost his train of thought.')).join('|') === 'He lost track of what he was saying.|He lost the thread of his argument.|He forgot what he was going to say.', texts(P.idiomVersions('He lost his train of thought.')));
ok('common list without lexicon', words('meeting', 'After the long meeting.').indexOf('gathering') >= 0, words('meeting', 'After the long meeting.'));

const LEXF = path.join(__dirname, '..', '..', 'Inkwell-Android', 'app', 'src', 'main', 'assets', 'vendor', 'wordnet-lex.txt');
ok('lexicon loads', X.load(fs.readFileSync(LEXF, 'utf8')) && X.ready);

/* the writer's example, in three registers, the tense kept */
ok('train of thought, plain', style('He lost his train of thought.', 'plain')[0] === 'He lost track of what he was saying.', style('He lost his train of thought.', 'plain'));
ok('train of thought, scholarly', style('He lost his train of thought.', 'scholarly')[0] === 'He lost the thread of his argument.');
ok('train of thought, casual', style('He lost his train of thought.', 'casual')[0] === 'He forgot what he was going to say.');
ok('train of thought, perfect tense', style('She has lost her train of thought again.', 'casual')[0] === 'She has forgotten what she was going to say again.', style('She has lost her train of thought again.', 'casual'));
ok('plural kept in an idiom', style('They made up their minds.', 'casual').indexOf('They made their minds up.') >= 0, style('They made up their minds.', 'casual'));
ok('put off, a shared spelling', style('We should put off the meeting.', 'scholarly').indexOf('We should postpone the meeting.') >= 0, style('We should put off the meeting.', 'scholarly'));
ok('a title is not an idiom', style('We watched The Elephant in the Room.', 'plain').every(t => /Elephant in the Room/.test(t)));

/* register pairs: where the words around allow it */
ok('help defeat is not assist defeat', !all('They cannot help defeat the army.').some(t => /assist/.test(t)));
ok('helps us to understand is not assists', !all('It helps us to understand the past.').some(t => /assists/.test(t)));
ok('ensure a safe fight is not make sure', !all('Precautions ensure a safe fight.').some(t => /make sure/.test(t)));
ok('upon us is not on us', !all('Winter is upon us again.').some(t => /on us/.test(t)));
ok('a lot more companies is not considerably', !all('Women now run a lot more companies.').some(t => /considerably/.test(t)));
ok('awareness must increase is not go up', !all('Our awareness must increase.').some(t => /go up/.test(t)));
ok('the species occurs is not happens', !all('The species occurs in Africa.').some(t => /happens/.test(t)));
ok('perhaps mid-clause is kept', !all('He is perhaps best known for his songs.').some(t => /maybe/.test(t)));
ok('the majority of the states: most of', style('He spoke for the majority of the states.', 'casual').some(t => /most of the states/.test(t)), style('He spoke for the majority of the states.', 'casual'));
ok('a name keeps its words', !all("He joined the Children's Crusade.").some(t => /Kids/.test(t)));
ok('a quotation is never touched', all('She said "we need to buy more paper" and left.').every(t => /"we need to buy more paper"/.test(t)));
ok('the enough requirements: no', !all('It lacks the sufficient requirements.').some(t => /the enough/.test(t)));
ok('large language model stays', !all('The use of large language models grew.').some(t => /big language/.test(t)));
ok('casual contractions', style('It is hard to say why they are late.', 'casual').some(t => t === "It's hard to say why they're late."), style('It is hard to say why they are late.', 'casual'));
ok('of it is: no contraction', !style('What they make of it is their own affair.', 'casual').some(t => /it's/.test(t)));
ok('no change is changed again', !style('They often help each other with work.', 'scholarly').some(t => /oftentimes/.test(t)));
ok('formal to casual', style('Furthermore, the committee will not postpone the decision regarding the budget.', 'casual').indexOf("Also, the committee won't put off the decision about the budget.") >= 0, style('Furthermore, the committee will not postpone the decision regarding the budget.', 'casual'));

/* one change of order, only where the meaning holds */
ok('because first', style('We need to buy more paper because the printer ran out.', 'scholarly').indexOf('Because the printer ran out, we need to purchase more paper.') >= 0);
ok('because and: left alone', !all('Many children watch it because the action thrills them and can make them violent.').some(t => /^Because/.test(t)));
ok('not only ... but: left alone', !all('It is not only cheap, but it is also quick.').some(t => /however/.test(t)));
ok('but with no subject: left alone', !all('He was drafted by the Astros, but chose to attend Michigan.').some(t => /however/.test(t)));
ok('a name keeps its capital', all('Chinese literature is rich because the language is old.').every(t => !/chinese/.test(t)));

/* a word's alternatives, by meaning, in its form */
ok('meeting: gathering', words('meeting', 'She was tired after the long meeting.').indexOf('gathering') >= 0);
ok('happy: glad', words('happy', 'She was happy with it.').indexOf('glad') >= 0);
ok('lost (keys): mislaid', words('lost', 'He lost his keys.').indexOf('mislaid') >= 0);
ok('bigger: larger', words('bigger', 'It is bigger than that.')[0] === 'larger', words('bigger', 'It is bigger than that.'));
ok('found out: discovered', words('found out', 'We found out that it failed.')[0] === 'discovered');
ok('increased: rose (it rose)', P.wordAlternatives('increased', 'Prices increased sharply.').some(g => g.words.indexOf('rose') >= 0));
ok('a clear rise: a noun', P.wordAlternatives('rise', 'There was a clear rise in prices.')[0].pos === 'n');
ok('capital kept', words('Happy', 'Happy days.')[0] === 'Glad');
ok('get: got, not getting', X.inflect('get', 'v', 'ed') === 'got' && X.inflect('vie', 'v', 'ed') === 'vied');
ok('a phrase', words('train of thought', 'He lost his train of thought.').indexOf('thread') >= 0);
ok('no word in an idiom changed alone', !P.wordChoices('He lost his train of thought.', 6).some(c => c.text === 'thought'));
ok('the common list is large', S.count() > 800, S.count());

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
