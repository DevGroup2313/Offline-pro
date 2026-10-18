/* Inkwell's offline paraphrasing (7.39): other ways to say a passage, in a
   chosen style, with no writing model, and alternatives for a word by its
   meaning. Built on INKRW (the rule rewrites) and INKLEX (WordNet meanings).
   The method, step by step, the same steps a writing assistant shows:
   1. Read the passage: its idioms and fixed phrases, how formal its words
      are, and the words whose meaning is clear.
   2. Idioms and fixed phrases are said again in the chosen register ("lost
      his train of thought": "lost track of what he was saying", "lost the
      thread of his argument", "forgot what he was going to say"), with the
      verb kept in its tense and the pronoun kept in agreement.
   3. Words move up or down in register, only from a hand-checked list of
      pairs, each with a test of the words around it that holds in both
      directions ("try to" is "attempt to"; "set up a company" is "establish
      a company", but "set up the camera" is left alone).
   4. Sentence openers and links in the register ("So" and "Therefore,";
      ", but" and "; however,"), contractions for the casual register, and
      one change of order where it keeps the meaning.
   5. The rule rewrites of the style (contractions spelt out, wordy phrases).
   Each option lists every change and the reason for it. Quotations,
   citations and links are never touched.
   What this does not do: it does not write new sentences, and it changes a
   word by WordNet only when the writer chooses it, from a list grouped by
   meaning. Automatic WordNet swaps were tried and changed the meaning too
   often ("results" became "consequences", "breeze" became "air"). No
   lookbehind is used (Safari before 16.4). */
