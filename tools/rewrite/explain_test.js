/* Tests for src/lib/explain_core.js: node tools/rewrite/explain_test.js
   7.43: each change of a version, its reason, its alternatives, and the
   version put together again from the writer's choices. */
const path = require('path');
const X = require(path.join(__dirname, '..', '..', 'src', 'lib', 'explain_core.js'));
const R = require(path.join(__dirname, '..', '..', 'src', 'lib', 'rewrite_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }

const T = 'In recent years, there has been a growing amount of research that has been carried out into the ways in which social media platforms are able to influence the political opinions of young people. It is very clear that this is a really important issue, and it is something that needs to be looked at in a lot more detail. There are many students who struggle with it.';
const r = R.explain('scholarly', T);
const G = X.analyse(T, r.text, r.changes);
ok('a rule version is read as changes', G && G.length === 8, G && G.map(g => g.from));
ok('every change has a reason', G.every(g => g.reasons.length && g.reasons[0].text.length > 10));
ok('two places one rule made are one change', G.some(g => g.from === 'There are many students who' && g.to === 'Many students'), G.map(g => [g.from, g.to]));
ok('each change names its rule', G.find(g => /^It is very clear/.test(g.from)).reasons.map(x => x.why).join() === 'opener,intensifier');
ok('all changes kept is the version', X.compose(T, r.text, G, {}) === r.text);
const mine = {}; G.forEach((g, i) => { mine[i] = 'o'; });
ok('all refused is the writer\'s text', X.compose(T, r.text, G, mine) === T, X.compose(T, r.text, G, mine));
for (let i = 0; i < G.length; i++) {
  const c = {}; c[i] = 'o'; const out = X.compose(T, r.text, G, c);
  ok('refusing change ' + i + ' puts back exactly the writer\'s words', out.indexOf(G[i].from) >= 0 && !/\w{2,}(?:who|that)struggle|\s{2}/.test(out), out);
}
const k = G.findIndex(g => /^It is very clear/.test(g.from));
ok('an alternative keeps the change\'s other edits', G[k].alts[0] === 'Clearly, this is an', G[k].alts);
ok('choosing it puts it in place', X.compose(T, r.text, G, { [k]: 0 }).indexOf('Clearly, this is an important issue, and it needs closer examination.') >= 0, X.compose(T, r.text, G, { [k]: 0 }));
const parts = X.parts(T, r.text, G, {});
ok('the parts show each change whole', parts.filter(p => !('same' in p)).length === 8 && parts.some(p => p.from === 'It is very clear that this is a really' && p.to === 'This is an'));

/* a model's version: reasons where a rule does the same, and the rest named */
const M = 'Recent research has examined how social media platforms influence young people’s political views. This important issue warrants closer examination. Many students struggle with it.';
const GM = X.analyse(T, M, null, { model: true });
ok('a model version: one change per sentence', GM.length === 3, GM.map(g => g.from.slice(0, 30)));
ok('a model change a rule makes gets the rule\'s reason', GM[2].reasons[0].why === 'expletive' && GM[1].reasons.some(x => x.why === 'opener'), GM.map(g => g.reasons.map(x => x.why)));
ok('what no rule explains is named for what it is', GM[0].reasons.some(x => x.why === 'reworded'));
ok('a model change is marked as the model\'s', GM.every(g => g.model));
const nm = {}; GM.forEach((g, i) => { nm[i] = 'o'; });
ok('refusing all of a model\'s changes gives the writer\'s text', X.compose(T, M, GM, nm) === T);
ok('the rules\' own version is offered beside the model\'s', GM[1].alts.length === 1 && /needs closer examination/.test(GM[1].alts[0]), GM[1].alts);

/* a model that merged three sentences into one: one change, whole */
const T2 = 'Two difficulties follow. First, it is unclear how to judge. Second, the evidence is ignored.';
const M2 = 'The view cannot say how to judge, and it ignores the evidence.';
const G2 = X.analyse(T2, M2, null, { model: true });
ok('merged sentences are one change', G2.length === 1 && X.compose(T2, M2, G2, { 0: 'o' }) === T2, G2.map(g => [g.from, g.to]));

/* the plain cases */
ok('a version the same as the text has no changes', X.analyse('It works.', 'It works.', []).length === 0);
const g1 = X.analyse('The result is very clear.', 'The result is clear.', [{ from: 'very ', to: '', why: 'intensifier' }]);
ok('a word taken out', g1.length === 1 && g1[0].from === 'very' && g1[0].to === '' && X.compose('The result is very clear.', 'The result is clear.', g1, { 0: 'o' }) === 'The result is very clear.', g1);
ok('generic: punctuation', X.generic('However', 'However,').why === 'mark');
ok('generic: order', X.generic('quickly ran', 'ran quickly').why === 'order');
ok('generic: added', X.generic('', 'indeed').why === 'added');
ok('locate finds a rule\'s words through an earlier change', X.locate("It's clear that we're late.", 'It is clear that ').length === 1);

/* a model's answer made into a passage */
ok('a reply\'s opening is taken off', X.clean('It works.', "That's a great point. It does work.") === 'It does work.');
ok('a label is taken off', X.clean('It works.', 'Rewritten passage: It does work.') === 'It does work.');
ok('a note after the passage is taken off', X.clean('It works.', 'It does work.\n\nNote: I changed one word.') === 'It does work.');
ok('another script is taken out', X.clean('It warrants study.', 'It warrants更为 extensive study.') === 'It warrants extensive study.', X.clean('It warrants study.', 'It warrants更为 extensive study.'));
ok('a dropped citation goes back where its claim is', X.clean('Algorithms play a big role (Smith, 2019). More is needed.', 'Algorithms play a major role. More research is needed.') === 'Algorithms play a major role (Smith, 2019). More research is needed.', X.clean('Algorithms play a big role (Smith, 2019). More is needed.', 'Algorithms play a major role. More research is needed.'));
ok('a citation whose claim was cut stays out', X.clean('Two points follow. Errors arise from closure (Graber, 2005).', 'Two points follow.') === 'Two points follow.');
ok('nothing is repaired when asked not to', X.clean('A claim (Smith, 2019).', '1. A claim.\n2. Another.', { repair: false }) === '1. A claim.\n2. Another.');

ok('a spoken opening the writer did not write is taken off', X.clean('The view holds.', 'Hmm, the view holds.') === 'The view holds.', X.clean('The view holds.', 'Hmm, the view holds.'));
ok('the writer\'s own "So" stays', X.clean('So we went home.', 'So we went back home.') === 'So we went back home.');
ok('judge: a description, not a rewrite', X.judge('Hermeneutic approaches treat understanding as an event.', 'The passage discusses hermeneutic perspectives on judgement.').meta === true);
ok('judge: a rewrite is not a description', X.judge('Hermeneutic approaches treat understanding as an event.', 'Hermeneutic approaches see understanding as an event.').meta === false);
ok('judge: a new "I"', /speaks as/.test(X.judge('The account fails.', 'I find that the account fails.').voice));
ok('judge: "the narrator"', /author/.test(X.judge('My brother swam.', 'The narrator reports that the brother swam.').voice + X.judge('My brother swam.', 'The narrator\'s brother swam.').voice));
ok('judge: far from the words', X.judge('Hermeneutic approaches to clinical judgement treat understanding as an event.', 'Doctors often think in stories that change over time.').far === true);
ok('judge: a close version is not far', X.judge('Hermeneutic approaches to clinical judgement treat understanding as an event.', 'Hermeneutic approaches to clinical judgement see understanding as an event.').far === false);

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
