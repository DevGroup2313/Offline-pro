/* Inkwell's safety filter for model corrections. A model proposes a new
   sentence; the filter splits the change into word-level edits and keeps
   only the small, local ones that cannot change what the writer meant.
   Pure functions; shared by the app and its test harness. */
(function (root) {
  const FUNC = new Set(('a an the of to in on at for from by with about into onto over under than as that which who whom whose ' +
    'is are was were be been being am do does did done has have had having will would shall should can could may might must ' +
    'it its there here this these those so very really just quite rather more most much many some any no not also too then ' +
    'and or but nor if because while although though when where whether up out off down'
  ).split(' '));
  const PRON = { i: 1, me: 1, my: 1, mine: 1, myself: 1, we: 4, us: 4, our: 4, ours: 4, ourselves: 4,
    you: 2, your: 2, yours: 2, yourself: 2, yourselves: 2, he: 3, him: 3, his: 3, himself: 3, she: 5, her: 5, hers: 5, herself: 5,
    it: 6, its: 6, itself: 6, they: 7, them: 7, their: 7, theirs: 7, themselves: 7, one: 8, oneself: 8 };
  function words(s) {
    const out = []; const re = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|--|\.\.\.|[^\sA-Za-z0-9]/g; let m;
    /* curly and straight quotes count as the same character: the filter never touches typography */
    while ((m = re.exec(s))) out.push({ t: m[0].replace(/[’‘]/g, "'").replace(/[“”]/g, '"'), s: m.index, e: m.index + m[0].length });
    return out;
  }
  function lev(a, b) { const m = a.length, n = b.length; let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; }
  /* word-level diff: hunks of [i0,i1) in a replaced by [j0,j1) in b */
  function hunks(a, b) {
    const m = a.length, n = b.length, L = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i].t === b[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0, h = null;
    const close = () => { if (h) { h.i1 = i; h.j1 = j; out.push(h); h = null; } };
    while (i < m || j < n) {
      if (i < m && j < n && a[i].t === b[j].t) { close(); i++; j++; }
      else { if (!h) h = { i0: i, j0: j }; if (j < n && (i >= m || L[i][j + 1] >= L[i + 1][j])) j++; else i++; }
    }
    close(); return out;
  }
  const isNum = t => /\d/.test(t), isWord = t => /^[A-Za-z]/.test(t), low = t => t.toLowerCase();
  const isFunc = t => !isWord(t) || FUNC.has(low(t)) || PRON[low(t)];
  function sameFamily(x, y, verbs) {
    x = low(x); y = low(y); if (x === y) return true;
    if (verbs && (verbs.has(x + '|' + y) || verbs.has(y + '|' + x))) return true;
    const k = Math.min(x.length, y.length);
    let pre = 0; while (pre < k && x[pre] === y[pre]) pre++;
    if (pre >= 3 && pre >= k - 2) return true;              /* reason/reasons, study/studies, media/medias */
    return lev(x, y) <= (Math.max(x.length, y.length) > 6 ? 2 : 1); /* spelling: recieve/receive, alot/a lot */
  }
  /* why an edit is refused, or '' when it is safe */
  function refuse(h, a, b, ctx, verbs) {
    const A = a.slice(h.i0, h.i1).map(w => w.t), B = b.slice(h.j0, h.j1).map(w => w.t);
    if (A.length > 2 || B.length > 3) return 'too large';
    if (A.concat(B).some(isNum)) return 'number';
    if (h.i0 > 0 && A.some((t, k) => /^[A-Z]/.test(t) && !/^[A-Z]/.test(B[k] || '') && !/^(I|I'm|I've|I'd|I'll)$/.test(t))) return 'name';
    if (ctx.quoted(h)) return 'quotation';
    /* inside a name ("Plan 9 from Bell Labs"): capitals or numbers on both sides */
    const nameLike = w => w && /^[A-Z0-9]/.test(w.t);
    if (h.i0 > 1 && nameLike(a[h.i0 - 1]) && nameLike(a[h.i1])) return 'name';
    const pa = A.map(low).filter(t => PRON[t]), pb = B.map(low).filter(t => PRON[t]);
    if (pa.length && pb.length && pa.some(x => pb.every(y => PRON[x] !== PRON[y]))) return 'person';
    if (!B.length && A.some(t => !isFunc(t))) return 'deletes a content word';
    const ca = A.filter(t => !isFunc(t)), cb = B.filter(t => !isFunc(t));
    if (ca.length && cb.length) { if (!ca.every(x => cb.some(y => sameFamily(x, y, verbs))) && !(A.join('').toLowerCase() === B.join('').toLowerCase())) return 'different word'; }
    else if (ca.length && !cb.length) return 'replaces a content word';
    else if (!ca.length && cb.length > 1) return 'adds content';
    else if (!ca.length && cb.length === 1 && !A.length) return 'adds content';
    return '';
  }
  /* original sentence + model sentence -> {text, edits:[{start,end,orig,fix}], refused:[...]} */
  function filter(src, out, verbs) {
    const a = words(src), b = words(out), H = hunks(a, b);
    const qs = []; let q = -1; a.forEach((w, k) => { if (/^["“”]$/.test(w.t)) { if (q < 0) q = k; else { qs.push([q, k]); q = -1; } } if (w.t === '(') q = q; });
    const ctx = { quoted: h => qs.some(([x, y]) => h.i0 > x && h.i0 < y) };
    const edits = [], refused = [];
    for (const h of H) {
      const why = refuse(h, a, b, ctx, verbs);
      const fixText = b.slice(h.j0, h.j1).map(w => w.t);
      let start = h.i0 < a.length ? a[h.i0].s : src.length, end = h.i1 > h.i0 ? a[h.i1 - 1].e : start;
      /* an inserted mark (",") belongs straight after the word before it */
      if (h.i1 === h.i0 && h.i0 > 0 && fixText.length && !/^[A-Za-z0-9]/.test(fixText[0])) start = end = a[h.i0 - 1].e;
      const e = { start, end, orig: src.slice(start, end), fix: fixText, why };
      (why ? refused : edits).push(e);
    }
    /* rebuild with only the safe edits, keeping the writer's own spacing */
    let text = '', pos = 0;
    for (const e of edits) {
      let fix = e.fix.join(' ').replace(/\s+([.,;:!?%)\]}])/g, '$1').replace(/([(\[{])\s+/g, '$1');
      let s = e.start, en = e.end;
      if (s === en) { /* insertion: add a space on the right side */
        const before = src.slice(0, s), punct = !/^[A-Za-z0-9(]/.test(fix);
        if (punct) { /* attached to the word before; the space after it stays */ }
        else if (/\s$/.test(before) || s === 0) fix = fix + ' '; else fix = ' ' + fix;
      } else if (!fix) { /* deletion: a word takes one adjoining space with it; a
           punctuation mark leaves the space after it, which the next word needs */
        if (/^[A-Za-z0-9]/.test(e.orig)) { if (src[en] === ' ') en++; else if (src[s - 1] === ' ') s--; }
        else if (src[s - 1] === ' ' && src[en] === ' ') s--;
      }
      text += src.slice(pos, s) + fix; pos = en; e.fix = fix; e.start = s; e.end = en; e.orig = src.slice(s, en);
    }
    text += src.slice(pos);
    return { text, edits, refused };
  }
  /* a plain reason for each kept edit, for writers learning English */
  const ART = new Set(['a', 'an', 'the']);
  const PREP = new Set('of to in on at for from by with about into onto over under than as'.split(' '));
  function reason(orig, fix, verbs) {
    const A = words(orig).map(w => low(w.t)), B = words(fix).map(w => low(w.t));
    const all = A.concat(B);
    if (all.length && all.every(t => !isWord(t))) return 'Punctuation';
    if (orig.toLowerCase() === fix.toLowerCase()) return 'Capital letter';
    if (all.length && all.every(t => ART.has(t))) return A.length ? (B.length ? 'Article: a, an or the' : 'Article not needed here') : 'Missing article: a, an or the';
    if (all.length && all.every(t => PREP.has(t))) return A.length && B.length ? 'Preposition' : (B.length ? 'Missing preposition' : 'Preposition not needed here');
    if (A.join('') === B.join('')) return 'Spelling: one word or two';
    if (A.length === 1 && B.length === 1 && isWord(A[0]) && isWord(B[0])) {
      const x = A[0], y = B[0];
      if (x + 's' === y || x + 'es' === y || y + 's' === x || y + 'es' === x || x.replace(/y$/, 'ies') === y || y.replace(/y$/, 'ies') === x) return 'Agreement: singular or plural';
      const aux = [['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'], ['have', 'has', 'had', 'having'], ['do', 'does', 'did', 'done', 'doing']];
      if (aux.some(g => g.includes(x) && g.includes(y))) return 'Verb form: agreement with the subject or tense';
      if (verbs && (verbs.has(x + '|' + y) || verbs.has(y + '|' + x))) return 'Verb form';
      if (PRON[x] && PRON[y]) return 'Pronoun form';
      if (lev(x, y) <= 2) return 'Spelling';
    }
    if (!B.length) return 'Word not needed here';
    if (!A.length) return 'Missing word';
    return 'Grammar';
  }
  const api = { filter, words, hunks, sameFamily, reason };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GECFILTER = api;
})(typeof self !== 'undefined' ? self : this);
