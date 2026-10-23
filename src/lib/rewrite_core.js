/* Inkwell's offline rewrites: Concise, Shorter, Professional, Scholarly,
   Casual and Confident, by rules, on this device; from 7.38 also Simplify,
   One idea per sentence (split), Active voice, Neutral and Hedged to the
   evidence, each change with the reason for it (explain). 7.37 rewrote them after a
   test found edits that changed the meaning or broke the grammar ("used to"
   became "employed to", "talks about" became "discusss", "a very
   interesting" became "a interesting", "In order to understand the data, it
   is important to note that the evidence is strong" became "To understand the
   data, the evidence is strong"). The rule now: an edit is made only where it
   keeps the meaning and the grammar; where a word could be read two ways, the
   text is left as it is. Quoted words are never touched. Each function takes
   and returns plain text. tools/rewrite/cases.json holds the tests. */
(function (root) {
  /* ---- helpers ---- */
  const DET = '(?:the|a|an|this|that|these|those|its|their|our|my|your|his|her|each|every|any|no|some)';
  const VOWEL_SOUND = /^(?:[aeio]|u(?!ni|se|su|ra|ro|ti|ku|bi)|hour|honest|honou?r|heir|8|11|18)/i;
  /* 7.38: every change can be explained. While LOG is a list, each rule that
     changes the text records what it changed and the kind of change (WHY),
     so the writer is taught what was removed and why, not only shown it. */
  let LOG = null, WHY = '';
  function note(from, to) { if (LOG && from !== to) LOG.push({ from: from, to: to, why: WHY }); }
  /* a rule with its own kind of change, where it differs from its list's */
  function tag(rule, why) { return [rule[0], rule[1], why]; }
  /* a match inside a title ("Wake Me When I'm Dead", "Talk About Town") or a
     name is left alone: the words around it are capitalised mid-sentence */
  function inTitle(str, off, len) {
    const before = str.slice(Math.max(0, off - 40), off), after = str.slice(off + len, off + len + 30);
    const pw = /([A-Za-z][\w'’]*)\W*$/.exec(before), nw = /^\W*([A-Za-z][\w'’]*)/.exec(after);
    const startHere = !before.trim() || /[.!?]["”’)]?\s*$/.test(before);
    if (startHere) return false;
    /* after a bracket, a dash or a colon a capital may start a clause */
    if (!/[A-Za-z0-9,]$/.test(before.replace(/\s+$/, ''))) return false;
    const capPrev = pw && /^[A-Z]/.test(pw[1]), capNext = nw && /^[A-Z]/.test(nw[1]);
    const capSelf = /^[A-Z]/.test(str.slice(off, off + 1)) && str.slice(off, off + 2) !== 'I\'' && str.slice(off, off + 2) !== 'I’';
    return capSelf || (capPrev && capNext);
  }
  /* "not after" without a lookbehind (Safari before 16.4 cannot parse one):
     the rule's replacement runs only where the text before the match does not
     end with one of the given words */
  function notAfter(re, words, rep) {
    const bad = new RegExp('\\b(?:' + words.join('|') + ')\\s+$', 'i');
    return [re, function () {
      const a = arguments, m = a[0], off = a[a.length - 2], str = a[a.length - 1];
      if (bad.test(str.slice(Math.max(0, off - 24), off))) return m;
      return typeof rep === 'function' ? rep.apply(null, a) : rep;
    }];
  }
  function apply(t, list, why) {
    const was = WHY;
    for (const [re, rep, own] of list) {
      WHY = own || why || was;
      t = t.replace(re, function () {
        const a = arguments, m = a[0], off = a[a.length - 2], str = a[a.length - 1];
        if (typeof off === 'number' && inTitle(str, off, m.length)) return m;
        let r;
        if (typeof rep === 'function') r = rep.apply(null, a);
        else {
          const groups = Array.prototype.slice.call(a, 1, a.length - 2);
          r = rep.replace(/\$(\d)/g, (x, n) => groups[+n - 1] == null ? '' : groups[+n - 1]);
        }
        note(m, r);
        return r;
      });
    }
    WHY = was;
    return t;
  }
  /* a replace that is recorded, for the rules written as plain replaces */
  function swap(t, re, r, why) {
    const was = WHY; WHY = why;
    t = t.replace(re, function () {
      const a = arguments, m = a[0];
      const out = typeof r === 'function' ? r.apply(null, a) : r.replace(/\$(\d)/g, (x, n) => a[+n] == null ? '' : a[+n]);
      note(m, out);
      return out;
    });
    WHY = was;
    return t;
  }
  /* keep the capital of a replaced phrase that began a sentence */
  function keepCase(rep) {
    return function (m) {
      const args = arguments; let r = typeof rep === 'function' ? rep.apply(null, args) : rep.replace(/\$(\d)/g, (x, n) => args[+n] || '');
      if (/^[A-Z]/.test(m) && r) r = r[0].toUpperCase() + r.slice(1);
      return r;
    };
  }
  function tidy(t) {
    return t.replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.;:!?])/g, '$1')
      .replace(/,(\s*,)+/g, ',')
      .replace(/,\s*([.;:!?])/g, '$1')
      .replace(/(^|[.!?]\s+|\n\s*)[,;]\s*/g, '$1')
      .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
      .replace(/^[ \t]+|[ \t]+$/gm, '');
  }
  /* a sentence that now begins in lower case after a removal */
  function capStarts(src, out) {
    /* only where the rewrite changed how the sentence begins, and never after
       an abbreviation: "e.g. the" stays as written */
    return out.replace(/(^|[.!?]["”’)]?\s+|\n\s*)([a-z])/g, (m, p, c, off) => {
      if (/\b(?:e\.g|i\.e|etc|cf|vs|al|pp?|Dr|Mr|Mrs|Ms|Prof|No|Vol|eds?|approx|fig|Fig|ch|sec)\.\s*$/.test(out.slice(Math.max(0, off - 8), off + p.length))) return m;
      const ctx = m + out.slice(off + m.length, off + m.length + 4);
      const kept = off === 0 && !p ? src.startsWith(ctx) : src.indexOf(ctx) >= 0;
      return kept ? m : p + c.toUpperCase();
    });
  }
  /* "a" or "an" before a word that changed: only pairs the writer did not write */
  function fixArticles(src, out) {
    const had = new Set((src.match(/\b(?:a|an)\s+[A-Za-z][\w-]*/gi) || []).map(x => x.toLowerCase()));
    return out.replace(/\b(a|an)(\s+)([A-Za-z][\w-]*)/gi, (m, art, sp, w) => {
      if (had.has(m.toLowerCase())) return m;
      if (/^(?:one|once|uni(?!n)|use|user|usual|euro|ewe)/i.test(w)) return (art[0] === 'A' ? 'A' : 'a') + sp + w;
      const want = VOWEL_SOUND.test(w) ? 'an' : 'a';
      return (art[0] === 'A' ? want[0].toUpperCase() + want.slice(1) : want) + sp + w;
    });
  }
  function finish(src, out) { return fixArticles(src, capStarts(src, tidy(out))); }
  /* a verb phrase in its four forms: base, -s, past, -ing */
  function forms(list) {
    const out = [];
    for (const [phr, rep] of list) for (let k = 0; k < 4; k++) if (phr[k] && rep[k] != null) out.push([new RegExp('\\b' + phr[k] + '\\b', 'gi'), keepCase(rep[k])]);
    return out;
  }
  const S0 = '(^|[.!?]["”’)]?\\s+|\\n\\s*|(?:However|Moreover|Furthermore|Indeed|Thus|Therefore|Yet|Still|Finally|First|Second|Third|In addition|Above all|Of course),\\s*)';
  function atStart(phrase, rep) {
    return [new RegExp(S0 + phrase, 'gi'), (m, pre) => pre + (rep || '')];
  }

  /* ---- wordiness: a longer phrase for a shorter one with the same meaning ---- */
  const WORDY = [
    [/\bin order to\b/gi, keepCase('to')],
    [/\b(?:due to|owing to|on account of|in view of|in light of|for the reason) the fact that\b/gi, keepCase('because')],
    [/\bfor the reason that\b/gi, keepCase('because')],
    [/\b(?:in spite of|despite|regardless of|notwithstanding) the fact that\b/gi, keepCase('although')],
    [/\bin the event that\b/gi, keepCase('if')],
    [/\buntil such time as\b/gi, keepCase('until')],
    [/\bat (?:this|the present) (?:point|moment) in time\b/gi, keepCase('now')],
    [/\bat the present time\b/gi, keepCase('now')],
    [/\bin the near future\b/gi, keepCase('soon')],
    [/\ba large number of\b/gi, keepCase('many')],
    [/\ba great deal of\b/gi, keepCase('much')],
    [/\bthe (?:vast )?majority of (the|these|those|our|their|its|his|her|my|your|[A-Z]\w*|\w+['’]s?)(?=\s)/g, (m, w) => keepCase('most of ' + w)(m)],
    [/\bThe (?:vast )?majority of (the|these|those|our|their|its|his|her|my|your|[A-Z]\w*|\w+['’]s?)(?=\s)/g, (m, w) => 'Most of ' + w],
    [/\bthe (?:vast )?majority of\b/gi, keepCase('most')],
    [/\bwith regard to\b/gi, keepCase('about')],
    [/\bfor the purpose of\b/gi, keepCase('for')],
    [/\b(am|is|are|was|were|be|been) in the process of\b/gi, '$1'],
    [/\b(?:has|have) the ability to\b/gi, keepCase('can')],
    [/\bhad the ability to\b/gi, keepCase('could')],
    notAfter(/\b(?:is|are) able to\b/gi, ['will', 'would', 'to', 'not'], keepCase('can')),
    [/\bin a timely manner\b/gi, keepCase('promptly')],
    [/\ba number of (the|these|those|our|their|its|his|her|my|your)\b/gi, keepCase('several of $1')],
    notAfter(/\ba number of\b/gi, ['small', 'large', 'great', 'growing', 'total', 'the'], keepCase('several')),
    [/\bon a (?:regular|daily|weekly|monthly|yearly) basis\b/gi, m => keepCase({ regular: 'regularly', daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' }[m.split(' ')[2].toLowerCase()])(m)],
    [/\bin the vast majority of cases\b/gi, keepCase('usually')],
    [/\bin close proximity to\b/gi, keepCase('near')],
    [/\bin the absence of\b/gi, keepCase('without')],
    [/\bprior to\b/gi, keepCase('before')],
    [/\bsubsequent to\b/gi, keepCase('after')],
    [/\bwith the exception of\b/gi, keepCase('except')],
    [/\beach and every\b/gi, keepCase('every')],
    [/\bfirst and foremost\b/gi, keepCase('first')],
    [/\bfew and far between\b/gi, keepCase('rare')],
    [/\bnull and void\b/gi, keepCase('void')],
    [/\bvarious different\b/gi, keepCase('various')],
    [/\bend result\b/gi, keepCase('result')],
    [/\bfinal outcome\b/gi, keepCase('outcome')],
    [/\badvance planning\b/gi, keepCase('planning')],
    [/\bpast history\b/gi, keepCase('history')],
    [/\bfuture plans\b/gi, keepCase('plans')],
    [/\btrue facts\b/gi, keepCase('facts')],
    [/\bbasic fundamentals\b/gi, keepCase('fundamentals')],
    [/\babsolutely (essential|necessary|certain)\b/gi, '$1'],
    [/\bcompletely (eliminate[sd]?|eliminating|destroy(?:s|ed)?|finish(?:es|ed)?)\b/gi, '$1'],
    [/\b(revert(?:s|ed)?|return(?:s|ed)?) back\b/gi, '$1'],
    [/\b(join(?:s|ed)?|combine[sd]?|merge[sd]?|collaborate[sd]?) together\b/gi, '$1'],
    [/\b(repeat(?:s|ed)?) again\b/gi, '$1'],
    [/\bstill remains\b/gi, keepCase('remains')],
    [/\bin the final analysis\b/gi, keepCase('finally')],
    [/\bwhether or not\b/gi, keepCase('whether')],
    [/\bby means of\b/gi, keepCase('by')],
    /* a sentence that opens with a filler: only at the start of a sentence, so
       no introductory phrase is left hanging on the wrong subject */
    tag(atStart('(?:it is important to note that|it should be noted that|it is worth noting that|it is interesting to note that|it is a fact that|needless to say(?:,|\\s+that)?|it goes without saying that)\\s*'), 'filler')
  ].concat(forms([
    [['make a decision', 'makes a decision', 'made a decision', 'making a decision'], ['decide', 'decides', 'decided', 'deciding']],
    [['come to (?:a|the) conclusion', 'comes to (?:a|the) conclusion', 'came to (?:a|the) conclusion', 'coming to (?:a|the) conclusion'], ['conclude', 'concludes', 'concluded', 'concluding']],
    [['give consideration to', 'gives consideration to', 'gave consideration to', 'giving consideration to'], ['consider', 'considers', 'considered', 'considering']],
    [['take into consideration', 'takes into consideration', 'took into consideration', 'taking into consideration'], ['consider', 'considers', 'considered', 'considering']],
    [['conduct an investigation (?:into|of)', 'conducts an investigation (?:into|of)', 'conducted an investigation (?:into|of)', 'conducting an investigation (?:into|of)'], ['investigate', 'investigates', 'investigated', 'investigating']],
    [['conduct an analysis of', 'conducts an analysis of', 'conducted an analysis of', 'conducting an analysis of'], ['analyse', 'analyses', 'analysed', 'analysing']],
    [['provide assistance to', 'provides assistance to', 'provided assistance to', 'providing assistance to'], ['help', 'helps', 'helped', 'helping']],
    [['reach an agreement', 'reaches an agreement', 'reached an agreement', 'reaching an agreement'], ['agree', 'agrees', 'agreed', 'agreeing']],
    [['make an assumption that', 'makes an assumption that', 'made an assumption that', 'making an assumption that'], ['assume that', 'assumes that', 'assumed that', 'assuming that']]
  ])).concat([
    [/\b(is|are|was|were) in agreement with\b/gi, (m, v) => keepCase({ is: 'agrees with', are: 'agree with', was: 'agreed with', were: 'agreed with' }[v.toLowerCase()])(m)]
  ]);

  /* ---- intensifiers: removed only where nothing else depends on them ---- */
  function dropIntensifiers(t) {
    t = swap(t, /\b(very|really|extremely)(?:,?\s+\1\b)+/gi, '$1', 'intensifier');
    /* "the very end", "not really", "really?" keep their word */
    /* 7.43: never after "not": "not totally conclusive" is not "not
       conclusive", and "not very good" is not "not good"; and "very much",
       "very few", "very well" keep their word */
    t = apply(t, [notAfter(/\b(?:very|extremely|totally|basically|literally|actually) (?!(?:much|many|few|little|well|same|own)\b)(?=[A-Za-z])/gi, ['the', 'this', 'that', 'these', 'those', 'its', 'their', 'our', 'my', 'your', 'his', 'her', 'not', 'never', 'nor', "\\w+n['’]t"], '')], 'intensifier');
    t = apply(t, [notAfter(/\breally (?=[A-Za-z])/gi, ['not', 'never', "\\w+n['’]t"], '')], 'intensifier');
    return t;
  }
  /* ---- hedges: only words that soften and carry no fact ---- */
  function dropHedges(t) {
    const H = 'hedge';
    t = swap(t, /,\s*(?:I think|I believe|I feel|in my opinion|perhaps|arguably|it seems|more or less|to some extent)\s*,/gi, '', H);
    t = swap(t, /,\s*(?:I think|I believe|I feel) (?:that )?(?=[a-z])/g, ', ', H);
    t = apply(t, [
      atStart('(?:I think that|I think|I believe that|I believe|I feel that|I would say that|I would argue that|in my opinion,?|it seems that|it appears that|it could be argued that|perhaps|maybe|arguably|possibly)\\s+')
    ], H);
    t = swap(t, /\b(?:perhaps|arguably|presumably|somewhat) (?=[a-z])/g, '', H);
    t = swap(t, /\s*\b(?:more or less|to some extent)\b/gi, '', H);
    /* "sort of" and "kind of" only where they soften a verb or an adjective */
    t = swap(t, /\b(is|are|was|were|be|been|it's|I|we|you|they|he|she|feel|felt|seems|seemed|looks|looked) (?:sort|kind) of (?=[a-z])/gi, '$1 ', H);
    return t;
  }
  /* ---- contractions written out, for formal registers ---- */
  const CONTR = [
    [/\b(it|that|he|she|there|what|who)['’]s (been|got|had)\b/gi, (m, p, v) => p + ' has ' + v],
    [/\bdon['’]t\b/gi, keepCase('do not')], [/\bcan['’]t\b/gi, keepCase('cannot')], [/\bwon['’]t\b/gi, keepCase('will not')],
    [/\bdoesn['’]t\b/gi, keepCase('does not')], [/\bdidn['’]t\b/gi, keepCase('did not')], [/\bisn['’]t\b/gi, keepCase('is not')],
    [/\baren['’]t\b/gi, keepCase('are not')], [/\bwasn['’]t\b/gi, keepCase('was not')], [/\bweren['’]t\b/gi, keepCase('were not')],
    [/\bhaven['’]t\b/gi, keepCase('have not')], [/\bhasn['’]t\b/gi, keepCase('has not')], [/\bhadn['’]t\b/gi, keepCase('had not')],
    [/\bwouldn['’]t\b/gi, keepCase('would not')], [/\bcouldn['’]t\b/gi, keepCase('could not')], [/\bshouldn['’]t\b/gi, keepCase('should not')],
    [/\b(it|that|there|what|who)['’]s\b/gi, (m, p) => p + ' is'], [/\bI['’]m\b/g, 'I am'], [/\b(you|we|they)['’]re\b/gi, '$1 are'],
    [/\b(I|you|we|they)['’]ve\b/gi, '$1 have'], [/\b(I|you|we|they|he|she|it)['’]ll\b/gi, '$1 will'], [/\b(I|you|we|they|he|she)['’]d (?=(?:been|had|known|seen|done|gone|made|taken|written)\b)/gi, '$1 had '],
    [/\blet['’]s\b/gi, keepCase('let us')]
  ];
  /* ---- informal words, for formal registers; only safe readings ---- */
  /* 7.43: "a lot of" by the noun it counts, read past its adjectives: "a lot
     of different genres" is "many different genres", "a lot of time" is "a
     great deal of time"; before 7.43 only the next word was read, so "a lot
     of different music" became "much different music" and "a lot of the
     work" became "much the work". Where the noun is not certain, it stays. */
  const PLURAL_N = /^(?:[a-z]+[^s'’]s|[a-z]+ies|people|children|men|women|media|criteria|phenomena|feet|teeth|mice|police|cattle)$/i;
  const MASS_N = /^(?:data|time|money|information|work|traffic|energy|effort|experience|passion|tension|exercise|fun|research|evidence|pollution|noise|attention|damage|support|knowledge|interest|progress|pressure|stress|space|water|food|power|freedom|help|advice|luck|trouble|patience|courage|confidence|criticism|controversy|uncertainty|variation|growth|investment|literature|scholarship|potential|influence|importance|emphasis|care|heat|rain|snow|land|waste|fuel|electricity|equipment|furniture|homework|software|content|material|coverage|speculation|debate|discussion|thought|practice|training|evidence|light|violence|crime|poverty|wealth|change)$/i;
  const ADJ_N = /^(?:good|bad|new|old|other|different|high|low|big|small|great|beautiful|interesting|important|young|little|long|short|strong|weak|various|useful|serious|real|hard|free|cheap|expensive|nice|fresh|healthy|local|public|private|social|human|natural|modern|extra|further|personal|daily|[a-z]+(?:ful|ous|ive|al|ent|ant|ic|able|ible|ing|ed|ary|less|ish))$/i;
  function lotOf(m) {
    const a = arguments, off = a[a.length - 2], str = a[a.length - 1];
    const ws = str.slice(off + m.length).match(/^[A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*){0,3}/);
    if (!ws) return m;
    for (const w of ws[0].split(/\s+/).slice(0, 3)) {
      if (/-/.test(w) && !PLURAL_N.test(w.split('-').pop())) continue;
      if (PLURAL_N.test(w) && !ADJ_N.test(w)) return keepCase('many ')(m);
      if (MASS_N.test(w)) return keepCase('a great deal of ')(m);
      if (ADJ_N.test(w)) continue;
      return m;
    }
    return m;
  }
  /* "big" and "huge" by the noun: size for things you could measure, "a
     significant role" (in PRECISE) for rank; "a big fan" or "a big surprise"
     stays as it is, and "huge" otherwise reads "enormous" */
  const SIZE_N = '(?:and|or|enough|cit(?:y|ies)|towns?|villages?|houses?|homes?|buildings?|rooms?|groups?|famil(?:y|ies)|compan(?:y|ies)|firms?|corporations?|enterprises?|businesses|organi[sz]ations?|countr(?:y|ies)|nations?|squares?|motorways?|roads?|streets?|shopping|theat(?:er|re)s?|castles?|restaurants?|trees?|bags?|malls?|farms?|librar(?:y|ies)|supermarkets?|gardens?|windows?|cars?|box(?:es)?|vehicles?|factor(?:y|ies)|teams?|amounts?|quantit(?:y|ies)|numbers?|sums?|crowds?|part(?:y|ies)|events?|areas?|regions?|spaces?|fields?|parks?|schools?|universit(?:y|ies)|hospitals?|shops?|stores?|markets?|samples?|datasets?|populations?|audiences?|class(?:es)?|machines?|stones?|rocks?|lakes?|rivers?|forests?|animals?|dogs?|portions?|meals?|dinners?|budgets?|salar(?:y|ies)|loads?|suitcases?|shelves|furniture|facilities|plazas?|zoos?|lawns?|parking|fountains?|caves?|gyms?|percentages?|proportions?|scale|range|variety|majority|minority|share|margin|investments?|sizes?|volumes?)';
  const INFORMAL = [
    [/\bgonna\b/gi, keepCase('going to')], [/\bwanna\b/gi, keepCase('want to')], [/\bgotta\b/gi, keepCase('have to')], [/\bkinda\b/gi, keepCase('somewhat')],
    [/\b(?:a lot of|lots of) (?=[A-Za-z])/gi, lotOf],
    [/\bkids\b/gi, keepCase('children')],
    [new RegExp('\\bhuge(?=\\s+' + SIZE_N + '\\b)', 'gi'), keepCase('large')],
    [/\bhuge\b(?!\s+(?:role|part|impact|influence|effect|difference|factor|contribution|change|problem|issue|challenge|concern|question|step|improvement|mistake|threat|advantage)\b)/gi, keepCase('enormous')],
    [new RegExp('\\bbig(?=\\s+' + SIZE_N + '\\b)(?!\\s+(?:city|screen|business|names?)\\b)', 'gi'), keepCase('large')],
    [/\b(is|are|was|were|seems|seemed|be|been) (?:ok|okay)\b/gi, '$1 acceptable'],
    [/\bmaybe\b/gi, keepCase('perhaps')],
    /* 7.43: "really" before a word is speech, not formal writing */
    tag(notAfter(/\breally (?=[a-z])/gi, ['not', 'never', "\\w+n['’]t"], ''), 'intensifier'),
    [/(^|[.!?]\s+)Plus,\s*/g, '$1Moreover, '],
    [/\banyway\b/gi, keepCase('in any case')],
    [/\bpretty (?=(?:good|bad|much|clear|sure|easy|hard|simple|obvious|strong|weak|well|important|common|rare|close|quick|quickly|similar|small|large|high|low|interesting|difficult|useful|accurate|confident|certain|likely|unlikely|straightforward)\b)/gi, '']
  ];
  /* ---- a plainer word for a more exact one, in the scholarly register ---- */
  const ELEV = [
    [/\b(show|shows|showed)\b(?= (?:that|how|what|why|whether|the|a|an|this|these|those|its|their|his|her|our|no|little|some|signs|evidence|significant|clear|strong|\d))/gi, (m, w) => keepCase({ show: 'demonstrate', shows: 'demonstrates', showed: 'demonstrated' }[w.toLowerCase()])(m)],
    /* "shown to be", "shown that"; never "shown to children", which is displayed */
    [/\bshown(?= (?:that|to (?:be|have|work|cause|reduce|increase|improve|affect|lower|raise|play|contribute|correlate|predict|occur|exist|vary|decline|enhance|inhibit|protect|prevent|promote)\b|by (?:the|this|these|our|their|its) (?:data|results|analysis|analyses|study|studies|evidence|experiment|experiments|survey|model|models|findings)\b|above|below|in (?:Table|Figure|Fig)))/gi, keepCase('demonstrated')],
    [/\b(prove|proves|proved|proven|proving)\b(?! to be)/gi, (m, w) => keepCase({ prove: 'establish', proves: 'establishes', proved: 'established', proven: 'established', proving: 'establishing' }[w.toLowerCase()])(m)],
    [/\bfind out\b/gi, keepCase('determine')], [/\bfinds out\b/gi, keepCase('determines')], [/\bfound out\b/gi, keepCase('determined')], [/\bfinding out\b/gi, keepCase('determining')],
    [/\blook at\b/gi, keepCase('examine')], [/\blooks at\b/gi, keepCase('examines')], [/\blooked at\b/gi, keepCase('examined')], [/\blooking at\b/gi, keepCase('examining')],
    [/\btalk about\b/gi, keepCase('discuss')], [/\btalks about\b/gi, keepCase('discusses')], [/\btalked about\b/gi, keepCase('discussed')], [/\btalking about\b/gi, keepCase('discussing')],
    [/\bdeal with\b/gi, keepCase('address')], [/\bdeals with\b/gi, keepCase('addresses')], [/\bdealt with\b/gi, keepCase('addressed')], [/\bdealing with\b/gi, keepCase('addressing')],
    [/\bpoint out\b/gi, keepCase('note')], [/\bpoints out\b/gi, keepCase('notes')], [/\bpointed out\b/gi, keepCase('noted')], [/\bpointing out\b/gi, keepCase('noting')],
    [/\bmake sure\b/gi, keepCase('ensure')], [/\bmakes sure\b/gi, keepCase('ensures')], [/\bmade sure\b/gi, keepCase('ensured')], [/\bmaking sure\b/gi, keepCase('ensuring')],
    [/\bget rid of\b/gi, keepCase('eliminate')], [/\bgot rid of\b/gi, keepCase('eliminated')],
    [/\b(go|goes|went|gone|going) up\b(?! (?:to|the|a|stairs))/gi, (m, w) => keepCase({ go: 'increase', goes: 'increases', went: 'increased', gone: 'increased', going: 'increasing' }[w.toLowerCase()])(m)],
    [/\b(go|goes|went|gone|going) down\b(?! (?:to|the|a|stairs))/gi, (m, w) => keepCase({ go: 'decrease', goes: 'decreases', went: 'decreased', gone: 'decreased', going: 'decreasing' }[w.toLowerCase()])(m)],
    [/\bmany times\b(?! (?:\w+er|more|less|as|over|the|a)\b)/gi, keepCase('frequently')],
    [/\bfor sure\b/gi, keepCase('certainly')],
    [/\ba bit\b(?! of)/gi, keepCase('slightly')],
    [/\b(he|she|it|who|which|that|this|one|each) tries to\b/gi, '$1 seeks to'], [/\b(I|we|you|they|he|she|it|who|which|that) tried to\b/gi, '$1 sought to'],
    [/\bthink about\b/gi, keepCase('consider')], [/\bthinks about\b/gi, keepCase('considers')], [/\bthought about\b/gi, keepCase('considered')],
    [/\b(get|gets|got|getting) (better|worse)\b/gi, (m, g, bw) => keepCase((bw.toLowerCase() === 'better' ? { get: 'improve', gets: 'improves', got: 'improved', getting: 'improving' } : { get: 'deteriorate', gets: 'deteriorates', got: 'deteriorated', getting: 'deteriorating' })[g.toLowerCase()])(m)],
    [/\b(made|is made|are made|was made|were made) up of\b/gi, (m, w) => keepCase(w.replace(/made$/i, 'composed') + ' of')(m)],
    [/\b(make|makes|made|making) up\b(?! (?:of|for|your|my|our|their|his|her|its|the difference|a story|stories|an excuse|excuses))/gi, (m, w) => keepCase({ make: 'constitute', makes: 'constitutes', made: 'constituted', making: 'constituting' }[w.toLowerCase()])(m)],
    [/\b(lead|leads|led|leading) to\b/gi, (m, w) => keepCase({ lead: 'result in', leads: 'results in', led: 'resulted in', leading: 'resulting in' }[w.toLowerCase()])(m)],
    [/\bmy paper\b/gi, keepCase('this paper')],
    [/\b(carry|carries|carried|carrying) out\b/gi, (m, w) => keepCase({ carry: 'conduct', carries: 'conducts', carried: 'conducted', carrying: 'conducting' }[w.toLowerCase()])(m)],
    [/\b(cut|cuts|cutting) down\b(?! on)/gi, (m, w) => keepCase({ cut: 'reduce', cuts: 'reduces', cutting: 'reducing' }[w.toLowerCase()])(m)],
    [/\b(point|points|pointed|pointing) to\b/gi, (m, w) => keepCase({ point: 'indicate', points: 'indicates', pointed: 'indicated', pointing: 'indicating' }[w.toLowerCase()])(m)],
    [/\b(make|makes|made|making) clear\b/gi, (m, w) => keepCase({ make: 'clarify', makes: 'clarifies', made: 'clarified', making: 'clarifying' }[w.toLowerCase()])(m)],
    [/\b(speed|speeds|sped|speeding) up\b/gi, (m, w) => keepCase({ speed: 'accelerate', speeds: 'accelerates', sped: 'accelerated', speeding: 'accelerating' }[w.toLowerCase()])(m)],
    [/\b(rule|rules|ruled|ruling) out\b/gi, (m, w) => keepCase({ rule: 'exclude', rules: 'excludes', ruled: 'excluded', ruling: 'excluding' }[w.toLowerCase()])(m)],
    [/\b(keep|keeps|kept|keeping) on\b(?= \w+ing\b)/gi, (m, w) => keepCase({ keep: 'continue', keeps: 'continues', kept: 'continued', keeping: 'continuing' }[w.toLowerCase()])(m)]
  ];
  /* ---- 7.43: sentences recast, not only words swapped ----
     A test of 7.42 found that the styles changed single words ("carried
     out" to "conducted") and left the weak sentences as they were: "It is
     very clear that this is a really important issue, and it is something
     that needs to be looked at in a lot more detail." These rules take out
     what only announces a point, put the subject first, and turn a verb
     hidden in a noun back into a verb; each only where the grammar of what
     is left is certain. */
  const DEG = '(?:(?:very|quite|really|abundantly|extremely|perfectly|fairly|so|also)\\s+)?';
  /* a verb that can follow "who" or "that" at once: then "that" begins a
     clause about the noun ("a theory that explains"), never "a theory that
     students like" */
  const VERBY = '(?:is|are|was|were|has|have|had|can|could|will|would|may|might|must|should|do|does|did|cannot|[a-z]{3,}ed|believes?|thinks?|argues?|suggests?|shows?|claims?|uses?|needs?|struggles?|lives?|works?|wants?|feels?|seems?|remains?|exists?|appears?|tends?|prefers?|supports?|opposes?|affects?|influences?|helps?|makes?|takes?|says?|knows?|sees?|finds?|tries|try|explains?|describes?|requires?|depends?|reflects?|holds?|insists?|maintains?|contends?|agrees?|disagrees?|rejects?|accepts?|lacks?|faces?|experiences?|reports?|attends?)\\b';
  const BE_TO = { am: 0, is: 1, are: 0, was: 2, were: 2, be: 0, been: 2 };
  /* "is dependent on" becomes "depends on": the verb in the form that "is"
     stood for; never after "being", where the reading would change */
  function beVerb(adjPhrase, base, s3, past, after) {
    return [new RegExp('\\b(am|is|are|was|were|be|been) ' + adjPhrase + '\\b', 'gi'), function () {
      const a = arguments, m = a[0], v = a[1].toLowerCase(), off = a[a.length - 2], str = a[a.length - 1];
      if (/\bbeing\s+$/i.test(str.slice(Math.max(0, off - 8), off))) return m;
      const f = BE_TO[v], verb = f === 1 ? s3 : f === 2 ? past : base;
      /* "has been dependent on" becomes "has depended on"; "will be" stays a base */
      return keepCase(verb + (after ? ' ' + after : ''))(m);
    }];
  }
  /* 7.50: the base of a verb that stands in its -s form ("changes" to
     "change"), from the lexicon when it is loaded, else by the regular
     spellings; null where it is not certain */
  const VB_IRR = { is: 'be', has: 'have', does: 'do', goes: 'go', focuses: 'focus', buses: 'bus', gases: 'gas', biases: 'bias', analyses: 'analyse', uses: 'use', causes: 'cause', raises: 'raise', closes: 'close', loses: 'lose', chooses: 'choose', poses: 'pose', pauses: 'pause', arises: 'arise', rises: 'rise', increases: 'increase', decreases: 'decrease', releases: 'release', promises: 'promise', praises: 'praise', houses: 'house', pleases: 'please' };
  const VB_NOT = /^(?:are|were|was|this|thus|yes|us|its|his|hers|ours|yours|theirs|always|perhaps|sometimes|towards|across|unless|whereas|as|less|plus|minus|various|serious|previous|obvious|famous|numerous|enormous|dangerous|nervous|anxious|curious|jealous|delicious|precious|conscious|religious|ambitious|tremendous|ridiculous|mysterious|is|news|means|species|series|analysis|basis|crisis|thesis|emphasis|hypothesis|physics|politics|economics|mathematics|statistics|ethics|genetics|linguistics|phonetics|dynamics|electronics|athletics|gymnastics|process|progress|success|access|business|witness|stress|loss|glass|class|grass|mass|chess|bus|gas|plus)$/;
  function verbBase(w) {
    const lw = String(w || '').toLowerCase(), X = root.INKLEX;
    if (X && X.ready) {
      try {
        const b = X.bases(lw);
        const s3 = b.find(o => o.pos === 'v' && o.form === 's'); if (s3) return s3.base;
        if (b.some(o => o.pos === 'v' && o.form === '') && !b.some(o => o.pos === 'n' && o.form === '') && !/s$/.test(lw)) return lw;
        return null;
      } catch (e) {}
    }
    if (VB_IRR[lw]) return VB_IRR[lw];
    if (VB_NOT.test(lw) || !/s$/.test(lw) || lw.length < 4) return null;
    if (/ies$/.test(lw)) return lw.slice(0, -3) + 'y';
    if (/(ss|sh|ch|x|z)es$/.test(lw)) return lw.slice(0, -2);
    if (/[^s]s$/.test(lw)) return lw.slice(0, -1);
    return null;
  }
  const cap1 = t => t ? t[0].toUpperCase() + t.slice(1) : t;
  const SUBJ_STOP = /^(?:the|a|an|this|these|those|such|most|many|some|all|every|each|no|our|their|its|his|her|my|your|of|in|on|at|to|for|with|by|from|and|or|but|not|that|which|who|as|than)$/i;
  /* 7.50: "It is well known that big data changes everything" becomes "Big
     data is widely held to change everything": the claim's subject first,
     and the knowing named as a holding, which can be cited. Only where the
     verb's base form is certain and the subject is a noun phrase of four
     words or fewer. */
  function heldTo(m, pre, rest) {
    const words = rest.split(/\s+/);
    for (let k = 1; k <= 4 && k < words.length - 1; k++) {
      const verb = words[k], base = verbBase(verb);
      if (!base || SUBJ_STOP.test(words[k - 1])) continue;
      const plural = base === verb.toLowerCase() && !/s$/.test(verb.toLowerCase());
      if (!plural && !/s$/.test(verb.toLowerCase())) continue;
      const subj = words.slice(0, k).join(' '), tail = words.slice(k + 1).join(' ');
      return pre + cap1(subj) + (plural ? ' are widely held to ' : ' is widely held to ') + base + (tail ? ' ' + tail : '');
    }
    return m;
  }
  const NOUN_STUFF = /^(?:data|research|work|study|science|tech|technology|business|policy|media|marketing|software|hardware|finance|health|legal|academic|computer|internet|online|digital|ai|statistics|maths|math|physics|chemistry|biology|history|politics|economics|management|school|university|college|office|home|house|kitchen|garden|car|camera|phone|music|art|design|writing|reading|teaching|learning|training|coding|programming|admin|tax|insurance|banking|medical|hospital|church|government|military|army|police|court|law|theory|lab|laboratory|project|thesis|exam|course|class|lecture|seminar|grammar|language|library|archive|museum|theatre|theater|film|video|audio|radio|news|sport|sports|football|fitness|food|cooking|baking|travel|holiday|wedding|baby|family|farm|factory|shop|market|trade|sales|customer|client|user|player|team|committee|board|council|network|security|privacy|safety|climate|energy|water|housing|transport|traffic|rail|road|building|construction|planning|budget|funding|grant)$/i;
  function nounStuff(m, w) {
    let noun = NOUN_STUFF.test(w);
    if (!noun) { try { const X = root.INKLEX; if (X && X.ready) { const b = X.bases(w.toLowerCase()); noun = b.some(o => o.pos === 'n') && !b.some(o => o.pos === 'a' && o.form === ''); } } catch (e) {} }
    return noun ? w : m;
  }
  const RECAST = [
    tag([new RegExp(S0 + 'it is (?:well|widely|commonly|generally) (?:known|accepted|recognised|recognized|understood|agreed|believed) that ([^.!?;:]+)', 'gi'), heldTo], 'opener'),
    /* "big data stuff" is "big data": the noun says it */
    tag([/\b([A-Za-z][\w-]{2,}) stuff\b(?!\s*(?:like|such as))/g, nounStuff], 'wordy'),
    /* "It is very clear that this is ..." becomes "This is ..." */
    tag(atStart('it (?:is|seems|appears|becomes) ' + DEG + '(?:clear|obvious|evident|apparent|plain) that\\s+'), 'opener'),
    tag(atStart('it (?:is|should be) (?:also |particularly |especially |very )?(?:important|essential|crucial|vital|interesting|useful|significant) to (?:note|remember|recognise|recognize|stress|emphasise|emphasize|point out|mention|observe|highlight|bear in mind) that\\s+'), 'filler'),
    tag(atStart('it (?:is|should be) (?:also )?worth (?:noting|mentioning|remembering|pointing out|stressing|emphasising|emphasizing|highlighting) that\\s+'), 'filler'),
    tag(atStart('it (?:should|must) (?:also )?be (?:noted|stressed|emphasised|emphasized|remembered|mentioned|pointed out|borne in mind) that\\s+'), 'filler'),
    /* "There are many students who struggle" becomes "Many students struggle" */
    tag([new RegExp(S0 + 'there (?:is|are|was|were) ((?:(?:many|several|some|few|numerous|various|certain|other|no|two|three|four|five|six|ten|countless|a few|a lot of|a number of)\\b(?:\\s+(?!(?:who|whom|whose|that|which)\\b)[a-z][a-z-]*){0,3})|others|no one|nobody|someone|somebody) (?:who|that|which) (?=' + VERBY + ')', 'gi'),
      /* "There are some who are, but others who are not": the second half
         needs the first as it was */
      function (m, pre, np) { const a = arguments, str = a[a.length - 1], off = a[a.length - 2];
        return /\b(?:but|and|while|whereas|yet) (?:others|some|many|those|the rest)\b/i.test(str.slice(off + m.length)) ? m : pre + np + ' '; }], 'expletive'),
    /* "it is something that needs" becomes "it needs" */
    tag([/\b(it|this|that|which) (?:is|was) (?:also )?something (?:that|which) (?=(?:needs|requires|deserves|merits|has|had|needed|required|deserved|merited|demands|demanded|calls|called|should|must|can|could|will|would|may|might)\b)/gi, '$1 '], 'something'),
    /* "needs to be looked at in a lot more detail" becomes "needs closer examination" */
    tag([/\b(needs?|needed|deserves?|deserved|merits?|merited) to be (looked at|examined|studied|explored|investigated|considered|analy[sz]ed|researched|scrutini[sz]ed) in (?:(?:a lot|much|far|considerably|a great deal) )?(?:more|greater|further|closer) detail\b/gi,
      (m, v, p) => v + ' closer ' + ({ 'looked at': 'examination', examined: 'examination', studied: 'study', explored: 'exploration', investigated: 'investigation', considered: 'consideration', analysed: 'analysis', analyzed: 'analysis', researched: 'research', scrutinised: 'scrutiny', scrutinized: 'scrutiny' }[p.toLowerCase()])], 'closer'),
    /* "into the ways in which platforms influence" becomes "into how platforms influence" */
    tag([/\b(into|on|of|about|at|examines?|examined|examining|explores?|explored|exploring|investigates?|investigated|investigating|considers?|considered|considering|understands?|understood|understanding|understand|shows?|showed|shown|showing|describes?|described|describing|analy[sz]es?|analy[sz]ed|analy[sz]ing|discuss(?:es|ed|ing)?|studies|study|studied|studying|explains?|explained|explaining|reveals?|revealed|revealing|illustrates?|illustrated|illustrating|highlights?|highlighted|highlighting|addresses|address|addressed|addressing|asks?|asked|asking) the (?:ways?|manner) in which\b/gi, '$1 how'], 'how'),
    /* "research that has been carried out into" becomes "research into" */
    tag([/\b(research|work|studies|study|analysis|analyses|experiments?|investigations?|surveys?|trials?|fieldwork|interviews) (?:that|which) (?:has|have|had) been (?:carried out|conducted|done|undertaken|performed|completed) (?=(?:into|on|in|of|by|with|among|amongst|across|at|over|since|during)\b)/gi, '$1 '], 'reduced'),
    /* "the data that were collected in 2019" becomes "the data collected in 2019" */
    tag([/\b([A-Za-z][\w-]*) (?:that|which) (?:is|are|was|were) (collected|gathered|obtained|used|employed|reported|described|published|presented|proposed|developed|discussed|mentioned|cited|quoted|outlined|identified|produced|written|recorded|measured|selected|observed|based|conducted|carried out|undertaken|performed|held|given|provided) (?=(?:by|in|on|from|for|at|during|between|with|under|over|through|across|throughout|as|since|to)\b)/g,
      (m, w, part) => /^(?:for|of|in|on|to|with|by|from|at|about|under|over|through|into|upon|without|within|between|among|amongst|after|before|during|against|toward|towards|via|per|like|beyond|despite|across|behind|below|above|beneath|beside|besides|near|this|that|it|what|all|those|these|everything|anything|nothing|something|much|little|which|who|so|such|now|given|provided|except|in|but|and|or|than|is|are|was|were|be|been|said|argued|claimed|showed|shown|found|noted|believed|thought|suggested|stated|reported|known|true|clear|evident|is|means|mean|meant|ensure|ensures|ensured|assume|assumes|assumed|show|shows|find|finds|note|notes|say|says|argue|argues|claim|claims|suggest|suggests|believe|believes|think|thinks|know|knows)$/i.test(w) || /ly$/i.test(w) ? m : w + ' ' + part + ' '], 'reduced'),
    /* "a growing amount of research" becomes "a growing body of research" */
    tag([/\b(a|an|the) ((?:growing|large|considerable|substantial|significant|vast|small|limited|modest|expanding|rich|extensive|sizeable|sizable|increasing) )?amount of (research|literature|scholarship|evidence)\b/gi,
      (m, d, adj, n) => keepCase((adj ? (d.toLowerCase() === 'the' ? 'the' : /^[aeiou]/i.test(adj) ? 'an' : 'a') : (d.toLowerCase() === 'the' ? 'the' : 'a')) + ' ' + (adj || '') + 'body of ' + n)(m)], 'idiom'),
    /* "the amount of students" becomes "the number of students" */
    tag([/\bamount of ((?:[a-z]+ )?(?:people|students|studies|participants|respondents|children|individuals|cases|papers|articles|books|researchers|scholars|words|times|questions|issues|problems|errors|mistakes|countries|users|patients|workers|items|things|ideas|sources|examples|readers|women|men|teachers|schools))\b/gi, (m, n) => keepCase('number of ' + n)(m)], 'countable')
  ].concat(forms([
    /* a verb hidden in a noun */
    [['have an (?:effect|impact) on', 'has an (?:effect|impact) on', 'had an (?:effect|impact) on', 'having an (?:effect|impact) on'], ['affect', 'affects', 'affected', 'affecting']],
    [['have an influence on', 'has an influence on', 'had an influence on', 'having an influence on'], ['influence', 'influences', 'influenced', 'influencing']],
    [['have a tendency to', 'has a tendency to', 'had a tendency to', 'having a tendency to'], ['tend to', 'tends to', 'tended to', 'tending to']],
    [['have a discussion (?:about|of|on)', 'has a discussion (?:about|of|on)', 'had a discussion (?:about|of|on)', 'having a discussion (?:about|of|on)'], ['discuss', 'discusses', 'discussed', 'discussing']],
    [['make use of', 'makes use of', 'made use of', 'making use of'], ['use', 'uses', 'used', 'using']],
    [['make (?:a )?reference to', 'makes (?:a )?reference to', 'made (?:a )?reference to', 'making (?:a )?reference to'], ['refer to', 'refers to', 'referred to', 'referring to']],
    [['make a comparison (?:between|of)', 'makes a comparison (?:between|of)', 'made a comparison (?:between|of)', 'making a comparison (?:between|of)'], ['compare', 'compares', 'compared', 'comparing']],
    [['make an attempt to', 'makes an attempt to', 'made an attempt to', 'making an attempt to'], ['attempt to', 'attempts to', 'attempted to', 'attempting to']],
    [['make a contribution to', 'makes a contribution to', 'made a contribution to', 'making a contribution to'], ['contribute to', 'contributes to', 'contributed to', 'contributing to']],
    [['make a distinction between', 'makes a distinction between', 'made a distinction between', 'making a distinction between'], ['distinguish between', 'distinguishes between', 'distinguished between', 'distinguishing between']],
    [['make an argument that', 'makes an argument that', 'made an argument that', 'making an argument that'], ['argue that', 'argues that', 'argued that', 'arguing that']],
    [['give an explanation (?:of|for)', 'gives an explanation (?:of|for)', 'gave an explanation (?:of|for)', 'giving an explanation (?:of|for)'], ['explain', 'explains', 'explained', 'explaining']],
    [['give a description of', 'gives a description of', 'gave a description of', 'giving a description of'], ['describe', 'describes', 'described', 'describing']],
    [['give an indication of', 'gives an indication of', 'gave an indication of', 'giving an indication of'], ['indicate', 'indicates', 'indicated', 'indicating']],
    [['provide a description of', 'provides a description of', 'provided a description of', 'providing a description of'], ['describe', 'describes', 'described', 'describing']],
    [['provide an explanation (?:of|for)', 'provides an explanation (?:of|for)', 'provided an explanation (?:of|for)', 'providing an explanation (?:of|for)'], ['explain', 'explains', 'explained', 'explaining']],
    [['provide an analysis of', 'provides an analysis of', 'provided an analysis of', 'providing an analysis of'], ['analyse', 'analyses', 'analysed', 'analysing']],
    [['perform an analysis of', 'performs an analysis of', 'performed an analysis of', 'performing an analysis of'], ['analyse', 'analyses', 'analysed', 'analysing']],
    [['carry out an analysis of', 'carries out an analysis of', 'carried out an analysis of', 'carrying out an analysis of'], ['analyse', 'analyses', 'analysed', 'analysing']],
    [['carry out an investigation (?:into|of)', 'carries out an investigation (?:into|of)', 'carried out an investigation (?:into|of)', 'carrying out an investigation (?:into|of)'], ['investigate', 'investigates', 'investigated', 'investigating']],
    [['carry out an examination of', 'carries out an examination of', 'carried out an examination of', 'carrying out an examination of'], ['examine', 'examines', 'examined', 'examining']],
    [['draw a conclusion', 'draws a conclusion', 'drew a conclusion', 'drawing a conclusion'], ['conclude', 'concludes', 'concluded', 'concluding']],
    [['come to an end', 'comes to an end', 'came to an end', 'coming to an end'], ['end', 'ends', 'ended', 'ending']]
  ]).map(r => [r[0], r[1], 'nominal'])).concat([
    beVerb('dependent (?:on|upon)', 'depend on', 'depends on', 'depended on'),
    beVerb('reliant (?:on|upon)', 'rely on', 'relies on', 'relied on'),
    beVerb('indicative of', 'indicate', 'indicates', 'indicated'),
    beVerb('reflective of', 'reflect', 'reflects', 'reflected'),
    beVerb('suggestive of', 'suggest', 'suggests', 'suggested'),
    beVerb('supportive of', 'support', 'supports', 'supported'),
    beVerb('in need of', 'need', 'needs', 'needed'),
    beVerb('of the (?:opinion|view|belief) that', 'believe that', 'believes that', 'believed that')
  ].map(r => [r[0], r[1], 'nominal']));
  /* ---- 7.43: a precise word for a vague one, where the noun decides the
     word: "a big role" is "a significant role", never "a large role" ---- */
  const RANK = '(?:role|part|impact|influence|effect|difference|factor|contribution|change|problem|issue|challenge|concern|question|step|improvement|mistake|threat|advantage|gap|increase|decrease|rise|fall|drop|shift|obstacle|barrier|implication|implications|consequence|consequences|benefit|benefits|risk|risks)';
  const PRECISE = [
    [new RegExp('\\bbig (' + RANK + ')\\b', 'gi'), (m, n) => keepCase('significant ' + n)(m)],
    /* "a major issue", never "a considerable issue" */
    [new RegExp('\\bhuge (' + RANK + ')\\b', 'gi'), (m, n) => keepCase((/^(?:issue|problem|question|concern|challenge|threat|mistake|obstacle|barrier|risks?)$/i.test(n) ? 'major ' : 'considerable ') + n)(m)],
    [/\ba lot (more|less|better|worse|greater|smaller|higher|lower|larger|easier|harder|longer|shorter|faster|slower|stronger|weaker|closer|wider)\b/gi, (m, c) => keepCase('much ' + c)(m)],
    [/\ba lot fewer\b/gi, keepCase('far fewer')],
    [/\btotally\b(?!\s+(?:\w+\s+)?(?:not|never|no)\b|\s+\w+n['’]t\b)/gi, keepCase('entirely')]
  ];
  /* alternatives a writer can choose instead, for some changes: tried on the
     writer's own words, never stacked on another change */
  const ALTS = [
    [new RegExp('\\bit (?:is|seems|appears|becomes) ' + DEG + '(?:clear|obvious|evident|apparent|plain) that\\s+', 'i'), ['Clearly, ', 'Evidently, ']],
    [new RegExp('\\bbig (' + RANK + ')\\b', 'i'), ['major $1', 'considerable $1']],
    [new RegExp('\\bhuge (' + RANK + ')\\b', 'i'), ['major $1', 'substantial $1']],
    [/\b(?:very|really|extremely|so|highly) important\b/i, ['crucial', 'essential', 'central']],
    [/\b(?:very|really|extremely) (?:big|large)\b/i, ['substantial', 'vast']],
    [/\b(?:very|really|extremely) small\b/i, ['slight', 'minor']],
    [/\b(?:very|really|extremely) (?:difficult|hard)\b/i, ['demanding', 'challenging']],
    [/\b(?:very|really|extremely) (?:good)\b/i, ['excellent', 'strong']],
    [/\b(?:very|really|extremely) (?:bad|serious)\b/i, ['severe', 'grave']],
    [/\b(?:very|really|extremely) (?:interesting)\b/i, ['striking', 'notable']],
    [/\b(?:very|really|extremely) (?:common)\b/i, ['widespread', 'prevalent']],
    [/\b(?:very|really|extremely) (?:strong)\b/i, ['robust', 'compelling']],
    [/\b(?:very|really|extremely) (?:weak)\b/i, ['tenuous', 'slight']],
    [/\b(?:very|really|extremely) (?:clear|obvious)\b(?! that)/i, ['evident', 'unmistakable']],
    [/\b(?:very|really|extremely) (?:quick|fast)\b/i, ['rapid', 'swift']],
    [/\b(?:very|really|extremely) (?:useful)\b/i, ['valuable', 'invaluable']],
    [/\b(?:very|really|extremely) (?:different)\b/i, ['distinct', 'markedly different']],
    [/\b(?:very|really|extremely) many\b/i, ['numerous']],
    [/\b(needs?|needed|deserves?|deserved|merits?|merited) to be (looked at|examined) in (?:(?:a lot|much|far|considerably|a great deal) )?(?:more|greater|further|closer) detail\b/i,
      ['$1 to be examined in more detail', m => ({ need: 'warrant', needs: 'warrants', needed: 'warranted', deserve: 'warrant', deserves: 'warrants', deserved: 'warranted', merit: 'warrant', merits: 'warrants', merited: 'warranted' }[m.split(' ')[0].toLowerCase()] || 'warrants') + ' closer examination']],
    [/\b(a|an|the) ((?:[a-z]+ )?)amount of (research|literature|scholarship)\b/i, ['$1 $2number of studies']],
    [/\bmake use of\b/i, ['employ', 'draw on']], [/\bmakes use of\b/i, ['employs', 'draws on']], [/\bmade use of\b/i, ['employed', 'drew on']],
    [/\b(?:have|has|had|having) an (?:effect|impact) on\b/i, [m => ({ have: 'influence', has: 'influences', had: 'influenced', having: 'influencing' }[m.split(' ')[0].toLowerCase()])]]
  ];
  /* other ways to say what a change says, worked out from the writer's own
     words (from); each one differs from the chosen version (to) */
  function alternatives(from, to) {
    const out = [], f = String(from || ''), t = String(to || '').trim();
    for (const [re, reps] of ALTS) {
      const m = re.exec(f); if (!m) continue;
      for (const rep of reps) {
        let r = typeof rep === 'function' ? rep(m[0]) : rep.replace(/\$(\d)/g, (x, n) => m[+n] || '');
        if (/^[A-Z]/.test(m[0]) && r) r = r[0].toUpperCase() + r.slice(1);
        let alt = f.slice(0, m.index) + r + f.slice(m.index + m[0].length);
        alt = fixArticles(f, tidy(alt)).replace(/\s+/g, ' ').trim();
        if (/^[A-Z]/.test(f.trim()) && alt) alt = alt[0].toUpperCase() + alt.slice(1);
        /* "Clearly, this": the word after a new opener keeps its own case */
        alt = alt.replace(/^(Clearly|Evidently), ([A-Z])(?=[a-z])/, (x, a, c) => a + ', ' + c.toLowerCase());
        if (alt && alt !== t && alt !== f.trim() && out.indexOf(alt) < 0) out.push(alt);
      }
    }
    return out.slice(0, 3);
  }
  /* ---- the casual register ---- */
  const CASUAL = [
    [/\bdo not\b/gi, keepCase("don't")], [/\bdoes not\b/gi, keepCase("doesn't")], [/\bdid not\b/gi, keepCase("didn't")],
    [/\bcannot\b/gi, keepCase("can't")], [/\bwill not\b/gi, keepCase("won't")], [/\bis not\b/gi, keepCase("isn't")], [/\bare not\b/gi, keepCase("aren't")],
    [/\butili[sz](e|es|ed|ing)\b/gi, (m, e) => keepCase('us' + e.toLowerCase())(m)],
    [/\bcommence(s|d)?\b/gi, (m, e) => keepCase('start' + ({ s: 's', d: 'ed' }[e] || ''))(m)],
    [/\bnevertheless\b/gi, keepCase('still')],
    [/\bfurthermore\b/gi, keepCase('also')],
    [/\b(to|will|would|can|could|should|must|I|we|you|they|did|do|does) purchase\b/gi, '$1 buy'],
    [/\bpurchased\b/gi, keepCase('bought')],
    [/\bapproximately\b/gi, keepCase('about')],
    [/\bassist(s|ed|ing)?\b/gi, (m, e) => keepCase('help' + (e || ''))(m)],
    [/\bdemonstrate(s)?\b/gi, (m, e) => keepCase('show' + (e ? 's' : ''))(m)], [/\bdemonstrated\b/gi, pastOr('shown', 'showed')],
    [/\bsubsequently\b/gi, keepCase('later')],
    [/\bin addition to\b/gi, keepCase('besides')],
    [/(^|[.!?]\s+)In addition,\s*/g, '$1Also, '],
    [/(^|[.!?]\s+)However,\s*/g, '$1But '],
    [/,\s*however,\s*/gi, ', though, ']
  ];

  /* ---- 7.38: a past participle where the grammar needs one ---- */
  const AUX = /\b(?:has|have|had|having|is|are|was|were|be|been|being|am|get|gets|got)\s+(?:(?:not|also|already|clearly|repeatedly|widely|often|first|recently|previously|never|since|now|long|well)\s+)?$/i;
  const DET_END = /\b(?:the|a|an|this|that|these|those|its|their|our|his|her|my|your)\s+$/i;
  /* "demonstrated" becomes "shown" after has, been or was, "showed" as a past
     verb, and stays as it is where it describes a noun ("the demonstrated
     effect"), which a plainer word would not fit */
  function pastOr(part, past) {
    return function () {
      const a = arguments, m = a[0], off = a[a.length - 2], str = a[a.length - 1];
      const pre = typeof off === 'number' ? str.slice(Math.max(0, off - 30), off) : '';
      if (DET_END.test(pre)) return m;
      return keepCase(AUX.test(pre) ? part : past)(m);
    };
  }
  /* ---- plainer words with the same meaning, for Simplify ---- */
  const PLAIN = [
    [/\butili[sz](e|es|ed|ing)\b/gi, (m, e) => keepCase('us' + e.toLowerCase())(m)],
    [/\butili[sz]ation\b/gi, keepCase('use')],
    [/\bcommence(s)?\b/gi, (m, s) => keepCase('start' + (s ? 's' : ''))(m)],
    [/\bcommenced\b/gi, keepCase('started')], [/\bcommencing\b/gi, keepCase('starting')],
    [/\bdemonstrate(s)?\b/gi, (m, s) => keepCase('show' + (s ? 's' : ''))(m)],
    [/\bdemonstrated\b/gi, pastOr('shown', 'showed')], [/\bdemonstrating\b/gi, keepCase('showing')],
    [/\bassist(s|ed|ing)?\b/gi, (m, e) => keepCase('help' + (e || ''))(m)],
    [/\bascertain(s|ed|ing)?\b/gi, (m, e) => keepCase({ s: 'finds out', ed: 'found out', ing: 'finding out' }[e] || 'find out')(m)],
    [/\bapproximately\b/gi, keepCase('about')],
    [/\bsubsequently\b/gi, keepCase('later')],
    [/\bnumerous\b/gi, keepCase('many')],
    /* "the sufficient conditions" cannot be "the enough conditions" */
    notAfter(/\bsufficient\b/gi, ['the', 'a', 'an', 'this', 'that', 'these', 'those', 'its', 'their', 'his', 'her', 'our', 'my', 'your', 'necessary and'], keepCase('enough')),
    [/\bindividuals\b(?!['’])/gi, keepCase('people')],
    [/\bin excess of\b/gi, keepCase('more than')],
    [/\bwith the result that\b/gi, keepCase('so')],
    [/\bin conjunction with\b/gi, keepCase('together with')],
    [/\bon the grounds that\b/gi, keepCase('because')],
    [/(^|[.!?]\s+)Furthermore,\s*/g, '$1Also, '],
    [/(^|[.!?]\s+)Nevertheless,\s*/g, '$1Still, ']
  ];
  /* ---- one idea per sentence ---- */
  const SUBJ = '(?:it|they|we|he|she|this|these|those|there|i|you|the|a|an|its|their|our|his|her|my|your|such|many|most|some|each|both|one|no|[A-Z][\\w’\'-]*)';
  const LINKW = '(?:however|therefore|thus|moreover|indeed|consequently|instead|otherwise|nevertheless|meanwhile|similarly|likewise|hence|accordingly|in contrast|as a result|for example|for instance)';
  const SUBORD = /\b(?:that|which|who|whom|whose|whether|if|because|although|though|while|when|whenever|since|unless|until|as|after|before|where|whereas|so that)\b/i;
  const nWords = s => (s.match(/[A-Za-z0-9’'-]+/g) || []).length;
  const FINITE = /\b(?:is|are|was|were|be|been|has|have|had|will|would|can|could|may|might|must|shall|should|do|does|did|[a-z]{2,}ed|ran|went|came|saw|took|gave|made|found|said|told|thought|knew|got|left|kept|held|brought|began|became|wrote|stood|felt|met|led|sent|built|lost|paid|fell|rose|grew|won|chose|spoke|broke|drove|ate|drew|threw|flew|sat|lay|hid|shook|sold|spent|taught|caught|fought|sought|bought|meant|heard|struck|hung|rang|sang|swam|wore|tore|woke|forgot|understood|put|set|cut|hit|let|read)\b/i;
  const AUXW = /^(?:is|are|was|were|has|have|had|will|would|can|could|may|might|must|should|shall|does|did|do)$/i;
  const cap = x => x[0].toUpperCase() + x.slice(1);
  const balanced = x => (x.split('(').length === x.split(')').length) && (x.split('[').length === x.split(']').length);
  /* the clause after ", and he" or ", and the results": a verb must follow its
     subject at once, or it is a list of things and not a second sentence */
  function clauseAfter(subj, b) {
    const w = b.split(/\s+/).slice(0, 5);
    if (/^the$/i.test(subj)) {
      for (let i = 1; i < w.length; i++) { if (/^(?:who|which|that|whose|of)$/i.test(w[i]) && i < 2) return false; if (AUXW.test(w[i])) return i <= 3; }
      return false;
    }
    const v = /^\w+ly$/i.test(w[0]) ? w[1] : w[0];
    return !!v && (AUXW.test(v) || /^[a-z]{2,}(?:ed|s)$/i.test(v));
  }
  function splitIdeas(t) {
    const W = WHY; WHY = 'split';
    /* a semicolon joining two clauses (never one in a list of several) */
    if ((t.match(/;/g) || []).length === 1) {
      t = t.replace(new RegExp('^([^;]*?[\\w"”’)])\\s*;\\s+((?:' + SUBJ + '\\b|' + LINKW + ',)[^;]*)$'), (m, a, b) => {
        if (nWords(a) < 4 || nWords(b) < 4 || !balanced(a) || !FINITE.test(a) || !FINITE.test(b)) return m;
        const out = a + '. ' + cap(b); note(m, out); return out;
      });
    }
    /* ", and it ..." after a plain main clause */
    t = t.replace(/^([^,;:]+?), and (it|they|we|he|she|there|I|the) ([\s\S]+)$/, (m, a, s, b) => {
      if (nWords(a) < 4 || nWords(b) < 3 || SUBORD.test(a) || !balanced(a) || !FINITE.test(a) || !clauseAfter(s, b)) return m;
      const out = a + '. ' + cap(s) + ' ' + b; note(m, out); return out;
    });
    WHY = W;
    return t;
  }
  /* ---- the active voice, for the plain past: "The samples were analysed by
     the team" becomes "The team analysed the samples". Only where the one
     who acts is named after "by", the sentence opens with what was acted on,
     and every word's role is certain; everything else is left as written ---- */
  const IRREG = {
    written: 'wrote', rewritten: 'rewrote', taken: 'took', undertaken: 'undertook', mistaken: 'mistook', given: 'gave', forgiven: 'forgave',
    shown: 'showed', seen: 'saw', foreseen: 'foresaw', overseen: 'oversaw', done: 'did', known: 'knew', made: 'made', found: 'found',
    held: 'held', built: 'built', sent: 'sent', spent: 'spent', lent: 'lent', told: 'told', sold: 'sold', said: 'said', brought: 'brought',
    thought: 'thought', bought: 'bought', caught: 'caught', taught: 'taught', sought: 'sought', fought: 'fought', led: 'led', misled: 'misled',
    fed: 'fed', read: 'read', put: 'put', set: 'set', cut: 'cut', hit: 'hit', hurt: 'hurt', shut: 'shut', run: 'ran', begun: 'began',
    chosen: 'chose', driven: 'drove', eaten: 'ate', forgotten: 'forgot', hidden: 'hid', spoken: 'spoke', stolen: 'stole', broken: 'broke',
    drawn: 'drew', withdrawn: 'withdrew', grown: 'grew', thrown: 'threw', blown: 'blew', flown: 'flew', won: 'won', left: 'left', kept: 'kept',
    lost: 'lost', paid: 'paid', laid: 'laid', understood: 'understood', felt: 'felt', met: 'met', heard: 'heard', beaten: 'beat', bitten: 'bit',
    frozen: 'froze', shaken: 'shook', sung: 'sang', rung: 'rang', worn: 'wore', torn: 'tore', sworn: 'swore', woken: 'woke', ridden: 'rode',
    struck: 'struck', stung: 'stung', swept: 'swept', wept: 'wept', bound: 'bound', ground: 'ground', wound: 'wound', dug: 'dug', spun: 'spun',
    upheld: 'upheld', withheld: 'withheld', overcome: 'overcame', overtaken: 'overtook', overthrown: 'overthrew'
  };
  /* "divided by two", "delayed by an hour", "reduced by half": measures, not doers */
  const VBX = /^(?:divided|multiplied|increased|decreased|reduced|raised|lowered|extended|shortened|lengthened|widened|narrowed|delayed|postponed|offset|exceeded|measured|separated|rounded|scaled|adjusted|inflated|deflated|weighted|ranked|sorted|grouped|indexed|followed)$/;
  /* nouns that end in -ing, which are doers and not "by using" */
  const INGN = /^(?:lightning|kings?|things?|mornings?|evenings?|spring|strings?|wings?|ceilings?|siblings?|offspring|vikings?|Beijing|Reading|Ealing|Kipling|Sterling|Browning|Fielding|Golding|Stirling)$/i;
  /* "found by the river", "parked by the house": a place, not a doer */
  const LOCN = /^(?:house|home|door|doorway|window|river|riverside|stream|sea|seaside|lake|pond|road|roadside|path|fire|fireplace|bed|bedside|wall|gate|station|tree|trees|shore|side|bridge|church|entrance|exit|table|desk|pool|canal|track|tracks|railway|harbour|harbor|coast|beach|cliff|well|fountain|stairs|sink|stove|bin|fence|hedge|garden|park|field|lane|street|motorway|highway|window|kerb|curb|wayside|sea|bank|waterside|lakeside|fireside|roadway|door)$/i;
  const PRON_OBJ = { i: 'me', he: 'him', she: 'her', we: 'us', they: 'them', it: 'it', you: 'you' };
  const PRON_SUBJ = { me: 'I', him: 'he', her: 'she', us: 'we', them: 'they', it: 'it', you: 'you' };
  const DETW = /^(?:the|a|an|this|that|these|those|its|their|our|his|her|my|your|each|every|all|some|many|most|several|both|no|such|one|two|three|four|five|six|seven|eight|nine|ten)$/i;
  const STOPW = /^(?:in|on|at|during|after|before|for|with|from|to|into|onto|over|under|between|among|amongst|through|throughout|across|since|until|as|because|while|when|where|whereas|although|though|but|nor|so|yet|via|per|within|without|against|despite|using|than|if|that|which|who|whom|whose|and|or|is|are|was|were|has|have|had|will|would|can|could|may|might|must|should|shall|do|does|did|not)$/i;
  const BYX = /^(?:hand|far|default|mistake|chance|email|e-mail|mail|post|phone|telephone|car|train|bus|air|sea|road|rail|accident|design|law|nature|contrast|comparison|definition|way|means|then|now|night|day|heart|name|weight|volume|number|numbers|percent|half|twice|itself|himself|herself|themselves|myself|ourselves|yourself|yourselves|end|time|virtue|dint|force|proxy|word|wire|cheque|check|cash|credit|hour|hours|minute|minutes|second|seconds|week|weeks|month|months|year|years|day|days|inch|inches|foot|feet|metre|metres|meter|meters|mile|miles|dozen|dozens|hundred|hundreds|thousand|thousands|million|millions|percentage|turns|degrees|default)$/i;
  const OPENER = /^((?:(?:However|Moreover|Furthermore|Indeed|Thus|Therefore|Finally|Later|Then|Next|Meanwhile|Consequently|Afterwards|Subsequently|Similarly|In turn|In addition|As a result|For example|For instance)|(?:In|On|At|During|After|Before|By|Until|Since) [^,]{1,30}),\s+)?/;
  function activeVoice(t) {
    const W = WHY; WHY = 'active';
    const out = activeOne(t);
    WHY = W;
    return out;
  }
  function activeOne(t) {
    const hits = t.match(/ (?:was|were) (?:[a-z]+ly )?[a-z]+ by /g);
    if (!hits || hits.length !== 1) return t;
    const m = / (was|were) (?:([a-z]+ly) )?([a-z]+) by /.exec(t);
    const op = OPENER.exec(t), pre = op[1] || '';
    const subj = t.slice(pre.length, m.index), after = t.slice(m.index + m[0].length);
    const vbn = m[3].toLowerCase(), adv = m[2] || '';
    const vbd = IRREG[vbn] || (vbn.length > 4 && /ed$/.test(vbn) ? vbn : null);
    if (!vbd || VBX.test(vbn)) return t;
    /* what was acted on: one to seven words, no clause of its own */
    const sw = subj.split(/\s+/);
    if (!subj || sw.length > 7 || /[,;:()"“”]/.test(subj) || SUBORD.test(subj) || /^(?:there|here|what|which|who|it)$/i.test(sw[0]) && sw.length > 1) return t;
    let obj;
    const lower = subj.toLowerCase();
    if (sw.length === 1 && PRON_OBJ[lower]) obj = PRON_OBJ[lower];
    else if (DETW.test(sw[0])) obj = (pre ? subj : subj[0].toLowerCase() + subj.slice(1));
    /* a name: two to four capitalised words, or one in mid-sentence */
    else if (sw.every(w => /^[A-Z][a-z’'-]+$/.test(w)) && sw.length <= 4 && (sw.length > 1 || pre)) obj = subj;
    /* a plural at the start ("Samples were collected by ...") */
    else if (m[1] === 'were' && sw.length === 1 && /^[A-Z][a-z]+s$/.test(sw[0])) obj = sw[0].toLowerCase();
    else return t;
    /* the one who acts: a determiner and a few words, "of" and a second name allowed */
    const toks = after.match(/^[^,;:.!?()"“”]*/)[0].split(/\s+/).filter(Boolean);
    const ag = [];
    for (let i = 0; i < toks.length && ag.length < 8; i++) {
      const w = toks[i], lw = w.toLowerCase();
      if (/\d/.test(w)) return t;
      if (lw === 'of' && ag.length && i + 1 < toks.length && !STOPW.test(toks[i + 1])) { ag.push(w); continue; }
      if ((lw === 'and' || lw === 'or') && ag.length && i + 1 < toks.length && (DETW.test(toks[i + 1]) || /^[A-Z]/.test(toks[i + 1]))) { ag.push(w); continue; }
      if (STOPW.test(lw) && lw !== 'that') break;
      if (lw === 'that') { if (ag.length && DETW.test(toks[0])) return t; break; }
      ag.push(w);
    }
    if (!ag.length || BYX.test(ag[0]) || (/ing$/i.test(ag[0]) && !INGN.test(ag[0])) || (DETW.test(ag[0]) && ag[1] && BYX.test(ag[1]))) return t;
    if (ag.length === 1 && DETW.test(ag[0]) && !PRON_SUBJ[ag[0].toLowerCase()]) return t;
    if (LOCN.test(ag[ag.length - 1])) return t;
    let pos = 0;
    for (const w of ag) pos = after.indexOf(w, pos) + w.length;
    const agent = ag.join(' '), rest = after.slice(pos);
    if (/^\s+that\b/i.test(rest) || (lower === 'it' && /^\s+(?:to|that)\b/i.test(rest))) return t;
    /* "... and was expected to ...": a second verb would lose its subject;
       "..., which acquitted him": a relative clause would attach to the wrong noun */
    if (/\b(?:and|but|or)\s+(?:(?:then|later|also|subsequently|eventually|soon|was|were|is|are|has|have|had|will|would|could|can|may|might)\b|[a-z]+ed\b)/i.test(rest)) return t;
    if (/\b(?:who|whom|whose|which)\b/i.test(rest)) return t;
    let doer = ag.length === 1 && PRON_SUBJ[agent.toLowerCase()] ? PRON_SUBJ[agent.toLowerCase()] : agent;
    if (doer === 'i') doer = 'I';
    if (!pre) doer = doer[0].toUpperCase() + doer.slice(1);
    else if (DETW.test(ag[0]) || PRON_SUBJ[agent.toLowerCase()]) doer = doer === 'I' ? 'I' : doer[0].toLowerCase() + doer.slice(1);
    const out = pre + doer + ' ' + (adv ? adv + ' ' : '') + vbd + ' ' + obj + rest;
    note(t, out);
    return out;
  }
  /* ---- neutral: words that tell the reader what to think ---- */
  const STANCE = [
    /* 7.43: "It is clear that" tells the reader what to conclude */
    atStart('it (?:is|seems|appears) ' + DEG + '(?:clear|obvious|evident|undeniable|indisputable) that\\s+'),
    atStart('(?:obviously|clearly|undoubtedly|unquestionably|surely|of course|naturally|unfortunately|sadly|fortunately|luckily|thankfully|needless to say|interestingly|remarkably|admittedly|frankly|honestly),\\s*'),
    [/,\s*(?:obviously|of course|naturally|unfortunately|sadly|fortunately|luckily|thankfully|frankly|honestly),\s*/gi, ' '],
    [/\b(?:obviously|undoubtedly|unquestionably) (?=[a-z])/gi, '']
  ];
  /* ---- hedged to the evidence: claims of certainty made careful ---- */
  const OVER = [
    [/\b(prove|proves|proved)\b(?= (\w+))/gi, (m, v, next) => {
      const that = next.toLowerCase() === 'that';
      if (!that && !DETW.test(next) && !/^(?:it|them|this)$/i.test(next)) return m;
      return keepCase((that ? { prove: 'suggest', proves: 'suggests', proved: 'suggested' } : { prove: 'support', proves: 'supports', proved: 'supported' })[v.toLowerCase()])(m);
    }],
    [/\b(?:clearly|conclusively|definitively|undeniably|unequivocally) (show|shows|showed|shown|demonstrate|demonstrates|demonstrated|establish|establishes|established|prove|proves|proved)\b/gi,
      (m, v) => keepCase({ show: 'indicate', shows: 'indicates', showed: 'indicated', shown: 'indicated', demonstrate: 'indicate', demonstrates: 'indicates', demonstrated: 'indicated', establish: 'indicate', establishes: 'indicates', established: 'indicated', prove: 'suggest', proves: 'suggests', proved: 'suggested' }[v.toLowerCase()])(m)],
    [/\bit is (?:clear|obvious|evident|undeniable|indisputable|beyond doubt) that\b/gi, keepCase('it appears that')],
    [/\bit is (?:certain) that\b/gi, keepCase('it is likely that')],
    [/\b(is|are|was|were) (?:certainly|definitely|undoubtedly|unquestionably|without (?:a )?doubt) /gi, '$1 probably '],
    [new RegExp(S0 + '(?:undoubtedly|unquestionably|without (?:a )?doubt|beyond (?:any )?doubt|certainly|definitely),\\s*', 'gi'), (m, pre) => pre + (/,\s*$/.test(pre) ? 'probably, ' : 'Probably, ')],
    [/\b(is|are) always\b/gi, '$1 usually'],
    [/\ball (researchers|scholars|experts|studies|scientists|historians|critics|commentators|economists|linguists|philosophers|theorists)\b/gi, (m, w) => keepCase('most ' + w)(m)]
  ];

  /* 7.38: quotations found in the whole text, so one that runs across
     sentences ("A proper analysis must take ... three!" Then ...) or is never
     closed is protected too; a quotation is never reworded */
  function quoteSpans(src) {
    const out = [], re = /"[^"\n]*(?:"|$)|“[^”\n]*(?:”|$)/gm;
    let m;
    while ((m = re.exec(src))) { if (!m[0].length) { re.lastIndex++; continue; } out.push([m.index, m.index + m[0].length]); }
    return out;
  }
  function run(t, fn) {
    const src = String(t || ''), Q = quoteSpans(src);
    /* sentences and their gaps, kept exactly: a marker after each end mark */
    const parts = src.replace(/([.!?]["”’)]?)(\s+)/g, '$1\u0001$2\u0001').replace(/(\n+)/g, '\u0001$1\u0001').split('\u0001');
    let off = 0;
    return parts.map((p, i) => {
      const at = off; off += p.length;
      if (i % 2 || !p.trim()) return p;
      /* the parts of this sentence outside every quotation */
      let o = '', k = 0;
      for (const [qs, qe] of Q) {
        const s0 = Math.max(qs - at, 0), e0 = Math.min(qe - at, p.length);
        if (e0 <= 0 || s0 >= p.length || s0 < k) continue;
        o += fn(p.slice(k, s0)) + p.slice(s0, e0); k = e0;
      }
      o += k < p.length ? fn(p.slice(k)) : '';
      return o === p ? p : finish(p, o);
    }).join('');
  }
  /* 7.43: Concise, Shorter, Scholarly and Simplify recast sentences
     (RECAST); Professional and Scholarly choose the precise word (PRECISE) */
  const concise = t => run(t, x => dropIntensifiers(apply(apply(x, RECAST, 'recast'), WORDY, 'wordy')));
  const shorten = t => run(t, x => dropHedges(dropIntensifiers(apply(apply(x, RECAST, 'recast'), WORDY, 'wordy'))));
  const confident = t => run(t, x => dropHedges(x));
  const professional = t => run(t, x => apply(apply(apply(x, CONTR, 'contraction'), PRECISE, 'exact'), INFORMAL, 'informal'));
  /* the wordy phrases before the informal words, so "a lot of time" ends as
     "a great deal of time" and is not shortened again to "much time" */
  const scholarly = t => run(t, x => dropIntensifiers(apply(apply(apply(apply(apply(apply(x, CONTR, 'contraction'), RECAST, 'recast'), PRECISE, 'exact'), WORDY, 'wordy'), INFORMAL, 'informal'), ELEV, 'exact')));
  const casual = t => run(t, x => apply(x, CASUAL, 'casual'));
  /* 7.38 */
  const simplify = t => run(t, x => splitIdeas(dropIntensifiers(apply(apply(apply(x, RECAST, 'recast'), WORDY, 'wordy'), PLAIN, 'plain'))));
  const split = t => run(t, x => splitIdeas(x));
  const active = t => run(t, x => activeVoice(x));
  const neutral = t => run(t, x => dropIntensifiers(apply(x, STANCE, 'stance')));
  const hedge = t => run(t, x => apply(x, OVER, 'overclaim'));
  /* why each kind of change was made, in the words the panel shows */
  const WHYS = {
    wordy: 'Shorter, and it means the same.',
    filler: 'This opening only announces the point. Starting with the point is stronger.',
    intensifier: 'Words like “very” and “really” rarely add meaning; the word they lean on carries it.',
    hedge: 'A softener that weakens a claim the passage can make plainly.',
    contraction: 'Formal writing spells contractions out.',
    informal: 'Too informal for this register.',
    exact: 'A more exact word, as academic writing prefers.',
    casual: 'A plainer, more relaxed word.',
    plain: 'A plainer word that means the same.',
    split: 'Two ideas, two sentences: each is easier to hold in mind.',
    active: 'Active voice: the one who acts comes first, so the reader sees who did what.',
    stance: 'This word tells the reader what to think. Neutral writing lets the evidence speak.',
    overclaim: 'A claim of certainty. A careful word matches what the evidence can show.',
    /* 7.43 */
    opener: '“It is clear that” only announces the point. State the point; if it is clear, the reader will see that it is.',
    expletive: '“There are … who” makes the reader wait for the subject. Starting with the subject saves words and puts the actors first.',
    something: '“It is something that” is a long way round. Say what it does.',
    closer: 'A noun (“examination”) carries what a long verb phrase did, in fewer words.',
    how: '“The ways in which” is a long way of saying “how”.',
    reduced: 'A shorter clause with the same meaning: “the data that were collected” and “the data collected” say the same, and research is always carried out.',
    idiom: '“A body of research” is the usual phrase for studies taken together; “amount” suits a mass you measure.',
    countable: '“Amount” is for what cannot be counted (time, money, research); “number” is for what can (people, studies).',
    nominal: 'A verb hidden in a noun (“make use of”, “have an effect on”). The verb itself (“use”, “affect”) is shorter and more direct.',
    recast: 'The sentence recast so its subject and verb carry the meaning.'
  };
  /* the rewrite and, for each change, what it was and why */
  function explain(mode, t) {
    const prev = LOG; LOG = [];
    let text, log;
    try { text = api[mode](t); } finally { log = LOG; LOG = prev; }
    const seen = {}, changes = [];
    if (text !== t) log.forEach(c => {
      const k = c.why + '\u0000' + c.from.toLowerCase().trim() + '\u0000' + c.to.toLowerCase().trim();
      if (seen[k]) { seen[k].n++; return; }
      seen[k] = { from: c.from, to: c.to, why: c.why, n: 1 }; changes.push(seen[k]);
    });
    return { text: text, changes: changes };
  }
  const api = { concise, shorten, confident, professional, scholarly, casual, simplify, split, active, neutral, hedge, explain, alternatives, WHYS, fixArticles, tidy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKRW = api;
})(typeof self !== 'undefined' ? self : this);
