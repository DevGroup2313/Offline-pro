/* Tests for src/lib/consist_core.js: node tools/consist/consist_test.js */
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'src', 'lib', 'consist_core.js'));
const SP = require(path.join(ROOT, 'src', 'lib', 'spell_core.js'));
const D = SP.load(fs.readFileSync(path.join(ROOT, 'Inkwell-Android', 'app', 'src', 'main', 'assets', 'vendor', 'scowl-words.txt'), 'utf8'));
const common = w => { const e = D.lower.get(w); return !!(e && e.plain); };
let pass = 0; const fails = [];
const ok = (name, cond, got) => { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); };
const marks = (t, fam) => C.check(t, { common }).filter(e => !fam || e.fam === fam).map(e => [e.orig, e.fix]);
const has = (t, fam, orig, fix) => marks(t, fam).some(([o, f]) => o === orig && f === fix);

/* capitals */
ok('a stray capital is lowered', has('We studied dementia in care homes. Carers spoke of dementia often. Over time, Dementia and loss grew. Families feared dementia.', 'caps', 'Dementia', 'dementia'), marks('We studied dementia in care homes. Carers spoke of dementia often. Over time, Dementia and loss grew. Families feared dementia.', 'caps'));
ok('a term not in the dictionary is raised to its usual capital', has('The Covid-19 crisis began. Hospitals saw Covid-19 cases. Later the covid-19 wave passed.', 'caps', 'covid-19', 'Covid-19'), marks('The Covid-19 crisis began. Hospitals saw Covid-19 cases. Later the covid-19 wave passed.', 'caps'));
ok('a common word is not raised to a name\'s capital', marks('What Wood said about Said (1993) is apt. He said so. They said it twice.', 'caps').length === 0, marks('What Wood said about Said (1993) is apt. He said so. They said it twice.', 'caps'));
ok('a sentence start after a citation is no slip', marks('It holds [32]. [12] This holds. We think this holds. And this too. So this.', 'caps').length === 0);
ok('a title in quotation marks keeps its capitals', marks('See section “Conceptual foundations” later. The conceptual work matters. Its conceptual frame and its conceptual tools.', 'caps').length === 0);
ok('a name in a run of capitals is left alone', marks('The Federal Ministry of Health acted. Public health matters. Good health and poor health differ.', 'caps').length === 0);
ok('words whose capital changes their sense are not compared', marks('The State acts. The state of the art. A state of mind. Each state votes.', 'caps').length === 0);
ok('headings are not counted', marks('# Climate Policy\n\nThe policy failed. Each policy was weak. Our policy changed.', 'caps').length === 0);
/* hyphens */
ok('the minority hyphen', has('We sent an email. The email arrived. Then an e-mail came.', 'hyph', 'e-mail', 'email'));
ok('the minority closed form', has('Their well-being matters. Well-being is broad; well-being is shared; wellbeing is studied.', 'hyph', 'wellbeing', 'well-being'), marks('Their well-being matters. Well-being is broad; well-being is shared; wellbeing is studied.', 'hyph'));
ok('re- words are left alone (re-sign, resign)', marks('He will re-sign the lease. She did resign. They resign often.', 'hyph').length === 0);
ok('a tie is left alone', marks('An email and an e-mail.', 'hyph').length === 0);
/* the marks */
ok('a straight quotation mark among curly ones', has('He said “yes” and “no” and then "maybe" later.', 'quotes', '"', '“'), marks('He said “yes” and “no” and then "maybe" later.', 'quotes'));
ok('its closing pair', has('He said “yes” and “no” and then "maybe" later.', 'quotes', '"', '”'));
ok('a straight apostrophe among curly ones', has('I don’t know; it’s fine; we can’t go; it isn\'t so.', 'apos', "'", '’'));
ok('the dash the document uses', has('A pause—like this—and again—so; then - here.', 'dash', ' - ', '—'), marks('A pause—like this—and again—so; then - here.', 'dash'));
ok('two hyphens', has('Wait – here – and – there -- now.', 'dash', ' -- ', ' – '), marks('Wait – here – and – there -- now.', 'dash'));
ok('an ellipsis', has('Wait… and wait… then wait...', 'ellipsis', '...', '…'));
ok('a range', has('See 10–20, 30–40 and 50-60.', 'range', '50-60', '50–60'));
ok('an ISO date is no range', marks('On 2024-05-01 and 10–20 and 30–40.', 'range').length === 0);
ok('a large number', has('We paid 12000, then 15,000 and 20,000.', 'thou', '12000', '12,000'));
ok('a unit', has('A 5 km walk, a 10 km run, a 3km climb.', 'unit', '3km', '3 km'));
ok('one form only: nothing to mark', C.check('A plain sentence with “quotes” and a dash — here — and 10–20.', { common }).length === 0, C.check('A plain sentence with “quotes” and a dash — here — and 10–20.', { common }));
ok('a quotation is masked for words but its marks are counted', (() => { const t = 'He wrote “Internet” once. We say internet, internet, internet.'; return C.check(t, { common, masked: i => i >= 9 && i < 19 }).filter(e => e.fam === 'caps').length === 0; })());

fails.forEach(f => console.log('FAIL ' + f));
console.log(pass + ' of ' + (pass + fails.length) + ' pass');
process.exit(fails.length ? 1 : 0);
