// Writes src/lib/learner_data.js: the word lists the learner-error checks
// (src/lib/learner_core.js) read. From the lexicon (vendor/wordnet-lex.txt:
// WordNet 3.0 with SCOWL levels) and the spelling dictionary
// (vendor/scowl-words.txt): common countable nouns with their plurals,
// common regular verbs, and common adjectives. The irregular verbs are
// written by hand in learner_core.js. Run from the repository:
//   node tools/grammar/learner_lists.mjs
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const LEX = require(path.join(ROOT, 'src', 'lib', 'lexicon_core.js')), SP = require(path.join(ROOT, 'src', 'lib', 'spell_core.js'));
const V = path.join(ROOT, 'Inkwell-Android', 'app', 'src', 'main', 'assets', 'vendor');
LEX.load(fs.readFileSync(path.join(V, 'wordnet-lex.txt'), 'utf8'));
const D = SP.load(fs.readFileSync(path.join(V, 'scowl-words.txt'), 'utf8'));
const lv = w => SP.level(D, w);
const W = LEX._L.W, INV = LEX._L.INV.v;
/* nouns that are not counted, or are plural already: never "a" + these, never "many" + these */
const UNC = new Set('information advice money water music furniture research knowledge work time life food news luggage baggage equipment homework progress traffic weather bread rice sugar salt milk coffee tea air oil gas energy electricity power love hate fun happiness health wealth help luck peace evidence proof data software hardware stuff staff clothing jewellery jewelry cash rubbish garbage trash damage fruit meat fish chicken beef pork cheese butter flour paper glass wood iron steel gold silver cotton wool plastic sand snow rain ice fire smoke dust dirt mud grass hair skin blood sweat heat cold light darkness noise silence sound space room nature art literature poetry history science mathematics physics chemistry biology economics politics education training experience intelligence wisdom courage patience confidence freedom justice truth beauty violence crime pollution transport transportation travel tourism behaviour behavior attention interest pressure stress trouble harm humour humor advertising marketing business commerce trade industry agriculture leisure entertainment shopping housing accommodation parking weight height width length depth speed temperature age youth adulthood childhood growth development change importance permission access support feedback input output content usage use internet web email mail post shipping packaging waste people men women children feet teeth mice geese media criteria phenomena police cattle clergy series species means news'.split(' '));
const nouns = [], verbs = [], adjs = [];
for (const [w, e] of W) {
  if (!/^[a-z]+$/.test(w) || w.length < 3 || e.lv > 35) continue;
  const n = e.tot.n || 0, v = e.tot.v || 0, a = e.tot.a || 0, r = e.tot.r || 0;
  if (n >= 4 && n >= 0.8 * v && n >= 3 * a && !UNC.has(w)) {
    const pl = LEX.inflect(w, 'n', 's');
    /* a noun used as a verb as often ("place", "change") is starred: safe after "many" or "every", not as a subject */
    if (pl && pl !== w && !UNC.has(pl) && lv(pl) >= 0 && lv(pl) <= 50) nouns.push([w, pl, e.lv, n, n < 3 * v]);
  }
  if (v >= 3 && v >= 2 * n && v >= 2 * a) {
    /* a regular verb: its -ed form is its only past and participle. One whose
       spelling doubles a letter or turns y to i ("stopped", "tried") is in
       WordNet's exception list; the forms there are taken when they are of
       one kind. A true irregular (went, gone) is written by hand in
       learner_core.js and left out here. */
    let ing = LEX.inflect(w, 'v', 'ing'), ed = LEX.inflect(w, 'v', 'ed');
    if (INV.has(w)) {
      const f = INV.get(w), eds = f.filter(x => /ed$/.test(x)), ings = f.filter(x => /ing$/.test(x)), other = f.filter(x => !/ed$|ing$/.test(x));
      if (other.length || eds.length > 1 || ings.length > 1) continue;
      if (eds.length) ed = eds[0]; if (ings.length) ing = ings[0];
    }
    if (ing && ed && /ed$/.test(ed) && lv(ing) >= 0 && lv(ed) >= 0) verbs.push([w, e.lv, v, n, ing, ed]);
  }
  if (a >= 3 && a >= 2 * n && a >= 2 * v && a >= r) adjs.push([w, e.lv, a]);
}
nouns.sort((x, y) => x[2] - y[2] || y[3] - x[3]); verbs.sort((x, y) => x[1] - y[1] || y[2] - x[2]); adjs.sort((x, y) => x[1] - y[1] || y[2] - x[2]);
/* a plural written as base+s needs no listing; the rest ("city cities", "man men") are listed with their plural */
const nounStr = nouns.map(([w, pl, l, n, vb]) => (pl === w + 's' ? w : w + '=' + pl) + (vb ? '*' : '')).join(' ');
/* a verb used as a noun as often as a verb ("work", "use", "help") is marked with a star: after a preposition it is left alone */
const regIng = w => /ie$/.test(w) ? w.slice(0, -2) + 'ying' : (/[^aeiouy]e$/.test(w) && !/(ee|ye|oe)$/.test(w)) ? w.slice(0, -1) + 'ing' : w + 'ing';
const regEd = w => /e$/.test(w) ? w + 'd' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ied' : w + 'ed';
const verbStr = verbs.map(([w, l, v, n, ing, ed]) => (n * 3 > v ? w + '*' : w) + (ing === regIng(w) && ed === regEd(w) ? '' : '=' + ing + '=' + ed)).join(' ');
const adjStr = adjs.map(x => x[0]).join(' ');
const out = `/* Inkwell's learner-error word lists (7.42), written by tools/grammar/learner_lists.mjs
   from the lexicon (WordNet 3.0 with SCOWL levels; vendor/WORDNET-LICENCE.txt) and the
   spelling dictionary (SCOWL; vendor/SCOWL-LICENCE.txt). Read by src/lib/learner_core.js.
   NOUNS: common countable nouns, "word" when the plural is word+s, else "word=plural"; a star
   marks a noun used as a verb as often ("place", "change").
   VERBS: common verbs whose past and participle are one -ed form; a star marks one used
   as a noun as often; "base=ing=ed" where the spelling doubles a letter or turns y to i.
   ADJS: common adjectives. */
(function (root) {
  const api = {
    NOUNS: ${JSON.stringify(nounStr)},
    VERBS: ${JSON.stringify(verbStr)},
    ADJS: ${JSON.stringify(adjStr)}
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKLRN_DATA = api;
})(typeof self !== 'undefined' ? self : this);
`;
fs.writeFileSync(path.join(ROOT, 'src', 'lib', 'learner_data.js'), out);
console.log('nouns', nouns.length, 'verbs', verbs.length, 'adjectives', adjs.length, 'bytes', out.length);