(function (root) {
  const req = p => { try { return typeof require === 'function' ? require(p) : null; } catch (e) { return null; } };
  const LEX = () => root.INKLEX || req('./lexicon_core.js');
  const RW = () => root.INKRW || req('./rewrite_core.js');
  const OPEN = '', SHUT = '';
  const ESC = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const capFirst = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  /* ---- verbs in every form, with no lexicon needed ---- */
  const IRV = {
    be: 'is was been being', have: 'has had had having', do: 'does did done doing', go: 'goes went gone going',
    lose: 'loses lost lost losing', make: 'makes made made making', hit: 'hits hit hit hitting', keep: 'keeps kept kept keeping',
    get: 'gets got got getting', beat: 'beats beat beaten beating', break: 'breaks broke broken breaking', cut: 'cuts cut cut cutting',
    fall: 'falls fell fallen falling', take: 'takes took taken taking', come: 'comes came come coming', see: 'sees saw seen seeing',
    steal: 'steals stole stolen stealing', think: 'thinks thought thought thinking', forget: 'forgets forgot forgotten forgetting',
    become: 'becomes became become becoming', blow: 'blows blew blown blowing', find: 'finds found found finding', bear: 'bears bore borne bearing',
    let: 'lets let let letting', set: 'sets set set setting', put: 'puts put put putting', buy: 'buys bought bought buying',
    seek: 'seeks sought sought seeking', begin: 'begins began begun beginning', give: 'gives gave given giving', bring: 'brings brought brought bringing',
    tell: 'tells told told telling', show: 'shows showed shown showing', run: 'runs ran run running', choose: 'chooses chose chosen choosing',
    speak: 'speaks spoke spoken speaking', hold: 'holds held held holding', leave: 'leaves left left leaving', feel: 'feels felt felt feeling',
    say: 'says said said saying', pay: 'pays paid paid paying', lead: 'leads led led leading', meet: 'meets met met meeting',
    understand: 'understands understood understood understanding', draw: 'draws drew drawn drawing', grow: 'grows grew grown growing',
    know: 'knows knew known knowing', write: 'writes wrote written writing', rise: 'rises rose risen rising', spend: 'spends spent spent spending',
    send: 'sends sent sent sending', build: 'builds built built building', deal: 'deals dealt dealt dealing', mean: 'means meant meant meaning',
    sell: 'sells sold sold selling', stand: 'stands stood stood standing', throw: 'throws threw thrown throwing', teach: 'teaches taught taught teaching',
    catch: 'catches caught caught catching', win: 'wins won won winning', speed: 'speeds sped sped speeding', undertake: 'undertakes undertook undertaken undertaking',
    fight: 'fights fought fought fighting', swim: 'swims swam swum swimming', sit: 'sits sat sat sitting', bite: 'bites bit bitten biting',
    cost: 'costs cost cost costing', read: 'reads read read reading', bend: 'bends bent bent bending', wing: 'wings winged winged winging'
  };
  /* stress on the last syllable: the consonant doubles */
  const DOUBLE = /^(occur|refer|prefer|commit|admit|omit|permit|submit|control|compel|regret|equip|incur|deter|confer|transfer|rebut|allot|concur|acquit|patrol|expel|dispel|repel|excel|propel|forbid|overcommit)$/;
  const cvc = b => /^[^aeiou]*[aeiou][bdfgklmnprtvz]$/.test(b);
  function regular(b, k) {
    if (k === 's') return /(s|x|z|ch|sh|o)$/.test(b) ? b + 'es' : /[^aeiou]y$/.test(b) ? b.slice(0, -1) + 'ies' : b + 's';
    const dbl = DOUBLE.test(b) || cvc(b);
    if (k === 'ing') {
      if (/ie$/.test(b)) return b.slice(0, -2) + 'ying';
      if (/[^aeioy]e$/.test(b)) return b.slice(0, -1) + 'ing';
      return dbl ? b + b.slice(-1) + 'ing' : b + 'ing';
    }
    if (/e$/.test(b)) return b + 'd';
    if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ied';
    return dbl ? b + b.slice(-1) + 'ed' : b + 'ed';
  }
  const VF = {};
  function verbForms(base) {
    if (VF[base]) return VF[base];
    const f = { '': base };
    if (IRV[base]) { const p = IRV[base].split(' '); f.s = p[0]; f.ed = p[1]; f.en = p[2]; f.ing = p[3]; }
    else {
      for (const k of ['s', 'ed', 'ing']) f[k] = regular(base, k);
      f.en = f.ed;
      /* an irregular verb this list lacks: the lexicon knows its forms */
      const X = LEX();
      if (X && X.ready && X._L.INV.v.has(base)) { const a = X.inflect(base, 'v', 'ed'), b = X.inflect(base, 'v', 'en'); if (a) f.ed = a; if (b) f.en = b; }
    }
    return VF[base] = f;
  }
  /* the form of a verb as it stands, where one spelling serves two forms
     ("hit", "lost"): read from the word before it and the sentence's tense */
  function formOf(base, word, before, sentence) {
    const f = verbForms(base), w = word.toLowerCase(), keys = Object.keys(f).filter(k => f[k].toLowerCase() === w);
    if (keys.length <= 1) return keys[0] || '';
    const pv = ((before.match(/([A-Za-z'’]+)[\s]*$/) || [])[1] || '').toLowerCase();
    if (/^(have|has|had|having|'ve|'d|been|be|being|is|are|was|were|am|get|gets|got)$/.test(pv) && keys.indexOf('en') >= 0) return 'en';
    if (/^(will|would|can|could|should|shall|may|might|must|to|do|does|did|don't|didn't|doesn't|won't|can't|cannot|let's|please)$/.test(pv) && keys.indexOf('') >= 0) return '';
    if (keys.indexOf('ed') >= 0) {
      /* "I hit", "they cut": present or past; the sentence's other verbs say */
      const rest = sentence.toLowerCase().replace(w, ' ');
      const past = /\b(was|were|had|did|went|came|said|told|made|took|got|saw|knew|thought|found|gave|left|felt|became|began|yesterday|ago|[a-z]{3,}ed)\b/.test(rest);
      const now = /\b(is|are|am|has|does|will|can|now|today|always|usually|every)\b/.test(rest);
      if (keys.indexOf('') >= 0 && now && !past) return '';
      return 'ed';
    }
    return keys[0];
  }

  /* ---- spans never touched: quotations, citations, links ---- */
  function protect(text) {
    const spans = [];
    const add = re => { let m; re.lastIndex = 0; while ((m = re.exec(text))) spans.push([m.index, m.index + m[0].length]); };
    add(/"[^"\n]*"|“[^”\n]*”/g); add(/\([^()]*\d{4}[^()]*\)|\[[\d,\s–-]+\]/g); add(/https?:\/\/\S+/g);
    /* a quotation still open at the end of the selection runs to its end */
    const straight = (text.match(/"/g) || []).length, open = text.lastIndexOf('“');
    if (straight % 2) spans.push([text.lastIndexOf('"'), text.length]);
    if (open > text.lastIndexOf('”')) spans.push([open, text.length]);
    return (a, b) => spans.some(s => a < s[1] && s[0] < b);
  }
  /* inside words an earlier step wrote: left alone, so no change is changed
     again ("often" to "frequently" to "oftentimes") */
  function fresh(t, at) {
    let open = 0;
    for (let i = 0; i < at; i++) { const c = t.charCodeAt(i); if (c === 0xE000) open++; else if (c === 0xE001) open--; }
    return open > 0;
  }
  const strip = t => t.replace(/[]/g, '');
  const WORD = "[A-Za-z0-9'’-]+", GAP = '[\\s\\uE000\\uE001]+';
  const AFTER = new RegExp('^' + GAP + '(' + WORD + ')(?:' + GAP + '(' + WORD + '))?');
  const BEFORE = new RegExp('(' + WORD + ')' + GAP + '$');
  function around(t, a, b) {
    const n = AFTER.exec(t.slice(b, b + 60)) || [], p = BEFORE.exec(t.slice(Math.max(0, a - 40), a)) || [];
    return { n: (n[1] || '').toLowerCase(), n2: (n[2] || '').toLowerCase(), p: (p[1] || '').toLowerCase() };
  }

  /* ---- 2. idioms and fixed phrases, in three registers ---- */
  const POSS = { my: 'I', your: 'you', his: 'he', her: 'she', its: 'it', our: 'we', their: 'they' };
  const SELF = { my: 'myself', your: 'yourself', his: 'himself', her: 'herself', its: 'itself', our: 'ourselves', their: 'themselves' };
  function beFor(subj, past) {
    const s = String(subj || '').toLowerCase();
    if (past) return /^(you|we|they)$/.test(s) ? 'were' : 'was';
    return s === 'i' ? 'am' : /^(you|we|they)$/.test(s) ? 'are' : 'is';
  }
  /* [the idiom, said plainly, said formally, said casually]. {V:verb} is the
     verb in the idiom's own form, {P} the possessive, {S} a pronoun subject,
     {N:x} a word kept as written ("mind" or "minds"), {BE} "is" or "was" to
     agree; a pattern may hold a regular expression */
  const IDIOM_ROWS = [
    ['{V:lose} {P} train of thought', '{V:lose} track of what {S} {BE} saying', '{V:lose} the thread of {P} argument', '{V:forget} what {S} {BE} going to say'],
    ['{V:lose} track of time', '{V:forget} the time', '{V:lose} all sense of time', '{V:lose} track of the time'],
    ['{V:lose} {P} temper', '{V:become} angry', '{V:become} visibly angry', '{V:blow} up'],
    ['{V:make} up {P} {N:minds?}', '{V:decide}', '{V:reach} a decision', '{V:make} {P} {N} up'],
    ['{V:change} {P} minds?', '{V:change} {P} view', '{V:revise} {P} position', '{V:have} second thoughts'],
    ['at the end of the day', 'in the end', 'ultimately', "when all's said and done"],
    ['a piece of cake', 'easy', 'straightforward', 'a breeze'],
    ['{V:hit} the nail on the head', '{V:describe} it exactly', '{V:identify} the point precisely', '{V:get} it spot on'],
    ['the tip of the iceberg', 'a small part of a larger problem', 'a small, visible part of a larger problem', 'just the start'],
    ['in a nutshell', 'in short', 'in summary', 'basically'],
    ['{V:keep} an eye on', '{V:watch}', '{V:monitor}', '{V:keep} tabs on'],
    ['{V:get} the ball rolling', '{V:start} things', '{V:initiate} the process', '{V:kick} things off'],
    ['{V:beat} around the bush', '{V:avoid} the point', '{V:avoid} the question', '{V:dodge} the issue'],
    ['{V:break} the ice', '{V:ease} the tension', '{V:open} the conversation', '{V:get} things going'],
    ['{V:cut} corners', '{V:skimp} on the work', '{V:compromise} on standards', '{V:take} shortcuts'],
    ['on the same page', 'in agreement', 'in accord', 'on the same wavelength'],
    ['once in a blue moon', 'rarely', 'very infrequently', 'hardly ever'],
    ['under the weather', 'unwell', 'indisposed', 'a bit off'],
    ['{V:call} it a day', '{V:stop} for the day', '{V:conclude} the work for the day', '{V:wrap} up'],
    ['back to square one', 'back to the start', 'back to the beginning', 'back to scratch'],
    ['a blessing in disguise', 'a hidden benefit', 'an unexpected advantage', 'a lucky break'],
    ['the best of both worlds', 'the advantages of both', 'the benefits of both options', 'a win-win'],
    ['{V:miss} the boat', '{V:miss} the chance', '{V:miss} the opportunity', '{V:blow} it'],
    ['{V:spill} the beans', '{V:reveal} the secret', '{V:disclose} the information', '{V:let} it slip'],
    ['by the skin of {P} teeth', 'only just', 'narrowly', 'barely'],
    ['a drop in the ocean', 'a tiny amount', 'a negligible contribution', 'next to nothing'],
    ['{V:jump} on the bandwagon', '{V:follow} the trend', '{V:adopt} a popular position', '{V:go} along with the crowd'],
    ['{V:hit} the books', '{V:study}', '{V:study} intensively', '{V:get} studying'],
    ['in the long run', 'over time', 'in the long term', 'eventually'],
    ['at first glance', 'at first sight', 'on initial inspection', 'at first'],
    ['the elephant in the room', 'the obvious problem no one mentions', 'the unacknowledged issue', 'the thing nobody wants to talk about'],
    ['{V:think} outside the box', '{V:think} creatively', '{V:think} unconventionally', '{V:think} differently'],
    ['a level playing field', 'a fair situation', 'equal conditions', 'a fair shot'],
    ['{V:go} the extra mile', '{V:make} an extra effort', '{V:exceed} what is expected', '{V:go} above and beyond'],
    ['{V:fall} through the cracks', '{V:go} unnoticed', '{V:escape} notice', '{V:slip} through the net'],
    ['{V:raise} the bar', '{V:set} a higher standard', '{V:raise} the standard', '{V:set} the bar higher'],
    ['on thin ice', 'at risk', 'in a precarious position', 'in a risky spot'],
    ['a double-edged sword', 'something with good and bad effects', 'a mixed blessing', 'a mixed bag'],
    ['{V:turn} a blind eye to', '{V:ignore}', '{V:disregard}', '{V:pretend} not to see'],
    ['{V:get} to the bottom of', '{V:find} the cause of', '{V:determine} the cause of', '{V:figure} out'],
    ['{V:take} into account', '{V:consider}', '{V:take} into consideration', '{V:think} about'],
    ['as a matter of fact', 'in fact', 'indeed', 'actually'],
    ['sooner or later', 'eventually', 'in due course', 'at some point'],
    ['{V:come} to terms with', '{V:accept}', '{V:reconcile} {P}self to', '{V:get} used to'],
    ['last but not least', 'finally', 'finally, and importantly', 'and last'],
    ['{V:see} eye to eye', '{V:agree}', '{V:concur}', '{V:get} along'],
    ['{V:pull} {P} weight', '{V:do} {P} share', '{V:contribute} {P} share', '{V:do} {P} bit'],
    ['{V:face} the music', '{V:accept} the consequences', '{V:accept} responsibility', '{V:take} the heat'],
    ['{V:steal} the show', '{V:attract} the most attention', '{V:dominate} the occasion', '{V:steal} the spotlight'],
    ['a long shot', 'unlikely to succeed', 'improbable', 'a bit of a gamble'],
    ['{V:get} out of hand', '{V:get} out of control', '{V:become} unmanageable', '{V:go} off the rails'],
    ['{V:run} out of steam', '{V:lose} energy', '{V:lose} momentum', '{V:run} out of gas'],
    ['{V:bite} off more than {S} can chew', '{V:take} on too much', '{V:overcommit}', '{V:take} on more than {S} can handle'],
    ['{V:bite} off more than {S} could chew', '{V:take} on too much', '{V:overcommit}', '{V:take} on more than {S} could handle'],
    ['{V:go} back to the drawing board', '{V:start} again', '{V:begin} anew', '{V:start} over'],
    ['{V:hit} the ground running', '{V:start} quickly and well', '{V:begin} effectively at once', '{V:get} off to a flying start'],
    ['{V:keep} {P} fingers crossed', '{V:hope} for the best', '{V:remain} hopeful', '{V:hope} for the best'],
    ['{V:make} ends meet', '{V:manage} on {P} income', '{V:meet} {P} expenses', '{V:get} by'],
    ['{V:take} it with a grain of salt', '{V:doubt} it a little', '{V:treat} it with some scepticism', '{V:take} it with a pinch of salt'],
    ['in hot water', 'in trouble', 'in difficulty', 'in a fix'],
    ['up in the air', 'undecided', 'unresolved', 'still open'],
    ['a dime a dozen', 'very common', 'commonplace', 'ten a penny'],
    ['the last straw', 'the final problem', 'the decisive provocation', 'the final straw'],
    ['{V:cost} an arm and a leg', '{V:cost} a lot', '{V:cost} a great deal', '{V:cost} a fortune'],
    ['{V:read} between the lines', '{V:see} the hidden meaning', '{V:infer} the implicit meaning', '{V:get} the hint'],
    ['on the fence', 'undecided', 'uncommitted', 'in two minds'],
    ['{V:bend} over backwards', '{V:try} very hard', '{V:make} every effort', '{V:go} out of {P} way'],
    ['{V:pass} the buck', '{V:shift} the blame', '{V:evade} responsibility', '{V:dodge} the blame'],
    ['{V:play} it by ear', '{V:decide} as {S} {BE} going', '{V:proceed} flexibly', '{V:wing} it'],
    ['in the nick of time', 'just in time', 'at the last moment', 'just in time'],
    ['{V:get} cold feet', '{V:lose} confidence', '{V:become} hesitant', '{V:chicken} out'],
    ['{V:hit} the sack', '{V:go} to bed', '{V:retire} for the night', '{V:turn} in'],
    ['on cloud nine', 'very happy', 'elated', 'over the moon']
  ];
  let IDIOMS = null;
  function compileIdioms() {
    IDIOMS = IDIOM_ROWS.map(r => {
      const slots = [];
      const src = r[0].replace(/\{V:([a-z]+)\}|\{N:([^}]+)\}|\{P\}|\{S\}|\s+/g, (m, v, nn) => {
        if (v) { slots.push(['V', v]); const f = verbForms(v); return '(' + Array.from(new Set(Object.values(f))).sort((a, b) => b.length - a.length).join('|') + ')'; }
        if (nn) { slots.push(['N']); return '(' + nn + ')'; }
        if (m === '{P}') { slots.push(['P']); return '(my|your|his|her|its|our|their)'; }
        if (m === '{S}') { slots.push(['S']); return '(I|you|he|she|it|we|they)'; }
        return '\\s+';
      });
      return { pat: r[0], re: new RegExp('\\b' + src + '\\b', 'gi'), slots: slots, out: { plain: r[1], formal: r[2], casual: r[3] } };
    });
  }
  const IDWHY = { plain: 'An idiom said plainly: every reader takes the meaning at once.', formal: 'The idiom in a formal register, as academic writing prefers.', casual: 'The idiom said the casual way.' };
  function fill(tpl, form, poss, subj) {
    const p = (poss || 'their').toLowerCase(), s = subj || POSS[p] || 'it';
    const past = form === 'ed' || form === 'en';
    return tpl.replace(/\{V:([a-z]+)\}/g, (m, v) => verbForms(v)[form || ''] || v)
      .replace(/\{P\}self/g, SELF[p] || 'themselves').replace(/\{P\}/g, poss || 'their').replace(/\{S\}/g, s).replace(/\{BE\}/g, beFor(s, past));
  }
  function idioms(text, style, log) {
    if (!IDIOMS) compileIdioms();
    let t = text;
    for (const id of IDIOMS) {
      const prot = protect(t);
      id.re.lastIndex = 0;
      let m, out = '', last = 0, hit = false;
      while ((m = id.re.exec(t))) {
        if (prot(m.index, m.index + m[0].length) || fresh(t, m.index)) continue;
        /* a title: "The Elephant in the Room" */
        if (/[A-Z]/.test(m[0].slice(1).replace(/\bI\b/g, ''))) continue;
        let form = '', poss = null, subj = null, noun = '', gi = 1;
        for (const sl of id.slots) {
          const v = m[gi++];
          if (sl[0] === 'V') form = formOf(sl[1], v, t.slice(0, m.index), t);
          else if (sl[0] === 'P') poss = v;
          else if (sl[0] === 'N') noun = v;
          else subj = v;
        }
        let rep = fill(id.out[style] || id.out.plain, form, poss, subj).replace(/\{N\}/g, noun);
        if (/^[A-Z]/.test(m[0]) && !/^I\b/.test(m[0])) rep = capFirst(rep);
        if (rep === m[0]) continue;
        log.push({ from: m[0], to: rep, why: IDWHY[style] || IDWHY.plain });
        out += t.slice(last, m.index) + OPEN + rep + SHUT; last = m.index + m[0].length; hit = true;
      }
      if (hit) t = out + t.slice(last);
    }
    return t;
  }

  /* ---- 3. register: hand-checked pairs ---- */
  /* [kind, the everyday word, the formal word, test, direction]. kind: v a
     verb (its first word takes the form), w a word or phrase as it stands,
     n a noun with its plural. The test sees the next word (n), the one after
     (n2) and the word before (p), and holds in both directions, so a pair is
     used only where the two mean the same. Direction: b both; u only towards
     the formal; d only towards the everyday; c the casual style's own words
     ("kids"), used towards the formal by every style but towards the
     everyday only by Casual; cr Casual's only, never back. */
  const DET = /^(the|a|an|this|that|these|those|its|their|his|her|our|my|your|some|any|no|each|every|one|two|three|all|more|further|additional|new)$/;
  const OBJ = /^(me|you|him|her|us|them|it)$/;
  const WH = /^(how|what|why|whether|where|when|who|which|if)$/;
  const nounAfter = list => { const re = new RegExp('^(' + list + ')$'); return c => re.test(c.n) || (DET.test(c.n) && re.test(c.n2)); };
  const GROW = /^(grow|grows|grew|grown|growing|increase|increases|increased|increasing|expand|expands|expanded|expanding|rise|rises|rose|risen|rising|spread|spreads|spreading|decline|declines|declined|declining|change|changes|changed|changing|develop|develops|developed|developing|fall|falls|fell|falling|deteriorate|deteriorated|evolve|evolved|evolving|growth|expansion|decline|change|changes)$/;
  const PLAINADJ = /^(big|good|large|small|long|old|strong|fast|high|far|well|bad|soon|early|late|hard|easy|clear|close|near|deep|wide|warm|cold|safe|sure|true|fair|rich|ready|able|serious|important|interesting|lucky|kind|brave|funny|smart|tall|short|young|quick|slow|loud|bright|often|much|little|clever|fortunate|generous|foolish|naive|silly)$/;
  const PAIRS = [
    ['v', 'buy', 'purchase', c => !/^(into|it|that)$/.test(c.n), 'b'],
    /* "help them with", "help in": never "help defeat", which "assist" cannot take */
    ['v', 'help', 'assist', c => /^(with|in)$/.test(c.n) || (OBJ.test(c.n) && /^(with|in|)$/.test(c.n2)), 'b'],
    ['v', 'try', 'attempt', c => c.n === 'to', 'b'],
    ['v', 'start', 'begin', c => /^(to|with|by)$/.test(c.n), 'b'],
    ['v', 'seem', 'appear', c => /^(to|that|likely|unlikely|clear|certain|possible|unable|able|reasonable|strange|odd|plausible)$/.test(c.n), 'b'],
    /* never back: "the species occurs in Africa" does not "happen" there */
    ['v', 'happen', 'occur', c => !/^(to|upon|that|so)$/.test(c.n), 'u'],
    ['v', 'check', 'verify', c => /^(that|whether|if)$/.test(c.n), 'b'],
    ['v', 'end', 'conclude', c => /^(with|by)$/.test(c.n), 'b'],
    /* "the Act required the storage of" is not "needed": back only before a or more */
    ['v', 'need', 'require', c => (c.dir === 'up' ? /^(a|an|the|more|further|additional|no|some|access|help|support|time|care|attention)$/ : /^(a|an|more|further|additional|help|support|time|care|attention)$/).test(c.n) && c.n2 !== 'to', 'b'],
    ['v', 'get', 'obtain', nounAfter('access|permission|data|results|approval|funding|information|evidence|samples|consent|estimates|measurements|degree|licence|license|visa|copy|copies|sample'), 'b'],
    ['v', 'get', 'receive', nounAfter('letter|letters|email|emails|message|messages|reply|replies|response|responses|call|prize|award|grant|treatment|payment|feedback|support|training|attention'), 'b'],
    ['v', 'give', 'provide', nounAfter('information|data|support|evidence|guidance|feedback|advice|help|assistance|overview|summary|details|access|account|insight|insights|services'), 'b'],
    ['v', 'ask for', 'request', c => !/^(it|that|trouble|nothing|more)$/.test(c.n), 'b'],
    ['v', 'bring up', 'raise', nounAfter('issue|issues|question|questions|concern|concerns|point|points|matter|subject|topic|problem|possibility|objection|objections'), 'b'],
    ['v', 'figure out', 'determine', c => WH.test(c.n), 'b'],
    ['v', 'work out', 'determine', c => WH.test(c.n), 'u'],
    ['v', 'find out', 'discover', c => WH.test(c.n) || c.n === 'that', 'b'],
    ['v', 'turn down', 'decline', nounAfter('offer|offers|invitation|invitations|request|requests|proposal|proposals|job|application|applications|chance|opportunity'), 'b'],
    ['v', 'cut back on', 'reduce', () => true, 'u'],
    ['v', 'get in touch with', 'contact', () => true, 'b'],
    ['v', 'look into', 'investigate', () => true, 'b'],
    ['v', 'put off', 'postpone', c => c.n !== 'by' && !/^(is|are|was|were|be|been|being|feel|felt|get|got)$/.test(c.p), 'b'],
    ['v', 'come up with', 'devise', () => true, 'b'],
    ['v', 'set up', 'establish', nounAfter('business|businesses|company|companies|committee|committees|school|schools|fund|funds|foundation|organisation|organization|society|trust|office|centre|center|programme|program|scheme|network|institute|council|commission|partnership|colony|mission|unit|agency|department|laboratory|practice|firm|charity|clinic|hospital'), 'b'],
    ['v', 'make up for', 'compensate for', () => true, 'b'],
    ['v', 'carry on', 'continue', c => c.n !== 'to' && c.n !== 'with' && c.n !== '', 'u'],
    ['v', 'go back to', 'return to', () => true, 'b'],
    ['v', 'show up', 'arrive', c => c.n !== 'the' && c.n !== 'as', 'u'],
    ['v', 'give up', 'abandon', c => DET.test(c.n), 'b'],
    ['v', 'pick', 'select', c => DET.test(c.n), 'b'],
    ['v', 'talk about', 'discuss', c => DET.test(c.n) || WH.test(c.n), 'd'],
    ['v', 'look at', 'examine', c => DET.test(c.n), 'd'],
    ['v', 'think about', 'consider', c => (DET.test(c.n) && c.n !== 'that') || WH.test(c.n), 'd'],
    ['v', 'deal with', 'address', nounAfter('problem|problems|issue|issues|question|questions|concern|concerns|need|needs|challenge|challenges|matter|matters|gap|gaps|risk|risks|threat|threats|shortage|shortages'), 'd'],
    /* "ensure a safe fight" is not "make sure a safe fight" */
    ['v', 'make sure', 'ensure', c => /^(that|they|we|you|he|she|it|everyone|everybody|nobody)$/.test(c.n), 'd'],
    ['v', 'get rid of', 'eliminate', () => true, 'd'],
    /* amounts go up and down; "awareness must increase" does not "go up" */
    ['v', 'go up', 'increase', c => /^(by|to|from|sharply|steadily|rapidly|slightly|significantly|dramatically)$/.test(c.n), 'd'],
    ['v', 'go down', 'decrease', c => /^(by|to|from|sharply|steadily|rapidly|slightly|significantly|dramatically)$/.test(c.n), 'd'],
    ['v', 'point to', 'indicate', c => DET.test(c.n) && c.n !== 'that', 'd'],
    ['v', 'carry out', 'conduct', nounAfter('study|studies|survey|surveys|research|experiment|experiments|interview|interviews|test|tests|analysis|analyses|investigation|investigations|review|reviews|trial|trials|audit|audits|inquiry|assessment|assessments|evaluation|evaluations|search|fieldwork'), 'd'],
    ['v', 'make clear', 'clarify', c => DET.test(c.n) || WH.test(c.n), 'd'],
    ['v', 'speed up', 'accelerate', () => true, 'd'],
    ['v', 'rule out', 'exclude', c => c.n !== 'from', 'd'],
    ['v', 'lead to', 'result in', () => true, 'd'],
    ['v', 'try', 'endeavour', c => c.n === 'to', 'd'],
    ['v', 'find out', 'ascertain', c => WH.test(c.n), 'd'],
    ['v', 'have', 'possess', c => DET.test(c.n) && c.n !== 'that', 'd'],
    ['v', 'ask', 'inquire', c => WH.test(c.n) || c.n === 'about', 'd'],
    ['v', 'live', 'reside', c => c.n === 'in', 'd'],
    ['v', 'stop', 'cease', c => c.n !== 'to' && c.n !== 'by', 'd'],
    ['v', 'end', 'terminate', nounAfter('contract|contracts|agreement|agreements|employment|lease|pregnancy'), 'd'],
    ['v', 'tell', 'inform', c => OBJ.test(c.n) && /^(that|about|of)$/.test(c.n2), 'b'],
    ['w', 'enough', 'sufficient', c => !/^(the|a|an|this|that|these|those|its|their|his|her|our|my|your)$/.test(c.p) && /^[a-z]/.test(c.n) && !/^(of|that|and|or|is|was|are|were|for)$/.test(c.n) && !/(ly|er|est)$/.test(c.p) && !PLAINADJ.test(c.p), 'b'],
    ['w', 'whole', 'entire', c => /^[a-z]/.test(c.n) && !/^(of|and|or|is|was|are|were|lot|thing|new)$/.test(c.n) && /^(the|this|that|these|those|its|their|his|her|our|my|your)$/.test(c.p), 'b'],
    ['w', 'main', 'principal', c => /^(the|a|its|their|his|her|our|my|your|two|three)$/.test(c.p) && /^[a-z]/.test(c.n) && !/^(road|street|course|meal|line|land|entrance|door|gate|menu|stage|character|characters|page|event|square|office|building|hall|room|switch|bedroom|and|or|principal|principle|priority)$/.test(c.n), 'b'],
    ['w', 'wrong', 'incorrect', c => /^(the|an?|this|that|these|those)$/.test(c.p) && /^(answer|answers|assumption|assumptions|conclusion|conclusions|figure|figures|value|values|result|results|spelling|date|address|number|numbers|information|data|calculation|calculations|interpretation|statement|statements|claim|claims|reading|estimate|estimates|label|labels|version|format|use|usage)$/.test(c.n), 'b'],
    ['w', 'mainly', 'primarily', () => true, 'b'],
    ['w', 'mostly', 'largely', c => c.n !== 'of', 'b'],
    ['w', 'often', 'frequently', c => !/^(as|how|so|too|very|more|most|less|quite|fairly)$/.test(c.p), 'b'],
    ['w', 'quickly', 'rapidly', c => GROW.test(c.n) || GROW.test(c.p), 'b'],
    /* only at the start of a clause: "He is perhaps best known" keeps it */
    ['w', 'maybe', 'perhaps', c => c.p === '', 'c'],
    ['w', 'about', 'approximately', c => /^\d/.test(c.n), 'b'],
    ['w', 'right away', 'immediately', c => c.n === '' && c.p !== '', 'b'],
    ['w', 'hard to', 'difficult to', () => true, 'b'],
    ['w', 'because of', 'owing to', () => true, 'b'],
    ['w', 'it is clear that', 'it is evident that', () => true, 'b'],
    ['w', 'point of view', 'perspective', c => c.p !== 'in' && c.n !== 'to', 'b'],
    ['w', 'before', 'prior to', () => true, 'd'],
    ['w', 'about', 'regarding', () => true, 'd'],
    ['w', 'about', 'with regard to', () => true, 'd'],
    ['w', 'while', 'whilst', () => true, 'd'],
    ['w', 'among', 'amongst', () => true, 'd'],
    /* "upon us" (coming soon) is not "on us" */
    ['w', 'on', 'upon', c => c.p !== 'once' && !/^(which|whom|us|them|me|him|her|you|it)$/.test(c.n), 'd'],
    ['w', 'a lot of', 'a considerable amount of', () => true, 'd'],
    ['w', 'a lot of', 'a great deal of', () => true, 'd'],
    ['w', 'a lot of', 'a large number of', () => true, 'd'],
    ['w', 'many', 'numerous', () => true, 'd'],
    ['w', 'people', 'individuals', () => true, 'd'],
    ['w', 'most of', 'the majority of', c => DET.test(c.n) || /['’]s$/.test(c.n) || /^(them|us|you)$/.test(c.n), 'd'],
    ['w', 'most', 'the majority of', () => true, 'd'],
    ['w', 'help', 'assistance', c => /^(the|your|their|his|her|our|my|for|with|of|some|any|no)$/.test(c.p), 'd'],
    ['w', 'very', 'highly', c => /^(important|significant|likely|unlikely|effective|successful|relevant|competitive|sensitive|variable|controversial|unusual|influential|specific|accurate|efficient|reliable|profitable|valuable|technical|toxic|contagious|dependent|visible|critical|desirable|problematic|complex|probable|improbable|flexible|selective|productive|beneficial|unstable|active|charged|concentrated|diverse|correlated|skilled|qualified|regarded|recommended|educated|trained|respected|motivated|developed|structured|specialised|specialized)$/.test(c.n), 'u'],
    ['w', 'really', 'highly', c => /^(significant|likely|unlikely|effective|successful|relevant|competitive|sensitive|controversial|unusual|influential|accurate|efficient|reliable|valuable|critical|desirable|complex|flexible|productive|beneficial)$/.test(c.n), 'u'],
    /* "improved a lot", "a lot better"; never "a lot more companies" or "thanks a lot" */
    ['w', 'a lot', 'considerably', c => (c.n === '' && /[a-z]{3,}ed$/.test(c.p)) || /^(better|worse|faster|slower|higher|lower|larger|smaller|easier|harder|longer|shorter|greater|cheaper|safer|stronger|weaker)$/.test(c.n), 'u'],
    ['w', 'really', 'very', c => /^(good|bad|useful|helpful|difficult|hard|easy|clear|different|similar|common|rare|high|low|large|small|strong|weak|close|interesting|old|new|long|short|fast|slow|busy|tired|happy|sad|nice|quiet|loud|cold|hot|warm|expensive|cheap|popular|serious|simple|careful|lucky|proud|sure|keen|kind)$/.test(c.n) && c.p !== 'not', 'u'],
    ['w', 'really', 'very', c => /^[a-z]/.test(c.n) && !/^(much|many|few|little|same|first|last|best|least|most|end|beginning|start|top|bottom|idea|thing|moment|day|person|man|woman|reason|word|words|nature|heart|core|essence|own|well|and|or)$/.test(c.n) && !DET.test(c.p) && c.p !== 'not', 'cr'],
    ['w', 'really', 'extremely', c => /^[a-z]/.test(c.n), 'cr'],
    ['w', 'big', 'large', c => /^[a-z]/.test(c.n) && !/^(data|bang|picture|deal|brother|sister|tech|five|ten|apple|city|cat|game|screen|toe|top|shot|wig|business|pharma|name|names|day|break|moment|time|and|or|language|intestine|print|scale|cap|caps|hadron|number|numbers)$/.test(c.n), 'c'],
    ['n', 'kid', 'child', c => !/^(gloves?|leather|brother|brothers|sister|sisters|stuff)$/.test(c.n), 'c']
  ];
  /* sentence openers: [everyday, formal, test of the next word, direction] */
  const STARTS = [
    ['So', 'Therefore,', c => !/^(far|many|much|long|few|little|that|too|as|is|was|are|were|do|does|did|what|why|how|i)$/.test(c.n), 'b'],
    ['But', 'However,', c => !/^(also|for|then|not|only|why|what|how|i)$/.test(c.n), 'b'],
    ['Also,', 'In addition,', () => true, 'b'],
    ['Also,', 'Furthermore,', () => true, 'd'],
    ['Also,', 'Moreover,', () => true, 'd'],
    ['Also,', 'Additionally,', () => true, 'd'],
    ['So', 'Thus,', () => true, 'd'],
    ['So', 'Hence,', () => true, 'd'],
    ['So', 'Consequently,', () => true, 'd'],
    ['Still,', 'Nevertheless,', () => true, 'b'],
    ['Still,', 'Nonetheless,', () => true, 'd'],
    ['In the end,', 'Ultimately,', () => true, 'b'],
    ['Basically,', 'Essentially,', () => true, 'c'],
    ['Luckily,', 'Fortunately,', () => true, 'c'],
    ['Later,', 'Subsequently,', () => true, 'd'],
    ['Besides,', 'Moreover,', () => true, 'u'],
    ['Plus,', 'Moreover,', () => true, 'c'],
    ['Anyway,', 'In any case,', () => true, 'c']
  ];
  const REGWHY = { up: 'A more formal word with the same meaning.', down: 'A plainer, more everyday word with the same meaning.', link: 'A linking word in the register of the passage.', intens: 'An intensifier in the register of the passage.' };
  /* every spelling of a pair: [from, to] for each form */
  function pairForms(kind, from, to) {
    if (kind === 'v') {
      const fw = from.split(' '), tw = to.split(' '), F = verbForms(fw[0]), T = verbForms(tw[0]), out = [];
      const seen = {};
      for (const k of Object.keys(F)) {
        if (seen[F[k]]) continue;
        seen[F[k]] = 1;
        const same = Object.keys(F).filter(j => F[j] === F[k]);
        /* a spelling two forms share ("put", "set", "hit") whose partner's
           forms differ: the form is read where it stands */
        const one = same.every(j => T[j] === T[k]);
        out.push([[F[k]].concat(fw.slice(1)).join(' '), one ? [T[k]].concat(tw.slice(1)).join(' ') : null, one ? null : { base: fw[0], T: T, rest: tw.slice(1) }]);
      }
      return out;
    }
    if (kind === 'n') return [[from, to], [PLURAL[from] || regular(from, 's'), PLURAL[to] || regular(to, 's')]];
    return [[from, to]];
  }
  const PLURAL = { child: 'children', person: 'people', man: 'men', woman: 'women' };
  /* "u" towards the formal only, "d" towards the everyday only, "c" the
     casual style's words, "cr" casual only and one way */
  function usable(dir, flag, casual) {
    if (flag === 'b') return true;
    if (flag === 'u') return dir === 'up';
    if (flag === 'd') return dir === 'down';
    if (flag === 'c') return casual ? dir === 'down' : dir === 'up';
    if (flag === 'cr') return casual && dir === 'down';
    return false;
  }
  const BEW = /^(is|are|was|were|be|been|being|am|get|gets|got)$/;
  const DETW = /^(the|a|an|this|that|these|those|its|their|his|her|our|my|your|some|any|no|each|every)$/;
  function pairs(text, dir, casual, log) {
    const X = LEX();
    let t = text;
    for (const [kind, cas, frm, ok, flag] of PAIRS) {
      if (!usable(dir, flag, casual)) continue;
      const from = dir === 'up' ? cas : frm, to = dir === 'up' ? frm : cas;
      for (const [f, rep1, amb] of pairForms(kind, from, to)) {
        const re = new RegExp('\\b' + ESC(f).replace(/ /g, '\\s+') + '\\b', 'gi');
        const prot = protect(t);
        let m, out = '', last = 0;
        while ((m = re.exec(t))) {
          const a = m.index, b = a + m[0].length;
          if (prot(a, b) || fresh(t, a)) continue;
          /* a capital mid-sentence is a name or a title ("Children's Crusade") */
          if (/[A-Z]/.test(m[0]) && !/(^|[.!?:]["”’)]?[\s\uE000\uE001]+|\n[\s\uE000\uE001]*)$/.test(t.slice(0, a)) && t.slice(0, a).trim() !== '') continue;
          const c = around(t, a, b);
          c.dir = dir;
          if (!ok(c)) continue;
          if (kind === 'v') {
            /* a verb here, not a noun: "the end", "a check", "the help" */
            if (DETW.test(c.p)) continue;
            /* not a passive ("was put off by") turned into an everyday verb */
            if (dir === 'down' && (BEW.test(c.p) || (/^(also|not|never|already|often|then|first|recently|later|soon|still|always|widely|commonly|usually|generally|frequently|successfully|repeatedly)$/.test(c.p) && BEW.test(around(t, a - c.p.length - 1, a - c.p.length - 1).p)))) continue;
            if (X && X.ready && !/ /.test(f)) {
              const pp = around(t, a - c.p.length - 1, a - c.p.length - 1).p;
              const an = X.analyse(f.toLowerCase(), c.p, pp, c.n, t);
              if (an && an.pos !== 'v') continue;
            }
          }
          let rep = rep1;
          if (amb) { const k = formOf(amb.base, m[0].split(/\s+/)[0], t.slice(0, a), t); rep = [amb.T[k]].concat(amb.rest).join(' '); }
          if (/^[A-Z]/.test(m[0])) rep = capFirst(rep);
          const why = /^(very|really|extremely|highly)$/.test(f.toLowerCase()) ? REGWHY.intens : REGWHY[dir];
          log.push({ from: m[0], to: rep, why: why });
          out += t.slice(last, a) + OPEN + rep + SHUT; last = b;
        }
        if (last) t = out + t.slice(last);
      }
    }
    /* sentence openers */
    for (const [cas, frm, ok, flag] of STARTS) {
      if (!usable(dir, flag, casual)) continue;
      const from = dir === 'up' ? cas : frm, to = dir === 'up' ? frm : cas;
      const core = ESC(from.replace(/,$/, ''));
      const re = new RegExp('(^|[.!?]["”’)]?\\s+|\\n\\s*)' + core + (from.endsWith(',') ? ',\\s*' : ',?\\s+'), 'g');
      t = t.replace(re, function (m, pre, off, str) {
        const at = off + pre.length;
        if (fresh(str, at) || str.charCodeAt(at) === 0xE000) return m;
        const n = around(str, at, off + m.length - 1).n;
        if (!ok({ n: n })) return m;
        log.push({ from: m.slice(pre.length).trim(), to: to, why: REGWHY.link });
        return pre + OPEN + to + SHUT + ' ';
      });
    }
    return t;
  }

  /* ---- 4. contractions, for the casual register ---- */
  const WHB = /\b(?:who|what|where|how|whatever|whoever|wherever)\s+$/i;
  const CONTRACT = [
    [/\b(it|that|there|what|here|who|he|she) is (?=[a-z])/gi, (m, p) => p + "'s ", n => !/^to\b/.test(n)],
    [/\bI am (?=[a-z])/g, () => "I'm "],
    [/\b(you|we|they) are (?=[a-z])/gi, (m, p) => p + "'re "],
    [/\b(I|you|we|they) have (?=(?:been|got|had|done|seen|made|taken|given|gone|known|found|heard|never|always|just|already|[a-z]{3,}ed)\b)/gi, (m, p) => p + "'ve "],
    [/\b(I|you|we|they|he|she|it) will (?=[a-z])/gi, (m, p) => p + "'ll "],
    [/\b(has|have|had|was|were|would|could|should) not\b/gi, (m, v) => v + "n't"],
    [/\b(L|l)et us (?=(?:consider|look|begin|start|turn|now|see|assume|suppose|take|go|try|move|think)\b)/g, (m, l) => l + "et's "]
  ];
  function contract(text, log) {
    let t = text;
    for (const [re, rep, ok] of CONTRACT) {
      const prot = protect(t);
      t = t.replace(re, function () {
        const a = arguments, m = a[0], off = a[a.length - 2], str = a[a.length - 1];
        if (prot(off, off + m.length) || fresh(str, off)) return m;
        if (WHB.test(str.slice(Math.max(0, off - 20), off))) return m;
        /* "what they make of it is theirs": "it" belongs to "of", not to "is" */
        if (/\b(?:of|to|for|with|from|about|in|on|at|by|into|than|make|makes|made|do|did|does)\s+$/i.test(str.slice(Math.max(0, off - 12), off)) && /^it /i.test(m)) return m;
        if (ok && !ok(str.slice(off + m.length, off + m.length + 12))) return m;
        const r = rep.apply(null, a), core = r.replace(/ $/, '');
        log.push({ from: m.trim(), to: core, why: 'A contraction, as relaxed writing uses them.' });
        return OPEN + core + SHUT + (r.length > core.length ? ' ' : '');
      });
    }
    return t;
  }

  /* ---- 5. one change of order that keeps the meaning ---- */
  /* the second half of ", but" must be a clause with its own subject:
     "but it was never produced", never "but chose to attend" */
  /* and a verb of its own: "not a corrupt, but an essential part" has none */
  const FINITE2 = /\b(is|are|was|were|be|been|has|have|had|will|would|can|could|should|may|might|must|do|does|did|[a-z]{3,}ed|[a-z]{3,}s)\b/;
  const SUBJ2 = /^(?:(?:then|now|eventually|later|still|instead|soon)\s+)?(?:I|you|he|she|it|we|they|this|that|these|those|there|the|a|an|his|her|its|their|our|my|your|both|all|some|many|most|no|each|every|one|[A-Z][a-z]+)\b/;
  /* the first word loses its capital only if it is an ordinary word */
  const COMMON1 = /^(The|A|An|This|That|These|Those|Some|Many|Most|All|Our|My|His|Her|Their|Its|Your|We|They|He|She|You|It|People|Children|Students|Each|Every|No|One|Both|Such|Several|Few|Other|Another|Any|Much|More|Less|Few|Everyone|Nobody|Someone|Television|Computers?|Science|Society|Women|Men)\b/;
  function lowerStart(x) {
    const w = (x.match(/^[A-Za-z]+/) || [''])[0], X = LEX();
    const common = COMMON1.test(x) || (X && X.ready && X._L.W.has(w.toLowerCase()));
    return common ? x[0].toLowerCase() + x.slice(1) : x;
  }
  function restructure(s, dir, log) {
    const t = s.trim();
    /* a quotation is never reordered, and a long sentence is left as it is */
    if (/["“”]/.test(t) || (t.match(/\S+/g) || []).length > 32) return t;
    if (dir === 'up') {
      /* "X because Y." -> "Because Y, X." */
      const m = /^([A-Z][^,;:.!?]{12,}?) because ([^,;:.!?]{10,})([.!?])$/.exec(t);
      /* "and" on either side could belong to the other half: left alone */
      if (m && !/\bbecause\b/i.test(m[1]) && !/^(I|It|There)\b/.test(m[1]) && (m[1].match(/\S+/g) || []).length <= 16 && !/\b(and|or|but|yet)\b/i.test(m[1] + ' ' + m[2])) {
        const out = 'Because ' + m[2] + ', ' + lowerStart(m[1]) + m[3];
        log.push({ from: t, to: out, why: 'The reason first, as formal writing often orders it.' }); return out;
      }
      const n = /^([^;]{12,}), but ([A-Za-z][^;]{8,})$/.exec(t);
      if (n && SUBJ2.test(n[2]) && FINITE2.test(n[2]) && !/, but /.test(n[2]) && !/\bnot (?:only|just|merely|simply)\b/i.test(n[1])) { const out = n[1] + '; however, ' + n[2]; log.push({ from: t, to: out, why: 'A formal link between the two halves: "; however,".' }); return out; }
      const so = /^([^;]{12,}), so ([A-Za-z][^;]{8,})$/.exec(t);
      if (so && SUBJ2.test(so[2]) && FINITE2.test(so[2]) && !/^(that|much|many|far)\b/.test(so[2])) { const out = so[1] + '; therefore, ' + so[2]; log.push({ from: t, to: out, why: 'A formal link between cause and result: "; therefore,".' }); return out; }
    } else if (dir === 'down') {
      const n = /^([^;]{8,}); however, ([^;]{6,})$/.exec(t);
      if (n) { const out = n[1] + ', but ' + n[2]; log.push({ from: t, to: out, why: 'A plainer link: ", but".' }); return out; }
      const th = /^([^;]{8,}); therefore, ([^;]{6,})$/.exec(t);
      if (th) { const out = th[1] + ', so ' + th[2]; log.push({ from: t, to: out, why: 'A plainer link: ", so".' }); return out; }
      const R = RW();
      if (R && R.explain) { const r = R.explain('active', t); if (r.text !== t) { r.changes.forEach(c => log.push({ from: c.from, to: c.to, why: R.WHYS.active })); return r.text; } }
    }
    return t;
  }

  /* ---- the styles ---- */
  const STYLE = {
    scholarly: { dir: 'up', idiom: 'formal', rw: 'scholarly', label: 'Scholarly', order: 'up' },
    professional: { dir: 'up', idiom: 'formal', rw: 'professional', label: 'Professional', order: '' },
    casual: { dir: 'down', idiom: 'casual', rw: 'casual', label: 'Casual', casual: true, contract: true, order: 'down' },
    plain: { dir: 'down', idiom: 'plain', rw: 'simplify', label: 'Plainer', order: 'down' },
    concise: { dir: '', idiom: 'plain', rw: 'concise', label: 'Concise', order: '' },
    confident: { dir: '', idiom: '', rw: 'confident', label: 'Confident', order: '' }
  };
  const STYLE_WHY = {
    scholarly: 'Formal words, ideas linked explicitly, no contractions or idioms.',
    professional: 'Clear and polished: formal words, no slang or contractions.',
    casual: 'Everyday words, contractions and a relaxed voice.',
    plain: 'Plainer words and shorter sentences, for any reader.',
    concise: 'The same meaning in fewer words.',
    confident: 'Softening words taken out where the claim can stand.'
  };
  function withRules(text, mode, log) {
    const R = RW();
    if (!R || !R[mode]) return text;
    const r = R.explain(mode, text);
    r.changes.forEach(c => log.push({ from: c.from, to: c.to, why: (R.WHYS && R.WHYS[c.why]) || c.why }));
    return r.text;
  }
  /* 7.43: a line with no end mark (a heading, "Introduction") is a part of
     its own; before, it matched nothing and was dropped from the reordered
     version. Whatever the parts, together they are the whole text, or the
     text is taken as one part. */
  function sentences(text) {
    const t = String(text), m = t.match(/[^.!?\n]+(?:[.!?]+["”’)]*\s*|(?=\n)|$)|\n+/g);
    return m && m.join('') === t ? m : [t];
  }
  function perSentence(text, fn) {
    return sentences(text).map(s => { const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0], core = s.slice(lead.length, s.length - tail.length); return core ? lead + fn(core) + tail : s; }).join('');
  }
  /* one option. Depth 1: the style's rules and its idioms; 2: also the word
     pairs, the openers and (casual) contractions; 3: also a change of order */
  function option(text, st, depth) {
    const log = [];
    let t = withRules(text, st.rw, log);
    if (st.idiom) t = idioms(t, st.idiom, log);
    if (depth >= 2 && st.dir) t = pairs(t, st.dir, !!st.casual, log);
    if (depth >= 2 && st.contract) t = contract(t, log);
    t = strip(t);
    if (depth >= 3 && st.order) t = perSentence(t, s => restructure(s, st.order, log));
    const R = RW();
    if (R && R.fixArticles) t = R.fixArticles(text, t);
    return { text: t, changes: log };
  }
  const DEPTH = [[1, 'light touch'], [2, 'fuller'], [3, 'reordered']];
  /* a style rewrite: up to three options, each different from the text and
     from one another, the lightest first */
  function restyle(text, style) {
    const st = STYLE[style] || STYLE.plain, out = [], seen = new Set([String(text).trim()]);
    for (const [d, label] of DEPTH) {
      const o = option(text, st, d);
      if (!o.text.trim() || seen.has(o.text.trim())) continue;
      seen.add(o.text.trim());
      out.push({ label: st.label + ' · ' + label, style: style, text: o.text, changes: o.changes, why: STYLE_WHY[style] || '' });
    }
    return out;
  }
  /* alternatives for a passage with no style chosen: the passage plainer,
     more formal, casual and reordered */
  function alternatives(text) {
    const out = [], seen = new Set([String(text).trim()]);
    const add = (label, why, o) => { const k = o.text.trim(); if (k && !seen.has(k)) { seen.add(k); out.push({ label: label, why: why, text: o.text, changes: o.changes }); } };
    add('Plainer', STYLE_WHY.plain, option(text, STYLE.plain, 2));
    add('More formal', STYLE_WHY.scholarly, option(text, STYLE.scholarly, 2));
    add('Casual', STYLE_WHY.casual, option(text, STYLE.casual, 2));
    const log = [];
    add('Reordered', 'The same words in another order.', { text: perSentence(text, s => restructure(s, 'up', log)), changes: log });
    return out;
  }

  /* ---- alternatives for a word or a phrase, by meaning ---- */
  /* Sources, in order: an idiom said three ways; the common alternatives
     (INKSYN, written for Inkwell); then WordNet's meanings (INKLEX), each
     with its definition, for the writer to choose the one meant. */
  const SYN = () => root.INKSYN || req('./synonyms_core.js');
  const POSNAME = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
  const matchCase = (src, out) => !out ? out : (src.length > 1 && src === src.toUpperCase() && /[A-Z]{2}/.test(src)) ? out.toUpperCase() : /^[A-Z]/.test(src) ? capFirst(out) : out;
  /* "bigger" gives "larger" but "more substantial": short words take -er */
  const ER = new Set('large great small big fast quick slow long short high low wide broad deep strong weak hard easy simple clear close near rich poor young old new safe cheap tall thin thick warm cool cold hot kind nice fine bright dark light late early busy happy sad calm firm wise rare pure true sure tough rough smooth soft loud quiet heavy lucky pretty funny angry dirty healthy friendly lively mild keen plain brief sharp slim tight full odd'.split(' '));
  function compare(w, form) {
    if (/ /.test(w) || !ER.has(w)) return (form === 'er' ? 'more ' : 'most ') + w;
    const suf = form;
    if (/e$/.test(w)) return w + suf.slice(1);
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'i' + suf;
    if (cvc(w) && !/[wxy]$/.test(w)) return w + w.slice(-1) + suf;
    return w + suf;
  }
  /* a word put into a form: "purchase" as "purchased"; null if it cannot be */
  function inflectAs(w, pos, form) {
    if (!form) return w;
    const parts = w.split(' ');
    if (pos === 'v') { const f = verbForms(parts[0])[form]; return f ? [f].concat(parts.slice(1)).join(' ') : null; }
    if (pos === 'a' && (form === 'er' || form === 'est')) return compare(w, form);
    if (pos === 'n' && form === 's') {
      const last = parts[parts.length - 1], X = LEX();
      const pl = PLURAL[last] || (X && X.ready ? X.inflect(last, 'n', 's') : regular(last, 's'));
      return pl ? parts.slice(0, -1).concat(pl).join(' ') : null;
    }
    return null;
  }
  /* the word's readings, from the lexicon or, without it, from its spelling */
  function readings(word, prev, prev2, next, ctx) {
    const X = LEX(), w = word.toLowerCase();
    if (X && X.ready) {
      const a = X.analyse(w, prev, prev2, next, ctx), all = X.bases(w);
      const out = a ? [{ base: a.base, pos: a.pos, form: a.form }] : [];
      all.forEach(b => { if (!out.some(o => o.base === b.base && o.pos === b.pos)) out.push(b); });
      return out;
    }
    const S = SYN(), out = [], add = (b, pos, form) => { if (S && S.has(b, pos) && !out.some(o => o.base === b && o.pos === pos)) out.push({ base: b, pos: pos, form: form }); };
    for (const pos of 'avnr') add(w, pos, '');
    const tries = [[/ies$/, 'y', 's'], [/(ch|sh|ss|x|z)es$/, '$1', 's'], [/([^s])s$/, '$1', 's'], [/ied$/, 'y', 'ed'], [/([^e])ed$/, '$1', 'ed'], [/ed$/, 'e', 'ed'], [/(.)\1ed$/, '$1', 'ed'], [/ing$/, '', 'ing'], [/ing$/, 'e', 'ing'], [/(.)\1ing$/, '$1', 'ing']];
    for (const [re, r, form] of tries) if (re.test(w)) { const b = w.replace(re, r); add(b, 'v', form); if (form === 's') add(b, 'n', 's'); }
    for (const [irr, list] of Object.entries(IRV)) { const p = list.split(' '); if (p[1] === w) add(irr, 'v', 'ed'); if (p[2] === w && p[2] !== p[1]) add(irr, 'v', 'en'); }
    return out;
  }
  /* idioms inside the selection: the whole selection said three ways */
  function idiomVersions(text) {
    if (!IDIOMS) compileIdioms();
    const out = [];
    for (const [style, label] of [['plain', 'Plainly'], ['formal', 'Formally'], ['casual', 'Casually']]) {
      const log = [], t = strip(idioms(text, style, log));
      if (log.length && t !== text && !out.some(o => o.text === t)) out.push({ label: label, text: t, changes: log });
    }
    return out;
  }
  function wordAlternatives(sel, ctx, at) {
    const src = String(sel || '').trim();
    if (!src) return [];
    const text = String(ctx || src), pos0 = typeof at === 'number' ? at : text.indexOf(src);
    const before = text.slice(0, Math.max(0, pos0)).match(/[A-Za-z'’]+/g) || [], after = text.slice(pos0 + src.length).match(/[A-Za-z'’]+/g) || [];
    const prev = before[before.length - 1], prev2 = before[before.length - 2], next = after[0];
    const groups = [], seen = new Set([src.toLowerCase()]);
    const push = (g) => {
      const words = g.words.filter(w => w && !seen.has(w.toLowerCase()));
      words.forEach(w => seen.add(w.toLowerCase()));
      if (words.length) groups.push(Object.assign({}, g, { words: words }));
    };
    const S = SYN(), X = LEX();
    /* a phrase the list knows ("train of thought", "a lot of") */
    if (/\s/.test(src) && S) {
      const low = src.toLowerCase().replace(/\s+/g, ' ');
      let ph = S.phrase(low), form = '';
      if (!ph) {
        /* a phrasal verb in a form: "found out", "carried out" */
        const ws = low.split(' ');
        for (const r of readings(ws[0], prev, prev2, ws[1], text)) if (r.pos === 'v') { const p = S.phrase([r.base].concat(ws.slice(1)).join(' ')); if (p && p.pos === 'v') { ph = p; form = r.form; break; } }
      }
      if (ph) for (const s of ph.senses) push({ source: 'common', gloss: s.gloss, pos: ph.pos, words: s.words.map(w => { const f = ph.pos === 'v' ? inflectAs(w, 'v', form) : w; return f ? matchCase(src, f) : null; }) });
    }
    if (!/\s/.test(src) && S) {
      const rs = readings(src, prev, prev2, next, text);
      rs.forEach((r, k) => {
        const ss = S.get(r.base, r.pos);
        if (!ss) return;
        ss.forEach(s => push({ source: 'common', gloss: s.gloss, pos: r.pos, other: k > 0 && r.pos !== rs[0].pos ? 'As ' + (/^[aeiou]/.test(POSNAME[r.pos]) ? 'an ' : 'a ') + POSNAME[r.pos] : '', words: s.words.map(w => { const f = inflectAs(w, r.pos, r.form); return f ? matchCase(src, f) : null; }) }));
      });
    }
    /* WordNet's meanings, after: each with its definition */
    if (X && X.ready) {
      X.alternatives(src, text, pos0).forEach(g => push({ source: 'wordnet', gloss: g.gloss, pos: g.pos, broader: g.broader, common: g.best, words: g.words.map(w => w.text) }));
    }
    return groups;
  }
  /* up to max words of a passage with one clear set of common alternatives
     (one meaning in the list for the word's part of speech here):
     [{text, at, pos, gloss, words}] */
  const SKIP = /^(a|an|the|and|or|but|if|of|in|on|at|to|for|with|by|from|as|is|are|was|were|be|been|being|am|it|its|this|that|these|those|he|she|they|we|you|i|his|her|their|our|my|your|me|him|them|us|not|no|so|do|does|did|done|have|has|had|will|would|can|could|should|may|might|must|there|here|what|which|who|whom|whose|when|where|why|how|all|any|some|more|most|other|such|only|own|same|than|too|just|into|over|under|about|after|before|again|also|then|now|one|two|three|first|last|each|every|both|either|neither|many|much|few|little|less|least|get|got|make|made|take|took|go|went|gone|come|came|say|said|let|put|set|thing|things|way|lot|kind|sort|yes|yet|still|even|ever|never|well|up|out|off|down|back|through|while|because|though|although|since|until|unless|whether)$/i;
  function wordChoices(text, max) {
    const X = LEX(), S = SYN();
    if (!X || !X.ready || !S) return [];
    const prot = protect(text), ws = [], re = /[A-Za-z][A-Za-z'’-]*/g;
    let m;
    while ((m = re.exec(text))) ws.push({ w: m[0], s: m.index, e: m.index + m[0].length });
    /* a word inside an idiom or a fixed phrase is never changed alone
       ("train of thought" keeps its "thought") */
    if (!IDIOMS) compileIdioms();
    const fixed = [];
    for (const id of IDIOMS) { id.re.lastIndex = 0; let q; while ((q = id.re.exec(text))) fixed.push([q.index, q.index + q[0].length]); }
    for (let i = 0; i < ws.length; i++) {
      for (let n = 4; n >= 2; n--) {
        if (i + n > ws.length) continue;
        const ph = text.slice(ws[i].s, ws[i + n - 1].e);
        if (/[.,;:!?]/.test(ph)) continue;
        const low = ph.toLowerCase().replace(/\s+/g, ' ');
        if (S.phrase(low) || X._L.W.has(low) || (n > 1 && X.bases(ws[i + n - 1].w.toLowerCase()).some(b => b.pos === 'n' && X._L.W.has(low.split(' ').slice(0, -1).concat(b.base).join(' '))))) { fixed.push([ws[i].s, ws[i + n - 1].e]); break; }
      }
    }
    const inFixed = (a, b) => fixed.some(f => a < f[1] && f[0] < b);
    const out = [];
    for (let i = 0; i < ws.length && out.length < (max || 6); i++) {
      const k = ws[i];
      if (prot(k.s, k.e) || inFixed(k.s, k.e) || k.w.length < 3 || SKIP.test(k.w)) continue;
      const startSent = i === 0 || /[.!?]["”’)]?\s*$/.test(text.slice(0, k.s));
      if (/^[A-Z]/.test(k.w) && !startSent) continue; /* a name */
      const a = X.analyse(k.w.toLowerCase(), ws[i - 1] && ws[i - 1].w, ws[i - 2] && ws[i - 2].w, ws[i + 1] && ws[i + 1].w, text);
      if (!a) continue;
      const ss = S.get(a.base, a.pos);
      if (!ss || ss.length !== 1) continue;
      const words = ss[0].words.map(w => inflectAs(w, a.pos, a.form)).filter(Boolean).slice(0, 4).map(w => matchCase(k.w, w));
      if (words.length) out.push({ text: k.w, at: k.s, pos: a.pos, gloss: ss[0].gloss, words: words });
    }
    return out;
  }

  const api = {
    restyle: restyle, alternatives: alternatives, wordChoices: wordChoices, wordAlternatives: wordAlternatives, idiomVersions: idiomVersions,
    idioms: (t, s) => { const l = []; return { text: strip(idioms(t, s || 'plain', l)), changes: l }; },
    verbForms: verbForms, STYLES: Object.keys(STYLE), STYLE_LABEL: Object.keys(STYLE).reduce((o, k) => (o[k] = STYLE[k].label, o), {}), STYLE_WHY: STYLE_WHY,
    IDIOM_COUNT: IDIOM_ROWS.length, PAIR_COUNT: PAIRS.length
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKPARA = api;
})(typeof self !== 'undefined' ? self : this);
