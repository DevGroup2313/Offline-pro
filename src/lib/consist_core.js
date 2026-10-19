/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.49: one way throughout (INKCONSIST). A document that writes the same
   thing two ways is marked where it departs from the way it uses most, with
   that way as the fix: a term's capitals ("Internet", "internet"), its
   hyphen ("e-mail", "email"), the quotation marks and apostrophes (straight
   or curly), the dash (spaced en dash, closed em dash, a spaced hyphen, two
   hyphens), the ellipsis ("..." or "…"), number ranges (hyphen or en dash),
   large numbers (10000 or 10,000) and a unit's space ("5 km", "5km"). (The
   serial comma was tried and left out: a list cannot be told from a clause
   without parsing, and on published articles most of its marks were not
   lists.)

   A form is marked only when the document has a clear majority (at least
   two thirds of the uses, and at least two of them). Names are left alone:
   a capital beside another capital is part of a name ("Church of England"),
   and words whose capital changes their sense ("the State", "the state")
   are not compared. References, headings and the masked places (quotations,
   citations, addresses) are not counted.

   INKCONSIST.check(text, {ranges, markRanges, masked(i), maskedMarks(i), common(word)})
     -> [{start, end, orig, fix, why, fam}]
     ranges or masked: places not to read for words; markRanges or
     maskedMarks: for the marks
     (quotation marks, apostrophes, dashes); common: a word that is an
     ordinary lower-case English word */
