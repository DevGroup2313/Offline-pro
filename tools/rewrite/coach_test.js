/* Tests for src/lib/coach_core.js: node tools/rewrite/coach_test.js */
const path = require('path');
const K = require(path.join(__dirname, '..', '..', 'src', 'lib', 'coach_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }
const has = (r, w) => r.hits.some(h => h.toLowerCase() === w.toLowerCase());

/* what each coach finds, and what it leaves alone */
let r = K.read('show', 'She was very nervous before the talk. He spoke angrily. The room was cold.');
ok('show finds a named feeling', has(r, 'was very nervous') && has(r, 'angrily'), r.hits);
ok('show leaves a fact alone', !r.hits.some(h => /cold/.test(h)), r.hits);
ok('show tries on the first sentence with a feeling', r.on === 'She was very nervous before the talk.', r.on);
ok('show: nothing to tell', K.read('show', 'She turned her ring twice.').hits.length === 0);
ok('show check: still telling', /still tells/.test(K.check('show', 'She was nervous.', 'She felt anxious.')));
ok('show check: shown', /comes through/.test(K.check('show', 'She was nervous.', 'She turned her ring twice.')));

r = K.read('vivid', 'The room had a lot of nice stuff.');
ok('vivid finds general words', has(r, 'a lot') && has(r, 'nice') && has(r, 'stuff'), r.hits);

r = K.read('signpost', 'The sample was small. The effect was large. However, the cost was high.');
ok('signpost finds the bare sentence', r.hits.length === 1 && /^The effect was large/.test(r.hits[0]), r.hits);
ok('signpost: one sentence', /at least two/.test(K.read('signpost', 'One sentence only.').say));
ok('signpost check', /opens with a link/.test(K.check('signpost', '', 'Even so, the effect was large.')));

r = K.read('topic', 'Smith (2019) studied forty schools. The results were mixed.');
ok('topic: opens with a source', /opens with a source/.test(r.say), r.say);
ok('topic: a question', /question/.test(K.read('topic', 'Why do classes matter? They do.').say));

r = K.read('synthesis', 'Smith (2019) found a fall. Jones (2020) argues the opposite. Lee and Park (2021) found a rise.');
ok('synthesis finds three source-led sentences', r.hits.length === 3, r.hits);
ok('synthesis: ideas lead', K.read('synthesis', 'Two studies found a fall (Smith 2019; Jones 2020). One found a rise.').hits.length === 0);

r = K.read('method', 'Some participants were tested for a while. We measured several variables.');
ok('method finds vague quantities', has(r, 'Some') && has(r, 'a while') && has(r, 'several'), r.hits);

r = K.read('abstract', 'Little is known about attention. This study interviews forty students.');
ok('abstract: missing finding and why it matters', r.hits.indexOf('the finding') >= 0 && r.hits.indexOf('why it matters') >= 0 && r.hits.indexOf('the problem') < 0, r.hits);

r = K.read('rhythm', 'We walked for hours on end. We were tired by then. We stopped at the inn.');
ok('rhythm: lengths and repeated opening', /Sentence lengths: 6, 5, 5/.test(r.say) && /drone/.test(r.say) && /“We”/.test(r.say), r.say);

r = K.read('expand', 'Smaller classes did not help the pupils. This was because the teachers were new.');
ok('expand finds the bare claim', r.hits.length === 1 && /^Smaller classes/.test(r.hits[0]), r.hits);

ok('warm notes formality', K.read('warm', 'Applicants must submit the form by Friday.').hits.length === 2);
ok('diplomatic finds blunt words', has(K.read('diplomatic', 'You must fix this immediately.'), 'You must') && has(K.read('diplomatic', 'You must fix this immediately.'), 'immediately'));
ok('absolutes', has(K.read('absolutes', 'Students always learn more; this proves it.'), 'always') && has(K.read('absolutes', 'Students always learn more; this proves it.'), 'proves'));
ok('claim counts softeners', K.read('claim', 'It could perhaps be argued that size may matter.').hits.length === 3, K.read('claim', 'It could perhaps be argued that size may matter.').hits);
ok('long sentence', K.read('long', 'The trial, which ran for a year in forty schools across three counties with the help of many teachers and parents, found that smaller classes helped pupils less than better teaching did overall.').hits.length === 1);
ok('passive without a doer', has(K.read('passive', 'The results were checked twice. The team was praised by all.'), 'were checked') && !has(K.read('passive', 'The team was praised by all.'), 'was praised'));
ok('loaded', has(K.read('loaded', 'The results were terrible.'), 'terrible'));
r = K.read('cut', 'One two three four five six. Seven eight nine.');
ok('cut target', r.n === 9 && r.target === 6, r);
ok('cut check', /Shorter by 33%/.test(K.check('cut', 'one two three', 'one two')), K.check('cut', 'one two three', 'one two'));

/* prompts, read for what they ask */
const P = (s) => K.plan(s);
ok('plan: show', P("Show, don't tell").coach.join() === 'show');
ok('plan: formal', P('Make it more formal').rw.join() === 'scholarly', P('Make it more formal'));
ok('plan: concise', P('Make it more concise').rw.join() === 'concise,shorten', P('Make it more concise'));
ok('plan: active', P('Use the active voice').rw.join() === 'active');
ok('plan: correct', P('Fix the grammar only').rw.join() === 'correct', P('Fix the grammar only'));
ok('plan: natural', JSON.stringify(P('Make it sound natural').rw) === '[["correct","concise"]]', P('Make it sound natural'));
ok('plan: hedge', P('Hedge the claims to match the evidence').rw.join() === 'hedge' && P('Hedge the claims to match the evidence').coach.join() === 'absolutes', P('Hedge the claims to match the evidence'));
ok('plan: unknown', !P('Translate this into Welsh').known);
ok('plan: abstract', P('Rewrite it as a thesis abstract').coach.indexOf('abstract') >= 0 && P('Rewrite it as a thesis abstract').rw.join() === 'scholarly', P('Rewrite it as a thesis abstract'));
ok('every coach reads an empty passage without failing', K.ids.every(id => { try { return !!K.read(id, '').say; } catch (e) { return false; } }));
ok('every coach checks an empty try without failing', K.ids.every(id => { try { return typeof K.check(id, '', '') === 'string'; } catch (e) { return false; } }));

console.log(pass + ' of ' + (pass + fails.length) + ' pass' + (fails.length ? '\n\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
