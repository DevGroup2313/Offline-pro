/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.43: the writing mark (INKMARK). A mark for the writing alone, on the
   UK marking scale (0 to 100), read onto four scales: UK undergraduate
   (First, 2:1, 2:2, Third, Fail), UK postgraduate (Distinction, Merit,
   Pass, Fail), and their US letters with grade points.

   What it measures, all offline: accuracy (Inkwell's correctness notes per
   100 words), clarity (its clarity notes per 100 words), the range and
   precision of the vocabulary (word length, variety), sentence craft (very
   long sentences), and register (contractions, exclamations, "you" in
   scholarly writing). Argument, evidence and structure are not judged here:
   that needs a writing model (the page's "Writing and argument" mark).

   Calibrated by hand on a tuning half of essays of known level (the Write &
   Improve learner essays, CEFR A, B and C; native student essays, LOCNESS)
   and on published scholarly prose (open-access philosophy and ethics
   articles), and reported on a held-out half. None of those texts is kept
   in this repository. The calibration put typical medians at about: A 40,
   B 47, C and native student essays mid 50s, published scholarship low 70s.

   The US letters follow the grade scale AACRAO EDGE gives for UK
   undergraduate degrees (70 to 100 A, 60 to 69 B+, 50 to 59 B, 40 to 49 C,
   0 to 39 F), as reproduced with attribution by Arcadia University's study
   abroad office. AACRAO's own postgraduate table is open to subscribers
   only; here the same mark-to-letter reading is applied to the postgraduate
   bands, and a postgraduate mark under 50 (a Fail) reads as F. There is no
   official conversion: a US university may read a UK mark its own way. */
(function (root) {
  'use strict';

  const STOP = new Set(('the of and to a in is that it for as with was on be by this are or not from at which an have has but their they his her its were been also we our can more one all would there what so if about into than other some such these may who will no only them do when your you i my me he she').split(' '));
  const WORD = /[A-Za-z0-9][A-Za-z0-9'’-]*/g;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  /* A heading is a short line with no closing punctuation; it is not a sentence. */
  function prose(text) {
    return String(text || '').split(/\n+/).filter(l => {
      const s = l.trim(); if (!s) return false;
      const n = (s.match(WORD) || []).length;
      return !(n <= 12 && !/[.!?:;"”)\]]$/.test(s));
    }).join('\n');
  }
  function sentences(text) {
    return (prose(text).replace(/\n+/g, ' \n ').match(/[^.!?\n]+(?:[.!?]+["”’)\]]*|\n|$)/g) || [])
      .map(s => (s.match(WORD) || []).length).filter(n => n > 0);
  }

  /* contractions, not possessives: "isn't", "we'll", "it's"; never "Carr's" */
  const CONTR = /\b[A-Za-z]+(?:n['’]t|['’](?:ll|re|ve|m|d))\b|\b(?:it|that|there|what|who|he|she|let|here)['’]s\b/gi;

  function features(text, notes, opts) {
    const t = String(text || ''), o = opts || {};
    const words = (t.match(WORD) || []).length;
    const per = n => words ? 100 * n / words : 0;
    const N = notes || [];
    const g = N.filter(n => n && n.cat === 'g').length;
    const c = N.filter(n => n && n.cat === 'c').length;
    const toks = (prose(t).match(/[A-Za-z][A-Za-z'’-]*/g) || []);
    const avgw = toks.length ? toks.reduce((a, w) => a + w.replace(/['’]s$/, '').length, 0) / toks.length : 0;
    const lw = toks.map(w => w.toLowerCase());
    let mt = 0, nw = 0;
    for (let i = 0; i + 50 <= lw.length; i += 10) { mt += new Set(lw.slice(i, i + 50)).size / 50; nw++; }
    const sl = sentences(t);
    return {
      words, sentences: sl.length,
      correctness: per(g), clarity: per(c),
      avgWord: avgw, variety: nw ? mt / nw : 0,
      longShare: sl.length ? sl.filter(n => n > 45).length / sl.length : 0,
      medianSentence: median(sl),
      contractions: per((t.match(CONTR) || []).length),
      exclamations: per((t.match(/!/g) || []).length),
      you: per((t.match(/\byou(?:r|rs|rself)?\b/gi) || []).length),
      scholarly: !!o.scholarly
    };
  }

  /* each part in marks, added to a base of 58; the parts are shown to the
     writer so the mark can be checked against the page */
  function mark(text, notes, opts) {
    const f = features(text, notes, opts);
    const parts = {
      /* long words earn marks only up to the length usual in good
         scholarly prose (about 5.4 letters); longer is not better */
      vocabulary: clamp((f.avgWord - 4.2) * 12, -4, 14) + clamp((f.variety - 0.78) * 50, -3, 4),
      accuracy: -clamp(f.correctness * 2.5, 0, 22),
      clarity: -clamp(f.clarity * 1.5, 0, 12),
      sentences: -clamp(f.longShare * 25, 0, 6),
      register: -clamp((f.contractions + f.exclamations) * (f.scholarly ? 2 : 1) + (f.scholarly ? f.you : 0), 0, 8)
    };
    let m = 58;
    for (const k in parts) { parts[k] = Math.round(parts[k] * 10) / 10; m += parts[k]; }
    m = Math.round(clamp(m, 0, 100));
    return { mark: m, parts, features: f, enough: f.words >= 150 };
  }

  /* the four readings of one UK mark */
  const UG = [[70, 'First'], [60, '2:1'], [50, '2:2'], [40, 'Third'], [0, 'Fail']];
  const PG = [[70, 'Distinction'], [60, 'Merit'], [50, 'Pass'], [0, 'Fail']];
  const US = [[70, 'A', 4.0], [60, 'B+', 3.3], [50, 'B', 3.0], [40, 'C', 2.0], [0, 'F', 0.0]];
  const band = (tab, m) => tab.find(r => m >= r[0]);
  function scales(m) {
    const us = band(US, m);
    const usPG = m >= 50 ? us : ['', 'F', 0.0];
    return {
      mark: m,
      ukUG: band(UG, m)[1],
      ukPG: band(PG, m)[1],
      usUG: { letter: us[1], points: us[2] },
      usPG: { letter: usPG[1], points: usPG[2] }
    };
  }
  /* "Writing and argument": the writing mark and the argument criteria a
     model marks 1 to 5, each criterion read onto the UK scale (5 = 75,
     4 = 65, 3 = 55, 2 = 45, 1 = 35), equal parts writing and argument */
  const CRIT = { 5: 75, 4: 65, 3: 55, 2: 45, 1: 35 };
  function combined(writing, criteria) {
    const ms = (criteria || []).map(c => CRIT[Math.round(c)]).filter(x => x !== undefined);
    if (!ms.length) return writing;
    const arg = ms.reduce((a, b) => a + b, 0) / ms.length;
    return Math.round((writing + arg) / 2);
  }

  const api = { features, mark, scales, combined, prose, sentences, UG, PG, US };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKMARK = api;
})(typeof self !== 'undefined' ? self : this);
