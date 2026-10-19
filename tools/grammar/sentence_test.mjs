/* Tests for the 7.49 sentence rules in the built page (capitals at a
   sentence's head, days, months, peoples and places, comma splices):
   copy it to a folder where the playwright package resolves and run it
   with node, with INKWELL_ROOT naming this repository.
   Each case is a slip with the fix the page must offer, or correct text
   the rules must leave alone. Needs Playwright and Chromium. */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.join(process.env.INKWELL_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'Inkwell-Android', 'app', 'src', 'main', 'assets');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('ink_tourOffered', '1'); } catch (e) {} });
await ctx.route('http://localhost:9917/**', r => { const f = path.join(ROOT, decodeURIComponent(new URL(r.request().url()).pathname.slice(1))); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' }); r.fulfill({ status: 200, contentType: f.endsWith('.html') ? 'text/html' : 'application/octet-stream', body: fs.readFileSync(f) }); });
const page = await ctx.newPage(); await page.goto('http://localhost:9917/Inkwell.html'); await page.waitForTimeout(1500);
const WHY = /capital|begins lowercase|splice|Days of the week|Months|peoples|TV/;
const cases = [
  /* [text, the text after every fix of these rules, register] */
  ['my village is small. It is quiet.', 'My village is small. It is quiet.'],
  ['Is it far? yes, it is far.', 'Is it far? Yes, it is far.'],
  ['We met on sunday and again on mondays.', 'We met on Sunday and again on Mondays.'],
  ['The term starts in january and ends in july.', 'The term starts in January and ends in July.'],
  ['She was born in may 2001.', 'She was born in May 2001.'],
  ['We arrived on 3 march and left in august.', 'We arrived on 3 March and left in August.'],
  ['I love japanese food and the english language.', 'I love Japanese food and the English language.'],
  ['He moved to london from sri lankan relatives.', 'He moved to London from Sri Lankan relatives.'],
  ['There was no tv in the house.', 'There was no TV in the house.'],
  ['Jason is my friend, he is very kind.', 'Jason is my friend. He is very kind.'],
  ['The film was moving, it was about a family.', 'The film was moving. It was about a family.'],
  /* left alone */
  ['For the physician, this may transform interpretation.'],
  ['The march of time cannot be stopped.'],
  ['Use arabic numerals for chapters and french fries for lunch.'],
  ['When you can make yourself understood, it is easy to talk.'],
  ['Even if the total good is the same, it is better to share it.'],
  ['They claim that as they are no longer guards, they cannot help.'],
  ['Standing in the square, where the protests were taking place, she remains a looker-on.'],
  ['We forget our bodies; that is, we do not focus on them.'],
  ['Especially in the stance that requires memory, there seems to be a hasty commitment.'],
  ['He said "Jeopardy!" and laughed.'],
  ['The toll doubled:\n\nslowly the legs shook.'],
  ['We sold iPhones and eBay vouchers.\n\niPhone sales rose.'],
  ['See the list, e.g. apples and pears.'],
];
const res = await page.evaluate(([cases, why]) => { S.reg = 'professional'; return cases.map(([t]) => {
  __ruleSig = ''; const E = inkRules(t).filter(e => new RegExp(why).test(String(e.why || '')) && typeof e.fix === 'string').sort((a, b) => a.start - b.start);
  let out = '', pos = 0; for (const e of E) { if (e.start < pos) continue; out += t.slice(pos, e.start) + e.fix; pos = e.end; }
  return out + t.slice(pos); }); }, [cases, WHY.source]);
let pass = 0; const fails = [];
cases.forEach(([t, want], i) => { const w = want === undefined ? t : want; if (res[i] === w) pass++; else fails.push(JSON.stringify(t) + '\n  want: ' + JSON.stringify(w) + '\n  got:  ' + JSON.stringify(res[i])); });
await browser.close();
fails.forEach(f => console.log('FAIL ' + f));
console.log(pass + ' of ' + cases.length + ' pass');
process.exit(fails.length ? 1 : 0);
