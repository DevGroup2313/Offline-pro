// Every app icon from the app's own seal (inkwellSeal in Inkwell.html): the
// official mark in wax (cream by day), on its opaque field. Round icons keep a
// clear background; the square icons iOS requires opaque (the iPhone and iPad
// app, and the web app's home screen icon) get a plain ground in the
// seal's own cream (#f2e7cc, its wax face as drawn). Run from the repository: node tools/icons/make_icons.mjs  (needs
// Playwright and Chromium; from a folder where the playwright package resolves), then python3 tools/icons/pack_icons.py.
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
// 7.38: the seal is struck into the wax and lit by an SVG lamp whose slopes are
// set per pixel, so each icon's seal is drawn at that icon's own size, here,
// before the page is replaced by the icon scenes
const SHOTS = [];
for (const [n, sz] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) SHOTS.push([`android_${n}.png`, sz, false, 0.94]);
// 7.50: the seal fills its canvas on the Mac (the .icns from round_1024) and on
// the iPhone and iPad (ios_1024, apple_touch_180): 0.96 of the side, the
// margin only what the seal's lower edge and its glow need. The home screen's
// rounded mask holds a circle of the full side, so nothing of the seal is cut.
SHOTS.push(['web_192.png', 192, false, 0.94], ['web_512.png', 512, false, 0.94], ['apple_touch_180.png', 180, true, 0.96], ['ios_1024.png', 1024, true, 0.96], ['round_1024.png', 1024, false, 0.96], ['round_512.png', 512, false, 0.96]);
for (const sz of [16, 24, 32, 48, 64, 128, 256]) SHOTS.push([`ico_${sz}.png`, sz, false, 0.96]);
const SEALS = await page.evaluate((list) => { const o = {}; list.forEach(s => { o[s] = inkwellSeal(s, false); }); return o; }, [...new Set(SHOTS.map(x => Math.round(x[1] * x[3])))]);
async function shot(name, size, opaque, scale) {
  // the seal's edge reaches 1.5% below its circle, so it is set with a small margin
  const s = Math.round(size * scale), off = Math.round((size - s) / 2) - Math.round(size * (scale >= 0.95 ? 0.003 : 0.006)), seal = SEALS[s];
  const ground = opaque ? 'background:#f2e7cc;' : 'background:transparent;';
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;${ground}"><div style="position:absolute;left:${Math.round((size - s) / 2)}px;top:${off}px;width:${s}px;height:${s}px">${seal}</div></body></html>`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, name), omitBackground: !opaque });
}
for (const x of SHOTS) await shot(...x);
await browser.close();
console.log('icons rendered in', OUT);
