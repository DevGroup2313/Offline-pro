/* Tests for src/lib/mark_core.js: node tools/grammar/mark_test.js
   The scales at every boundary, the parts of the mark, and the counting
   that fed the old score wrongly (possessives taken for contractions). */
const path = require('path');
const M = require(path.join(__dirname, '..', '..', 'src', 'lib', 'mark_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }

/* the scales: AACRAO EDGE's UK table for the US letters */
const want = [[100, 'First', 'Distinction', 'A', 4.0, 'A'], [70, 'First', 'Distinction', 'A', 4.0, 'A'], [69, '2:1', 'Merit', 'B+', 3.3, 'B+'],
  [65, '2:1', 'Merit', 'B+', 3.3, 'B+'], [60, '2:1', 'Merit', 'B+', 3.3, 'B+'], [59, '2:2', 'Pass', 'B', 3.0, 'B'], [50, '2:2', 'Pass', 'B', 3.0, 'B'],
  [49, 'Third', 'Fail', 'C', 2.0, 'F'], [40, 'Third', 'Fail', 'C', 2.0, 'F'], [39, 'Fail', 'Fail', 'F', 0.0, 'F'], [0, 'Fail', 'Fail', 'F', 0.0, 'F']];
for (const [m, ug, pg, us, pts, usPG] of want) {
  const s = M.scales(m);
  ok('scales at ' + m, s.ukUG === ug && s.ukPG === pg && s.usUG.letter === us && s.usUG.points === pts && s.usPG.letter === usPG, s);
}

/* contractions are counted; possessives are not */
const f1 = M.features("Carr's argument and the book's claim rest on Postman's thesis about the reader's attention.", []);
ok('possessives are not contractions', f1.contractions === 0, f1.contractions);
const f2 = M.features("It's clear that we can't say what they'll find, and that's the point.", []);
ok('contractions are counted', Math.abs(f2.contractions - 400 / 13) < 0.01, f2.contractions);

/* headings are not sentences */
ok('a heading is not a sentence', M.sentences('1. Introduction\nThe argument begins here. It ends there.').length === 2, M.sentences('1. Introduction\nThe argument begins here. It ends there.'));
ok('a closing question is a sentence', M.sentences('Is it true? Perhaps.').length === 2);

/* the parts move the right way */
const base = 'The argument proceeds in three stages, each of which depends upon the evidence assembled in the preceding chapter. ';
const text = base.repeat(12);
const clean = M.mark(text, []);
const errs = M.mark(text, Array.from({ length: 12 }, () => ({ cat: 'g' })));
const unclear = M.mark(text, Array.from({ length: 12 }, () => ({ cat: 'c' })));
const style = M.mark(text, Array.from({ length: 12 }, () => ({ cat: 's' })));
ok('correctness notes lower the mark', errs.mark < clean.mark, [clean.mark, errs.mark]);
ok('clarity notes lower the mark', unclear.mark < clean.mark, [clean.mark, unclear.mark]);
ok('style notes (preferences) do not lower the mark', style.mark === clean.mark, [clean.mark, style.mark]);
ok('enough words', clean.enough === true && M.mark('Short text.', []).enough === false);
const plain = M.mark('The cat sat on the mat. The dog ran to the man. '.repeat(15), []);
ok('plain short words earn less than scholarly vocabulary', plain.parts.vocabulary < clean.parts.vocabulary, [plain.parts.vocabulary, clean.parts.vocabulary]);
const huge = M.mark('Incommensurability notwithstanding, phenomenological reconceptualisation necessitates epistemological circumspection. '.repeat(12), []);
ok('very long words are capped', huge.parts.vocabulary <= 18, huge.parts.vocabulary);
const casual = M.mark("You can't miss it! It's what we've all been waiting for, and you'll love it! ".repeat(10), [], { scholarly: true });
ok('contractions and exclamations cost marks in scholarly writing', casual.parts.register < 0, casual.parts.register);
ok('the mark stays within 0 to 100', [clean, errs, unclear, plain, huge, casual].every(r => r.mark >= 0 && r.mark <= 100));

/* Writing and argument: half the writing, half the model's criteria */
ok('combined with no criteria is the writing mark', M.combined(64, []) === 64);
ok('combined: 64 and criteria 4, 4 (65) gives 65 (rounded)', M.combined(64, [4, 4]) === 65, M.combined(64, [4, 4]));
ok('combined: 72 and criteria 5, 3 (75, 55) gives 69', M.combined(72, [5, 3]) === 69, M.combined(72, [5, 3]));

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
