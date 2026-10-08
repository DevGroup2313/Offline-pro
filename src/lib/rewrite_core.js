/* Inkwell's offline rewrites: Concise, Shorter, Professional, Scholarly,
   Casual and Confident, by rules, on this device. 7.37 rewrote them after a
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
  /* outside quotation marks only */
  function outsideQuotes(t, fn) {
    const parts = t.split(/("[^"\n]*"|“[^”\n]*”)/);
    return parts.map((p, i) => (i % 2 ? p : fn(p))).join('');
  }
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
  function apply(t, list) {
    for (const [re, rep] of list) {
      t = t.replace(re, function () {
        const a = arguments, m = a[0], off = a[a.length - 2], str = a[a.length - 1];
        if (typeof off === 'number' && inTitle(str, off, m.length)) return m;
        if (typeof rep === 'function') return rep.apply(null, a);
        const groups = Array.prototype.slice.call(a, 1, a.length - 2);
        return rep.replace(/\$(\d)/g, (x, n) => groups[+n - 1] == null ? '' : groups[+n - 1]);
      });
    }
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
    atStart('(?:it is important to note that|it should be noted that|it is worth noting that|it is interesting to note that|it is a fact that|needless to say,?|it goes without saying that)\\s*')
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
    t = t.replace(/\b(very|really|extremely)(?:,?\s+\1\b)+/gi, '$1');
    /* "the very end", "not really", "really?" keep their word */
    t = apply(t, [notAfter(/\b(?:very|extremely|totally|basically|literally|actually) (?=[A-Za-z])/gi, ['the', 'this', 'that', 'these', 'those', 'its', 'their', 'our', 'my', 'your', 'his', 'her'], '')]);
    t = apply(t, [notAfter(/\breally (?=[A-Za-z])/gi, ['not', "n't", 'n’t'], '')]);
    return t;
  }
  /* ---- hedges: only words that soften and carry no fact ---- */
  function dropHedges(t) {
    t = t.replace(/,\s*(?:I think|I believe|I feel|in my opinion|perhaps|arguably|it seems|more or less|to some extent)\s*,/gi, '');
    t = t.replace(/,\s*(?:I think|I believe|I feel) (?:that )?(?=[a-z])/g, ', ');
    t = apply(t, [
      atStart('(?:I think that|I think|I believe that|I believe|I feel that|I would say that|I would argue that|in my opinion,?|it seems that|it appears that|it could be argued that|perhaps|maybe|arguably|possibly)\\s+')
    ]);
    t = t.replace(/\b(?:perhaps|arguably|presumably|somewhat) (?=[a-z])/g, '');
    t = t.replace(/\s*\b(?:more or less|to some extent)\b/gi, '');
    /* "sort of" and "kind of" only where they soften a verb or an adjective */
    t = t.replace(/\b(is|are|was|were|be|been|it's|I|we|you|they|he|she|feel|felt|seems|seemed|looks|looked) (?:sort|kind) of (?=[a-z])/gi, '$1 ');
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
  const muchMany = (m, lead, next) => keepCase((/[^s]s$|ies$|^(?:people|children|men|women|students)$/i.test(next) ? 'many ' : 'much ') + next)(m);
  const INFORMAL = [
    [/\bgonna\b/gi, keepCase('going to')], [/\bwanna\b/gi, keepCase('want to')], [/\bgotta\b/gi, keepCase('have to')], [/\bkinda\b/gi, keepCase('somewhat')],
    [/\b(a lot of|lots of) (\w+)/gi, (m, lead, next) => muchMany(m, lead, next)],
    [/\bkids\b/gi, keepCase('children')],
    [/\bhuge\b/gi, keepCase('large')],
    [/\bbig\b(?!\s+(?:data|bang|picture|deal|brother|tech|five|ten|apple|city|cat|game|screen|toe|top|shot|wig|business|pharma|names?)\b)/gi, keepCase('large')],
    [/\b(is|are|was|were|seems|seemed|be|been) (?:ok|okay)\b/gi, '$1 acceptable'],
    [/\bmaybe\b/gi, keepCase('perhaps')],
    [/(^|[.!?]\s+)Plus,\s*/g, '$1Moreover, '],
    [/\banyway\b/gi, keepCase('in any case')],
    [/\bpretty (?=(?:good|bad|much|clear|sure|easy|hard|simple|obvious|strong|weak|well|important|common|rare|close|quick|quickly|similar|small|large|high|low|interesting|difficult|useful|accurate|confident|certain|likely|unlikely|straightforward)\b)/gi, '']
  ];
  /* ---- a plainer word for a more exact one, in the scholarly register ---- */
  const ELEV = [
    [/\b(show|shows|showed)\b(?= (?:that|how|what|why|whether|the|a|an|this|these|those|its|their|his|her|our|no|little|some|signs|evidence|significant|clear|strong|\d))/gi, (m, w) => keepCase({ show: 'demonstrate', shows: 'demonstrates', showed: 'demonstrated' }[w.toLowerCase()])(m)],
    [/\bshown(?= (?:that|to|by|above|below|in (?:Table|Figure|Fig)))/gi, keepCase('demonstrated')],
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
    [/\bdemonstrate(s|d)?\b/gi, (m, e) => keepCase('show' + ({ s: 's', d: 'ed' }[e] || ''))(m)],
    [/\bsubsequently\b/gi, keepCase('later')],
    [/\bin addition to\b/gi, keepCase('besides')],
    [/(^|[.!?]\s+)In addition,\s*/g, '$1Also, '],
    [/(^|[.!?]\s+)However,\s*/g, '$1But '],
    [/,\s*however,\s*/gi, ', though, ']
  ];

  function run(t, fn) {
    const src = String(t || '');
    /* sentences and their gaps, kept exactly: a marker after each end mark */
    const parts = src.replace(/([.!?]["”’)]?)(\s+)/g, '$1\u0001$2\u0001').replace(/(\n+)/g, '\u0001$1\u0001').split('\u0001');
    return parts.map((p, i) => {
      if (i % 2 || !p.trim()) return p;
      const o = outsideQuotes(p, fn);
      return o === p ? p : finish(p, o);
    }).join('');
  }
  const concise = t => run(t, x => dropIntensifiers(apply(x, WORDY)));
  const shorten = t => run(t, x => dropHedges(dropIntensifiers(apply(x, WORDY))));
  const confident = t => run(t, x => dropHedges(x));
  const professional = t => run(t, x => apply(apply(x, CONTR), INFORMAL));
  const scholarly = t => run(t, x => apply(apply(apply(apply(x, CONTR), INFORMAL), WORDY), ELEV));
  const casual = t => run(t, x => apply(x, CASUAL));
  const api = { concise, shorten, confident, professional, scholarly, casual, fixArticles, tidy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKRW = api;
})(typeof self !== 'undefined' ? self : this);
