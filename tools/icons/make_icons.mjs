// Every app icon from the app's own seal (inkwellSeal in Inkwell.html): the
// official mark, brass by day, on its opaque cream field. Round icons keep a
// clear background; the square icons iOS requires opaque get a midnight-ink
// ground. Run from the repository: node tools/icons/make_icons.mjs  (needs
// Playwright and Chromium), then python3 tools/icons/pack_icons.py.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
const ROOT = process.cwd(), OUT = path.join(ROOT, 'tools', 'icons', 'out');
fs.mkdirSync(OUT, { recursive: true });
const page_html = fs.readFileSync(path.join(ROOT, 'Inkwell.html'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
await page.route('https://ink.local/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: page_html }));
await page.route('http://127.0.0.1:8317/**', r => r.abort());
await page.goto('https://ink.local/Inkwell.html'); await page.waitForTimeout(1500);
const seal = await page.evaluate(() => inkwellSeal(1000, false));
async function shot(name, size, opaque, scale) {
  // the seal's edge reaches 1.5% below its circle, so it is set with a small margin
  const s = Math.round(size * scale), off = Math.round((size - s) / 2) - Math.round(size * 0.006);
  const ground = opaque ? 'background:radial-gradient(circle at 50% 38%,#24577a 0%,#17405a 55%,#0d2638 100%);' : 'background:transparent;';
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;${ground}"><div style="position:absolute;left:${Math.round((size - s) / 2)}px;top:${off}px;width:${s}px;height:${s}px">${seal.replace(/width="1000" height="1000"/, `width="${s}" height="${s}"`)}</div></body></html>`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, name), omitBackground: !opaque });
}
for (const [n, sz] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) await shot(`android_${n}.png`, sz, false, 0.94);
await shot('web_192.png', 192, false, 0.94);
await shot('web_512.png', 512, false, 0.94);
await shot('apple_touch_180.png', 180, true, 0.82);
await shot('ios_1024.png', 1024, true, 0.82);
await shot('round_1024.png', 1024, false, 0.94);
await shot('round_512.png', 512, false, 0.94);
for (const sz of [16, 24, 32, 48, 64, 128, 256]) await shot(`ico_${sz}.png`, sz, false, 0.96);
await browser.close();
console.log('icons rendered in', OUT);
