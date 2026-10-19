/* Tests for src/lib/grade_core.js and src/lib/draft_core.js:
   node tools/grade/grade_test.js */
const path = require('path');
const G = require(path.join(__dirname, '..', '..', 'src', 'lib', 'grade_core.js'));
const D = require(path.join(__dirname, '..', '..', 'src', 'lib', 'draft_core.js'));
let pass = 0; const fails = [];
const ok = (name, cond, got) => { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); };

/* a rubric line's kind comes from its name */
ok('argument', G.kind('Argument', 'a clear thesis') === 'argument');
ok('conclusion over its description', G.kind('Conclusion', 'draws the argument together') === 'conclusion', G.kind('Conclusion', 'draws the argument together'));
ok('evidence', G.kind('Use of sources', 'claims supported by reading') === 'evidence');
ok('structure', G.kind('Organisation', 'paragraphs that link') === 'structure');
ok('mechanics', G.kind('Grammar and spelling', '') === 'mechanics');
ok('originality is the writer\'s to judge', G.kind('Originality', 'an insight beyond the sources') === '', G.kind('Originality', 'an insight beyond the sources'));
ok('a line with no name uses its words', G.kind('', 'Critical analysis') === 'argument');

const good = 'Remote work is reshaping cities. I argue that it moves careers away from the centre, because firms now hire wherever people live.\n\n' +
  'First, hiring has spread out. For example, in 2023 a third of new posts at one bank were fully remote (Smith 2024). This suggests that the office matters less.\n\n' +
  'However, some argue that cities still offer chance meetings. Although this is true, remote teams now meet on purpose, as Jones (2021) shows. Their meetings are planned, so the chance encounter that once drew people to the centre now happens by design, in a hired room or a shared studio, wherever the team happens to be.\n\n' +
  'In conclusion, the centre has lost its hold on working life. This matters because planners still build as if it had not.';
const bare = 'Cities are big. People live there. They work and go home. Some like it and some do not. It is busy and loud. There are many shops. The end.';
const M1 = G.measure(good), M0 = G.measure(bare);
ok('paragraphs', M1.paragraphs === 4, M1.paragraphs);
ok('a thesis near the start', !!M1.thesis && /I argue/.test(M1.thesis.text));
ok('citations counted', M1.cites === 2, M1.cites);
ok('a concession found', M1.concessions >= 2, M1.concessions);
ok('a conclusion found', M1.concludes === true);
const mk = (k, M) => G.criterion(k, M, {}).mark;
ok('argument: argued page above a bare one', mk('argument', M1) > mk('argument', M0), [mk('argument', M1), mk('argument', M0)]);
ok('evidence: supported page above a bare one', mk('evidence', M1) > mk('evidence', M0), [mk('evidence', M1), mk('evidence', M0)]);
ok('structure: paragraphed page above one block', mk('structure', M1) >= mk('structure', M0), [mk('structure', M1), mk('structure', M0)]);
ok('conclusion: closing paragraph found', mk('conclusion', M1) >= 4, mk('conclusion', M1));
const c0 = G.criterion('argument', M0, {});
ok('a weak page is told where to start', !!c0.at && typeof c0.tip === 'string' && c0.tip.length > 10, c0);
ok('every mark is 1 to 5', ['structure', 'argument', 'evidence', 'introduction', 'conclusion'].every(k => { const m = mk(k, M1); return m >= 1 && m <= 5; }));
ok('notes are not counted as support', G.measure('A claim stands here without support and goes on at length about it, as claims do.\n\n# Notes\n\n[^1]: Smith, 2020, p. 4.').cites === 0);
ok('unknown kind gives null', G.criterion('', M1, {}) === null);

/* drafting joins the writer's answers */
const p = D.build('paragraph', ['Remote work weakens the centre.', 'firms hire anywhere', 'one bank hired a third of staff remotely (Smith 2024)', 'the office matters less'], 'professional');
ok('paragraph text', p.text === 'Remote work weakens the centre. This is because firms hire anywhere. For example, one bank hired a third of staff remotely (Smith 2024). This shows that the office matters less.', p.text);
ok('each part keeps its move', p.parts.map(x => x.role).join() === 'Point,Reason,Evidence,Meaning');
ok('an optional step may be left', p.missing.length === 0, p.missing);
ok('a missing step is named', D.build('paragraph', ['A point.'], 'professional').missing.join() === 'Reason,Evidence,Meaning');
ok('no joining word twice', D.build('paragraph', ['A point.', 'because it rains'], 'professional').parts[1].text === 'Because it rains.');
ok('a name keeps its capital', /For example, Carel/.test(D.build('paragraph', ['A point.', 'x', 'Carel shows it'], 'scholarly').text));
ok('scholarly register', /^.*I argue that/.test(D.build('introduction', ['Topic here.', 'it is unclear', 'the centre is fading'], 'scholarly').text));
const e = D.build('email', ['Dr Patel', 'ask for an extension', 'I was ill', 'hand it in on Friday', 'Sam'], 'professional').text;
ok('email shape', e === 'Dear Dr Patel,\n\nI am writing to ask for an extension. I was ill. Could you hand it in on Friday?\n\nWith best wishes,\nSam', e);

fails.forEach(f => console.log('FAIL ' + f));
console.log(pass + ' of ' + (pass + fails.length) + ' pass');
process.exit(fails.length ? 1 : 0);
