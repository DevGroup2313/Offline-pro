/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.50: the gaps (INKGAPS). An audit of the corrector against the Write &
   Improve reference (ERRANT, by error type) found where it was silent:
   prepositions missing their last word ("in spite all"), the wrong
   dependent preposition ("interested on"), a missing article before a
   singular count noun ("is experienced person"), a quantifier before a
   singular ("many problem"), a verb in the wrong form after a modal, an
   auxiliary or "to" ("will delighted", "have went", "a way to learning"),
   agreement with a gerund, a country or a plural head noun ("Sharing rooms
   have", "the chances of accident is"), a capital inside a sentence on a
   word that takes none ("thinking It would"), and a few frequent
   morphology slips ("nowaday", "interesting in", "everyday" as an adverb).
   Each rule fires only where the grammar of what is left is certain; the
   lexicon (INKLEX), when it is loaded, confirms parts of speech and gives
   the inflected forms; without it, the lists here and the regular spellings
   serve. check(text) returns edits in the page's shape: start, end, fix,
   why, cat 'g', fam. tools/grammar/gaps_test.js holds the tests. */
(function (root) {
  'use strict';
  const LEX = () => (root.INKLEX && root.INKLEX.ready) ? root.INKLEX : null;
  const lc = s => String(s).toLowerCase();
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  /* keep the case of the word replaced: "In spite" stays "In spite of" */
  function caseLike(src, out) { return /^[A-Z]/.test(src) && /^[a-z]/.test(out) ? cap(out) : out; }

  /* ---- words with their places ---- */
  const WRE = /[A-Za-z][A-Za-z'’-]*/g;
  function words(t) { const out = []; let m; WRE.lastIndex = 0; while ((m = WRE.exec(t))) out.push({ w: m[0], l: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length }); return out; }
  /* the sentence's start: nothing but space, quotes or brackets since a stop or a line break */
  function sentStart(t, i) { return /(?:^|[.!?\n]["”’)]*)\s*["“‘(\[]*$/.test(t.slice(Math.max(0, i - 40), i)); }
  /* true where the gap between two words holds punctuation */
  function gap(t, a, b) { return /[^\s]/.test(t.slice(a.e, b.s)); }

  /* ---- lists ---- */
  const MASS = new Set(('information advice research work time money water food furniture equipment knowledge evidence progress traffic music art help fun stuff luggage baggage homework news weather pollution education health energy electricity transport transportation communication entertainment damage effort support success access attention trouble stress sleep exercise space land air rain snow bread rice meat sugar salt coffee tea milk paper wood metal plastic glass oil gas fuel software hardware data behaviour behavior freedom nature society culture history literature grammar vocabulary mathematics physics chemistry economics politics science technology business trade growth development unemployment poverty crime violence safety security peace love hate anger fear hope luck happiness sadness beauty truth justice wealth power strength confidence intelligence patience courage honesty kindness advice feedback permission harm leisure accommodation clothing cash insurance mail jewellery jewelry machinery scenery shopping training weather wildlife housing cutlery garbage rubbish litter dust sand soil grass hair skin blood sweat fruit laughter pride respect fitness wisdom logic chaos silence noise sunshine heat cold light darkness fire smoke steam ice snow traffic tourism commerce industry agriculture infrastructure legislation').split(' '));
  const PLURAL_ONLY = new Set('people children men women police staff cattle feet teeth mice geese oxen media data criteria phenomena'.split(' '));
  const SING_S = new Set('corps news physics mathematics economics politics series species means analysis basis crisis thesis diabetes measles status bus gas glass class mass grass pass dress process success business witness illness kindness darkness happiness sadness fitness awareness business campus virus bonus focus chaos lens'.split(' '));
  const COUNT = new Set(('person student teacher doctor nurse engineer lawyer worker manager boss customer neighbour neighbor stranger actor singer writer player friend child man woman boy girl mother father brother sister son daughter husband wife parent baby adult citizen member leader expert professor scientist researcher artist author driver farmer soldier policeman pilot chef cook waiter guest visitor tourist passenger volunteer candidate applicant employee employer colleague partner coach captain hero villain king queen prince princess president minister judge car bus train plane bike bicycle boat ship taxi truck house home flat apartment room kitchen bedroom bathroom garden office building school university college library hospital church shop store restaurant hotel cafe bank museum theatre theater cinema park city town village country island river mountain lake beach forest road street bridge book letter email message note report essay article story poem song film movie picture photo painting map page chapter word sentence paragraph question answer problem solution idea reason way method plan project programme program meeting event situation experience environment mistake chance opportunity decision choice job career position role task duty lesson course class exam test degree certificate computer laptop phone camera television tv radio machine tool device system network website game sport match race team club group party company organisation organization government department agency factory market product brand price cost fee ticket card gift present dog cat bird horse cow pig fish tree flower table chair desk bed door window wall floor roof box bag bottle cup glass plate knife fork spoon day week month year hour minute moment period century decade morning evening night holiday trip journey tour visit walk dream goal purpose result effect cause factor change difference benefit advantage disadvantage risk danger threat issue topic subject point example case fact detail feature aspect part piece item number figure amount level rate value kind type sort form shape size colour color sound voice smell taste view scene language dialect accent culture tradition custom habit rule law policy right duty responsibility skill talent ability quality character personality attitude opinion belief feeling emotion memory thought mind body heart hand head face eye nose mouth leg arm foot finger').split(' '));
  const ADJ_SURE = new Set(('experienced good bad big small large great new old young long short high low hot cold warm cool easy hard difficult simple important serious major minor real true false nice beautiful ugly rich poor happy sad strong weak busy free full empty open closed clean dirty safe dangerous quiet loud bright dark fast slow quick early late modern ancient traditional popular famous common rare special different similar strange funny fun interesting boring exciting amazing wonderful terrible horrible awful perfect excellent fine wrong right correct main first second last next final previous whole complete single double huge tiny enormous little wide narrow deep shallow thick thin heavy light soft tough gentle kind cruel polite rude friendly lonely private public local national international foreign native natural normal usual typical general particular certain possible impossible necessary useful useless valuable expensive cheap professional personal social political economic cultural historical scientific medical legal financial physical mental emotional practical theoretical technical digital electronic formal informal official healthy sick tired hungry thirsty angry proud brave clever stupid wise crazy calm nervous curious careful careless honest lucky successful effective efficient reliable responsible independent creative active positive negative black white red green blue yellow brown grey gray pink purple orange').split(' '));
  const SUBJ_PRON = /^(i|you|we|they|he|she|it|there|this|that|these|those)$/i;
  const DET = /^(the|a|an|this|that|these|those|my|our|your|their|his|her|its|some|many|most|every|each|all|one|another|such|no|any)$/i;
  const BASE_VERBS = new Set(('make take give go come get have do say see know think want need use find tell ask work seem feel try leave call keep let begin show hear play run move live believe bring happen write provide sit stand lose pay meet include continue set learn change lead understand watch follow stop create speak read allow add spend grow open walk win offer remember love consider appear buy wait serve die send expect build stay fall cut reach kill remain suggest raise pass sell require report decide pull control cause increase decrease reduce affect help support mean exist depend produce become involve occur contain consist matter cost look turn start put hold attract explain pollute exercise collect improve prefer teach enjoy hate like seem sound smell taste cover carry choose drive eat drink sleep study travel visit plan finish prepare protect prevent promote develop manage organise organize deliver receive accept refuse agree argue claim argue mention describe discuss explain express focus concern achieve avoid enable encourage ensure face fail form gain handle identify indicate introduce join maintain measure mind notice obtain perform pick place point practise practice present press prove push realise realize recognise recognize reflect regard relate release rely replace represent respond result return reveal save search seek share solve succeed suffer suppose survive tend thank throw treat trust wear wish wonder worry delight mingle limit visit excite invite attend arrange assume attach attempt attend award behave benefit blame borrow bother breathe calculate celebrate challenge charge chat cheat check cheer clean clear climb close combine command comment commit communicate compare compete complain complete concentrate conclude confirm confuse connect convince cook copy correct count crash criticise criticize cry damage dance debate declare decline defend define delay demand deny deserve design destroy determine disagree disappear discover dislike display distribute disturb divide doubt dress drop earn educate elect eliminate embrace emerge emphasise emphasize employ end engage enter entertain escape establish estimate evaluate examine exceed exchange exclude excuse exhibit expand experience explore export extend fetch fill fit fix flow fold forgive found fulfil fulfill generate govern greet guarantee guess guide hang harm heal hesitate hire hope hunt hurry ignore illustrate imagine implement imply import impose impress inform inherit injure insist inspire install insult integrate interpret interrupt interview invent invest investigate judge jump justify kick kiss knock lack land laugh launch lay lift link list load lock marry match mark mix motivate name negotiate note object observe occupy operate oppose order overcome owe own pack paint park participate persuade phone pour praise pray predict prepare prescribe preserve pretend print proceed process program progress prohibit propose prosper publish punish purchase pursue qualify question quote rank rate react record recover recruit recycle refer reform regret regulate reject relax remind remove rent repair repeat request rescue research reserve resist resolve rest restore restrict retire review reward ride ring risk roll rush sail satisfy scream secure select separate settle shout sign smile smoke sort spread stare state stimulate stretch strengthen struggle submit supply surprise surround suspect swim switch tackle test thrive tie tolerate touch track trade transfer transform translate transport trick trouble undergo undermine unite update upset urge vary vote warn wash waste weigh welcome whisper wipe witness yell').split(' '));
  /* irregular verbs: base, past, participle */
  const IRR = {}; 'be was been|have had had|do did done|go went gone|come came come|become became become|get got got|take took taken|give gave given|make made made|see saw seen|know knew known|think thought thought|say said said|tell told told|find found found|leave left left|feel felt felt|bring brought brought|buy bought bought|teach taught taught|catch caught caught|fight fought fought|seek sought sought|keep kept kept|sleep slept slept|meet met met|lose lost lost|pay paid paid|sell sold sold|send sent sent|spend spent spent|build built built|lend lent lent|bend bent bent|hear heard heard|hold held held|lead led led|read read read|mean meant meant|learn learnt learnt|understand understood understood|stand stood stood|win won won|sit sat sat|put put put|cut cut cut|let let let|hit hit hit|hurt hurt hurt|set set set|shut shut shut|cost cost cost|quit quit quit|run ran run|eat ate eaten|write wrote written|drive drove driven|ride rode ridden|rise rose risen|choose chose chosen|speak spoke spoken|break broke broken|steal stole stolen|wake woke woken|freeze froze frozen|forget forgot forgotten|grow grew grown|throw threw thrown|know knew known|blow blew blown|fly flew flown|draw drew drawn|show showed shown|fall fell fallen|begin began begun|drink drank drunk|sing sang sung|swim swam swum|ring rang rung|sink sank sunk|shrink shrank shrunk|spring sprang sprung|wear wore worn|tear tore torn|swear swore sworn|bear bore borne|bite bit bitten|hide hid hidden|forgive forgave forgiven|shake shook shaken|mistake mistook mistaken|lie lay lain|lay laid laid|light lit lit|feed fed fed|bleed bled bled|deal dealt dealt|dream dreamt dreamt|spell spelt spelt|smell smelt smelt|burn burnt burnt|strike struck struck|stick stuck stuck|dig dug dug|hang hung hung|spin spun spun|swing swung swung|cling clung clung|fling flung flung|sting stung stung|wind wound wound|bind bound bound|grind ground ground|slide slid slid|shoot shot shot|seek sought sought|flee fled fled|arise arose arisen|overcome overcame overcome|undertake undertook undertaken|withdraw withdrew withdrawn|prove proved proven|sew sewed sewn|mow mowed mown'.split('|').forEach(s => { const p = s.split(' '); IRR[p[0]] = { ed: p[1], en: p[2] }; });
  const PAST_TO_BASE = {}; const EN_TO_BASE = {}; const BASE_SET = new Set(Object.keys(IRR));
  Object.keys(IRR).forEach(b => { PAST_TO_BASE[IRR[b].ed] = b; EN_TO_BASE[IRR[b].en] = b; });
  function regularBase(w) {
    /* "studied" to "study", "stopped" to "stop", "used" to "use", "played" to "play"; null where unsure */
    if (/ied$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
    if (/([^aeiouy])\1ed$/.test(w) && w.length > 5) return w.slice(0, -3);
    if (!/ed$/.test(w) || /eed$/.test(w) || w.length < 5) return null;
    const b = w.slice(0, -2);
    /* the list decides between "limit" and "excite"; without it, only the clear shapes */
    if (BASE_VERBS.has(b) || BASE_SET.has(b)) return b;
    if (BASE_VERBS.has(b + 'e') || BASE_SET.has(b + 'e')) return b + 'e';
    return null;
  }
  /* the base of a verb standing in its past or participle; null where it is not certain */
  function baseOfPast(w) {
    const X = LEX();
    if (X) { try { const b = X.bases(w).find(o => o.pos === 'v' && (o.form === 'ed' || o.form === 'en')); if (b) return b.base; if (X.bases(w).some(o => o.pos === 'v')) return null; } catch (e) {} }
    if (PAST_TO_BASE[w]) return PAST_TO_BASE[w];
    if (EN_TO_BASE[w]) return EN_TO_BASE[w];
    if (/ed$/.test(w)) { const b = regularBase(w); if (b && (BASE_VERBS.has(b) || BASE_SET.has(b))) return b; }
    return null;
  }
  /* the base of a verb in its -s form; null where it could as well be a noun */
  function baseOfS(w) {
    const X = LEX();
    if (X) { try { const bs = X.bases(w); const v = bs.find(o => o.pos === 'v' && o.form === 's'); if (!v) return null; if (bs.some(o => o.pos === 'n' && o.form === '')) return null; return v.base; } catch (e) {} }
    if (!/s$/.test(w) || SING_S.has(w) || w.length < 4) return null;
    let b = /ies$/.test(w) ? w.slice(0, -3) + 'y' : /(ss|sh|ch|x|z|o)es$/.test(w) ? w.slice(0, -2) : w.slice(0, -1);
    return BASE_VERBS.has(b) ? b : null;
  }
  function isBaseVerb(w) {
    const X = LEX();
    if (X) { try { const bs = X.bases(w); return bs.some(o => o.pos === 'v' && o.form === '') && !bs.some(o => o.pos === 'n' && o.form === ''); } catch (e) {} }
    return BASE_VERBS.has(w) || BASE_SET.has(w);
  }
  function ingOf(base) {
    const X = LEX(); if (X) { try { const f = X.inflect(base, 'v', 'ing'); if (f) return f; } catch (e) {} }
    if (/ie$/.test(base)) return base.slice(0, -2) + 'ying';
    if (/[^e]e$/.test(base) && !/ee$/.test(base)) return base.slice(0, -1) + 'ing';
    if (/^[^aeiou]*[aeiou][bdgklmnprt]$/.test(base) && !/w$|y$|x$/.test(base)) return base + base.slice(-1) + 'ing';
    return base + 'ing';
  }
  function participleOf(base) {
    if (IRR[base]) return IRR[base].en;
    const X = LEX(); if (X) { try { const f = X.inflect(base, 'v', 'en') || X.inflect(base, 'v', 'ed'); if (f) return f; } catch (e) {} }
    if (/e$/.test(base)) return base + 'd';
    if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ied';
    return base + 'ed';
  }
  function sOf(base) {
    if (base === 'be') return 'is'; if (base === 'have') return 'has'; if (base === 'do') return 'does'; if (base === 'go') return 'goes';
    const X = LEX(); if (X) { try { const f = X.inflect(base, 'v', 's'); if (f) return f; } catch (e) {} }
    if (/(s|x|z|ch|sh|o)$/.test(base)) return base + 'es';
    if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ies';
    return base + 's';
  }
  /* plural of a count noun; null where unsure */
  function pluralOf(w) {
    if (MASS.has(w) || PLURAL_ONLY.has(w) || SING_S.has(w)) return null;
    const X = LEX(); if (X) { try { const bs = X.bases(w); if (!bs.some(o => o.pos === 'n' && o.form === '')) return null; const f = X.inflect(w, 'n', 's'); if (f) return f; } catch (e) {} }
    else if (!COUNT.has(w)) return null;
    const irr = { child: 'children', man: 'men', woman: 'women', person: 'people', foot: 'feet', tooth: 'teeth', mouse: 'mice', life: 'lives', wife: 'wives', knife: 'knives', leaf: 'leaves', half: 'halves', hero: 'heroes', potato: 'potatoes', tomato: 'tomatoes', phenomenon: 'phenomena', criterion: 'criteria', analysis: 'analyses', thesis: 'theses', crisis: 'crises', basis: 'bases', city: 'cities', country: 'countries', family: 'families', study: 'studies', story: 'stories', baby: 'babies', party: 'parties', company: 'companies', university: 'universities', library: 'libraries', body: 'bodies', activity: 'activities', opportunity: 'opportunities', difficulty: 'difficulties', possibility: 'possibilities', facility: 'facilities', industry: 'industries', century: 'centuries', category: 'categories', theory: 'theories', memory: 'memories' };
    if (irr[w]) return irr[w];
    if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
    return w + 's';
  }
  function isSingCount(w) {
    if (MASS.has(w) || PLURAL_ONLY.has(w) || SING_S.has(w) || /s$/.test(w)) return false;
    const X = LEX(); if (X) { try { const bs = X.bases(w); return bs.some(o => o.pos === 'n' && o.form === '') && !bs.some(o => o.pos === 'a' && o.form === '') && COUNT.has(w) || (COUNT.has(w)); } catch (e) {} }
    return COUNT.has(w);
  }
  function isAdj(w) {
    if (ADJ_SURE.has(w)) return true;
    const X = LEX(); if (X) { try { const bs = X.bases(w); return bs.some(o => o.pos === 'a' && o.form === '') && !bs.some(o => o.pos === 'n' && o.form === ''); } catch (e) {} }
    return false;
  }
  const VOWEL_SOUND = /^(?:[aeio]|u(?!ni|se|su|ra|ro|ti|ku|bi|ser|sual|tilit|nique|nit|niform|nion|niver|tens|topia)|hour|honest|honou?r|heir|8|11|18)/i;
  const art = w => VOWEL_SOUND.test(w) ? 'an' : 'a';

  /* ---- the families ---- */
  const R = [];
  const push = (out, s, e, orig, fix, why, fam) => { if (fix !== orig) out.push({ start: s, end: e, orig: orig, fix: fix, why: why, cat: 'g', fam: fam }); };
  /* the fix filled from the match ("$1 on"); a function fix is given the match's parts */
  const expand = (fix, m) => typeof fix === 'function' ? fix.apply(null, m) : fix.replace(/\$(\d)/g, (x, n) => m[+n] || '');

  /* 1. a preposition that lost its last word: "in spite all" */
  const FIXED = [
    [/\bin spite (?!of\b)(?=(?:the|all|this|that|these|those|my|our|your|their|his|her|its|everything|it|them|him|her|us|me|what|a|an|[a-z]+ing)\b)/gi, 'in spite of', '“In spite” takes “of”: “in spite of the rain”'],
    [/\bin front (?!of\b)(?=(?:the|a|an|this|that|my|our|your|their|his|her|its|me|us|him|them|everyone|everybody)\b)/gi, 'in front of', '“In front” takes “of”: “in front of the house”'],
    [/\bin order (?!to\b|that\b|for\b|of\b)(?=(?:[a-z]+)\b)/gi, 'in order to', '“In order” takes “to”: “in order to learn”'],
    [/\b([Aa]ccording) (?!to\b)(?=(?:the|a|an|this|that|my|our|your|their|his|her|its|me|us|him|them|what|some|most|many|recent|[A-Z][a-z]+)\b)/g, '$1 to', '“According” takes “to”: “according to the report”'],
    [/\b(depend(?:s|ed|ing)?) (?!on\b|upon\b)(?=(?:the|a|an|this|that|my|our|your|their|his|her|its|what|how|whether|where|who|which|when|it|them|him|her|us|me|you|each|every|many|several|some)\b)/gi, '$1 on', '“Depend” takes “on”: “it depends on the weather”'],
    [/\b(listen(?:s|ed|ing)?) (?!to\b)(?=(?:the|a|an|this|that|my|our|your|their|his|her|its|music|him|her|them|me|us|it|what|everything|people|everyone)\b)/gi, '$1 to', '“Listen” takes “to”: “listen to music”'],
    [/\binstead (?!of\b)(?=(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its)\b)/gi, 'instead of', '“Instead” takes “of” before what is replaced: “instead of the car”'],
    [/\b(one|some|most|many|each|none|several|few) (?=(?:them|us|these|those|my|our|your|their|his|her|its)\b)/gi, '$1 of', '“One of them”, “some of these”: the quantity takes “of”'],
    [/\b(percent|per cent) (?=(?:the|people|students|children|women|men|adults|teachers|respondents|participants|them|us|those|these|our|their|all|its|his|her)\b)/gi, '$1 of', '“Percent” takes “of”: “85 percent of people”'],
    [/\b(provid(?:e|es|ed|ing)) (you|us|them|me|him|her|people|students|children|customers|users|readers|everyone|everybody|anyone) (?!with\b)(?=(?:a|an|the|more|some|many|much|everything|all|enough|great|good|new|better|free|useful|valuable|important)\b)/gi, '$1 $2 with', '“Provide someone with something”'],
    [/\bpay(s|ed|ing)? attention (?!to\b)(?=(?:the|a|an|this|that|my|our|your|their|his|her|its|what|him|her|them|me|us|it|how|every|each|detail|details)\b)/gi, 'pay$1 attention to', '“Pay attention” takes “to”'],
    [/\b(arriv(?:e|es|ed|ing)) (?!at\b|in\b|on\b|to\b|home\b|here\b|there\b|late\b|early\b|safely\b|soon\b|first\b|last\b|together\b|back\b|by\b|from\b|with\b|before\b|after\b|just\b|only\b|and\b|or\b|but\b|yesterday\b|today\b|tomorrow\b|every\b|each\b|this\b|that\b|next\b)(?=(?:the|a|an|school|work|university|college|hospital|church|London|Paris|Rome|Madrid|Berlin|Tokyo|Cairo|Lima)\b)/gi, '$1 at', '“Arrive at” a place (“arrive in” a city or country)'],   /* not before my, his, their: "When I arrived my uncle was waiting" wants a comma */
    [/\b(wait(?:s|ed|ing)?) (?!for\b|until\b|till\b|a\b|an\b|the\b|here\b|there\b|and\b|or\b|but\b|to\b|in\b|at\b|on\b|with\b|by\b|outside\b|inside\b|outside\b|patiently\b|long\b|longer\b|too\b|so\b|before\b|after\b|while\b|some\b|any\b|more\b|two\b|three\b|five\b|ten\b|one\b|half\b|several\b|until\b|forever\b|awhile\b|up\b|out\b)(?=(?:me|us|him|her|them|you|it|my|our|your|their|his|its|the)\b)/gi, '$1 for', '“Wait for” someone or something'],
    [/\b(belong(?:s|ed|ing)?) (?!to\b|with\b|in\b|here\b|there\b|together\b|anywhere\b|somewhere\b|nowhere\b|elsewhere\b|and\b|or\b|but\b|on\b|at\b|among\b|amongst\b|only\b|also\b|still\b|now\b|then\b|more\b|less\b|not\b|no\b|either\b|neither\b|both\b|exclusively\b|entirely\b|wholly\b|rightfully\b|properly\b|really\b|truly\b|always\b|never\b|where\b)(?=(?:me|us|him|her|them|you|it|my|our|your|their|his|its|the|a|an|this|that|these|those|someone|somebody|everyone|everybody|nobody|anyone|anybody)\b)/gi, '$1 to', '“Belong to”'],
  ];
  R.push(function fixedPreps(t, out) {
    /* each match ends with the space before the next word; the fix keeps it */
    for (const [re, fix, why] of FIXED) { let m; re.lastIndex = 0; while ((m = re.exec(t))) { const f = expand(fix, m) + (/\s$/.test(m[0]) ? m[0].slice(-1) : ''); if (f !== m[0]) push(out, m.index, m.index + m[0].length, m[0], caseLike(m[0], f), why, 'prep'); } }
  });

  /* 2. the wrong dependent preposition */
  const WRONG = [
    [/\binterested (on|about|at|for)\b(?!\s+(?:the )?(?:sake|benefit|purpose|reason|moment|all|now|once|first|last|least|most)\b)/gi, 'interested in', '“Interested in”'],
    [/\b(good|bad|better|worse|excellent|brilliant|terrible|hopeless|skilled|skilful|skillful|clever|talented|gifted) (in|on) (?=(?:maths|math|mathematics|english|french|spanish|german|science|sport|sports|football|tennis|chess|music|art|drawing|painting|singing|dancing|cooking|writing|reading|speaking|listening|languages|numbers|business|everything|this|that|it|them)\b)/gi, '$1 at ', '“Good at” a skill or a subject'],
    [/\bafraid (from|about) /gi, 'afraid of ', '“Afraid of”'],
    [/\b(depend(?:s|ed|ing)?) (of|from|to|in) /gi, '$1 on ', '“Depend on”'],
    [/\b(consist(?:s|ed|ing)?) (in|from|by|on) (?=(?:two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|several|many|various|different|numerous|multiple|\d+)\b)/gi, '$1 of ', '“Consist of” (“consist in” means “lie in”: “the problem consists in …”)'],
    [/\bmarried with (?=(?:a|an|the|my|his|her|their|our|your) (?!(?:child|children|kid|kids|son|sons|daughter|daughters|baby|babies|family|one|two|three|four|five|six|no|lots|many|several|twins)\b)[a-z]|(?:him|her|someone|somebody)\b|[A-Z][a-z])/g, 'married to ', '“Married to” a person (“married with children”)'],
    [/\bsimilar (with|than|as) /gi, 'similar to ', '“Similar to”'],
    [/\bcapable to ([a-z]+)\b/gi, (m, v) => isBaseVerb(v.toLowerCase()) ? 'capable of ' + ingOf(v.toLowerCase()) : m, '“Capable of” doing: “capable of making”'],
    [/\bresponsible (?:of (?=(?:the|a|an|this|that|my|our|your|their|his|her|its|all|every|each|[a-z]+ing)\b)|to (?=[a-z]+ing\b))/gi, 'responsible for ', '“Responsible for” something (“responsible to” a person one answers to)'],
    [/\baware (about|for|on) /gi, 'aware of ', '“Aware of”'],
    [/\bfamous (of|by|about) /gi, 'famous for ', '“Famous for”'],
    [/\b(participat(?:e|es|ed|ing)) (to|on|at) /gi, '$1 in ', '“Participate in”'],
    [/\b(tak(?:e|es|en|ing)|took) part (of|at|to) /gi, '$1 part in ', '“Take part in”'],
    [/\b(tak(?:e|es|en|ing)|took) care (by|about|for) /gi, '$1 care of ', '“Take care of”'],
    [/\bcommitted with\b/gi, 'committed to', '“Committed to”'],
    [/\b(discuss(?:es|ed|ing)?) about (?=(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its|it|them|how|what|whether|why|where|who|which|some|many|several|various|[a-z]+ing)\b)/gi, '$1 ', '“Discuss” takes no “about”: “discuss the plan”'],
    [/\b(mention(?:s|ed|ing)?) about (?=(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its|it|them|how|what|whether|why|where|who|which|some|many|several|various)\b)/gi, '$1 ', '“Mention” takes no “about”: “mention the plan”'],
    [/\b(enter(?:s|ed|ing)?) (?:into|in|to) (?=(?:the|a|an|this|that|my|our|your|their|his|her|its) (?:room|house|building|hall|city|town|village|office|school|university|college|church|shop|store|restaurant|hotel|kitchen|garden|park|country|market|competition|contest|race|war|world|stage|classroom|library|bank|museum|hospital)s?\b)/gi, '$1 ', '“Enter” takes no preposition: “enter the room”'],
    [/\b(reach(?:es|ed|ing)?) (?:to|at) (?=(?:the|a|an|this|that|my|our|your|their|his|her|its|them|us|him|her|me|you|it|home|London|Paris)\b)/gi, '$1 ', '“Reach” takes no preposition: “reach the station”'],
    [/\b(in|at) the internet\b/gi, 'on the internet', '“On the internet”'],
    [/\b(adverts?|advertisements?|programmes?|programs?|shows?|news|films?|movies?|sports?|football|matches|match|interviews?|watch(?:ed|es|ing)?|see|saw|seen|appear(?:ed|s|ing)?|shown|broadcast|live|was|were|is|are|be|it) (in|at) (tv|television)\b/gi, '$1 on $3', '“On TV”'],
    [/\b(in|at) the radio\b/gi, 'on the radio', '“On the radio”'],
    [/\b(in|on) the (weekend|weekends)\b/gi, 'at the $2', '“At the weekend”'],
    [/\b(on|at) the (morning|afternoon|evening)\b/gi, 'in the $2', '“In the morning”, “in the afternoon”, “in the evening”'],
    [/\b(in|on) (night|midnight|noon|midday|dawn|dusk|sunrise|sunset|lunchtime|the moment)\b(?!\s+(?:of|time|shift|club|sky|school|bus|flight|train|life|vision|air|mode|light|hours|owl|out|before|after))/gi, 'at $2', '“At night”, “at noon”, “at the moment”'],
    [/\b(in|on) present\b(?=\s*[,.;:!?]|\s+(?:the|there|it|we|i|you|they|he|she|people|many|most|some|this|these|our|my)\b)/gi, 'at present', '“At present”'],
    [/\b(in|at) (monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/gi, 'on $2', 'A day takes “on”: “on Monday”'],
    [/\b(at|on) (19|20)(\d\d)\b(?![-:\/]|\.\d|\s*(?:hours|hrs|h)\b)/g, 'in $2$3', 'A year takes “in”: “in 2019”'],
    [/\b(?:in|on) (home)\b(?!-)(?!\s+(?:care|office|page|pages|economics|team|teams|games?|grounds?|affairs|loans?|improvements?|cooking|décor|decor|furnishings|delivery|appliances|insurance|working|schooling|education|town|towns|country|countries|cities|city|and away|or away|rule|run|runs|video|videos|screen|screens|use|button|row|straight|stretch|front|turf|win|wins|shirt|kit|side|crowd|market|counties|county|secretary|visit|visits|help|helper|helpers|nursing|carer|carers|birth|births|owner|owners|ownership|comforts|cinema|computer|computers|automation|network|networks|life|address|town))/gi, 'at $1', '“At home”'],
    [/\bon (work|school|university|college|church)\b(?=\s*(?:[.,;:!?]|$)|\s+(?:and|or|but|all|every|with|on|at|in|by|for|because|so|yet|while|when|until|after|before|now|today|tomorrow|yesterday|tonight|this|that|last|next|than|too|as|since|I|we|you|they|he|she|it|there)\b)/gi, 'at $1', '“At work”, “at school”, “at university”'],
    [/\b(by|on|according to) my (opinion|point of view|view)\b/gi, 'in my $2', '“In my opinion”'],
    [/\baccording to me\b/gi, 'in my opinion', '“In my opinion”, not “according to me”'],
    [/\b(by|from|in|at) the one hand\b/gi, 'on the one hand', '“On the one hand”'],
    [/\b(by|from|in|at) the other hand\b/gi, 'on the other hand', '“On the other hand”'],
    [/\b(a|the|that|this|his|her|their|my|your|our) (smile|frown|grin|look|expression) in (my|your|his|her|their|our|the) face\b/gi, '$1 $2 on $3 face', '“A smile on your face”'],
    [/\b(is|are|was|were|be|been|being|film|films|movie|movies|story|stories|novel|novels|series|show|research|study|studies|work|argument|claim|decision|conclusion|theory|model|report|essay|play|plays|opera|musical|game|games|character|characters|plot) based in (?=(?:the|a|an|this|that|his|her|their|my|your|our|its) (?:true|real|same|following|original|famous|popular|latest|recent|previous|earlier|classic|own|first|second|third|idea|ideas|fact|facts|evidence|research|data|theory|theories|assumption|assumptions|belief|beliefs|principle|principles|premise|experience|experiences|findings|results|result|study|studies|analysis|work|works|life|lives|events|event|book|books|novel|novels|story|stories|film|films|movie|play|poem|legend|myth|history|report|survey|interview|interviews|observation|observations|opinion|opinions|values|needs|criteria|model|models|concept|notion|information|knowledge|science|logic|reason|truth|lie|lies|fiction|reality|teachings|writings|memoir|memoirs|diary|diaries|letters|comic|comics|cartoon|series|character|characters)\b|(?:fact|facts|evidence|real|true|research|data|what|how|science|reality|fiction|logic|reason|truth|lies|experience|history|trust|fear|love|evidence)\b)/gi, '$1 based on ', '“Based on” the evidence (“based in” a place)'],
    [/\b(go|goes|went|going|come|comes|came|coming|travel|travels|travelled|traveled|travelling|traveling|arrive|arrived|arrives|arriving|return|returned|returns|returning) (on|in|with) (car|bus|train|plane|bike|bicycle|taxi|boat|ship|tram|air|sea)\b(?!\s+(?:number|\d|that|which|and|or))/gi, '$1 by $3', 'A means of travel takes “by”: “by car”, “by train” (but “on foot”)'],
    [/\bby foot\b/gi, 'on foot', '“On foot”'],
    [/\b(in|at) (the )?(end|beginning|start) of (the|this|that|his|her|their|my|your|our|each|every|next|last) (day|week|month|year|term|semester|century|period|war|film|movie|story|book|chapter|lesson|class|course|match|game|journey|trip|holiday|meeting|session|morning|afternoon|evening|night|summer|winter|spring|autumn|season)\b/gi, 'at the $3 of $4 $5', '“At the end of the day”: a point in time takes “at” (“in the middle of” stays)'],
    [/\b(since|during) (many|several|few|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty|hundred|\d+) (years|months|weeks|days|hours|minutes|decades|centuries)\b(?!\s+(?:ago|of|now))/gi, 'for $2 $3', 'A length of time takes “for”: “for many years” (“since” names a starting point)'],
    [/\bin (nowadays|these days|today|yesterday|tomorrow|last (?:year|week|month|night|time|summer|winter)|next (?:year|week|month|time|summer|winter))\b(?!['’]s)/gi, '$1', '“Nowadays”, “these days”, “last year”: no preposition'],
    [/\b(in|on) the age of (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi, 'at the age of $2', '“At the age of ten”'],
    [/\b(example|examples|exemple) about\b/gi, '$1 of', '“An example of”'],
    [/\b(reason|reasons) of (?=(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its|such|[a-z]+ing)\b)/gi, '$1 for ', '“The reason for”'],
    [/\b(proof|evidence|sign|signs|symptom|symptoms) about\b/gi, '$1 of', '“Proof of”, “evidence of”'],
    [/\b(solution|solutions|answer|answers|key|admission) (into|of|about|on|at) (?=(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its|such|one|some|many|most|all|each|every)\b)/gi, '$1 to ', '“A solution to”, “the answer to”, “admission to”'],
    [/\b(solution|solutions|answer|answers|reply|replies|response|responses|objection|objections|alternative|alternatives) for (?=(?:the|this|that|these|those|my|our|your|their|his|her|its|such|one|some|many|most|all|each|every) (?:[a-z]+ )?(?:problem|problems|question|questions|issue|issues|crisis|crises|puzzle|puzzles|challenge|challenges|situation|dilemma|mystery|riddle|conflict|conflicts|difficulty|difficulties|matter|argument|arguments|objection|objections|proposal|proposals|request|requests|claim|claims|letter|letters|email|emails|message|messages|query|queries)\b)/gi, '$1 to ', '“A solution to the problem”, “an answer to the question”'],
  ];
  R.push(function wrongPreps(t, out) {
    for (const [re, fix, why] of WRONG) { let m; re.lastIndex = 0; while ((m = re.exec(t))) { const f = expand(fix, m); if (f !== m[0]) push(out, m.index, m.index + m[0].length, m[0], caseLike(m[0], f), why, 'prep'); } }
  });

  /* 3. a missing article: "is experienced person", "by Black person", "one of best" */
  R.push(function articles(t, out) {
    const ws = words(t);
    for (let i = 0; i + 1 < ws.length; i++) {
      const a = ws[i], b = ws[i + 1];
      if (gap(t, a, b)) continue;
      /* "one of best", "is same", "is best way" */
      if (/^(is|are|was|were|be|been|being|become|became|becomes|of)$/.test(a.l) && /^(best|worst|biggest|largest|smallest|greatest|highest|lowest|same|main|most important|first|last|only|next|following)$/.test(b.l) && (a.l !== 'of' || (i > 0 && /^(one|some|many|most|all|none|each|part|two|three|four|five)$/.test(ws[i - 1].l)))) {
        if (/^(first|last|only|next|following)$/.test(b.l)) { const c = ws[i + 2]; if (!c || gap(t, b, c) || !/^[a-z]/.test(c.w) || /^(to|of|in|on|at|for|and|or|but|time|one|place)$/.test(c.l)) continue; }
        push(out, b.s, b.s, '', 'the ', 'A superlative or an ordinal takes “the”: “the best way”, “one of the first”', 'det'); continue;
      }
      /* "is experienced person": be + adjective + singular count noun with no determiner */
      if (/^(is|are|was|were|be|been|being|become|became|becomes|as|such)$/.test(a.l)) {
        const c = ws[i + 2];
        if (/^[a-z]/.test(b.w) && isAdj(b.l) && c && !gap(t, b, c) && /^[a-z]/.test(c.w) && isSingCount(c.l)) {
          const d = ws[i + 3];
          if (d && !gap(t, c, d) && /^(of|who|that|which|in|for|with|on|at|from|to)$/.test(d.l) || !d || gap(t, c, d) || /^(and|or|but|who|that|which|because|so|with|for|in|at|on|to|from|of|as|than|like)$/.test(d.l)) {
            if (/^(such|as)$/.test(a.l) && !/^(such)$/.test(a.l)) continue;
            push(out, b.s, b.s, '', art(b.l) + ' ', 'A singular count noun takes an article: “is an experienced person”', 'det'); continue;
          }
        }
      }
      /* "by Black person", "in business setting": preposition + adjective + count noun */
      if (/^(by|with|for|in|at|on|into|as|like|through|without|about|from)$/.test(a.l)) {
        const c = ws[i + 2];
        if (/^[a-z]/.test(b.w) && isAdj(b.l) && !/^(such|other|own|more|less|most|least|many|few|several|various|different|same|next|last|first|second|third|whole|half|all|every|each|any|some|no)$/.test(b.l) && c && !gap(t, b, c) && /^[a-z]/.test(c.w) && isSingCount(c.l)) {
          const d = ws[i + 3];
          if (!d || gap(t, c, d) || /^(of|who|that|which|in|for|with|on|at|from|to|and|or|but|because|so|as|than|like|where|when)$/.test(d.l)) {
            push(out, b.s, b.s, '', art(b.l) + ' ', 'A singular count noun takes an article: “by a black person”, “in a business setting”', 'det');
          }
        }
      }
    }
  });

  /* 4. number: "many problem", "one of the reason", "much accidents", "amount of people" */
  const QUANT_PL = /^(many|several|few|various|numerous|multiple|different|both|these|those|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|hundreds|thousands|millions|dozens|countless)$/;
  /* what may follow the noun when it is the head of its phrase (not "two studio albums") */
  const AFTER_HEAD = /^(of|in|on|at|for|with|to|from|by|and|or|but|that|which|who|whom|whose|as|than|like|is|are|was|were|be|been|have|has|had|will|can|could|should|would|may|might|must|do|does|did|not|also|later|ago|after|before|since|until|when|where|while|if|because|so|then|there|here|each|every|per|a|an|the|this|these|those|more|less|very|too|quite|rather|just|only|even|still|yet|already|now|today|yesterday|tomorrow|again|ever|never|always|often|sometimes|usually|i|we|you|they|he|she|it|about|into|over|under|between|among|during|through|without|within|across|around|against|towards|toward)$/;
  /* a noun and nothing else, to the lexicon; the count list without it */
  function nounOnly(w) {
    const X = LEX(); if (X) { try { const bs = X.bases(w); return bs.some(o => o.pos === 'n' && o.form === '') && !bs.some(o => (o.pos === 'a' || o.pos === 'r') && o.form === '') && !bs.some(o => o.pos === 'v' && o.form === ''); } catch (e) {} }
    return COUNT.has(w) && !BASE_VERBS.has(w) && !ADJ_SURE.has(w);
  }
  R.push(function number(t, out) {
    const ws = words(t);
    for (let i = 0; i + 1 < ws.length; i++) {
      const a = ws[i], b = ws[i + 1];
      if (gap(t, a, b)) continue;
      /* "many money" */
      if (a.l === 'many' && MASS.has(b.l) && !PLURAL_ONLY.has(b.l) && /^[a-z]/.test(b.w) && !(ws[i + 2] && !gap(t, b, ws[i + 2]) && /^[a-z]+s$/.test(ws[i + 2].l))) { push(out, a.s, a.e, a.w, caseLike(a.w, 'much'), '“Much” before an uncountable noun: “much money”', 'num'); continue; }
      /* "many problem" */
      if (QUANT_PL.test(a.l) && /^[a-z]/.test(b.w) && !/s$/.test(b.l) && !/ing$/.test(b.l) && !/^(of|other|more|less|people|kind|sort|type|percent|hundred|thousand|million|billion|dozen|o|pm|am|per|cent)$/.test(b.l)) {
        if (/^(these|those)$/.test(a.l) && (MASS.has(b.l) || !COUNT.has(b.l))) continue;   /* "these data" */
        if (i > 0 && !gap(t, ws[i - 1], a) && /^(a|an|one|each|every|this|that|any|no|another|the|per)$/.test(ws[i - 1].l)) continue;   /* "a different country" */
        const c0 = ws[i + 2]; if (c0 && !gap(t, b, c0) && !AFTER_HEAD.test(c0.l)) continue;   /* "two studio albums": the noun before the head stays singular */
        if (a.l === 'both' && c0 && !gap(t, b, c0) && /^(and|or)$/.test(c0.l)) continue;   /* "both modernity and tradition" */
        if (!nounOnly(b.l)) continue;
        if (/^(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty)$/.test(a.l) && /^(year|month|week|day|hour|minute|mile|kilometre|kilometer|metre|meter|foot|inch|pound|dollar|euro|star|page|bedroom|storey|story|seat|door|wheel|person|man|woman)$/.test(b.l)) { const c = ws[i + 2]; if (c && !gap(t, b, c) && /^(old|long|high|wide|deep|tall|away|later|ago|drive|walk|journey|trip|hotel|building|house|flat|car|rating|limit|period|course|contract|plan|deal|sentence|wait|delay|visit|break|holiday|break)$/.test(c.l)) continue; }
        const pl = pluralOf(b.l);
        if (pl && pl !== b.l && !/^[A-Z]/.test(b.w)) push(out, b.s, b.e, b.w, pl, 'After “' + a.l + '” the noun is plural: “' + a.l + ' ' + pl + '”', 'num');
        continue;
      }
      /* "one of the reason", "one of my friend" */
      if (a.l === 'of' && i > 0 && /^(one|each|none|many|several|few|both|either|neither|two|three|four|five)$/.test(ws[i - 1].l) && /^(the|my|our|your|their|his|her|its|these|those)$/.test(b.l)) {
        const c = ws[i + 2]; if (!c || gap(t, b, c) || !/^[a-z]/.test(c.w)) continue;
        let n = c, d = ws[i + 3];
        if (d && !gap(t, c, d) && /^[a-z]/.test(d.w) && isAdj(c.l) && isSingCount(d.l)) n = d;
        if (isSingCount(n.l) && !/^(number|amount|majority|rest|part|half|lack|kind|type|sort|variety|range|series|group|pair|couple|list|set|best|worst|most|same|only|first|last|whole|top|bottom|end|beginning|middle|way|time|day|year|night|week|month|world|country|city|family|team|class|staff|public|government|population|audience|crowd|choice|choosing|own|life|career|kind|mind|heart|body|work|home)$/.test(n.l)) {
          const pl = pluralOf(n.l); if (pl) push(out, n.s, n.e, n.w, pl, '“One of” takes a plural: “one of the ' + pl + '”', 'num');
        }
        continue;
      }
      /* "much accidents", "many money" */
      if (a.l === 'much' && /^[a-z]/.test(b.w) && /s$/.test(b.l) && b.l.length > 4 && !MASS.has(b.l) && !SING_S.has(b.l) && !/(?:is|us|ss|as|os|ics|ness)$/.test(b.l) && !baseOfS(b.l) && !PLURAL_ONLY.has(b.l)) {
        const sg = b.l.replace(/ies$/, 'y').replace(/(s|x|z|ch|sh)es$/, '$1').replace(/s$/, '');
        if (LEX() ? pluralOf(sg) === b.l : sg.length > 2) push(out, a.s, a.e, a.w, caseLike(a.w, 'many'), '“Many” before a plural count noun: “many accidents”', 'num');
      }
      /* "a lots of" */
      if (a.l === 'a' && b.l === 'lots') push(out, b.s, b.e, b.w, 'lot', '“A lot of”, or “lots of”', 'num');
    }
  });

  /* 5. verb forms after a modal, an auxiliary, "to" and in a pair */
  const MODAL = /^(will|would|can|could|should|shall|may|might|must)$/;
  /* -ing words that are nouns, never a verb's form here */
  const NOUN_ING = /^(being|something|nothing|anything|everything|morning|evening|thing|king|ring|wing|spring|string|ceiling|building|wedding|clothing|housing|funding|farming|fishing|hunting|banking|marketing|accounting|engineering|nursing|gardening|camping|boxing|surfing|skiing|cycling|jogging|sibling|darling|pudding|herring|lightning|stocking|dumpling|duckling|during|training|warning|feeling|beginning|ending|setting|opening|meaning|evening)$/;
  const TO_INF = /^(way|ways|time|chance|chances|opportunity|ability|need|needs|needed|want|wants|wanted|decide|decides|decided|try|tries|tried|able|unable|going|how|where|what|when|hope|hopes|hoped|plan|plans|planned|like|likes|liked|love|loves|loved|have|has|had|order|easy|hard|difficult|possible|impossible|important|necessary|best|better|first|last|only|ready|willing|happy|glad|pleased|afraid|likely|unlikely|enough|too|offer|offered|promise|promised|refuse|refused|manage|managed|fail|failed|learn|learned|learnt|start|started|begin|began|continue|continued|seem|seems|seemed|appear|appears|appeared|tend|tends|tended|agree|agreed|expect|expected|intend|intended|wish|wished|prefer|preferred|choose|chose|aim|aims|aimed|allow|allowed|allows|help|helps|helped|encourage|encouraged|advise|advised|ask|asked|tell|told|teach|taught|suggest|suggested|recommend|recommended|invite|invited|remind|reminded|forget|forgot|remember|remembered|attempt|attempted|deserve|deserves|deserved|dare|dared|mean|meant)$/;
  R.push(function verbForms(t, out) {
    const ws = words(t);
    for (let i = 0; i + 1 < ws.length; i++) {
      const a = ws[i], b = ws[i + 1];
      if (gap(t, a, b)) continue;
      /* "will delighted", "can went", "should not went" */
      let k = i, m = a.l;
      if ((MODAL.test(m) && !(/^[A-Z]/.test(a.w) && !sentStart(t, a.s))) || (/^(not|n't|also|never|always|still|just|even|really|probably|only)$/.test(m) && i > 0 && MODAL.test(ws[i - 1].l) && !gap(t, ws[i - 1], a))) {
        if (/^[a-z]/.test(b.w) && !/^(be|have|been|not|also|never|always|still|just|even|really|probably|only|need|used|get|got|become)$/.test(b.l)) {
          const base = baseOfPast(b.l);
          if (base && base !== b.l && !/^(used|supposed|tired|interested|bored|excited|worried|married|concerned|involved|surprised|pleased|satisfied|disappointed|prepared|allowed|required|needed|expected|limited|based|related|located|situated|called|named|known|born|determined|committed|dedicated|devoted|educated|qualified|experienced|crowded|closed|open|opened|finished|done|gone|left|lost|broken)$/.test(b.l)) push(out, b.s, b.e, b.w, base, 'After “' + (MODAL.test(m) ? m : ws[i - 1].l) + '” the verb is in its base form: “' + (MODAL.test(m) ? m : ws[i - 1].l) + ' ' + base + '”', 'form');
        }
        continue;
      }
      /* "doesn't matters", "did went", "don't likes" */
      if (/^(do|does|did|don't|doesn't|didn't|don’t|doesn’t|didn’t)$/.test(a.l) || (/^(not|n't)$/.test(a.l) && i > 0 && /^(do|does|did)$/.test(ws[i - 1].l))) {
        const mainVerb = /^(do|does|did)$/.test(a.l) && i > 0 && !gap(t, ws[i - 1], a) && /^(to|can|could|will|would|should|shall|may|might|must|and|or|what|how|which|that|who|whom|all|things|something|anything|nothing|everything|well|much|more|less|also|still|always|never|really|just|only|ever|often|usually|sometimes|please)$/.test(ws[i - 1].l);
        if (/^[a-z]/.test(b.w) && !mainVerb && !/^(is|are|was|were|be|been|being|am|do|does|did|have|has|had|will|can|could|would|should|may|might|must|it|this|that|so|well|more|much|better|best|good|great|fine|right|wrong|nothing|something|anything|everything|all|some|many|most|this|these|those|the|a|an|my|our|your|their|his|her|its|their|one|two|three)$/.test(b.l)) {
          let base = baseOfS(b.l) || baseOfPast(b.l);
          /* after plain "do" an -s word that may be a noun is its object ("do sports"); after "doesn't" it is the verb */
          if (base && /s$/.test(b.l) && /^(do|does|did)$/.test(a.l)) { const X = LEX(); let noun = COUNT.has(base) || MASS.has(base); if (X) { try { noun = X.bases(b.l).some(o => o.pos === 'n'); } catch (e) {} } if (noun) base = null; }
          if (base && base !== b.l && !/^(used|need|needs|needed)$/.test(b.l) && !isBaseVerb(b.l)) push(out, b.s, b.e, b.w, base, 'After “do”, “does” or “did” the verb is in its base form: “doesn’t ' + base + '”', 'form');
        }
        continue;
      }
      /* "have went", "has take", "never speak" after have: an irregular verb's participle */
      if (/^(have|has|had|having|haven't|hasn't|hadn't|haven’t|hasn’t|hadn’t|'ve|'s|'d)$/.test(a.l) || (/^(not|never|already|just|also|always|ever|recently|still|even|only|yet)$/.test(a.l) && i > 0 && /^(have|has|had|having|haven't|hasn't|hadn't)$/.test(ws[i - 1].l) && !gap(t, ws[i - 1], a))) {
        const aux = /^(have|has|had|having|haven't|hasn't|hadn't|haven’t|hasn’t|hadn’t|'ve|'s|'d)$/.test(a.l) ? a.l : ws[i - 1].l;
        /* a question: "Have you ever saw" (never "have them take", the causative) */
        let b = ws[i + 1];
        if (/^(have|has|had)$/.test(a.l) && /^(you|we|they|i|he|she|it)$/.test(b.l) && (sentStart(t, a.s) || (i > 0 && /^(what|where|when|why|how|who|which)$/.test(ws[i - 1].l))) && i + 2 < ws.length && !gap(t, b, ws[i + 2])) {
          b = ws[i + 2];
          if (/^(ever|never|already|just|also|always|recently|still|even|only|yet|not)$/.test(b.l) && i + 3 < ws.length && !gap(t, b, ws[i + 3])) b = ws[i + 3];
        }
        if (IRR[b.l] && IRR[b.l].en !== b.l && !/^(have|be|do|get|got|read|put|cut|let|set|hit|hurt|shut|cost|quit|run|come|become)$/.test(b.l)) {
          const c = ws[ws.indexOf(b) + 1];
          if (b.l === 'go' && c && !gap(t, b, c) && /^(to|home|out|back|there|away)$/.test(c.l)) { push(out, b.s, b.e, b.w, 'gone', 'After “' + aux + '” the verb is a participle: “' + aux + ' gone”', 'form'); continue; }
          if (/^(see|take|give|eat|write|drive|speak|break|choose|forget|know|grow|fall|begin|drink|sing|swim|wear|throw|draw|fly|hide|bite|shake|rise|freeze|steal|wake|ride)$/.test(b.l)) push(out, b.s, b.e, b.w, IRR[b.l].en, 'After “' + aux + '” the verb is a participle: “' + aux + ' ' + IRR[b.l].en + '”', 'form');
        } else if (PAST_TO_BASE[b.l] && IRR[PAST_TO_BASE[b.l]].en !== b.l && /^(went|took|gave|ate|wrote|drove|spoke|broke|chose|forgot|knew|grew|fell|began|drank|sang|swam|wore|threw|drew|flew|hid|bit|shook|rose|froze|stole|woke|rode|saw|did|came|became|ran)$/.test(b.l)) {
          push(out, b.s, b.e, b.w, IRR[PAST_TO_BASE[b.l]].en, 'After “' + aux + '” the verb is a participle, not the past: “' + aux + ' ' + IRR[PAST_TO_BASE[b.l]].en + '”', 'form');
        }
        continue;
      }
      /* "a way to learning", "decided to going": to + -ing after a word that takes the infinitive */
      if (a.l === 'to' && i > 0 && TO_INF.test(ws[i - 1].l) && !gap(t, ws[i - 1], a) && /^[a-z]+ing$/.test(b.l) && b.l.length >= 5 && !NOUN_ING.test(b.l)) {
        const base = b.l.replace(/ing$/, ''); const X = LEX(); let ok = false;
        if (X) { try { const bs = X.bases(b.l); const v = bs.find(o => o.pos === 'v' && o.form === 'ing'); if (v && !bs.some(o => o.pos === 'n' && o.form === '')) { push(out, b.s, b.e, b.w, v.base, 'After “' + ws[i - 1].l + ' to” the verb is in its base form: “to ' + v.base + '”', 'form'); ok = true; } } catch (e) {} }
        if (!ok && !X) { const bb = /ying$/.test(b.l) ? null : (/([^aeiou])\1ing$/.test(b.l) ? b.l.slice(0, -4) : (BASE_VERBS.has(base + 'e') ? base + 'e' : (BASE_VERBS.has(base) ? base : null))); if (bb) push(out, b.s, b.e, b.w, bb, 'After “' + ws[i - 1].l + ' to” the verb is in its base form: “to ' + bb + '”', 'form'); }
        continue;
      }
      /* "interested to improve" */
      if (a.l === 'interested' && b.l === 'to') { const c = ws[i + 2]; if (c && !gap(t, b, c) && isBaseVerb(c.l)) push(out, b.s, c.e, t.slice(b.s, c.e), 'in ' + ingOf(c.l), '“Interested in” doing: “interested in improving”', 'form'); continue; }
      /* "I am interesting in" */
      if (/^(am|is|are|was|were|be|been|being|get|gets|got|getting|become|became|becomes|feel|feels|felt|seem|seems|seemed)$/.test(a.l) && /^(interesting|exciting|boring|surprising|confusing|satisfying|frustrating|disappointing|tiring|annoying|embarrassing|amusing|relaxing|shocking|terrifying|fascinating|depressing|exhausting|motivating|overwhelming)$/.test(b.l)) {
        const c = ws[i + 2];
        if (c && !gap(t, b, c) && /^(in|about|with|by|at|of|to)$/.test(c.l) && !(b.l === 'interesting' && c.l === 'to')) { const ed = b.l.replace(/ing$/, '') + (/(t|r|p|s|l|y)$/.test(b.l.replace(/ing$/, '')) ? 'ed' : 'ed'); const map = { interesting: 'interested', exciting: 'excited', boring: 'bored', surprising: 'surprised', confusing: 'confused', satisfying: 'satisfied', frustrating: 'frustrated', disappointing: 'disappointed', tiring: 'tired', annoying: 'annoyed', embarrassing: 'embarrassed', amusing: 'amused', relaxing: 'relaxed', shocking: 'shocked', terrifying: 'terrified', fascinating: 'fascinated', depressing: 'depressed', exhausting: 'exhausted', motivating: 'motivated', overwhelming: 'overwhelmed' }; push(out, b.s, b.e, b.w, map[b.l], 'The person is “' + map[b.l] + '”; the thing is “' + b.l + '”: “I am ' + map[b.l] + ' ' + c.l + '”', 'form'); }
        continue;
      }
    }
    /* pairs: "to mingle and meeting", "like reducing or take control" */
    for (let i = 0; i + 2 < ws.length; i++) {
      const a = ws[i], c = ws[i + 1], b = ws[i + 2];
      if (gap(t, a, c) || gap(t, c, b) || !/^(and|or)$/.test(c.l)) continue;
      if (i > 0 && ws[i - 1].l === 'to' && !gap(t, ws[i - 1], a) && isBaseVerb(a.l) && /^[a-z]+ing$/.test(b.l) && !NOUN_ING.test(b.l)) {
        const X = LEX(); let base = null;
        if (X) { try { const v = X.bases(b.l).find(o => o.pos === 'v' && o.form === 'ing'); if (v) base = v.base; } catch (e) {} } else { const s = b.l.replace(/ing$/, ''); base = BASE_VERBS.has(s) ? s : BASE_VERBS.has(s + 'e') ? s + 'e' : null; }
        if (base) push(out, b.s, b.e, b.w, base, 'Two verbs after “to” take the same form: “to ' + a.l + ' and ' + base + '”', 'form');
      }
      if (i > 0 && /^(by|like|of|for|without|about|before|after|while|when|enjoy|enjoys|enjoyed|avoid|avoids|avoided|keep|keeps|kept|stop|stops|stopped|start|started|finish|finished|suggest|suggested|recommend|recommended|consider|considered|mind|practise|practice)$/.test(ws[i - 1].l) && !gap(t, ws[i - 1], a) && /^[a-z]+ing$/.test(a.l) && isBaseVerb(b.l) && !/^(control|care|part|place|note|time|turn|shape|form|way|order|use|need|work|help|rest|risk|sense|charge|account|effect|action|advantage|interest|pride)$/.test(b.l)) {
        const d = ws[i + 3];
        if (d && !gap(t, b, d) && /^(the|a|an|their|his|her|our|my|your|its|some|more|care|control|part|notes|photos|pictures|time|advantage|place|turns|responsibility|charge|account|action|steps|measures|risks|chances|breaks|exercise|lessons|classes|courses|tests|exams|medicine|drugs|baths|showers|walks|trips|holidays|photographs)$/.test(d.l)) push(out, b.s, b.e, b.w, ingOf(b.l), 'Two verbs after “' + ws[i - 1].l + '” take the same form: “' + a.l + ' ' + c.l + ' ' + ingOf(b.l) + '”', 'form');
      }
    }
  });

  /* 6. agreement: a gerund, a country, a plural head before "of", "there are a", "X and Y was", a singular subject with a base verb */
  const COUNTRIES = new Set(('england scotland wales ireland britain france germany spain italy portugal greece turkey egypt china japan korea india pakistan bangladesh thailand vietnam indonesia malaysia singapore australia canada mexico brazil argentina chile peru colombia venezuela cuba russia ukraine poland sweden norway denmark finland iceland holland belgium austria switzerland hungary romania bulgaria serbia croatia israel iran iraq syria lebanon jordan morocco algeria tunisia libya nigeria kenya ethiopia ghana uganda tanzania zimbabwe zambia angola mozambique madagascar america europe asia africa london paris rome madrid berlin lisbon athens cairo tokyo beijing delhi mumbai bangkok sydney toronto chicago boston dublin edinburgh oxford cambridge manchester liverpool lima bogota santiago moscow warsaw vienna prague budapest stockholm oslo copenhagen helsinki amsterdam brussels zurich geneva istanbul tehran baghdad dubai riyadh nairobi lagos').split(' '));
  const HEAD_SING_OF = /^(number|amount|majority|rest|part|half|lack|kind|type|sort|variety|range|series|group|pair|couple|list|set|one|each|none|neither|either|percentage|proportion|quality|level|rate|cost|price|value|size|use|importance|role|idea|purpose|result|effect|impact|problem|issue|question|aim|goal|end|beginning|middle|top|bottom|side|way|state|condition|nature|future|history|study|analysis|review|summary|description|example|case|sense|feeling|possibility|chance|risk|danger|threat|benefit|advantage|disadvantage|point|fact|view|opinion|decision|choice|process|system|structure|form|shape|colour|color|name|title|position|place|time|day|year|month|week|moment|period|age|life|death|loss|growth|development|increase|decrease|rise|fall|change|difference|influence|power|control|freedom|right|duty|task|job|work|piece|bit|lot|deal|sum|total|balance|share|portion|majority|minority|generation|population|government|family|team|class|public|audience|crowd|committee|board|council|company|society|community|world|country|city|nation|state|economy|market|industry|sector|field|area|region|zone|centre|center|presence|absence|existence|evidence|information|knowledge|understanding|awareness|attention|interest|concern|support|help|love|fear|hope|belief|faith|trust|truth|meaning|language|music|art|literature|science|technology|research|education|health|safety|security|peace|war|violence|crime|poverty|wealth|money|energy|water|food|air|land|space|weather|climate|environment|nature|culture|tradition|religion|law|policy|strategy|plan|programme|program|project|scheme|design|model|theory|method|approach|technique|practice|experience|memory|dream|story|novel|film|book|play|song|poem|text|message|letter|email|report|essay|paper|article|chapter|page|line|word|sentence|phrase|term|concept|notion|category|version|edition|copy|image|picture|photo|map|table|figure|chart|graph|diagram|list|index|order|sequence|pattern|trend|movement|direction|speed|distance|length|width|height|depth|weight|volume|mass|temperature|pressure|force|strength|quantity|amount|degree|extent|limit|range|scale|standard|measure|unit|element|factor|feature|aspect|dimension|component|ingredient|material|substance|object|item|thing|matter|subject|topic|theme|focus|basis|foundation|source|origin|cause|reason|explanation|answer|solution|key|secret|mystery|puzzle|challenge|opportunity|possibility|option|alternative|exception|rule|principle|guideline|requirement|condition|term|agreement|contract|deal|offer|proposal|suggestion|recommendation|advice|instruction|direction|guidance|lesson|course|training|exercise|test|exam|assessment|evaluation|judgement|judgment|verdict|conclusion|outcome|consequence|implication|significance|relevance|importance|priority|emphasis|stress|burden|load|weight|responsibility|duty|obligation|commitment|promise|threat|warning|sign|signal|symbol|mark|trace|evidence|proof|clue|hint|indication|suggestion)$/;
  /* no "does", "let", "to" or a modal earlier in the clause (a question, a causative, an infinitive), and no copula just before */
  function plainClause(t, ws, i) {
    if (i > 0 && !gap(t, ws[i - 1], ws[i]) && /^(is|are|was|were|be|been|being|as|such|than)$/.test(ws[i - 1].l)) return false;
    for (let k = i - 1; k >= 0; k--) {
      if (/^(do|does|did|let|lets|make|makes|made|making|help|helps|helped|see|saw|seen|watch|watched|hear|heard|to|will|would|can|could|should|shall|may|might|must|why|how|what|where|when|who|whether|if)$/.test(ws[k].l)) return false;
      if (sentStart(t, ws[k].s) || /[.!?;:]/.test(t.slice(ws[k].e, ws[k + 1].s))) break;
    }
    return true;
  }
  R.push(function agreement(t, out) {
    const ws = words(t);
    for (let i = 0; i < ws.length; i++) {
      const a = ws[i];
      /* a gerund subject at the sentence's head: "Sharing rooms have" */
      if (sentStart(t, a.s) && /^[A-Z][a-z]+ing$/.test(a.w) && /^(sharing|learning|studying|living|working|travelling|traveling|reading|writing|playing|using|having|being|going|doing|making|taking|getting|spending|eating|driving|watching|listening|speaking|talking|walking|swimming|buying|selling|teaching|cooking|smoking|drinking|sleeping|exercising|training|moving|choosing|finding|keeping|helping|growing|building|seeing|knowing|giving|saying|thinking|meeting|visiting|owning|leaving|joining|winning|losing|paying|wearing|carrying|changing|protecting|reducing|increasing|improving|raising|lowering|cutting|adding|removing|solving|avoiding|preventing|creating|developing|planning|starting|stopping|staying|waiting)$/.test(a.l)) {
        for (let j = i + 1; j < Math.min(ws.length, i + 7); j++) {
          const v = ws[j]; if (gap(t, ws[j - 1], v)) break;
          if (/^(have|are|do|were)$/.test(v.l)) { const fix = { have: 'has', are: 'is', do: 'does', were: 'was' }[v.l]; push(out, v.s, v.e, v.w, fix, 'An -ing subject is singular: “' + a.w + ' … ' + fix + '”', 'agree'); break; }
          if (/^(is|has|does|was|and|or|but|that|which|who|when|if|because|while|,|can|could|will|would|should|may|might|must)$/.test(v.l) || /s$/.test(v.l) && !/^(ss|us|is)$/.test(v.l.slice(-2)) && j === i + 1 && false) break;
        }
        continue;
      }
      /* a country or a city with a plural verb: "New Zealand have" */
      if (/^[A-Z]/.test(a.w) && COUNTRIES.has(a.l) && i + 1 < ws.length && !gap(t, a, ws[i + 1]) && /^(have|are|do)$/.test(ws[i + 1].l) && !(i > 0 && /^(and|or|the|in|of|to|from|at|with|by|for|like|unlike|than|as)$/.test(ws[i - 1].l) && !gap(t, ws[i - 1], a))) {
        const v = ws[i + 1], fix = { have: 'has', are: 'is', do: 'does' }[v.l]; push(out, v.s, v.e, v.w, fix, 'A country is singular: “' + a.w + ' ' + fix + '”', 'agree'); continue;
      }
      /* "the chances of accident is", "the benefits of X is": a plural head noun before "of" */
      if (/^(the|these|those|many|several|both|all|some|most|few|various|numerous|different|our|their|my|your|his|her|its)$/.test(a.l) && i + 4 < ws.length) {
        const n = ws[i + 1];
        if (!gap(t, a, n) && /^[a-z]/.test(n.w) && /s$/.test(n.l) && !SING_S.has(n.l) && !HEAD_SING_OF.test(n.l) && pluralOf(n.l.replace(/ies$/, 'y').replace(/(s|x|z|ch|sh)es$/, '$1').replace(/s$/, '')) && ws[i + 2].l === 'of' && !gap(t, n, ws[i + 2])) {
          let j = i + 3; if (/^(the|a|an|this|that|these|those|my|our|your|their|his|her|its|using|being|having)$/.test(ws[j].l)) j++;
          if (j + 1 < ws.length && !gap(t, ws[j - 1], ws[j]) && !gap(t, ws[j], ws[j + 1])) {
            const v = ws[j + 1];
            if (/^(is|was|has|does)$/.test(v.l) && !/^(and|or)$/.test(ws[j].l)) { const fix = { is: 'are', was: 'were', has: 'have', does: 'do' }[v.l]; push(out, v.s, v.e, v.w, fix, 'The subject is “' + n.w + '”, a plural: “the ' + n.l + ' of … ' + fix + '”', 'agree'); continue; }
          }
        }
      }
      /* "there are a notice" */
      if (a.l === 'there' && i + 2 < ws.length && !gap(t, a, ws[i + 1]) && /^(are|were)$/.test(ws[i + 1].l) && /^(a|an|one)$/.test(ws[i + 2].l) && !gap(t, ws[i + 1], ws[i + 2])) {
        const c = ws[i + 3]; if (c && !gap(t, ws[i + 2], c) && /^(lot|lots|few|number|couple|variety|range|series|great|large|small|wide|huge|dozen|hundred|thousand|million|bit|handful|host|mass|multitude|plethora|total|lack|group|set|pair|bunch|pile|stack|load|loads|ton|tons|heap|heaps)$/.test(c.l)) continue;
        const v = ws[i + 1]; push(out, v.s, v.e, v.w, v.l === 'are' ? 'is' : 'was', '“There is” before a singular: “there is a notice”', 'agree'); continue;
      }
      /* "Michael and Kate was", "my best friends was" */
      if (/^(was|has|is|does)$/.test(a.l) && i >= 3 && !gap(t, ws[i - 1], a) && !gap(t, ws[i - 2], ws[i - 1]) && !gap(t, ws[i - 3], ws[i - 2]) && ws[i - 2].l === 'and' && /^[A-Z][a-z]+$/.test(ws[i - 1].w) && /^[A-Z][a-z]+$/.test(ws[i - 3].w) && !/^(he|she|it|i)$/i.test(ws[i - 1].l) && (i - 4 < 0 || /^(and|,|\.|but|while|when|because|so)$/.test(ws[i - 4].l) || gap(t, ws[i - 4], ws[i - 3]) || sentStart(t, ws[i - 3].s))) {
        const fix = { was: 'were', has: 'have', is: 'are', does: 'do' }[a.l]; push(out, a.s, a.e, a.w, fix, 'Two subjects joined by “and” take a plural verb: “' + ws[i - 3].w + ' and ' + ws[i - 1].w + ' ' + fix + '”', 'agree'); continue;
      }
      if (/^(was|has|is|does)$/.test(a.l) && i >= 2 && !gap(t, ws[i - 1], a) && !gap(t, ws[i - 2], ws[i - 1]) && /^[a-z]+s$/.test(ws[i - 1].w) && !SING_S.has(ws[i - 1].l) && !MASS.has(ws[i - 1].l) && pluralOf(ws[i - 1].l.replace(/ies$/, 'y').replace(/(s|x|z|ch|sh)es$/, '$1').replace(/s$/, '')) === ws[i - 1].l) {
        /* "my friends was", "my best friends was": a determiner, then perhaps one adjective, then the plural */
        const DETS = /^(my|our|your|their|his|her|its|these|those|many|several|both|all|some|few|various)$/;
        let d = ws[i - 2];
        if (!DETS.test(d.l) && i >= 3 && !gap(t, ws[i - 3], d) && (isAdj(d.l) || /^(best|worst|favourite|favorite|own|other|closest|oldest|youngest|main|only|two|three|four|five|first|last|new|old|good|bad|close|dear|real|true)$/.test(d.l)) && DETS.test(ws[i - 3].l)) d = ws[i - 3];
        const di = ws.indexOf(d); if (di > 0 && !gap(t, ws[di - 1], d) && /^(of|in|on|for|with|by|from|to|about|among|between|through|at|under|over|without|within|like|unlike|than|as|and|or)$|ing$/.test(ws[di - 1].l)) d = { l: '' };
        if (DETS.test(d.l)) { const fix = { was: 'were', has: 'have', is: 'are', does: 'do' }[a.l]; push(out, a.s, a.e, a.w, fix, 'A plural subject takes a plural verb: “' + d.l + ' … ' + ws[i - 1].l + ' ' + fix + '”', 'agree'); continue; }
      }
      /* "the government let each", "every Indian always follow", "it still control": a singular subject, then a base verb */
      if (/^(the|a|an|this|every|each|one|my|our|your|his|her|its)$/.test(a.l) && i + 2 < ws.length && !gap(t, a, ws[i + 1]) && plainClause(t, ws, i)) {
        /* "a technological development", "a business meeting": an adjective or a noun used as one before the head */
        const headNoun = w => isSingCount(w) || (HEAD_SING_OF.test(w) && !/s$/.test(w) && !BASE_VERBS.has(w));
        let j = i + 1; if (/^[a-z]/.test(ws[j].w) && (isAdj(ws[j].l) || /(?:ical|ological|ous|ful|less|ive|ional|ual|ental|ary|ish|ern|ese|ian|ic)$/.test(ws[j].l) || (COUNT.has(ws[j].l) && !BASE_VERBS.has(ws[j].l))) && j + 1 < ws.length && !gap(t, ws[j], ws[j + 1]) && /^[a-z]/.test(ws[j + 1].w) && headNoun(ws[j + 1].l)) j++;
        const n = ws[j]; if (!/^[a-z]/.test(n.w) && !(/^(every|each)$/.test(a.l) && /^(Indian|American|British|French|German|Chinese|Japanese|Spanish|Italian|European|African|Asian)$/.test(n.w))) continue;
        if (/^[a-z]/.test(n.w) && !isSingCount(n.l) && !(HEAD_SING_OF.test(n.l) && !ADJ_SURE.has(n.l))) continue;
        if (/s$/.test(n.l) && !SING_S.has(n.l)) continue;
        let k = j + 1; if (k >= ws.length || gap(t, n, ws[k])) continue;
        if (/^(always|never|often|usually|still|also|sometimes|already|just|only|even|really|now|then|rarely|seldom)$/.test(ws[k].l)) { k++; if (k >= ws.length || gap(t, ws[k - 1], ws[k])) continue; }
        const v = ws[k]; if (!/^[a-z]/.test(v.w) || !BASE_VERBS.has(v.l) || /^(be|have|do|need|dare|let|cost|cut|put|set|hit|hurt|shut|read)$/.test(v.l) && !/^(let|cost)$/.test(v.l)) continue;
        if (/^(be|have)$/.test(v.l)) continue;
        const d = ws[k + 1]; if (!d || gap(t, v, d) || !/^(the|a|an|this|that|these|those|my|our|your|their|his|her|its|each|every|all|some|many|much|more|less|no|any|people|us|them|him|her|me|you|it|to|that|what|how|whether|about|on|in|at|with|for|from|up|down|out|off|away|back|over|through|into|onto|not|well|very|more|less|freedom|money|time|place|rise|attention|pollution|problems|benefits|chance|sense|power|pressure|damage|harm|trouble|stress|shape|part|care|control|use|way|room|space|life|lives|food|water|energy|light|heat|noise|waste|jobs|work|money)$/.test(d.l)) continue;
        if (i > 0 && !gap(t, ws[i - 1], a) && /^(of|in|on|at|for|with|by|from|to|than|that|which|who|and|or|if|when|while|because|as|like|unlike)$/.test(ws[i - 1].l)) continue;   /* the noun belongs to an earlier phrase */
        push(out, v.s, v.e, v.w, sOf(v.l), 'A singular subject takes “-s” on the verb: “' + a.l + ' ' + n.l + ' ' + sOf(v.l) + '”', 'agree');
      }
    }
  });

  /* 7. capitals inside a sentence on words that take none; countries written as one word */
  const NO_CAP = /^(It|They|We|You|He|She|This|That|These|Those|There|Here|Also|But|And|Or|Because|Very|Really|Just|Only|Always|Never|Often|Sometimes|Usually|Still|Even|Not|Then|Now|Today|Yesterday|Tomorrow|Obvious|Obviously|Important|Possible|Impossible|Necessary|Easy|Hard|Difficult|Good|Bad|Big|Small|Great|Many|Much|More|Most|Less|Few|Some|Every|Each|All|Any|Other|Another|Same|Different|Such|Own|Whole|New|Old|Young|Long|Short|High|Low|Early|Late|Fast|Slow|Right|Wrong|True|False|Real|Sure|Able|Free|Full|Happy|Sad|Rich|Poor|Strong|Weak|Clear|Nice|Fine|Better|Best|Worse|Worst|Bigger|Biggest|Smaller|Smallest|Higher|Highest|Lower|Lowest|Longer|Longest|Shorter|Shortest|Later|Latest|Earlier|Earliest|Further|Faster|Slower|Harder|Easier|Cheaper|Older|Younger|Thing|Things|People|Person|Time|Times|Day|Days|Year|Years|Week|Weeks|Month|Months|Hour|Hours|Life|World|Way|Ways|Place|Places|Work|Job|Jobs|Money|Family|Friend|Friends|Home|House|School|University|College|City|Country|Water|Food|Car|Cars|Book|Books|Idea|Ideas|Problem|Problems|Question|Questions|Reason|Reasons|Example|Examples|Future|Past|Present|Society|Government|Education|Health|Environment|Technology|Science|History|Music|Sport|Sports|Internet|Computer|Computers|Phone|Phones|Television|Teacher|Teachers|Student|Students|Children|Child|Parents|Woman|Women|Man|Men|Boy|Girl|Doctor|Doctors|Mother|Father|Brother|Sister|Husband|Wife|Son|Daughter|Black|White|Red|Green|Blue|Yellow|Brown|Grey|Gray)$/;
  const GLUED = { newzealand: 'New Zealand', unitedstates: 'United States', unitedkingdom: 'United Kingdom', southafrica: 'South Africa', hongkong: 'Hong Kong', newyork: 'New York', saudiarabia: 'Saudi Arabia', srilanka: 'Sri Lanka', costarica: 'Costa Rica', puertorico: 'Puerto Rico', losangeles: 'Los Angeles', sanfrancisco: 'San Francisco', southkorea: 'South Korea', northkorea: 'North Korea', newdelhi: 'New Delhi', greatbritain: 'Great Britain', northernireland: 'Northern Ireland', southamerica: 'South America', northamerica: 'North America', middleeast: 'Middle East', elsalvador: 'El Salvador', buenosaires: 'Buenos Aires', riodejaneiro: 'Rio de Janeiro', capetown: 'Cape Town', abudhabi: 'Abu Dhabi', kualalumpur: 'Kuala Lumpur', telaviv: 'Tel Aviv' };
  R.push(function capitals(t, out) {
    const ws = words(t);
    for (let i = 1; i < ws.length; i++) {
      const a = ws[i], p = ws[i - 1];
      if (GLUED[a.l]) { push(out, a.s, a.e, a.w, GLUED[a.l], 'Two words: “' + GLUED[a.l] + '”', 'orth'); continue; }
      if (!NO_CAP.test(a.w) || sentStart(t, a.s) || gap(t, p, a)) continue;
      if (!/^[a-z]/.test(p.w)) continue;                      /* after another capital it may be a name or a title */
      if (/^(mr|mrs|ms|dr|prof|st|mount|lake|river|new|north|south|east|west|the|of|de|von|van|le|la|du|des|el|al|bin|san|santa|saint|king|queen|prince|princess|lord|lady|sir|dame|president|professor|doctor|captain|general|uncle|aunt|black|white|red|green|blue)$/.test(p.l)) continue;
      const n = ws[i + 1]; if (n && !gap(t, a, n) && /^[A-Z]/.test(n.w) && !/^(I)$/.test(n.w)) continue;   /* "the Great Wall", "a New Year" */
      /* a title's small words: "Science and Technology", "House of Representatives", "Money in the Bank" */
      const SMALL = /^(and|or|of|for|in|on|at|to|the|a|an|by|with|from|de|del|der|von|van|et|&)$/;
      if (SMALL.test(p.l) && i >= 2 && !gap(t, ws[i - 2], p) && /^[A-Z]/.test(ws[i - 2].w) && !sentStart(t, ws[i - 2].s)) continue;
      let titled = false; for (let k = i + 1; k < Math.min(ws.length, i + 4); k++) { if (gap(t, ws[k - 1], ws[k])) break; if (SMALL.test(ws[k].l)) continue; if (/^[A-Z]/.test(ws[k].w) && ws[k].w !== 'I') titled = true; break; }
      if (titled) continue;
      if (/^(Black|White|Red|Green|Blue|Yellow|Brown|Grey|Gray)$/.test(a.w) && n && !gap(t, a, n) && /^(Sea|House|Death|Panther|Friday|Monday|Lives|Hat|Cross|Party|Paper|Book|Belt)$/.test(n.w)) continue;
      push(out, a.s, a.e, a.w, a.w.toLowerCase(), 'No capital inside a sentence: “' + p.l + ' ' + a.w.toLowerCase() + '”', 'orth');
    }
  });

  /* 8. frequent morphology slips */
  const MORPH = [
    [/\bnowaday\b/gi, 'nowadays', '“Nowadays”, always with its “s”'],
    [/\beveryday\b(?=\s*(?:[.,;:!?]|$|and\b|or\b|but\b|to\b|at\b|in\b|on\b|for\b|with\b|by\b|from\b|because\b|so\b|when\b|while\b|after\b|before\b|since\b|until\b|as\b|than\b|if\b|I\b|we\b|you\b|they\b|he\b|she\b|it\b|there\b|this\b|that\b|these\b|those\b|my\b|our\b|your\b|their\b|his\b|her\b|its\b|the\b|a\b|an\b|some\b|many\b|much\b|more\b|most\b|all\b|every\b|each\b|two\b|three\b|few\b|several\b|several\b|now\b|then\b|too\b|also\b|just\b|only\b|very\b|really\b|about\b|around\b|again\b|together\b|alone\b|outside\b|inside\b|here\b|there\b|home\b|[a-z]+ly\b|[a-z]+ing\b))/gi, 'every day', '“Every day” (two words) is when; “everyday” (one word) describes a thing: “everyday life”'],
    [/\ba lot of (peoples|childrens|mens|womens|informations|advices|homeworks|furnitures|equipments|knowledges|researches|moneys|foods|musics|traffics|works)\b/gi, (m, w) => 'a lot of ' + ({ peoples: 'people', childrens: 'children', mens: 'men', womens: 'women', informations: 'information', advices: 'advice', homeworks: 'homework', furnitures: 'furniture', equipments: 'equipment', knowledges: 'knowledge', researches: 'research', moneys: 'money', foods: 'food', musics: 'music', traffics: 'traffic', works: 'work' })[w.toLowerCase()], 'This noun has no plural “s”'],
    [/\b(good|bad|close|strong|special|long|working|personal|romantic|loving|healthy|happy|difficult|complicated) relation (with|between)\b/gi, '$1 relationship $2', '“Relationship” between people; “relation” is the connection between things'],
    [/\b(am|is|are|was|were|be|been|being) agree\b/gi, '$1 in agreement', '“Agree” is a verb: “I agree”, or “I am in agreement”'],
    [/\bmore (easy|hard|cheap|fast|slow|big|small|large|great|high|low|long|short|strong|weak|old|young|rich|poor|happy|safe|clean|warm|cold|hot|dark|light|late|early|near|far|wide|deep|thick|thin|quick|loud|soft|tall|nice|busy|funny|lucky|lazy|pretty|easy|heavy|simple|narrow|clever|gentle|quiet|cheap)\b(?!\s+(?:to|than|and|or|for|with|about)\b.*\bthan\b)/gi, (m, a) => 'more ' + a, null],
  ];
  const CMP = { easy: 'easier', hard: 'harder', cheap: 'cheaper', fast: 'faster', slow: 'slower', big: 'bigger', small: 'smaller', large: 'larger', great: 'greater', high: 'higher', low: 'lower', long: 'longer', short: 'shorter', strong: 'stronger', weak: 'weaker', old: 'older', young: 'younger', rich: 'richer', poor: 'poorer', happy: 'happier', safe: 'safer', clean: 'cleaner', warm: 'warmer', cold: 'colder', hot: 'hotter', dark: 'darker', light: 'lighter', late: 'later', early: 'earlier', near: 'nearer', far: 'further', wide: 'wider', deep: 'deeper', thick: 'thicker', thin: 'thinner', quick: 'quicker', loud: 'louder', soft: 'softer', tall: 'taller', nice: 'nicer', busy: 'busier', funny: 'funnier', lucky: 'luckier', lazy: 'lazier', pretty: 'prettier', heavy: 'heavier', simple: 'simpler', narrow: 'narrower', clever: 'cleverer', gentle: 'gentler', quiet: 'quieter' };
  R.push(function morph(t, out) {
    for (const [re, fix, why] of MORPH) {
      if (!why) continue;
      let m; re.lastIndex = 0;
      while ((m = re.exec(t))) { const f = expand(fix, m); if (f && f !== m[0]) push(out, m.index, m.index + m[0].length, m[0], caseLike(m[0], f), why, 'morph'); }
    }
    /* "more easy than" */
    const re = /\bmore (easy|hard|cheap|fast|slow|big|small|large|great|high|low|long|short|strong|weak|old|young|rich|poor|happy|safe|clean|warm|cold|hot|dark|light|late|early|near|far|wide|deep|thick|thin|quick|loud|soft|tall|nice|busy|funny|lucky|lazy|pretty|heavy|simple|narrow|clever|gentle|quiet) than\b/gi; let m;
    while ((m = re.exec(t))) push(out, m.index, m.index + m[0].length, m[0], caseLike(m[0], CMP[m[1].toLowerCase()] + ' than'), 'A short adjective takes “-er”: “' + CMP[m[1].toLowerCase()] + ' than”', 'morph');
  });

  function check(text) {
    const t = String(text || ''), out = [];
    for (const fam of R) { try { fam(t, out); } catch (e) { /* one family's fault never silences the rest */ } }
    /* one edit per place: the first family listed wins */
    out.sort((a, b) => a.start - b.start || a.end - b.end);
    const kept = []; for (const e of out) { if (kept.some(k => e.start < k.end && e.end > k.start || (e.start === e.end && k.start === e.start))) continue; kept.push(e); }
    return kept;
  }
  const api = { check: check, families: R.map(f => f.name), _: { baseOfPast, baseOfS, pluralOf, ingOf, participleOf, sOf, isSingCount, isAdj } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKGAPS = api;
})(typeof self !== 'undefined' ? self : this);
