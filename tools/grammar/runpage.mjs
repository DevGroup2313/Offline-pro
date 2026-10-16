// The page's whole offline pipeline (rules, gate, spelling, refiner): every correctness fix ("g") accepted.
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.ROOT || '/home/user/inkwell-fire/Inkwell-Android/app/src/main/assets';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('ink_tourOffered', '1'); } catch (e) {} });
await ctx.route('http://localhost:9915/**', r => { const f = path.join(ROOT, decodeURIComponent(new URL(r.request().url()).pathname.slice(1))); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' }); r.fulfill({ status: 200, contentType: f.endsWith('.html') ? 'text/html' : 'application/octet-stream', body: fs.readFileSync(f) }); });
await ctx.route('http://127.0.0.1:8317/**', r => r.abort());
const page = await ctx.newPage(); await page.goto('http://localhost:9915/Inkwell.html'); await page.waitForTimeout(2500);
await page.waitForFunction(() => !!SPELLD, null, { timeout: 30000 });
const tag = process.env.TAG || 'page';
for (const set of process.argv.slice(2)) {
  const rows = JSON.parse(fs.readFileSync(set + '.json'));
  const t0 = Date.now();
  const res = await page.evaluate(texts => { S.reg = 'professional'; return texts.map(t => {
    __ruleSig = ''; const E = inkRules(t).filter(e => e.cat === 'g' && typeof e.fix === 'string' && e.end > e.start).sort((a, b) => a.start - b.start);
    let out = '', pos = 0, kinds = []; const keep = [];
    for (const e of E) { if (e.start < pos) continue; out += t.slice(pos, e.start) + e.fix; pos = e.end; kinds.push(String(e.why || '').slice(0, 60)); keep.push({ start: e.start, end: e.end, orig: t.slice(e.start, e.end), fix: e.fix, why: String(e.why || '').slice(0, 60) }); }
    return { out: out + t.slice(pos), kinds, edits: keep };
  }); }, rows.map(r => r.text));
  fs.writeFileSync(`hyp_${tag}_${set}.json`, JSON.stringify(res.map(r => r.out)));
  fs.writeFileSync(`edits_${tag}_${set}.json`, JSON.stringify(res.map(r => r.edits)));
  console.log(set, rows.length, 'sentences in', Date.now() - t0, 'ms;', res.filter(r => r.kinds.length).length, 'changed');
}
await browser.close();
