/* Tests for src/lib/myway_core.js: node tools/myway/myway_test.js
   7.44: the settings, the places and the times of My way of working; the
   cards and the panel are tested in the browser (see the 7.44 notes). */
const path = require('path');
const mem = {};
global.self = { localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } }, addEventListener() {} };
const W = require(path.join(__dirname, '..', '..', 'src', 'lib', 'myway_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }

const g0 = W.get();
ok('everything is off until switched on', !g0.comfort.on && !g0.where.on && !g0.three.on);
W.set('where.on', true);
ok('a switch is kept', W.get().where.on === true && !W.get().three.on);
W.set('comfort.size', 140);
ok('a comfort value is kept, the others stay', W.get().comfort.size === 140 && W.get().comfort.line === 1.9);
W.set('nothing.here', 1);
ok('an unknown setting is ignored', !('nothing' in W.get()));
mem.ink_way = '{"comfort":{"on":true,"size":"x"},"bogus":1';
ok('a damaged setting falls back to the defaults', W.get().comfort.on === false && W.get().where.on === false);

const T = '# Chapter 2: Method\nThis chapter sets out how the study was carried out.\n\nTwenty-four pupils in Year 9 took part.\nThe interviews took place in the school library, after lessons, and each lasted about thirty minutes.\nEach interview was recorded.';
const at = T.indexOf('library');
const p = W.place(T, at);
ok('the paragraph is counted among those with words', p.para === 4 && p.of === 5, p);
ok('its opening words', p.snip === 'The interviews took place in the school library, after lessons, and each lasted about thirty minutes.', p.snip);
ok('a long paragraph is shortened at a word', /^\S.{60,110}\S…$/.test(W.cut('word '.repeat(60), 110)) && !/wor…$/.test(W.cut('word '.repeat(60), 110)), W.cut('word '.repeat(60), 110));
ok('the heading it sits under', p.head === 'Chapter 2: Method', p.head);
const T2 = 'A new opening paragraph, written later.\n' + T;
ok('the place is found again after text is added above it', W.find(T2, p) === T2.indexOf('library'), W.find(T2, p));
ok('a paragraph that is gone: the old position, within the text', W.find('Short.', p) === 6);
ok('no record: the start', W.find(T, null) === 0);

const now = new Date(2026, 9, 18, 10, 0).getTime();
ok('a moment ago', W.when(now - 20e3, now) === 'a moment ago');
ok('minutes ago', W.when(now - 25 * 60e3, now) === '25 minutes ago');
ok('today', W.when(new Date(2026, 9, 18, 8, 5).getTime(), now) === 'today at 08:05');
ok('yesterday', W.when(new Date(2026, 9, 17, 21, 40).getTime(), now) === 'yesterday at 21:40', W.when(new Date(2026, 9, 17, 21, 40).getTime(), now));
ok('this week', W.when(new Date(2026, 9, 14, 9, 15).getTime(), now) === 'on Wednesday at 09:15', W.when(new Date(2026, 9, 14, 9, 15).getTime(), now));
ok('earlier', W.when(new Date(2026, 9, 3, 9, 15).getTime(), now) === 'on 3 October at 09:15');
ok('another year', W.when(new Date(2025, 11, 30, 9, 15).getTime(), now) === 'on 30 December 2025 at 09:15');

W.save('inkwell', 'd1', p);
W.note('inkwell', 'd1', '  Add the consent form wording.  ');
W.save('inkwell', 'd1', W.place(T, 10));
const r = W.load('inkwell', 'd1');
ok('a new place keeps the note', r.note === 'Add the consent form wording.' && r.pos === 10, r);
ok('each app and document has its own place', W.load('tabula', 'd1') === null);

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