(function (root) {
  'use strict';
  const MAJ = 2 / 3;
  /* capitals that change the sense, or names that are also common words */
  const SENSE = new Set(('state states church churches government governments crown court courts party parties parliament congress senate union republic university universities college colleges school schools city cities county river street road north south east west northern southern eastern western president presidents king kings queen queens prince princess emperor empire pope bishop minister ministry department office army navy constitution revolution reformation renaissance enlightenment romantic romanticism classical modern modernism realism bible scripture god gods heaven hell earth sun moon nature web net mark will bill bush rose grace hope faith joy may june august frank rich rob pat sue jack guy bob carol dawn eve ray wood ford brown white black green young king park hall hill lee long bell cook baker smith turner cooper mason shepherd stone rock fox wolf bird lamb hunt field house land chapter section figure table appendix part volume book act scene article plate map note notes page pages fig box us it who aids').split(' '));
  const FUNC = new Set(('the this that these those there their they them then than thus such some also first second third finally firstly secondly however therefore moreover furthermore rather still yet instead indeed hence while when where which who whom whose what why how here for from with without into onto upon about above below after before between among within across through during against towards toward and but nor not only just even both either neither each every all any many most more much other another own same very our your his her its was were are is be been being have has had does did can could would should will shall might must may let one two three four five six seven eight nine ten').split(' '));
  const lc = s => s.toLowerCase();
  const most = m => { let best = null, n = 0, tot = 0; for (const [k, v] of m) { tot += v.length; if (v.length > n) { n = v.length; best = k; } } return { best, n, tot }; };

  /* the places counted: no headings, no references, nothing masked. The
     places left out are marked once in a byte map, so a 100,000-word
     thesis is read in one pass. o.ranges ([[start, end), ...]) is the fast
     way to give the masked places; o.masked(i) a slower one. */
  function scope(t, o, ranges, fn) {
    const map = new Uint8Array(t.length + 1), mark = (a, b) => { for (let i = Math.max(0, a); i < Math.min(b, t.length); i++) map[i] = 1; };
    const ref = t.search(/^(?:#{1,3}\s*)?(?:References|Bibliography|Works Cited|Sources|Literature|Notes)\s*:?\s*$/im);
    if (ref >= 0) mark(ref, t.length);
    /* headings: marked ones, and short lines with no closing stop */
    let at = 0;
    for (const line of t.split('\n')) { const l = line.trim();
      if (l && (/^#{1,6}\s/.test(l) || (l.split(/\s+/).length <= 14 && !/[.!?:;"”)\]]$/.test(l)))) mark(at, at + line.length);
      at += line.length + 1; }
    for (const r of ranges || []) mark(r[0], r[1]);
    return fn ? (i => map[i] === 1 || fn(i)) : (i => map[i] === 1);
  }
  function startOfSentence(t, i) {
    let j = i - 1;
    while (j >= 0 && /["“‘'(\[\s*_]/.test(t[j]) && t[j] !== '\n') j--;
    if (j < 0 || t[j] === '\n') return true;
    return /[.!?:;…]/.test(t[j]) || (t[j] === '>' );
  }

  function capitals(t, out, skipAt, o) {
    const re = /\p{L}[\p{L}'’]*(?:-[\p{L}0-9]+)*/gu, forms = new Map(); let m;
    const toks = [];
    while ((m = re.exec(t))) toks.push({ w: m[0], s: m.index, e: m.index + m[0].length });
    const kind = w => /^[\p{Lu}0-9-]+$/u.test(w) && /\p{Lu}.*\p{Lu}/u.test(w) ? 'upper' : /^\p{Lu}[^\p{Lu}]*$/u.test(w) ? 'cap' : /^[^\p{Lu}]+$/u.test(w) ? 'low' : 'mixed';
    /* a title in quotation marks or italics keeps its own capitals */
    const tmap = new Uint8Array(t.length + 1), qre = /“[^”\n]{1,200}”|"[^"\n]{1,200}"|‘[^’\n]{1,120}’(?![a-z])|\*[^*\n]{1,200}\*|_[^_\n]{1,200}_|\([^)\n]{0,160}\)/g; let q;
    while ((q = qre.exec(t))) for (let j = q.index + 1; j < q.index + q[0].length - 1; j++) tmap[j] = 1;
    const inTitle = i => tmap[i] === 1;
    /* names: a capital cited with a year or a note number ("Said (1993)", "Said, [12]") */
    const named = new Set(); { const nre = /(\p{Lu}[\p{L}'’-]+)(?:,? (?:\(?\d{4}|et al)|\s*\((?:\d{4}|n\.d\.)|,?\s*\[\d)/gu; let x; while ((x = nre.exec(t))) named.add(lc(x[1])); }
    const prevWord = i => toks[i - 1] && /^[ \t]+$/.test(t.slice(toks[i - 1].e, toks[i].s)) ? lc(toks[i - 1].w) : '';
    /* terms written both ways after "the": one term, two forms */
    const theLow = new Set(), theCap = new Set();
    toks.forEach((k, i) => { if (prevWord(i) !== 'the' || inTitle(k.s) || skipAt(k.s)) return; const key = lc(k.w); (/^\p{Lu}/u.test(k.w) ? theCap : theLow).add(key); });
    for (let i = 0; i < toks.length; i++) {
      const k = toks[i], key = lc(k.w).replace(/['’]s$/, '');
      if (inTitle(k.s)) continue;
      if (key.length < 3 || SENSE.has(key) || SENSE.has(key.replace(/s$/, '')) || FUNC.has(key) || named.has(key)) continue;
      if (skipAt(k.s) || startOfSentence(t, k.s)) continue;
      const f = kind(k.w); if (f === 'mixed') continue;
      if (f === 'upper' && key.length < 4) continue;
      if (f !== 'low') {
        /* a capital counts only inside a clause: a small word or a comma
           just before it (after a citation, a note number or a bracket it
           may begin a sentence: "[32] This", "abilities.4 For") */
        let pj = k.s - 1; while (pj >= 0 && (t[pj] === ' ' || t[pj] === '\t')) pj--;
        const pc = pj >= 0 ? t[pj] : '';
        if (!/[\p{Ll},]/u.test(pc)) continue;
        /* "the Fund", "the Absolute", "Level 3": a capital the writer chose,
           unless the same term also stands after "the" in lower case */
        if ((prevWord(i) === 'the' && !theLow.has(key)) || /^\s*\d/.test(t.slice(k.e, k.e + 3))) continue;
        /* part of a name or a title: a capital beside a capital, across
           "of", "and", "&" or a comma ("Ministry of Health", "Autonomy,
           Paternalism, and Consent") */
        const capNear = (j, d) => { for (let n = 0; n < 3; n++, j += d) { const x = toks[j]; if (!x) return false; if (/^(?:of|and|for|the|de|la|von|van|du|del|on|in)$/.test(x.w)) continue; if (FUNC.has(lc(x.w))) return false; return /^\p{Lu}/u.test(x.w); } return false; };
        if (capNear(i - 1, -1) || capNear(i + 1, 1)) continue;
      }
      if (!forms.has(key)) forms.set(key, new Map());
      const fm = forms.get(key), sf = k.w.replace(/['’]s$/, '');
      const fk = f === 'low' ? 'low' : f === 'cap' ? 'cap' : 'upper';
      if (!fm.has(fk)) fm.set(fk, []);
      fm.get(fk).push({ s: k.s, e: k.s + sf.length, w: sf });
    }
    for (const [key, fm] of forms) {
      if (fm.size < 2) continue;
      const { best, n, tot } = most(fm);
      if (n < 2 || n / tot < MAJ) continue;
      /* a common word in lower case is not raised to a capital the document
         gives it in names and titles ("said" beside Edward Said) */
      if (best !== 'low' && fm.has('low') && o.common && o.common(key)) continue;
      if (best === 'low' && n < 3) continue;
      const shown = fm.get(best)[0].w;
      for (const [k2, list] of fm) {
        if (k2 === best) continue;
        for (const x of list) {
          const fix = best === 'low' ? lc(x.w) : best === 'upper' ? x.w.toUpperCase() : x.w[0].toUpperCase() + lc(x.w.slice(1));
          if (fix === x.w) continue;
          out.push({ start: x.s, end: x.e, orig: x.w, fix, fam: 'caps', why: 'Capitalisation consistency: this document writes “' + shown + '” ' + n + ' times; keep one form' });
        }
      }
    }
  }

  function hyphens(t, out, skipAt) {
    const hy = new Map(), re = /\b([A-Za-z]+(?:-[A-Za-z]{2,})+)\b/g; let m;
    while ((m = re.exec(t))) { if (skipAt(m.index)) continue; const k = lc(m[1]); if (/^re-/.test(k)) continue; if (!hy.has(k)) hy.set(k, []); hy.get(k).push({ s: m.index, e: m.index + m[1].length, w: m[1] }); }
    if (!hy.size) return;
    const words = new Map(), wre = /\b[A-Za-z]{3,}\b/g; let w;
    while ((w = wre.exec(t))) { if (t[w.index - 1] === '-' || t[w.index + w[0].length] === '-') continue; const k = lc(w[0]); if (!words.has(k)) words.set(k, []); words.get(k).push({ s: w.index, e: w.index + w[0].length, w: w[0] }); }
    for (const [k, hl] of hy) {
      const cl = (words.get(k.replace(/-/g, '')) || []).filter(c => !skipAt(c.s));
      if (!cl.length) continue;
      const tot = hl.length + cl.length, hyW = hl.length >= cl.length;
      const n = Math.max(hl.length, cl.length);
      if (n < 2 || n / tot < MAJ) continue;
      const minor = hyW ? cl : hl;
      for (const x of minor) {
        const fix = hyW ? (() => { /* put the hyphens back where the document has them */ let r = '', j = 0; for (const ch of hl[0].w) { if (ch === '-') { r += '-'; continue; } r += x.w[j++] || ''; } return r; })() : x.w.replace(/-/g, '');
        out.push({ start: x.s, end: x.e, orig: x.w, fix, fam: 'hyph', why: 'Hyphen consistency: this document writes “' + (hyW ? hl[0].w : cl[0].w) + '” ' + n + ' times; keep one form' });
      }
    }
  }

  /* competing forms of one mark; each form's pattern starts with a prefix
     group (no lookbehind: Safari before 16.4 cannot read one), and its
     "to" turns any match into that form. The minority is marked with the
     majority's form. */
  function symbols(t, out, skipAt, fam, forms, why) {
    const seen = forms.map(f => { const L = []; f.re.lastIndex = 0; let m;
      while ((m = f.re.exec(t))) { const pre = m[1] || '', core = m[0].slice(pre.length), at = m.index + pre.length;
        if (!skipAt(at)) L.push({ at, core, m }); if (!m[0].length) f.re.lastIndex++; }
      return L; });
    let bi = -1, n = 0, tot = 0;
    seen.forEach((L, i) => { tot += L.length; if (forms[i].to && L.length > n) { n = L.length; bi = i; } });
    if (bi < 0 || n < 2 || n / tot < MAJ || n === tot) return;
    const want = forms[bi];
    seen.forEach((L, i) => { if (i === bi) return;
      for (const x of L) { const fix = want.to(x.core, x.at, t); if (fix == null || fix === x.core) continue;
        out.push({ start: x.at, end: x.at + x.core.length, orig: x.core, fix, fam, why: why(want, n) }); } });
  }
  const opening = (t, i) => i === 0 || /[\s(\[{—–-]/.test(t[i - 1]);
  const W = "([A-Za-z,;)”’\"])", A = "(?=[A-Za-z(“‘\"])";

  function check(text, o) {
    o = o || {};
    const t = String(text || ''), out = [], skipAt = scope(t, o, o.ranges, o.masked);
    /* the marks are the writer's typesetting even inside a quotation, so
       they take a lighter mask (addresses, code) where one is given */
    const skipMk = (o.markRanges || o.maskedMarks) ? scope(t, o, o.markRanges, o.maskedMarks) : skipAt;
    try { capitals(t, out, skipAt, o); } catch (e) {}
    try { hyphens(t, out, skipAt); } catch (e) {}
    const run = (fam, forms, why) => { try { symbols(t, out, skipMk, fam, forms, why); } catch (e) {} };
    run('quotes', [
      { name: 'curly', re: /()[“”]/g, to: (c, at, t2) => opening(t2, at) ? '“' : '”' },
      { name: 'straight', re: /()"/g, to: () => '"' }
    ], w => 'Quotation mark consistency: this document mostly uses ' + (w.name === 'curly' ? 'curly quotation marks (“ ”)' : 'straight quotation marks (")') + '; keep one kind');
    run('apos', [
      { name: 'curly', re: /([A-Za-z])’(?=[A-Za-z])/g, to: () => '’' },
      { name: 'straight', re: /([A-Za-z])'(?=[A-Za-z])/g, to: () => "'" }
    ], w => 'Apostrophe consistency: this document mostly uses ' + (w.name === 'curly' ? 'the curly apostrophe (’)' : 'the straight apostrophe (\')') + '; keep one kind');
    run('dash', [
      { name: 'a closed em dash (word—word)', re: new RegExp(W + '—' + A, 'g'), to: () => '—' },
      { name: 'a spaced em dash (word — word)', re: / — /g, to: () => ' — ' },
      { name: 'a spaced en dash (word – word)', re: / – /g, to: () => ' – ' },
      { name: 'hyph', re: new RegExp(W + ' - ' + A, 'g') },
      { name: 'dbl', re: new RegExp(W + ' ?-- ?' + A, 'g') }
    ], w => 'Dash consistency: this document mostly sets a dash as ' + w.name + '; keep one kind');
    run('ellipsis', [
      { name: 'char', re: /()…/g, to: () => '…' },
      { name: 'dots', re: /(^|[^.])\.\.\.(?!\.)/g, to: () => '...' }
    ], w => 'Ellipsis consistency: this document mostly writes ' + (w.name === 'char' ? 'the ellipsis as one character (…)' : 'the ellipsis as three full stops (...)') + '; keep one form');
    run('range', [
      { name: 'en', re: /(^|[^\d.\-–/])\d{1,4}–\d{1,4}(?![\d\-–/])/g, to: c => c.replace('-', '–') },
      { name: 'hy', re: /(^|[^\d.\-–/])\d{1,4}-\d{1,4}(?![\d\-–/])/g, to: c => c.replace('–', '-') }
    ], w => 'Range consistency: this document mostly writes number ranges with ' + (w.name === 'en' ? 'an en dash (10–20)' : 'a hyphen (10-20)') + '; keep one form');
    run('thou', [
      { name: 'comma', re: /(^|[^\d.,])\d{2,3},\d{3}(?:,\d{3})*(?![\d,])(?!\.\d)/g, to: c => c.replace(/,/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') },
      { name: 'bare', re: /(^|[^\d.,A-Za-z/#\-])\d{5,}(?!\d|,\d|[A-Za-z/\-])/g, to: c => c.replace(/,/g, '') }
    ], w => 'Number consistency: this document mostly writes large numbers ' + (w.name === 'comma' ? 'with commas (10,000)' : 'without commas (10000)') + '; keep one form');
    const U = '(?:km|kg|cm|mm|mg|ml|mL|GB|MB|KB|kB|TB|Hz|kHz|MHz|GHz|kW|MW|kWh|mph)';
    run('unit', [
      { name: 'spaced', re: new RegExp('()\\b\\d+(?:[.,]\\d+)? ' + U + '\\b', 'g'), to: c => c.replace(/(\d)(?=[A-Za-z])/, '$1 ') },
      { name: 'closed', re: new RegExp('()\\b\\d+(?:[.,]\\d+)?' + U + '\\b', 'g'), to: c => c.replace(/ (?=[A-Za-z])/, '') }
    ], w => 'Unit consistency: this document mostly writes ' + (w.name === 'spaced' ? 'a space before a unit (5 km)' : 'units closed up (5km)') + '; keep one form');
    return out.sort((x, y) => x.start - y.start);
  }

  const LESSONS = {
    'Capitalisation consistency': ['A term takes its capital, or not, the same way each time: "internet" or "Internet", "Covid-19" or "COVID-19". Choose one, ideally the one your style guide or field uses, and keep it.', '"the Internet … the internet" → one form'],
    'Hyphen consistency': ['Some words are written closed, hyphenated or open as English changes ("e-mail", "email"). Either may be right; a document chooses one and keeps it.', '"well-being … wellbeing" → one form'],
    'Quotation mark consistency': ['Curly quotation marks (“ ”) are the typeset form; straight ones (") come from the keyboard. A finished document uses one kind.', '"straight" beside “curly” → one kind'],
    'Apostrophe consistency': ['The curly apostrophe (’) is the typeset form, the straight one (\') the typed form. Keep one throughout.', 'don\'t … don’t → one kind'],
    'Dash consistency': ['A dash that sets off a phrase is either a closed em dash (word—word, common in US style) or a spaced en dash (word – word, common in British style). A spaced hyphen or two hyphens stand in for one when typing.', '"word -- word" → "word—word" or "word – word"'],
    'Ellipsis consistency': ['An ellipsis is three full stops or one character (…). Either is accepted; keep one.', '"..." beside "…" → one form'],
    'Range consistency': ['Style guides set number ranges with an en dash (10–20); a hyphen is the typed stand-in. Keep one form.', '"pp. 10-20" beside "pp. 30–40" → one form'],
    'Number consistency': ['Numbers of five digits or more usually take commas (10,000) in running text, or a thin space in some styles. Keep one form.', '"12000" beside "15,000" → one form'],
    'Unit consistency': ['Most styles (SI, Chicago, APA) put a space between a number and its unit: "5 km". Keep one form throughout.', '"5km" beside "8 km" → one form']
  };

  const api = { check, LESSONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKCONSIST = api;
})(typeof self !== 'undefined' ? self : this);
