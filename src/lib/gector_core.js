/* GECToR decoding ("Tag, Not Rewrite", Omelianchuk et al., 2020), ported
   from Grammarly's published code (gector/gec_model.py, utils/helpers.py).
   The model labels each word with one edit; edits are applied, and the
   sentence is labelled again, up to a few passes. Pure functions; the model
   call and the tokenizer are handed in. */
(function (root) {
  /* Grammarly's verb-form list (data/verb-form-vocab.txt, Apache 2.0), one
     "go_went:VB_VBD" per line. It is searched where needed rather than
     loaded into a table, which keeps a phone's memory free.
     get('go_VB_VBD') -> 'went' (the first match, as in Grammarly's code);
     has('go|went') -> true when the two are forms of one verb. */
  function verbForms(text) {
    const T = '\n' + text.replace(/\r/g, '');
    return {
      get(key) {
        const p = key.split('_'); if (p.length < 3) return undefined;
        const t2 = p.pop(), t1 = p.pop(), word = p.join('_'), pre = '\n' + word + '_', want = ':' + t1 + '_' + t2;
        let i = 0;
        while ((i = T.indexOf(pre, i)) >= 0) {
          let e = T.indexOf('\n', i + 1); if (e < 0) e = T.length;
          const line = T.slice(i + 1, e), c = line.indexOf(':');
          if (c > 0 && line.slice(c).trim() === want) { const w = line.slice(0, c); return w.slice(w.indexOf('_') + 1); }
          i = e;
        }
        return undefined;
      },
      has(pair) { const k = pair.indexOf('|'); return T.indexOf('\n' + pair.slice(0, k) + '_' + pair.slice(k + 1) + ':') >= 0; }
    };
  }
  /* words as GECToR was trained on them: contractions apart (do n't) */
  function split(s) { return s.replace(/’/g, "'").match(/[0-9]+(?:[.,:][0-9]+)*[A-Za-z]*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?=n't\b)|n't\b|'(?:s|re|ve|ll|d|m)\b|[A-Za-z0-9]+(?:-[A-Za-z0-9]+|'(?!(?:s|re|ve|ll|d|m|t)\b)[A-Za-z]+)*|--|\.\.\.|[^\sA-Za-z0-9]/gi) || []; }
  function join(w) { return w.join(' ').replace(/\s+([.,;:!?%)\]}])/g, '$1').replace(/([(\[{])\s+/g, '$1').replace(/\s+(n't|'s|'re|'ve|'ll|'d|'m)\b/gi, '$1'); }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t; }
  function transform(tok, label, verbs) {
    if (label.startsWith('$TRANSFORM_CASE_')) {
      if (label.endsWith('LOWER')) return tok.toLowerCase();
      if (label.endsWith('UPPER')) return tok.toUpperCase();
      if (label.endsWith('CAPITAL')) return cap(tok);
      if (label.endsWith('CAPITAL_1')) return tok.charAt(0) + cap(tok.slice(1));
      if (label.endsWith('UPPER_-1')) return tok.slice(0, -1).toUpperCase() + tok.slice(-1);
      return tok;
    }
    if (label.startsWith('$TRANSFORM_VERB_')) { const w = verbs.get(tok + '_' + label.slice(16)); return w == null ? null : w; }
    if (label.startsWith('$TRANSFORM_SPLIT')) return tok.split('-').join(' ');
    if (label.startsWith('$TRANSFORM_AGREEMENT')) return label.endsWith('PLURAL') ? tok + 's' : tok.slice(0, -1);
    return tok;
  }
  /* one pass: words -> {words, edits}; probs[i] is the label distribution
     for position i, where position 0 is the $START token */
  function applyPass(words, best, labels, verbs, minProb) {
    const edits = [];
    for (let i = 0; i < best.length; i++) {
      const { idx, p } = best[i]; if (idx === 0 || p < minProb) continue;
      const lab = labels[idx]; if (!lab || lab === '$KEEP' || lab.startsWith('@@')) continue;
      let start, end, clear;
      if (lab.startsWith('$REPLACE_') || lab.startsWith('$TRANSFORM_') || lab === '$DELETE') { start = i; end = i + 1; }
      else if (lab.startsWith('$APPEND_') || lab.startsWith('$MERGE_')) { start = i + 1; end = i + 1; }
      else continue;
      if (lab === '$DELETE') clear = '';
      else if (lab.startsWith('$TRANSFORM_') || lab.startsWith('$MERGE_')) clear = lab;
      else clear = lab.slice(lab.indexOf('_') + 1);
      if (start - 1 < 0 && end - 1 <= 0 && !(lab.startsWith('$APPEND_'))) continue; /* no edits to $START itself */
      edits.push([start - 1, end - 1, clear, p]);
    }
    const t = words.slice(); let shift = 0; const applied = [];
    for (const [s, e, lab] of edits) {
      const pos = s + shift, src = (pos >= 0 && pos < t.length) ? t[pos] : '';
      if (lab === '') { t.splice(pos, 1); shift--; applied.push(['del', s, src]); }
      else if (s === e) { t.splice(pos, 0, lab.replace('$APPEND_', '')); shift++; applied.push(['ins', s, lab]); }
      else if (lab.startsWith('$TRANSFORM_')) { const w = transform(src, lab, verbs); if (w != null && w !== src) { t[pos] = w; applied.push(['tr', s, src, w]); } }
      else if (s === e - 1) { t[pos] = lab; applied.push(['rep', s, src, lab]); }
      else if (lab.startsWith('$MERGE_')) { t.splice(pos + 1, 0, lab); shift++; }
    }
    let out = t;
    if (t.some(x => x.startsWith('$MERGE_'))) out = (' ' + t.join(' ') + ' ').replace(/ \$MERGE_HYPHEN /g, '-').replace(/ \$MERGE_SPACE /g, '').trim().split(/\s+/);
    return { words: out, changed: applied.length > 0 };
  }
  /* best label per word position from raw logits, with $KEEP favoured by keepBias */
  function bestLabels(logits, rows, nLab, keepBias) {
    const best = [];
    for (const r of rows) {
      const off = r * nLab; let mx = -Infinity;
      for (let k = 0; k < nLab; k++) if (logits[off + k] > mx) mx = logits[off + k];
      let sum = 0; for (let k = 0; k < nLab; k++) sum += Math.exp(logits[off + k] - mx);
      let bi = 0, bp = -1;
      for (let k = 0; k < nLab; k++) { let p = Math.exp(logits[off + k] - mx) / sum; if (k === 0) p += keepBias; if (p > bp) { bp = p; bi = k; } }
      const pKeep = Math.exp(logits[off] - mx) / sum;
      best.push({ idx: bi, p: bp, pKeep: pKeep });
    }
    return best;
  }
  /* words: array of tokens; encodeWord(w) -> sub-token ids for " "+w;
     infer(ids) -> Float32Array logits [ids.length x nLab] */
  async function correct(words, cfg) {
    const { encodeWord, infer, labels, verbs, START_ID, iterations = 3, keepBias = 0.2, minProb = 0.5, minErrorProb = 0.5, prefixIds = [], suffixIds = [] } = cfg;
    let cur = words.slice();
    for (let it = 0; it < iterations; it++) {
      const ids = prefixIds.concat([START_ID]); const rows = [prefixIds.length];
      for (const w of cur) { const p = encodeWord(w).slice(0, 5); rows.push(ids.length); ids.push(...(p.length ? p : [3])); }
      ids.push(...suffixIds);
      if (ids.length > 510) break;
      const logits = await infer(ids);
      const best = bestLabels(logits, rows, labels.length, keepBias);
      const errProb = Math.max(...best.map(b => 1 - b.pKeep));
      if (errProb < minErrorProb) break;
      const r = applyPass(cur, best, labels, verbs, minProb);
      if (!r.changed) break;
      cur = r.words;
    }
    return cur;
  }
  const api = { verbForms, split, join, correct, transform };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GECTOR = api;
})(typeof self !== 'undefined' ? self : this);
