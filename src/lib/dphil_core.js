/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.45: the checks a doctoral editor makes on a whole document (INKDPHIL),
   offline. Each returns notes {start, end, orig, fix, why, fam, cat}: cat
   'g' for a fault a reader would call wrong (a citation with no entry, a
   figure that does not exist), 'c' for a matter of consistency, where
   either form is right and the document should keep to one. Tested in
   tools/dphil/dphil_test.js.

   Measured on 40 published philosophy and ethics articles and a thesis
   sample (none kept here): -ise and -ize mixed in one document in 10 of
   41; an abbreviation used before it is spelled out in 9 of 41. Mixed
   hyphenation ("decision-making" beside "decision making") was in 29, but
   most of it is correct (the hyphen joins a compound before a noun), so
   that check is not made.

   The prose checks (spelling, abbreviations, per cent, "e.g.,") read only
   the writer's own sentences: not quotations or titles (opts.mask, and
   text in *italics*), nor the References, Notes, Contents, list of
   abbreviations or Index. The typographic checks (quotation marks,
   ellipses, dashes) read everything but the reference list.

   - izeIse: -ise and -ize in one document. Both are British English (-ize
     is Oxford spelling); US English takes -ize. The fewer are marked.
   - abbreviations: used before the place that spells them out; spelled out
     and never used again; spelled out twice in one chapter.
   - citesVsRefs: an in-text citation with no entry in the References, a
     citation in a group "(Gadamer, 1960; Svenaeus, 2000)" included, and
     "2019a" matched to "2019"; an entry of a References list (not of a
     Bibliography, which may hold works consulted) cited nowhere.
   - refOrder: an author-date list out of alphabetical order.
   - citeForm: the comma between name and year, the page ("p. 4", ": 4",
     ", 4") and "&" or "and", each kept one way.
   - quotePages: a direct quotation of a sentence or more, followed by an
     author-year citation with no page.
   - quoteMarks, perCent, ellipses, dashes, egComma: the same thing written
     two ways.
   - numbering: numbered headings that skip, figures and tables numbered out
     of sequence, a reference to a figure, table or chapter that is not in
     the document, and "Figure 2" beside "figure 2". */
