/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.43: every change in a rewrite, explained and chosen one at a time
   (INKEXPLAIN). A version of the writer's passage, from the rules or from
   a writing model, is read as a list of changes: what was there, what is
   there now, why, and other ways to say it. The writer keeps a change,
   keeps their own words instead, or picks an alternative; the version is
   put together again from those choices.

   The changes are the word-level differences (GECFILTER's diff). A rule's
   change can touch several places ("There are many students who struggle"
   becomes "Many students struggle": two places, one change), so places
   that one rule made are one change, kept or refused together. For a
   model's version there is no record of why; the rules are run on the
   writer's text, and a change the model made that a rule also makes gets
   that rule's reason. Any other change is called what it is (taken out,
   added, reworded) and the writer is asked to check it. */
(function (root) {
  'use strict';
  const req = n => { try { return require(n); } catch (e) { return null; } };
  const GF = () => root.GECFILTER || req('./gec_filter.js');
  const RW = () => root.INKRW || req('./rewrite_core.js');
  const norm = s => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const toks = s => norm(s).match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
  function overlap(a, b) { const A = toks(a), B = new Set(toks(b)); return A.length ? A.filter(w => B.has(w)).length / A.length : 0; }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* the places a rule's "from" stands in the writer's text; when earlier
     rules changed it first ("It's" before "It is clear that"), the longest
     run of its words that is there */
  function locate(text, from) {
    const T = toks(from); if (!T.length) return [];
    for (let n = T.length; n >= Math.min(2, T.length); n--) {
      for (let k = 0; k + n <= T.length; k++) {
        const re = new RegExp('\\b' + T.slice(k, k + n).map(w => esc(w).replace(/'/g, "['’]")).join("[^A-Za-z0-9]+") + '\\b', 'gi');
        const out = []; let m;
        while ((m = re.exec(text))) { out.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; }
        if (out.length) return out;
      }
    }
    return [];
  }

  /* the word-level differences, each with its span in both texts */
  function hunks(orig, version) {
    const G = GF(); if (!G) return null;
    const A = G.words(orig), B = G.words(version);
    if (A.length * B.length > 600000) return null;
    return G.hunks(A, B).map(h => {
      const as = h.i1 > h.i0 ? A[h.i0].s : (h.i0 < A.length ? A[h.i0].s : orig.length);
      const bs = h.j1 > h.j0 ? B[h.j0].s : (h.j0 < B.length ? B[h.j0].s : version.length);
      return { as, ae: h.i1 > h.i0 ? A[h.i1 - 1].e : as, bs, be: h.j1 > h.j0 ? B[h.j1 - 1].e : bs };
    });
  }

  const INTENS = /^(?:very|really|quite|extremely|totally|actually|basically|literally|just|truly|highly|incredibly|so)$/;
  const HEDGES = /^(?:perhaps|maybe|arguably|possibly|somewhat|presumably|probably|seemingly|apparently)$/;
  /* why, when no rule made the change */
  function generic(del, ins) {
    const D = toks(del), I = toks(ins);
    if (norm(del).replace(/[^a-z0-9 ]/g, '') === norm(ins).replace(/[^a-z0-9 ]/g, '')) return { why: 'mark', text: 'Punctuation or a capital letter.' };
    const W = (RW() || {}).WHYS || {};
    if (!I.length && D.length && D.every(w => INTENS.test(w))) return { why: 'intensifier', text: W.intensifier || 'An intensifier taken out.' };
    if (!I.length && D.length && D.every(w => HEDGES.test(w))) return { why: 'hedge', text: W.hedge || 'A softener taken out.' };
    if (!I.length) return { why: 'cut', text: 'Taken out. Check that nothing you need is lost.' };
    if (!D.length) return { why: 'added', text: 'Added. Check that it says what you mean, and nothing you did not.' };
    if (/[.!?]\s+[A-Z]/.test(ins) && !/[.!?]\s+[A-Z]/.test(del)) return { why: 'split', text: W.split || 'One sentence made two.' };
    if (D.length === I.length && D.slice().sort().join() === I.slice().sort().join()) return { why: 'order', text: 'The same words in another order.' };
    if (D.length === 1 && I.length === 1) return { why: 'word', text: 'Another word. Check that it means what you mean here.' };
    return { why: 'reworded', text: 'Reworded. Read it against yours: keep it only if it says what you meant.' };
  }

  /* the reason a rule gives, in the words the writer reads */
  function reasonText(e) {
    const W = (RW() || {}).WHYS || {};
    return e.whyText || W[e.why] || (e.why && /\s/.test(e.why) ? e.why : 'A change the rules make.');
  }

  /* for a model's version: what every rule would change in the writer's text */
  const MODES = ['concise', 'scholarly', 'professional', 'simplify', 'active', 'neutral', 'hedge', 'split', 'confident', 'casual'];
  function derive(orig) {
    const R = RW(), out = [], seen = {};
    if (!R || !R.explain) return out;
    for (const m of MODES) {
      try {
        R.explain(m, orig).changes.forEach(c => { const k = norm(c.from) + '>' + norm(c.to); if (!seen[k]) { seen[k] = 1; out.push(c); } });
      } catch (e) { }
    }
    return out;
  }
  /* a model's change does what a rule does when it adds the words the rule
     adds, or, where the rule only takes words out, leaves them all out */
  function doesSame(e, ins) {
    const F = new Set(toks(e.from)), T = toks(e.to), I = new Set(toks(ins));
    const added = T.filter(w => !F.has(w)), Tset = new Set(T), removed = [...F].filter(w => !Tset.has(w));
    if (added.length) return added.every(w => I.has(w));
    return removed.length > 0 && removed.every(w => !I.has(w));
  }
  /* a span without the spaces at its ends */
  function trim(text, s, e) { while (e > s && /\s/.test(text[e - 1])) e--; while (s < e && /\s/.test(text[s])) s++; return [s, e]; }
  /* the sentences of a text, as [start, end) spans */
  function sentenceSpans(text) {
    const out = [], re = /[^.!?\n]+(?:[.!?]+["”’)\]]*)?|\n+/g; let m;
    while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
    return out;
  }

  /* the changes between the writer's passage and a version, grouped by the
     rule that made them, each with its spans, reasons and alternatives.
     log: the version's own record of changes ({from, to, why}), if any;
     opts.model: a writing model's version, whose reasons are derived */
  function analyse(orig, version, log, opts) {
    orig = String(orig || ''); version = String(version || ''); opts = opts || {};
    const H = hunks(orig, version);
    if (!H) return null;
    const own = (log || []).filter(e => e && e.from !== e.to);
    const fromModel = !own.length && !!opts.model;
    const entries = own.length ? own : (opts.model ? derive(orig) : []);
    /* where each entry stands in the writer's text */
    const at = entries.map(e => locate(orig, e.from));
    const parent = H.map((h, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    const why = H.map(() => []);
    H.forEach((h, i) => {
      const ins = version.slice(h.bs, h.be);
      entries.forEach((e, k) => {
        const hit = at[k].some(([s, t]) => h.ae > h.as ? (s < h.ae && t > h.as) : (s <= h.as && t >= h.as));
        if (hit && (!fromModel || doesSame(e, ins))) why[i].push(k);
      });
    });
    if (fromModel) {
      /* a model rewrites a sentence as a whole: its changes in one sentence
         are one change, kept or refused together */
      const S = sentenceSpans(orig), sOf = p => { for (let k = 0; k < S.length; k++) if (p < S[k][1]) return k; return S.length - 1; };
      const first = {};
      H.forEach((h, i) => { const k = sOf(h.ae > h.as ? h.as : Math.max(0, h.as - 1)); if (k in first) join(first[k], i); else first[k] = i; });
    } else {
      /* places one rule made are one change */
      entries.forEach((e, k) => { const hs = H.map((h, i) => why[i].indexOf(k) >= 0 ? i : -1).filter(i => i >= 0); for (let j = 1; j < hs.length; j++) join(hs[0], hs[j]); });
    }
    const groups = {};
    H.forEach((h, i) => { const r = find(i); (groups[r] = groups[r] || []).push(i); });
    const G = Object.keys(groups).map(r => {
      const hs = groups[r].map(i => H[i]);
      return { as: Math.min(...hs.map(h => h.as)), ae: Math.max(...hs.map(h => h.ae)), bs: Math.min(...hs.map(h => h.bs)), be: Math.max(...hs.map(h => h.be)), hs: groups[r] };
    }).sort((a, b) => a.as - b.as || a.bs - b.bs);
    /* changes whose spans cross are one change */
    const merged = [];
    for (const g of G) {
      const p = merged[merged.length - 1];
      if (p && (g.as < p.ae || g.bs < p.be)) { p.ae = Math.max(p.ae, g.ae); p.be = Math.max(p.be, g.be); p.hs = p.hs.concat(g.hs); }
      else merged.push(g);
    }
    const R = RW();
    return merged.map(g => {
      [g.as, g.ae] = trim(orig, g.as, g.ae); [g.bs, g.be] = trim(version, g.bs, g.be);
      const from = orig.slice(g.as, g.ae), to = version.slice(g.bs, g.be);
      const ks = [].concat(...g.hs.map(i => why[i]));
      const seen = {}, reasons = [];
      const add = r => { if (!seen[r.text]) { seen[r.text] = 1; reasons.push(r); } };
      ks.forEach(k => add({ why: entries[k].why, text: reasonText(entries[k]) }));
      /* what no rule explains is named for what it is */
      g.hs.filter(i => !why[i].length).forEach(i => { const h = H[i]; add(generic(orig.slice(h.as, h.ae), version.slice(h.bs, h.be))); });
      const own = ks.map(k => entries[k]);
      let alts = [];
      try {
        if (fromModel) {
          /* the rules' own version of the same words, as another way */
          const m = opts.mode && R && R[opts.mode] ? opts.mode : 'concise';
          const r = R && R[m] ? R[m](from) : '';
          if (r && r.trim() !== from.trim() && r.trim() !== to.trim()) alts = [r.trim()];
        } else if (R && R.alternatives && from.trim()) {
          const next = (version.slice(g.be).match(/^\s*([A-Za-z][\w-]*)/) || [])[1] || '';
          alts = R.alternatives(from, to).map(a => fixAlt(a, own, next)).filter(a => a && a !== to.trim() && a !== from.trim());
          alts = alts.filter((a, i) => alts.indexOf(a) === i);
        }
      } catch (e) { alts = []; }
      return { as: g.as, ae: g.ae, bs: g.bs, be: g.be, from, to, reasons: reasons.slice(0, 3), alts, ruled: ks.length > 0, model: fromModel };
    });
  }
  /* an alternative takes the change's other edits too ("really" still goes),
     and "a" or "an" agrees with the word after it */
  function fixAlt(alt, own, next) {
    let a = String(alt);
    for (const e of own) {
      const f = String(e.from || '').trim(); if (!f) continue;
      const i = a.toLowerCase().indexOf(f.toLowerCase());
      if (i < 0) continue;
      let t = String(e.to || '').trim();
      if (t && /^[A-Z]/.test(a.slice(i, i + 1)) && i === 0) t = t[0].toUpperCase() + t.slice(1);
      a = a.slice(0, i) + t + a.slice(i + f.length);
    }
    a = a.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').trim();
    const VOW = /^(?:[aeio]|u(?!ni|se|su|ra|ro|ti|ku|bi)|hour|honest|honou?r|heir)/i;
    a = a.replace(/\b([Aa])n? ([A-Za-z][\w-]*)/g, (m, A, w) => A + (VOW.test(w) ? 'n ' : ' ') + w);
    a = a.replace(/\b([Aa])n?$/, (m, A) => next ? A + (VOW.test(next) ? 'n' : '') : m);
    return a;
  }

  /* the version put together from the writer's choices: for each change,
     'v' (the version's words, the default), 'o' (the writer's own) or the
     number of an alternative */
  function compose(orig, version, groups, choice) {
    let out = String(version || '');
    const ch = choice || {};
    const order = (groups || []).map((g, i) => i).sort((a, b) => groups[b].bs - groups[a].bs);
    for (const i of order) {
      const g = groups[i], c = ch[i];
      if (c === undefined || c === 'v') continue;
      let repl = c === 'o' ? String(orig).slice(g.as, g.ae) : (g.alts[c] != null ? g.alts[c] : null);
      if (repl === null) continue;
      const left = out.slice(0, g.bs), right = out.slice(g.be);
      if (g.bs === g.be) {
        /* a place where the version took words out: the writer's words go
           back with a space on the side that needs one */
        if (left && !/\s$/.test(left) && /^[\w“"(]/.test(repl)) repl = ' ' + repl;
        if (right && /^[\w“"(]/.test(right) && !/\s$/.test(repl)) repl = repl + ' ';
        out = left + repl + right;
      } else if (!repl) {
        out = left.replace(/[ \t]+$/, '') + (/^[,.;:!?)]/.test(right) || !left ? right.replace(/^[ \t]+/, '') : (/^\s/.test(right) ? right : ' ' + right));
      } else out = left + repl + right;
    }
    return out;
  }

  /* the version as pieces for showing it: text that did not change, and
     each change whole ("It is very clear that this is" struck through, then
     "This is"), never word by word, where a diff can interleave the two */
  function parts(orig, version, groups, choice) {
    const out = [], ch = choice || {}, v = String(version || '');
    let at = 0;
    (groups || []).map((g, i) => [g, i]).sort((x, y) => x[0].bs - y[0].bs).forEach(([g, i]) => {
      if (g.bs < at) return;
      out.push({ same: v.slice(at, g.bs) });
      const c = ch[i];
      const shown = c === 'o' ? null : (typeof c === 'number' ? g.alts[c] : g.to);
      out.push({ i, from: g.from, to: shown, mine: c === 'o', alt: typeof c === 'number' });
      at = g.be;
    });
    out.push({ same: v.slice(at) });
    return out;
  }

  const api = { analyse, compose, parts, locate, generic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKEXPLAIN = api;
})(typeof self !== 'undefined' ? self : this);
