/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.44: My way of working (INKWAY), the same in Inkwell, Tabula, Scriba and
   Fontes. Each part is off until the writer switches it on, and one choice
   serves all four: inside Inkwell they share the device's storage, and a
   change in one reaches the others at once (the "storage" event).

   - Reading comfort: text size, line spacing, letter spacing, a clearer
     typeface (Atkinson Hyperlegible, made by the Braille Institute to be
     easy to read; src/lib/atkinson_font.js) and the paper's tint. Only the
     screen changes: Word files, PDFs and printing keep the document's own
     type. apply(doc, base) sets the values as CSS variables on the page and
     the class ink-comfort; each app's own CSS says where they go.
   - Where was I?: each app keeps the place where the writer stopped, with a
     note left for next time; on opening, a small card offers to go back.
     place(), card() and noteBox() are the parts; the app reads and finds
     its own places.
   - Three at a time: Inkwell's suggestions, three at a time, correctness
     first, with no running count (in Inkwell's page; the rooms make no
     suggestions).
   7.44, later: eight more, from the preview the writer saw and beyond it.
   Start small, One next step, Draft now fix later, Today so far and
   Messages wait for me live on Inkwell's desk; Focus ruler on the desk, in
   Tabula and in Scriba; Gentle time and Quiet senses everywhere (the band
   and the questions are drawn by Inkwell's page, over the rooms, and the
   rooms tell it when the writer is working). FEATURES lists them all, with
   where each works; the panel is drawn from it. */
