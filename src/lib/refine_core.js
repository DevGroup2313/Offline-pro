/* Inkwell's note refiner (7.42): the last step before the notes are shown.
   Measured on 400 Wikipedia paragraphs and 400 learner sentences (JFLEG) on
   11 October 2026, the rules engine gave advice with nothing to choose in
   68% and 20% of its notes, fell back to a general lesson in 14 and 80 of
   them, and noted the same words twice in 4 and 36 places. This module:
   - removes notes on words that are already correct (a stative "was born",
     a name repeated, a reminder that a word is right);
   - gives each remaining note something concrete: a fix, a few choices to
     try ("Try:"), or a short question whose answer builds the new wording
     ("Who did it?" turns a passive sentence into an active one);
   - removes a note that cannot be given anything concrete, where it is only
     a matter of style;
   - keeps one note per place: two notes on the same words become the more
     useful one;
   - gives every note a lesson of its own kind (lesson()).
   Pure functions; the page passes what it knows (the dictionary, the word
   bank, the register) as helpers. No lookbehind in any regular expression
   (Safari before 16.4). */
(function (root) {
  'use strict';
  const lc = s => String(s == null ? '' : s).toLowerCase();
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const low1 = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  function caseLike(src, dst) {
    if (!dst) return dst;
    src = String(src || '');
    if (src.length > 3 && /^[A-Z][A-Z ’']+$/.test(src) && /[A-Z]{2}/.test(src)) return dst.toUpperCase();
    if (/^[A-Z]/.test(src)) return cap(dst);
    return dst;
  }
  /* does a sentence begin at i (after a full stop, a new line, or the start)? */
  function startsSentence(t, i) {
    let j = i - 1;
    while (j >= 0 && /[ \t"“‘'(\[]/.test(t[j])) j--;
    return j < 0 || /[.!?\n]/.test(t[j]);
  }
  function sentenceAt(t, i) {
    let a = i; while (a > 0 && !/[.!?\n]/.test(t[a - 1])) a--;
    while (a < i && /\s/.test(t[a])) a++;
    let b = i; while (b < t.length && !/[.!?\n]/.test(t[b])) b++;
    if (b < t.length && /[.!?]/.test(t[b])) b++;
    return { start: a, end: b, text: t.slice(a, b) };
  }
  const nextWordAt = (t, i) => { const m = /^\s*([A-Za-z’'-]+)/.exec(t.slice(i, i + 40)); return m ? { start: i + m[0].length - m[1].length, end: i + m[0].length, word: m[1] } : null; };

  /* ---------- verbs ---------- */
  const IRR = {
    written: ['write', 'wrote'], taken: ['take', 'took'], given: ['give', 'gave'], shown: ['show', 'showed'], known: ['know', 'knew'],
    seen: ['see', 'saw'], done: ['do', 'did'], made: ['make', 'made'], found: ['find', 'found'], held: ['hold', 'held'], led: ['lead', 'led'],
    built: ['build', 'built'], sent: ['send', 'sent'], kept: ['keep', 'kept'], told: ['tell', 'told'], brought: ['bring', 'brought'],
    bought: ['buy', 'bought'], taught: ['teach', 'taught'], caught: ['catch', 'caught'], thought: ['think', 'thought'], sought: ['seek', 'sought'],
    drawn: ['draw', 'drew'], grown: ['grow', 'grew'], chosen: ['choose', 'chose'], driven: ['drive', 'drove'], spoken: ['speak', 'spoke'],
    broken: ['break', 'broke'], forgotten: ['forget', 'forgot'], hidden: ['hide', 'hid'], begun: ['begin', 'began'], won: ['win', 'won'],
    understood: ['understand', 'understood'], met: ['meet', 'met'], paid: ['pay', 'paid'], said: ['say', 'said'], eaten: ['eat', 'ate'],
    fallen: ['fall', 'fell'], worn: ['wear', 'wore'], torn: ['tear', 'tore'], thrown: ['throw', 'threw'], blown: ['blow', 'blew'],
    withdrawn: ['withdraw', 'withdrew'], lost: ['lose', 'lost'], felt: ['feel', 'felt'], left: ['leave', 'left'], meant: ['mean', 'meant'],
    dealt: ['deal', 'dealt'], sold: ['sell', 'sold'], heard: ['hear', 'heard'], set: ['set', 'set'], put: ['put', 'put'], read: ['read', 'read'],
    cut: ['cut', 'cut'], run: ['run', 'ran'], hit: ['hit', 'hit'], spread: ['spread', 'spread'], split: ['split', 'split'], proven: ['prove', 'proved'],
    undertaken: ['undertake', 'undertook'], overtaken: ['overtake', 'overtook'], forbidden: ['forbid', 'forbade'], bitten: ['bite', 'bit'],
    ridden: ['ride', 'rode'], stolen: ['steal', 'stole'], frozen: ['freeze', 'froze'], woken: ['wake', 'woke'], shaken: ['shake', 'shook'],
    sung: ['sing', 'sang'], rung: ['ring', 'rang'], struck: ['strike', 'struck'], hung: ['hang', 'hung'], fed: ['feed', 'fed'], bred: ['breed', 'bred'],
    fought: ['fight', 'fought'], won2: ['win', 'won'], bound: ['bind', 'bound'], ground: ['grind', 'ground'], wound: ['wind', 'wound'],
    lit: ['light', 'lit'], shot: ['shoot', 'shot'], spent: ['spend', 'spent'], lent: ['lend', 'lent'], bent: ['bend', 'bent'], dug: ['dig', 'dug'],
    beaten: ['beat', 'beat'], borne: ['bear', 'bore'], sworn: ['swear', 'swore'], sewn: ['sew', 'sewed'], sown: ['sow', 'sowed'], shorn: ['shear', 'sheared'],
    overseen: ['oversee', 'oversaw'], overcome: ['overcome', 'overcame'], rewritten: ['rewrite', 'rewrote'], mistaken: ['mistake', 'mistook'],
    upheld: ['uphold', 'upheld'], withheld: ['withhold', 'withheld'], misled: ['mislead', 'misled'], foreseen: ['foresee', 'foresaw'], laid: ['lay', 'laid']
  };
  delete IRR.won2;
  const PASTOF = {}; for (const k in IRR) PASTOF[IRR[k][0]] = IRR[k][1];
  PASTOF.go = 'went'; PASTOF.have = 'had'; PASTOF.be = 'was'; PASTOF.come = 'came'; PASTOF.get = 'got'; PASTOF.become = 'became';
  function s3(b) {
    if (b === 'have') return 'has'; if (b === 'be') return 'is'; if (b === 'do') return 'does'; if (b === 'go') return 'goes';
    if (/(s|x|z|ch|sh|o)$/.test(b)) return b + 'es';
    if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ies';
    return b + 's';
  }
  /* the base form of a past participle, checked against the dictionary */
  function baseOfPart(p, H) {
    p = lc(p);
    if (IRR[p]) return IRR[p][0];
    if (!/ed$/.test(p) || !(H && H.plain)) return null;
    const st = p.slice(0, -2), tries = [];
    if (/ied$/.test(p)) tries.push(p.slice(0, -3) + 'y');
    tries.push(st + 'e', st);
    if (/([bcdfgklmnprstvz])\1$/.test(st)) tries.push(st.slice(0, -1));
    for (const b of tries) if (b.length > 1 && H.plain(b)) return b;
    return null;
  }
  function pastOf(base, part) {
    if (PASTOF[base]) return PASTOF[base];
    if (part && /ed$/.test(part)) return lc(part);
    if (/e$/.test(base)) return base + 'd';
    if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ied';
    return base + 'ed';
  }
  function gerund(b) {
    if (/ie$/.test(b)) return b.slice(0, -2) + 'ying';
    if (/[^aeiouy]e$/.test(b) && !/(ee|ye|oe)$/.test(b)) return b.slice(0, -1) + 'ing';
    return b + 'ing';
  }
  /* "-ing" back to the base, checked against the dictionary */
  function baseOfIng(w, H) {
    w = lc(w); if (!/ing$/.test(w)) return null;
    const st = w.slice(0, -3), plain = H && H.plain;
    const tries = [st + 'e', st];
    if (/([bcdfgklmnprstvz])\1$/.test(st)) tries.unshift(st.slice(0, -1));
    if (/y$/.test(st)) tries.push(st.slice(0, -1) + 'ie');
    for (const b of tries) if (b.length > 1 && plain && plain(b)) return b;
    return null;
  }

  /* ---------- pronouns ---------- */
  const OBJ = { i: 'me', he: 'him', she: 'her', we: 'us', they: 'them', who: 'whom' };
  const SUBJ = { me: 'I', him: 'he', her: 'she', us: 'we', them: 'they', whom: 'who' };
  const PLURAL_PRON = /^(i|you|we|they)$/;
  const DET = /^(the|a|an|this|that|these|those|its|our|their|his|her|my|your|some|many|most|several|all|both|each|every|no|various|numerous|few|two|three|four|five|six|seven|eight|nine|ten|certain|other|such|any|one|more|less|much|further|later|earlier|early|recent|new|old|local|national|international)$/i;
  function agentNumber(agent) {
    const w = lc(agent).replace(/[^a-z' -]/g, '').trim().split(/\s+/);
    if (!w[0]) return 'sg';
    if (w.length === 1 && (PLURAL_PRON.test(w[0]) || SUBJ[w[0]] && PLURAL_PRON.test(lc(SUBJ[w[0]])))) return 'pl';
    if (w.indexOf('and') > 0) return 'pl';
    const of = w.indexOf('of');
    const head = of > 0 ? w[of - 1] : w[w.length - 1];
    if (/^(one|each|every|either|neither|none|everyone|someone|anyone|nobody|everybody)$/.test(head)) return 'sg';
    if (/^(people|children|men|women|police|staff|data|media|cattle|teeth|feet|mice|geese)$/.test(head)) return 'pl';
    if (/[^su]s$/.test(head) && !/(ss|us|is|ics|ness|sis|ous)$/.test(head)) return 'pl';
    return 'sg';
  }

  /* ---------- passive to active ---------- */
  const AUXRE = /^(was|were|is|are|am|has been|have been|had been|will be|would be|can be|could be|should be|shall be|may be|might be|must be|cannot be|can not be)\s+((?:(?:\w+ly|not|often|also|already|then|thus|now|still|never|always|later|first|once|soon|just|further|initially|subsequently|previously|recently|widely|largely)\s+)*)([a-z]+)\b/i;
  const SUBJ_STOP = /^(that|which|who|whom|because|since|although|though|when|whenever|while|whilst|if|unless|after|before|until|as|whereas|where|and|but|or|so|once|whether|than|nor|why|how|what|wherever)$/i;
  const AUXWORD = /^(is|are|was|were|be|been|being|am|has|have|had|do|does|did|will|would|can|could|should|shall|may|might|must)$/i;
  const PREP = /^(in|on|at|by|for|with|from|during|after|before|since|under|over|through|within|without|among|between|into|upon|across|throughout|despite|of|to|like|about|against|along|around|behind|beyond|near|via|per|amid)$/i;
  const AGENT_STOP = /^(in|on|at|during|after|before|for|with|from|since|until|when|while|because|but|which|who|whom|whose|that|to|as|into|through|under|over|between|among|across|throughout|via|where|than|so|if|or|nor|is|are|was|were|has|have|had|will|would|can|could|should|may|might|must)$/i;
  const BYADV = /^(then|now|contrast|comparison|definition|chance|default|design|nature|means|way|itself|themselves|himself|herself|hand|force|law|far|accident|mistake|necessity|choice|turns|degrees|extension|analogy|convention|tradition|custom|habit|virtue|reference|proxy|mail|post|phone|email|car|bus|train|air|sea|land|night|day|noon|then|far|and|far)\b/i;
  /* participles that, with "be", describe a state rather than an action */
  /* "was born", "is located in": these keep their note only with "by" */
  const STATIVE_STRICT = /^(born|located|situated|based|known|called|named|titled|entitled|married|divorced|engaged|related|involved|interested|concerned|dedicated|devoted|equipped|armed|composed|comprised|supposed|used|accustomed|inclined|qualified|obliged|attached|headquartered|affiliated|aligned|rooted|tired|bored|worried|pleased|surprised|shocked|excited|amazed|confused|disappointed|satisfied|convinced|determined|committed|crowded|dressed|scheduled|aimed|listed|ranked|rated|set|faced|filled|covered|surrounded|connected|linked|associated|exposed|limited|restricted|bound|tied|grounded|centred|centered|characterised|characterized|divided|split|separated|mixed|included|excluded|lost|gone|finished|done|held)$/i;

  function passiveParts(t, at, H) {
    const m = AUXRE.exec(t.slice(at, at + 120));
    if (!m) return null;
    const aux = lc(m[1]).replace('can not', 'cannot'), advs = m[2].trim(), part = m[3];
    const pl = lc(part);
    if (!IRR[pl] && !/ed$/.test(pl)) return null;
    const partEnd = at + m[0].length;
    /* the agent */
    let agent = '', agentEnd = partEnd;
    const bm = /^\s+by\s+/i.exec(t.slice(partEnd, partEnd + 6));
    if (bm) {
      const rest = t.slice(partEnd + bm[0].length, partEnd + bm[0].length + 120);
      const toks = rest.match(/^[^,.;:!?()"“”\n]*/)[0].split(/(\s+)/);
      let words = [], used = 0;
      for (let i = 0; i < toks.length; i += 2) {
        const w = toks[i]; if (!w) break;
        if (AGENT_STOP.test(w) && words.length) break;
        if (lc(w) === 'and' && words.length) {
          const nx = toks[i + 2] || '';
          if (!(/^[A-Z]/.test(nx) || DET.test(nx))) break;
        }
        words.push(w); used = toks.slice(0, i + 1).join('').length;
        if (words.length > 7) { words = null; break; }
      }
      if (words && words.length && !BYADV.test(words[0]) && !/^\d/.test(words[0]) && !/ing$/i.test(words[0]) && !/^(it|them|which|whom|that|this|these|those)$/i.test(words.join(' '))) {
        agent = words.join(' ');
        agentEnd = partEnd + bm[0].length + used;
      }
    }
    /* the subject: the words before the auxiliary, back to the clause's start */
    let i = at; while (i > 0 && t[i - 1] === ' ') i--;
    const before = t.slice(Math.max(0, i - 160), i);
    const pieces = before.split(/([,;:(\n—–"“”]|[.!?]\s)/);
    const clause = pieces[pieces.length - 1];
    const ws = clause.split(/\s+/).filter(Boolean);
    let k = ws.length, rel = null;
    while (k > 0) {
      const w = ws[k - 1].replace(/[^A-Za-z'’-]/g, '');
      if (SUBJ_STOP.test(w) && (w === lc(w) || k === 1)) {
        /* "vacancies in the office or on the board are filled": a conjunction
           joining two phrases inside the subject is not its edge */
        if (/^(and|or|nor)$/i.test(w) && k < ws.length && PREP.test(ws[k].replace(/[^A-Za-z]/g, ''))) { k--; continue; }
        if (/^(that|which|who|whom)$/i.test(w) && k === ws.length) rel = ws[k - 1];
        else if (/^(which|who|whom)$/i.test(w)) return null;
        break;
      }
      k--;
    }
    let subjWords = rel ? [rel] : ws.slice(k);
    if (!subjWords.length || subjWords.length > 12) return null;
    if (!rel && (PREP.test(subjWords[0]) || subjWords.some(w => AUXWORD.test(w.replace(/[^A-Za-z]/g, ''))))) return null;
    /* "the plan that we made was approved": the subject is not "we made" */
    if (!rel && subjWords.length > 1 && (/^(i|we|they|he|she|you)$/i.test(subjWords[0]) || /ed$/i.test(subjWords[subjWords.length - 1]))) return null;
    const subj = subjWords.join(' ');
    const subjStart = i - subj.length;
    if (t.slice(subjStart, i) !== subj) return null;
    const base = baseOfPart(pl, H);
    const past = IRR[pl] ? IRR[pl][1] : (/ed$/.test(pl) ? pl : null);
    const dummy = !rel && lc(subj) === 'it' && /^\s+that\b/i.test(t.slice(partEnd, partEnd + 8));
    return { at: at, aux: aux, advs: advs, part: pl, partEnd: partEnd, agent: agent, agentEnd: agentEnd, subj: subj, subjStart: subjStart, rel: rel, base: base, past: past, dummy: dummy, sentStart: startsSentence(t, subjStart) };
  }
  /* the active clause, with the given doer */
  function activeText(P, agent, H) {
    agent = String(agent || '').trim(); if (!agent) return null;
    const agentLc = lc(agent);
    let doer = SUBJ[agentLc] ? SUBJ[agentLc] : agent;
    const num = agentNumber(doer);
    const sg = num === 'sg';
    let neg = false; let advs = P.advs.split(/\s+/).filter(Boolean);
    if (advs.indexOf('not') >= 0) { neg = true; advs = advs.filter(a => a !== 'not'); }
    const adv = advs.length ? advs.join(' ') + ' ' : '';
    let vp = null;
    switch (P.aux) {
      case 'was': case 'were':
        if (neg) { if (!P.base) return null; vp = 'did not ' + adv + P.base; }
        else { if (!P.past) return null; vp = adv + P.past; }
        break;
      case 'is': case 'are': case 'am':
        if (!P.base) return null;
        vp = neg ? (sg ? 'does not ' : 'do not ') + adv + P.base : adv + (sg ? s3(P.base) : P.base);
        break;
      case 'has been': case 'have been':
        vp = (sg ? 'has ' : 'have ') + (neg ? 'not ' : '') + adv + P.part; break;
      case 'had been':
        vp = 'had ' + (neg ? 'not ' : '') + adv + P.part; break;
      default: {
        if (!P.base) return null;
        const modal = P.aux.replace(/ be$/, '');
        vp = modal + (neg && modal !== 'cannot' ? ' not ' : ' ') + adv + P.base;
      }
    }
    if (P.rel) {
      const r = lc(P.rel) === 'who' ? 'whom' : P.rel;
      return { start: P.subjStart, end: P.agent ? P.agentEnd : P.partEnd, text: r + ' ' + doer + ' ' + vp };
    }
    let obj = P.subj;
    const first = obj.split(/\s+/)[0], firstLc = lc(first);
    if (OBJ[firstLc] && obj.split(/\s+/).length === 1) obj = OBJ[firstLc];
    else if (P.sentStart && /^[A-Z][a-z]/.test(first) && (DET.test(first) || (H && H.plain && H.plain(firstLc)))) obj = low1(obj);
    if (P.sentStart) doer = cap(doer);
    else if (DET.test(doer.split(/\s+/)[0]) && /^[A-Z][a-z]/.test(doer)) doer = low1(doer);
    if (P.dummy) return { start: P.subjStart, end: P.agent ? P.agentEnd : P.partEnd, text: doer + ' ' + vp };
    return { start: P.subjStart, end: P.agent ? P.agentEnd : P.partEnd, text: doer + ' ' + vp + ' ' + obj };
  }

  /* ---------- nominalisations ---------- */
  /* the noun, the verb it was made from, and the verb's -ing form: only these
     (a "population" or a "government" is not an action) */
  const NOMRAW = 'creation create|introduction introduce|exhumation exhume|formation form|consideration consider|examination examine|organisation organise|organization organize|implementation implement|evaluation evaluate|investigation investigate|application apply|identification identify|explanation explain|description describe|production produce|reduction reduce|destruction destroy|adoption adopt|protection protect|completion complete|selection select|collection collect|construction construct|acquisition acquire|definition define|contribution contribute|distribution distribute|resolution resolve|development develop|establishment establish|management manage|improvement improve|achievement achieve|assessment assess|treatment treat|payment pay|employment employ|replacement replace|involvement involve|enforcement enforce|measurement measure|performance perform|maintenance maintain|acceptance accept|avoidance avoid|assistance assist|occurrence occur|dependence depend|emergence emerge|persistence persist|resistance resist|attendance attend|analysation analyse|calculation calculate|classification classify|clarification clarify|comparison compare|confirmation confirm|connection connect|correction correct|creation create|demonstration demonstrate|deployment deploy|detection detect|determination determine|discussion discuss|elimination eliminate|enhancement enhance|estimation estimate|expansion expand|exploration explore|extraction extract|facilitation facilitate|generation generate|identification identify|illustration illustrate|imposition impose|inclusion include|integration integrate|interpretation interpret|isolation isolate|justification justify|limitation limit|manipulation manipulate|modification modify|observation observe|operation operate|preparation prepare|preservation preserve|prevention prevent|promotion promote|provision provide|publication publish|recognition recognise|reconstruction reconstruct|recording record|regulation regulate|removal remove|renovation renovate|restoration restore|retention retain|revision revise|separation separate|simplification simplify|submission submit|substitution substitute|termination terminate|transformation transform|translation translate|transmission transmit|utilisation use|utilization use|validation validate|verification verify|allocation allocate|alteration alter|approval approve|arrangement arrange|assembly assemble|consumption consume|conversion convert|deletion delete|delivery deliver|depletion deplete|deterioration deteriorate|elevation elevate|encouragement encourage|enlargement enlarge|execution execute|exclusion exclude|exploitation exploit|imprisonment imprison|inspection inspect|installation install|management manage|mobilisation mobilise|negotiation negotiate|purchase purchase|recruitment recruit|reinforcement reinforce|relocation relocate|resettlement resettle|settlement settle|suppression suppress|transport transport|transportation transport|abolition abolish|annexation annex|appointment appoint|celebration celebrate|commemoration commemorate|demolition demolish|dissolution dissolve|excavation excavate|liberation liberate|occupation occupy|ratification ratify|reformation reform|unification unify|invasion invade|colonisation colonise|colonization colonize';
  const NOM = {};
  NOMRAW.split('|').forEach(p => { const [n, v] = p.split(' '); NOM[n] = v; });
  const NOM_ING = { occur: 'occurring', submit: 'submitting', transmit: 'transmitting', admit: 'admitting', control: 'controlling', commit: 'committing', refer: 'referring', prefer: 'preferring', compel: 'compelling', annex: 'annexing', use: 'using', ratify: 'ratifying', occupy: 'occupying', unify: 'unifying', apply: 'applying', clarify: 'clarifying', classify: 'classifying', identify: 'identifying', justify: 'justifying', modify: 'modifying', simplify: 'simplifying', verify: 'verifying', deploy: 'deploying', employ: 'employing', destroy: 'destroying', pay: 'paying' };

  /* ---------- contractions ---------- */
  const CONTR = {
    "can't": 'cannot', "won't": 'will not', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "isn't": 'is not', "aren't": 'are not',
    "wasn't": 'was not', "weren't": 'were not', "couldn't": 'could not', "shouldn't": 'should not', "wouldn't": 'would not', "haven't": 'have not',
    "hasn't": 'has not', "hadn't": 'had not', "mustn't": 'must not', "mightn't": 'might not', "needn't": 'need not', "let's": 'let us',
    "i'm": 'I am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "i've": 'I have', "you've": 'you have', "we've": 'we have',
    "they've": 'they have', "i'll": 'I will', "you'll": 'you will', "he'll": 'he will', "she'll": 'she will', "it'll": 'it will', "we'll": 'we will',
    "they'll": 'they will', "that's": 'that is', "what's": 'what is', "who's": 'who is', "there's": 'there is', "here's": 'here is', "it's": 'it is',
    "he's": 'he is', "she's": 'she is', "where's": 'where is', "how's": 'how is'
  };
  const CONTR_HAS = /^\s+(been|got|gotten|had)\b/i;
  function expandContraction(orig, after) {
    const k = lc(orig).replace(/’/g, "'");
    if (/'d$/.test(k)) { const p = orig.slice(0, -2); return { alts: [p + ' would', p + ' had'] }; }
    let v = CONTR[k]; if (!v) return null;
    if (/'s$/.test(k) && CONTR_HAS.test(after)) v = v.replace(/ is$/, ' has');
    return { fix: caseLike(orig, v.replace(/^I /, 'I ')) };
  }

  /* ---------- numbers ---------- */
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function numberWord(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    if (n === 100) return 'one hundred';
    return null;
  }

  /* ---------- deleting a phrase cleanly ---------- */
  /* the patch that removes t[start..end): the spaces and a comma that belonged
     to it go too, and a sentence that began with it begins with a capital */
  function cut(t, start, end) {
    let e = end;
    if (t[e] === ',') e++;
    while (t[e] === ' ') e++;
    if (startsSentence(t, start)) {
      const nw = nextWordAt(t, e);
      if (!nw || nw.start !== e) return { start: start, end: e, fix: '' };
      return { start: start, end: nw.end, fix: cap(nw.word) };
    }
    /* "the results, undoubtedly, show" */
    if (t.slice(start - 2, start) === ', ' && t[end] === ',') return { start: start - 2, end: e, fix: ' ' };
    /* "it is true, needless to say." */
    if (/^[.!?;:]/.test(t[e] || '')) { let s = start; while (s > 0 && t[s - 1] === ' ') s--; if (t[s - 1] === ',') s--; return { start: s, end: e, fix: '' }; }
    return { start: start, end: e, fix: '' };
  }

  /* ---------- the table: each rule's concrete alternative ---------- */
  /* spec: alts (choices, in the case of the words), map (choices by the words
     matched), fix (one certain change), del (cut the phrase), ask (a question
     whose answer builds the wording), fn (computed), drop (a note on correct
     text), soft (style: removed if nothing concrete can be offered) */
  const C = (o, a) => caseLike(o, a);
  const SAME = s => s;
  const repl = (re, to) => o => o.replace(re, to);
  const T = [];
  const rule = (prefix, spec) => T.push([prefix, spec]);

  /* notes on words that are correct as written: reminders, not errors */
  ['"Cite" (reference) is correct here', '"Role" (part) is correct', '"Flair" (talent) is correct', '"Trial and error" is correct', '"Had had" can be grammatically correct',
    'Correct spelling is "calendar"', 'Correct spelling is "consensus"', 'Correct: "faze" (disturb)', '"Faze" (disturb) vs "phase" (stage)', '"Advice" (noun) vs "advise" (verb)',
    '"Complement" (completes) vs "compliment"', '"Eminent" (respected) vs "imminent"', '"Waive" (forgo) vs "wave"', '"It has been a long time" or "a long time" alone',
    '"Such that" or "thereby" may be tighter', 'A serial comma before the final "and/or"', '“Pore over” — you pore over a text', '“Averse” reluctance, “adverse” hostility',
    'Sentence ends on a preposition', 'Split infinitive', '“Not only” waits for its', 'Question: state the point', 'A borrowed image', 'Filter word: the scene',
    'Two sentences in a row begin the same way', '“e.g.” opens an illustrative list', 'The basis for it is', '“In my humble opinion”', '“Today’s”, named so'
  ].forEach(p => rule(p, { drop: true }));

  rule('"Imminent" (about to happen) vs "eminent"', { fn: m => ({ fix: m.orig.replace(/^(i)mminent/i, (x, a) => (a === 'I' ? 'E' : 'e') + 'minent') }) });
  rule('"Role" (part) vs "roll"', { fn: m => ({ alts: [m.orig.replace(/roll/i, x => C(x, 'role'))] }) });
  rule('Check: "stationary" means not moving', { fn: m => ({ alts: [C(m.orig, 'stationery')] }) });

  /* grammar */
  rule('Double negative: "can hardly" or "cannot easily"', { fn: m => { const w = lc(m.orig.split(/\s+/)[0]).replace(/’/g, "'"); const pos = { "can't": 'can', cannot: 'can', "couldn't": 'could', "won't": 'will', "wouldn't": 'would', "shouldn't": 'should', cant: 'can', couldnt: 'could', wont: 'will', wouldnt: 'would', shouldnt: 'should' }[w]; return pos ? { fix: C(m.orig, pos) + ' hardly' } : null; } });
  rule('Double negative: "no" becomes "any"', { fn: m => ({ fix: m.orig.replace(/\bno$/i, 'any') }) });
  rule('Double negative — “could hardly”', { fn: m => ({ fix: C(m.orig, 'could hardly') }) });
  rule('Double negative — “hardly” already negates', { fn: (m, t) => { const nw = nextWordAt(t, m.end); if (!nw) return null; const b = lc(nw.word); const p = PASTOF[b] || (m.H && m.H.plain && m.H.plain(b) ? pastOf(b) : null); return p ? { start: m.start, end: nw.end, fix: C(m.orig, 'hardly ' + p) } : null; } });
  rule('Informal word', { map: { gonna: ['going to'], wanna: ['want to'], "ain't": ['is not', 'are not', 'am not'], aint: ['is not', 'are not', 'am not'] } });
  rule('Register — informal speech form', { map: { gonna: ['going to'], wanna: ['want to'], gotta: ['have to', 'must'], kinda: ['somewhat', 'rather'], sorta: ['somewhat', 'rather'], "ain't": ['is not', 'are not'], 'ain’t': ['is not', 'are not'], dunno: ['do not know'], cos: ['because'], cuz: ['because'], ok: ['acceptable', 'satisfactory'], okay: ['acceptable', 'satisfactory'], yeah: ['yes'], nah: ['no'], sup: null, bro: null } });
  rule('Register', { exact: true, map: { ok: ['acceptable', 'satisfactory'], okay: ['acceptable', 'satisfactory'] } });
  rule('"criterion" is the singular', { fn: m => ({ fix: m.orig.replace(/criteria/i, x => C(x, 'criterion')) }) });
  rule('“Phenomenon” is the singular', { fn: m => ({ fix: m.orig.replace(/phenomena/i, x => C(x, 'phenomenon')) }) });
  rule('“Phenomena” is plural; the singular is phenomenon', { fn: m => /are$/i.test(m.orig) ? { drop: true } : { fix: m.orig.replace(/phenomena/i, 'phenomenon') } });
  rule('These are plural: “these data”', { fn: m => { const n = lc(m.orig.split(/\s+/)[1]); const sg = { criteria: 'criterion', bacteria: 'bacterium', media: 'medium' }[n]; return { alts: [C(m.orig, 'these ' + n)].concat(sg ? [C(m.orig, 'this ' + sg)] : []) }; } });
  rule('A plural takes no singular article', { fn: m => { const n = lc(m.orig.split(/\s+/)[1]); const sg = { phenomena: 'phenomenon', criteria: 'criterion', bacteria: 'bacterium' }[n]; return { alts: [C(m.orig, n)].concat(sg ? [C(m.orig, 'a ' + sg)] : []) }; } });
  rule('Confusable', { map: { irregardless: ['regardless'], expresso: ['espresso'], pacifically: ['specifically'] } });
  rule('“Set up” as the verb', { fn: m => ({ fix: m.orig.replace(/^setup/i, x => C(x, 'set up')) }) });
  rule('Agreement — “there are” before a plural', { fn: m => ({ fix: m.orig.replace(/^there's/i, x => C(x, 'there are')) }) });
  rule('Agreement — “there have / there are / there were”', { fn: m => ({ fix: m.orig.replace(/^(there)\s+(has|was|is)\b/i, (x, a, v) => a + ' ' + ({ has: 'have', was: 'were', is: 'are' })[lc(v)]) }) });
  rule('Days of the week carry a capital', { fn: m => ({ fix: cap(m.orig) }) });
  rule('Months carry a capital', { fn: m => ({ fix: cap(m.orig) }) });
  rule('Proper adjectives carry a capital', { fn: m => ({ fix: m.orig.replace(/english/, 'English') }) });
  rule('“Have gone” — went takes no auxiliary', { fn: m => ({ fix: m.orig.replace(/went$/i, 'gone') }) });
  rule('“Have done” — did takes no auxiliary', { fn: m => ({ fix: m.orig.replace(/did$/i, 'done') }) });
  rule('“I saw” or “I have seen”', { fn: m => ({ alts: [m.orig.replace(/seen$/i, 'saw'), m.orig.replace(/seen$/i, 'have seen')] }) });
  rule('Do you mean “definitely”?', { fn: m => ({ alts: [C(m.orig, 'definitely')] }) });
  rule('Piqued my interest', { fn: m => ({ fix: m.orig.replace(/peak(ed|s)?/i, (x, s) => C(x, 'pique' + (s === 'ed' ? 'd' : s === 's' ? 's' : ''))) }) });
  rule('“Free rein” is the older spelling', { fn: m => ({ fix: m.orig.replace(/reign/i, 'rein') }) });
  rule('Perhaps “due to”', { fn: m => ({ alts: [C(m.orig, 'due to')] }) });
  rule('“Different from” in the formal register', { fn: m => ({ alts: [C(m.orig, 'different from')] }) });
  rule('“Home in on”', { fn: m => ({ alts: [C(m.orig, 'home in on')] }) });
  rule('“In regard to” or “regarding”', { fn: m => ({ alts: [C(m.orig, 'regarding'), C(m.orig, 'in regard to')] }) });
  rule('The adverb wants “-ly”: drive safely', { fn: m => ({ fix: m.orig.replace(/\b(safe|slow|careful)$/i, (x, a) => ({ safe: 'safely', slow: 'slowly', careful: 'carefully' })[lc(a)]) }) });
  rule('“Really quick” — the adverb wants “-ly”', { fn: m => ({ alts: [C(m.orig, 'really quickly'), C(m.orig, 'quickly')] }) });
  rule('Two dots — an ellipsis is three', { alts: ['.', '…'], view: ['one full stop', 'an ellipsis …'] });
  rule('Unclear reference — give “this” a noun', { fn: (m, t) => askNoun(m, t) });
  rule('Unclear reference — “this” what?', { fn: (m, t) => askNoun(m, t) });
  rule('Vague "this"; name the antecedent', { fn: (m, t) => askNoun(m, t) });
  rule('“Just deserts”', { fn: m => ({ fix: m.orig.replace(/desserts/i, 'deserts') }) });
  rule('A damp squib', { fn: m => ({ fix: m.orig.replace(/squid/i, 'squib') }) });
  rule('A card sharp', { fn: m => ({ alts: [m.orig.replace(/shark/i, 'sharp')] }) });
  rule('“Honed” is a blade; you homed in', { fn: m => ({ alts: [m.orig.replace(/honed/i, x => C(x, 'homed'))] }) });
  rule('et al. wants its period', { fn: m => ({ fix: m.orig + '.' }) });
  rule('Spell out a numeral at a sentence start', { fn: (m, t) => numeralStart(m, t) });
  rule('A sentence that opens with figures', { fn: (m, t) => numeralStart(m, t) });
  rule('“Myself” does not serve as the subject', { fn: m => { const w = lc(m.orig.split(/\s+/)[0]); const obj = /^(them|him|her)$/.test(w); return obj ? { fix: m.orig.replace(/myself$/i, 'me') } : /^(she|he|they|we|him and her|he and i|she and i)$/.test(lc(m.orig.replace(/ and myself$/i, ''))) ? { fix: m.orig.replace(/myself$/i, 'I') } : { alts: [m.orig.replace(/myself$/i, 'I'), m.orig.replace(/myself$/i, 'me')] }; } });
  rule('Criteria is the plural', { fn: m => ({ alts: [C(m.orig, 'criteria are'), C(m.orig, 'criterion is')] }) });
  rule('“Where’s” for the contraction', { fn: m => ({ alts: [C(m.orig, 'where’s'), C(m.orig, 'whereas')] }) });
  rule('“A whole other”', { fn: m => ({ fix: /whole/i.test(m.orig) ? C(m.orig, 'a whole other') : C(m.orig, 'another') }) });
  rule('“Champing at the bit”', { fn: m => ({ fix: m.orig.replace(/chomp(ing| at)?/i, (x, s) => C(x, 'champ') + (s || '')) }) });
  rule('Perhaps “pore over” when the text is meant', { fn: m => ({ alts: [m.orig.replace(/pour/i, x => C(x, 'pore'))] }) });
  rule('“Between” holds two; among holds three', { fn: m => ({ fix: m.orig.replace(/between/i, x => C(x, 'among')) }) });
  rule('“Among” takes three or more', { fn: m => ({ fix: m.orig.replace(/amongst/i, x => C(x, 'between')) }) });
  rule('“If only I were” — the subjunctive', { fn: m => ({ fix: m.orig.replace(/was$/i, 'were') }) });
  rule('“Due to” is the cause marker', { fn: m => ({ alts: [m.orig.replace(/ due to$/i, '')] }) });
  rule('“Each” takes the singular', { fn: m => ({ fix: m.orig.replace(/\b(have|are)$/i, (x, v) => lc(v) === 'have' ? 'has' : 'is') }) });
  rule('"Each" takes a singular verb', { fn: m => ({ fix: m.orig.replace(/\b(have|are|were)$/i, (x, v) => ({ have: 'has', are: 'is', were: 'was' })[lc(v)]) }) });
  rule('"Every" takes a singular verb', { fn: m => ({ fix: m.orig.replace(/\b(are|were)$/i, (x, v) => lc(v) === 'are' ? 'is' : 'was') }) });
  rule('"Every one" takes a singular verb', { fn: m => ({ fix: m.orig.replace(/are$/i, 'is') }) });
  rule('"Neither" takes a singular verb', { fn: m => ({ fix: m.orig.replace(/are$/i, 'is') }) });
  rule('"Either" takes a singular verb', { fn: m => ({ fix: m.orig.replace(/are$/i, 'is') }) });
  rule('"The number of" takes a singular verb', { fn: m => ({ fix: m.orig.replace(/are$/i, 'is') }) });
  rule('"The number of X is…"', { fn: m => ({ fix: m.orig.replace(/are$/i, 'is') }) });
  rule('"A number of" takes a plural verb', { fn: m => ({ fix: m.orig.replace(/is$/i, 'are') }) });
  rule('"a part of" (joining) or "apart from"', { fn: m => ({ alts: [m.orig.replace(/apart of$/i, 'a part of'), m.orig.replace(/apart of$/i, 'part of')] }) });
  rule('The plural takes “are”', { fn: m => ({ fix: m.orig.replace(/is$/i, 'are') }) });
  rule('Check “your” against “you’re” here', { fn: m => ({ fix: m.orig.replace(/^your/i, x => C(x, 'you’re')) }) });
  rule('Some speakers aspirate the h', { fn: m => ({ alts: [m.orig.replace(/^an/i, x => C(x, 'a'))] }) });
  rule('“Comprised”, “composed of”, or “comprising”', { fn: m => ({ alts: [m.orig.replace(/comprised/i, x => C(x, 'composed')), m.orig.replace(/comprised/i, x => C(x, 'consisting'))] }) });
  rule('“Comprises” or “is composed of”', { fn: m => ({ alts: [C(m.orig, 'comprises'), C(m.orig, 'is composed of')] }) });
  rule('“who” for people reads more warmly', { fn: m => ({ alts: [m.orig.replace(/that$/i, 'who')] }) });
  rule('Space before the', { fn: m => ({ fix: m.orig.replace(/ (?=[,.;:])/, '') }) });
  rule('Two spaces where one belongs', { fn: m => ({ fix: m.orig.replace(/ {2,}/, ' ') }) });
  rule('Sentence begins lowercase', { fn: m => ({ fix: m.orig.replace(/[a-z]$/, x => x.toUpperCase()) }) });
  rule('Doubled word', { fn: m => /^(had|that|is)\s/i.test(m.orig) ? { drop: true } : { fix: m.orig.split(/\s+/)[0] } });
  rule('Capitalise the pronoun I', { fn: m => ({ fix: m.orig.replace(/i/, 'I') }) });
  rule('A comma follows these sentence openers', { fn: m => /,/.test(m.orig) ? { drop: true } : { fix: m.orig.replace(/^(\S+)(\s*)$/, '$1,$2') } });
  rule('The verb answers to', { fn: m => { const w = lc(m.orig); const sg = { have: 'has', are: 'is', were: 'was', do: 'does' }[w]; return sg ? { fix: C(m.orig, sg) } : null; } });

  /* clarity and concision */
  ['Throat-clearing: say the point', 'If it goes without saying', 'Wordiness — say it, or don’t mention it', 'Wordiness — lead with the thing itself',
    'Wordiness — the page already knows it is yours', '“It should be noted” — note it, plainly', '“Worth noting” — the reader decides', 'Signpost padding',
    'The note stands on the fact', '“Needless to say” announces a redundancy', '“As we all know” presumes the reader', 'Shared knowledge needs no announcer',
    '“As can be seen” — by the reader', 'Honesty is not a degree', '“On the whole” blurs its own edges', '“Without a doubt” is the claim', '“Undoubtedly” doubts the reader',
    '“Arguably” leaves the argument unmade', 'Dismissive claim: argue it instead', '“It could be said” — by whom?', 'The sudden thing is suddenest unannounced',
    'Register — “literally” before anything figurative'
  ].forEach(p => rule(p, { del: true }));
  rule('“In conclusion” frames the obvious', { del: true, tryOnly: true });
  rule('“Obvious” tells; show the reason', { fn: (m, t) => /that$/i.test(m.orig) ? delPatch(m, t) : { drop: true } });
  rule('Clarity is shown, not declared', { fn: (m, t) => /that$/i.test(m.orig) ? delPatch(m, t) : { drop: true } });
  rule('Wordy phrase: usually removable', { fn: (m, t) => /matter of fact/i.test(m.orig) ? { alts: [C(m.orig, 'in fact')] } : delPatch(m, t) });
  rule('Wordy: the verb alone carries the meaning', { fn: (m, t) => delPatch(m, t) });
  rule('Vague filler: name the dimension', { fn: m => ({ alts: [C(m.orig, 'by'), C(m.orig, 'in'), C(m.orig, 'regarding')] }) });
  rule('Overtalk: the verb usually suffices', { fn: (m, t) => { const nw = nextWordAt(t, m.end); if (!nw) return null; const b = lc(nw.word); if (!(m.H && m.H.plain && m.H.plain(b))) return null; return { start: m.start, end: nw.end, alts: [/^serves/i.test(m.orig) ? s3(b) : b] }; } });
  rule('Padding: say what was done', { fn: (m, t) => { const nw = nextWordAt(t, m.end); if (!nw) return null; const b = baseOfIng(nw.word, m.H); return b ? { start: m.start, end: nw.end, alts: [C(m.orig, 'chose to ' + b)] } : null; } });
  rule('Nominalisation: "indicates" is stronger', { fn: m => ({ alts: [m.orig.replace(/^is an? indication (of|that)$/i, (x, w) => C(x, 'indicates' + (lc(w) === 'that' ? ' that' : '')))] }) });
  rule('Can usually be "is prone to"', { fn: m => ({ alts: [C(m.orig, 'is prone to'), C(m.orig, 'is vulnerable to')] }) });
  rule('"centre on" or "center on"', { fn: m => ({ alts: [m.orig.replace(/ around$/i, ' on')] }) });
  rule('Things centre ON', { fn: m => ({ alts: [m.orig.replace(/ around$/i, ' on')] }) });
  rule('Often misused: "raises the question"?', { fn: m => ({ alts: [m.orig.replace(/begs/i, x => C(x, 'raises'))] }) });
  rule('“Begs the question” means circular reasoning', { fn: m => ({ alts: [m.orig.replace(/begs/i, x => C(x, 'raises'))] }) });
  rule('Redundancy — one of the two carries it', { map: { 'first and foremost': ['first', 'above all'], 'each and every': ['each', 'every'] } });
  rule('Redundancy — various already means different', { alts: ['various', 'different'] });
  rule('Absolute adjective', { fn: m => ({ alts: [C(m.orig, m.orig.split(/\s+/).slice(-1)[0])] }) });
  rule('Redundancy — “same” needs no twin', { fn: m => ({ alts: [m.orig.replace(/\b(?:exact )?same(?: exact)?\b/i, 'same').replace(/^(?:exact )/i, '')] }) });
  rule('Redundancy — “reason” and “why”', { fn: m => ({ alts: [m.orig.replace(/ why$/i, '')] }) });
  rule('“The reason why” — the reason alone stands', { fn: m => ({ alts: [m.orig.replace(/ why$/i, '')] }) });
  rule('Redundancy — a gift', { fn: m => ({ alts: [C(m.orig, 'gift')] }) });
  rule('Redundancy — planning is forward', { fn: m => ({ alts: [C(m.orig, 'planning')] }) });
  rule('Redundancy — history is made of past', { fn: m => ({ alts: [C(m.orig, 'history')] }) });
  rule('Redundancy — proximity already means close', { fn: m => ({ alts: [C(m.orig, 'proximity')] }) });
  rule('Redundancy — a fact is true', { fn: m => ({ alts: [C(m.orig, 'fact')] }) });
  rule('Redundancy — the result is the end', { fn: m => ({ alts: [C(m.orig, 'result')] }) });
  rule('Redundancy — the outcome is already final', { fn: m => ({ alts: [C(m.orig, 'outcome')] }) });
  rule('Redundancy — an innovation arrives new', { fn: m => ({ alts: [C(m.orig, 'innovation')] }) });
  rule('Redundancy — collaboration is already joint', { fn: m => ({ alts: [C(m.orig, 'collaboration')] }) });
  rule('Redundancy — a surprise', { fn: m => ({ alts: [C(m.orig, 'surprise')] }) });
  rule('Hedge doubled — choose “may” or “perhaps”', { alts: ['may', 'perhaps'] });
  rule('Hedge doubled — choose “might” or “possibly”', { alts: ['might', 'possibly'] });
  rule('Hedge — “I argue”, “I think”', { fn: m => ({ alts: [m.orig.replace(/feel like$/i, 'think'), m.orig.replace(/feel like$/i, 'believe')] }) });
  rule('“Cannot” is the standard single word', { fn: (m, t) => /^\s+only\b/i.test(t.slice(m.end, m.end + 6)) ? { drop: true } : { fix: C(m.orig, 'cannot') } });
  rule('“Try to” is the standard form', { fn: m => ({ fix: m.orig.replace(/and$/i, 'to') }) });
  rule('“To” alone carries it', { fn: m => ({ alts: [C(m.orig, 'to')] }) });
  rule('“Whether” alone carries the either-way', { fn: m => ({ alts: [C(m.orig, 'whether')] }) });
  rule('“On a regular basis” — “regularly” weighs less', { fn: m => { const w = lc((/on an? (\w+) basis/i.exec(m.orig) || [])[1]); const a = { regular: 'regularly', daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' }[w]; return a ? { fix: C(m.orig, a) } : null; } });
  rule('“For the purpose of” — is there one?', { fn: m => ({ alts: [C(m.orig, 'for')] }) });
  rule('Each, or every — one is enough', { fn: m => ({ alts: [C(m.orig, 'each of'), C(m.orig, 'every one of')] }) });
  rule('Each or every — one holds the meaning', { alts: ['each', 'every'] });
  rule('“Continue” carries on by itself', { fn: m => ({ fix: m.orig.replace(/ on$/i, '') }) });
  rule('“Promptly”, or “in time”', { alts: ['promptly', 'in time'] });
  rule('Counts in formal work take “more than”', { fn: m => ({ alts: [m.orig.replace(/^over/i, x => C(x, 'more than'))] }) });
  rule('The first run is the inaugural one', { alts: ['first', 'inaugural'] });
  rule('"etc." after a such-as list is redundant', { fn: m => ({ alts: [m.orig.replace(/,?\s*etc\.$/i, '')], view: ['cut “etc.”'] }) });
  rule('Wordy frame: restructure or delete', { fn: (m, t) => factThat(m, t) });
  rule('Wordiness — “the fact that”', { fn: (m, t) => factThat(m, t) });
  rule('Wordiness — “the fact that” rarely earns its keep', { fn: (m, t) => factThat(m, t) });
  rule('A long way around it', { fn: m => { const x = /^as far as (.+?) (?:goes|is concerned)$/i.exec(m.orig); return x ? { alts: [C(m.orig, 'regarding ' + x[1]), C(m.orig, 'for ' + x[1])] } : null; } });
  rule('Padding — “society today” is half the width', { alts: ['today', 'in society today'] });
  rule('Which society, dated when?', { fn: (m, t) => askReplace(m, t, 'Where and when, exactly?', 'in Britain since 2010', 'in') });
  rule('“All right” in formal writing', { fn: m => ({ alts: [C(m.orig, 'all right')] }) });
  rule('Register — greeting idiom stays in speech', { alts: ['how are you'] });
  rule('Overclaim framing — point to the evidence', { alts: ['the evidence shows', 'we see'] });
  rule('Overclaim framing — the data show', { fn: m => ({ alts: [C(m.orig, 'the data show')] }) });
  rule('Cliché — the day ends', { alts: ['ultimately', 'in the end'] });
  rule('Cliché — name the actual reach', { alts: ['think creatively', 'look beyond the usual'] });
  rule('Cliché — “in short” is shorter', { alts: ['in short', 'briefly'] });
  rule('Cliché — name the moment of decision', { alts: ['when it matters', 'if necessary'] });
  rule('Cliché — say what changed', { alts: ['turning point', 'breakthrough'] });
  rule('Cliché — “move the needle”', { fn: (m, t) => { const b = t.slice(Math.max(0, m.start - 8), m.start); const v = /(mov(?:e|es|ed|ing)) $/i.exec(b); if (!v) return { drop: true }; const f = { move: 'make', moves: 'makes', moved: 'made', moving: 'making' }[lc(v[1])]; return { start: m.start - v[0].length, end: m.end, alts: [f + ' a difference'] }; } });
  rule('Cliché — “speak” or “check in”', { fn: m => ({ alts: [m.orig.replace(/touch base/i, 'speak'), m.orig.replace(/touch base/i, 'check in')] }) });
  rule('Cliché — “return to it”', { fn: m => ({ alts: [m.orig.replace(/circle back/i, 'return to it'), m.orig.replace(/circle back/i, 'revisit')] }) });
  rule('Cliché — “fair conditions”', { alts: ['fair conditions', 'equal footing'] });
  rule('Cliché', { exact: true, map: { 'best-kept secret': ['little-known strength', 'overlooked advantage'], 'low-hanging fruit': ['easy gains', 'quick wins'] } });
  rule('“Because of” is the plainer phrase', { fn: m => ({ alts: [C(m.orig, 'because of')] }) });
  rule('“The proof of the pudding”', { alts: ['the results will tell', 'the proof of the pudding is in the eating'] });
  rule('“Farther” for distance', { fn: m => ({ fix: m.orig.replace(/farther/i, x => C(x, 'further')) }) });
  rule('“Continual” repeats', { fn: m => ({ alts: [m.orig.replace(/continual/i, x => C(x, 'continuous'))] }) });
  rule('Advice takes no article', { fn: m => ({ alts: [C(m.orig, 'advice'), C(m.orig, 'a piece of advice')] }) });
  rule('Register — “children” in formal prose', { fn: m => ({ alts: [C(m.orig, 'children')] }) });
  rule('Register — the passive with “is”', { fn: (m, t) => /^\s+to\b/.test(t.slice(m.end, m.end + 4)) ? { drop: true } : { alts: [m.orig.replace(/^gets?/i, x => C(x, lc(x) === 'gets' ? 'is' : 'are'))] } });
  rule('"Become" or "grow" carries more weight', { fn: m => /\ba better\b/i.test(m.orig) ? { drop: true } : { alts: [m.orig.replace(/^get/i, x => C(x, 'become')), m.orig.replace(/^get/i, x => C(x, 'grow'))] } });
  rule('"Obtain", "acquire", "gain", or "reach"', { fn: (m, t) => { const p = lc(m.orig.split(/\s+/)[1]); const nx = lc((nextWordAt(t, m.end) || {}).word || ''); if (p === 'into') return { alts: [C(m.orig, 'enter')] }; if (p === 'to' && /^(the|a|an|work|school|class|university|college|town|city|london|paris|home)$/.test(nx)) return { alts: [C(m.orig, 'reach')] }; if (p === 'through') return { alts: [C(m.orig, 'pass through'), C(m.orig, 'complete')] }; if (p === 'by') return { alts: [C(m.orig, 'manage')] }; return { drop: true }; } });
  rule('"Discovers", "determines", or "ascertains"', { fn: m => verbChoice(m, ['discover', 'determine', 'ascertain'], 'out') });
  rule('"Discusses", "addresses", or "examines"', { fn: m => verbChoice(m, ['discuss', 'address', 'examine'], 'about') });
  rule('"Examines", "investigates", or "analyses"', { fn: m => verbChoice(m, ['examine', 'investigate', 'analyse'], 'at') });
  rule('"Addresses", "treats", or "engages with"', { fn: m => verbChoice(m, ['address', 'treat', 'engage with'], 'with') });
  rule('"Notes", "observes", or "argues"', { fn: m => verbChoice(m, ['note', 'observe', 'argue'], 'out') });
  rule('"Demonstrates", "indicates", or "reveals"', { fn: m => { const s = /^shows/i.test(m.orig); return { alts: ['demonstrate', 'indicate', 'reveal'].map(v => C(m.orig, (s ? s3(v) : v) + ' that')) }; } });
  rule('Overclaim: demonstrate? suggest?', { fn: m => { const w = lc(m.orig); const f = w === 'proves' ? 's' : (w === 'proved' || w === 'proven') ? 'd' : ''; return { alts: ['suggest', 'support'].map(v => C(m.orig, f === 's' ? s3(v) : f === 'd' ? pastOf(v) : v)) }; } });
  rule('“Proves” is the strongest claim', { fn: m => ({ alts: [m.orig.replace(/proves/i, 'suggests'), m.orig.replace(/proves/i, 'shows')] }) });
  rule('A study supports; proof belongs', { fn: m => ({ alts: [m.orig.replace(/proves$/i, 'suggests'), m.orig.replace(/proves$/i, 'shows')] }) });
  rule('“Data” takes the plural in formal writing', { fn: m => ({ fix: m.orig.replace(/shows$/i, 'show') }) });
  rule('The data were analysed', { fn: m => ({ fix: m.orig.replace(/was/i, 'were') }) });
  rule('“Clearly demonstrate”', { fn: m => ({ alts: [m.orig.replace(/ clearly/i, '')] }) });
  rule('Seem and suggest double the hedge', { fn: m => ({ alts: [m.orig.replace(/ (?:seem|appear) to (suggest|indicate)/i, (x, v) => ' ' + s3(lc(v)).replace(/^suggests$/, 'suggest').replace(/^indicates$/, 'indicate')), m.orig.replace(/ (seem|appear) to (?:suggest|indicate)/i, ' $1 to show')] }) });
  rule('The conclusion is argued, not announced', { fn: (m, t) => { const x = /^(in conclusion),/i.exec(m.orig); if (!x) return null; const tail = /^\s+that\b/i.exec(t.slice(m.end, m.end + 8)); return { start: m.start, end: m.end + (tail ? tail[0].length : 0), alts: [x[1] + ','] }; } });
  rule('“As far as we know” is honest but shapeless', { alts: ['to date', 'so far'] });
  rule('Overstatement: date the phenomenon', { fn: (m, t) => Object.assign(askReplace(m, t, 'Since when, exactly?', '1900', 'since'), { alts: [C(m.orig, 'for centuries'), C(m.orig, 'for a long time')] }) });
  rule('Overstatement: name the evidenced span', { fn: (m, t) => Object.assign(askReplace(m, t, 'Which period, exactly?', 'since 1900', 'since'), { alts: [C(m.orig, 'for centuries')] }) });
  rule('“Since the beginning of time” overstates', { fn: (m, t) => Object.assign(askReplace(m, t, 'Since when, exactly?', '1900', 'since'), { alts: [C(m.orig, 'for centuries'), C(m.orig, 'for a long time')] }) });
  rule('“Throughout history” claims all of it', { fn: (m, t) => Object.assign(askReplace(m, t, 'Which period, exactly?', 'since 1900', 'since'), { alts: [C(m.orig, 'for centuries')] }) });
  rule('“Recent” is a moving window', { fn: (m, t) => askReplace(m, t, 'Since when, exactly?', '2015', 'since') });
  rule('Vague time — name the date if you can', { fn: (m, t) => { const near = /near/i.test(m.orig); return Object.assign(askReplace(m, t, 'When, exactly?', near ? 'by next year' : 'by 2030', 'by'), { alts: [C(m.orig, near ? 'soon' : 'later')] }); } });
  rule('Some fields take “I”', { alts: ['I'] });
  rule('Map the argument; announcing it', { fn: m => { const x = /^(this \w+) will (\w+)$/i.exec(m.orig); return x ? { alts: [x[1] + ' ' + s3(lc(x[2]))] } : null; } });
  rule('The preface (“In this paper, I will…”)', { fn: m => ({ alts: [m.orig.replace(/ will$/i, '')] }) });
  rule('Announcement spends a sentence', { fn: m => { const x = /^(in this \w+),? (I|we) (?:will |shall |seek to |aim to |attempt to |would like to )?(\w+)$/i.exec(m.orig); return x ? { alts: [x[1] + ', ' + x[2] + ' ' + lc(x[3])] } : null; } });
  rule('“Widely studied” borrows breadth', { fn: (m, t) => askCite(m, t, m.orig.length) });
  rule('“Little research” — say what is missing', { fn: m => ({ alts: [C(m.orig, 'few studies have examined this')] }) });
  rule('Needed on what, and by whom?', { fn: (m, t) => askReplace(m, t, 'Research on what?', 'rural schools', null, v => m.orig + ' on ' + v.replace(/^on\s+/i, '')) });
  rule('“It can be argued” hides the arguer', { fn: m => ({ alts: [C(m.orig, 'we argue that')] }) });
  rule('“A growing body” — growth needs', { fn: (m, t) => askCite(m, t, m.orig.length) });
  rule('“Most” is a claim of consensus', { fn: (m, t) => askCite(m, t, m.orig.split(/\s+/).slice(0, 2).join(' ').length) });
  rule('“A number of studies” — how many', { fn: (m, t) => Object.assign(askReplace(m, t, 'How many studies?', 'five', null, v => C(m.orig, v.replace(/\s*studies$/i, '') + ' studies')), { alts: [C(m.orig, 'several studies')] }) });
  rule('“Plays a role” names no mechanism', { fn: (m, t) => askReplace(m, t, 'What does it do?', 'shapes', null, v => C(m.orig, v)) });
  rule('“Well known” to whom?', { fn: (m, t) => askCite(m, t, m.orig.replace(/ that$/i, '').length) });
  rule('“A plethora of” is overworked', { alts: ['many', 'a wealth of'] });
  rule('“A myriad of” is overworked', { alts: ['many', 'a host of'] });
  rule('“Research shows” without a name', { fn: (m, t) => askCite(m, t, 'research'.length) });
  rule('“Studies have shown” — which studies?', { fn: (m, t) => askCite(m, t, 'studies'.length) });
  rule('“Researchers have found” — name two', { fn: (m, t) => askCite(m, t, 'researchers'.length) });
  rule('“Everyone knows” cannot be evidenced', { alts: ['it is widely accepted', 'many accept'] });
  rule('Weasel phrase: cite a source', { fn: (m, t) => { const w = lc(m.orig); if (w === 'everyone knows') return { alts: [C(m.orig, 'it is widely accepted'), C(m.orig, 'many accept')] }; const at = w === 'studies show' ? 7 : w === 'it is well known' ? m.orig.length : m.orig.length; return askCite(m, t, at); } });
  rule('First person: consider restructuring', { fn: (m, t) => firstPerson(m, t) });
  rule('Contraction', { fn: (m, t) => expandContraction(m.orig, t.slice(m.end, m.end + 10)) });
  rule('Exclamation: not used in scholarly prose', { fn: (m, t) => (/[!?]/.test(t[m.end] || '') || /[!?+#\d]/.test(t[m.start - 1] || '') || /[A-Z][a-z]?\d/.test(t.slice(Math.max(0, m.start - 4), m.start))) ? { drop: true } : { fix: '.' } });
  rule('“cf.” means compare', { fn: m => ({ alts: [m.orig.replace(/^cf\./i, x => C(x, 'see'))] }) });
  rule('The seeing belongs to the text', { fn: m => ({ alts: [C(m.orig, 'the data show that'), C(m.orig, 'this shows that')] }) });
  rule('“It is interesting to note that”', { del: true });
  rule('The adverb explains what the line should play', { fn: m => ({ alts: [m.orig.split(/\s+/)[0]] }) });
  rule('Nominalisation — the verb form', { fn: (m, t) => nominal(m, t) });
  rule('Passive voice — the active form usually serves', { fn: (m, t) => passiveAlt(m, t) });
  rule('Possible passive voice', { fn: (m, t) => passiveAlt(m, t) });
  rule('“Which” restricting is accepted British usage', { fn: m => ({ alts: [C(m.orig, 'that')] }) });
  rule('“Which” carries the comma; “that” begins', { force: true, fn: m => ({ fix: m.orig.replace(/,\s*that$/i, ' that') }) });
  rule('Possible comma splice', { fn: (m, t) => splice(m, t) });
  rule('"Discovers"', { fn: m => verbChoice(m, ['discover', 'determine', 'ascertain'], 'out') });
  rule('Long sentence', { fn: (m, t) => splitLong(m, t) });
  rule('Long paragraph', { fn: (m, t) => splitPara(m, t) });
  rule('repeats within one sentence', { inner: true, fn: (m, t) => repetition(m, t) });
  rule('returns inside the same breath', { inner: true, fn: (m, t) => repetition(m, t) });
  rule('Spelling: not in the dictionary', { fn: m => (/^[A-Z]/.test(m.orig) && !(m.e.alts && m.e.alts.length)) ? { drop: true } : { keep: true } });
  rule('“Couldn’t care less” is the measurable phrase', { fn: m => ({ alts: [m.orig.replace(/could care/i, x => C(x, 'couldn’t care'))] }) });
  rule('“Many”, “much”, or the number itself', { keep: true });

  /* ---------- the computed alternatives ---------- */
  function delPatch(m, t) { const p = cut(t, m.start, m.end); return { start: p.start, end: p.end, fix: p.fix, cut: true }; }
  function verbChoice(m, verbs, particle) {
    const w = lc(m.orig.split(/\s+/)[0]);
    const form = /s$/.test(w) && !/ss$/.test(w) ? 's' : /(ed|ound|alt|ooked|ointed|alked)$/.test(w) || w === 'found' || w === 'dealt' ? 'd' : '';
    return { alts: verbs.map(v => { const parts = v.split(' '); const h = parts[0]; const f = form === 's' ? s3(h) : form === 'd' ? pastOf(h) : h; return C(m.orig, [f].concat(parts.slice(1)).join(' ')); }) };
  }
  function askNoun(m, t) {
    const x = /^(this)\b/i.exec(m.orig); if (!x) return null;
    return { ask: { kind: 'insert', q: 'This what?', ph: 'finding', start: m.start, end: m.start + 4, orig: m.orig.slice(0, 4), make: v => m.orig.slice(0, 4) + ' ' + v.replace(/^this\s+/i, '') } };
  }
  function askCite(m, t, at) {
    return { ask: { kind: 'insert', q: 'Whose work? Name the source.', ph: 'Smith, 2020', start: m.start, end: m.end, orig: m.orig, make: v => m.orig.slice(0, at) + ' (' + v.replace(/^\(|\)$/g, '') + ')' + m.orig.slice(at) } };
  }
  function askReplace(m, t, q, ph, pre, make) {
    return { ask: { kind: 'replace', q: q, ph: ph, start: m.start, end: m.end, orig: m.orig, make: make || (v => { let s = v.trim(); if (pre && !/^(in|by|since|from|until|before|after|on|at|during|throughout|between|for|over|within)\b/i.test(s)) s = pre + ' ' + s; return startsSentence(t, m.start) ? cap(s) : s; }) } };
  }
  function numeralStart(m, t) {
    const after = t.slice(m.end, m.end + 3);
    if (/^[.):]/.test(after) || /^\s*$/.test(t.slice(m.end, m.end + 1)) && /\n/.test(t.slice(m.end, m.end + 2))) return { drop: true };
    if (!/^\d+$/.test(m.orig)) return { drop: true };
    const w = numberWord(+m.orig); if (!w) return { drop: true };
    return { alts: [cap(w)] };
  }
  function firstPerson(m, t) {
    const rest = t.slice(m.end, m.end + 30);
    const x = /^\s+(think|believe|feel)(\s+that)?\s+/i.exec(rest);
    if (x) { const p = cut(t, m.start, m.end + x[0].length - 1); return { start: p.start, end: p.end, fix: p.fix, cut: true }; }
    const y = /^\s+(argue|suggest|will show|am going)\b/i.exec(rest);
    if (y && lc(m.orig) === 'i') {
      const v = lc(y[1]); const rep = v === 'argue' ? 'This thesis argues' : v === 'suggest' ? 'This thesis suggests' : 'This thesis will show';
      if (v === 'am going') return { drop: true };
      return { start: m.start, end: m.end + y[0].length, alts: [startsSentence(t, m.start) ? rep : low1(rep)] };
    }
    return { drop: true };
  }
  function factThat(m, t) {
    const before = t.slice(Math.max(0, m.start - 24), m.start);
    const pre = /(despite|in spite of|due to|owing to|because of|aware of|given|apart from|except for|in light of|in view of|from|is|was) $/i.exec(before);
    const at = pre ? m.start - pre[0].length : m.start;
    const p = pre ? lc(pre[1]) : '';
    const map = { despite: 'although', 'in spite of': 'although', 'due to': 'because', 'owing to': 'because', 'because of': 'because', 'aware of': 'aware that', given: 'given that', 'apart from': 'except that', 'except for': 'except that', 'in light of': 'because', 'in view of': 'because', from: 'because', is: 'is that', was: 'was that' };
    if (p) return { start: at, end: m.end, alts: [caseLike(pre[1], map[p])] };
    return { alts: [C(m.orig, 'that')] };
  }
  function nominal(m, t) {
    const x = /^the\s+(\w+)\s+of$/i.exec(m.orig); if (!x) return { drop: true };
    const n = lc(x[1]);
    const before = t.slice(Math.max(0, m.start - 12), m.start);
    if (n === 'duration' && /\bfor $/i.test(before)) return { start: m.start - 4, end: m.end, alts: [caseLike(t.slice(m.start - 4, m.start), 'during')] };
    const v = NOM[n]; if (!v) return { drop: true };
    const g = NOM_ING[v] || gerund(v);
    return { alts: [C(m.orig, g)] };
  }
  function passiveAlt(m, t) {
    let at = m.start;
    if (/^(be|been)\b/i.test(m.orig)) { const lb = /(has|have|had|will|would|can|could|should|shall|may|might|must|cannot)\s+$/i.exec(t.slice(Math.max(0, at - 12), at)); if (!lb) return null; at -= lb[0].length; }
    const P = passiveParts(t, at, m.H);
    if (!P) return null;
    if (!P.agent && STATIVE_STRICT.test(P.part)) return { drop: true };
    if (P.agent) {
      const a = activeText(P, P.agent, m.H);
      if (a && (P.agentEnd - P.subjStart) < 260) return { start: a.start, end: a.end, alts: [a.text], view: [a.text] };
      return null;
    }
    if (!P.base && !/^(was|were|has been|have been|had been)$/.test(P.aux)) return null;
    if (P.aux === 'was' || P.aux === 'were') { if (!P.past) return null; }
    const probe = activeText(P, 'someone', m.H); if (!probe) return null;
    return { ask: { kind: 'agent', q: 'Who did it?', ph: 'the committee', P: P, H: m.H } };
  }
  function splice(m, t) {
    const nw = nextWordAt(t, m.end); if (!nw) return null;
    const before = t.slice(Math.max(0, m.start - 200), m.start);
    const cl = before.split(/[.!?\n]/).pop();
    if (/\b(if|because|although|though|when|whenever|while|since|unless|until|after|before|whereas|even|due|despite|given|as|once)\b/i.test(cl)) return { drop: true };
    if (/\b(therefore|however|thus|moreover|consequently|hence|also|then|so|and|but|or)\s*$/i.test(cl)) return { drop: true };
    if (/\b(that|which|who|whom|whose|what)\b/i.test(cl) && /\b(it|them)\b/i.test(t.slice(nw.end, nw.end + 60).split(/[.!?]/)[0] || '')) return { drop: true };
    const w2 = nw.word === 'I' ? 'I' : low1(nw.word);
    return { start: m.start, end: nw.end, alts: ['; ' + w2, '. ' + cap(nw.word)] };
  }
  const SPLIT_SUBJ = /^(the|a|an|this|that|these|those|it|they|he|she|we|i|there|its|their|his|her|our|my|many|most|some|each|all|one|no|such|both|several|few)$/i;
  function splitLong(m, t) {
    const S0 = sentenceAt(t, m.start + 1);
    const s = S0.text, words = s.split(/\s+/).length;
    const re = /(;\s+|,\s+(and|but|so|yet)\s+)([A-Za-z]+)/g;
    let best = null, x;
    while ((x = re.exec(s))) {
      const subj = x[3];
      if (x[2] && !(SPLIT_SUBJ.test(subj) || /^[A-Z]/.test(subj))) continue;
      const leftW = s.slice(0, x.index).split(/\s+/).length, rightW = words - leftW;
      if (leftW < 10 || rightW < 10) continue;
      const score = Math.abs(leftW - rightW);
      if (!best || score < best.score) best = { x: x, score: score };
    }
    if (!best) return { drop: true };
    const bx = best.x, start = S0.start + bx.index, end = start + bx[0].length, subj = bx[3];
    const conj = lc(bx[2] || '');
    const lead = conj === 'but' ? 'However, ' : conj === 'so' ? 'As a result, ' : conj === 'yet' ? 'Even so, ' : '';
    const keepCase = subj === 'I' || (/^[A-Z]/.test(subj) && !SPLIT_SUBJ.test(subj));
    const word = lead ? (keepCase ? subj : low1(subj)) : cap(subj);
    return { start: start, end: end, alts: ['. ' + lead + word] };
  }
  const PIVOT = /^(however|but|yet|in contrast|on the other hand|moreover|furthermore|in addition|second|secondly|third|thirdly|finally|thus|therefore|nevertheless|nonetheless|meanwhile|this|these|by contrast|conversely|similarly|consequently|as a result|in turn|still|instead)\b/i;
  function splitPara(m, t) {
    const k = t.slice(m.start).search(/\n\s*\n/), pEnd = k < 0 ? t.length : m.start + k;
    const p = t.slice(m.start, pEnd);
    const total = p.split(/\s+/).length;
    const re = /([.!?]["”’)]?)(\s+)(["“(]?[A-Z][A-Za-z’']*)/g;
    let best = null, x;
    while ((x = re.exec(p))) {
      const before = p.slice(0, x.index).split(/\s+/).length;
      if (before < 40 || total - before < 40) continue;
      if (/\b(?:e\.g|i\.e|etc|al|Dr|Mr|Mrs|Ms|Prof|St|vs|cf|no|pp|p|vol)\.$/i.test(p.slice(Math.max(0, x.index - 6), x.index + 1))) continue;
      const rest = p.slice(x.index + x[1].length + x[2].length);
      const score = Math.abs(before - total / 2) - (PIVOT.test(rest) ? total / 4 : 0);
      if (!best || score < best.score) best = { x: x, score: score, word: x[3] };
    }
    if (!best) return { drop: true };
    const at = m.start + best.x.index + best.x[1].length;
    return { start: at, end: at + best.x[2].length, alts: ['\n\n'], view: ['a new paragraph at “' + best.word + '”'] };
  }
  function repetition(m, t) {
    const w = m.orig;
    if (/^[A-Z]/.test(w) && !startsSentence(t, m.start)) return { drop: true };
    if (/\d/.test(w) || w.length < 4) return { drop: true };
    if (!m.H || !m.H.syn) return { drop: true };
    const syns = (m.H.syn(w) || []).filter(s => lc(s) !== lc(w)).slice(0, 4);
    if (!syns.length) return { drop: true };
    return { alts: syns.map(s => caseLike(w, s)) };
  }

  /* ---------- applying the table ---------- */
  function specFor(why) {
    why = String(why || '');
    let best = null;
    for (const [p, s] of T) {
      const hit = s.exact ? why === p : (s.inner ? why.indexOf(p) >= 0 : why.indexOf(p) === 0);
      if (hit && (!best || p.length > best[0].length)) best = [p, s];
    }
    return best ? best[1] : null;
  }
  const hasFix = e => typeof e.fix === 'string' && e.fix !== e.orig;
  const hasAlts = e => !!(e.alts && e.alts.length);
  function enrichOne(e, t, H) {
    const spec = specFor(e.why);
    if (!spec) return e;
    if (spec.drop) return null;
    if (hasFix(e) && !spec.inner && !spec.force) return e;
    if (spec.keep) return e;
    const m = { start: e.start, end: e.end, orig: t.slice(e.start, e.end), e: e, H: H };
    if (!m.orig) return e;
    let p = null;
    try {
      if (spec.del) { const c = cut(t, e.start, e.end); p = spec.tryOnly ? { start: c.start, end: c.end, alts: [c.fix], view: [c.fix ? 'cut it; begin with “' + c.fix + '”' : 'cut it'] } : { start: c.start, end: c.end, fix: c.fix, cut: true }; }
      else if (spec.fn) p = spec.fn(m, t);
      else if (spec.map) { const a = spec.map[lc(m.orig).replace(/’/g, "'")] || spec.map[lc(m.orig)]; if (a === null) return null; if (a) p = { alts: a.map(x => C(m.orig, x)) }; }
      else if (spec.alts) p = { alts: spec.alts.map(x => /^[a-z]/.test(x) ? C(m.orig, x) : x), view: spec.view };
    } catch (err) { p = null; }
    if (!p) return e;
    if (p.drop) return null;
    if (p.keep) return e;
    const o = Object.assign({}, e);
    if (typeof p.start === 'number') { o.start = p.start; o.end = p.end; o.orig = t.slice(p.start, p.end); }
    if (typeof p.fix === 'string') { o.fix = p.fix; if (p.cut) o.cut = true; }
    if (p.alts && p.alts.length) {
      const seen = {}; const alts = [], view = [];
      p.alts.forEach((a, i) => { if (typeof a !== 'string' || a === o.orig || seen[a]) return; seen[a] = 1; alts.push(a); view.push(p.view && p.view[i] ? p.view[i] : a); });
      if (alts.length) { o.alts = alts; o.altView = view; o.tryAlts = true; delete o.wb; }
    }
    if (p.ask) { o.ask = p.ask; }
    return o;
  }
  /* style notes that offer nothing concrete are removed; correctness notes
     stay (the writer must still see a real error) */
  function concrete(e) { return hasFix(e) || e.fix === '' || hasAlts(e) || !!e.ask || !!e.spell; }

  /* ---------- one note per place ---------- */
  const FAMILY = [
    ['capI', /^Capital(?:ise the pronoun)? I\b/],
    ['article', /^Article "a" vs "an"|^“an” belongs before|^“a” before a vowel|^These begin with a vowel sound|^Some speakers aspirate/],
    ['opener', /^A comma follows these sentence openers|^A comma after an opening transition|^The introductory marker takes its comma|^An opening transition takes a comma/],
    ['doubled', /^(?:Doubled word|Repeated word|The word is doubled)/],
    ['long', /^Long sentence/],
    ['repeat', /repeats within one sentence|returns inside the same breath/],
    ['fact', /the fact that|^Wordy frame/],
    ['passive', /passive voice|^Passive voice/i],
    ['contraction', /^Contraction/],
    ['quant', /^Register: informal quantifier|^“Many”, “much”, or the number itself|^Register — “much of”|^"Much" or "substantial"/],
    ['this', /^Unclear reference|^Vague "this"/],
    ['tryto', /try to|“Try to”/i],
    ['number', /^Spell out a numeral|^A sentence that opens with figures|^Numerals under ten/],
    ['dots', /^Two dots|^Two full stops|^One terminal mark/],
    ['everyday', /every day|everyday/i],
    ['phenom', /phenomen/i],
    ['numberof', /number of/i],
    ['throat', /^Throat-clearing|^“It should be noted”|^“Worth noting”|^The note stands on the fact|^Signpost padding/],
    ['opinion', /my opinion|the page already knows it is yours|^The page is the opinion/i],
    ['firstperson', /^First person|^Hedge \(confidence\)|^“Feel” is the wrong organ/],
    ['weasel', /^Weasel phrase|^“Research shows”|^“Studies have shown”|^“Researchers have found”|^Shared knowledge|^“As we all know”|^“Everyone knows”|^“Well known”/],
    ['which', /“Which”|restrictive clause/],
    ['reason', /reason why|“reason” and “why”|^"Why" is redundant/i],
    ['redund', /^Redundancy|already|by definition|^Redundant/],
    ['time', /^Vague time|^Wordy phrase$/]
  ];
  function family(why) { why = String(why || ''); for (const [k, re] of FAMILY) if (re.test(why)) return k; return null; }
  const CATRANK = { r: 5, g: 4, ai: 4, c: 3, s: 2 };
  function score(e) {
    return (hasFix(e) || e.fix === '' ? 30 : hasAlts(e) || e.ask ? 20 : e.spell ? 15 : 10) + (CATRANK[e.cat] || 1) + (e.model ? 0.5 : 0) + (e.cut ? 1 : 0);
  }
  function dedupe(E) {
    const list = E.slice().sort((a, b) => a.start - b.start || b.end - a.end);
    const gone = new Set();
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (gone.has(a)) continue;
      for (let j = i + 1; j < list.length && list[j].start < Math.max(a.end, a.start + 1); j++) {
        const b = list[j]; if (gone.has(b)) continue;
        const overlap = b.start < a.end || (a.start === b.start && a.end === b.end);
        if (!overlap) continue;
        /* 7.52: an insertion at the head of a note that keeps its first word ("a" before "student", beside "student,"): both stand */
        if (b.start === b.end && b.start === a.start && typeof a.fix === 'string' && a.orig && a.fix.indexOf(String(a.orig).split(/\s/)[0]) === 0) continue;
        const same = a.start === b.start && a.end === b.end;
        const fa = family(a.why), fb = family(b.why);
        const contains = (a.start <= b.start && a.end >= b.end) || (b.start <= a.start && b.end >= a.end);
        const outer = (a.end - a.start) >= (b.end - b.start) ? a : b;
        const short = (outer.end - outer.start) <= 60;
        if (same || (fa && fa === fb) || (contains && short)) {
          const sa = score(a), sb = score(b);
          const lose = sa >= sb ? b : a;
          gone.add(lose);
          if (lose === a) break;
        }
      }
    }
    const out = E.filter(e => !gone.has(e));
    /* two fixes that overlap would corrupt the text under "Fix all": the
       weaker one becomes a choice to try */
    const fx = out.filter(e => hasFix(e) || e.fix === '').sort((a, b) => a.start - b.start);
    /* 7.52: an insertion at the head of a fix that keeps its first word ("a" before "student", beside "student,") corrupts nothing when the longer fix is applied first */
    const headIns = (x, ins) => ins.start === ins.end && ins.start === x.start && typeof x.fix === 'string' && !!x.orig && x.fix.indexOf(String(x.orig).split(/\s/)[0]) === 0;
    for (let i = 1; i < fx.length; i++) {
      const a = fx[i - 1], b = fx[i];
      if (b.start < a.end && !headIns(a, b) && !headIns(b, a)) {
        const lose = score(a) >= score(b) ? b : a;
        const k = out.indexOf(lose);
        if (k >= 0) { const o = Object.assign({}, lose); o.alts = [lose.fix]; o.altView = [lose.fix === '' ? 'cut it' : lose.fix]; o.tryAlts = true; o.fix = null; out[k] = o; }
        if (lose === a) fx[i] = b; else fx[i] = a;
      }
    }
    return out;
  }

  /* the notes as the page shows them */
  function refine(t, E, H) {
    t = String(t || '');
    const out = [];
    for (const e of E || []) {
      if (!e || typeof e.start !== 'number' || !(e.end >= e.start) || isNaN(e.start)) continue;
      let r = enrichOne(e, t, H || {});
      if (!r) continue;
      if (r.fix === '' && !r.cut && startsSentence(t, r.start)) { const c = cut(t, r.start, r.end); r = Object.assign({}, r, { start: c.start, end: c.end, orig: t.slice(c.start, c.end), fix: c.fix, cut: true }); }
      if (!concrete(r) && (r.cat === 'c' || r.cat === 's')) continue;
      out.push(r);
    }
    return dedupe(out);
  }

  /* the answer to a note's question, as a change to the text */
  function build(e, answer) {
    const a = String(answer || '').trim();
    if (!e || !e.ask || !a) return null;
    const q = e.ask;
    if (q.kind === 'agent') {
      const r = activeText(q.P, a, q.H);
      return r ? { start: r.start, end: r.end, fix: r.text } : null;
    }
    if (q.kind === 'replace' || q.kind === 'insert') return { start: q.start, end: q.end, fix: q.make(a) };
    return null;
  }

  /* ---------- lessons by kind ---------- */
  /* [principle, example]; the more particular kinds come first */
  const LESSON = [
    /* 7.50: the gaps' family names, as Your patterns groups them */
    [/^A word and its preposition/, ['Some words carry their preposition with them: depend on, interested in, listen to, in spite of, the reason for. Learn the pair as one word.', '"it depends the weather" → "it depends on the weather"']],
    [/^A missing article/, ['A singular thing that can be counted never stands bare (a person, an idea, the best way): it takes a, an or the.', '"is experienced person" → "is an experienced person"']],
    [/^Singular or plural after a quantity/, ['After many, several, both, a number and "one of", the noun is plural; many goes with things you count, much with what you measure.', '"many problem" → "many problems"']],
    [/^The verb’s form after a modal/, ['After will, can, should, does and "to", the verb stays bare; after have, has and had it is the participle.', '"will delighted" → "will delight"; "have went" → "have gone"']],
    [/^The verb agrees with its subject/, ['Find the real subject before choosing the verb: one thing takes the -s form, more than one takes the plain form.', '"the chances of accident is" → "the chances of accident are"']],
    [/^A capital inside a sentence/, ['A capital letter inside a sentence marks a name. An ordinary word keeps its small letter, however important it feels.', '"thinking It would" → "thinking it would"']],
    [/^A fixed form/, ['A few forms are simply fixed: nowadays, every day (two words, when), people, a relationship between people, easier.', '"more easy than" → "easier than"']],
    /* 7.50: the gaps (gaps_core.js): the principle behind each family, in six words where it can be */
    [/^“In spite” takes|^“In front” takes|^“In order” takes|^“According” takes|^“Depend” takes|^“Listen” takes|^“Instead” takes|^“One of them”|^“Percent” takes|^“Provide someone|^“Pay attention” takes|^“Arrive at”|^“Wait for”|^“Belong to”/, ['Some words carry their preposition with them: depend on, listen to, wait for, in spite of. Learn the pair as one word.', '"it depends the weather" → "it depends on the weather"']],
    [/^“Interested in”|^“Good at”|^“Afraid of”|^“Depend on”|^“Consist of”|^“Married to”|^“Similar to”|^“Capable of”|^“Responsible for”|^“Aware of”|^“Famous for”|^“Participate in”|^“Take part in”|^“Take care of”|^“Committed to”/, ['An adjective or a verb keeps its own preposition: interested in, good at, afraid of, consist of. The pair is fixed, whatever the language you think in.', '"interested on history" → "interested in history"']],
    [/takes no “about”|takes no preposition/, ['Discuss, mention, enter and reach take their object straight, with no preposition between.', '"discuss about the plan" → "discuss the plan"']],
    [/^“On the internet”|^“On TV”|^“On the radio”|^“At the weekend”|^“In the morning”|^“At night”|^“At present”|^A day takes “on”|^A year takes “in”|^“At home”|^“At work”|^“At the end of the day”|^A length of time takes “for”|^“At the age of”|^“In my opinion”|^“On the one hand”|^“On the other hand”|^A means of travel takes “by”|^“On foot”|^“A smile on your face”|^“Based on”|^“Nowadays”, “these days”/, ['Time and place take set prepositions: at night, on Monday, in 2019, at the weekend, on the internet, by car. They are learned one by one, and this is one.', '"at 2019" → "in 2019"']],
    [/^“An example of”|^“The reason for”|^“Proof of”|^“A solution to”|^“A solution to the problem”/, ['A noun keeps its own preposition too: an example of, the reason for, a solution to, proof of.', '"the reason of the delay" → "the reason for the delay"']],
    [/^A superlative or an ordinal takes “the”/, ['The best, the first, the same, the only: a superlative or an ordinal names one thing, so it takes "the".', '"one of best films" → "one of the best films"']],
    [/^A singular count noun takes an article/, ['A singular thing that can be counted (a person, a setting, a reason) never stands bare: it takes a, an or the.', '"is experienced person" → "is an experienced person"']],
    [/^After “[a-z]+” the noun is plural|^“One of” takes a plural/, ['After many, several, both, a number and "one of", the noun is plural: many problems, one of the reasons.', '"many problem" → "many problems"']],
    [/^“Many” before a plural|^“Much” before an uncountable|^“A lot of”/, ['Many goes with things you count (many accidents); much with what you measure (much money). "A lot of" serves for both.', '"much accidents" → "many accidents"']],
    [/^After “[a-z’']+” the verb is in its base form|^After “do”, “does” or “did”|^After “[a-z]+ to” the verb is in its base form/, ['After will, can, should, does, did and after "to", the verb stays in its base form: no -s, -ed or -ing.', '"will delighted us" → "will delight us"']],
    [/^After “[a-z’']+” the verb is a participle/, ['After have, has and had the verb is its participle: have gone, has taken, had seen. The past form (went, took, saw) stands alone.', '"I have went" → "I have gone"']],
    [/^“Interested in” doing/, ['Interested, good, afraid and tired take "in", "at" or "of" and then the -ing form.', '"interested to improve" → "interested in improving"']],
    [/^The person is “[a-z]+”; the thing is/, ['The -ed word is how a person feels (interested, bored); the -ing word is what causes it (interesting, boring).', '"I am interesting in it" → "I am interested in it"']],
    [/^Two verbs after “/, ['Two verbs joined by "and" or "or" take the same form: to mingle and meet, by reducing or taking.', '"to mingle and meeting" → "to mingle and meet"']],
    [/^An -ing subject is singular|^A country is singular|^“There is” before a singular|^A singular subject takes “-s”/, ['One thing, one -s: an -ing subject, a country, "there is a", and any singular subject take the singular verb.', '"Sharing rooms have" → "Sharing rooms has"']],
    [/^The subject is “[a-z]+”, a plural|^Two subjects joined by “and”|^A plural subject takes a plural verb/, ['Find the real subject before choosing the verb: "the chances of accident are", "Michael and Kate were", "my friends were".', '"the chances of accident is" → "the chances of accident are"']],
    [/^No capital inside a sentence/, ['A capital letter inside a sentence marks a name. An ordinary word keeps its small letter, however important it feels.', '"thinking It would" → "thinking it would"']],
    [/^Two words: “/, ['Some names are two words: New Zealand, United States, Hong Kong.', '"NewZealand" → "New Zealand"']],
    [/^“Nowadays”, always|^“Every day” \(two words\)|^This noun has no plural|^“Relationship” between|^A short adjective takes “-er”/, ['A few forms are simply fixed: nowadays, every day (two words, when), people (never peoples), a relationship between people, easier (not more easy).', '"more easy than" → "easier than"']],
    /* the learner-error families (learner_core.js) */
    [/^Subject-verb agreement/, ['The verb must match its subject: he, she, it and a singular noun take the -s form (goes, has, is); I, you, we, they and a plural noun take the plain form (go, have, are).', '"he go" → "he goes" · "they was" → "they were"']],
    [/^After a modal or "did"|^After a modal or "does"|^After "to", the bare verb/, ['After can, will, must, should, do, does, did and after "to", the verb stays in its bare form, with no -s, -ed or -ing.', '"can went" → "can go" · "didn\'t knew" → "didn\'t know" · "to goes" → "to go"']],
    [/takes the -ing form|^After a preposition, the -ing form|^"Look forward to"/, ['After a preposition (by, without, of, in, about) and after verbs such as enjoy, avoid, finish and keep, the verb takes its -ing form.', '"by use" → "by using" · "enjoy to play" → "enjoy playing"']],
    [/takes "to" and the bare verb/, ['Verbs such as want, decide, hope, plan and expect are followed by "to" and the bare verb.', '"want going" → "want to go"']],
    [/^"Agree" is a verb/, ['"Agree" is a verb, so it needs no "am" or "is" before it: "I agree", "she agrees".', '"I am agree" → "I agree"']],
    [/needs "(?:am|is|are)" before it|^A sentence needs its verb/, ['Every sentence needs a verb. An -ing word or an adjective on its own is not one: add am, is or are.', '"I going home" → "I am going home" · "It very important" → "It is very important"']],
    [/set in the past/, ['A sentence set in the past (yesterday, last week, two years ago) takes past-tense verbs all the way through.', '"Yesterday I go" → "Yesterday I went"']],
    [/^After "[^"]+", the plural noun|is singular; a plural noun takes/, ['After many, several, these, those and a number, the noun is plural; "this" and "that" go with a singular noun, "these" and "those" with a plural one.', '"many student" → "many students" · "this things" → "these things"']],
    [/^After "[^"]+", the singular noun/, ['After every, each, another, a and an, the noun is singular.', '"every students" → "every student" · "a cars" → "a car"']],
    [/^The phrase is|^The phrase takes|^"A lot of" takes|^"Such a"|^A singular countable noun takes|^"A" before a consonant/, ['Some phrases always carry "the" or "a": in the future, on the other hand, at the end, for the first time. A singular countable noun needs "a" or "an" before it.', '"in future" → "in the future" · "is good idea" → "is a good idea"']],
    [/^It is "|^Things are|^Days take|^Years take|^Months take|takes "for"|takes "ago"|^"[A-Z][a-z]+ (?:on|to|in|at|for|of|from|about)"|: no "|no preposition|^"Go home"|^"Here" and "there"|^"Near"|^"Nowadays" takes|^"Spend time|^"Consist of"|^"Prefer X|^"Different from"|^"Graduate from"|^"Congratulate|^"On the way|^"Go on holiday|^"By email|^"Arrive|^"Married to|^"Depend on|^"Interested in|^"Good at|^"Participate in|^"According to|^"Listen to|^"Wait for|^"Search for|^"Ask him|^"Explain to|^"Answer the|^"Enter the|^"Reach"|^"At the end of|^"On my own|^"By car|^"On foot|^"Responsible for|^"Capable of|^"Afraid of|^"Similar to|^"Suffer from|^"Think about|^"Discuss" takes|^"Mention" takes|^"Emphasise" takes|^"Contact someone|^"Lacks" takes|^"Attend school|^"This weekend|^"Last weekend|^"Last year"|^"Since childhood/, ['Many words take one particular preposition, fixed by usage rather than logic: married to, depend on, interested in, good at, on Monday, in 2019, at night.', '"married with" → "married to" · "in Monday" → "on Monday"']],
    [/is written as two words|is one word/, ['Some pairs of words are written as one word, and some as two; the spelling is fixed by usage.', '"infront" → "in front" · "every where" → "everywhere" · "a lot" (two words)']],
    [/^A comma after an opening|^A comma closes the opening|^A comma before "(?:but|so)"/, ['A comma marks the end of an opening word, phrase or clause before the main sentence begins, and sits before "but" or "so" when they join two complete sentences.', '"When he left I was sad" → "When he left, I was sad" · "In my opinion it is" → "In my opinion, it is"']],
    [/passive/i, ['The passive voice ("was approved") hides who acted. The active voice ("the board approved") names the doer first, and the sentence reads more directly. Keep the passive when the doer is unknown or does not matter.', '"The plan was approved by the board" → "The board approved the plan"']],
    [/^Nominalisation/, ['A nominalisation turns an action into a noun ("the creation of"). The verb itself ("creating", "create") is usually shorter and livelier.', '"the creation of jobs" → "creating jobs"']],
    [/comma splice/i, ['Two complete sentences joined by only a comma make a comma splice. Separate them with a full stop or a semicolon, or join them with a word such as "and" or "because".', '"It was late, we went home." → "It was late; we went home."']],
    [/^Long sentence/, ['A very long sentence asks the reader to hold too much at once. Split it where one complete thought ends and the next begins.', '"…, and the results were mixed" → "…. The results were mixed"']],
    [/^Long paragraph/, ['A long paragraph asks the reader to hold a whole movement in one breath. Start a new paragraph where the argument turns.', 'Begin the new paragraph at "However," or "In contrast,".']],
    [/repeats within one sentence|returns inside the same breath/, ['The reader\'s ear catches a word used twice close together. Keep the first mention and use a synonym or a pronoun for the second.', '"The study studies…" → "The study examines…"']],
    [/^Contraction/, ['Formal and academic writing spells contractions out in full.', '"don\'t" → "do not" · "it\'s" → "it is"']],
    [/^First person|^Hedge|^“Feel” is the wrong organ|^“I feel/, ['In formal writing the claim matters more than the writer\'s feeling about it. "I think" weakens a claim you can simply state.', '"I think the data show a rise" → "The data show a rise"']],
    [/^Throat-clearing|^“It should be noted”|^“Worth noting”|^The note stands on the fact|^Signpost padding|without saying|^“Needless to say”|^“As we all know”|^Shared knowledge|^“As can be seen”|^Wordiness — (?:say it|lead with)|^“It is interesting to note/, ['Phrases that announce a point delay it. Cut the announcement and begin with the point itself.', '"It should be noted that the sample was small" → "The sample was small"']],
    [/^Wordiness — the page already knows|^The page is the opinion|my opinion/i, ['Everything you write is already your opinion. "In my opinion" adds words, not meaning; state the view directly.', '"In my opinion, the policy failed" → "The policy failed"']],
    [/^Dismissive|^“Obvious”|^“Undoubtedly”|^“Arguably”|^“Without a doubt”|^Clarity is shown|^Overclaim framing|^“Clearly demonstrate”/, ['Words like "clearly", "obviously" and "undoubtedly" tell the reader what to think. Show the evidence instead, and let it persuade.', '"This clearly proves the point" → "This supports the point"']],
    [/^Weasel|^“Research shows”|^“Studies have shown”|^“Researchers have found”|^“Widely studied”|^“A growing body”|^“Most” is a claim|^“Well known”|^“Everyone knows”/, ['A claim that rests on unnamed "studies" or "research" borrows authority it has not shown. Name the source in a citation.', '"Studies show that sleep matters" → "Studies (Walker, 2017) show that sleep matters"']],
    [/^Overclaim: demonstrate|^“Proves”|^A study supports/, ['"Prove" claims certainty that research rarely reaches. "Suggest", "support" or "show" state a finding at the strength the evidence allows.', '"This proves the theory" → "This supports the theory"']],
    [/^Overstatement|^“Throughout history”|^“Since the beginning of time”|^Which society|^“Recent” is a moving|^Vague time|^“As far as we know”|^Padding — “society today”/, ['Sweeping time phrases ("throughout history", "in the future") make the reader guess. Name the period or the date you can support.', '"in the future" → "by 2030" · "throughout history" → "since 1800"']],
    [/^Unclear reference|^Vague "this"/, ['A bare "this" at the head of a sentence makes the reader look back to find what it means. Add the noun it points to.', '"This shows a rise" → "This result shows a rise"']],
    [/^Vague|^Imprecise|^Measure it|name the concept|^Register: vague noun/, ['A general word ("thing", "big", "get") makes the reader fill in the meaning. A precise word does that work for them.', '"a big change" → "a substantial change" · "thing" → "factor"']],
    [/^Cliché|overworked|^“The proof of the pudding”/, ['A cliché is a phrase used so often that readers no longer see it. Say plainly what you mean.', '"at the end of the day" → "ultimately"']],
    [/^Redundancy|already|by definition|^Redundant|Doubly redundant|needs no|admits no degree|takes no degree|^Absolute adjective|^An absolute|^Unique|^The adjective is already absolute|^Exaggeration needs|^“Equally as”|^“Off of”|^“Repeat”|^“Return”|^“Revert”|^“Continue” carries|^Each,? or every|^The first run|is earned at the second|^“The reason why”|^"Why" is redundant|^One will carry it|^One hedge suffices|^“All the” carries|^“Both the” carries|^“Half the” carries/i, ['Some words already contain the meaning of the word beside them. Saying it twice adds length, not meaning.', '"end result" → "result" · "past history" → "history"']],
    [/is shorter and clearer|alone (?:is shorter|carries)|is enough$|weighs less|carries it$|^Wordy|^Overtalk|^Padding|usually removable|^“For the purpose of”|^“So as to”|^“We are able to”|^“Yet” alone|^“Whether” alone|^“To” alone|^A long way around it|^“In regard to”|^“Promptly”|is more natural here|^“More than”|^“Because of” is the plainer|^Can usually be|^“Little research”|^Needed on what|^“Plays a role”|^“A number of studies”|^“Many”, “much”|^Register: informal quantifier/, ['A long phrase that means what a short one means makes the reader work harder for the same idea. Use the short form.', '"in order to" → "to" · "at this point in time" → "now"']],
    [/^Double negative|already negative|already negates/, ['Two negatives cancel each other out in standard English. Use one negative word.', '"I can\'t hardly see" → "I can hardly see"']],
    [/comparative|superlative/i, ['A short adjective compares with -er and -est; a long one with "more" and "most". Never use both together.', '"more bigger" → "bigger" · "most fastest" → "fastest"']],
    [/“?me”?, not “?I|the pronoun is "me"|^“Myself”|^Between you and me|^For you and me|object of the preposition/i, ['After a preposition (between, for, with, to) the pronoun takes the object form: me, him, her, us, them. As the subject of a verb it takes I, he, she, we, they.', '"between you and I" → "between you and me"']],
    [/singular verb|plural verb|takes the singular|takes “are”|takes “is”|^Agreement|there are”|there were”|“There are”|The verb answers|plural subject|^“He has”|^“She has”|^"People" and "children"|^The plural takes|is the singular|^Criteria is the plural|^These are plural|^"criterion"|^“Phenomen|^"Data"|^“Data”|^“Media”|^The data were|^A plural takes no singular article|^Subject-verb/i, ['The verb must match its subject: one thing takes a singular verb (is, has, was); several things take a plural verb (are, have, were). Find the true subject, not the nearest noun.', '"The number of students are rising" → "The number of students is rising"']],
    [/fewer|“less”|"less"|"many"|“many”|number of|amount of|no plural|uncountable|counts as a whole|^Count nouns|^Countable|^Advice/i, ['Things you can count (cars, people) take "many", "fewer" and "number of". Things you cannot count (water, advice, information) take "much", "less" and "amount of", and have no plural.', '"less cars" → "fewer cars" · "informations" → "information"']],
    [/bare verb|modal verb|^An irregular verb|^Have wants|takes no auxiliary|past is not formed|^Brought|^After a modal|^After “?did|^“I saw”|subjunctive|^It is “(?:could|should|would|might|must) have”|^Couldn’t have|^“?Have done|^“?Have gone|^Should of|^“Set up” as the verb|^A modal/i, ['Some verb positions need one particular form: after can, will, must, does or did, the bare verb (go, see); after has or have, the past participle (gone, seen).', '"can goes" → "can go" · "have went" → "have gone"']],
    [/apostrophe|^"its'"|^“Its”|possessive|^Hers|^His takes|^No apostrophe|^“Where’s”|^Missing apostrophe|^Check “your”|^"Their own"|^"There is", not "their is"/i, ['An apostrophe marks letters left out ("it\'s" = "it is") or ownership by a noun ("the author\'s"). Possessive pronouns (its, hers, ours, yours, theirs) never take one.', '"its\' colour" → "its colour" · "dont" → "don\'t"']],
    [/^Article|“an”|“a”|"an"|"a"|vowel sound|aspirate/, ['Use "a" before a consonant sound and "an" before a vowel sound. The sound decides, not the letter.', '"an hour" · "a university" · "an MA"']],
    [/capital|Capitalise|lowercase|^Proper adjectives|^Days of the week|^Months/i, ['Sentences, names, days, months and the pronoun "I" begin with a capital letter.', '"on monday i met anna" → "On Monday I met Anna"']],
    [/e\.g\.|i\.e\.|et al|^Etc|etc\.|Et cetera|“cf\.”/i, ['Latin abbreviations keep their full stops: e.g. (for example), i.e. (that is), et al. (and others), etc. (and so on).', '"eg" → "e.g." · "et al" → "et al."']],
    [/Hyphenate|two words|One word|is one word|compound|^Every day|^Every time|^No one|^Each other|^In case|^As well|^At least|^Anyway|^“All right”|^“Nowadays”/i, ['Some word pairs are written as two words, some as one, and some with a hyphen; the spelling can change the meaning.', '"every day" (each day) · "everyday" (ordinary) · "a well-known author"']],
    [/^The spelling is|^Correct spelling|^Double [mps]|^One c|^Two c|^No d in|^No e after|ending is|^"ent"|^Spelling|^Double s|^Double p/i, ['Some words are often misspelled because they are not written the way they sound. Learn the tricky part of the word.', '"accommodate": double c, double m']],
    [/idiom|mishearing|^It is “|moot|bud\b|the bit|tenterhooks|^Bated|deserts|squib|rein|^Beck and call|^Dog-eat-dog|^Deep-seated|^Chock-full|^Harebrained|[Ii]ntents|pudding|^“Whet”|^Granted|^Barred|hon(?:e|ing|ed)|homed|card sharp|^Ado |^By AND large|^Case IN point|^One AND the same|^One and the same|^Couldn’t care less|^All of a sudden|^Bear with me|^Cut at the bud|^A target is homed|^Horses “champ”|^Piqued|piqued|^A damp squib|^A moot|^Ever since|^For all intents|^Espresso|^Especially|^In whose|^In fact$/, ['Fixed expressions keep their original words, even when another word sounds the same. Use the expression in its standard form.', '"for all intents and purposes" (not "intensive purposes")']],
    [/\) vs "|" vs "|is the verb|is the noun|is the adjective|means not moving|^Confusable|^Do you mean|^Perhaps “|^“Different from”|^“Farther”|^“Continual”|^Often misused|^“Begs the question”|affect|effect|^"Lose"|^"Principal"|^“Breathe”|^"passed"|^"Everyday" is an adjective/i, ['English has pairs of words that sound alike but mean different things. Check which meaning your sentence needs.', '"affect" (a verb: to change) · "effect" (a noun: the result)']],
    [/takes no "?(?:about|on|to)|^"[A-Z][a-z]+ (?:of|in|on|for|to|with|from)"$|collocation|is the standard form|^Grounded|takes “than”|^Comparisons take|^A comparison takes|^Things centre|^"centre on"|^"Based on"|^"Explain to me"|^"By accident"|^"On purpose"|^"In my opinion"|^"According to"|^"On the other hand"|^"In regard to"|^"With regard to"|^It is “(?:no sooner|none other|other|rather) than”|^It is “vice versa”/, ['Many verbs and adjectives pair with one particular preposition. The pair is fixed by usage, not by logic, so it has to be learned.', '"interested in" · "depend on" · "discuss the plan" (no "about")']],
    [/comma|semicolon|colon|full stop|period|space|punctuation|terminal mark|Two dots|ellipsis|^Doubled punctuation|emphasis/i, ['Punctuation sits right after the word before it, with one space after it, and is not doubled.', '"word ,next" → "word, next" · "end.." → "end."']],
    [/^(?:Doubled word|Repeated word|The word is doubled|Triple)/, ['A doubled word usually comes from stopping mid-edit. Reading aloud catches it.', '"the the report" → "the report"']],
    [/numeral|figures|^Numerals/i, ['In formal prose, numbers under ten are usually written as words, and a sentence never begins with a figure.', '"3 studies" → "three studies" · "12 people came." → "Twelve people came."']],
    [/^Exclamation|^Question/, ['Formal prose states its points. An exclamation mark shifts the tone toward speech.', '"The effect was large!" → "The effect was large."']],
    [/^Announcement|^Map the argument|^The preface|^The conclusion is argued|^“In conclusion”|^Some fields take “I”|^The seeing belongs|^“It can be argued”|^“It could be said”/, ['Announcing what a text will do delays doing it. Make the claim itself, in the present tense.', '"This paper will argue that…" → "This paper argues that…"']],
    [/formal|register|Register|academic|weight|is stronger|stronger|precise|plainer|Informal|informal|colloquial|speech|reads more|^“Try to”|^"try to"/i, ['Each kind of writing has its own level of formality. In formal and academic writing, choose the precise, standard word over the casual one.', '"a lot of" → "many" · "kids" → "children"']],
    [/scene|line should play|sudden|^Filter word|adverb explains/i, ['In fiction, show the moment directly. Words that report a feeling or explain a line put distance between the reader and the scene.', '"she said quietly" → "she said"']],
    [/^Hedge doubled|^Seem and suggest|^Honesty is not a degree/, ['One hedge is careful; two in a row sound unsure. Keep the one that fits.', '"may perhaps" → "may" · "seem to suggest" → "suggest"']],
    [/^Your rule:/, ['This is a rule you wrote yourself, in Studio, Rules.', 'Change or switch it off there.']]
  ];
  function lesson(why) {
    why = String(why || '');
    for (const [re, L] of LESSON) if (re.test(why)) return L;
    return null;
  }
  /* 7.52: a lesson built from the sentence itself, for the families whose
     rule is general but whose instance is particular: agreement ("results"
     means more than one, so "were"), number after a quantity ("many"
     counts more than one, so "problems"), the missing article ("place" is
     one thing you can count, so "a"). e has orig, fix, why (and pat, the
     family); t is the text the note sits in. [rule, example] or null. */
  const QQ = x => '\u201c' + x + '\u201d', capW = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const PRON_ONE = /^(he|she|it|this|that|everyone|everybody|someone|somebody|nobody|each|either|neither|one)$/i, PRON_MANY = /^(they|we|these|those|both|many|several|few|people|children|men|women|police)$/i, PRON_I_YOU = /^(i|you)$/i;
  const STOPW = /^(of|in|on|at|for|with|to|from|by|that|which|who|whom|and|or|but|is|are|was|were|has|have|had|will|would|can|could|should|than|as|like|if|when|because|while|so)$/i;
  function nextWords(t, at, n) {
    const m = /^[\s,]*((?:[A-Za-z][A-Za-z'\u2019-]*\s*){1,4})/.exec(String(t || '').slice(at)); if (!m) return '';
    const out = []; for (const w of m[1].trim().split(/\s+/)) { if (out.length && (/^[A-Z]/.test(w) || STOPW.test(w))) break; out.push(w); if (out.length >= n) break; } return out.join(' ');
  }
  function prevWords(t, at, n) { const ws = String(t || '').slice(Math.max(0, at - 60), at).replace(/[^A-Za-z'\u2019\s]/g, ' ').trim().split(/\s+/).filter(Boolean); return ws.slice(-n).join(' '); }
  function sentenceLesson(e, t) {
    if (!e || typeof e.fix !== 'string') return null;
    const why = String(e.why || ''), pat = String(e.pat || ''), orig = String(e.orig || ''), fix = e.fix;
    const ex = (orig.trim() || '\u2026') + ' \u2192 ' + fix.trim();
    const ow = orig.trim().split(/\s+/).filter(Boolean), fw = fix.trim().split(/\s+/).filter(Boolean);
    /* agreement, and a verb's -s after its subject */
    if (/^Agreement|agrees with its subject|takes \u201c-s\u201d on the verb|takes the plain verb|^\u201cHe has\u201d|^Verb form$|^A plural subject takes|^A singular subject takes|^The verb agrees with its subject/.test(why) || pat === 'The verb agrees with its subject') {
      if (ow.length !== fw.length || !ow.length) return null;
      const di = ow.findIndex((w, i) => w.toLowerCase() !== fw[i].toLowerCase());
      if (di < 0 || ow.some((w, i) => i !== di && w.toLowerCase() !== fw[i].toLowerCase())) return null;
      const was = ow[di].toLowerCase(), verb = fw[di].toLowerCase(), before = ow.slice(0, di), after = ow.slice(di + 1);
      if (before.length && /^there$/i.test(before[before.length - 1])) {
        const follow = (after.join(' ') + ' ' + nextWords(t, e.end, 1)).trim(), many = /^(are|were|have)$/.test(verb);
        return ['After ' + QQ('there') + ' the verb agrees with what follows: ' + QQ(follow) + (many ? ' means more than one, so ' : ' means one, so ') + QQ('there ' + verb) + '.', ex];
      }
      /* a verb alone ("likes" to "like"): its subject stands just before it in the text */
      const beforeTxt = before.length ? before.join(' ') : (ow.length === 1 && t ? prevWords(t, e.start, 2) : '');
      const subj = beforeTxt.replace(/^(the|a|an|my|our|your|their|his|her|its|this|that|these|those|all|some|many|several|both|few|various)\s+/i, '');
      if (!subj || before.length > 3 || /\s/.test(subj) && !before.length) return null;
      const sl = subj.toLowerCase();
      const sg = /^(is|was|has|does|doesn't|isn't|wasn't)$/.test(verb) || (/s$/.test(verb) && !/s$/.test(was));
      const pl = /^(are|were|have|do|don't|aren't|weren't)$/.test(verb) || (/s$/.test(was) && !/s$/.test(verb));
      if (sg === pl) return null;
      if (PRON_I_YOU.test(sl)) return [QQ(capW(subj)) + ' takes ' + QQ(verb) + ', whatever its number: ' + subj + ' ' + verb + '.', ex];
      if (sg) {
        if (!(PRON_ONE.test(sl) || !/s$/.test(sl) || /ss$/.test(sl))) return null;   /* "eggs is": the subject stands elsewhere */
        return [QQ(capW(subj)) + (PRON_ONE.test(sl) ? ' is one person or thing' : ' means one') + ', so the verb is ' + QQ(verb) + ': ' + subj + ' ' + verb + '.', ex];
      }
      if (!(PRON_MANY.test(sl) || (/s$/.test(sl) && !/ss$/.test(sl)) || /\band\b/i.test(sl))) return null;   /* "team were": a collective */
      return [QQ(capW(subj)) + ' means more than one, so the verb is ' + QQ(verb) + ': ' + subj + ' ' + verb + '.', ex];
    }
    /* number after a quantity */
    if (pat === 'Singular or plural after a quantity' || /^Singular or plural after a quantity|^After \u201c|^After "/.test(why)) {
      if (ow.length !== 1 || fw.length !== 1) return null;
      const noun = fw[0], before = prevWords(t, e.start, 3);
      const m = /\b(one of the|each|every|another|many|several|few|a few|various|numerous|both|two|three|four|five|six|seven|eight|nine|ten|hundreds of|thousands of|a lot of|lots of|a number of|most|some|all|these|those|much|this|that)$/i.exec(before);
      const qn = m ? m[1].toLowerCase() : (before.split(/\s+/).pop() || '').toLowerCase();
      if (!qn) return null;
      const plural = /s$/.test(noun) && !/s$/.test(ow[0]);
      if (qn === 'one of the') return [QQ('One of the') + ' picks one out of several, so the noun is plural: one of the ' + noun + '.', ex];
      if (plural) return [QQ(capW(qn)) + ' counts more than one, so the noun is plural: ' + qn + ' ' + noun + '.', ex];
      return [QQ(capW(qn)) + ' takes one at a time, so the noun is singular: ' + qn + ' ' + noun + '.', ex];
    }
    /* the missing article */
    if (pat === 'A missing article' || /^A missing article|^A singular countable noun takes|^A singular count noun takes|^A role takes its article|^A superlative or an ordinal takes/.test(why)) {
      const low = ow.map(x => x.toLowerCase()), added = fw.filter(w => !low.includes(w.toLowerCase()));
      if (added.length !== 1 || !/^(a|an|the)$/i.test(added[0])) return null;
      const art = added[0].toLowerCase(), k = fw.findIndex(w => w === added[0]);
      const phrase = (orig.trim() ? fw.slice(k + 1).join(' ') : nextWords(t, e.end, 3)).replace(/[.,;:!?]+$/, '');
      if (!phrase) return null;
      const parts = phrase.split(/\s+/), noun = parts[parts.length - 1], first = parts[0];
      if (/superlative|ordinal/i.test(why)) return ['Only one can be the ' + first.toLowerCase() + ', so it takes ' + QQ('the') + ': the ' + phrase + '.', ex];
      if (/role/i.test(why)) return [QQ(capW(noun)) + ' names a role one person holds, so it takes ' + QQ(art) + ': ' + art + ' ' + phrase + '.', ex];
      return [QQ(capW(noun)) + ' is one thing you can count, so it takes ' + QQ(art) + (art === 'an' ? ' (\u201can\u201d before a vowel sound)' : '') + ': ' + art + ' ' + phrase + '.', ex];
    }
    return null;
  }

  const api = { refine: refine, dedupe: dedupe, build: build, lesson: lesson, sentenceLesson: sentenceLesson, family: family, specFor: specFor, passiveParts: passiveParts, activeText: activeText, cut: cut, agentNumber: agentNumber, baseOfPart: baseOfPart, expandContraction: expandContraction, _T: T, _LESSON: LESSON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKREF = api;
})(typeof self !== 'undefined' ? self : this);
