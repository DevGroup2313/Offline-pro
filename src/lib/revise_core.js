/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.45: a paragraph, a section or the whole document revised at once,
   change by change (INKREVISE). Tested in tools/revise/revise_test.js.

   - scope(text, caret, kind): the stretch to revise: 'para' the paragraph
     the cursor is in, 'section' from the heading above the cursor to the
     next heading of its level or higher, 'doc' all of it.
   - paragraphs(text, from, to): the writer's own paragraphs in a stretch,
     as {start, end, text}. Headings, a note's text in the Notes, the
     References or Bibliography, a contents list, a table and code are left
     out.
   - fromEdits(orig, offset, edits): the notes with a fix inside one
     paragraph made into a version of it, with each change as a group
     {as, ae, bs, be, from, to, reasons, alts}, the form the Rewrite card's
     change list uses, so a correction and a rewrite are kept or refused in
     the same way.
   - apply(text, items): each paragraph's chosen wording put in, the last
     first; a paragraph that is no longer as it was is left alone and
     counted. */
(function (root) {
  'use strict';

  const BACK = /^(?:references|reference list|bibliography|works cited|sources|literature|notes|endnotes|footnotes|abbreviations|list of abbreviations|glossary|contents|table of contents|index)\b/i;
  function headings(t) {
    const out = [];
    for (const m of t.matchAll(/^(#{1,6})[ \t]*(.*)$/gm)) out.push({ at: m.index, end: m.index + m[0].length, level: m[1].length, text: m[2].trim() });
    return out;
  }
  function sectionEnd(t, H, i) {
    for (let j = i + 1; j < H.length; j++) if (H[j].level <= H[i].level) return H[j].at;
    return t.length;
  }
  /* the paragraph the cursor is in: between blank lines, and a note of the
     Notes on its own */
  function paraAt(t, p) {
    p = Math.max(0, Math.min(t.length, p));
    let a = p, b = p;
    while (a > 0 && !(t[a - 1] === '\n' && (t[a - 2] === '\n' || /^\[\^[^\]\s]{1,12}\]:/.test(t.slice(a, a + 16))))) a--;
    while (b < t.length && !(t[b] === '\n' && (t[b + 1] === '\n' || /^\n\[\^[^\]\s]{1,12}\]:/.test(t.slice(b, b + 17))))) b++;
    return [a, b];
  }
  function scope(text, caret, kind) {
    const t = String(text || '');
    if (kind === 'doc') return { from: 0, to: t.length, kind, label: 'the whole document' };
    if (kind === 'para') { const [a, b] = paraAt(t, caret); return { from: a, to: b, kind, label: 'this paragraph' }; }
    const H = headings(t);
    let i = -1;
    for (let j = 0; j < H.length; j++) if (H[j].at <= caret) i = j;
    if (i < 0) return { from: 0, to: H.length ? H[0].at : t.length, kind, label: H.length ? 'the opening, before the first heading' : 'the whole document' };
    return { from: H[i].at, to: sectionEnd(t, H, i), kind, label: '“' + H[i].text + '”', head: H[i].text };
  }
  function paragraphs(text, from, to) {
    const t = String(text || ''), H = headings(t), out = [];
    from = Math.max(0, from || 0); to = Math.min(t.length, to == null ? t.length : to);
    /* the back matter, left out */
    const back = [];
    H.forEach((h, i) => { if (BACK.test(h.text)) back.push([h.at, sectionEnd(t, H, i)]); });
    const inBack = x => back.some(r => x >= r[0] && x < r[1]);
    const re = /\n{2,}|\n(?=\[\^[^\]\s]{1,12}\]:)/g;
    let last = 0, m;
    const push = (a, b) => {
      if (b <= from || a >= to) return;
      a = Math.max(a, from); b = Math.min(b, to);
      let s = t.slice(a, b);
      const lead = s.length - s.replace(/^\s+/, '').length;
      s = s.trim();
      if (!s) return;
      a += lead;
      if (/^#{1,6}\s/.test(s) || /^\[\^[^\]\s]{1,12}\]:/.test(s) || /^\s*\|/.test(s) || /^```/.test(s) || /^!\[/.test(s) || /^-{3,}$|^\*{3,}$/.test(s)) return;
      if (inBack(a)) return;
      if ((s.match(/[\p{L}]+/gu) || []).length < 3) return;
      out.push({ start: a, end: a + s.length, text: s });
    };
    while ((m = re.exec(t))) { push(last, m.index); last = m.index + m[0].length; }
    push(last, t.length);
    return out;
  }
  function fromEdits(orig, offset, edits) {
    const o = String(orig || ''), off = offset || 0;
    const es = (edits || []).filter(e => typeof e.fix === 'string' && e.start >= off && e.end <= off + o.length && e.end >= e.start)
      .map(e => ({ s: e.start - off, e: e.end - off, fix: e.fix, why: e.why || '', alts: e.alts || [] }))
      .sort((a, b) => a.s - b.s || a.e - b.e);
    const keep = [];
    for (const e of es) { const l = keep[keep.length - 1]; if (l && e.s < l.e) continue; if (o.slice(e.s, e.e) === e.fix) continue; keep.push(e); }
    let v = '', at = 0;
    const G = [];
    for (const e of keep) {
      v += o.slice(at, e.s);
      const bs = v.length;
      v += e.fix;
      G.push({ as: e.s, ae: e.e, bs, be: v.length, from: o.slice(e.s, e.e), to: e.fix, reasons: e.why ? [{ text: e.why }] : [], alts: e.alts.filter(a => typeof a === 'string' && a !== e.fix).slice(0, 3) });
      at = e.e;
    }
    v += o.slice(at);
    return { version: v, groups: G };
  }
  function apply(text, items) {
    let t = String(text || ''), n = 0, skipped = 0;
    const its = (items || []).filter(x => x && typeof x.final === 'string' && x.final !== x.orig).sort((a, b) => b.start - a.start);
    let floor = Infinity;
    for (const x of its) {
      if (x.end > floor || t.slice(x.start, x.end) !== x.orig) { skipped++; continue; }
      t = t.slice(0, x.start) + x.final + t.slice(x.end);
      floor = x.start; n++;
    }
    return { text: t, applied: n, skipped };
  }

  const api = { scope, paragraphs, fromEdits, apply, paraAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKREVISE = api;
})(typeof self !== 'undefined' ? self : this);