(function (root) {
  'use strict';
  var KEY = 'ink_way', WKEY = 'ink_where:';
  var DEF = { small: { on: false }, next: { on: false }, draft: { on: false }, ruler: { on: false }, time: { on: false },
    where: { on: false }, today: { on: false },
    three: { on: false }, wait: { on: false }, quiet: { on: false },
    comfort: { on: false, size: 110, line: 1.9, letter: 0.02, font: '', paper: '' } };
  /* [key, name, where it works, what it does], in the panel's groups */
  var DESK = 'On the desk', ROOMS3 = 'Desk, Tabula and Scriba', ALL = 'Everywhere';
  var GROUPS = [
    ['Starting and staying on track', [
      ['small', 'Start small', DESK, 'One press hides everything but a single line to write. Five minutes, one sentence, mess allowed. When the time is up, stop or keep going: both count. While this is on, \u201cStart small\u201d sits beside the timer.'],
      ['next', 'One next step', DESK, 'A single line above the page holds the very next thing to do, in your own words. Tick it when it is done, and write the next one. Each document keeps its own.'],
      ['draft', 'Draft now, fix later', DESK, 'While you type, the underlines fade so the flow is not broken. Two seconds after you pause, they come back. Nothing is lost.'],
      ['ruler', 'Focus ruler', ROOMS3, 'Only the paragraph you are in stays clear; the rest of the page dims. It follows your cursor, so your eyes stay where your thinking is.'],
      ['time', 'Gentle time', ALL, 'A thin band at the top shows how much of the sprint is left, so time is something you can see. A quiet heads-up comes five minutes before the end. After fifty minutes without a pause, one soft question about water and a stretch, never a lock. The band shows while the hourglass is running.']]],
    ['Finding your place', [
      ['where', 'Where was I?', 'Desk, Tabula, Scriba and Fontes', 'When you open a document, a small card says where you stopped, with the note you left yourself, and takes you straight there. One press, or \u201cNot now\u201d. While it is on, \u201cNote for next time\u201d sits at the foot of the page.'],
      ['today', 'Today so far', DESK, 'A quiet count of today\u2019s work at the foot of the page: the words you added and the time you spent, by document. No streaks and no targets, only what you did.']]],
    ['Less at once, easier on the senses', [
      ['three', 'Three at a time', DESK, 'Suggestions come three at a time, correctness first, with no running count. The next three wait behind one button. The wording is plain: \u201cWorth a look\u201d, never \u201cError\u201d.'],
      ['wait', 'Messages wait for me', DESK, 'A message stays until you close it, instead of vanishing after three seconds. Nothing opens by itself: a tip waits behind a small button until you want it.'],
      ['quiet', 'Quiet senses', ALL, 'Movement stops and sounds go quiet: no sliding, no chimes, no pops. The look stays as it is. Inkwell\u2019s sound comes back as it was when you switch this off.'],
      ['comfort', 'Reading comfort', ALL, 'Text size, line spacing, letter spacing, a clearer typeface and the tint of the paper, all in one place. Each change shows at once. Only the screen changes: Word files, PDFs and printing keep your document\u2019s own type.']]]];
  var FEATURES = [];
  GROUPS.forEach(function (g) { g[1].forEach(function (f) { FEATURES.push(f); }); });
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function store() { try { return root.localStorage; } catch (e) { return null; } }
  function get() {
    var o = clone(DEF), v = null, ls = store();
    try { v = ls ? JSON.parse(ls.getItem(KEY) || 'null') : null; } catch (e) { v = null; }
    if (v && typeof v === 'object') for (var k in o) if (v[k] && typeof v[k] === 'object') for (var j in o[k]) if (j in v[k]) o[k][j] = v[k][j];
    return o;
  }
  var subs = [];
  function on(f) { subs.push(f); }
  function fire(o) { subs.forEach(function (f) { try { f(o); } catch (e) {} }); }
  function set(path, val) {
    var o = get(), p = String(path).split('.');
    if (!o[p[0]] || !(p[1] in o[p[0]])) return o;
    o[p[0]][p[1]] = val;
    try { var ls = store(); if (ls) ls.setItem(KEY, JSON.stringify(o)); } catch (e) {}
    fire(o);
    return o;
  }
  try { root.addEventListener('storage', function (e) { if (e.key === KEY) fire(get()); }); } catch (e) {}

  /* ---- Reading comfort ---- */
  var PAPER = { cream: ['#fbf6ea', '#241f17', 'Cream'], grey: ['#eff1f3', '#1e2329', 'Soft grey'], blue: ['#edf3fa', '#152231', 'Pale blue'], green: ['#eef6ef', '#14241b', 'Pale green'] };
  var ATK = "'Atkinson Hyperlegible',Verdana,Tahoma,sans-serif";
  /* base: the app's own {size (px), line, font}; night: true at night */
  function apply(doc, base, night) {
    var c = get().comfort, h = doc.documentElement, b = base || {};
    var on = !!c.on, paper = on && PAPER[c.paper];
    h.classList.toggle('ink-comfort', on);
    h.classList.toggle('ink-cf-paper', !!paper);
    h.style.setProperty('--cf-size', (Math.round((b.size || 16) * (+c.size || 100)) / 100) + 'px');
    h.style.setProperty('--cf-scale', String((+c.size || 100) / 100));
    h.style.setProperty('--cf-line', String(+c.line || b.line || 1.6));
    h.style.setProperty('--cf-letter', (+c.letter || 0) + 'em');
    h.style.setProperty('--cf-font', c.font === 'atkinson' ? ATK : (b.font || 'Georgia,serif'));
    h.style.setProperty('--cf-paper', paper ? paper[night ? 1 : 0] : 'transparent');
    return on && c.font === 'atkinson' ? font(doc) : null;
  }
  /* the typeface is held once, in Inkwell's page; a room reads it there */
  function fontData() {
    var w = [root];
    try { if (root.parent && root.parent !== root) w.push(root.parent); } catch (e) {}
    try { if (root.top && w.indexOf(root.top) < 0) w.push(root.top); } catch (e) {}
    for (var i = 0; i < w.length; i++) { try { if (w[i].INK_ATK && w[i].INK_ATK.length) return w[i].INK_ATK; } catch (e) {} }
    return null;
  }
  function font(doc) {
    if (doc.__inkAtk) return doc.__inkAtk;
    var data = fontData(), FF = root.FontFace;
    if (!data || !doc.fonts || typeof FF !== 'function') return null;
    var all = [];
    data.forEach(function (f) {
      try {
        var bin = root.atob(f.d), buf = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        var ff = new FF('Atkinson Hyperlegible', buf.buffer, { weight: f.w, style: f.s, unicodeRange: f.r, display: 'swap' });
        doc.fonts.add(ff); all.push(ff.load());
      } catch (e) {}
    });
    doc.__inkAtk = Promise.all(all).catch(function () {});
    return doc.__inkAtk;
  }

  /* ---- Where was I? ---- */
  function wkey(app, id) { return WKEY + app + ':' + String(id || '').slice(0, 160); }
  function load(app, id) { try { var ls = store(); return ls ? JSON.parse(ls.getItem(wkey(app, id)) || 'null') : null; } catch (e) { return null; } }
  function save(app, id, rec) {
    var old = load(app, id) || {}, r = {};
    for (var k in old) r[k] = old[k];
    for (var k2 in rec) r[k2] = rec[k2];
    r.t = Date.now();
    try { var ls = store(); if (ls) ls.setItem(wkey(app, id), JSON.stringify(r)); } catch (e) {}
    return r;
  }
  function note(app, id, text) { return save(app, id, { note: String(text || '').trim().slice(0, 600) }); }
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function when(t, now) {
    var n = now || Date.now(), d = new Date(t), m = Math.round((n - t) / 60000);
    if (m < 1) return 'a moment ago';
    if (m < 60) return m === 1 ? 'a minute ago' : m + ' minutes ago';
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    var day0 = new Date(n); day0.setHours(0, 0, 0, 0);
    var dd = Math.round((day0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (d >= day0) return 'today at ' + hm;
    if (dd <= 1) return 'yesterday at ' + hm;
    if (dd < 7) return 'on ' + DAYS[d.getDay()] + ' at ' + hm;
    return 'on ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date(n).getFullYear() ? ' ' + d.getFullYear() : '') + ' at ' + hm;
  }
  /* a place in a plain text: its paragraph (a line with words), the words it
     opens with, and where in it the cursor was */
  function place(text, pos) {
    var t = String(text || ''), p = Math.max(0, Math.min(pos | 0, t.length));
    var a = t.lastIndexOf('\n', p - 1) + 1, b = t.indexOf('\n', p); if (b < 0) b = t.length;
    var n = 0, total = 0, re = /[^\n]*\S[^\n]*/g, m;
    while ((m = re.exec(t))) { total++; if (m.index <= a) n = total; }
    var line = t.slice(a, b).trim();
    return { pos: p, para: Math.max(1, n), of: total, off: p - a, snip: cut(line, 110), head: lastHead(t, a) };
  }
  function lastHead(t, a) {
    var re = /^#{1,6}\s+(.+)$/gm, m, h = '';
    while ((m = re.exec(t)) && m.index <= a) h = m[1].trim();
    return cut(h, 70);
  }
  function cut(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    var c = s.slice(0, n), sp = c.lastIndexOf(' ');
    return (sp > n * 0.6 ? c.slice(0, sp) : c) + '…';
  }
  /* the same place after edits: its paragraph's opening words first, then
     the position it had */
  function find(text, rec) {
    var t = String(text || '');
    if (!rec) return 0;
    var s = String(rec.snip || '').replace(/…$/, '');
    s = s.slice(0, 60);
    if (s.length >= 12) {
      var best = -1, at = -1, d = Infinity;
      while ((at = t.indexOf(s, at + 1)) >= 0) { var dist = Math.abs(at - (rec.pos || 0)); if (dist < d) { d = dist; best = at; } }
      if (best >= 0) {
        var b = t.indexOf('\n', best); if (b < 0) b = t.length;
        return Math.min(best + (rec.off || 0), b);
      }
    }
    return Math.max(0, Math.min(rec.pos || 0, t.length));
  }

  /* the same for a page of rich text (Tabula's, Scriba's pad), read with
     INKFIND's index: one line for each paragraph */
  function domPlace(el, F, extra) {
    var doc = el.ownerDocument, s = doc.getSelection ? doc.getSelection() : null;
    if (!F || !s || !s.rangeCount || !el.contains(s.anchorNode)) return null;
    var ix = F.index([el]), r = s.getRangeAt(0), n = r.startContainer, off = r.startOffset;
    if (n.nodeType !== 3) {
      var w = doc.createTreeWalker(el, 4, null), c = n.childNodes[off] || null, t = null;
      if (c) { w.currentNode = c; t = c.nodeType === 3 ? c : w.nextNode(); } else { w.currentNode = n; t = w.nextNode(); }
      n = t; off = 0;
    }
    var k = n ? ix.nodes.indexOf(n) : -1, pos = k >= 0 ? ix.starts[k] + off : ix.text.length;
    var p = place(ix.text, pos);
    var hs = el.querySelectorAll('h1,h2,h3,h4'), hd = '', blk = n ? (n.parentNode) : null;
    for (var i = 0; i < hs.length && blk; i++) { if (hs[i] === blk || hs[i].contains(blk) || (hs[i].compareDocumentPosition(blk) & 4)) hd = (hs[i].textContent || '').trim(); else break; }
    p.head = cut(hd, 70);
    if (extra) for (var x in extra) p[x] = extra[x];
    return p;
  }
  function domGo(el, rec, F) {
    if (!F || !rec) return null;
    var doc = el.ownerDocument, ix = F.index([el]), pos = find(ix.text, rec);
    var a = F.nodeAt(ix, pos, false) || F.nodeAt(ix, pos, true);
    if (!a) return null;
    var r = doc.createRange(); r.setStart(a.node, Math.min(a.off, a.node.nodeValue.length)); r.collapse(true);
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    var s = doc.getSelection(); s.removeAllRanges(); s.addRange(r);
    return r;
  }

  /* ---- the look the four apps share ---- */
  /* the look the four apps share, in Inkwell's own manner (7.44, at the
     writer's request): raised, bevelled controls that lift under the
     pointer and press in, a brass-tipped switch, and cards that pop out of
     the page; still for Minimal motion, Quiet senses and reduced motion */
  var POP = 'cubic-bezier(.2,1.4,.35,1)';
  var UI = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  var SH1 = '0 1px 0 rgba(20,16,10,.26),0 2px 4px rgba(20,16,10,.15),0 6px 12px rgba(20,16,10,.10),inset 0 1px 0 #fff,inset 0 -2px 4px rgba(20,16,10,.07)';
  var SH2 = '0 1px 0 rgba(20,16,10,.28),0 4px 8px rgba(20,16,10,.18),0 10px 20px rgba(20,16,10,.12),inset 0 1px 0 #fff,inset 0 -2px 4px rgba(20,16,10,.07)';
  var SHIN = '0 1px 1px rgba(20,16,10,.10),inset 0 2px 5px rgba(20,16,10,.17)';
  var SHN1 = '0 1px 0 #000a,0 2px 4px #0009,0 6px 12px #0007,inset 0 1px 0 rgba(255,255,255,.10),inset 0 -2px 4px #0006';
  var SHN2 = '0 1px 0 #000b,0 4px 8px #000a,0 10px 20px #0008,inset 0 1px 0 rgba(255,255,255,.12),inset 0 -2px 4px #0006';
  var CARD = '0 3px 6px rgba(20,16,10,.09),0 14px 28px rgba(20,16,10,.08),0 34px 66px rgba(20,16,10,.12),inset 0 1px 0 #fff';
  var CARDN = '0 3px 6px #000b,0 14px 28px #000a,0 34px 66px #000b,inset 0 1px 0 rgba(255,255,255,.07)';
  var CSS = '' +
    '.iw-card{position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:2147483000;width:min(520px,calc(100vw - 32px));box-sizing:border-box;' +
    'background:linear-gradient(180deg,#fffefb 0%,#fbf6ea 100%);color:#1f2329;border:1px solid #e3d6ba;border-radius:16px;padding:16px 18px 14px;font:14px/1.5 ' + UI + ';' +
    'box-shadow:' + CARD + ';animation:iwIn .36s ' + POP + ' both;}' +
    '@keyframes iwIn{from{opacity:0;transform:translate(-50%,10px) scale(.96);}to{opacity:1;transform:translate(-50%,0) scale(1);}}' +
    '@keyframes iwInD{from{opacity:0;transform:translateY(12px) scale(.965);}to{opacity:1;transform:none;}}' +
    '.iw-card h4{margin:0 0 6px;font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:#7a5f22;font-weight:700;}' +
    '.iw-card p{margin:0 0 8px;}' +
    '.iw-snip{font-family:Georgia,"Times New Roman",serif;font-style:italic;font-size:15px;line-height:1.55;color:#3a3f47;border-left:3px solid #c9a24a;padding:2px 0 2px 10px;margin:0 0 10px;}' +
    '.iw-note{background:linear-gradient(180deg,#fff8e3,#fdf0cf);border:1px solid #ead39a;border-radius:10px;padding:8px 10px;margin:0 0 10px;font-size:13.5px;box-shadow:0 1px 0 rgba(20,16,10,.08),0 3px 8px rgba(20,16,10,.07),inset 0 1px 0 #fff;}' +
    '.iw-note b{font-weight:600;}' +
    '.iw-row{display:flex;gap:9px;flex-wrap:wrap;align-items:center;}' +
    '.iw-btn{position:relative;margin:0;border:1px solid #d9ccb0;background:linear-gradient(180deg,#fffefb 0%,#f3ecdc 100%);color:#1f2329;border-radius:11px;padding:8px 15px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;' +
    'box-shadow:' + SH1 + ';transition:transform .16s ' + POP + ',box-shadow .16s;}' +
    '.iw-btn:hover{transform:translateY(-2px);box-shadow:' + SH2 + ';}' +
    '.iw-btn:active{transform:translateY(1px) scale(.98);box-shadow:' + SHIN + ';transition-duration:.04s;}' +
    '.iw-btn.iw-go{background:linear-gradient(#2b6884,#1a4157);border-color:#1a4157;color:#fdfaf2;box-shadow:0 1px 0 #0d2a39,0 2px 4px rgba(20,16,10,.17),0 6px 12px rgba(31,79,104,.22),0 12px 26px rgba(31,79,104,.14),inset 0 1px 0 rgba(255,255,255,.25),inset 0 -3px 6px rgba(13,36,52,.22);}' +
    '.iw-btn.iw-go:hover{box-shadow:0 1px 0 #0d2a39,0 4px 8px rgba(20,16,10,.21),0 10px 20px rgba(31,79,104,.25),0 20px 44px rgba(31,79,104,.17),inset 0 1px 0 rgba(255,255,255,.31),inset 0 -3px 6px rgba(13,36,52,.22);}' +
    '.iw-btn.iw-go:active{box-shadow:0 1px 1px #0d2a39,inset 0 2px 6px rgba(0,0,0,.35);}' +
    '.iw-link{box-shadow:none;border:0;background:transparent;padding:0;margin-left:auto;font:inherit;font-size:12.5px;color:#1f5f86;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}' +
    '.iw-box textarea{width:100%;box-sizing:border-box;min-height:72px;border:1px solid #d9ccb0;border-radius:11px;padding:8px 10px;font:inherit;font-size:14px;color:#1f2329;background:#fff;resize:vertical;margin:0 0 10px;box-shadow:inset 0 2px 4px rgba(20,16,10,.08);}' +
    '.iw-dlg-back{position:fixed;inset:0;z-index:2147482990;background:rgba(20,26,34,.30);display:flex;align-items:flex-start;justify-content:center;padding:56px 16px 16px;box-sizing:border-box;overflow:auto;}' +
    '.iw-dlg{width:min(580px,100%);background:linear-gradient(180deg,#fffefb 0%,#fbf6ea 46%);color:#1f2329;border:1px solid #e3d6ba;border-radius:22px;padding:20px 22px;box-sizing:border-box;font:14px/1.5 ' + UI + ';box-shadow:' + CARD + ';animation:iwInD .38s ' + POP + ' both;}' +
    '.iw-dlg h3{margin:0 0 4px;font:600 20px/1.3 Georgia,"Times New Roman",serif;}' +
    '.iw-x{float:right;margin:0;width:32px;height:32px;border-radius:50%;border:1px solid #d9ccb0;background:linear-gradient(180deg,#fffefb,#f3ecdc);font-size:18px;line-height:1;color:#3a3f47;cursor:pointer;padding:0;box-shadow:' + SH1 + ';transition:transform .16s ' + POP + ';}' +
    '.iw-x:hover{transform:translateY(-2px);}' +
    '.iw-x:active{transform:translateY(1px);box-shadow:' + SHIN + ';}' +
    '.iw-intro{margin:0 0 12px;color:#4a515b;font-size:13px;}' +
    '.iw-sec{border:1px solid #e3d6ba;border-radius:14px;padding:12px 14px;margin:0 0 10px;background:linear-gradient(180deg,#fffefb,#faf5ea);box-shadow:0 1px 0 rgba(20,16,10,.10),0 3px 7px rgba(20,16,10,.07),0 8px 16px rgba(20,16,10,.05),inset 0 1px 0 #fff;transition:transform .18s ' + POP + ',box-shadow .18s,border-color .2s;}' +
    '.iw-sec:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(20,16,10,.12),0 5px 10px rgba(20,16,10,.09),0 12px 24px rgba(20,16,10,.07),inset 0 1px 0 #fff;}' +
    '.iw-sec.iw-on{border-color:#c9a24a;box-shadow:0 0 0 1px rgba(201,162,74,.45),0 1px 0 rgba(20,16,10,.10),0 4px 10px rgba(20,16,10,.09),0 10px 22px rgba(20,16,10,.06),inset 0 1px 0 #fff;}' +
    '.iw-sh{display:flex;align-items:center;gap:10px;}' +
    '.iw-sh b{flex:1;font-size:14.5px;}' +
    '.iw-where{font-size:11px;color:#4a515b;border:1px solid #e0d5be;background:#fbf7ee;border-radius:999px;padding:1px 8px;white-space:nowrap;box-shadow:inset 0 1px 2px rgba(20,16,10,.06);}' +
    '.iw-gh{margin:16px 2px 7px;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b5a2e;}' +
    '.iw-gh:first-child{margin-top:2px;}' +
    '.iw-sw{position:relative;margin:0;width:48px;height:27px;border-radius:999px;border:1px solid #d9ccb0;background:#ebe4d3;cursor:pointer;flex:0 0 auto;padding:0;box-shadow:inset 0 2px 5px rgba(20,16,10,.16),inset 0 -1px 0 rgba(255,255,255,.6);transition:background-color .28s,border-color .28s;}' +
    '.iw-sw::after{content:"";position:absolute;top:2px;left:2px;width:21px;height:21px;box-sizing:border-box;border-radius:50%;border:1px solid #d9ccb0;background:linear-gradient(#ffffff,#ece5d3);box-shadow:0 2px 4px rgba(20,16,10,.27),0 5px 10px rgba(20,16,10,.16),inset 0 1px 0 #fff;transition:transform .3s ' + POP + ',background-color .28s;}' +
    '.iw-sw[aria-checked="true"]{background:linear-gradient(#2b6884,#16394c);border-color:#16394c;}' +
    '.iw-sw[aria-checked="true"]::after{transform:translateX(21px);background:linear-gradient(#f7ead0,#e3cf9d);border-color:#b98a2e;}' +
    '.iw-sw:focus-visible{outline:2.5px solid #1f5f86;outline-offset:3px;}' +
    '.iw-st{font-size:12px;color:#4a515b;min-width:22px;}' +
    '.iw-d{margin:6px 0 0;color:#3f4650;font-size:13px;}' +
    '.iw-ctl{display:grid;grid-template-columns:auto 1fr auto;gap:9px 12px;align-items:center;margin:12px 0 4px;font-size:13px;}' +
    '.iw-ctl[hidden]{display:none;}' +
    '.iw-ctl input[type=range]{width:100%;accent-color:#1f4f68;}' +
    '.iw-ctl output{font-variant-numeric:tabular-nums;color:#3f4650;min-width:44px;text-align:right;}' +
    '.iw-opts{grid-column:2 / 4;display:flex;flex-wrap:wrap;gap:7px;}' +
    '.iw-chip{margin:0;border:1px solid #d9ccb0;background:linear-gradient(180deg,#fffefb,#f3ecdc);color:#1f2329;border-radius:999px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;' +
    'box-shadow:0 1px 0 rgba(20,16,10,.22),0 2px 5px rgba(20,16,10,.11),inset 0 1px 0 #fff;transition:transform .14s ' + POP + ',box-shadow .14s;}' +
    '.iw-chip:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(20,16,10,.24),0 4px 9px rgba(20,16,10,.14),inset 0 1px 0 #fff;}' +
    '.iw-chip[aria-pressed="true"]{background:linear-gradient(180deg,#ece2cc,#f7f1e4);border-color:#1f4f68;box-shadow:0 0 0 1px #1f4f68,inset 0 2px 4px rgba(20,16,10,.17);font-weight:700;transform:none;}' +
    '.iw-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.2);display:inline-block;box-shadow:inset 0 1px 2px rgba(0,0,0,.12);}' +
    '.iw-sample{grid-column:1 / 4;margin-top:6px;border:1px solid #e3d6ba;border-radius:12px;padding:12px 14px;background:#fff;color:#1f2329;box-shadow:0 1px 0 rgba(20,16,10,.08),0 4px 12px rgba(20,16,10,.08),inset 0 1px 0 #fff;}' +
    '.iw-foot{margin:8px 0 0;font-size:12px;color:#4f5661;}' +
    /* night: the same build, in the midnight palette; the main control is
       brass with dark ink, as on the rest of the desk at night */
    '.iw-night.iw-card,.iw-night .iw-dlg{background:linear-gradient(180deg,#1e2834 0%,#17202a 100%);color:#f2f5f8;border-color:#334050;box-shadow:' + CARDN + ';}' +
    '.iw-night.iw-card h4,.iw-night .iw-gh{color:#e8c77a;}' +
    '.iw-night .iw-snip{color:#dfe5ec;border-color:#a8873e;}' +
    '.iw-night .iw-note{background:linear-gradient(180deg,#2e2918,#262214);border-color:#5b4d25;color:#f6efd9;box-shadow:0 1px 0 #0008,0 3px 8px #0006;}' +
    '.iw-night .iw-btn,.iw-night .iw-chip,.iw-night .iw-x{background:linear-gradient(180deg,#2c3947,#1f2934);border-color:#3d4c5e;color:#f2f5f8;box-shadow:' + SHN1 + ';}' +
    '.iw-night .iw-btn:hover,.iw-night .iw-chip:hover,.iw-night .iw-x:hover{box-shadow:' + SHN2 + ';}' +
    '.iw-night .iw-btn:active,.iw-night .iw-x:active{box-shadow:inset 0 2px 6px #000b;}' +
    '.iw-night .iw-btn.iw-go{background:linear-gradient(#f2d892,#d9b35c);border-color:#b98a2e;color:#16120a;box-shadow:0 1px 0 #6b4f12,0 2px 4px #0009,0 6px 12px #0007,inset 0 1px 0 rgba(255,255,255,.45),inset 0 -3px 6px rgba(107,79,18,.25);}' +
    '.iw-night .iw-chip[aria-pressed="true"]{background:linear-gradient(180deg,#17202a,#222d39);border-color:#e8c77a;box-shadow:0 0 0 1px #e8c77a,inset 0 2px 4px #000a;}' +
    '.iw-night .iw-link{color:#8cc2ff;}' +
    '.iw-night textarea{background:#121a22;border-color:#3d4c5e;color:#f2f5f8;}' +
    '.iw-night .iw-x,.iw-night .iw-intro,.iw-night .iw-d,.iw-night .iw-st,.iw-night .iw-foot,.iw-night .iw-ctl output{color:#d5dbe2;}' +
    '.iw-night .iw-where{color:#d5dbe2;border-color:#3d4c5e;background:#17202a;box-shadow:inset 0 1px 2px #0008;}' +
    '.iw-night .iw-sec{background:linear-gradient(180deg,#1f2a36,#1a232e);border-color:#334050;box-shadow:0 1px 0 #000a,0 3px 7px #0007,0 8px 16px #0005,inset 0 1px 0 rgba(255,255,255,.05);}' +
    '.iw-night .iw-sec.iw-on{border-color:#e8c77a;box-shadow:0 0 0 1px rgba(232,199,122,.45),0 3px 8px #0008;}' +
    '.iw-night .iw-sw{background:#141c25;border-color:#3d4c5e;box-shadow:inset 0 2px 5px #000c;}' +
    '.iw-night .iw-sw::after{background:linear-gradient(#3a4a5b,#1e2935);border-color:#4a5a6c;}' +
    '.iw-night .iw-sw[aria-checked="true"]{background:linear-gradient(#f2d892,#c9a24a);border-color:#b98a2e;}' +
    '.iw-night .iw-sw[aria-checked="true"]::after{background:linear-gradient(#2b3a4b,#16202b);border-color:#16202b;}' +
    '.iw-night .iw-sample{background:#121a22;border-color:#334050;color:#f2f5f8;}' +
    '.iw-night .iw-ctl input[type=range]{accent-color:#e8c77a;}' +
    /* stillness: Inkwell's Minimal motion is flat and still, Quiet senses and
       reduced motion keep the look and stop the movement */
    'html body[data-motion=minimal] .iw-btn,html body[data-motion=minimal] .iw-chip,html body[data-motion=minimal] .iw-x,html body[data-motion=minimal] .iw-sw::after{box-shadow:none;transform:none;}' +
    '@media (prefers-reduced-motion:reduce){.iw-card,.iw-dlg{animation:none;}.iw-btn,.iw-chip,.iw-x,.iw-sec{transition:none;}}' +
    'html.iw-quiet .iw-card,html.iw-quiet .iw-dlg{animation:none !important;}' +
    'html.iw-quiet .iw-btn:hover,html.iw-quiet .iw-chip:hover,html.iw-quiet .iw-x:hover,html.iw-quiet .iw-sec:hover{transform:none;}' +
    /* Quiet senses: nothing moves in a page that carries the class */
    'html.iw-quiet *,html.iw-quiet *::before,html.iw-quiet *::after{animation-duration:0.001s !important;animation-delay:0s !important;animation-iteration-count:1 !important;transition-duration:0s !important;transition-delay:0s !important;scroll-behavior:auto !important;}';
  /* the rooms style every button and field strongly (their raised look);
     inside these panels the panel's own look must hold, so its controls'
     rules are made stronger than any room's */
  var STRONG = /iw-btn|iw-sw|iw-chip|iw-x|iw-link|textarea|input\[type=range\]/;
  function strong(text) {
    return text.replace(/([^{}]+)\{([^{}]*)\}/g, function (m, sel, body) {
      if (!STRONG.test(sel) || /^\s*(from|to|@)/.test(sel)) return m;
      sel = sel.split(',').map(function (x) { x = x.trim(); return /^html\b/.test(x) ? x : 'html body ' + x; }).join(',');
      body = body.split(';').filter(function (d) { return d.trim(); }).map(function (d) { return /!important/.test(d) ? d : d + ' !important'; }).join(';');
      return sel + '{' + body + '}';
    });
  }
  var CSS_STRONG = null;
  function css(doc) {
    if (doc.getElementById('iw-css')) return;
    var s = doc.createElement('style'); s.id = 'iw-css'; s.textContent = CSS_STRONG || (CSS_STRONG = strong(CSS) + '.iw-card button,.iw-dlg button{text-shadow:none !important;filter:none !important;}');
    (doc.head || doc.documentElement).appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* the card on opening: opts {doc, night, rec, label, onGo, onLater, onNoteDone} */
  function card(opts) {
    var doc = opts.doc || root.document, rec = opts.rec || {};
    css(doc);
    var old = doc.getElementById('iwCard'); if (old) old.remove();
    var c = doc.createElement('div');
    c.id = 'iwCard'; c.className = 'iw-card' + (opts.night ? ' iw-night' : '');
    c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Where was I?');
    /* the label says where, with its own preposition: "on page 12", "in
       paragraph 4 of 5", "adding a source" */
    var where = opts.label || rec.label || (rec.para ? 'in paragraph ' + rec.para + (rec.of ? ' of ' + rec.of : '') + (rec.head ? ', under “' + rec.head + '”' : '') : 'here');
    c.innerHTML = '<h4>Where was I?</h4>' +
      '<p>Last time, ' + esc(when(rec.t || Date.now())) + ', you were ' + esc(where) + ':</p>' +
      (rec.snip ? '<div class="iw-snip">' + esc(rec.snip) + '</div>' : '') +
      (rec.note ? '<div class="iw-note"><b>Your note:</b> “' + esc(rec.note) + '”</div>' : '') +
      '<div class="iw-row"><button type="button" class="iw-btn iw-go" data-a="go">Take me there</button><button type="button" class="iw-btn" data-a="later">Not now</button>' +
      (rec.note ? '<button type="button" class="iw-link" data-a="done">Done with the note</button>' : '') + '</div>';
    function shut() { c.remove(); doc.removeEventListener('keydown', key, true); }
    function key(e) { if (e.key === 'Escape') { shut(); if (opts.onLater) opts.onLater(); } }
    c.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-a]') : null; if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'done') { if (opts.onNoteDone) opts.onNoteDone(); var n = c.querySelector('.iw-note'); if (n) n.remove(); b.remove(); return; }
      shut();
      if (a === 'go' && opts.onGo) opts.onGo(); else if (a === 'later' && opts.onLater) opts.onLater();
    });
    doc.addEventListener('keydown', key, true);
    (doc.body || doc.documentElement).appendChild(c);
    try { c.querySelector('.iw-go').focus({ preventScroll: true }); } catch (e) {}
    return c;
  }
  /* a gentle question or message: opts {doc, night, id, title, text,
     buttons: [[label, fn, main]]}; never more than one on the screen */
  function ask(opts) {
    var doc = opts.doc || root.document;
    css(doc);
    var id = opts.id || 'iwAsk', old = doc.getElementById(id); if (old) old.remove();
    var c = doc.createElement('div');
    c.id = id; c.className = 'iw-card' + (opts.night ? ' iw-night' : '');
    c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', opts.title || 'A message');
    if (opts.top != null) c.style.top = opts.top + 'px';
    c.innerHTML = (opts.title ? '<h4>' + esc(opts.title) + '</h4>' : '') + '<p>' + esc(opts.text || '') + '</p><div class="iw-row">' +
      (opts.buttons || [['Close', null, true]]).map(function (b, i) { return '<button type="button" class="iw-btn' + (b[2] ? ' iw-go' : '') + '" data-i="' + i + '">' + esc(b[0]) + '</button>'; }).join('') + '</div>';
    c.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-i]') : null; if (!b) return;
      var f = (opts.buttons || [])[+b.getAttribute('data-i')];
      c.remove(); if (f && f[1]) f[1]();
    });
    (doc.body || doc.documentElement).appendChild(c);
    return c;
  }
  /* Quiet senses for any page: the class stops movement */
  function quiet(doc) { css(doc); doc.documentElement.classList.toggle('iw-quiet', !!get().quiet.on); }
  /* the Focus ruler for a page of blocks (Tabula's editor, Scriba's pad):
     every block but the one the cursor is in is dimmed, by a rule naming its
     place, so the document itself is never touched */
  function ruler(doc, el) {
    var st = doc.getElementById('iwRulerSt');
    if (!st) { st = doc.createElement('style'); st.id = 'iwRulerSt'; (doc.head || doc.documentElement).appendChild(st); }
    if (!get().ruler.on || !el || !el.id) { st.textContent = ''; return; }
    var s = doc.getSelection ? doc.getSelection() : null, n = s && s.rangeCount ? s.anchorNode : null;
    if (!n || !el.contains(n)) return;
    while (n && n.parentNode !== el) n = n.parentNode;
    if (!n || n.nodeType !== 1) { st.textContent = ''; return; }
    var k = Array.prototype.indexOf.call(el.children, n) + 1;
    st.textContent = '#' + el.id + '>*:not(:nth-child(' + k + ')){opacity:.34 !important;transition:opacity .25s;}' +
      'html.iw-quiet #' + el.id + '>*{transition:none !important;}';
  }
  /* the rooms tell Inkwell's page that the writer is working, for Gentle
     time and Today so far; at most every ten seconds */
  var lastBeat = 0;
  function beat() {
    var now = Date.now(); if (now - lastBeat < 10000) return; lastBeat = now;
    try { var t = root.top; if (t && t.INKWAY_BEAT) t.INKWAY_BEAT(); } catch (e) {}
  }

  /* the note for next time: opts {doc, night, note, onSave} */
  function noteBox(opts) {
    var doc = opts.doc || root.document;
    css(doc);
    var old = doc.getElementById('iwCard'); if (old) old.remove();
    var c = doc.createElement('div');
    c.id = 'iwCard'; c.className = 'iw-card iw-box' + (opts.night ? ' iw-night' : '');
    c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'A note for next time');
    c.innerHTML = '<h4>A note for next time</h4><p>What should you do first when you come back? Inkwell shows it with your place.</p>' +
      '<textarea aria-label="Your note for next time" placeholder="For example: add the consent form wording">' + esc(opts.note || '') + '</textarea>' +
      '<div class="iw-row"><button type="button" class="iw-btn iw-go" data-a="keep">Keep this note</button><button type="button" class="iw-btn" data-a="cancel">Cancel</button>' +
      (opts.note ? '<button type="button" class="iw-link" data-a="clear">Clear the note</button>' : '') + '</div>';
    var ta = c.querySelector('textarea');
    function shut() { c.remove(); }
    c.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-a]') : null; if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'keep' && opts.onSave) opts.onSave(ta.value);
      if (a === 'clear' && opts.onSave) opts.onSave('');
      shut();
    });
    c.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); shut(); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { if (opts.onSave) opts.onSave(ta.value); shut(); } });
    (doc.body || doc.documentElement).appendChild(c);
    try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
    return c;
  }

  /* the panel: the three parts, each with its switch; Reading comfort's
     controls show while it is on, with a sample that changes at once */
  function panelHTML(opts) {
    var o = get(), c = o.comfort, app = (opts && opts.app) || 'inkwell';
    function sw(id, v, name) { return '<button type="button" class="iw-sw" role="switch" aria-checked="' + (v ? 'true' : 'false') + '" data-sw="' + id + '" aria-label="' + esc(name) + '"></button><span class="iw-st">' + (v ? 'On' : 'Off') + '</span>'; }
    function chip(k, v, label, dot) { return '<button type="button" class="iw-chip" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + (String(c[k]) === String(v) ? 'true' : 'false') + '">' + (dot ? '<span class="iw-dot" style="background:' + dot + '"></span>' : '') + esc(label) + '</button>'; }
    var paperNow = app === 'inkwell' || app === 'tabula' ? 'White (as now)' : 'As now';
    var html = '<div class="iw-panel">';
    var n = 0;
    GROUPS.forEach(function (g) {
      html += '<div class="iw-gh">' + esc(g[0]) + '</div>';
      g[1].forEach(function (f) {
        var k = f[0], on = !!(o[k] && o[k].on);
        if (on) n++;
        html += '<div class="iw-sec' + (on ? ' iw-on' : '') + '" data-sec="' + k + '"><div class="iw-sh"><b>' + esc(f[1]) + '</b><span class="iw-where">' + esc(f[2]) + '</span>' + sw(k, on, f[1]) + '</div>' +
          '<p class="iw-d">' + esc(f[3]) + '</p>';
        if (k === 'comfort') html += '<div class="iw-ctl"' + (c.on ? '' : ' hidden') + '>' +
          '<label for="iwSize">Text size</label><input id="iwSize" type="range" min="90" max="170" step="5" value="' + c.size + '" data-r="size"><output data-o="size">' + c.size + '%</output>' +
          '<label for="iwLine">Line spacing</label><input id="iwLine" type="range" min="1.4" max="2.6" step="0.1" value="' + c.line + '" data-r="line"><output data-o="line">' + (+c.line).toFixed(1) + '</output>' +
          '<label for="iwLetter">Letter spacing</label><input id="iwLetter" type="range" min="0" max="0.12" step="0.01" value="' + c.letter + '" data-r="letter"><output data-o="letter">' + (c.letter > 0 ? '+' + Math.round(c.letter * 100) : 'none') + '</output>' +
          '<span>Typeface</span><div class="iw-opts">' + chip('font', '', 'As now') + chip('font', 'atkinson', 'Atkinson Hyperlegible (made to be easy to read)') + '</div>' +
          '<span>Paper</span><div class="iw-opts">' + chip('paper', '', paperNow, '#ffffff') + chip('paper', 'cream', 'Cream', PAPER.cream[0]) + chip('paper', 'grey', 'Soft grey', PAPER.grey[0]) + chip('paper', 'blue', 'Pale blue', PAPER.blue[0]) + chip('paper', 'green', 'Pale green', PAPER.green[0]) + '</div>' +
          '<div class="iw-sample" data-sample>Attention, the claim runs, has fallen with every new screen in the classroom. Yet the studies behind it measure different things: some time on task, some recall, some how pupils feel.</div>' +
          '</div>';
        html += '</div>';
      });
    });
    html += '<p class="iw-foot">Each is off until you switch it on. One choice serves Inkwell, Tabula, Scriba and Fontes, and stays on this device. ' +
      (app === 'inkwell' ? '' : 'Some of these work on Inkwell\u2019s desk only; each says where it works.') + '</p></div>';
    return html;
  }
  function sample(el, night) {
    var c = get().comfort, s = el.querySelector('[data-sample]'); if (!s) return;
    s.style.fontFamily = c.font === 'atkinson' ? ATK : 'Georgia,"Times New Roman",serif';
    s.style.fontSize = Math.round(16 * c.size) / 100 + 'px';
    s.style.lineHeight = String(c.line);
    s.style.letterSpacing = c.letter + 'em';
    s.style.background = PAPER[c.paper] ? PAPER[c.paper][night ? 1 : 0] : '';
  }
  /* wire(el, {night, onChange}): the panel's controls change the settings */
  function wire(el, opts) {
    var o = opts || {}, doc = el.ownerDocument;
    css(doc);
    function night() { return typeof o.night === 'function' ? o.night() : !!o.night; }
    function paint() {
      var g = get();
      FEATURES.forEach(function (f) {
        var k = f[0], on = !!g[k].on, b = el.querySelector('[data-sw="' + k + '"]'); if (!b) return;
        b.setAttribute('aria-checked', on ? 'true' : 'false'); b.nextElementSibling.textContent = on ? 'On' : 'Off';
        b.closest('.iw-sec').classList.toggle('iw-on', on);
      });
      var ctl = el.querySelector('.iw-ctl'); if (ctl) ctl.hidden = !g.comfort.on;
      el.querySelectorAll('.iw-chip').forEach(function (b) { b.setAttribute('aria-pressed', String(g.comfort[b.getAttribute('data-k')]) === b.getAttribute('data-v') ? 'true' : 'false'); });
      var c = g.comfort;
      var out = function (k, v) { var x = el.querySelector('[data-o="' + k + '"]'); if (x) x.textContent = v; };
      out('size', c.size + '%'); out('line', (+c.line).toFixed(1)); out('letter', c.letter > 0 ? '+' + Math.round(c.letter * 100) : 'none');
      if (c.font === 'atkinson') font(doc);
      sample(el, night());
    }
    el.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-sw],.iw-chip') : null; if (!t) return;
      if (t.hasAttribute('data-sw')) { var k = t.getAttribute('data-sw'); set(k + '.on', !get()[k].on); }
      else set('comfort.' + t.getAttribute('data-k'), t.getAttribute('data-v'));
      paint(); if (o.onChange) o.onChange(get());
    });
    el.addEventListener('input', function (e) {
      var t = e.target; if (!t.getAttribute || !t.getAttribute('data-r')) return;
      set('comfort.' + t.getAttribute('data-r'), +t.value);
      paint(); if (o.onChange) o.onChange(get());
    });
    paint();
  }
  /* the panel as its own window, for the rooms */
  function dialog(opts) {
    var o = opts || {}, doc = o.doc || root.document;
    css(doc);
    var old = doc.getElementById('iwDlg'); if (old) old.remove();
    var back = doc.createElement('div');
    back.id = 'iwDlg'; back.className = 'iw-dlg-back' + (o.night && o.night() ? ' iw-night' : '');
    back.innerHTML = '<div class="iw-dlg" role="dialog" aria-modal="true" aria-label="My way of working"><button type="button" class="iw-x" aria-label="Close" title="Close">×</button><h3>My way of working</h3><p class="iw-intro">Small supports for focus, for finding your place again, and for reading comfort.</p>' + panelHTML(o) + '</div>';
    function shut() { back.remove(); doc.removeEventListener('keydown', key, true); if (o.onClose) o.onClose(); }
    function key(e) { if (e.key === 'Escape') { e.stopPropagation(); shut(); } }
    back.addEventListener('click', function (e) { if (e.target === back || (e.target.closest && e.target.closest('.iw-x'))) shut(); });
    doc.addEventListener('keydown', key, true);
    (doc.body || doc.documentElement).appendChild(back);
    wire(back.querySelector('.iw-panel'), o);
    try { back.querySelector('.iw-sw').focus(); } catch (e) {}
    return back;
  }

  /* a room's whole share: o {app, doc, night(), base, after(), slot,
     btnClass, noteSlot, noteClass, key(), here(), go(rec), worth(rec)}.
     Comfort is applied now and on every change; the place is kept as the
     writer works and when the room is left; the card is offered once. */
  function room(o) {
    var doc = o.doc || root.document, last = '', nb = null, shown = false, wt = 0;
    function night() { try { return !!(o.night && o.night()); } catch (e) { return false; } }
    function comfort() {
      var g = get(), k = JSON.stringify(g.comfort) + night();
      if (k === last) return; last = k;
      var p = apply(doc, o.base, night());
      try { if (o.after) o.after(); } catch (e) {}
      if (p && p.then) p.then(function () { try { if (o.after) o.after(); } catch (e) {} });
    }
    function keep() { if (!get().where.on || !o.here) return; var p = null; try { p = o.here(); } catch (e) {} if (p) save(o.app, o.key(), p); }
    function soon() { if (!get().where.on) return; clearTimeout(wt); wt = setTimeout(keep, 1500); }
    if (o.slot) {
      var b = doc.createElement('button'); b.type = 'button'; b.id = 'iwOpen'; b.className = o.btnClass || '';
      b.textContent = o.btnText || 'My way of working'; b.title = 'Reading comfort, where you were, and three at a time';
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { keep(); dialog({ doc: doc, app: o.app, night: night }); });
      o.slot.appendChild(b);
    }
    if (o.noteSlot) {
      nb = doc.createElement('button'); nb.type = 'button'; nb.id = 'iwNote'; nb.className = o.noteClass || '';
      nb.textContent = '\u270e Note for next time'; nb.title = 'Leave yourself a note: it is shown with your place next time';
      nb.hidden = !get().where.on;
      nb.addEventListener('mousedown', function (e) { e.preventDefault(); });
      nb.addEventListener('click', function () { keep(); var k = o.key(), r = load(o.app, k) || {}; noteBox({ doc: doc, night: night(), note: r.note || '', onSave: function (v) { keep(); note(o.app, k, v); } }); });
      o.noteSlot.appendChild(nb);
    }
    var rq = 0;
    function rul() { if (!o.ruler) return; if (rq) return; rq = (root.requestAnimationFrame || setTimeout)(function () { rq = 0; ruler(doc, o.ruler); }); }
    on(function (g) { comfort(); quiet(doc); rul(); if (nb) nb.hidden = !g.where.on; if (o.changed) o.changed(g); });
    quiet(doc);
    if (o.ruler) { doc.addEventListener('selectionchange', rul); doc.addEventListener('input', rul, true); }
    ['keydown', 'input', 'pointerdown'].forEach(function (t) { doc.addEventListener(t, beat, true); });
    try { new root.MutationObserver(function () { comfort(); }).observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] }); } catch (e) {}
    comfort();
    doc.addEventListener('selectionchange', soon);
    doc.addEventListener('input', soon, true);
    root.addEventListener('scroll', soon, { passive: true });
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') keep(); });
    root.addEventListener('pagehide', keep);
    function offer() {
      if (shown || !get().where.on) return;
      var k = o.key(), r = load(o.app, k);
      if (!r || (!r.note && !(o.worth ? o.worth(r) : true))) return;
      shown = true;
      card({ doc: doc, night: night(), rec: r, label: o.label ? o.label(r) : null, onGo: function () { try { o.go(r); } catch (e) {} }, onNoteDone: function () { note(o.app, k, ''); } });
    }
    setTimeout(offer, o.delay || 1200);
    return { keep: keep, offer: offer, comfort: comfort };
  }
  /* scroll so a range sits a third of the way down what can be seen */
  function into(r, top) {
    if (!r) return;
    var rc = r.getBoundingClientRect(), t = top || 0;
    if (!rc.height && r.startContainer && r.startContainer.parentElement) rc = r.startContainer.parentElement.getBoundingClientRect();
    root.scrollBy(0, rc.top - (t + (root.innerHeight - t) / 3));
  }

  var api = { FEATURES: FEATURES, GROUPS: GROUPS, ask: ask, quiet: quiet, ruler: ruler, beat: beat, room: room, into: into, get: get, set: set, on: on, apply: apply, font: font, PAPER: PAPER, load: load, save: save, note: note, when: when, place: place, find: find, cut: cut, domPlace: domPlace, domGo: domGo, card: card, noteBox: noteBox, panelHTML: panelHTML, wire: wire, dialog: dialog, css: css };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKWAY = api;
})(typeof self !== 'undefined' ? self : this);
