/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.44: the checks a doctoral editor makes on a whole document (INKDPHIL),
   offline. Each returns notes {start, end, orig, fix, why}; the page adds
   them to the rules' notes.

   Measured on 40 published philosophy and ethics articles and a thesis
   sample (none kept here): -ise and -ize mixed in one document in 10 of
   41; an abbreviation used before it is spelled out in 9 of 41. Mixed
   hyphenation ("decision-making" beside "decision making") was in 29, but
   most of it is correct (the hyphen joins a compound before a noun), so
   that check is not made.

   - izeIse: -ise and -ize in one document. Both are British English (-ize
     is Oxford spelling); US English takes -ize. The fewer are marked.
   - abbreviations: used before the place that spells them out.
   - citations: an in-text citation with no entry in the References, a
     citation in a group "(Gadamer, 1960; Svenaeus, 2000)" included, and
     "2019a" matched to "2019".
   - quotations: a direct quotation of a sentence or more, followed by an
     author-year citation with no page. */
(function (root) {
  'use strict';

  /* stems that take -ise or -ize, for when no dictionary is loaded; with a
     dictionary, any stem whose two forms are both words */
  const STEMS = new Set(('organ real recogn apolog special emphas minim maxim util character categor priorit conceptual marginal normal ' +
    'legitim critic summar standard general visual author central global industrial modern mobil optim synthes theor stabil legal ' +
    'capital civil colon democrat formal hospital human ideal immun internal individual institutional rational political romantic ' +
    'social symbol sympath vocal agon antagon apostroph capsul catal dramat econom energ familiar fertil final harmon hypothes ' +
    'jeopard memor mesmer moral natural neutral ostrac pasteur patron penal polar popular public radical random scrutin sensit ' +
    'stigmat subsid terror tantal trivial unional urban vandal victim westernal crystall commercial contextual operational ' +
    'problemat secular sexual material medical mechan monopol homogen hierarch personal plural professional prophes').split(' '));
  const IZE = /\b([A-Za-z]{3,}?)(is|iz)(e|es|ed|ing|ation|ations|er|ers)\b/g;
  const NOT_STEM = /^(?:adv|compr|comprom|dev|desp|disgu|enterpr|exerc|franch|impr|improv|merchand|prem|prec|rev|superv|surpr|telev|wh|w|s|pr|se|ma|po|ra|ar|ch|vo|dem|exc|exp|inc|conc|circumc|paral|anal)$/i;
  function izeIse(text, opts) {
    const t = String(text || ''), o = opts || {}, known = o.known;
    const alt = (stem, f) => {
      const s = stem.toLowerCase();
      if (NOT_STEM.test(s)) return false;
      if (known) return known(s + 'ise') && known(s + 'ize');
      return STEMS.has(s);
    };
    const hits = [];
    let m;
    IZE.lastIndex = 0;
    while ((m = IZE.exec(t))) if (alt(m[1], m[2])) hits.push({ start: m.index, end: m.index + m[0].length, word: m[0], z: m[2].toLowerCase() === 'iz', stem: m[1], tail: m[3] });
    const nz = hits.filter(h => h.z).length, ns = hits.length - nz;
    const out = [];
    if (o.dialect === 'us') {
      /* US English spells these -ize; each -ise form is marked */
      hits.filter(h => !h.z).forEach(h => out.push(note(h, 'z', 'US English spells this with -ize.')));
      return out;
    }
    if (!nz || !ns || hits.length < 3) return out;
    const want = nz >= ns ? 'z' : 's';
    const ex = want === 'z' ? hits.find(h => h.z).word : hits.find(h => !h.z).word;
    hits.filter(h => (h.z ? 'z' : 's') !== want).forEach(h => out.push(note(h, want,
      'Consistency: this document spells these words both with -ise and with -ize (here “' + h.word + '”, elsewhere “' + ex + '”). Both are correct British English, -ize being Oxford spelling; use one throughout.')));
    return out;
  }
  function note(h, want, why) {
    const letter = want === 'z' ? (/[A-Z]/.test(h.word.slice(h.stem.length, h.stem.length + 2)) ? 'IZ' : 'iz') : (/[A-Z]/.test(h.word.slice(h.stem.length, h.stem.length + 2)) ? 'IS' : 'is');
    return { start: h.start, end: h.end, orig: h.word, fix: h.stem + letter + h.tail, why, fam: 'ize' };
  }

  /* abbreviations everyone knows, which need no spelling out */
  const KNOWN_ABBR = new Set('UK US USA EU UN NHS BBC DNA RNA HIV AIDS CEO GDP PHD DPHIL MA BA MSC BSC PDF URL IT TV OK AM PM BCE CE AD BC NATO UNESCO OECD UNICEF COVID USSR NASA FBI CIA MP MPS ICU GP ID IQ CV'.split(' '));
  function abbreviations(text) {
    const t = String(text || ''), out = [], seen = new Set();
    for (const d of t.matchAll(/\(([A-Z][A-Z0-9&]{1,6})s?\)/g)) {
      const ab = d[1];
      if (seen.has(ab) || KNOWN_ABBR.has(ab.toUpperCase())) continue;
      seen.add(ab);
      /* the words just before the brackets should be what it stands for */
      const before = t.slice(Math.max(0, d.index - 120), d.index);
      const words = before.match(/[A-Za-z][\w'’-]*/g) || [];
      if (words.length < 2) continue;
      const re = new RegExp('\\b' + ab.replace(/&/g, '\\&') + 's?\\b', 'g');
      let m; re.lastIndex = 0;
      while ((m = re.exec(t)) && m.index < d.index) {
        /* a heading or a reference line does not count */
        const line = t.slice(t.lastIndexOf('\n', m.index) + 1, t.indexOf('\n', m.index) < 0 ? t.length : t.indexOf('\n', m.index));
        if (/^\s*#/.test(line)) continue;
        out.push({ start: m.index, end: m.index + m[0].length, orig: m[0], fix: null, fam: 'abbr',
          why: 'Abbreviation used before it is spelled out: “' + ab + '” is defined only later (“' + words.slice(-Math.min(6, words.length)).join(' ') + ' (' + ab + ')”). Spell it out at its first use.' });
        break;
      }
    }
    return out;
  }

  /* the References section and its entries: first surname and year */
  const HEAD = /^\s*(?:#{1,6}\s*)?(references|bibliography|works cited|reference list)\s*$/im;
  function references(text) {
    const t = String(text || ''), h = HEAD.exec(t);
    if (!h) return null;
    const entries = [];
    let off = h.index + h[0].length;
    for (const ln of t.slice(off).split('\n')) {
      const at = off; off += ln.length + 1;
      if (/^\s*#/.test(ln)) break;
      const m = /([A-Z][A-Za-z'’\-]+)[^\n]{0,120}?\b((?:1[5-9]|20)\d\d)[a-z]?\b/.exec(ln);
      if (m) entries.push({ sur: m[1].toLowerCase(), year: m[2], at: at });
    }
    return { at: h.index, entries };
  }
  /* in-text author-year citations, each name and year with its place */
  function citations(body) {
    const out = [], NAME = "[A-Z][A-Za-z'’\\-]+(?:\\s+(?:van|von|de|da|del|du|la|le)\\s+[A-Z][A-Za-z'’\\-]+)?";
    /* "(Gadamer, 1960; Svenaeus, 2000, p. 4)" and "(Smith and Jones 2019)" */
    for (const g of body.matchAll(/\(([^()]{4,240})\)/g)) {
      let off = g.index + 1;
      for (const part of g[1].split(';')) {
        const m = new RegExp('^\\s*(?:(?:see|cf\\.|e\\.g\\.,?|i\\.e\\.,?)\\s+)?(' + NAME + ')(?:\\s+et al\\.|,?\\s+(?:and|&)\\s+' + NAME + ')?,?\\s+((?:1[5-9]|20)\\d\\d)([a-z]?)\\b').exec(part);
        if (m) out.push({ start: off + part.indexOf(m[1]), end: off + part.indexOf(m[2]) + m[2].length + m[3].length, sur: m[1].split(/\s+/).pop().toLowerCase(), year: m[2], label: m[1] + ' (' + m[2] + m[3] + ')' });
        off += part.length + 1;
      }
    }
    /* "Smith (2019)", "Smith et al. (2019)", "Smith and Jones (2019)" */
    for (const m of body.matchAll(new RegExp('\\b(' + NAME + ')(?:\\s+et al\\.|,?\\s+(?:and|&)\\s+' + NAME + ')?\\s*\\(((?:1[5-9]|20)\\d\\d)([a-z]?)[^)]*\\)', 'g')))
      out.push({ start: m.index, end: m.index + m[0].length, sur: m[1].split(/\s+/).pop().toLowerCase(), year: m[2], label: m[1] + ' (' + m[2] + m[3] + ')' });
    return out;
  }
  const NOT_NAME = /^(?:see|in|on|at|by|for|from|the|this|that|these|those|between|since|until|after|before|during|around|about|circa|from|figure|fig|table|chapter|section|page|vol|volume|no|act|year|years|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|winter)$/i;
  function citesVsRefs(text) {
    const t = String(text || ''), R = references(t);
    if (!R || !R.entries.length) return [];
    const keys = new Set(R.entries.map(e => e.sur + ' ' + e.year));
    const surs = new Set(R.entries.map(e => e.sur));
    const out = [], seen = new Set();
    for (const c of citations(t.slice(0, R.at))) {
      if (NOT_NAME.test(c.sur)) continue;
      const k = c.sur + ' ' + c.year;
      if (keys.has(k) || seen.has(c.start)) continue;
      seen.add(c.start);
      out.push({ start: c.start, end: c.end, orig: t.slice(c.start, c.end), fix: null, fam: 'cite',
        why: surs.has(c.sur) ? 'Citation and References disagree: your References list ' + c.label.replace(/\s*\(.*$/, '') + ', but not for ' + c.year + '. Check the year here or in the list.'
          : 'Citation with no entry in your References: ' + c.label + '. Add the entry, or check the spelling of the name.' });
    }
    return out;
  }

  /* a quotation of a sentence or more, cited with a year and no page */
  function quotePages(text) {
    const t = String(text || ''), out = [];
    for (const q of t.matchAll(/[“"]([^”"\n]{40,600})[”"]\s*(\(([^()]{3,120})\))/g)) {
      const inner = q[1], cite = q[3];
      if ((inner.match(/\S+/g) || []).length < 8) continue;
      if (!/\b(?:1[5-9]|20)\d\d[a-z]?\b/.test(cite)) continue;
      if (/\b(?:pp?\.|page|para\.?|ch\.|chap\.|loc\.|at)\s*\d|:\s*\d|,\s*\d+\s*[-–]?\s*\d*\s*$/i.test(cite)) continue;
      const s = q.index + q[0].length - q[2].length;
      out.push({ start: s, end: s + q[2].length, orig: q[2], fix: null, fam: 'quote',
        why: 'A direct quotation needs its page: (' + cite.replace(/\s+$/, '') + ', p. …). Readers and examiners look the words up.' });
    }
    return out;
  }

  function all(text, opts) {
    return [].concat(izeIse(text, opts), abbreviations(text), citesVsRefs(text), quotePages(text)).sort((a, b) => a.start - b.start);
  }

  const api = { izeIse, abbreviations, references, citations, citesVsRefs, quotePages, all };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKDPHIL = api;
})(typeof self !== 'undefined' ? self : this);
