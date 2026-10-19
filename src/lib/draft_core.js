/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.49: "Draft with me" (INKDRAFT), without a model. Inkwell asks the few
   questions a piece of a given kind answers (a paragraph: its point, the
   reason, the evidence, what the evidence shows, the link onward), the
   writer answers in their own words, and Inkwell joins the answers into
   prose with the connecting words the register wants. Every sentence keeps
   the name of the move it makes, so the draft also shows how such a piece
   is built. Inkwell adds connecting words only; the ideas, facts and
   sources are the writer's.

   INKDRAFT.KINDS                  {key: {label, about, steps: [{role, q, ph, opt}]}}
   INKDRAFT.build(kind, answers, reg)  {text, parts: [{role, text}], missing: [roles]} */
(function (root) {
  'use strict';
  const KINDS = {
    paragraph: {
      label: 'An argument paragraph',
      about: 'A paragraph that argues moves from its point, to the reason, to the evidence, to what the evidence shows, and then onward.',
      steps: [
        { role: 'Point', q: 'What is the one point this paragraph makes?', ph: 'Remote work has made the city centre matter less to careers.' },
        { role: 'Reason', q: 'Why is it true? Give the reason.', ph: 'many firms now hire people wherever they live' },
        { role: 'Evidence', q: 'What shows it? A source, a figure, a quotation or an example.', ph: 'in 2023 a third of new posts at one large bank were fully remote (Smith 2024)' },
        { role: 'Meaning', q: 'What does that evidence show about your point?', ph: 'the old pull of the office is weakening' },
        { role: 'Link', q: 'Where does this lead: your next point, or back to your main claim? (You may leave it.)', ph: 'this shift changes what young graduates look for in a city', opt: true }
      ]
    },
    introduction: {
      label: 'An introduction',
      about: 'An introduction moves from the topic, to the problem in it, to your answer, and says the route the page will take.',
      steps: [
        { role: 'Topic', q: 'What is the subject, in one sentence a newcomer would follow?', ph: 'Cities have long drawn workers to their centres.' },
        { role: 'Problem', q: 'What is unsettled or puzzling about it?', ph: 'it is no longer clear that they still do' },
        { role: 'Answer', q: 'What is your answer, the claim you will defend?', ph: 'remote work is moving careers away from the centre' },
        { role: 'Route', q: 'In what order will you show it? (You may leave it.)', ph: 'the page looks first at hiring, then at housing, then at what remains' , opt: true }
      ]
    },
    conclusion: {
      label: 'A conclusion',
      about: 'A conclusion gives the answer again in new words, gathers the main points, says why it matters, and may name what is still open.',
      steps: [
        { role: 'Answer', q: 'What, in the end, is your answer? Say it in new words.', ph: 'the centre has lost its hold on working life' },
        { role: 'Points', q: 'Which main points brought you there?', ph: 'hiring has spread out and housing has followed' },
        { role: 'Significance', q: 'Why does it matter, and to whom?', ph: 'planners still build as if the old pattern held' },
        { role: 'Open question', q: 'What is still open? (You may leave it.)', ph: 'whether the change will last once offices adapt', opt: true }
      ]
    },
    email: {
      label: 'An email or letter',
      about: 'A clear message says who it is for and why at once, gives what the reader needs, asks plainly, and closes.',
      steps: [
        { role: 'To', q: 'Who is it for?', ph: 'Dr Patel' },
        { role: 'Purpose', q: 'Why are you writing? Say it as you would aloud.', ph: 'ask for a short extension on the second essay' },
        { role: 'Details', q: 'What does the reader need to know?', ph: 'I was ill last week and have a note from the health centre' },
        { role: 'Request', q: 'What exactly do you ask, and by when?', ph: 'could I hand it in by Friday the 24th' },
        { role: 'From', q: 'Your name, as you sign it.', ph: 'Sam' }
      ]
    },
    summary: {
      label: 'A summary of a source',
      about: 'A summary names the source, gives its main claim, says how it argues, and ends with your own view of it.',
      steps: [
        { role: 'Source', q: 'Who wrote it, and what is it?', ph: 'In her 2019 study of remote teams, Jones' },
        { role: 'Claim', q: 'What is its main claim?', ph: 'argues that trust, not tools, decides whether such teams work' },
        { role: 'Method', q: 'How does it argue or what does it rest on?', ph: 'she draws on interviews with forty managers' },
        { role: 'Your view', q: 'What do you make of it? (You may leave it.)', ph: 'her sample is small, but the pattern is clear', opt: true }
      ]
    }
  };

  /* the opening words that already connect, so Inkwell adds none */
  const JOINED = /^(?:because|since|as|this|that|these|those|thus|so|therefore|hence|for example|for instance|according|in |as |by |however|moreover|furthermore|in turn|yet|but|and|which|it follows|consequently|overall|in conclusion|to conclude|finally|first|to show|i |we )/i;
  /* a first word that may lose its capital inside a sentence */
  const COMMON = /^(?:the|a|an|this|that|these|those|it|its|there|their|they|people|many|most|some|our|we|he|she|his|her|one|each|every|all|no|not|more|less|new|old|in|on|at|for|with|from|by|of|to|as|when|while|if|because|since|after|before|remote|work|students|cities|firms|planners)\b/i;
  const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const low = s => (s && COMMON.test(s) && !/^I\b/.test(s)) ? s[0].toLowerCase() + s.slice(1) : s;
  const stop = s => /[.!?…]["”’)]?$/.test(s) ? s : s.replace(/[,;:]+$/, '') + '.';
  const join = (lead, s) => (JOINED.test(s) ? cap(s) : lead + low(s));

  const LEADS = {
    scholarly: { reason: 'This is so because ', evidence: 'For example, ', meaning: 'This suggests that ', link: 'In turn, ', problem: 'Yet ', answer: 'I argue that ', route: 'To show this, ', concl: 'In conclusion, ', points: 'As the preceding sections show, ', sig: 'This matters because ', open: 'What remains open is ', view: 'In my view, ' },
    professional: { reason: 'This is because ', evidence: 'For example, ', meaning: 'This shows that ', link: 'As a result, ', problem: 'Yet ', answer: 'This piece argues that ', route: 'To show this, ', concl: 'In short, ', points: 'As we have seen, ', sig: 'This matters because ', open: 'A question remains: ', view: 'In my view, ' },
    casual: { reason: 'That’s because ', evidence: 'For example, ', meaning: 'So ', link: 'And ', problem: 'But ', answer: 'I think ', route: 'Here’s how: ', concl: 'So, all told, ', points: 'We’ve seen that ', sig: 'It matters because ', open: 'What I still wonder is ', view: 'For me, ' }
  };

  function build(kind, answers, reg) {
    const K = KINDS[kind] || KINDS.paragraph, L = LEADS[reg] || LEADS[reg === 'creative' ? 'casual' : 'professional'];
    const A = (answers || []).map(tidy), parts = [], missing = [];
    K.steps.forEach((st, i) => {
      const a = A[i] || '';
      if (!a) { if (!st.opt) missing.push(st.role); return; }
      let t = a;
      if (kind === 'paragraph') {
        t = st.role === 'Point' ? cap(a) : st.role === 'Reason' ? join(L.reason, a) : st.role === 'Evidence' ? (/^["“]/.test(a) ? 'As one source puts it, ' + a : join(L.evidence, a)) : st.role === 'Meaning' ? join(L.meaning, a) : join(L.link, a);
      } else if (kind === 'introduction') {
        t = st.role === 'Topic' ? cap(a) : st.role === 'Problem' ? (/\?$/.test(a) ? cap(a) : join(L.problem, a)) : st.role === 'Answer' ? join(L.answer, a) : join(L.route, a);
      } else if (kind === 'conclusion') {
        t = st.role === 'Answer' ? join(L.concl, a) : st.role === 'Points' ? join(L.points, a) : st.role === 'Significance' ? join(L.sig, a) : (/\?$/.test(a) ? cap(a) : join(L.open, a));
      } else if (kind === 'email') {
        t = st.role === 'To' ? (/^(?:dear|hello|hi)\b/i.test(a) ? cap(a).replace(/[.,]?$/, ',') : (reg === 'casual' ? 'Hi ' : 'Dear ') + a.replace(/[.,]$/, '') + ',')
          : st.role === 'Purpose' ? (/^I\b/.test(a) ? a : 'I am writing to ' + low(a))
          : st.role === 'Request' ? (/^(?:could|would|can|may|please)\b/i.test(a) ? cap(a).replace(/[.]?$/, /^(?:could|would|can|may)\b/i.test(a) ? '?' : '.') : 'Could you ' + low(a).replace(/[.?]?$/, '?'))
          : st.role === 'From' ? (reg === 'casual' ? 'Thanks,\n' : 'With best wishes,\n') + a.replace(/[.,]$/, '')
          : cap(a);
      } else if (kind === 'summary') {
        t = st.role === 'Source' ? cap(a) : st.role === 'Your view' ? join(L.view, a) : a;
      }
      if (!(kind === 'email' && (st.role === 'To' || st.role === 'From' || st.role === 'Request')) && !(kind === 'summary' && st.role === 'Source')) t = stop(t);
      parts.push({ role: st.role, text: t });
    });
    let text;
    if (kind === 'email') {
      const to = parts.find(p => p.role === 'To'), from = parts.find(p => p.role === 'From');
      const body = parts.filter(p => p !== to && p !== from).map(p => p.text).join(' ');
      text = [to && to.text, body, from && from.text].filter(Boolean).join('\n\n');
    } else if (kind === 'summary') {
      /* the source runs into its claim: "In her 2019 study, Jones argues …" */
      const src = parts.find(p => p.role === 'Source'), cl = parts.find(p => p.role === 'Claim');
      const rest = parts.filter(p => p !== src && p !== cl).map(p => cap(p.text));
      const head = src && cl ? stop(src.text.replace(/[.]$/, '') + ' ' + low(cl.text.replace(/^[A-Z]/, c => c))) : (src ? stop(src.text) : cl ? cap(cl.text) : '');
      text = [head].concat(rest).filter(Boolean).join(' ');
    } else text = parts.map(p => p.text).join(' ');
    return { text, parts, missing };
  }

  const api = { KINDS, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.INKDRAFT = api;
})(typeof self !== 'undefined' ? self : this);
