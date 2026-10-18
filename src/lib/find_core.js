/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.44: search inside a long document, as Word searches (INKFIND). Used by
   Tabula's Navigation pane; tested in tools/find/find_test.js.

   - find(text, needle, opts): every match as [start, end], never across a
     paragraph. A straight quote or apostrophe finds the curly ones and the
     other way round ("Gadamer's" finds "Gadamer’s"), as in Word. Options:
     matchCase, wholeWord, ignoreAccents ("Merleau" finds "Mérleau"; a
     letter that is not a letter with an accent, such as "œ" or "ø", stays
     itself).
   - index(roots, opts): the text of the page's own elements, one line per
     paragraph, with a map back to its text nodes. Footnote numbers in the
     text and tracked deletions are left out, so "circle" followed by a
     note number is still the whole word.
   - range(ix, start, end): the DOM range of a match.
   - context(text, start, end): the words around a match, for the list.
   - replaceAll(ix, matches, rep, opts): replaces in the DOM, last first,
     and returns how many; opts.track(range, rep) records each as a tracked
     change instead. */
(function (root) {
  'use strict';

  const SQ = /[‘’‚‛′ʼ`´]/g;
  const DQ = /[“”„‟″]/g;
  const SP = /[   ]/g;
  const ACC = /[À-ɏḀ-ỿ]/g;
  const accCache = new Map();
  function noAccent(c) {
    let v = accCache.get(c);
    if (v === undefined) {
      const d = c.normalize('NFD');
      v = d.length > 1 && /[̀-ͯ]/.test(d.slice(1)) ? d[0] : c;
      accCache.set(c, v);
    }
    return v;
  }
  /* the folded text has the same length as the text, so a place in one is
     the same place in the other */
  function fold(s, o) {
    let t = String(s);
    if (!o.matchCase) {
      const low = t.toLowerCase();
      if (low.length === t.length) t = low;
      else {
        let out = '';
        for (const ch of t) { const l = ch.toLowerCase(); out += l.length === ch.length ? l : ch; }
        t = out;
      }
    }
    t = t.replace(SQ, "'").replace(DQ, '"').replace(SP, ' ');
    if (o.ignoreAccents) t = t.replace(ACC, noAccent);
    return t;
  }
  const WORD = /[\p{L}\p{N}_]/u;
  function isWord(c) { return !!c && WORD.test(c); }

  function find(text, needle, opts) {
    const o = opts || {}, out = [];
    const n = fold(needle || '', o);
    if (!n || /\n/.test(n)) return out;
    const t = o.folded || fold(text || '', o);
    const lim = o.limit || Infinity;
    let at = 0;
    while (out.length < lim) {
      const i = t.indexOf(n, at);
      if (i < 0) break;
      const j = i + n.length;
      if (o.wholeWord && ((isWord(n[0]) && isWord(t[i - 1])) || (isWord(n[n.length - 1]) && isWord(t[j])))) { at = i + 1; continue; }
      out.push([i, j]);
      at = j;
    }
    return out;
  }

  /* elements whose text is not the writer's sentence, and the paragraph-like
     elements a match never crosses */
  const SKIP = 'sup.fn-ref,del.trk-del,del.trk,script,style,noscript,[data-find-skip]';
  const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|TD|TH|TR|TABLE|TBODY|THEAD|BLOCKQUOTE|PRE|SECTION|ARTICLE|ASIDE|FIGURE|FIGCAPTION|DL|DT|DD|HR|HEADER|FOOTER|CAPTION)$/;
  function blockOf(n, stop) {
    for (let e = n.parentNode; e && e !== stop; e = e.parentNode) if (BLOCK.test(e.nodeName)) return e;
    return stop;
  }
  function index(roots, opts) {
    const o = opts || {}, skip = o.skip || SKIP;
    const parts = [], nodes = [], starts = [], owner = [];
    let len = 0, lastBlock = null, lastRoot = -1;
    const nl = () => { if (len && parts[parts.length - 1] !== '\n') { parts.push('\n'); len++; } };
    (roots || []).forEach((r, ri) => {
      if (!r) return;
      const doc = r.ownerDocument || document;
      const w = doc.createTreeWalker(r, 5 /* SHOW_ELEMENT | SHOW_TEXT */, {
        acceptNode(n) {
          if (n.nodeType === 1) {
            if (n.matches && n.matches(skip)) return 2; /* FILTER_REJECT: its text too */
            return n.nodeName === 'BR' ? 1 : 3;
          }
          return 1;
        }
      });
      let n;
      while ((n = w.nextNode())) {
        if (n.nodeType === 1) { nl(); continue; }
        const v = n.nodeValue;
        if (!v) continue;
        const b = blockOf(n, r);
        if (ri !== lastRoot || b !== lastBlock) nl();
        lastBlock = b; lastRoot = ri;
        nodes.push(n); starts.push(len); owner.push(ri);
        parts.push(v); len += v.length;
      }
      nl();
    });
    return { text: parts.join(''), nodes, starts, owner, roots };
  }
  /* the text node holding place p: for a start, the node it begins in; for
     an end, the node it ends in */
  function nodeAt(ix, p, isEnd) {
    const s = ix.starts;
    let lo = 0, hi = s.length - 1, k = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (isEnd ? s[m] < p : s[m] <= p) { k = m; lo = m + 1; } else hi = m - 1;
    }
    if (k < 0) return null;
    const node = ix.nodes[k], off = p - s[k];
    if (off < 0 || off > node.nodeValue.length) return null;
    return { node, off, k };
  }
  function range(ix, start, end, Static) {
    const a = nodeAt(ix, start, false), b = nodeAt(ix, end, true);
    if (!a || !b) return null;
    if (Static) {
      try { return new Static({ startContainer: a.node, startOffset: a.off, endContainer: b.node, endOffset: b.off }); } catch (e) { /* the live kind below */ }
    }
    const doc = a.node.ownerDocument || document;
    const r = doc.createRange();
    r.setStart(a.node, a.off); r.setEnd(b.node, b.off);
    return r;
  }
  function context(text, start, end, before, after) {
    const B = before || 42, A = after || 64;
    let ls = text.lastIndexOf('\n', start - 1) + 1, le = text.indexOf('\n', end);
    if (le < 0) le = text.length;
    let s = Math.max(ls, start - B), e = Math.min(le, end + A);
    if (s > ls) { const sp = text.indexOf(' ', s); if (sp >= 0 && sp < start) s = sp + 1; }
    if (e < le) { const sp = text.lastIndexOf(' ', e); if (sp > end) e = sp; }
    return { pre: (s > ls ? '…' : '') + text.slice(s, start), hit: text.slice(start, end), post: text.slice(end, e) + (e < le ? '…' : '') };
  }
  function replaceAll(ix, matches, rep, opts) {
    const o = opts || {};
    let n = 0;
    for (let q = matches.length - 1; q >= 0; q--) {
      const [s, e] = matches[q];
      const a = nodeAt(ix, s, false), b = nodeAt(ix, e, true);
      if (!a || !b) continue;
      if (o.track) {
        const doc = a.node.ownerDocument || document, r = doc.createRange();
        r.setStart(a.node, a.off); r.setEnd(b.node, b.off);
        o.track(r, rep); n++; continue;
      }
      if (a.k === b.k) {
        const v = a.node.nodeValue;
        a.node.nodeValue = v.slice(0, a.off) + rep + v.slice(b.off);
      } else {
        a.node.nodeValue = a.node.nodeValue.slice(0, a.off) + rep;
        for (let k = a.k + 1; k < b.k; k++) ix.nodes[k].nodeValue = '';
        b.node.nodeValue = b.node.nodeValue.slice(b.off);
      }
      n++;
    }
    return n;
  }

  const api = { fold, find, index, range, context, replaceAll, nodeAt, SKIP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKFIND = api;
})(typeof self !== 'undefined' ? self : this);
