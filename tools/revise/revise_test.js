/* Tests for src/lib/revise_core.js (INKREVISE): a paragraph, a section or
   the whole document revised change by change.
   node tools/revise/revise_test.js */
const path = require('path');
const R = require(path.join(__dirname, '..', '..', 'src', 'lib', 'revise_core.js'));
const X = require(path.join(__dirname, '..', '..', 'src', 'lib', 'explain_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got, null, 1).slice(0, 700) : '')); }

const DOC = [
  '# Chapter One', '',
  'The first paragraph of the chapter has several words in it.', '',
  '## 1.1 Aims', '',
  'The aims are set out here, in a paragraph of their own.[^1]', '',
  'A second paragraph about the aims follows it.', '',
  '## 1.2 Scope', '',
  'The scope is narrow, and this paragraph says so.', '',
  '# Chapter Two', '',
  'Another chapter begins with this paragraph.', '',
  '| a | table | row |', '',
  '# Notes', '',
  '[^1]: A note that is not the writer’s running text.', '',
  '# Bibliography', '',
  'Gadamer, Hans-Georg. Truth and Method. London: Continuum, 2004.'].join('\n');

/* scopes */
{
  const at = DOC.indexOf('second paragraph');
  const p = R.scope(DOC, at, 'para');
  ok('scope: the paragraph the cursor is in', DOC.slice(p.from, p.to) === 'A second paragraph about the aims follows it.', DOC.slice(p.from, p.to));
  const s = R.scope(DOC, at, 'section');
  ok('scope: the section runs to the next heading of its level', DOC.slice(s.from, s.to).startsWith('## 1.1 Aims') && !/1\.2 Scope/.test(DOC.slice(s.from, s.to)), DOC.slice(s.from, s.to));
  ok('scope: the section is named', s.label === '“1.1 Aims”', s.label);
  const c = R.scope(DOC, DOC.indexOf('first paragraph'), 'section');
  ok('scope: a chapter holds its sections', /1\.1 Aims/.test(DOC.slice(c.from, c.to)) && /1\.2 Scope/.test(DOC.slice(c.from, c.to)) && !/Chapter Two/.test(DOC.slice(c.from, c.to)));
  const d = R.scope(DOC, 5, 'doc');
  ok('scope: the whole document', d.from === 0 && d.to === DOC.length);
  const n = R.scope(DOC, DOC.indexOf('A note that'), 'para');
  ok('scope: a note in the Notes is a paragraph of its own', DOC.slice(n.from, n.to) === '[^1]: A note that is not the writer’s running text.', DOC.slice(n.from, n.to));
  const pre = 'Some words before any heading are here.\n\n# One\n\nText.';
  ok('scope: before the first heading', R.scope(pre, 3, 'section').to === pre.indexOf('# One'));
}
/* paragraphs */
{
  const ps = R.paragraphs(DOC, 0, DOC.length);
  ok('paragraphs: the writer’s own, and only those', ps.map(p => p.text.slice(0, 12)).join('|') === 'The first pa|The aims are|A second par|The scope is|Another chap', ps.map(p => p.text.slice(0, 12)));
  ok('paragraphs: their places are exact', ps.every(p => DOC.slice(p.start, p.end) === p.text));
  const s = R.scope(DOC, DOC.indexOf('second paragraph'), 'section');
  ok('paragraphs: in a section', R.paragraphs(DOC, s.from, s.to).length === 2);
}
/* corrections as a version with groups */
{
  const o = 'The results was clear, and teh team agreed.';
  const E = [{ start: 100 + 12, end: 100 + 15, orig: 'was', fix: 'were', why: 'Subject-verb agreement' }, { start: 100 + 27, end: 100 + 30, orig: 'teh', fix: 'the', why: 'Spelling', alts: ['the', 'ten'] },
    { start: 100 + 0, end: 100 + 3, orig: 'The', fix: null, why: 'advice only' }];
  const r = R.fromEdits(o, 100, E);
  ok('edits: the version has every fix', r.version === 'The results were clear, and the team agreed.', r.version);
  ok('edits: one group per fix, notes without a fix left out', r.groups.length === 2 && r.groups[0].from === 'was' && r.groups[0].to === 'were' && r.groups[0].reasons[0].text === 'Subject-verb agreement');
  ok('edits: the other suggestions are kept as alternatives', r.groups[1].alts.join() === 'ten');
  ok('edits: the groups point into both texts', r.groups.every(g => o.slice(g.as, g.ae) === g.from && r.version.slice(g.bs, g.be) === g.to));
  ok('edits: keeping the writer’s word for one change', X.compose(o, r.version, r.groups, { 0: 'o' }) === 'The results was clear, and the team agreed.');
  ok('edits: another suggestion for one change', X.compose(o, r.version, r.groups, { 1: 0 }) === 'The results were clear, and ten team agreed.');
  const ov = R.fromEdits('abc def', 0, [{ start: 0, end: 3, fix: 'x' }, { start: 2, end: 5, fix: 'y' }]);
  ok('edits: of two that overlap, the first', ov.version === 'x def', ov.version);
}
/* putting the chosen wording in */
{
  const t = 'One para here.\n\nTwo para here.\n\nThree para here.';
  const a = R.apply(t, [{ start: 0, end: 14, orig: 'One para here.', final: 'First paragraph.' }, { start: 32, end: 48, orig: 'Three para here.', final: 'Third paragraph.' }]);
  ok('apply: each paragraph in its place', a.text === 'First paragraph.\n\nTwo para here.\n\nThird paragraph.' && a.applied === 2, a);
  const b = R.apply(t, [{ start: 0, end: 14, orig: 'One para HERE.', final: 'X.' }]);
  ok('apply: a paragraph changed since is left alone', b.text === t && b.skipped === 1);
  const c = R.apply(t, [{ start: 0, end: 14, orig: 'One para here.', final: 'One para here.' }]);
  ok('apply: no change, nothing done', c.applied === 0 && c.text === t);
}

if (fails.length) console.log(fails.map(f => 'FAIL ' + f).join('\n'));
console.log('revise_test: ' + pass + ' passed, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
