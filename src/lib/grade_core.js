/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.49: marking without a model (INKGRADE). A rubric line is read for what
   it asks (structure, argument, evidence, clarity, vocabulary, register,
   mechanics, the introduction, the conclusion) and marked 1 to 5 from what
   Inkwell can count on the page: paragraphs and the sentences that open
   them, the words that signpost, claim, reason, concede and conclude, the
   citations, quotations, figures and examples. Each mark comes with what
   was counted, the place on the page that most needs work, and one way to
   raise it. A line Inkwell cannot count is left to the writer, with a
   question to ask of the page.

   These are counts, not an examiner's judgement: a page can tick every
   box and still argue badly. The bands were set by hand so that the
   measures rise with known level: learner essays (Write & Improve, CEFR A,
   B and C), native student essays (LOCNESS) and published scholarship
   (open-access articles); none of those texts is kept in this repository.

   INKGRADE.kind(name, desc)     the kind of a rubric line, or ''
   INKGRADE.measure(text)        the counts (paragraphs, signposts, sources)
   INKGRADE.criterion(kind, m, o) {mark, said: [...], at: {start, end} | null,
                                  tip}; o.lang is INKMARK.mark's result,
                                  o.scholarly the register */
(function (root) {
  'use strict';
  const WORD = /[A-Za-z][A-Za-z'’-]*/g;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const STOP = new Set(('the of and to a in is that it for as with was on be by this are or not from at which an have has but their they his her its were been also we our can more one all would there what so if about into than them these those such may other some its when who will no only how most any each both very much many do does did could should might must just over between through after before because while where up out then however also own same well even our us you your i me my he she him we they')
    .split(' '));
  const lc = s => String(s || '').toLowerCase();

  /* paragraphs: blank-line or line-break separated prose, headings and the
     notes section left out; each with its place in the text */
  function paragraphs(text) {
    const t = String(text || ''), out = [];
    const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g; let m, notes = false;
    while ((m = re.exec(t))) {
      const s = m[0].trim(); if (!s) continue;
      if (/^#{1,6}\s*notes\s*$/i.test(s) || /^(?:notes|references|bibliography|works cited|sources)\s*:?$/i.test(s)) { notes = true; continue; }
      if (/^\[\^[^\]]+\]:/.test(s) || /^#{1,6}\s/.test(s)) continue;
      const words = (s.match(WORD) || []).length;
      if (words <= 12 && !/[.!?:;"”)\]]$/.test(s)) continue;     /* a heading */
      if (notes) continue;
      out.push({ start: m.index + m[0].indexOf(s), text: s, words });
    }
    return out;
  }
  function sentences(p) {
    const out = []; const re = /[^.!?]+(?:[.!?]+["”’)\]]*|$)/g; let m;
    while ((m = re.exec(p.text))) { const s = m[0].trim(); if ((s.match(WORD) || []).length >= 2) out.push({ start: p.start + m.index + m[0].indexOf(s), text: s }); }
    return out;
  }
  const content = s => (lc(s).match(/[a-z][a-z'’-]{2,}/g) || []).filter(w => !STOP.has(w)).map(w => w.replace(/(?:ies|es|s|ing|ed|ly)$/, ''));

  const R = {
    signpost: /^(?:however|moreover|furthermore|in addition|additionally|first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|lastly|in contrast|by contrast|similarly|likewise|therefore|thus|hence|consequently|as a result|on the other hand|on the one hand|another|also|equally|in turn|this|these|such|yet|nevertheless|nonetheless|meanwhile|next|then|to begin|to start|in conclusion|to conclude|overall|in sum|in short|for example|for instance|turning to|beyond this|at the same time|despite this)\b/i,
    thesis: /\b(?:I (?:will )?(?:argue|contend|suggest|propose|show|claim|maintain|examine|explore|consider)|we (?:will )?(?:argue|contend|suggest|propose|show|claim|examine|explore)|this (?:essay|paper|article|chapter|thesis|study|report|piece) (?:will |aims to |seeks to |sets out to )?(?:argue|argues|show|shows|examine|examines|explore|explores|consider|considers|suggest|suggests|propose|proposes|contend|contends|discuss|discusses|focus|focuses)|in this (?:essay|paper|article|chapter|study)|the aim of this|my (?:argument|claim|view|position|contention) is|I believe|in my (?:opinion|view)|I think that)\b/i,
    stance: /\b(?:should|must|ought to|is essential|is necessary|is crucial|is vital|is better|is worse|is right|is wrong|is the best|is the most)\b/i,
    reason: /\b(?:because|since|therefore|thus|hence|consequently|as a result|so that|which means|it follows|for this reason|this means|this shows|this suggests|this indicates|due to|owing to|given that|in order to)\b/gi,
    concede: /\b(?:however|although|though|whereas|on the other hand|admittedly|critics|opponents|some (?:argue|claim|believe|may argue|might argue|would argue)|it (?:could|might|may) be argued|nevertheless|nonetheless|despite|even so|granted|to be sure|by contrast|in contrast|yet)\b/gi,
    hedge: /\b(?:may|might|could|perhaps|possibly|likely|unlikely|appears?|seems?|suggests?|indicates?|arguably|tends? to|in part|to some extent)\b/gi,
    boost: /\b(?:clearly|obviously|undoubtedly|certainly|definitely|of course|always|never|everyone|nobody|proves?|without (?:a )?doubt)\b/gi,
    conclude: /\b(?:in conclusion|to conclude|to sum up|in sum|in summary|overall|all in all|to summari[sz]e|in short|this (?:essay|paper|article|chapter) has|I have (?:argued|shown|suggested)|we have (?:argued|shown|seen)|taken together|ultimately)\b/i,
    citeAY: /\([A-Z][A-Za-z'’\-]+(?: (?:et al\.|and|&) [A-Z][A-Za-z'’\-]+)?,? (?:1[5-9]|20)\d\d[a-z]?(?:[,:] ?(?:p{1,2}\. ?)?[\d–-]+)?(?:; ?[^)]{3,60})?\)|[A-Z][A-Za-z'’\-]+(?: (?:et al\.|and|&) [A-Z][A-Za-z'’\-]+)? \((?:1[5-9]|20)\d\d[a-z]?(?:[,:] ?(?:p{1,2}\. ?)?[\d–-]+)?\)/g,
    citeNum: /\[(?:\d{1,3}(?:[,–-] ?\d{1,3})*)\]|\[\^[^\]\s]{1,12}\]|\(\d{1,3}(?:[,–-] ?\d{1,3})*\)(?=[\s.,;:])/g,
    quote: /["“][^"”\n]{12,}?["”]/g,
    data: /\b\d+(?:[.,]\d+)?\s?(?:%|per ?cent|percent|million|billion|thousand|km|kg|cm|mm|hours?|years?|people|patients|participants|respondents)\b|\b(?:1[5-9]|20)\d\d\b/g,
    example: /\b(?:for example|for instance|such as|e\.g\.|in the case of|to illustrate|as an example|a case in point|namely)\b/gi,
    refList: /(?:^|\n)\s*(?:#{1,6}\s*)?(?:references|bibliography|works cited|sources|notes)\s*:?\s*\n/i
  };
  const count = (re, s) => (String(s).match(re) || []).length;

  function measure(text) {
    const t = String(text || ''), P = paragraphs(t);
    const words = P.reduce((a, p) => a + p.words, 0);
    const per = n => words ? 100 * n / words : 0;
    const body = P.length >= 3 ? P.slice(1, -1) : P.slice();
    /* a paragraph's opening sentence names its topic when it shares a word
       with what the paragraph goes on to say most */
    const opens = P.map(p => {
      const S = sentences(p); if (S.length < 2) return { p, ok: null, first: S[0] || null };
      const rest = {}; S.slice(1).forEach(s => content(s.text).forEach(w => { rest[w] = (rest[w] || 0) + 1; }));
      const key = new Set(Object.keys(rest).filter(w => rest[w] >= 2));
      return { p, ok: content(S[0].text).some(w => key.has(w)) || key.size === 0, first: S[0] };
    });
    const links = P.slice(1).map((p, i) => {
      const S = sentences(p), first = S[0] ? S[0].text : p.text;
      const prev = new Set(content(P[i].text));
      return { p, ok: R.signpost.test(first.replace(/^[^A-Za-z]+/, '')) || content(first).some(w => prev.has(w)), first: S[0] || null };
    });
    const intro = P[0] ? P[0].text : '', last = P.length > 1 ? P[P.length - 1].text : '';
    const thesisAt = (() => {
      const scope = P.slice(0, Math.max(1, Math.ceil(P.length * 0.25)));
      for (const p of scope) for (const s of sentences(p)) if (R.thesis.test(s.text) || R.stance.test(s.text)) return s;
      return null;
    })();
    /* the body only: headings, notes and the reference list are not support */
    const B = P.map(p => p.text).join('\n');
    const cites = count(R.citeAY, B) + count(R.citeNum, B);
    const bodyEv = body.map(p => ({ p, n: count(R.citeAY, p.text) + count(R.citeNum, p.text) + count(R.quote, p.text) + count(R.data, p.text) + count(R.example, p.text) }));
    return {
      words, paragraphs: P.length, P,
      paraMedian: P.length ? P.map(p => p.words).sort((a, b) => a - b)[Math.floor(P.length / 2)] : 0,
      opens, links,
      openShare: (() => { const o = opens.filter(x => x.ok !== null); return o.length ? o.filter(x => x.ok).length / o.length : 0; })(),
      linkShare: links.length ? links.filter(x => x.ok).length / links.length : 0,
      thesis: thesisAt, concludes: !!last && (R.conclude.test(last) || (thesisAt && content(thesisAt.text).filter(w => content(last).includes(w)).length >= 2)),
      reasons: per(count(R.reason, B)), concessions: count(R.concede, B), concedePer: per(count(R.concede, B)),
      hedges: per(count(R.hedge, B)), boosts: per(count(R.boost, B)),
      cites, citesPer500: words ? 500 * cites / words : 0,
      quotes: count(R.quote, B), data: count(R.data, B), examples: count(R.example, B),
      evidencePer500: words ? 500 * (cites + count(R.quote, B) + count(R.data, B) + count(R.example, B)) / words : 0,
      bodyEv, refList: R.refList.test(t) || /\n\s*\[\^[^\]]+\]:/.test(t)
    };
  }

  /* the kind of a rubric line, from its words */
  /* the name decides ("Conclusion: draws the argument together" is a
     conclusion); the description only when the line has no name */
  function kind(name, desc) {
    const s = lc(name || desc);
    const k = [
      ['mechanics', /mechanic|grammar|spelling|punctuation|accuracy|proofread|conventions/],
      ['evidence', /evidence|source|research|citation|cite|referenc|support|example|data|literature|scholarship|reading/],
      ['argument', /argument|thesis|claim|reason|critical|analysis|analys|evaluat|position|persuas|counter|logic|thinking/],
      ['introduction', /introduc|opening|hook/],
      ['conclusion', /conclu|ending|closing/],
      ['structure', /structure|organi[sz]|coheren|cohesion|flow|paragraph|layout|sequenc|progression|transition/],
      ['clarity', /clarity|clear|style|expression|readab|concis|fluen|sentence/],
      ['vocabulary', /vocabular|word choice|diction|lexi|language use|range of language|precision/],
      ['register', /register|tone|audience|formal|voice|purpose/]
    ];
    for (const [n, re] of k) if (re.test(s)) return n;
    return '';
  }

  const band = (x, cuts) => { let m = 1; for (const c of cuts) if (x >= c) m++; return clamp(m, 1, 5); };
  const short = s => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 140 ? s.slice(0, 137) + '…' : s; };

  function criterion(k, M, o) {
    o = o || {}; const lang = o.lang, sch = !!o.scholarly, said = []; let mark = 0, at = null, tip = '';
    const few = M.words < 120;
    if (k === 'structure') {
      const want = M.words >= 600 ? 4 : M.words >= 250 ? 3 : 1;
      const paraOK = M.paragraphs >= want && M.paraMedian <= (sch ? 260 : 200);
      mark = clamp(Math.round(1 + (paraOK ? 1 : 0) + 1.6 * M.openShare + 1.4 * M.linkShare), 1, 5);
      said.push(M.paragraphs + ' paragraph' + (M.paragraphs === 1 ? '' : 's') + ' in ' + M.words + ' words' + (paraOK ? '' : (M.paragraphs < want ? ' (a page this long usually has ' + want + ' or more)' : ' (some paragraphs run long)')));
      const o2 = M.opens.filter(x => x.ok !== null); if (o2.length) said.push(o2.filter(x => x.ok).length + ' of ' + o2.length + ' paragraphs open with a sentence that names what they go on to discuss');
      if (M.links.length) said.push(M.links.filter(x => x.ok).length + ' of ' + M.links.length + ' paragraphs are linked to the one before (a signpost or a shared key word)');
      const weak = M.opens.find(x => x.ok === false) || M.links.find(x => !x.ok);
      if (weak && weak.first) at = { start: weak.first.start, end: weak.first.start + weak.first.text.length, text: short(weak.first.text) };
      tip = weak ? 'Open that paragraph with one sentence that says what it will show, then link it to the paragraph before ("Similarly", "By contrast", or the key word you used last).' : 'The paragraphs open and link well. Check that each one makes only one point.';
    } else if (k === 'argument') {
      const parts = (M.thesis ? 1.3 : 0) + clamp(M.reasons / 0.6, 0, 1) + clamp(M.concessions / (M.words > 500 ? 3 : 1.5), 0, 1.2) + (M.boosts > M.hedges + 0.4 ? -0.5 : 0.5);
      mark = clamp(Math.round(1 + parts), 1, 5);
      said.push(M.thesis ? 'A position is stated near the start: “' + short(M.thesis.text) + '”' : 'No sentence near the start states your position or what the page will argue');
      said.push(M.reasons >= 0.05 ? M.reasons.toFixed(1) + ' reasoning words (because, therefore, this shows…) per 100 words' : 'No reasoning words (because, therefore, this shows…)');
      said.push(M.concessions ? M.concessions + ' place' + (M.concessions === 1 ? '' : 's') + ' where another view is weighed (however, although, critics…)' : 'No other view is weighed');
      if (M.boosts > M.hedges + 0.4) said.push('More certainty words (clearly, always, proves) than careful ones (suggests, may, likely)');
      if (!M.thesis && M.P[0]) { const s = sentences(M.P[0]); const f = s[s.length - 1] || s[0]; if (f) at = { start: f.start, end: f.start + f.text.length, text: short(f.text) }; }
      tip = !M.thesis ? 'End your opening paragraph with one sentence that says what you will argue: "I argue that…", or a plain claim another reader could dispute.'
        : !M.concessions ? 'Weigh one objection: "Some argue that…; however…". Answering it makes your claim stronger.'
        : M.reasons < 0.4 ? 'After each claim, give its reason: "because…", "this shows that…".' : 'Check that every paragraph’s point serves the position you state at the start.';
    } else if (k === 'evidence') {
      const per = M.evidencePer500, c = M.citesPer500;
      mark = band(sch ? c * 0.8 + per * 0.2 : per, sch ? [1, 2.5, 4.5, 7] : [1, 2.5, 4, 6]);
      said.push(M.cites + ' citation' + (M.cites === 1 ? '' : 's') + ', ' + M.quotes + ' quotation' + (M.quotes === 1 ? '' : 's') + ', ' + M.data + ' figure' + (M.data === 1 ? '' : 's') + ' or date' + (M.data === 1 ? '' : 's') + ', ' + M.examples + ' signalled example' + (M.examples === 1 ? '' : 's'));
      said.push(per.toFixed(1) + ' pieces of support per 500 words' + (sch ? '; ' + c.toFixed(1) + ' citations per 500 words' : ''));
      if (sch && M.cites && !M.refList) said.push('Citations, but no reference list or notes');
      const bare = M.bodyEv.find(x => x.n === 0 && x.p.words >= 40);
      if (bare) { const s = sentences(bare.p)[0]; if (s) at = { start: s.start, end: s.start + s.text.length, text: short(s.text) }; }
      tip = bare ? 'That paragraph makes its point without support. Add one source, figure, quotation or example ("For example…", "(Author Year)") and say what it shows.' : 'Every paragraph carries support. Check that each piece is explained, not only cited.';
    } else if (k === 'introduction') {
      const s0 = M.P[0] ? sentences(M.P[0]) : [];
      mark = clamp(1 + (s0.length >= 2 ? 1 : 0) + (M.thesis ? 2 : 0) + (M.P[0] && M.P[0].words >= 40 && M.P[0].words <= 220 ? 1 : 0), 1, 5);
      said.push(M.P[0] ? 'The opening paragraph has ' + s0.length + ' sentence' + (s0.length === 1 ? '' : 's') + ' and ' + M.P[0].words + ' words' : 'No opening paragraph');
      said.push(M.thesis ? 'It states a position: “' + short(M.thesis.text) + '”' : 'It does not state what the page will argue');
      if (s0[0]) at = { start: s0[0].start, end: s0[0].start + s0[0].text.length, text: short(s0[0].text) };
      tip = M.thesis ? 'Make the first sentence earn attention: a question, a tension or a striking fact from your topic.' : 'Move from the topic, to the problem, to your answer in one sentence at the end of the opening.';
    } else if (k === 'conclusion') {
      const lp = M.paragraphs > 1 ? M.P[M.paragraphs - 1] : null;
      mark = clamp(1 + (lp ? 1 : 0) + (M.concludes ? 2 : 0) + (lp && /\b(?:implication|significan|matters|future|further|should|limitation|question)\w*/i.test(lp.text) ? 1 : 0), 1, 5);
      said.push(lp ? 'The closing paragraph has ' + lp.words + ' words' : 'No closing paragraph');
      said.push(M.concludes ? 'It draws the page together (a summing-up or your opening claim again)' : 'It does not return to your main claim');
      if (lp) { const s = sentences(lp); const f = s[s.length - 1]; if (f) at = { start: f.start, end: f.start + f.text.length, text: short(f.text) }; }
      tip = M.concludes ? 'End with why it matters, or the question it leaves open, not only a summary.' : 'Restate your answer in new words, then say why it matters.';
    } else if (k === 'clarity' && lang) {
      const f = lang.features; mark = band(-(f.clarity * 1.2 + f.longShare * 10), [-6, -4, -2.4, -1.2]);
      said.push(f.clarity.toFixed(1) + ' clarity notes per 100 words'); said.push('Typical sentence ' + f.medianSentence + ' words; ' + Math.round(f.longShare * 100) + '% of sentences over 45 words');
      tip = f.longShare > 0.1 ? 'Split the longest sentences: one idea each.' : 'Read the clarity notes on the page; each one says what to cut or move.';
    } else if (k === 'vocabulary' && lang) {
      const f = lang.features; mark = band((f.avgWord - 4.2) * 2 + (f.variety - 0.7) * 10, [-0.6, 0.2, 1, 1.8]);
      said.push('Average word ' + f.avgWord.toFixed(1) + ' letters; variety ' + Math.round(f.variety * 100) + ' different words in every 100');
      tip = 'Where a word repeats in a paragraph, try the alternatives Inkwell offers when you select it.';
    } else if (k === 'register' && lang) {
      const f = lang.features, bad = f.contractions + f.exclamations + (sch ? f.you : 0);
      mark = band(-bad, [-3, -1.5, -0.6, -0.2]);
      said.push(f.contractions.toFixed(1) + ' contractions, ' + f.exclamations.toFixed(1) + ' exclamations' + (sch ? ', ' + f.you.toFixed(1) + ' uses of "you"' : '') + ' per 100 words');
      tip = sch ? 'In scholarly writing, write words in full and address the subject, not the reader.' : 'Keep one register from start to finish.';
    } else return null;
    if (few) { mark = Math.min(mark, 3); said.push('The page is short, so the counts say little yet'); }
    return { mark, said, at, tip, by: 'Inkwell' };
  }

  const api = { kind, measure, criterion, paragraphs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKGRADE = api;
})(typeof self !== 'undefined' ? self : this);
