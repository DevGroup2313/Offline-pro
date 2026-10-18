/* Tests for src/lib/find_core.js: node tools/find/find_test.js
   7.44: search as Word searches; the parts that need a page are tested in
   the browser (see the 7.44 notes). */
const path = require('path');
const F = require(path.join(__dirname, '..', '..', 'src', 'lib', 'find_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }
const at = (t, n, o) => F.find(t, n, o).map(m => t.slice(m[0], m[1]));

const T = 'The hermeneutic circle, Gadamer’s term, returns. The Circle closes.\nA circle\nencircled circles.';
ok('every match, any case', at(T, 'circle').length === 5, at(T, 'circle'));
ok('match case', at(T, 'Circle', { matchCase: true }).join() === 'Circle', at(T, 'Circle', { matchCase: true }));
ok('whole words only', at(T, 'circle', { wholeWord: true }).length === 3, at(T, 'circle', { wholeWord: true }));
ok('a straight apostrophe finds the curly one', at(T, "Gadamer's").join() === 'Gadamer’s');
ok('a curly apostrophe finds the straight one', at("Gadamer's term", 'Gadamer’s').join() === "Gadamer's");
ok('a straight quotation mark finds the curly ones', at('He wrote “play” twice.', '"play"').join() === '“play”');
ok('a match never crosses a paragraph', at('A circle\nencircled', 'circle encircled').length === 0 && at('A circle\nencircled', 'circle\nencircled').length === 0);
ok('a no-break space is a space', at('p. 12', 'p. 12').length === 1);
ok('accents count unless asked', at('Merleau-Ponty and Mérleau', 'merleau').length === 1 && at('Merleau-Ponty and Mérleau', 'merleau', { ignoreAccents: true }).length === 2);
ok('œ stays itself', at('Ricœur', 'ricoeur', { ignoreAccents: true }).length === 0);
ok('places stay the same when a letter folds to two', (() => { const t = 'İstanbul circle'; const m = F.find(t, 'circle'); return m.length === 1 && t.slice(m[0][0], m[0][1]) === 'circle'; })());
ok('nothing to find finds nothing', F.find(T, '').length === 0);
ok('matches do not overlap', F.find('aaaa', 'aa').length === 2);
ok('whole words: a word beside a full stop or a dash', at('the circle. circle-work circle', 'circle', { wholeWord: true }).length === 3);
ok('whole words: a phrase', at('a hermeneutic circle and hermeneutic circles', 'hermeneutic circle', { wholeWord: true }).length === 1);
ok('whole words: a needle that starts with a mark', at('(Gadamer, 1960) and (Gadamer, 1960a)', '(Gadamer, 1960', { wholeWord: true }).length === 1);
ok('a limit stops the search', F.find('x x x x x', 'x', { limit: 3 }).length === 3);

const CT = 'First line.\nIn Truth and Method Gadamer develops the notion of play, which recurs throughout his later work on art and on festivals.\nNext.', ci = CT.indexOf('play');
const c = F.context(CT, ci, ci + 4, 30, 30);
ok('context stays in its paragraph', !/First|Next/.test(c.pre + c.post), c);
ok('context: the match itself', c.hit === 'play', c);
ok('context: shortened at words, marked', /^…/.test(c.pre) && /…$/.test(c.post) && !/^…\S*\s?$/.test(c.pre), c);

/* a long document */
const words = 'the hermeneutic circle of understanding returns in every reading of the text and its reader'.split(' ');
let big = ''; for (let i = 0; i < 100000; i++) { big += words[i % words.length] + (i % 120 === 119 ? '.\n' : ' '); }
const t0 = Date.now(); const m = F.find(big, 'the'); const ms = Date.now() - t0;
ok('100,000 words: every "the" found', m.length === (big.match(/the/g) || []).length, m.length);
ok('100,000 words in under 150 ms', ms < 150, ms);
const t1 = Date.now(); F.find(big, 'circle', { wholeWord: true, ignoreAccents: true }); const ms2 = Date.now() - t1;
ok('with every option, under 300 ms', ms2 < 300, ms2);

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
