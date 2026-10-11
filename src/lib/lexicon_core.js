/* Inkwell's offline lexicon (7.39): alternatives for a word, by meaning.
   Data: vendor/wordnet-lex.txt, made by tools/lexicon/make_lexicon.py from
   Princeton WordNet 3.0 (licence in vendor/WORDNET-LICENCE.txt) and the SCOWL
   levels of the spelling checker. WordNet gives each meaning of a word with
   its synonyms, a short definition and how often the meaning is used; SCOWL
   gives how common each word is. From those this module:
   - finds the word's base form and its form in the text (plural, past, -ing);
   - guesses its part of speech from the words around it;
   - ranks its meanings by use and by the words of the sentence;
   - offers, for each likely meaning, synonyms that are used in that meaning,
     put into the same form ("lost" gives "mislaid", not "mislay");
   - scores how formal a word is (-2 casual .. +2 formal), for styles.
   No lookbehind in any regular expression (Safari before 16.4). */
(function (root) {
  const L = { ready: false, S: [], W: new Map(), N: new Map(), E: { n: new Map(), v: new Map(), a: new Map(), r: new Map() }, INV: { n: new Map(), v: new Map() } };

  function load(text) {
    L.S = []; L.W = new Map(); L.N = new Map();
    for (const k of 'nvar') L.E[k] = new Map();
    L.INV = { n: new Map(), v: new Map() };
    const lines = String(text || '').split('\n');
    for (const line of lines) {
      const t = line.split('|');
      if (t[0] === 'S') {
        const lem = t[3] ? t[3].split(';').map(x => { const i = x.lastIndexOf(':'); return [x.slice(0, i), +x.slice(i + 1) || 0]; }) : [];
        L.S.push({ pos: t[1], gloss: t[2], lem: lem, c: (t[4] || '').indexOf('c') >= 0, near: (t[4] || '').indexOf('n') >= 0 });
      } else if (t[0] === 'W') {
        const tot = {};
        (t[4] || '').split(',').forEach(x => { const p = x.split(':'); if (p[0]) tot[p[0]] = +p[1] || 0; });
        /* "h<id>:n": a meaning with no synonym of its own, by its broader one */
        L.W.set(t[1], { lv: +t[2], reg: +t[3], tot: tot, senses: (t[5] || '').split(',').filter(Boolean).map(x => { const h = x[0] === 'h', p = (h ? x.slice(1) : x).split(':'); return [+p[0], +p[1] || 0, h]; }) });
      } else if (t[0] === 'N') {
        L.N.set(+t[1], t[2].split(',').map(Number));
      } else if (t[0] === 'E') {
        if (!L.E[t[1]]) continue;
        L.E[t[1]].set(t[2], t[3]);
        if (L.INV[t[1]]) { const m = L.INV[t[1]]; if (!m.has(t[3])) m.set(t[3], []); m.get(t[3]).push(t[2]); }
      }
    }
    L.ready = L.S.length > 0;
    return L.ready;
  }

  /* ---- forms ---- */
  const SUF = {
    n: [['ses', 's', 's'], ['xes', 'x', 's'], ['zes', 'z', 's'], ['ches', 'ch', 's'], ['shes', 'sh', 's'], ['men', 'man', 's'], ['ies', 'y', 's'], ['s', '', 's']],
    v: [['ies', 'y', 's'], ['es', 'e', 's'], ['es', '', 's'], ['s', '', 's'], ['ied', 'y', 'ed'], ['ed', 'e', 'ed'], ['ed', '', 'ed'], ['ing', 'e', 'ing'], ['ing', '', 'ing']],
    a: [['ier', 'y', 'er'], ['iest', 'y', 'est'], ['er', '', 'er'], ['est', '', 'est'], ['er', 'e', 'er'], ['est', 'e', 'est']],
    r: []
  };
  /* "stopped" -> "stop", "running" -> "run": a doubled last consonant */
  function undouble(b) { return /([bdfgklmnprtvz])\1$/.test(b) ? b.slice(0, -1) : null; }
  function hasPos(base, pos) { const w = L.W.get(base); if (!w) return false; return w.tot[pos] !== undefined || w.senses.some(s => L.S[s[0]] && L.S[s[0]].pos === pos); }
  /* every reading of a word as it stands: base form, part of speech, form */
  function bases(word) {
    const w = String(word || '').toLowerCase(), out = [], seen = {};
    const add = (base, pos, form) => { const k = base + '|' + pos + '|' + form; if (!seen[k] && hasPos(base, pos)) { seen[k] = 1; out.push({ base: base, pos: pos, form: form }); } };
    for (const pos of 'nvar') add(w, pos, '');
    for (const pos of 'nvar') {
      const ex = L.E[pos].get(w);
      if (ex) add(ex, pos, pos === 'n' ? 's' : pos === 'v' ? (/(en|wn|ne|n)$/.test(w) && !/ran$|won$/.test(w) ? 'en' : 'ed') : pos === 'a' ? (/est$/.test(w) ? 'est' : 'er') : '');
      for (const [suf, rep, form] of SUF[pos]) {
        if (w.length > suf.length + 1 && w.endsWith(suf)) {
          const b = w.slice(0, -suf.length) + rep;
          add(b, pos, form);
          if (!rep && (form === 'ed' || form === 'ing' || form === 'er' || form === 'est')) { const u = undouble(b); if (u) add(u, pos, form); }
        }
      }
    }
    return out;
  }
  const VOW = /[aeiou]/;
  function doubleEnd(b) {
    /* one vowel group, ending consonant-vowel-consonant: stop, plan, rob */
    return (b.match(/[aeiouy]+/g) || []).length === 1 && /[^aeiou][aeiou][bdfgklmnprtvz]$/.test(b);
  }
  /* a base word put into a form; null where the form cannot be made safely */
  function inflect(base, pos, form) {
    if (!form) return base;
    const parts = base.split(' ');
    if (parts.length > 1) {
      if (pos === 'v') { const h = inflect(parts[0], 'v', form); return h ? [h].concat(parts.slice(1)).join(' ') : null; }
      if (pos === 'n' && form === 's') { const h = inflect(parts[parts.length - 1], 'n', 's'); return h ? parts.slice(0, -1).concat(h).join(' ') : null; }
      return null;
    }
    const b = base;
    if (pos === 'n' && form === 's') {
      const ir = L.INV.n.get(b);
      if (ir && ir.length) return ir[0];
      if (/(s|x|z|ch|sh)$/.test(b)) return b + 'es';
      if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ies';
      return b + 's';
    }
    if (pos === 'v') {
      const IRR = { be: { s: 'is', ed: 'was', en: 'been', ing: 'being' }, have: { s: 'has', ed: 'had', en: 'had' }, do: { s: 'does', ed: 'did', en: 'done' }, go: { s: 'goes', ed: 'went', en: 'gone' } };
      if (IRR[b] && IRR[b][form]) return IRR[b][form];
      if (form === 's') { if (/(s|x|z|ch|sh|o)$/.test(b)) return b + 'es'; if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ies'; return b + 's'; }
      if (form === 'ing') { const iri = (L.INV.v.get(b) || []).filter(x => /ing$/.test(x))[0]; if (iri) return iri; if (/ie$/.test(b)) return b.slice(0, -2) + 'ying'; if (/[^aeioy]e$/.test(b) && b !== 'be') return b.slice(0, -1) + 'ing'; if (doubleEnd(b)) return b + b.slice(-1) + 'ing'; return b + 'ing'; }
      if (form === 'ed' || form === 'en') {
        /* WordNet's list of irregular forms also holds "-ing" and "-s" forms
           ("getting", "vying"): only the pasts are pasts */
        const ir = (L.INV.v.get(b) || []).filter(x => !/ing$/.test(x) && !(/s$/.test(x) && !/ss$/.test(x) && x !== 'was'));
        /* British usage: "has got", not "has gotten" */
        if (b === 'get') return 'got';
        if (ir.length) {
          const en = ir.filter(x => /(en|wn|ne|n)$/.test(x) && !/ran$/.test(x)), ed = ir.filter(x => en.indexOf(x) < 0);
          if (form === 'en' && (en[0] || ed[0])) return en[0] || ed[0];
          if (form === 'ed' && ed[0]) return ed[0];
          /* "prove" has only the irregular "proven": its past is "proved" */
        }
        if (/e$/.test(b)) return b + 'd';
        if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ied';
        if (doubleEnd(b)) return b + b.slice(-1) + 'ed';
        return b + 'ed';
      }
    }
    if (pos === 'a' && (form === 'er' || form === 'est')) return null;
    return null;
  }

  /* ---- part of speech from the words around ---- */
  const DET = /^(the|a|an|this|that|these|those|my|your|his|her|its|our|their|some|any|no|every|each|another|such|whose|many|few|several|much|all|both|one)$/;
  const AUXV = /^(will|would|can|could|should|shall|may|might|must|do|does|did|to|cannot|let|please)$/;
  const SUBJ = /^(i|you|he|she|it|we|they|who|people|everyone|nobody)$/;
  const BE = /^(am|is|are|was|were|be|been|being|seem|seems|seemed|become|becomes|became|feel|feels|felt|look|looks|looked|remain|remains|remained|get|gets|got)$/;
  const INTENS = /^(very|so|too|quite|rather|more|most|less|least|really|extremely|fairly|pretty|how)$/;
  const PREP = /^(of|in|on|at|for|with|by|from|about|into|onto|over|under|between|among|through|during|without|within|against|towards?|like)$/;
  const HAVE = /^(have|has|had|having|been|be|was|were|is|are|am|get|gets|got)$/;
  /* a word used only, or almost only, as an adjective or as a noun */
  function mostly(w, pos) {
    const W = L.W.get(String(w || '').toLowerCase());
    if (!W) return false;
    const t = W.tot, all = Object.keys(t).reduce((a, k) => a + t[k], 0);
    if (!(pos in t)) return false;
    return all ? t[pos] / all >= 0.65 : Object.keys(t).length === 1;
  }
  const adjOnly = w => !!w && !DET.test(w) && mostly(w, 'a');
  /* a noun, or a plural ("standards"): adjectives take no "-s" */
  const nounOnly = w => !!w && (mostly(w, 'n') || (/[^s]s$/.test(w) && !L.W.has(w) && bases(w).some(b => b.pos === 'n' && b.form === 's') && !bases(w).some(b => b.pos === 'v' && mostly(b.base, 'v'))));
  function choosePos(cands, prev, prev2, next) {
    if (!cands.length) return null;
    const pv = (prev || '').toLowerCase(), pv2 = (prev2 || '').toLowerCase(), nx = (next || '').toLowerCase();
    let best = null, bestScore = -1e9;
    for (const c of cands) {
      const w = L.W.get(c.base), tot = w ? (w.tot[c.pos] || 0) : 0;
      let s = Math.log(1 + tot) * 0.6;
      if (DET.test(pv) || /'s$/.test(pv)) s += c.pos === 'n' ? 3 : c.pos === 'a' ? 2 : -3;
      if (AUXV.test(pv)) s += c.pos === 'v' && !c.form ? 4 : -1;
      if (SUBJ.test(pv)) s += c.pos === 'v' && c.form !== 'ing' && c.form !== 'en' ? 3 : -1;
      /* "am tired", "was happy": after "be", an adjective where there is one */
      if (BE.test(pv)) s += c.pos === 'a' ? 4.5 : (c.pos === 'v' && (c.form === 'ing' || c.form === 'en' || c.form === 'ed')) ? 2 : -0.5;
      if (INTENS.test(pv)) s += c.pos === 'a' ? 3 : c.pos === 'r' ? 2 : -2;
      if (PREP.test(pv)) s += c.pos === 'n' ? 2 : c.pos === 'v' && c.form === 'ing' ? 1 : -1;
      if (DET.test(pv2) && c.pos === 'n') s += 1;
      /* "a clear rise", "the long meeting": a noun after an adjective */
      if (adjOnly(pv) && (c.pos === 'n')) s += 3;
      if (adjOnly(pv) && c.pos === 'v') s -= 2;
      /* "modern standards": an adjective before a noun */
      if (nounOnly(nx) && c.pos === 'a') s += 2.5;
      if (nounOnly(nx) && c.pos === 'n' && !DET.test(pv)) s -= 1;
      if (DET.test(nx) && c.pos === 'v') s += 1.5;
      if (/^(the|a|an|his|her|their|my|our|its|your)$/.test(nx) && c.pos !== 'v') s -= 1;
      if (c.pos === 'r' && /ly$/.test(c.base)) s += 2;
      if (c.form === 'ing' || c.form === 'ed' || c.form === 'en') s += c.pos === 'v' ? 1.5 : -1;
      if (c.form === 's' && c.pos === 'n' && (DET.test(pv) || PREP.test(pv))) s += 1;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  /* ---- meanings ---- */
  const STOP = new Set('a an the and or but if of in on at to for with by from as is are was were be been being it its this that these those he she they we you i his her their our my your me him them us not no so do does did have has had will would can could should may might must there here what which who whom whose when where why how all any some more most other such only own same than too very just into over under about after before again'.split(' '));
  function contentWords(text) { return (String(text || '').toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter(w => !STOP.has(w)); }
  function senses(base, pos, ctx) {
    const w = L.W.get(base);
    if (!w) return [];
    const tot = w.tot[pos] || 0, cw = new Set(contentWords(ctx));
    cw.delete(base);
    const out = [];
    let rank = 0;
    for (const [id, cnt, broad] of w.senses) {
      const s = L.S[id];
      if (!s || s.pos !== pos) continue;
      /* a broader meaning helps a noun ("house": home, dwelling); a verb's
         is far too general ("waste": use) */
      if (broad && pos !== 'n') continue;
      let lesk = 0;
      contentWords(s.gloss).forEach(g => { if (cw.has(g)) lesk += 0.12; });
      s.lem.forEach(([l]) => { if (l !== base && cw.has(l)) lesk += 0.15; });
      const share = tot > 0 ? cnt / tot : Math.pow(0.5, rank + 1);
      out.push({ id: id, share: share, lesk: Math.min(0.45, lesk), score: share + Math.min(0.45, lesk), gloss: s.gloss, colloquial: s.c, broader: !!broad });
      rank++;
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }
  function reg(word) { const w = L.W.get(String(word).toLowerCase()); return w ? w.reg : 0; }
  function level(word) { const w = L.W.get(String(word).toLowerCase()); return w ? w.lv : 99; }
  function matchCase(src, out) {
    if (!out) return out;
    if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return out.toUpperCase();
    if (/^[A-Z]/.test(src)) return out[0].toUpperCase() + out.slice(1);
    return out;
  }
  /* the synonyms of one meaning, used in that meaning, in the word's form */
  function synonymsOf(id, base, pos, form, src, near) {
    const s = L.S[id], out = [], seen = {};
    const pool = s.lem.map(x => [x[0], x[1], false]);
    if (pos === 'a' && near !== false && (s.near || s.lem.length < 3)) (L.N.get(id) || []).forEach(j => { const t = L.S[j]; if (t) t.lem.forEach(x => pool.push([x[0], x[1], true])); });
    for (const [lem, cnt, isNear] of pool) {
      const lw = lem.toLowerCase();
      if (lw === base || seen[lw]) continue;
      const W = L.W.get(lw), lv = W ? W.lv : 70;
      if (lv > 60) continue;
      /* a word used in this meaning, or one whose most used meaning this
         is: "kid" for a child, never "fry" or "shaver" (never recorded as
         nouns). A selected phrase is unambiguous, so its synonyms need no
         record: "train of thought" gives "thread". */
      const ofPos = W ? W.senses.filter(x => L.S[x[0]] && L.S[x[0]].pos === s.pos) : [];
      const main = W && (W.tot[s.pos] || 0) > 0 && ofPos.length && ofPos.slice().sort((x, y) => y[1] - x[1])[0][0] === id;
      if (cnt === 0 && !(lv <= 35 && (main || / /.test(base)))) continue;
      if (isNear && cnt === 0) continue;
      const f = inflect(lw, pos, form);
      if (!f) continue;
      seen[lw] = 1;
      out.push({ text: matchCase(src, f), base: lw, count: cnt, level: lv, reg: W ? W.reg : 0, near: isNear });
    }
    out.sort((a, b) => (a.near - b.near) || (b.count - a.count) || (a.level - b.level));
    let n = 0;
    return out.filter(x => !x.near || ++n <= 4);
  }
  /* a word in its sentence: its readings, the chosen one, and its meanings */
  function analyse(word, prev, prev2, next, ctx) {
    const cands = bases(word);
    const pick = choosePos(cands, prev, prev2, next);
    if (!pick) return null;
    /* "was shown", "has taken": after "have" or "be", the participle */
    if (pick.pos === 'v' && pick.form === 'ed' && HAVE.test(String(prev || '').toLowerCase())) pick.form = 'en';
    const W = L.W.get(pick.base), tot = W ? (W.tot[pick.pos] || 0) : 0;
    const ss = senses(pick.base, pick.pos, ctx);
    const kept = ss.reduce((a, s) => a + (tot > 0 ? s.share : 0), 0);
    return { word: word, base: pick.base, pos: pick.pos, form: pick.form, senses: ss, total: tot, coverage: tot > 0 ? kept : 0 };
  }
  /* alternatives for a word or phrase in a sentence, grouped by meaning:
     [{gloss, pos, share, fit, words: [{text, base, count, level, reg}]}] */
  function alternatives(word, sentence, at) {
    if (!L.ready) return [];
    const src = String(word || '').trim();
    if (!src) return [];
    const sent = String(sentence || src);
    const pos0 = typeof at === 'number' ? at : sent.indexOf(src);
    const before = (sent.slice(0, Math.max(0, pos0)).match(/[A-Za-z'’]+/g) || []);
    const after = (sent.slice(pos0 + src.length).match(/[A-Za-z'’]+/g) || []);
    const prev = before[before.length - 1], prev2 = before[before.length - 2], next = after[0];
    const lw = src.toLowerCase().replace(/’/g, "'");
    let a = null;
    if (/\s/.test(lw)) {
      /* a phrase: as it stands, or with its first or last word in base form */
      const ws = lw.split(/\s+/), tries = [{ base: ws.join(' '), form: '' }];
      bases(ws[0]).forEach(b => { if (b.pos === 'v') tries.push({ base: [b.base].concat(ws.slice(1)).join(' '), form: b.form, pos: 'v' }); });
      bases(ws[ws.length - 1]).forEach(b => { if (b.pos === 'n') tries.push({ base: ws.slice(0, -1).concat(b.base).join(' '), form: b.form, pos: 'n' }); });
      for (const t of tries) {
        const W = L.W.get(t.base);
        if (!W) continue;
        const pos = t.pos || (W.tot.n !== undefined ? 'n' : W.tot.v !== undefined ? 'v' : W.tot.a !== undefined ? 'a' : 'r');
        a = { word: src, base: t.base, pos: pos, form: t.form, senses: senses(t.base, pos, sent), total: W.tot[pos] || 0 };
        break;
      }
    } else a = analyse(lw, prev, prev2, next, sent);
    if (!a || !a.senses.length) return [];
    const groups = [];
    for (const s of a.senses.slice(0, 5)) {
      const words = synonymsOf(s.id, a.base, a.pos, a.form, src).slice(0, 6);
      if (!words.length) continue;
      groups.push({ gloss: s.gloss, pos: a.pos, share: s.share, fit: s.score, colloquial: s.colloquial, broader: s.broader, words: words });
    }
    /* the first group is the best fit only when its meaning is a likely one;
       otherwise every group is offered as a possible meaning, to choose */
    if (groups.length && !groups[0].broader && (groups[0].share >= 0.5 || groups[0].fit - groups[0].share > 0.2)) groups[0].best = true;
    return groups;
  }
  /* the one alternative a style rewrite may use without asking: only where
     the meaning is clear (one meaning carries most of the word's use) */
  function confident(word, prev, prev2, next, ctx) {
    const a = analyse(word, prev, prev2, next, ctx);
    if (!a || !a.senses.length) return null;
    const top = a.senses[0];
    if (a.total < 3 || top.share < 0.6 || top.broader) return null;
    return { analysis: a, sense: top, words: synonymsOf(top.id, a.base, a.pos, a.form, word, false) };
  }
  const api = { load: load, get ready() { return L.ready; }, bases: bases, inflect: inflect, analyse: analyse, senses: senses, alternatives: alternatives, confident: confident, reg: reg, level: level, synonymsOf: synonymsOf, _L: L };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKLEX = api;
})(typeof self !== 'undefined' ? self : this);