(function (root) {
  'use strict';

  /* ---------- the parts of the document ---------- */
  const BACK = /^(?:references|reference list|bibliography|works cited|sources|literature|notes|endnotes|footnotes|abbreviations|list of abbreviations|glossary|contents|table of contents|index)\b/i;
  const REFS = /^(?:references|reference list|bibliography|works cited|literature)\s*$/i;
  function headings(t) {
    const out = [];
    for (const m of t.matchAll(/^(#{1,6})[ \t]*(.*)$/gm)) out.push({ at: m.index, end: m.index + m[0].length, level: m[1].length, text: m[2].trim() });
    return out;
  }
  /* a heading's section runs to the next heading of its level or higher */
  function sections(t, H, test) {
    const out = [];
    H.forEach((h, i) => {
      if (!test.test(h.text)) return;
      let e = t.length;
      for (let j = i + 1; j < H.length; j++) if (H[j].level <= h.level) { e = H[j].at; break; }
      out.push([h.at, e, h]);
    });
    return out;
  }
  function merge(rs) {
    const a = rs.filter(r => r && r[1] > r[0]).map(r => [r[0], r[1]]).sort((x, y) => x[0] - y[0]), out = [];
    for (const r of a) { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push(r); }
    return out;
  }
  function inside(rs, x) {
    let lo = 0, hi = rs.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (rs[m][1] <= x) lo = m + 1; else if (rs[m][0] > x) hi = m - 1; else return true; }
    return false;
  }
  /* what every check needs, worked out once per document */
  function prep(text, opts) {
    const t = String(text || ''), o = opts || {};
    if (o._ctx && o._ctx.t === t) return o._ctx;
    const H = headings(t);
    const back = sections(t, H, BACK).map(s => [s[0], s[1]]);
    const refs = sections(t, H, REFS);
    const ital = [];
    for (const m of t.matchAll(/(^|[^*\w])(\*{1,2}|_)(?!\s)([^*_\n]{1,300}?)\2(?![*\w])/g)) ital.push([m.index + m[1].length, m.index + m[0].length]);
    for (const m of t.matchAll(/`[^`\n]*`|https?:\/\/\S+|\bdoi:\s*\S+/gi)) ital.push([m.index, m.index + m[0].length]);
    const code = merge(ital.filter(r => /^`|^https?:|^doi/i.test(t.slice(r[0], r[0] + 6))));
    const notProse = merge(back.concat(o.mask || [], ital));
    const notType = merge(refs.map(s => [s[0], s[1]]).concat(code));
    /* the chapters: sections at the highest heading level used */
    const top = H.length ? Math.min.apply(null, H.map(h => h.level)) : 1;
    const chap = H.filter(h => h.level === top).map(h => h.at);
    const ctx = { t, H, back, refs, notProse, notType, chap,
      prose: x => !inside(notProse, x), typo: x => !inside(notType, x),
      chapterOf: x => { let k = -1; for (let i = 0; i < chap.length && chap[i] <= x; i++) k = i; return k; },
      line: x => { const a = t.lastIndexOf('\n', x - 1) + 1; let b = t.indexOf('\n', x); if (b < 0) b = t.length; return t.slice(a, b); } };
    if (o) o._ctx = ctx;
    return ctx;
  }
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  /* the one of two ways used less, when the other is used at least
     three times as often (a document in transition is left alone) */
  function minority(groups, minTotal, ratio) {
    const ks = Object.keys(groups).filter(k => groups[k].length);
    if (ks.length < 2) return null;
    const tot = ks.reduce((a, k) => a + groups[k].length, 0);
    if (tot < (minTotal || 3)) return null;
    ks.sort((a, b) => groups[b].length - groups[a].length);
    const win = ks[0], rest = tot - groups[win].length;
    if (groups[win].length < (ratio || 3) * rest) return null;
    return { win, lose: ks.slice(1), tot };
  }

  /* ---------- -ise and -ize ---------- */
  /* stems that take -ise or -ize, for when no dictionary is loaded; with a
     dictionary, any stem whose two forms are both words */
  const STEMS = new Set(('organ real recogn apolog special emphas minim maxim util character categor priorit conceptual marginal normal ' +
    'legitim critic summar standard general visual author central global industrial modern mobil optim synthes theor stabil legal ' +
    'capital civil colon democrat formal hospital human ideal immun internal individual institutional rational political romantic ' +
    'social symbol sympath vocal agon antagon apostroph capsul catal dramat econom energ familiar fertil final harmon hypothes ' +
    'jeopard memor mesmer moral natural neutral ostrac pasteur patron penal polar popular public radical random scrutin sensit ' +
    'stigmat subsid terror tantal trivial unional urban vandal victim westernal crystall commercial contextual operational ' +
    'problemat secular sexual material medical mechan monopol homogen hierarch personal plural professional prophes').split(' '));
  const IZE = /\b([A-Za-z]{3,}?)(is|iz|IS|IZ)(e|es|ed|ing|ation|ations|er|ers|E|ES|ED|ING|ATION|ATIONS|ER|ERS)\b/g;
  const NOT_STEM = /^(?:adv|advert|appr|compr|comprom|dev|desp|disgu|enterpr|exerc|expert|franch|impr|improv|merchand|prem|prec|rev|superv|surpr|telev|treat|wh|w|s|pr|se|ma|po|ra|ar|ch|vo|dem|exc|exp|inc|conc|circumc|paral|anal)$/i;
  function izeIse(text, opts) {
    const o = opts || {}, C = prep(text, o), t = C.t, known = o.known, level = o.level;
    /* with the dictionary's levels: a true pair is listed at one level
       ("organise" and "organize" both 10); "expertise" (20) and the rare
       "expertize" (70) are not a pair */
    const memo = new Map();
    const alt = stem => {
      const s = stem.toLowerCase();
      if (memo.has(s)) return memo.get(s);
      let v;
      if (NOT_STEM.test(s)) v = false;
      else if (level) { const a = level(s + 'ise'), b = level(s + 'ize'); v = a >= 0 && a === b && a < 70; }
      else if (known) v = known(s + 'ise') && known(s + 'ize');
      else v = STEMS.has(s);
      memo.set(s, v);
      return v;
    };
    const hits = [];
    let m;
    IZE.lastIndex = 0;
    /* a capital inside a sentence is a name, which keeps its own spelling:
       "the World Health Organization", "the Royal Society for the
       Prevention of Accidents" */
    const named = x => /^[A-Z]/.test(t[x]) && !/(?:^|[.!?:]["”’)\]]*\s+|\n[#>*\-\s]*)$/.test(t.slice(Math.max(0, x - 6), x));
    /* 7.47: the CRediT roles of an author-contributions line are fixed
       terms ("Conceptualization, Visualization, Writing – review & editing"),
       spelled so in every journal */
    const credit = x => { const a = t.lastIndexOf('\n', x) + 1, b = t.indexOf('\n', x); const line = t.slice(a, b < 0 ? t.length : b);
      return /review\s*&\s*editing|original draft|[Ff]unding acquisition|[Dd]ata curation|[Ff]ormal analysis/.test(line); };
    while ((m = IZE.exec(t))) if (C.prose(m.index) && !named(m.index) && !credit(m.index) && alt(m[1])) hits.push({ start: m.index, end: m.index + m[0].length, word: m[0], z: m[2].toLowerCase() === 'iz', stem: m[1], tail: m[3] });
    const nz = hits.filter(h => h.z).length, ns = hits.length - nz;
    const out = [];
    if (o.dialect === 'us') {
      /* US English spells these -ize; each -ise form is marked */
      hits.filter(h => !h.z).forEach(h => out.push(izeNote(h, 'z', 'US English spells this with -ize.')));
      return out;
    }
    if (!nz || !ns || hits.length < 3) return out;
    const want = nz >= ns ? 'z' : 's';
    const ex = want === 'z' ? hits.find(h => h.z).word : hits.find(h => !h.z).word;
    hits.filter(h => (h.z ? 'z' : 's') !== want).forEach(h => out.push(izeNote(h, want,
      'Consistency: this document spells these words both with -ise and with -ize (here “' + h.word + '”, elsewhere “' + ex + '”). Both are correct British English, -ize being Oxford spelling; use one throughout.')));
    return out;
  }
  function izeNote(h, want, why) {
    const up = /[A-Z]/.test(h.word.slice(h.stem.length, h.stem.length + 2));
    const letter = want === 'z' ? (up ? 'IZ' : 'iz') : (up ? 'IS' : 'is');
    return { start: h.start, end: h.end, orig: h.word, fix: h.stem + letter + h.tail, why, fam: 'ize', cat: 'g' };
  }

  /* ---------- abbreviations ---------- */
  /* abbreviations everyone knows, which need no spelling out */
  const KNOWN_ABBR = new Set('UK US USA EU UN NHS BBC DNA RNA HIV AIDS CEO GDP PHD DPHIL MA BA MSC BSC PDF URL IT TV OK AM PM BCE CE AD BC NATO UNESCO OECD UNICEF COVID USSR NASA FBI CIA MP MPS ICU GP ID IQ CV'.split(' '));
  /* "World Health Organization (WHO)": the words before the brackets begin
     with the abbreviation's letters, in order (most of them, at least) */
  function expansion(t, at, ab) {
    /* the words since the sentence began, at most 160 characters back */
    let from = Math.max(0, at - 160);
    const nl = t.lastIndexOf('\n', at - 1);
    if (nl >= from) from = nl + 1;
    const seg = t.slice(from, at), se = /[.!?]["”’)\]]*\s+(?=[\p{Lu}"“‘(\[])/gu;
    let m;
    while ((m = se.exec(seg))) from = Math.max(from, t.indexOf(seg.slice(m.index + m[0].length), from) >= 0 ? from + m.index + m[0].length : from);
    const ws = [];
    for (const w of t.slice(from, at).matchAll(/[\p{L}][\p{L}\p{N}'’]*/gu)) if (!/^[\p{Lu}\d&]{2,}s?$/u.test(w[0])) ws.push({ w: w[0], at: from + w.index });
    const L = ab.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (L.length < 2 || ws.length < 2) return null;
    /* the nearest start from which every letter is found, most of them as
       the first letter of a word ("Traditional Chinese Medicine (TCM)",
       "magnetic resonance imaging (MRI)", "deoxyribonucleic acid (DNA)") */
    for (let first = ws.length - 1; first >= Math.max(0, ws.length - L.length - 4); first--) {
      if (ws[first].w[0].toLowerCase() !== L[0]) continue;
      let k = 0, init = 0;
      for (let i = first; i < ws.length && k < L.length; i++) {
        const w = ws[i].w.toLowerCase();
        if (w[0] === L[k]) { k++; init++; }
        else if (/^(?:of|and|for|the|in|on|to|a|an|&)$/.test(w)) continue;
        else { let p = 0; while (k < L.length && (p = w.indexOf(L[k], p + 1)) > 0) k++; }
      }
      if (k === L.length && init >= Math.ceil(L.length / 2)) return { at: ws[first].at, words: ws.slice(first).map(x => x.w).join(' ') };
    }
    return null;
  }
  function abbreviations(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    /* every use of every capitalised token, read once */
    const uses = new Map(), any = new Map();
    for (const m of t.matchAll(/\b([A-Z][A-Z0-9&]{1,6})s?\b/g)) {
      if (!C.typo(m.index)) continue;
      let b = any.get(m[1]); if (!b) any.set(m[1], b = []);
      b.push(m.index);
      if (!C.prose(m.index)) continue;
      let a = uses.get(m[1]); if (!a) uses.set(m[1], a = []);
      a.push(m.index);
    }
    const defs = new Map();
    for (const d of t.matchAll(/\(([A-Z][A-Z0-9&]{1,6})s?\)/g)) {
      const ab = d[1];
      if (KNOWN_ABBR.has(ab.toUpperCase()) || /^[IVXLC]+$/.test(ab) || !C.prose(d.index)) continue;
      const ex = expansion(t, d.index, ab);
      if (!ex) continue;
      let a = defs.get(ab); if (!a) defs.set(ab, a = []);
      a.push({ at: d.index, end: d.index + d[0].length, ex });
    }
    for (const [ab, ds] of defs) {
      const inDef = x => ds.some(d => x > d.at && x < d.end);
      const d0 = ds[0], us = (uses.get(ab) || []).filter(x => !inDef(x)), later = (any.get(ab) || []).filter(x => !inDef(x) && x > d0.end);
      /* used before it is spelled out (a heading does not count) */
      const early = us.find(x => x < d0.at && !/^\s*#/.test(C.line(x)));
      if (early !== undefined) out.push({ start: early, end: early + ab.length, orig: ab, fix: null, fam: 'abbr', cat: 'g',
        why: 'Abbreviation used before it is spelled out: “' + ab + '” is defined only later (“' + d0.ex.words + ' (' + ab + ')”). Spell it out at its first use.' });
      /* spelled out, and never used again */
      if (!later.length && ds.length === 1) {
        const s = t[d0.at - 1] === ' ' ? d0.at - 1 : d0.at;
        out.push({ start: s, end: d0.end, orig: t.slice(s, d0.end), fix: '', fam: 'abbr', cat: 'c',
          why: 'Abbreviation never used again: “' + ab + '” is spelled out here and not used after, so the brackets can go.' });
      }
      /* spelled out twice in one chapter */
      for (let i = 1; i < ds.length; i++) {
        const prev = ds.slice(0, i).find(d => C.chapterOf(d.at) === C.chapterOf(ds[i].at));
        if (!prev) continue;
        out.push({ start: ds[i].ex.at, end: ds[i].end, orig: t.slice(ds[i].ex.at, ds[i].end), fix: t.slice(ds[i].at + 1, ds[i].end - 1), fam: 'abbr', cat: 'c',
          why: 'Abbreviation spelled out twice: “' + ab + '” is already defined earlier in this ' + (C.chap.length > 1 ? 'chapter' : 'document') + '; after that, “' + ab + '” alone is enough.' });
      }
    }
    return out;
  }

  /* ---------- citations and references ---------- */
  const YEAR = '((?:1[5-9]|20)\\d\\d)([a-z]?)';
  const NAME = "\\p{Lu}[\\p{L}'’\\-]+(?:\\s+(?:van|von|de|da|del|du|la|le)\\s+\\p{Lu}[\\p{L}'’\\-]+)?";
  const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const surOf = s => fold(s.split(/\s+/).pop()).replace(/['’]s?$/, '');
  function references(text, opts) {
    const C = prep(text, opts), t = C.t, R = C.refs[0];
    if (!R) return null;
    const entries = [], lines = [];
    let off = R[2].end + 1;
    for (const ln of t.slice(off, R[1]).split('\n')) {
      const at = off; off += ln.length + 1;
      if (!ln.trim()) continue;
      lines.push({ at, ln });
      if (/^\s*#/.test(ln)) { entries.push({ reset: true }); continue; }
      const body = ln.replace(/^\s*(?:[-*+]\s+|\[\d+\]\s*|\d+\.\s+)/, '');
      const m = new RegExp('(\\p{Lu}[\\p{L}\'’\\-]+)[^\\n]{0,300}?\\b' + YEAR + '\\b', 'u').exec(body);
      if (!m) { entries.push({ reset: true }); continue; }
      const lead = ln.length - body.length;
      entries.push({ sur: surOf(m[1]), year: m[2], at, nameAt: at + lead + m.index, name: m[1], ln, numbered: lead > 0 && /^\s*(?:\[\d+\]|\d+\.)/.test(ln), body });
    }
    return { at: R[0], end: R[1], head: R[2].text, entries: entries.filter(e => !e.reset), seq: entries, lines };
  }
  /* in-text author-year citations, each name and year with its place */
  function citations(body) {
    const out = [];
    /* "(Gadamer, 1960; Svenaeus, 2000, p. 4)" and "(Smith and Jones 2019)" */
    const PART = new RegExp('^(\\s*(?:(?:see(?: also)?|cf\\.|e\\.g\\.,?|i\\.e\\.,?)\\s+)?)(' + NAME + ')((?:\\s+et al\\.?|,?\\s+(?:and|&)\\s+' + NAME + ')?)(,?\\s+)' + YEAR + '\\b(.*)$', 'u');
    for (const g of body.matchAll(/\(([^()]{4,240})\)/g)) {
      if (!/(?:1[5-9]|20)\d\d/.test(g[1])) continue;
      let off = g.index + 1;
      for (const part of g[1].split(';')) {
        const m = PART.exec(part);
        if (m) {
          const s = off + m[1].length, nameEnd = s + m[2].length + m[3].length, yAt = nameEnd + m[4].length;
          out.push({ start: s, end: yAt + m[5].length + m[6].length, sur: surOf(m[2]), year: m[5], label: m[2] + ' (' + m[5] + m[6] + ')',
            paren: true, sep: m[4], sepAt: nameEnd, two: m[3], twoAt: s + m[2].length, rest: m[7], restAt: yAt + m[5].length + m[6].length });
        }
        off += part.length + 1;
      }
    }
    /* "Smith (2019)", "Smith et al. (2019)", "Smith and Jones (2019)": from
       each bracketed year, the names just before it */
    const LEAD = new RegExp('(^|[^\\p{L}])(' + NAME + ')((?:\\s+et al\\.?|,?\\s+(?:and|&)\\s+' + NAME + ')?)\\s*$', 'u');
    for (const y of body.matchAll(/\(((?:1[5-9]|20)\d\d)([a-z]?)\b([^()]*)\)/g)) {
      const w0 = Math.max(0, y.index - 120), m = LEAD.exec(body.slice(w0, y.index));
      if (!m) continue;
      const s = w0 + m.index + m[1].length;
      out.push({ start: s, end: y.index + y[0].length, sur: surOf(m[2]), year: y[1], label: m[2] + ' (' + y[1] + y[2] + ')', paren: false, two: m[3], twoAt: s + m[2].length,
        before: body.slice(Math.max(0, s - 40), s) });
    }
    return out;
  }
  function citesOf(C) {
    if (!C._cites) { const R = C.refs[0]; C._cites = citations(R ? C.t.slice(0, R[0]) : C.t).filter(c => !NOT_NAME.test(c.sur) && C.typo(c.start)); }
    return C._cites;
  }
  const NOT_NAME = /^(?:see|in|on|at|by|for|from|the|this|that|these|those|between|since|until|after|before|during|around|about|circa|figure|fig|table|chapter|section|page|vol|volume|no|act|year|years|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|winter|and|but|or|as|if|when|while|although|also|however|thus|here|there|its|it|we|they|he|she|i|our|their|his|her)$/i;
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function citesVsRefs(text, opts) {
    const C = prep(text, opts), t = C.t, R = references(t, opts);
    if (!R || !R.entries.length) return [];
    const keys = new Set(R.entries.map(e => e.sur + ' ' + e.year));
    const surs = new Set(R.entries.map(e => e.sur));
    const bodyT = t.slice(0, R.at);
    const cites = citesOf(C);
    const out = [], seen = new Set();
    /* an entry that names the author and the year anywhere in its line also
       counts ("World Health Organization. 2019." for "World Health
       Organization (2019)") */
    const word = sur => new RegExp('(?:^|[^\\p{L}])' + reEsc(sur) + '(?![\\p{L}])', 'u');
    const inLine = (sur, year) => { const re = word(sur); return R.lines.some(l => l.ln.indexOf(year) >= 0 && re.test(fold(l.ln))); };
    for (const c of cites) {
      /* "Heidegger (1927/1962)", "Kant (1998 [1781])": either year */
      const years = (t.slice(c.start, c.paren ? c.restAt + c.rest.length : c.end).match(/\b(?:1[5-9]|20)\d\d\b/g) || [c.year]);
      if (seen.has(c.start) || years.some(y => keys.has(c.sur + ' ' + y) || inLine(c.sur, y))) continue;
      /* not a citation: a title before its year ("Phenomenology of
         Perception (1945)", "Heidegger’s Being and Time (1927)", "Ethics,
         Ageing, Politics (2019)"), "Dr. Kildare (1961)", a series "ER
         (1994)" */
      if (!c.paren && !surs.has(c.sur)) {
        if (/\S/.test(c.two || '') || /^[\p{Lu}\d]+$/u.test(c.label.replace(/\s*\(.*$/, ''))) continue;
        if (/(?:\b(?:of|the|a|an|and|in|on|for|to|from|with|at|by)|['’]s|[*_]|\b(?:Dr|Mr|Mrs|Ms|Prof|St)\.)\s*$/u.test(c.before)) continue;
        /* a capitalised word just before, unless it begins the sentence ("Similarly, Garrigós (2022)") */
        const w = /(\S*)\s+(\p{Lu}[\p{L}'’\-]*)[,:]?\s*$/u.exec(' ' + c.before);
        if (w && !/(?:^|[.!?:;"”)\]])$/.test(w[1])) continue;
      }
      seen.add(c.start);
      const k = c.sur + ' ' + c.year;
      out.push({ start: c.start, end: c.end, orig: t.slice(c.start, c.end), fix: null, fam: 'cite', cat: 'g',
        why: surs.has(c.sur) ? 'Citation and References disagree: your References list ' + c.label.replace(/\s*\(.*$/, '') + ', but not for ' + c.year + '. Check the year here or in the list.'
          : 'Citation with no entry in your References: ' + c.label + '. Add the entry, or check the spelling of the name.' });
    }
    /* entries cited nowhere: only in a list of works cited (a Bibliography
       may hold works consulted), only when the document cites by author and
       year, and only when the name and year are nowhere near each other in
       the text */
    const authorDate = cites.length >= 5 && !R.entries.some(e => e.numbered);
    if (authorDate && !/bibliography/i.test(R.head)) {
      const cited = new Set(cites.map(c => c.sur + ' ' + c.year));
      const share = R.entries.filter(e => cited.has(e.sur + ' ' + e.year)).length / R.entries.length;
      const folded = fold(bodyT);
      if (share >= 0.5) for (const e of R.entries) {
        if (cited.has(e.sur + ' ' + e.year)) continue;
        if (new RegExp('(?:^|[^\\p{L}])' + reEsc(e.sur) + '(?![\\p{L}])[^\\n]{0,80}?' + e.year, 'u').test(folded)) continue;
        out.push({ start: e.nameAt, end: e.nameAt + e.name.length, orig: e.name, fix: null, fam: 'cite', cat: 'c',
          why: 'In your References but not cited in the text: ' + e.name + ' (' + e.year + '). Cite it where it is used, or take it out of the list.' });
      }
    }
    return out;
  }
  /* the list in alphabetical order: the entries out of place are those not
     in the longest run that is in order */
  const PARTICLE = /^(?:de|van|von|du|da|del|della|di|la|le|ten|ter|al|el|bin|ibn)$/i;
  function sortKey(e) {
    const b = e.body.replace(/^\s*(?:the|a|an)\s+/i, '');
    const w = (b.match(/[\p{L}][\p{L}'’\-]*/u) || [''])[0];
    if (PARTICLE.test(w)) return null;
    return w.normalize('NFD').replace(/[\u0300-\u036f'’\-]/g, '').toLowerCase();
  }
  function refOrder(text, opts) {
    const R = references(text, opts);
    if (!R || R.entries.length < 4 || R.entries.some(e => e.numbered)) return [];
    const out = [];
    /* a heading or a line that is not an entry starts a new group */
    let group = [];
    const flush = () => {
      const g = group.filter(e => e.key);
      group = [];
      if (g.length < 3) return;
      /* longest non-decreasing run (patience sorting) */
      const cmp = (a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' });
      const tails = [], prev = new Array(g.length).fill(-1), tailIx = [];
      g.forEach((e, i) => {
        let lo = 0, hi = tails.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(tails[m], e) <= 0) lo = m + 1; else hi = m; }
        tails[lo] = e; tailIx[lo] = i; prev[i] = lo > 0 ? tailIx[lo - 1] : -1;
      });
      const keep = new Set();
      for (let i = tailIx[tails.length - 1]; i >= 0; i = prev[i]) keep.add(i);
      if (g.length - keep.size > g.length / 2) return;
      const inOrder = g.filter((e, i) => keep.has(i));
      g.forEach((e, i) => {
        if (keep.has(i)) return;
        const after = inOrder.filter(x => cmp(x, e) <= 0).pop(), before = inOrder.find(x => cmp(x, e) > 0);
        out.push({ start: e.nameAt, end: e.nameAt + e.name.length, orig: e.name, fix: null, fam: 'refs', cat: 'c',
          why: 'References out of alphabetical order: “' + e.name + '” belongs ' + (after ? 'after “' + after.name + '”' : 'before “' + before.name + '”') + ' in the list.' });
      });
    };
    for (const e of R.seq) {
      if (e.reset) { flush(); continue; }
      e.key = sortKey(e);
      group.push(e);
    }
    flush();
    return out;
  }
  /* the citations' small parts, each written one way */
  function citeForm(text, opts) {
    const C = prep(text, opts), t = C.t, R = C.refs[0];
    const cs = citesOf(C);
    const out = [];
    /* the comma between name and year: "(Smith, 2019)" or "(Smith 2019)" */
    const P = cs.filter(c => c.paren);
    const comma = { with: P.filter(c => /,/.test(c.sep)), without: P.filter(c => !/,/.test(c.sep)) };
    const mc = minority(comma, 6, 3);
    if (mc) for (const c of comma[mc.lose[0]]) out.push({ start: c.sepAt, end: c.sepAt + c.sep.length, orig: c.sep, fix: mc.win === 'with' ? ', ' : ' ', fam: 'citeform', cat: 'c',
      why: 'Citation consistency: most of your citations ' + (mc.win === 'with' ? 'put a comma between the name and the year, “(Smith, 2019)”' : 'have no comma between the name and the year, “(Smith 2019)”') + '; this one does not.' });
    /* the page: "p. 4", ": 4" or ", 4" */
    const pg = { p: [], colon: [], bare: [] };
    for (const c of P) {
      const m = /^(\s*(?:,\s*(pp?\.)\s*|:\s*|,\s*))(\d+(?:\s*[-–]\s*\d+)?)/.exec(c.rest || '');
      if (!m || (!m[2] && /^(?:1[5-9]|20)\d\d$/.test(m[3]))) continue;
      const kind = m[2] ? 'p' : /:/.test(m[1]) ? 'colon' : 'bare';
      pg[kind].push({ c, at: c.restAt, len: m[0].length, n: m[3], orig: m[0] });
    }
    const mp = minority(pg, 6, 3);
    if (mp) for (const k of mp.lose) for (const x of pg[k]) {
      const range = /[-–]/.test(x.n), n = x.n.replace(/\s*[-–]\s*/, '–');
      const fix = mp.win === 'p' ? ', ' + (range ? 'pp. ' : 'p. ') + n : mp.win === 'colon' ? ': ' + n : ', ' + n;
      out.push({ start: x.at, end: x.at + x.len, orig: x.orig, fix, fam: 'citeform', cat: 'c',
        why: 'Citation consistency: most of your page references read “' + (mp.win === 'p' ? '(Smith 2019, p. 4)' : mp.win === 'colon' ? '(Smith 2019: 4)' : '(Smith 2019, 4)') + '”; this one is written another way.' });
    }
    /* two authors: "&" or "and", inside brackets and outside them apart (APA
       puts "&" inside and "and" outside) */
    for (const inPar of [true, false]) {
      const two = cs.filter(c => c.paren === inPar && /(?:\band\b|&)/.test(c.two || ''));
      const g = { amp: two.filter(c => /&/.test(c.two)), and: two.filter(c => /\band\b/.test(c.two)) };
      const ma = minority(g, 4, 3);
      if (ma) for (const c of g[ma.lose[0]]) {
        const m = /&|\band\b/.exec(c.two);
        out.push({ start: c.twoAt + m.index, end: c.twoAt + m.index + m[0].length, orig: m[0], fix: ma.win === 'amp' ? '&' : 'and', fam: 'citeform', cat: 'c',
          why: 'Citation consistency: your ' + (inPar ? 'bracketed' : 'running') + ' citations of two authors mostly join them with “' + (ma.win === 'amp' ? '&' : 'and') + '”.' });
      }
    }
    return out;
  }

  /* a quotation of a sentence or more, cited with a year and no page */
  function quotePages(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    for (const q of t.matchAll(/[“"]([^“”"\n]{40,600})[”"]\s*(\(([^()]{3,120})\))/g)) {
      const inner = q[1], cite = q[3];
      if (!C.typo(q.index)) continue;
      if ((inner.match(/\S+/g) || []).length < 8) continue;
      if (!/\b(?:1[5-9]|20)\d\d[a-z]?\b/.test(cite)) continue;
      /* the page comes after the year: "(Gadamer, 1960, p. 271)", "(Gadamer 1960: 271)", "(Gadamer 1960, 271)" */
      const after = cite.replace(/^.*?\b(?:1[5-9]|20)\d\d[a-z]?\b/, '');
      if (/\b(?:pp?\.|page|para\.?|ch\.|chap\.|loc\.|at)\s*\d|:\s*\d|,\s*\d+/i.test(after)) continue;
      const s = q.index + q[0].length - q[2].length;
      out.push({ start: s, end: s + q[2].length, orig: q[2], fix: null, fam: 'quote', cat: 'g',
        why: 'A direct quotation needs its page: (' + cite.replace(/\s+$/, '') + ', p. …). Readers and examiners look the words up.' });
    }
    return out;
  }

  /* ---------- the same mark written two ways ---------- */
  const CAP = 300;
  function quoteMarks(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    /* double marks: straight or curly (an inch mark after a figure is not one) */
    const dq = { straight: [], curly: [] }, opens = new Map();
    /* whether each mark opens or closes: by the space before or after it,
       and between two letters (as"word) by whether a quotation is open */
    let inQ = false, line = -1;
    for (const m of t.matchAll(/["“”]/g)) {
      const at = m.index, nl = t.lastIndexOf('\n', at - 1);
      if (nl !== line) { line = nl; inQ = false; }
      const pre = at === 0 ? ' ' : t[at - 1], post = t[at + 1] || ' ';
      const open = m[0] === '“' ? true : m[0] === '”' ? false : /[\s(\[{—–\-\/]/.test(pre) ? true : /[\s.,;:!?)\]}\d—–]/.test(post) ? false : !inQ;
      inQ = open;
      opens.set(at, open);
      if (!C.typo(at)) continue;
      if (m[0] === '"' && /\d/.test(pre)) continue;
      dq[m[0] === '"' ? 'straight' : 'curly'].push(at);
    }
    const md = minority(dq, 6, 2);
    if (md) for (const at of dq[md.lose[0]].slice(0, CAP)) {
      const fix = md.win === 'curly' ? (opens.get(at) ? '“' : '”') : '"';
      out.push({ start: at, end: at + 1, orig: t[at], fix, fam: 'quotes', cat: 'c',
        why: 'Quotation marks: this document mostly uses ' + (md.win === 'curly' ? 'curly marks (“ ”)' : 'straight marks (")') + '; this one is ' + (md.win === 'curly' ? 'straight' : 'curly') + '.' });
    }
    /* apostrophes inside a word: "it's" or "it’s" */
    const ap = { straight: [], curly: [] };
    const LT = /\p{L}/u;
    for (const m of t.matchAll(/['’]/g)) {
      const at = m.index;
      if (!LT.test(t[at - 1] || '') || !LT.test(t[at + 1] || '') || !C.typo(at)) continue;
      ap[m[0] === "'" ? 'straight' : 'curly'].push(at);
    }
    const ma = minority(ap, 6, 2);
    if (ma) for (const at of ap[ma.lose[0]].slice(0, CAP)) out.push({ start: at, end: at + 1, orig: t[at], fix: ma.win === 'curly' ? '’' : "'", fam: 'quotes', cat: 'c',
      why: 'Apostrophes: this document mostly uses the ' + (ma.win === 'curly' ? 'curly apostrophe (’)' : 'straight apostrophe (\')') + '; this one is ' + (ma.win === 'curly' ? 'straight' : 'curly') + '.' });
    return out;
  }
  function perCent(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    const notTable = x => !/^\s*\|/.test(C.line(x));
    const w = { 'per cent': [], percent: [] };
    for (const m of t.matchAll(/\b(per cent|percent)\b/gi)) if (C.prose(m.index) && notTable(m.index)) w[m[1].toLowerCase()].push(m);
    const mw = minority(w, 3, 2);
    if (mw) for (const m of w[mw.lose[0]].slice(0, CAP)) out.push({ start: m.index, end: m.index + m[0].length, orig: m[0], fix: m[0][0] === 'P' ? cap1(mw.win) : mw.win, fam: 'percent', cat: 'c',
      why: 'Consistency: this document mostly writes “' + mw.win + '”' + (mw.win === 'per cent' ? ' (British usage)' : ' (US usage)') + '; use one throughout.' });
    /* "45%" beside "45 per cent" in the running text */
    const word = mw ? mw.win : (w['per cent'].length >= w.percent.length ? 'per cent' : 'percent');
    const s = { sign: [], words: [] };
    for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)(\s?%|\s+(?:per cent|percent)\b)/gi)) if (C.prose(m.index) && notTable(m.index)) s[/%/.test(m[2]) ? 'sign' : 'words'].push(m);
    const ms = minority(s, 4, 3);
    if (ms) for (const m of s[ms.lose[0]].slice(0, CAP)) out.push({ start: m.index, end: m.index + m[0].length, orig: m[0], fix: m[1] + (ms.win === 'sign' ? '%' : ' ' + word), fam: 'percent', cat: 'c',
      why: 'Consistency: in the running text this document mostly writes ' + (ms.win === 'sign' ? '“45%”' : '“45 ' + word + '”') + '.' });
    return out;
  }
  function ellipses(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    const g = { '…': [], '...': [], '. . .': [] };
    for (const m of t.matchAll(/(^|[^.])(…|\.\s\.\s\.(?!\s\.)|\.\.\.(?!\.))/g)) {
      const at = m.index + m[1].length;
      if (C.typo(at)) g[m[2] === '…' ? '…' : m[2] === '...' ? '...' : '. . .'].push({ index: at, 0: m[2] });
    }
    const mg = minority(g, 3, 2);
    if (mg) for (const k of mg.lose) for (const m of g[k].slice(0, CAP)) out.push({ start: m.index, end: m.index + m[0].length, orig: m[0], fix: mg.win, fam: 'ellipsis', cat: 'c',
      why: 'Ellipses: this document mostly writes them as “' + mg.win + '”; this one is “' + m[0] + '”.' });
    return out;
  }
  function dashes(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    /* a dash between words (a range of figures, "1990–2000", is not one) */
    const g = { '—': [], ' — ': [], ' – ': [], ' -- ': [], ' - ': [] };
    const L = /\p{L}/u, P = /[,.;:!?’”"')\]]/, N = /[\p{L}‘“"'(\[]/u;
    for (const m of t.matchAll(/ — | – | -- | - |—|--/g)) {
      const at = m.index, s = m[0];
      /* a letter before (perhaps then a closing mark), and a word after */
      let b = t[at - 1] || '';
      if (P.test(b)) b = t[at - 2] || '';
      if (!L.test(b) || !N.test(t[at + s.length] || '')) continue;
      if (!C.typo(at) || /^\s*(?:#|\|)/.test(C.line(at))) continue;
      g[s === '--' ? ' -- ' : s].push({ at, s });
    }
    const shape = w => w === '—' ? 'word—word' : 'word ' + w.trim() + ' word';
    const real = { '—': g['—'], ' — ': g[' — '], ' – ': g[' – '] };
    const mg = minority(real, 4, 3);
    if (mg) for (const k of mg.lose) for (const x of g[k].slice(0, CAP)) out.push({ start: x.at, end: x.at + x.s.length, orig: x.s, fix: mg.win, fam: 'dash', cat: 'c',
      why: 'Dashes: this document mostly sets a dash between words as “' + shape(mg.win) + '”; this one is “' + shape(k) + '”.' });
    /* "word - word" or "word -- word" typed for a dash, in a document that
       otherwise sets real ones */
    const nReal = real['—'].length + real[' — '].length + real[' – '].length;
    const win = Object.keys(real).sort((a, b) => real[b].length - real[a].length)[0];
    const hy = g[' - '].concat(g[' -- ']);
    if (nReal >= 3 && nReal >= 2 * hy.length && (!mg || mg.win === win)) for (const x of hy.slice(0, CAP)) out.push({ start: x.at, end: x.at + x.s.length, orig: x.s, fix: win, fam: 'dash', cat: 'c',
      why: 'Dashes: a hyphen typed for a dash; this document sets its dashes as “' + shape(win) + '”.' });
    return out;
  }
  function egComma(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    const g = { comma: [], none: [] };
    for (const m of t.matchAll(/\b(e\.g\.|i\.e\.)(,?)(?=\s)/g)) {
      if (!C.prose(m.index)) continue;
      g[m[2] ? 'comma' : 'none'].push(m);
    }
    const mg = minority(g, 4, 3);
    if (mg) for (const m of g[mg.lose[0]].slice(0, CAP)) {
      const s = m.index + m[1].length;
      out.push(mg.win === 'comma' ? { start: m.index, end: s, orig: m[1], fix: m[1] + ',', fam: 'eg', cat: 'c', why: 'Consistency: this document mostly writes “e.g.,” and “i.e.,” with a comma after them.' }
        : { start: m.index, end: s + 1, orig: m[1] + ',', fix: m[1], fam: 'eg', cat: 'c', why: 'Consistency: this document mostly writes “e.g.” and “i.e.” with no comma after them.' });
    }
    return out;
  }

  /* ---------- numbers: headings, figures, tables, chapters ---------- */
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
  const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  function chapNum(w) {
    if (/^\d+$/.test(w)) return +w;
    const l = w.toLowerCase();
    if (WORDNUM[l]) return WORDNUM[l];
    if (/^[IVXLC]+$/.test(w)) { let n = 0; for (let i = 0; i < w.length; i++) { const a = ROMAN[w[i]], b = ROMAN[w[i + 1]] || 0; n += a < b ? -a : a; } return n; }
    return null;
  }
  function numbering(text, opts) {
    const C = prep(text, opts), t = C.t, out = [];
    /* numbered headings: "## 2.1 Method" follows "## 2 Background"; a
       heading "Chapter 3" counts as 3. A year ("# 1984 and After") is not a
       number of the document's, and an unnumbered heading above the numbered
       ones ("# Literature" before "## 2.1") may start the count again. */
    const nums = [];
    let crossed = false, lastLevel = 7;
    for (const h of C.H) {
      let m = /^(\d{1,2}(?:\.\d{1,2})*)\.?(?=\s+\S)/.exec(h.text), n = null, at, len;
      if (m) { n = m[1].split('.').map(Number); at = t.indexOf(m[1], h.at + h.level); len = m[1].length; }
      else if ((m = /^chapter\s+(\d+|[A-Za-z]+)\b/i.exec(h.text)) && chapNum(m[1]) !== null) { n = [chapNum(m[1])]; at = t.indexOf(m[0], h.at); len = m[0].length; }
      if (!n) { if (h.level < lastLevel) crossed = true; continue; }
      nums.push({ n, at, len, crossed, level: h.level });
      crossed = false; lastLevel = h.level;
    }
    if (nums.length >= 3) for (let i = 1; i < nums.length; i++) {
      const x = nums[i], n = x.n, p = nums[i - 1].n, d = n.length;
      if (x.crossed) continue;
      let ok, want;
      if (d === p.length + 1) { ok = n.slice(0, -1).join('.') === p.join('.') && n[d - 1] === 1; want = p.join('.') + '.1'; }
      else if (d <= p.length) { ok = n.slice(0, -1).join('.') === p.slice(0, d - 1).join('.') && n[d - 1] === p[d - 1] + 1; want = p.slice(0, d - 1).concat(p[d - 1] + 1).join('.'); }
      else { ok = false; want = p.join('.') + '.1'; }
      if (!ok) out.push({ start: x.at, end: x.at + x.len, orig: t.slice(x.at, x.at + x.len), fix: null, fam: 'number', cat: 'g',
        why: 'Heading numbers: after ' + p.join('.') + ' the next heading at this level would be ' + want + '; this one is ' + n.join('.') + '.' });
    }
    /* captions: a line that begins "Figure 3." or "Table 2.1:", or a line
       that is only "**Figure 1**" (APA sets the title on the next line) */
    for (const [kind, re] of [['Figure', /^(\s*(?:\*\*|\*|_|!\[)?\s*)(Figure|Fig\.)\s+(\d+(?:\.\d+)?)\s*(?:[.:—–\-\]]|\*\*|\*|_|$)/gim], ['Table', /^(\s*(?:\*\*|\*|_)?\s*)(Table)\s+(\d+(?:\.\d+)?)\s*(?:[.:—–\-]|\*\*|\*|_|$)/gim]]) {
      const caps = [];
      for (const m of t.matchAll(re)) if (C.typo(m.index)) caps.push({ at: m.index + m[1].length, n: m[3], len: m[2].length + 1 + m[3].length, word: m[2] });
      if (!caps.length) continue;
      const have = new Set(caps.map(c => c.n));
      /* in order: 1, 2, 3; or by chapter: 2.1, 2.2, 3.1 */
      let last = null;
      const seen = new Set();
      for (const c of caps) {
        const p = c.n.split('.').map(Number);
        let ok;
        if (seen.has(c.n)) ok = false;
        else if (!last) ok = p[p.length - 1] === 1;
        else if (p.length === 2 && last.length === 2) ok = (p[0] === last[0] && p[1] === last[1] + 1) || (p[0] > last[0] && p[1] === 1);
        else ok = p.length === last.length && p[0] === last[0] + 1;
        if (!ok) out.push({ start: c.at, end: c.at + c.len, orig: t.slice(c.at, c.at + c.len), fix: null, fam: 'number', cat: 'g',
          why: seen.has(c.n) ? kind + ' numbers out of sequence: ' + kind + ' ' + c.n + ' is numbered twice; each ' + kind.toLowerCase() + ' takes its own number.'
            : kind + ' numbers out of sequence: ' + (last ? kind + ' ' + c.n + ' follows ' + kind + ' ' + last.join('.') : 'the first ' + kind.toLowerCase() + ' is ' + kind + ' ' + c.n) + '.' });
        seen.add(c.n); last = p;
      }
      /* "see Figure 5" when the figures end at Figure 4 (within a chapter's
         own numbers, "Figure 2.5" when chapter 2's end at 2.4); a number
         inside the run that has no caption is left to the check above */
      const capAt = new Set(caps.map(c => c.at)), top = new Map();
      for (const c of caps) { const p = c.n.split('.'), k = p.length > 1 ? p[0] : ''; top.set(k, Math.max(top.get(k) || 0, +p[p.length - 1])); }
      const beyond = n => { const p = n.split('.'), k = p.length > 1 ? p[0] : ''; return top.has(k) && +p[p.length - 1] > top.get(k); };
      const refRe = kind === 'Figure' ? /\b(Figures?|Figs?\.|figures?)\s+(\d+(?:\.\d+)?)((?:\s*(?:,|and|&|[-–]|to)\s*\d+(?:\.\d+)?)*)/g : /\b(Tables?|tables?)\s+(\d+(?:\.\d+)?)((?:\s*(?:,|and|&|[-–]|to)\s*\d+(?:\.\d+)?)*)/g;
      for (const m of t.matchAll(refRe)) {
        if (capAt.has(m.index) || !C.prose(m.index)) continue;
        const ns = [m[2]].concat((m[3] || '').match(/\d+(?:\.\d+)?/g) || []);
        const miss = ns.filter(n => !have.has(n) && beyond(n));
        if (!miss.length) continue;
        const list = caps.map(c => c.n);
        out.push({ start: m.index, end: m.index + m[0].length, orig: m[0], fix: null, fam: 'number', cat: 'g',
          why: 'No ' + kind + ' ' + miss[0] + ' in this document: its ' + kind.toLowerCase() + 's are ' + (list.length > 6 ? list.slice(0, 3).join(', ') + ' … ' + list[list.length - 1] : list.join(', ')) + '.' });
      }
    }
    /* "see Chapter 7" when the chapters are headed "Chapter 1" to "Chapter 6" */
    const chs = new Set();
    for (const h of C.H) { const m = /^chapter\s+(\d+|[A-Za-z]+)\b/i.exec(h.text); if (m && chapNum(m[1]) !== null) chs.add(chapNum(m[1])); }
    const lastCh = Math.max.apply(null, Array.from(chs).concat(0));
    if (chs.size >= 2) for (const m of t.matchAll(/\b([Cc]hapters?)\s+(\d+|[A-Za-z]+)\b/g)) {
      if (!C.prose(m.index) || /^\s*#/.test(C.line(m.index))) continue;
      const n = /^[IVXLC]+$/.test(m[2]) || /^\d+$/.test(m[2]) || WORDNUM[m[2].toLowerCase()] ? chapNum(m[2]) : null;
      if (n === null || n <= lastCh) continue;
      const pre = t.slice(Math.max(0, m.index - 24), m.index), post = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
      /* only where the document points to itself ("see Chapter 7", "(Chapter
         7)", "Chapter 7 below"): a thesis on a book discusses the book's own
         chapters ("in Chapter 24 about The Unicorn Tapestries") */
      if (!(/(?:\b(?:see|cf\.)|\()\s*$/i.test(pre) || /^\s*(?:below|above|of this (?:thesis|dissertation|study|book|work))\b/i.test(post))) continue;
      out.push({ start: m.index, end: m.index + m[0].length, orig: m[0], fix: null, fam: 'number', cat: 'g',
        why: 'No Chapter ' + n + ' in this document: its chapters end at Chapter ' + lastCh + '.' });
    }
    /* "Figure 2" beside "figure 2": the words that point to a part, in one case */
    for (const w of ['figure', 'table', 'chapter', 'section', 'appendix']) {
      const g = { up: [], low: [] };
      for (const m of t.matchAll(new RegExp('\\b(' + w + '|' + cap1(w) + ')(s?)\\s+(\\d+|[A-Z])\\b', 'g'))) {
        if (!C.prose(m.index) || /^\s*(?:#+|\*\*|\*|_|!\[)?\s*$/.test(t.slice(t.lastIndexOf('\n', m.index - 1) + 1, m.index))) continue;
        if (/^\s+of\b/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 5))) continue;
        /* at the start of a sentence a capital is needed anyway */
        if (/(?:^|[.!?:]\s+|\(\s*)$/.test(t.slice(Math.max(0, m.index - 4), m.index)) || /\n\s*$/.test(t.slice(Math.max(0, m.index - 3), m.index))) continue;
        g[m[1][0] === m[1][0].toUpperCase() ? 'up' : 'low'].push(m);
      }
      const mg = minority(g, 4, 3);
      if (mg) for (const m of g[mg.lose[0]].slice(0, CAP)) out.push({ start: m.index, end: m.index + m[1].length, orig: m[1], fix: mg.win === 'up' ? cap1(w) : w, fam: 'number', cat: 'c',
        why: 'Consistency: this document mostly writes “' + (mg.win === 'up' ? cap1(w) : w) + ' 2” when it points to a part of itself.' });
    }
    return out;
  }

  /* checks for a register: casual writing gets none; creative writing only
     the typographic ones */
  const TYPO = [quoteMarks, ellipses, dashes];
  const ALL = [izeIse, abbreviations, citesVsRefs, refOrder, citeForm, quotePages, quoteMarks, perCent, ellipses, dashes, egComma, numbering];
  function all(text, opts) {
    const o = Object.assign({}, opts || {});
    if (o.reg === 'casual') return [];
    const fns = o.reg === 'creative' ? TYPO : ALL;
    prep(text, o);
    let out = [];
    fns.forEach((f, i) => { try { for (const n of f(text, o)) { n._f = i; out.push(n); } } catch (e) { if (o.onError) o.onError(f.name, e); } });
    /* one note to a place: the first check listed wins */
    out.sort((a, b) => a.start - b.start || a._f - b._f);
    const kept = [];
    for (const n of out) { const l = kept[kept.length - 1]; if (l && n.start < l.end) continue; delete n._f; kept.push(n); }
    return kept;
  }

  /* what each kind of note teaches: [principle, example] */
  const LESSONS = {
    'Consistency: this document spells these words both with -ise and with -ize': ['British English allows both -ise and -ize (the -ize form is Oxford spelling, used by Oxford University Press); US English uses -ize. Choose one and keep to it. "Analyse" and "paralyse" keep -yse even in Oxford spelling.', '"organise … recognize" → "organise … recognise"'],
    'US English spells this with -ize': ['US English writes -ize in words such as organize, recognize and realize. Words such as advertise, exercise and surprise keep -ise in every English.', '"organise" → "organize"'],
    'Abbreviation used before it is spelled out': ['An abbreviation is spelled out at its first use, with the short form in brackets, and used alone after that. In a thesis, the abstract and each chapter often spell it out again.', '"WHO data" … "World Health Organization (WHO)" → spell it out at the first "WHO"'],
    'Abbreviation never used again': ['An abbreviation earns its place when the reader meets it again. One defined and never used is one more thing to remember.', '"the World Health Organization (WHO) reported" → "the World Health Organization reported"'],
    'Abbreviation spelled out twice': ['Once an abbreviation is defined, the short form alone does the work for the rest of the chapter.', '"…(WHO)… the World Health Organization (WHO)" → "…(WHO)… the WHO"'],
    'Citation with no entry in your References': ['Every work cited in the text has an entry in the reference list, and every entry is cited. Examiners check this pairing.', '"(Taylor, 2004)" → add "Taylor, C. (2004). Modern Social Imaginaries…" to the list'],
    'Citation and References disagree': ['The year in the citation and the year in the list must match, letter included ("2019a").', '"(Smith, 2018)" with "Smith, J. (2019)" in the list → correct one of them'],
    'In your References but not cited in the text': ['A list headed References holds only the works cited. Works read but not cited belong in a Bibliography, where the style allows one.', 'Cite "Jones (2020)" where it is used, or remove the entry'],
    'References out of alphabetical order': ['An author-date list runs alphabetically by the first author\'s surname, and then by year for one author\'s works.', '"Zahavi … Arendt" → "Arendt … Zahavi"'],
    'Citation consistency': ['A citation style fixes the small marks too: the comma between name and year, how a page is given, "&" or "and". Keep each one way throughout.', 'APA: "(Smith, 2019, p. 4)" · Chicago author-date: "(Smith 2019, 4)"'],
    'A direct quotation needs its page': ['A direct quotation carries its page (or paragraph, for a source without pages), so the reader can find the words.', '"…" (Gadamer, 1960) → "…" (Gadamer, 1960, p. 271)'],
    'Quotation marks': ['Quotation marks are either all curly (“ ”) or all straight ("). Mixed marks usually come from pasting text in.', '"word" beside “word” → “word”'],
    'Apostrophes': ['The apostrophe is one mark throughout: curly (’) in typeset text, or straight (\') everywhere.', 'it\'s beside it’s → it’s'],
    'Consistency: this document mostly writes “per cent”': ['British usage writes "per cent", US usage "percent"; the symbol % suits figures in technical writing and tables. Keep one form in the running text.', '"percent" beside "per cent" → "per cent"'],
    'Consistency: this document mostly writes “percent”': ['British usage writes "per cent", US usage "percent"; the symbol % suits figures in technical writing and tables. Keep one form in the running text.', '"per cent" beside "percent" → "percent"'],
    'Consistency: in the running text this document mostly writes': ['Keep one way of writing percentages in the running text: "45 per cent" or "45%". Tables may use the symbol.', '"45%" beside "45 per cent" → one form'],
    'Ellipses': ['An ellipsis is written one way throughout: the single character (…), three full stops (...), or spaced stops (. . .) as Chicago prefers.', '"..." beside "…" → "…"'],
    'Dashes': ['A dash between words is set one way throughout: a closed em dash (word—word, Chicago and US use) or a spaced en dash (word – word, common in British use).', '"word - word" beside "word—word" → "word—word"'],
    'Consistency: this document mostly writes “e.g.,”': ['"e.g." and "i.e." are followed by a comma in US style and usually not in British style. Choose one and keep to it.', '"e.g. Smith" beside "e.g., Jones" → one form'],
    'Consistency: this document mostly writes “e.g.”': ['"e.g." and "i.e." are followed by a comma in US style and usually not in British style. Choose one and keep to it.', '"e.g., Smith" beside "e.g. Jones" → one form'],
    'Heading numbers': ['Numbered headings run in order at each level: 2, 2.1, 2.2, 3. A skipped or repeated number sends the reader looking for a section that is not there.', '"2.1 … 2.3" → "2.1 … 2.2"'],
    'Figure numbers out of sequence': ['Figures are numbered in the order they appear, through the document or chapter by chapter (2.1, 2.2, 3.1).', '"Figure 1 … Figure 3" → "Figure 1 … Figure 2"'],
    'Table numbers out of sequence': ['Tables are numbered in the order they appear, through the document or chapter by chapter (2.1, 2.2, 3.1).', '"Table 1 … Table 3" → "Table 1 … Table 2"'],
    'No Figure': ['A reference to a figure points to one the document holds. After figures are added, moved or removed, the references need checking.', '"see Figure 5" with four figures → the right number'],
    'No Table': ['A reference to a table points to one the document holds. After tables are added, moved or removed, the references need checking.', '"see Table 4" with three tables → the right number'],
    'No Chapter': ['A reference to a chapter points to one the document holds.', '"see Chapter 7" in a thesis of six chapters → the right chapter'],
    'Consistency: this document mostly writes “': ['Words that point to a part of the document (Figure 2, Table 1, Chapter 3) are capitalised, or not, one way throughout. Chicago lowercases them in running text; APA capitalises them.', '"figure 2" beside "Figure 3" → one form']
  };

  const api = { izeIse, abbreviations, references, citations, citesVsRefs, refOrder, citeForm, quotePages, quoteMarks, perCent, ellipses, dashes, egComma, numbering, all, prep, LESSONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKDPHIL = api;
})(typeof self !== 'undefined' ? self : this);
