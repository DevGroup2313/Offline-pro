/* Inkwell's learner-error checks (7.42): the mistakes most often made by
   people writing English as a second language, each written so that it
   fires only where the fix is certain. Measured on the Write & Improve
   learner essays (BEA-2019 development set, used for measurement only) with
   ERRANT, against correct Wikipedia text for false alarms; the numbers are
   in tools/grammar/README.md.
   Families (the "fam" of each note):
     sva     subject and verb agree ("he go" → "he goes"; "they was" → "they were")
     form    the verb's form ("can went" → "can go"; "enjoy to play" → "enjoy playing";
             "by use" → "by using"; "to went" → "to go")
     aux     a missing "am/is/are" ("I going" → "I am going"; "it very important")
     tense   a past marker with a present verb ("Yesterday I go" → "went")
     num     a noun's number ("many student" → "many students"; "every students")
     art     a missing or extra article in a fixed phrase ("in the future")
     prep    the preposition a word takes ("married with" → "married to")
     orth    words run together or split ("infront" → "in front")
     comma   a comma after a fronted clause or an opener; before "but"
   Every fix is a grammar note (cat "g") with a lesson key in its "why".
   Pure functions, shared with the test harness (tools/grammar). No lookbehind
   in any regular expression (Safari before 16.4). */
(function (root) {
  'use strict';
  const DATA = (typeof module !== 'undefined' && module.exports) ? require('./learner_data.js') : root.INKLRN_DATA;
  const lc = s => String(s == null ? '' : s).toLowerCase();
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const caseLike = (src, dst) => /^[A-Z]/.test(src) ? cap(dst) : dst;

  /* ---------- the word lists ---------- */
  const NOUN = new Map(), PLURAL = new Map(), NOUNV = new Set();   /* singular → plural, plural → singular; nouns as often verbs */
  String(DATA.NOUNS || '').split(' ').forEach(t => { if (!t) return; const vb = /\*$/.test(t); if (vb) t = t.slice(0, -1); const p = t.split('='); const s = p[0], pl = p[1] || s + 's'; NOUN.set(s, pl); PLURAL.set(pl, s); if (vb) { NOUNV.add(s); NOUNV.add(pl); } });
  const V = new Map();                                    /* base → {s, ing, ed, en} */
  const NOUNISH = new Set();                              /* verbs as often nouns ("work", "use") */
  const s3 = b => (b === 'have' ? 'has' : b === 'be' ? 'is' : b === 'do' ? 'does' : b === 'go' ? 'goes' : /(s|x|z|ch|sh|o)$/.test(b) ? b + 'es' : /[^aeiou]y$/.test(b) ? b.slice(0, -1) + 'ies' : b + 's');
  const regIng = w => /ie$/.test(w) ? w.slice(0, -2) + 'ying' : (/[^aeiouy]e$/.test(w) && !/(ee|ye|oe)$/.test(w)) ? w.slice(0, -1) + 'ing' : w + 'ing';
  const regEd = w => /e$/.test(w) ? w + 'd' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ied' : w + 'ed';
  String(DATA.VERBS || '').split(' ').forEach(t => {
    if (!t) return; const p = t.split('='); let b = p[0]; const star = /\*$/.test(b); if (star) b = b.slice(0, -1);
    if (star) NOUNISH.add(b);
    const ing = p[1] || regIng(b), ed = p[2] || regEd(b);
    V.set(b, { s: s3(b), ing: ing, ed: ed, en: ed });
  });
  /* the irregular verbs, by hand: base:ing:past:participle */
  const IRR = 'be:being:was:been have:having:had:had do:doing:did:done go:going:went:gone say:saying:said:said make:making:made:made get:getting:got:got see:seeing:saw:seen know:knowing:knew:known take:taking:took:taken come:coming:came:come think:thinking:thought:thought give:giving:gave:given find:finding:found:found tell:telling:told:told become:becoming:became:become leave:leaving:left:left feel:feeling:felt:felt put:putting:put:put bring:bringing:brought:brought begin:beginning:began:begun keep:keeping:kept:kept hold:holding:held:held write:writing:wrote:written stand:standing:stood:stood hear:hearing:heard:heard let:letting:let:let mean:meaning:meant:meant set:setting:set:set meet:meeting:met:met run:running:ran:run pay:paying:paid:paid sit:sitting:sat:sat speak:speaking:spoke:spoken lie:lying:lay:lain lead:leading:led:led read:reading:read:read grow:growing:grew:grown lose:losing:lost:lost fall:falling:fell:fallen send:sending:sent:sent build:building:built:built understand:understanding:understood:understood draw:drawing:drew:drawn break:breaking:broke:broken spend:spending:spent:spent cut:cutting:cut:cut rise:rising:rose:risen drive:driving:drove:driven buy:buying:bought:bought wear:wearing:wore:worn choose:choosing:chose:chosen eat:eating:ate:eaten fly:flying:flew:flown forget:forgetting:forgot:forgotten sing:singing:sang:sung sell:selling:sold:sold teach:teaching:taught:taught catch:catching:caught:caught fight:fighting:fought:fought throw:throwing:threw:thrown wake:waking:woke:woken win:winning:won:won hit:hitting:hit:hit shut:shutting:shut:shut cost:costing:cost:cost hurt:hurting:hurt:hurt swim:swimming:swam:swum drink:drinking:drank:drunk ring:ringing:rang:rung sleep:sleeping:slept:slept feed:feeding:fed:fed deal:dealing:dealt:dealt shake:shaking:shook:shaken steal:stealing:stole:stolen hide:hiding:hid:hidden bite:biting:bit:bitten ride:riding:rode:ridden blow:blowing:blew:blown freeze:freezing:froze:frozen forgive:forgiving:forgave:forgiven shoot:shooting:shot:shot strike:striking:struck:struck stick:sticking:stuck:stuck spread:spreading:spread:spread split:splitting:split:split seek:seeking:sought:sought lend:lending:lent:lent bend:bending:bent:bent light:lighting:lit:lit hang:hanging:hung:hung dig:digging:dug:dug bet:betting:bet:bet quit:quitting:quit:quit arise:arising:arose:arisen withdraw:withdrawing:withdrew:withdrawn overcome:overcoming:overcame:overcome undertake:undertaking:undertook:undertaken mistake:mistaking:mistook:mistaken beat:beating:beat:beaten bear:bearing:bore:borne tear:tearing:tore:torn swear:swearing:swore:sworn show:showing:showed:shown lay:laying:laid:laid upset:upsetting:upset:upset forbid:forbidding:forbade:forbidden sew:sewing:sewed:sewn sink:sinking:sank:sunk shrink:shrinking:shrank:shrunk stink:stinking:stank:stunk spring:springing:sprang:sprung spin:spinning:spun:spun sting:stinging:stung:stung swing:swinging:swung:swung cling:clinging:clung:clung fling:flinging:flung:flung slide:sliding:slid:slid bleed:bleeding:bled:bled breed:breeding:bred:bred flee:fleeing:fled:fled kneel:kneeling:knelt:knelt creep:creeping:crept:crept weep:weeping:wept:wept sweep:sweeping:swept:swept leap:leaping:leapt:leapt bind:binding:bound:bound grind:grinding:ground:ground wind:winding:wound:wound overtake:overtaking:overtook:overtaken oversee:overseeing:oversaw:overseen foresee:foreseeing:foresaw:foreseen rewrite:rewriting:rewrote:rewritten undo:undoing:undid:undone withhold:withholding:withheld:withheld uphold:upholding:upheld:upheld mislead:misleading:misled:misled misunderstand:misunderstanding:misunderstood:misunderstood awake:awaking:awoke:awoken learn:learning:learned:learned dream:dreaming:dreamed:dreamed burn:burning:burned:burned spell:spelling:spelled:spelled smell:smelling:smelled:smelled spoil:spoiling:spoiled:spoiled lean:leaning:leaned:leaned'.split(' ');
  for (const t of IRR) { const p = t.split(':'); V.set(p[0], { s: s3(p[0]), ing: p[1], ed: p[2], en: p[3], irr: true }); }
  /* any form → [base, form] */
  const FORM = new Map(), AMBIG = new Set();
  for (const [b] of V) FORM.set(b, [b, 'base']);
  for (const [b, f] of V) {
    const add = (w, k) => { if (!FORM.has(w)) FORM.set(w, [b, k]); else if (FORM.get(w)[0] !== b) AMBIG.add(w); };
    add(f.s, 's'); add(f.ing, 'ing'); add(f.ed, 'ed'); add(f.en, 'en');
    if (f.ed === b || f.en === b) AMBIG.add(b);                         /* read, put, cut: the past is the base */
  }
  FORM.set('am', ['be', 'am']); FORM.set('are', ['be', 'are']); FORM.set('were', ['be', 'were']); FORM.set('is', ['be', 's']); FORM.set('was', ['be', 'ed']);
  const ADJ = new Set(String(DATA.ADJS || '').split(' ').filter(Boolean));
  const verbOnly = b => V.has(b) && !NOUNISH.has(b) && !NOUN.has(b) && !AMBIG.has(b);
  /* verbs that plainly are verbs, for the places where a noun would read the same ("for review", "of mine") */
  const SURE_VERB = new Set('learn make do go see watch read write eat drive swim travel improve develop understand become get take give spend know meet speak teach listen choose decide create build solve reduce increase communicate participate achieve enjoy buy sell live practise practice prepare protect save avoid find lose win finish keep bring send receive pay earn grow cook clean wash try think say tell ask explain describe discuss compare analyse analyze consider apply join attend follow provide organise organize manage allow relax sing draw paint produce invest destroy kill argue complain smoke forget remember wait stay leave arrive enter begin continue carry choose collect connect convince correct deliver depend discover educate encourage establish examine expand explore express gain generate hire identify ignore imagine include inform introduce invite involve maintain mention obtain perform persuade prevent promote publish purchase reach realise realize recognise recognize recommend reflect remove repair replace require respond satisfy select serve settle solve suffer suggest survive teach tend throw treat wear wonder worry use study play work help change visit start open answer plan call walk talk'.split(' '));
  const sureVerb = b => SURE_VERB.has(b) && V.has(b);
  const INTRANS = new Set('learn swim sleep dance sing smoke relax die arrive leave wait go come live happen grow improve develop communicate participate succeed fail exist survive recover suffer disappear appear occur increase decrease rise fall begin stop continue finish eat drink read write cook clean'.split(' '));

  /* ---------- small lexicons ---------- */
  const MODAL = /^(can|could|will|would|shall|should|may|might|must|cannot|can't|won't|wouldn't|shouldn't|couldn't|mustn't|mightn't|'ll|'d|do|does|did|don't|doesn't|didn't|need|dare)$/i;
  const AUX_BE = /^(am|is|are|was|were|be|been|being|'m|'re|'s)$/i;
  const PREPS = /^(in|on|at|by|for|with|from|to|of|about|into|onto|over|under|through|during|without|within|after|before|since|until|till|between|among|against|towards|toward|across|along|around|behind|beyond|near|off|out|up|down|like|than|as|per|via|except|despite|regarding|concerning|upon|inside|outside|underneath|beside|besides|throughout)$/i;
  const SUBJ_PRON = /^(I|you|we|they|he|she|it)$/i;
  const OBJ_TAKER = /^(make|makes|made|making|find|finds|found|finding|consider|considers|considered|considering|keep|keeps|kept|keeping|think|thinks|thought|call|calls|called|get|gets|got|leave|leaves|left|see|sees|saw|believe|believes|believed|let|lets|help|helps|helped|watch|watched|hear|heard|feel|felt|have|has|had|want|wants|wanted|need|needs|needed|give|gives|gave|tell|tells|told|ask|asks|asked|show|shows|showed|teach|taught|bring|brought|take|takes|took|put|puts|send|sent|allow|allows|allowed|expect|expects|expected|enable|enables|enabled|encourage|encourages|encouraged|remind|reminds|reminded|force|forced|cause|causes|caused|deem|deemed|judge|judged|declare|declared|render|rendered|regard|regarded|prove|proved|know|knew|known|suppose|supposed|imagine|imagined|notice|noticed|love|loved|like|liked|hate|hated|prefer|preferred|enjoy|enjoyed|mind|minded|stop|stopped|appreciate|appreciated|describe|described|define|defined|accept|accepted|recognise|recognize|treat|treated)$/i;
  const CLAUSE_START = /^(and|but|so|because|that|when|if|while|as|then|now|also|still|always|usually|often|sometimes|never|which|who|where|whether|although|though|since|unless|until|after|before|once|whenever|maybe|perhaps|however|therefore|thus|yet|or|nor|how|why|what|today|yesterday|tomorrow|nowadays|here|there|finally|first|second|secondly|firstly|lastly|later|soon|again|even|just|only|really|actually|probably|definitely|certainly|obviously|clearly|unfortunately|fortunately|luckily|hopefully|personally|honestly|basically|generally|especially|otherwise|instead|moreover|furthermore|besides|anyway|meanwhile|afterwards|nevertheless|nonetheless|indeed|currently|recently|eventually)$/i;
  const PRED_ADJ = new Set('important good bad difficult easy hard possible impossible necessary true false clear obvious better worse interesting boring useful useless expensive cheap dangerous safe different similar common popular famous happy sad sure able afraid right wrong late early ready free full busy fun healthy unhealthy available normal natural essential helpful harmful beneficial convenient comfortable uncomfortable suitable appropriate acceptable reasonable responsible successful careful aware interested worried tired surprised excited pleased glad sorry proud lucky fine okay cheaper easier harder bigger smaller faster slower higher lower longer shorter stronger weaker older younger simpler nicer crucial vital effective efficient enough wonderful great terrible awful amazing beautiful ugly rich poor strange funny serious complicated simple complex perfect correct incorrect accurate strict fair unfair legal illegal real unreal relevant irrelevant practical typical rare unique huge tiny enormous small big large long short wide narrow deep hot cold warm cool dark bright quiet noisy loud clean dirty empty crowded alone together open closed broken dead alive angry hungry thirsty sick ill well'.split(' '));
  const UNCOUNTABLE_AFTER_MANY = /^(time|money|water|work|food|information|advice|research|knowledge|music|traffic|weather|news|furniture|equipment|progress|homework|luggage|stuff|fun|help|people|children|men|women|police|data|media|action|effort|controversy|choice|trouble|pressure|attention|experience|practice|use|change|noise|light|space|room|paper|stone|pain|hope|sleep|luck|air|fuel|success|love|fear|power|energy|interest|exercise|evidence|lamb|chicken|meat|fish|wine|beer|milk|coffee|tea|bread|rice|cheese|chocolate|sugar|salt|oil|gas|electricity|heat|cold|ice|snow|rain|wind|sand|soil|grass|hair|skin|blood|fruit|damage|support|waste|smoke|dust|wood|steel|iron|gold|silver|glass|plastic|cotton|wool|land|sea|sky|nature|culture|art|history|science|technology|language|grammar|vocabulary|literature|poetry|freedom|peace|war|violence|crime|justice|truth|beauty|health|wealth|happiness|safety|security|quality|quantity|speed|weight|height|length|width|depth|temperature|strength|courage|patience|confidence|intelligence|wisdom|growth|development|education|training|employment|unemployment|poverty|pollution|transport|transportation|travel|tourism|traffic|business|trade|industry|agriculture|leisure|entertainment|shopping|housing|accommodation|parking|advertising|marketing|respect|trust|faith|humour|humor|anger|stress|rubbish|garbage|trash|clothing|jewellery|jewelry|cash|software|hardware|content|feedback|input|output|access|permission|importance|percent)$/i;

  /* ---------- helpers ---------- */
  const W = /[A-Za-z]+(?:['’][a-z]+)?/g;
  function words(t) {
    const out = []; let m; W.lastIndex = 0;
    while ((m = W.exec(t))) out.push({ w: m[0], s: m.index, e: m.index + m[0].length });
    return out;
  }
  /* what sits between two words: "" for a space, else the punctuation */
  const gap = (t, a, b) => t.slice(a.e, b.s).replace(/\s+/g, '');
  function sentenceStart(t, i) { let j = i - 1; while (j >= 0 && /[ \t"“‘'(\[]/.test(t[j])) j--; return j < 0 || /[.!?\n]/.test(t[j]); }
  function note(ws, i, j, fix, why, fam) { return { start: ws[i].s, end: ws[j].e, orig: null, fix: fix, why: why, cat: 'g', fam: fam }; }
  function formOf(w) { return FORM.get(lc(w)) || null; }
  function baseVerb(w) { const f = formOf(w); return f && f[1] === 'base' ? f[0] : null; }
  function verbForm(b, k) { const f = V.get(b); return f ? (k === 'base' ? b : f[k]) : null; }
  function pluralOf(w) { const l = lc(w); return NOUN.get(l) || null; }
  function singularOf(w) { const l = lc(w); return PLURAL.get(l) || null; }
  /* the word before index i, skipping nothing: null at a boundary */
  function prev(ws, t, i) { if (i <= 0) return null; const g = gap(t, ws[i - 1], ws[i]); return g ? null : ws[i - 1]; }
  function next(ws, t, i) { if (i + 1 >= ws.length) return null; const g = gap(t, ws[i], ws[i + 1]); return g ? null : ws[i + 1]; }
  function prevAny(ws, i) { return i > 0 ? ws[i - 1] : null; }
  const isAdj = w => ADJ.has(lc(w)) || PRED_ADJ.has(lc(w));

  /* ---------- the families ---------- */
  /* subject and verb agree */
  function sva(t, ws, out) {
    for (let i = 0; i < ws.length - 1; i++) {
      const p = ws[i], q = next(ws, t, i); if (!q) continue;
      const pw = lc(p.w), qw = lc(q.w);
      const before = prev(ws, t, i), bw = before ? lc(before.w) : '';
      const subjOK = !before || !(OBJ_TAKER.test(bw) || PREPS.test(bw) || bw === 'to' || V.has(bw) || FORM.has(bw) && FORM.get(bw)[1] !== 'base' && !CLAUSE_START.test(bw));
      /* "suggested that he go": the subjunctive keeps the bare verb */
      const back = ws.slice(Math.max(0, i - 7), i).map(x => lc(x.w)).join(' ');
      const subjunctive = /\b(lest|if|unless)\s*$/.test(back) || /\b(suggest|suggests|suggested|recommend|recommends|recommended|demand|demands|demanded|insist|insists|insisted|propose|proposes|proposed|require|requires|required|request|requests|requested|ask|asks|asked|essential|important|necessary|vital|crucial|imperative|advise|advised|order|ordered|urge|urged) that\b/.test(back);
      /* 7.43: a question ("could she consider", "would it take") inverts
         subject and auxiliary; an adverb that can be a verb ("it further
         contributes") is followed by the real verb */
      const inverted = before && (MODAL.test(bw) || /^(have|has|had|am|is|are|was|were)$/.test(bw));
      const r1 = next(ws, t, i + 1), r1f = r1 ? formOf(lc(r1.w)) : null;
      const advBeforeVerb = /^(further|still|only|even|just|also|well|then|now|thus|therefore|never|always|often|rarely|seldom|alone)$/.test(qw) || (r1f && /^(s|ed)$/.test(r1f[1]) && !NOUN.has(lc(r1.w)) && !PLURAL.has(lc(r1.w)));
      /* he/she/it + base verb → -s ("he go" → "he goes") */
      if (/^(he|she|it)$/.test(pw) && subjOK && !inverted && !advBeforeVerb) {
        if (qw === 'have') { out.push(note(ws, i + 1, i + 1, 'has', 'Subject-verb agreement: he, she and it take "has"', 'sva')); continue; }
        if (qw === 'are') { out.push(note(ws, i + 1, i + 1, 'is', 'Subject-verb agreement: he, she and it take "is"', 'sva')); continue; }
        if (qw === 'were' && !/^(if|wish|though|as if|as though)$/.test(bw)) { out.push(note(ws, i + 1, i + 1, 'was', 'Subject-verb agreement: he, she and it take "was"', 'sva')); continue; }
        if (qw === "don't" || qw === "don’t") { out.push(note(ws, i + 1, i + 1, "doesn't", 'Subject-verb agreement: he, she and it take "doesn\'t"', 'sva')); continue; }
        const b = baseVerb(qw);
        if (b && !NOUNISH.has(b) && !AMBIG.has(qw) && !subjunctive && !/^(be|do|have)$/.test(b) && !NOUN.has(b)) {
          /* "Penny discovered it and it go to tell": in a sentence already in the past, the past form */
          const sb = t.lastIndexOf('.', p.s), sent = ws.filter(w => w.s > sb && w.e <= p.s).map(w => lc(w.w));
          const pastBefore = sent.some(w => /^(was|were|had|did)$/.test(w) || (FORM.has(w) && FORM.get(w)[1] === 'ed' && !AMBIG.has(w)));
          const presentBefore = sent.some(w => /^(is|are|am|has|does|do|today|now|nowadays|always|usually|often|every)$/.test(w) || (FORM.has(w) && FORM.get(w)[1] === 's' && !NOUN.has(w) && !PLURAL.has(w)));
          if (pastBefore && !presentBefore) out.push(note(ws, i + 1, i + 1, caseLike(q.w, verbForm(b, 'ed')), 'The sentence is set in the past, so the verb takes its past form', 'sva'));
          else out.push(note(ws, i + 1, i + 1, caseLike(q.w, verbForm(b, 's')), 'Subject-verb agreement: he, she and it take the verb with -s', 'sva'));
        }
        continue;
      }
      /* I/you/we/they + verb-s → base ("they wants" → "they want") */
      if (/^(i|you|we|they)$/.test(pw) && subjOK && !(before && bw === 'and') && !inverted) {
        if (qw === 'has') { out.push(note(ws, i + 1, i + 1, 'have', 'Subject-verb agreement: I, you, we and they take "have"', 'sva')); continue; }
        if (qw === 'is' && pw !== 'i') { out.push(note(ws, i + 1, i + 1, 'are', 'Subject-verb agreement: you, we and they take "are"', 'sva')); continue; }
        if (qw === 'is' && pw === 'i') { out.push(note(ws, i + 1, i + 1, 'am', 'Subject-verb agreement: "I am"', 'sva')); continue; }
        if (qw === 'are' && pw === 'i') { out.push(note(ws, i + 1, i + 1, 'am', 'Subject-verb agreement: "I am"', 'sva')); continue; }
        if (qw === 'was' && pw !== 'i') { out.push(note(ws, i + 1, i + 1, 'were', 'Subject-verb agreement: you, we and they take "were"', 'sva')); continue; }
        if (qw === "doesn't" || qw === "doesn’t") { out.push(note(ws, i + 1, i + 1, "don't", 'Subject-verb agreement: I, you, we and they take "don\'t"', 'sva')); continue; }
        const f = formOf(qw);
        if (f && f[1] === 's' && !AMBIG.has(qw) && !/^(be|do|have)$/.test(f[0]) && !NOUN.has(qw) && !PLURAL.has(qw)) out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'Subject-verb agreement: I, you, we and they take the verb without -s', 'sva'));
        continue;
      }
      /* everyone/everybody/nobody/someone + plural verb → singular */
      if (/^(everyone|everybody|nobody|somebody|someone|anybody|anyone|no one)$/.test(pw) && !(before && PREPS.test(bw)) && !/^(like|unlike|else)$/.test(qw)) {
        const map = { have: 'has', are: 'is', were: 'was', "don't": "doesn't", "don’t": "doesn’t", do: 'does' };
        if (map[qw]) { out.push(note(ws, i + 1, i + 1, map[qw], 'Subject-verb agreement: "everyone", "nobody" and "someone" are singular', 'sva')); continue; }
        const b = baseVerb(qw); if (b && !NOUNISH.has(b) && !NOUN.has(b) && !AMBIG.has(qw) && !subjunctive) out.push(note(ws, i + 1, i + 1, verbForm(b, 's'), 'Subject-verb agreement: "everyone", "nobody" and "someone" are singular', 'sva'));
        continue;
      }
      /* the students is → are; a student are → is */
      if (/^(the|these|those|many|some|most|all|both|two|three|four|five|six|seven|eight|nine|ten|several|few|our|my|their|his|her|its|your)$/.test(pw) && PLURAL.has(qw) && !NOUNV.has(qw) && /^[a-z]/.test(q.w)) {
        const r = next(ws, t, i + 1); if (!r) continue;
        const rw = lc(r.w);
        const map = { is: 'are', was: 'were', has: 'have', does: 'do', "doesn't": "don't", "doesn’t": "don’t" };
        const gerundSubj = before && ((FORM.has(bw) && FORM.get(bw)[1] === 'ing') || /ing$/.test(bw));
        /* 7.43: the noun phrase is the object of a verb ("to express her
           feelings does"), or inside "of the" ("the effect of the three
           sources is"): its noun is not the subject */
        const b2 = before ? prev(ws, t, i - 1) : null, b2w = b2 ? lc(b2.w) : '';
        const objectOf = before && (V.has(bw) || (FORM.has(bw) && !NOUN.has(bw)) || OBJ_TAKER.test(bw));
        const inPhrase = before && (PREPS.test(bw) || /^(one|each|every|either|neither|none|of|and|or)$/.test(bw) || gerundSubj || objectOf || (/^(the|these|those|my|our|their|his|her|its|your|two|three|four|five|six|seven|eight|nine|ten|several|many|some|most|all)$/.test(bw) && b2 && PREPS.test(b2w))) || (!before && /^(and|or)$/.test(lc((ws[i - 1] || {}).w || '')));
        if (map[rw] && !inPhrase) out.push(note(ws, i + 2, i + 2, map[rw], 'Subject-verb agreement: a plural subject takes the plural verb', 'sva'));
        continue;
      }
      if (/^(a|an|this|each|every|one|another)$/.test(pw) && NOUN.has(qw) && !NOUNV.has(qw)) {
        const r = next(ws, t, i + 1); if (!r) continue;
        const rw = lc(r.w);
        const map = { are: 'is', were: 'was', have: 'has', do: 'does', "don't": "doesn't", "don’t": "doesn’t" };
        /* 7.43: "what might this moment have felt like": a question;
           "scholars researching this topic have": the object of a verb;
           "if every victim were to": the subjunctive */
        const r2 = next(ws, t, i + 2);
        const subjv = rw === 'were' && ((r2 && lc(r2.w) === 'to') || ws.slice(Math.max(0, i - 4), i).some(x => /^(if|as|though|wish)$/i.test(x.w)));
        if (map[rw] && !subjv && !(before && (PREPS.test(bw) || bw === 'of' || MODAL.test(bw) || /ing$/.test(bw) || V.has(bw)))) out.push(note(ws, i + 2, i + 2, map[rw], 'Subject-verb agreement: a singular subject takes the singular verb', 'sva'));
        continue;
      }
      /* a plural noun opening the clause, then a verb with -s: "Books develops" → "develop" */
      /* 7.43: after "and" or "or" the noun closes a list ("literature,
         colleagues, and patients was"), after "what" it is a verb ("what
         matters is"), and a preposition earlier in the clause ("the trust
         between participants and scientists is") makes it its object */
      const clauseBack = (() => { const xs = []; for (let k = i - 1, n = 0; k >= 0 && n < 8; k--, n++) { if (!/^[-‑–]?$/.test(gap(t, ws[k], ws[k + 1]))) break; xs.push(lc(ws[k].w)); } return xs; })();
      const listEnd = /^(and|or|nor)$/.test(bw) || /^(what|whatever|which|who|whoever)$/.test(bw) || clauseBack.some(x => PREPS.test(x) && x !== 'to');
      const open = !listEnd && (!before || CLAUSE_START.test(bw) || sentenceStart(t, p.s));
      if (open && PLURAL.has(pw) && !NOUNV.has(pw) && !NOUN.has(pw) && !MODAL.test(qw) && !/\d\s*$/.test(t.slice(Math.max(0, p.s - 8), p.s)) && !(before && /^(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|several|few|many|some)$/.test(bw))) {
        const f = formOf(qw);
        if (f && f[1] === 's' && !AMBIG.has(qw) && !NOUN.has(qw) && !PLURAL.has(qw) && !/^(be|do|have)$/.test(f[0]) && !subjunctive) { out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'Subject-verb agreement: a plural subject takes the verb without -s', 'sva')); continue; }
        if (/^(is|was|has|does)$/.test(qw) && !/^(means|news|series|species|politics|economics|physics|mathematics|headquarters)$/.test(pw)) { out.push(note(ws, i + 1, i + 1, ({ is: 'are', was: 'were', has: 'have', does: 'do' })[qw], 'Subject-verb agreement: a plural subject takes the plural verb', 'sva')); continue; }
      }
      /* "the government let each state" → "lets": a singular noun after its determiner, then a bare verb */
      const COLLECTIVE = /^(family|team|government|staff|company|police|class|group|committee|crew|audience|public|band|couple|majority|minority|population|club|council|board|party|army|crowd|jury|management|generation|community|society|school|university|church|firm|press|media|navy|cabinet|department|office)$/;
      if (/^(the|this|that|my|our|their|his|her|its|your|a|an|each|every|another)$/.test(pw) && NOUN.has(qw) && !NOUNV.has(qw) && !MODAL.test(qw) && !COLLECTIVE.test(qw) && open && !(i > 1 && lc(ws[i - 1].w) === 'and')) {
        const r = next(ws, t, i + 1); if (!r) continue;
        const rw = lc(r.w), fr = formOf(rw);
        if (fr && fr[1] === 'base' && !AMBIG.has(rw) && !NOUN.has(rw) && !NOUNISH.has(fr[0]) && !/^(be|do|have)$/.test(fr[0]) && !subjunctive) {
          const r2 = next(ws, t, i + 2);
          /* "the people who live", "the price increase": only a verb plainly followed by its object or its end */
          if (r2 && !/^(the|a|an|this|that|these|those|my|our|their|his|her|its|your|it|them|him|her|us|me|you|more|less|many|much|some|any|no|all|every|each|to|up|out|off|down|away|back|not|very|really|so|too|well|also|still|always|never|often|usually|sometimes)$/i.test(r2.w)) continue;
          if (!r2 && !/[.!?,;:]/.test(t[r.e] || '')) continue;
          out.push(note(ws, i + 2, i + 2, caseLike(r.w, verbForm(fr[0], 's')), 'Subject-verb agreement: a singular subject takes the verb with -s', 'sva'));
        }
      }
    }
  }

  /* the verb's form */
  const GERUND_VERB = /^(enjoy|enjoys|enjoyed|avoid|avoids|avoided|finish|finishes|finished|keep|keeps|kept|mind|minds|minded|suggest|suggests|suggested|consider|considers|considered|practise|practice|practised|practiced|recommend|recommends|recommended|risk|risks|risked|imagine|imagines|imagined|dislike|dislikes|disliked|miss|misses|missed|deny|denies|denied|delay|delays|delayed|postpone|postpones|postponed|admit|admits|admitted|appreciate|appreciates|appreciated|involve|involves|involved|resist|resists|resisted|fancy|fancied|quit|quits)$/i;
  const INF_VERB = /^(want|wants|wanted|decide|decides|decided|hope|hopes|hoped|plan|plans|planned|expect|expects|expected|refuse|refuses|refused|manage|manages|managed|agree|agrees|agreed|afford|affords|afforded|fail|fails|failed|offer|offers|offered|promise|promises|promised|seem|seems|seemed|tend|tends|tended|intend|intends|intended|pretend|pretends|pretended|wish|wishes|wished)$/i;
  const INF_TAKER = /^(want|wants|wanted|need|needs|needed|have|has|had|able|unable|going|try|tries|tried|like|likes|liked|decide|decided|how|order|used|hope|hoped|plan|planned|love|hate|prefer|begin|began|start|started|continue|forgot|forget|allow|allowed|help|helped|is|are|was|were|be|seem|seems|seemed|go|goes|went|come|came|get|got|expect|expected|intend|manage|managed|learn|learned|refuse|refused|wish|wished|ready|happy|glad|easy|hard|difficult|possible|impossible|important|necessary|enough|time|way|chance|opportunity|ability)$/i;
  const PREP_ING = /^(by|without|before|after|of|for|about|in|on|at|from|into|instead of|despite|while|when|through|towards|toward|against|upon)$/i;
  function form(t, ws, out) {
    for (let i = 0; i < ws.length - 1; i++) {
      const p = ws[i], q = next(ws, t, i); if (!q) continue;
      const pw = lc(p.w), qw = lc(q.w), f = formOf(qw);
      /* 7.43: a capital mid-sentence is a name ("according to Said") */
      if (/^[A-Z]/.test(q.w) && !sentenceStart(t, q.s)) continue;
      /* 7.43: the noun "will" ("the will is", "a living will refers") */
      const bp = prev(ws, t, i), bpw = bp ? lc(bp.w) : '';
      const nounWill = /^(will|need)$/.test(pw) && bp && (/^(the|a|an|his|her|their|its|our|my|your|this|that|own|free|good|ill|living|political|general|divine|human|popular|strong|weak|and|or|of)$/.test(bpw) || isAdj(bpw));
      /* modal + verb-s / -ed / -ing → base ("can went" → "can go"; "did not went") */
      if (MODAL.test(pw) && !nounWill && f && f[1] !== 'base') {
        if (/^(ing|en)$/.test(f[1]) && /^(will|would|can|could|shall|should|may|might|must)$/.test(pw) === false && f[1] === 'en') continue;
        if (f[0] === 'be' && f[1] === 'ing') continue;                     /* "be being": left alone */
        if (f[1] === 'en' && /^(have|be)$/.test(f[0]) === false && /^(will|would|can|could|shall|should|may|might|must)$/.test(pw)) continue; /* "should taken": may be "should have taken"; left alone */
        if (f[1] === 'ing') continue;                                       /* "will going": may be "will be going"; left alone */
        if (/^(do|does|did|don't|doesn't|didn't)$/.test(pw) && f[0] === 'be') continue;
        if (f[1] === 'ed' && f[0] !== 'be' && (V.get(f[0]).irr || /^(do|does|did|don't|doesn't|didn't|can|could|will|would|shall|should|may|might|must|cannot|can't|won't|wouldn't|shouldn't|couldn't)$/.test(pw)) && !isAdj(qw) && !NOUN.has(qw)) {
          out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'After a modal or "did", the bare verb', 'form')); continue;
        }
        if (f[1] === 's' && !NOUN.has(qw) && !PLURAL.has(qw)) { out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'After a modal or "does", the bare verb', 'form')); continue; }
        continue;
      }
      /* "not" between a modal and the verb: "did not went" */
      if (pw === 'not' && f && f[1] === 'ed' && V.get(f[0]).irr && f[0] !== 'be') {
        const b2 = prev(ws, t, i); if (b2 && MODAL.test(lc(b2.w))) { out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'After a modal or "did", the bare verb', 'form')); continue; }
      }
      /* "to" + past (irregular) → base ("to went" → "to go"); "to" + verb-s */
      if (pw === 'to' && f) {
        const b2 = prev(ws, t, i);
        if (f[1] === 'base' && sureVerb(f[0]) && b2 && lc(b2.w) === 'forward') { const b3 = prev(ws, t, i - 1); if (b3 && /^look/i.test(b3.w)) { out.push(note(ws, i + 1, i + 1, verbForm(f[0], 'ing'), '"Look forward to" takes the -ing form', 'form')); continue; } }
        if (f[1] === 'ed' && V.get(f[0]).irr && f[0] !== 'be' && f[0] !== 'read' && !isAdj(qw) && !NOUN.has(qw)) { out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'After "to", the bare verb', 'form')); continue; }
        if (f[1] === 's' && verbOnly(f[0]) && !PLURAL.has(qw) && /^[a-z]/.test(q.w) && b2 && INF_TAKER.test(b2.w)) { out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'After "to", the bare verb', 'form')); continue; }
        if (f[1] === 'ing' && b2 && INF_VERB.test(lc(b2.w)) && !/^(look|looks|looked|forward|used|get|got|accustomed|object|objects|objected|admit|admits|admitted|confess|confessed|close|near|next|prior|due|committed|devoted|dedicated|addicted|opposed|reduced|led|limited|related|back|down|up|in addition|contribute|contributes|contributed|belong)$/i.test(lc(b2.w))) { out.push(note(ws, i + 1, i + 1, caseLike(q.w, f[0]), 'After "to", the bare verb', 'form')); continue; }
        continue;
      }
      /* enjoy to play → enjoy playing */
      if (GERUND_VERB.test(pw) && qw === 'to') {
        const r = next(ws, t, i + 1); if (!r) continue;
        const b0 = prev(ws, t, i); if (b0 && AUX_BE.test(b0.w)) continue;            /* "is considered to be": passive */
        /* 7.43: "are sometimes recommended to preserve", "factors suggested
           to contribute": a past form not right after its subject is a
           passive; "in practice to recognize": the noun */
        if (/ed$/.test(pw) && !(b0 && SUBJ_PRON.test(b0.w))) continue;
        if (b0 && (PREPS.test(b0.w) || /^(the|a|an|this|that|his|her|their|its|our|my|your|clinical|professional|common|good|best|standard|medical)$/i.test(b0.w))) continue;
        if (/^(be|have|do)$/i.test(r.w)) continue;
        const fr = formOf(lc(r.w));
        if (fr && fr[1] === 'base' && verbOnly(fr[0])) out.push({ start: q.s, end: r.e, fix: verbForm(fr[0], 'ing'), why: '"' + cap(pw.replace(/(e?s|ed)$/, '')) + '" takes the -ing form', cat: 'g', fam: 'form' });
        continue;
      }
      /* want going → want to go */
      if (INF_VERB.test(pw) && f && f[1] === 'ing' && sureVerb(f[0]) && !NOUN.has(qw) && /^[a-z]/.test(q.w)) {
        out.push(note(ws, i + 1, i + 1, 'to ' + f[0], '"' + cap(pw.replace(/(e?s|ed)$/, '')) + '" takes "to" and the bare verb', 'form')); continue;
      }
      /* by use → by using; interested in learn → learning; look forward to see → seeing */
      if (PREP_ING.test(pw) && qw === 'be' && /^(by|without|of|instead of|about|for|from|despite)$/.test(pw)) {
        const b2 = prev(ws, t, i), bw = b2 ? lc(b2.w) : '';
        if (!(pw === 'for' && /^(wait|waits|waited|waiting|ask|asks|asked|look|looks|looked|hope|hoped)$/.test(bw)))
          out.push(note(ws, i + 1, i + 1, 'being', 'After a preposition, the -ing form of the verb', 'form'));
        continue;
      }
      if (PREP_ING.test(pw) && f && f[1] === 'base' && sureVerb(f[0]) && /^[a-z]/.test(q.w) && f[0] !== 'be' && !/^(do|have|go)$/.test(f[0])) {
        const b2 = prev(ws, t, i), bw = b2 ? lc(b2.w) : '';
        const nx = next(ws, t, i + 1);
        const objNext = nx && (/^(the|a|an|my|our|their|his|her|its|your|this|that|these|those|it|them|him|us|me|you|some|any|more|new|good|all|every|each|such)$/i.test(nx.w) || (FORM.has(lc(nx.w)) && FORM.get(lc(nx.w))[1] === 'ing'));
        /* "for talk about", "time of travel", "a sense of wonder": a noun reads the same unless an
           object follows, or the verb is one that stands alone */
        if (!objNext && !INTRANS.has(f[0])) continue;
        if (pw === 'to') continue;
        if (pw === 'for' && /^(wait|waits|waited|waiting|ask|asks|asked|look|looks|looked|hope|hoped|apply|applied|search|pay|paid)$/.test(bw)) continue;
        if (pw === 'in' && /^(interested|succeed|succeeded|believe|believed|result|resulted|involved|engaged|good|bad|skilled|experienced)$/.test(bw) === false && !/^(order|case|spite)$/.test(qw)) { if (!b2 || !/^(is|are|was|were|be|been|being|am)$/.test(bw)) continue; }
        if (/^(on|at|about|from|into|through|towards|toward|against|upon|while|when)$/.test(pw) && !/^(keep|keeps|kept|carry|carried|go|goes|went|insist|insisted|depend|depends|depended|focus|focused|focuses|concentrate|concentrated|good|bad|excited|worried|think|thinks|thought|talk|talks|talked|learn|learned|dream|dreamed|prevent|prevented|stop|stopped|benefit|benefited|succeed|succeeded|succeeds|result|results|resulted|apart|aside)$/.test(bw)) continue;
        if (/^(before|after|while|when)$/.test(pw) && !(b2 && !/^(and|or|but|,|the)$/.test(bw))) continue;
        out.push(note(ws, i + 1, i + 1, caseLike(q.w, verbForm(f[0], 'ing')), 'After a preposition, the -ing form of the verb', 'form'));
        continue;
      }
      /* "I am agree" → "I agree"; "am/is/are + base verb (not be/do/have)" with a pronoun subject */
      if (/^(am|is|are)$/.test(pw) && /^(agree|agrees|disagree|disagrees)$/.test(qw)) {
        const b2 = prev(ws, t, i);
        if (b2 && SUBJ_PRON.test(b2.w)) out.push({ start: p.s, end: q.e, fix: lc(b2.w) === 'i' || /^(you|we|they)$/i.test(b2.w) ? qw.replace(/s$/, '') : (qw.endsWith('s') ? qw : qw + 's'), why: '"Agree" is a verb: "I agree", not "I am agree"', cat: 'g', fam: 'form' });
      }
    }
  }

  /* a missing am/is/are */
  function aux(t, ws, out) {
    for (let i = 0; i < ws.length - 1; i++) {
      const p = ws[i], q = next(ws, t, i); if (!q) continue;
      const pw = lc(p.w), qw = lc(q.w);
      if (!SUBJ_PRON.test(p.w)) continue;
      const before = prev(ws, t, i), bw = before ? lc(before.w) : '';
      const clauseStart = !before || CLAUSE_START.test(bw) || sentenceStart(t, p.s);
      if (!clauseStart) continue;
      const be = pw === 'i' ? 'am' : /^(he|she|it)$/.test(pw) ? 'is' : 'are';
      /* I going → I am going */
      const f = formOf(qw);
      if (f && f[1] === 'ing' && verbOnly(f[0]) && !NOUN.has(qw)) {
        const r = next(ws, t, i + 1);
        /* "they living there" could be a reduced clause only after a noun; after a clause start it is the main verb */
        out.push({ start: q.s, end: q.s, orig: '', fix: be + ' ', why: 'The -ing verb needs "' + be + '" before it', cat: 'g', fam: 'aux' });
        continue;
      }
      /* it very important → it is very important */
      let j = i + 1, adv = '';
      if (/^(very|really|so|too|quite|extremely|pretty|rather|not)$/.test(qw)) { const r = next(ws, t, i + 1); if (!r) continue; adv = qw; j = i + 2; }
      const a = ws[j]; if (!a) continue;
      const aw = lc(a.w);
      if (!PRED_ADJ.has(aw)) continue;
      if (j === i + 1 && !next(ws, t, i)) continue;
      const after = next(ws, t, j);
      /* the adjective must end the phrase: no noun after it ("it good idea" is another error) */
      if (after && !/^(to|that|for|than|because|and|but|so|if|when|as|in|at|on|with|about|enough|too|very|of|from|by|though|although|while|now|then|here|there|today|again|also|still|yet|only|just)$/i.test(after.w)) continue;
      if (bw === 'if' && pw === 'it') continue;
      out.push({ start: q.s, end: q.s, orig: '', fix: be + ' ', why: 'A sentence needs its verb: "' + p.w + ' ' + be + ' ' + (adv ? adv + ' ' : '') + aw + '"', cat: 'g', fam: 'aux' });
    }
  }

  /* a past marker with a present verb */
  const PAST_MARK = /\b(yesterday|last (?:night|week|month|year|summer|winter|spring|autumn|time|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)|(?:\d+|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|many|several|a few|few|some|a couple of) (?:minutes|hours|days|weeks|months|years|decades|centuries) ago|in (?:19\d\d|20[01]\d)|when i was (?:a child|a kid|young|little|small|a boy|a girl|a student|at school|in school|in high school|\d+)|ago)\b/i;
  function tense(t, ws, out) {
    /* "He had no money and they go home": the sentence is in the past before the verb */
    for (let i = 1; i < ws.length - 1; i++) {
      const p = ws[i], q = next(ws, t, i); if (!q) continue;
      if (!/^(i|we|they|you)$/i.test(p.w)) continue;
      const f = formOf(lc(q.w)); if (!f || f[1] !== 'base' || AMBIG.has(lc(q.w)) || NOUNISH.has(f[0]) || NOUN.has(lc(q.w)) || /^(be|do|have)$/.test(f[0])) continue;
      if (/^(think|know|believe|mean|hope|guess|suppose|remember|wish|want|need|like|love|hate|agree|understand|feel|seem|look|say|see)$/.test(f[0])) continue;
      /* 7.43: the present of argument ("I argue", "we offer", "they differ") */
      if (/^(argue|suggest|propose|offer|contend|claim|show|demonstrate|examine|explore|discuss|consider|focus|conclude|find|note|observe|maintain|hold|differ|overlook|attain|survive|expect|carry|culminate|begin|recall|talk|refer|use|follow|turn|return|read|write|define|treat|analyse|analyze|identify|describe|outline|distinguish|emphasise|emphasize)$/.test(f[0])) continue;
      const before = prev(ws, t, i), bw = before ? lc(before.w) : '';
      if (before && (OBJ_TAKER.test(bw) || PREPS.test(bw) || bw === 'to' || MODAL.test(bw) || AUX_BE.test(bw) || V.has(bw) || /^(lest|if|unless)$/.test(bw))) continue;
      const sb = Math.max(t.lastIndexOf('.', p.s), t.lastIndexOf('?', p.s), t.lastIndexOf('!', p.s), t.lastIndexOf('\n', p.s));
      const sent = ws.filter(w => w.s > sb && w.e <= p.s).map(w => lc(w.w));
      if (sent.length < 3) continue;
      /* 7.43: a past verb is a finite one: "was", "had", "did", or an -ed
         form right after its subject ("Penny discovered"); a participle
         ("as discussed above", "have entered", "played by") is not the past */
      const sw = ws.filter(w => w.s > sb && w.e <= p.s);
      const pastBefore = sw.some((w, k) => { const lw = lc(w.w); if (/^(was|were|had|did)$/.test(lw)) return true;
        if (!(FORM.has(lw) && FORM.get(lw)[1] === 'ed' && !AMBIG.has(lw) && !isAdj(lw))) return false;
        const pw0 = k > 0 ? sw[k - 1] : null; if (!pw0 || gap(t, pw0, w)) return false;
        const pl = lc(pw0.w), nx = sw[k + 1] ? lc(sw[k + 1].w) : '';
        return (SUBJ_PRON.test(pw0.w) || /^[A-Z]/.test(pw0.w) && !sentenceStart(t, pw0.s)) && !AUX_BE.test(pl) && !/^(have|has|had)$/.test(pl) && nx !== 'by'; });
      /* "have entered": the present perfect is the present */
      const perfect = sw.some((w, k) => /^(have|has)$/i.test(w.w) && sw[k + 1] && FORM.has(lc(sw[k + 1].w)) && /^(ed|en)$/.test(FORM.get(lc(sw[k + 1].w))[1]) || /^(have|has)$/i.test(w.w) && sw[k + 1] && lc(sw[k + 1].w) === 'been');
      const presentBefore = perfect || sent.some(w => /^(is|are|am|has|does|do|today|now|nowadays|always|usually|often|sometimes|every|will|can|if|would|could|should)$/.test(w) || (FORM.has(w) && FORM.get(w)[1] === 's' && !NOUN.has(w) && !PLURAL.has(w)));
      if (!pastBefore || presentBefore) continue;
      if ((t.slice(sb + 1, p.s).match(/["“]/g) || []).length % 2 === 1) continue;        /* inside speech */
      out.push({ start: q.s, end: q.e, fix: caseLike(q.w, verbForm(f[0], 'ed')), why: 'The sentence is set in the past, so the verb takes its past form', cat: 'g', fam: 'tense' });
    }
    const sentences = []; let s0 = 0;
    for (let i = 0; i <= t.length; i++) if (i === t.length || /[.!?\n]/.test(t[i])) { if (i > s0) sentences.push([s0, i]); s0 = i + 1; }
    for (const [a, b] of sentences) {
      const sent = t.slice(a, b);
      /* 7.43: a past marker inside a quotation does not set the sentence */
      if (!PAST_MARK.test(sent.replace(/["“][^"”]*["”]?/g, ' '))) continue;
      if (/\b(every|each|usually|always|often|sometimes|nowadays|today|now|still|these days)\b/i.test(sent)) continue;
      const sw = ws.filter(w => w.s >= a && w.e <= b);
      for (let i = 0; i < sw.length - 1; i++) {
        const p = sw[i], q = sw[i + 1]; if (gap(t, p, q)) continue;
        if (!SUBJ_PRON.test(p.w)) continue;
        const bw = i > 0 && !gap(t, sw[i - 1], p) ? lc(sw[i - 1].w) : '';
        if (bw && (OBJ_TAKER.test(bw) || PREPS.test(bw) || bw === 'to' || MODAL.test(bw) || AUX_BE.test(bw) || /^(lest|if|unless)$/.test(bw))) continue;
        const qw = lc(q.w), f = formOf(qw);
        if (!f || f[0] === 'be' || /^(have|do)$/.test(f[0])) continue;
        const pron = lc(p.w);
        const present = (f[1] === 'base' && /^(i|you|we|they)$/.test(pron)) || (f[1] === 's' && /^(he|she|it)$/.test(pron));
        if (!present || NOUNISH.has(f[0]) || NOUN.has(qw)) continue;
        if (/^(think|know|believe|mean|hope|guess|suppose|remember|wish|want|need|like|love|hate|agree|understand|feel|seem|look)$/.test(f[0])) continue; /* "I think it was" stays present */
        if ((t.slice(a, q.s).match(/["“”]/g) || []).length % 2 === 1) continue;  /* 7.43: inside a quotation */
        out.push({ start: q.s, end: q.e, fix: caseLike(q.w, verbForm(f[0], 'ed')), why: 'The sentence is set in the past ("' + (sent.match(PAST_MARK) || [''])[0] + '"), so the verb takes its past form', cat: 'g', fam: 'tense' });
      }
    }
  }

  /* a noun's number */
  const MANY = /^(many|several|few|these|those|both|various|numerous|multiple|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|thousand|dozens|hundreds|thousands|millions)$/i;
  const KINDS = /\b(different|various|all|many|several|other|these|those|two|three|four|five|both|numerous|multiple) (kind|type|sort) of\b/gi;
  function num(t, ws, out) {
    KINDS.lastIndex = 0; let km;
    while ((km = KINDS.exec(t))) { if (km.index > 0 && /[A-Za-z]/.test(t[km.index - 1])) continue;
      /* 7.43: "an altogether different kind of": one kind */
      if (/\b(a|an|one|this|that|each|every)\s+(?:[a-z]+\s+)?$/i.test(t.slice(Math.max(0, km.index - 24), km.index))) continue;
      const at = km.index + km[1].length + 1; out.push({ start: at, end: at + km[2].length, fix: km[2] + 's', why: 'After "' + km[1] + '", the plural noun', cat: 'g', fam: 'num' }); }
    for (let i = 0; i < ws.length - 1; i++) {
      const p = ws[i], pw = lc(p.w);
      const q = next(ws, t, i); if (!q) continue;
      /* many student → many students; also through an adjective: many good student */
      let j = i + 1, n = q;
      if (isAdj(lc(n.w)) && !NOUN.has(lc(n.w)) && !PLURAL.has(lc(n.w))) { const r = next(ws, t, j); if (!r) continue; n = r; j++; }
      const nw = lc(n.w);
      const after = next(ws, t, j), aw = after ? lc(after.w) : '';
      const twoWord = (x, y) => i > 0 && !gap(t, ws[i - 1], p) && lc(ws[i - 1].w) === x && pw === y;
      /* 7.43: "types of agency", "kinds of evidence" take uncountable nouns
         as often as plurals; only "different kind of" (KINDS) is marked */
      const oneOfDet = i > 1 && !gap(t, ws[i - 1], p) && lc(ws[i - 1].w) === 'of' && /^(one)$/i.test(ws[i - 2].w) && /^(the|my|our|their|his|her|its|your)$/.test(pw);
      const manyLike = MANY.test(pw) || twoWord('a', 'few') || oneOfDet || twoWord('lot', 'of') || twoWord('lots', 'of') || twoWord('plenty', 'of') || twoWord('number', 'of') || twoWord('one', 'of');
      /* a noun before another noun describes it ("team championships", "summer homes"): not the head */
      const after2 = after ? next(ws, t, j + 1) : null;
      const compound = (after && (PLURAL.has(aw) || NOUN.has(aw) || /^[A-Z]/.test(after.w) || /['’]s$/.test(aw) || (/[a-z]s$/.test(aw) && !/(ss|us|is|ous)$/.test(aw) && !FORM.has(aw)) || (/ing$/.test(aw) && after2 && (PLURAL.has(lc(after2.w)) || NOUN.has(lc(after2.w)))))) || /[-‑–]/.test(t[n.e] || '');
      /* "both patient and clinician": "both ... and" coordinates singulars */
      const bothAnd = pw === 'both' && (ws.slice(j + 1, j + 11).some(x => lc(x.w) === 'and') || /^(down|up|out|off|away|back|over|together|apart)$/.test(aw));
      /* "one of justification", "one of harmony": "one of" without a
         determiner names a kind; "one of the gang": a collective */
      const oneOf = twoWord('one', 'of') || oneOfDet;
      const oneOfIdiom = (twoWord('one', 'of') && !/^(the|my|our|their|his|her|its|your|these|those|them|us)$/.test(pw)) || (oneOf && /^(gang|family|team|group|crowd|class|staff|crew|lot|kind|sort|best|worst|few|many|most)$/.test(nw));
      /* "a lot of moral satisfaction": "a lot of" takes abstract nouns */
      const lotAbstract = (twoWord('lot', 'of') || twoWord('lots', 'of') || twoWord('plenty', 'of')) && /(tion|sion|ness|ery|ism|ity|ance|ence|ment|ure|dom|hood|ship|ice|ty)$/.test(nw);
      const IRR_PL = /^(criteria|phenomena|data|media|analyses|hypotheses|theses|bases|crises|curricula|strata|alumni|fungi|nuclei|stimuli|indices|matrices|appendices|people|children|men|women|feet|teeth|mice|geese)$/;
      const adjUse = (isAdj(nw) || /(ive|al|ic|ous|ary|ory|ent|ant|ible|able)$/.test(nw)) && after && (isAdj(aw) || NOUN.has(aw) || PLURAL.has(aw) || IRR_PL.test(aw));
      const verbUse0 = /^(these|those)$/.test(pw) && /^(the|a|an|with|to|from|for|on|in|at|by|that|this|these|those|its|their|our|his|her|my|your|us|them|him|me|it|some|many|much|more|less|no|not|also|only|both|each|every|all|any|fundamental|important|significant|several|new)$/.test(aw);
      if (manyLike && !bothAnd && !verbUse0 && !oneOfIdiom && !lotAbstract && !adjUse && !IRR_PL.test(aw) && NOUN.has(nw) && !UNCOUNTABLE_AFTER_MANY.test(nw) && !compound && /^[a-z]/.test(n.w) && !MODAL.test(nw) && !(FORM.has(nw) && FORM.get(nw)[1] === 'ing') && !(pw === 'multiple' && i > 0 && /^(a|an)$/i.test(ws[i - 1].w))) {
        if (/^(hundred|thousand|percent|dozen|million|billion|half|quarter|point|degree)$/.test(nw) && /^(two|three|four|five|six|seven|eight|nine|ten|twenty|several|few|many)$/.test(pw)) continue;
        if (aw === 'of' && /^(kind|type|sort|number|amount|piece|bit|lot|pair|group|set|series|range|variety|couple|percent|part|member|majority|minority|rest|sum|total|half|quarter)$/.test(nw)) continue;
        if (/^(one|each|every)$/i.test(pw)) continue;
        out.push({ start: n.s, end: n.e, fix: caseLike(n.w, pluralOf(nw)), why: 'After "' + p.w + '", the plural noun', cat: 'g', fam: 'num' });
        continue;
      }
      /* every students → every student; a cars → a car; this things → these things */
      if (/^(every|each|another|a|an)$/.test(pw) && PLURAL.has(nw) && /^[a-z]/.test(n.w) && !compound && !(/^(a|an)$/.test(pw) && j !== i + 1) && !(pw === 'each' && lc(q.w) === 'other')) {
        if (/^(few|lot|lots|couple|dozen|hundred|thousand|million|series|species|means|headquarters|news|percent)$/.test(nw)) continue;
        out.push({ start: n.s, end: n.e, fix: caseLike(n.w, singularOf(nw)), why: 'After "' + p.w + '", the singular noun', cat: 'g', fam: 'num' });
        continue;
      }
      const pv = prevAny(ws, i), pvw = pv ? lc(pv.w) : '';
      const conj = pw === 'that' && !sentenceStart(t, p.s) && !(prev(ws, t, i) && PREPS.test(prev(ws, t, i).w)) && (!/[,;:(]\s*$/.test(t.slice(Math.max(0, p.s - 3), p.s)) || OBJ_TAKER.test(pvw) || /^(remember|think|say|said|know|believe|hope|mean|means|meant|feel|felt|found|think|thought|sure|clear|true|fact|idea|so|note|noted|means)$/.test(pvw));
      /* 7.43: "This contrasts with", "This leaves a gap": a verb, not a noun */
      const verbUse = /^(the|a|an|with|to|from|for|on|in|at|by|that|this|these|those|its|their|our|his|her|my|your|us|them|him|me|it|some|many|much|more|less|no|not|also|only|both|each|every|all|any|fundamental|important|significant|several|new)$/.test(aw);
      if (/^(this|that)$/.test(pw) && !conj && j === i + 1 && PLURAL.has(nw) && /^[a-z]/.test(n.w) && !compound && !verbUse && !/^(means|series|species|news|headquarters)$/.test(nw)) {
        out.push({ start: p.s, end: p.e, fix: caseLike(p.w, pw === 'this' ? 'these' : 'those'), why: '"' + cap(pw) + '" is singular; a plural noun takes "' + (pw === 'this' ? 'these' : 'those') + '"', cat: 'g', fam: 'num' });
        continue;
      }
      if (/^(these|those)$/.test(pw) && j === i + 1 && NOUN.has(nw) && /^[a-z]/.test(n.w) && !compound && !verbUse && !adjUse && !MODAL.test(nw) && !/^(kind|type|sort|day)$/.test(nw) && !(aw === 'of')) {
        out.push({ start: n.s, end: n.e, fix: caseLike(n.w, pluralOf(nw)), why: 'After "' + p.w + '", the plural noun', cat: 'g', fam: 'num' });
      }
    }
  }

  /* articles in fixed phrases */
  const ART = [
    /* 7.43: "in future encounters", "in future studies": "in future" before a noun is right */
    [/\bin future\b(?!-| (?!(?:i|we|you|they|he|she|it|the|this|that|there|and|but|or|so|if|when|as|to|be|is|are|will|would|can|could|should|may|might|must|my|our|your|his|her|their)\b)[a-z]+)/gi, 'in the future', 'The phrase is "in the future"'],
    [/\ball over world\b/gi, 'all over the world', 'The phrase is "all over the world"'],
    [/\b(in|around|across) world\b(?! [A-Z])/g, '$1 the world', 'The phrase is "in the world"'],
    [/\bon (?:the )?other hands?\b/gi, 'on the other hand', 'The phrase is "on the other hand"'],
    [/\bon other hand\b/gi, 'on the other hand', 'The phrase is "on the other hand"'],
    [/\bin (long|short) run\b/gi, 'in the $1 run', 'The phrase is "in the long run"'],
    [/\bat (same|first|last) time\b/gi, 'at the $1 time', 'The phrase is "at the same time"'],
    [/\bin (same|first|last|second|near) (place|way|time|case|future)\b/gi, 'in the $1 $2', 'The phrase takes "the"'],
    [/\bin (morning|evening|afternoon)\b/gi, 'in the $1', 'The phrase is "in the morning"'],
    [/\bat (end|beginning|start|moment) of\b/gi, 'at the $1 of', 'The phrase is "at the end of"'],
    [/\bat (end|beginning|moment|weekend)\b(?! of)/gi, 'at the $1', 'The phrase is "at the end"'],
    [/\bin (end|past|middle|meantime)\b/gi, 'in the $1', 'The phrase is "in the end"'],
    [/\bmost of time\b/gi, 'most of the time', 'The phrase is "most of the time"'],
    [/\b(on|use|using|used|via|through|surf|surfing|surfed|browse|access|accessing|from) internet\b/gi, '$1 the internet', 'The phrase is "on the internet"'],
    [/\bfor first time\b/gi, 'for the first time', 'The phrase is "for the first time"'],
    [/\bin first place\b/gi, 'in the first place', 'The phrase is "in the first place"'],
    [/\b(the )?majority of\b/gi, (m, a) => a ? m : 'the majority of', 'The phrase is "the majority of"'],
    [/\b(the )?rest of (the|my|our|their|his|her|its|your|them|us|it)\b/gi, (m, a, b) => a ? m : 'the rest of ' + b, 'The phrase is "the rest of"'],
    [/\b(a|the) (same)\b/gi, (m, a, b) => lc(a) === 'a' ? 'the ' + b : m, 'The phrase is "the same"'],
    [/\ba lot of (?:a|an) /gi, 'a lot of ', '"A lot of" takes no second article'],
    [/\bsuch (?:a|an) (people|children|things|problems|ideas|students|friends|books|places|ways|reasons|days|times|events|changes)\b/gi, 'such $1', '"Such a" is for one thing; the plural takes no article'],
    [/\ban (?:lot|few|bit|little)\b/gi, m => 'a ' + m.slice(3), '"A" before a consonant sound'],
    [/\b(is|are|was|were|be|become|became|as|such|for|with|have|has|had|need|needs|want|wants|find|found|get|got|take|took|make|made|buy|bought|give|gave) (very |really |quite |so |such |pretty |rather |extremely )?(important|good|bad|big|small|great|new|old|interesting|difficult|easy|hard|long|short|nice|wonderful|beautiful|huge|serious|special|strong|simple|unique|useful|perfect|terrible|wrong|right|famous|popular|successful|different|similar|common|main|major|real|true|better|cheap|expensive|high|low|large|happy|sad|busy|quiet|safe|dangerous|healthy|modern|clear|complex|typical|normal|natural|lovely|funny|strange|fantastic|excellent|amazing|brilliant|poor|rich|free|full|quick|fast|slow|clean|dirty|warm|cold|hot|dark|bright|young) (idea|problem|thing|way|place|person|job|car|house|friend|time|day|life|question|reason|chance|change|difference|example|mistake|decision|solution|student|teacher|book|city|country|company|game|movie|film|story|trip|meeting|point|part|role|result|effect|impact|benefit|risk|choice|plan|project|system|team|group|family|man|woman|boy|girl|child|moment|experience|opportunity|lesson|course|school|room|shop|restaurant|hotel|picture|song|word|sentence|number|list|piece|kind|sort|type|world|future|issue|topic|subject|habit|feeling|relationship|skill|tool|device|phone|computer|machine|building|area|city|town|village|country|river|mountain|park|garden|street|road|bridge)\b(?! of)/gi,
      (m, v, adv, adj, n) => v + ' ' + (/^[aeiou]/i.test((adv || adj)) ? 'an ' : 'a ') + (adv || '') + adj + ' ' + n, 'A singular countable noun takes "a" or "an"']
  ];
  function art(t, ws, out) {
    for (const [re, to, why] of ART) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(t))) {
        const li = re.lastIndex;                                    /* replace() with a global pattern resets lastIndex */
        const fix = typeof to === 'function' ? to.apply(null, [m[0]].concat(m.slice(1))) : m[0].replace(re, to);
        re.lastIndex = li;
        if (!fix || fix === m[0]) continue;
        if (m.index > 0 && /[A-Za-z'’-]/.test(t[m.index - 1])) continue;
        /* 7.43: "end-of-life care"; "the vast majority of" */
        if (t[m.index + m[0].length] === '-') continue;
        if (/majority of/.test(why) && /\b(the|a|an|our|their|its|this|that|his|her|my|your)\s+(?:[a-z]+\s+)?$/i.test(t.slice(Math.max(0, m.index - 30), m.index))) continue;
        /* "have real world value": the noun names the kind of another noun */
        if (/singular countable/.test(why)) { const nx = (t.slice(m.index + m[0].length).match(/^\s+([a-z]+)/) || [])[1]; if (nx && (NOUN.has(nx) || PLURAL.has(nx))) continue; }
        out.push({ start: m.index, end: m.index + m[0].length, fix: caseLike(m[0], fix), why: why, cat: 'g', fam: 'art' });
      }
    }
  }

  /* the preposition a word takes */
  const PREP = [
    [/\bin the internet\b/gi, 'on the internet', 'Things are "on the internet"'],
    [/\b(in|at) (tv|the radio|the phone|the bus|the train|the plane|the way home)\b/gi, 'on $2', 'It is "on TV", "on the bus", "on the phone"'],
    [/\b(in|on) the night\b(?! of| when| that| before| after| the| he| she| it| we| they| i\b| you| my| our| his| her| their| there| which| in| on| at| between| following| preceding)/gi, 'at night', 'It is "at night"'],
    [/\b(at|on) the (morning|afternoon|evening)\b/gi, 'in the $2', 'It is "in the morning", "in the evening"'],
    [/\b(at|on|in) (midnight|noon|midday|dawn|dusk|sunset|sunrise|lunchtime|breakfast time|dinner time)\b/gi, (m, p, n) => (lc(p) === 'at' ? m : 'at ' + n), 'It is "at midnight", "at noon"'],
    [/\bin the weekend\b/gi, 'at the weekend', 'It is "at the weekend" (or "on the weekend")'],
    [/\b(in|at) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b(?! [A-Z])/gi, 'on $2', 'Days take "on": "on Monday"'],
    [/\b(on|at) (19\d\d|20\d\d)\b(?! [A-Z]|-|–)/g, 'in $2', 'Years take "in": "in 2019"'],
    [/\b(on|at) (january|february|march|april|may|june|july|august|september|october|november|december)\b(?! \d| [A-Z]|,| the)/gi, 'in $2', 'Months take "in": "in May"'],
    [/\bin (last|next|this) (year|week|month|summer|winter|time|morning|evening|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '$1 $2', '"Last year", "next week", "this morning": no "in"'],
    [/\b(since|during|from) (\d+|two|three|four|five|six|seven|eight|nine|ten|many|several|a few|few|some|a couple of|twenty|thirty) (minutes|hours|days|weeks|months|years|decades|centuries)\b(?! ago)/gi, 'for $2 $3', 'A length of time takes "for": "for three years"'],
    [/\b(before|since) (\d+|two|three|four|five|six|seven|eight|nine|ten|many|several|a few|few|some|twenty|thirty) (minutes|hours|days|weeks|months|years|decades|centuries)\b(?! ago| before| after| of)/gi, '$2 $3 ago', 'A point in the past takes "ago": "three years ago"'],
    [/\barriv(e|es|ed|ing) to (the|a|an|my|our|his|her|their|your|this|that|school|work|home)\b/gi, 'arriv$1 at $2', '"Arrive at" a place ("arrive in" a city or country)'],
    [/\barriv(e|es|ed|ing) to ([A-Z][a-z]+)\b/g, 'arriv$1 in $2', '"Arrive in" a city or country'],
    [/\bmarried with (a|an|the|my|his|her|their|our|your|someone|somebody|him|her|me|you|them|us)\b/gi, 'married to $1', '"Married to", not "married with"'],
    [/\bdepend(s|ed|ing)? (of|in|from|to)\b/gi, 'depend$1 on', '"Depend on"'],
    [/\binterested (on|about|for|to)\b/gi, 'interested in', '"Interested in"'],
    [/\bgood (in|on) (math|maths|english|sport|sports|music|science|cooking|drawing|writing|speaking|languages|everything|nothing|it|this|that)\b/gi, 'good at $2', '"Good at" a skill'],
    [/\bparticipat(e|es|ed|ing) (to|at|on)\b/gi, 'participat$1 in', '"Participate in"'],
    [/\baccording with\b/gi, 'according to', '"According to"'],
    [/\blisten(s|ed|ing)? (music|the music|the radio|the news|the teacher|them|him|her|me|us|you|it|songs)\b/gi, 'listen$1 to $2', '"Listen to"'],
    [/\bwait(s|ed|ing)? (you|him|her|them|us|me|the bus|the train|the result|the results|the answer)\b/gi, 'wait$1 for $2', '"Wait for"'],
    [/\bsearch(es|ed|ing)? (a|an) (job|house|flat|car|solution|way|place)\b/gi, 'search$1 for $2 $3', '"Search for" something'],
    [/\b(ask|asks|asked|asking|tell|tells|told|telling) to (him|her|them|me|us|you|the teacher|my mother|my father|my parents|my friend|my friends)\b/gi, '$1 $2', '"Ask him", "tell me": no "to"'],
    [/\bexplain(s|ed|ing)? (me|him|her|them|us|you) (that|how|why|what|the|this|it|everything)\b/gi, 'explain$1 to $2 $3', '"Explain to me", not "explain me"'],
    [/\banswer(s|ed|ing)? to (the|a|an|my|his|her|their|your|this|that|these|those|all|every|each) (question|questions|letter|letters|email|emails|phone|call|calls|message|messages)\b/gi, 'answer$1 $2 $3', '"Answer the question": no "to"'],
    [/\benter(s|ed|ing)? (in|into) (the|a|an|my|his|her|their|our|your|this|that) (room|house|building|school|university|college|class|classroom|shop|store|office|city|country|car|hall|kitchen|market|competition|contest)\b/gi, 'enter$1 $3 $4', '"Enter the room": no "into"'],
    [/\breach(es|ed|ing)? (to|at) (the|a|an|my|his|her|their|our|your|this|that|its)\b/gi, 'reach$1 $3', '"Reach" a place: no "to"'],
    /* 7.43: "in the beginning of", "in the age of digital education" are English */
    [/\bin the end of\b/gi, 'at the end of', '"At the end of"'],
    [/\bin the age of (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi, 'at the age of $1', '"At the age of"'],
    [/\bby (my|your|his|her|their|our|its) own\b(?=\s*[.,;:!?)]|\s*$)/gi, 'on $1 own', '"On my own"'],
    [/\bwith (the )?(car|bus|train|plane|bike|bicycle|taxi|boat|ship|foot)\b(?! (that|which|of|is|was|we|i|you|they|he|she))/gi, (m, a, v) => (lc(v) === 'foot' ? 'on foot' : 'by ' + v), '"By car", "by bus", "on foot"'],
    [/\bby foot\b/gi, 'on foot', '"On foot"'],
    [/\b(responsible|famous|suitable|ready|thankful|grateful) (of|about|by)\b/gi, '$1 for', '"Responsible for", "famous for"'],
    [/\bcapable to\b/gi, 'capable of', '"Capable of"'],
    [/\b(afraid|scared|aware|ashamed|fond|full) (from|for|with)\b/gi, '$1 of', '"Afraid of", "aware of", "full of"'],
    [/\b(similar|related|married|accustomed|opposed|belong|belongs|belonged|belonging) with\b/gi, '$1 to', '"Similar to", "related to", "belong to"'],
    /* 7.43: "the suffering of patients", "losses suffered by" are right */
    [/\bsuffer(s|ed)? of\b/gi, 'suffer$1 from', '"Suffer from"'],
    [/\b(am|is|are|was|were|be|been|'s|'re) suffering (of|by)\b/gi, '$1 suffering from', '"Suffer from"'],
    /* 7.43: "care for" (look after), "think for yourself", "worry for him"
       and the noun "thought on" are English; only the clear slips stay */
    [/\b(worry|worries|worried|worrying) (on|with) (the|this|that|these|those|my|our|his|her|their|your|it|them|him|me|us|you|how|what|whether)\b/gi, '$1 about $3', '"Worry about"'],
    [/\b(complain|complains|complained|complaining) (on|for|with) (the|this|that|these|those|my|our|his|her|their|your|it|them|him|me|us|you|how|what|whether)\b/gi, '$1 about $3', '"Complain about"'],
    [/\bdiscuss(es|ed|ing)? about\b/gi, 'discuss$1', '"Discuss" takes no "about"'],
    [/\bmention(s|ed|ing)? about\b/gi, 'mention$1', '"Mention" takes no "about"'],
    [/\b(emphasise|emphasize|emphasises|emphasizes|emphasised|emphasized|stress|stresses|stressed) on\b/gi, '$1', '"Emphasise" takes no "on"'],
    [/\b(to|can|could|will|would|should|must|please|i|we|they|you|he|she|also) (contact|contacts|contacted) with (him|her|them|me|us|you|the|a|an|my|our|his|her|their|your)\b/gi, '$1 $2 $3', '"Contact someone": no "with"'],
    [/\b(lack|lacks|lacked|lacking) of\b/gi, (m, v) => lc(v) === 'lack' ? m : v, '"Lacks" takes no "of" (but "a lack of")'],
    [/\b(attend|attends|attended|attending) (to|at|in) (the|a|an|my|our|his|her|their|your|this|that) (school|university|college|class|classes|course|courses|meeting|meetings|lecture|lectures|conference|lesson|lessons|event|events|party|wedding|funeral|church)\b/gi, '$1 $3 $4', '"Attend school": no "to"'],
    [/\b(go|goes|went|gone|going|come|comes|came|coming|get|gets|got|getting|return|returns|returned|returning|back|way|welcome) to (home|abroad|overseas|downtown|downstairs|upstairs|outside|inside|here|there)\b/gi, '$1 $2', '"Go home", "go abroad": no "to"'],
    [/\b(at|to) (here|there)\b(?=[,.!?;:]|$| and| but| because| for| with| so| when| where| which| that| yet| since| while| as| or| too| also| now| then| again| every| all| until| till| on| in| at| by| last| next| this| after| before| during)/gi, '$2', '"Here" and "there" take no preposition'],
    [/\bnear to (the|a|an|my|our|his|her|their|your|this|that|it|them|me|us|him|her|you)\b/gi, 'near $1', '"Near", not "near to"'],
    [/\bin nowadays\b/gi, 'nowadays', '"Nowadays" takes no "in"'],
    [/\b(on|in|at) (last|next|every|each) (weekend|morning|evening|afternoon|night|week|month|year|summer|winter|day|time)\b/gi, '$2 $3', '"Last weekend", "every morning": no preposition'],
    [/\b(on|in|at) (this) (weekend|morning|evening|afternoon|week|month|year|summer|winter)\b/gi, '$2 $3', '"This weekend", "this morning": no preposition'],
    [/\b(spend|spends|spent|spending|waste|wastes|wasted|wasting) (time|money|hours|days|years|a lot of time|too much time|much time|the whole day|all day|my time|their time|his time|her time|our time) (to|for) ([a-z]+ing)\b/gi, '$1 $2 $4', '"Spend time doing": no "to"'],
    /* 7.43: "consist in" is a formal English idiom ("consist in the application of") */
    [/\b(consist|consists|consisted|consisting) (from|on)\b/gi, '$1 of', '"Consist of"'],
    [/\b(prefer|prefers|preferred) (\w+) (than|over|to) (\w+)/gi, (m, v, a, p, b) => lc(p) === 'to' ? m : v + ' ' + a + ' to ' + b, '"Prefer X to Y"'],
    [/\b(graduat(?:e|es|ed|ing)) (the|a|an|my|our|his|her|their|your|this|that) (school|university|college|high school)\b/gi, '$1 from $2 $3', '"Graduate from"'],
    [/\bcongratulat(e|es|ed|ing) (you|him|her|them|me|us) for\b/gi, 'congratulat$1 $2 on', '"Congratulate someone on"'],
    [/\b(in|on) (the )?(way|route|road|path|trail) (to|towards|home)\b/gi, (m, p, a, n, x) => (lc(p) === 'on' ? m : 'on ' + (a || '') + n + ' ' + x), '"On the way to"'],
    [/\bat (home|work|school|university|college|church|sea|war|peace|rest|first|last|least|once|present|times|night|noon|midnight)\b/gi, m => m, ''],
    [/\b(go|goes|went|going|gone|come|comes|came|coming) (in|at|on|into) (holiday|holidays|vacation|a holiday|a trip|a journey|a walk|a picnic|a date|a diet|strike|sale|tour|a tour)\b/gi, '$1 on $3', '"Go on holiday", "go on a trip"'],
    [/\bwith (the )?(email|e-mail|phone|telephone|post|mail|sms)\b(?! (that|which|of|is|was|number|numbers|call|calls|he|she|they|we|i|you|in|on|at|from))/gi, 'by $2', '"By email", "by phone"']
  ];
  function prep(t, ws, out) {
    for (const [re, to, why] of PREP) {
      if (!why) continue;
      re.lastIndex = 0; let m;
      while ((m = re.exec(t))) {
        const li = re.lastIndex;                                    /* replace() with a global pattern resets lastIndex */
        const fix = typeof to === 'function' ? to.apply(null, [m[0]].concat(m.slice(1))) : m[0].replace(re, to);
        re.lastIndex = li;
        if (!fix || fix === m[0]) continue;
        if (m.index > 0 && /[A-Za-z'’-]/.test(t[m.index - 1])) continue;
        /* 7.43: "range from 18 weeks"; "the answer to this question" is the noun */
        const before = t.slice(Math.max(0, m.index - 30), m.index);
        if (/length of time/.test(why) && /^from/i.test(m[0]) && /\b(rang(e|es|ed|ing)|var(y|ies|ied|ying)|anywhere)\s+$/i.test(before)) continue;
        if (/Answer the question/.test(why) && !/\b(i|you|we|they|he|she|it|to|can|could|will|would|should|must|did|didn't|don't|doesn't|not|please)\s+$/i.test(before)) continue;
        out.push({ start: m.index, end: m.index + m[0].length, fix: caseLike(m[0], fix), why: why, cat: 'g', fam: 'prep' });
      }
    }
  }

  /* words run together or split */
  const ORTH = [
    ['infront', 'in front'], ['aswell', 'as well'], ['atleast', 'at least'], ['incase', 'in case'], ['ofcourse', 'of course'], ['eachother', 'each other'], ['thankyou', 'thank you'],
    ['alittle', 'a little'], ['abit', 'a bit'], ['inspite', 'in spite'], ['everyday', null], ['infact', 'in fact'], ['atall', 'at all'], ['allright', 'all right'], ['aslong', 'as long'],
    ['nevermind', 'never mind'], ['alongside', null], ['onthe', 'on the'], ['inthe', 'in the'], ['tothe', 'to the'], ['ofthe', 'of the'], ['forexample', 'for example'], ['incharge', 'in charge'],
    ['uptodate', 'up to date'], ['afterall', 'after all'], ['anymore', null], ['alot', 'a lot'], ['alright', null], ['eventhough', 'even though'], ['inorder', 'in order'], ['noone', 'no one'],
    ['themself', 'themselves'], ['theirself', 'themselves'], ['theirselves', 'themselves'], ['hisself', 'himself'], ['ourself', 'ourselves'], ['yourselfs', 'yourselves'], ['alsways', 'always'],
    ['everytime', 'every time'], ['sometime', null], ['maybe', null], ['cannot', null], ['whereever', 'wherever'], ['whatever', null]
  ];
  const ORTH_SPLIT = [[/\ba (lot|bit|few|little) (?=[a-z])/gi, null], [/\bevery (one|body|thing|where)\b/gi, (m, x) => x === 'one' ? null : 'every' + x], [/\bsome (thing|one|where|times|body)\b/gi, (m, x) => 'some' + x], [/\bany (thing|one|where|body|more)\b/gi, (m, x) => x === 'one' ? null : 'any' + x], [/\bno (body|where)\b/gi, (m, x) => 'no' + x], [/\bnow a days\b/gi, 'nowadays'], [/\bnow days\b/gi, 'nowadays'], [/\bwhere as\b/gi, 'whereas'], [/\bmean while\b/gi, 'meanwhile'], [/\bfurther more\b/gi, 'furthermore'], [/\bmore over\b/gi, 'moreover'], [/\bhow ever\b/gi, 'however'], [/\bthem selves\b/gi, 'themselves'], [/\bour selves\b/gi, 'ourselves'], [/\bmy self\b/gi, 'myself'], [/\byour self\b/gi, 'yourself'], [/\bhim self\b/gi, 'himself'], [/\bher self\b/gi, 'herself'], [/\bit self\b/gi, 'itself'], [/\bwith out\b/gi, 'without'], [/\bwith in\b(?= (the|a|an|this|that|these|those|my|our|their|his|her|its|your|\d))/gi, 'within'], [/\bin to\b(?= (the|a|an|this|that|these|those|my|our|their|his|her|its|your|account|consideration|effect|practice))/gi, 'into'], [/\bon to\b(?= (the|a|an|this|that|my|our|their|his|her|its|your))/gi, 'onto'], [/\bcan not\b(?! only| just| but| even)/gi, 'cannot'], [/\bweek end\b/gi, 'weekend'], [/\bweek ends\b/gi, 'weekends'], [/\bbirth day\b/gi, 'birthday'], [/\bback ground\b/gi, 'background'], [/\bfeed back\b/gi, 'feedback'], [/\bhome work\b/gi, 'homework'], [/\bevery where\b/gi, 'everywhere'], [/\bany where\b/gi, 'anywhere'], [/\bno where\b/gi, 'nowhere'], [/\bsome where\b/gi, 'somewhere'], [/\blife style\b/gi, 'lifestyle'], [/\bgirl friend\b/gi, 'girlfriend'], [/\bboy friend\b/gi, 'boyfriend'], [/\bteen ager(s?)\b/gi, 'teenager$1'], [/\bair port\b/gi, 'airport'], [/\bweb site(s?)\b/g, 'website$1'], [/\bon line\b(?= (shopping|course|courses|games|game|shop|store|learning|banking|business|services|service|classes|class|education|platform|platforms|community|communities))/gi, 'online'], [/\bsmart phone(s?)\b/gi, 'smartphone$1'], [/\bgrand (mother|father|parents|children|son|daughter)\b/gi, 'grand$1'], [/\bstep (mother|father)\b/gi, 'step$1'], [/\bmother in law\b/gi, 'mother-in-law'], [/\bfather in law\b/gi, 'father-in-law'], [/\bwell known\b(?= [a-z])/gi, null], [/\bfull time (job|jobs|work|worker|workers|student|students|employee|employees|position|positions)\b/gi, 'full-time $1'], [/\bpart time (job|jobs|work|worker|workers|student|students|employee|employees|position|positions)\b/gi, 'part-time $1'], [/\bself (esteem|confidence|control|discipline|respect|employed|employment|service|study|awareness|development|improvement)\b/gi, 'self-$1'], [/\bco (workers?|operation|operate)\b/gi, 'co-$1'], [/\bnon (smoker|smokers|smoking|profit|stop|existent|sense)\b/gi, 'non-$1'], [/\bwell being\b/gi, 'well-being'], [/\bup to date\b(?= (information|technology|news|data|knowledge|equipment|version|software))/gi, 'up-to-date'], [/\bday to day\b(?= (life|basis|activities|work|tasks|operations|routine))/gi, 'day-to-day'], [/\blong term\b(?= (effects?|goals?|plans?|benefits?|consequences?|solutions?|investments?|relationships?|memory|impact|success|health|care|strategy|growth|damage|problems?|project|contract|basis))/gi, 'long-term'], [/\bshort term\b(?= (effects?|goals?|plans?|benefits?|consequences?|solutions?|memory|impact|contract|basis|loans?|gains?|profits?|measures?))/gi, 'short-term'], [/\bold fashioned\b/gi, 'old-fashioned'], [/\bwell paid\b(?= (job|jobs|work|position|positions|employees|workers))/gi, 'well-paid'], [/\bso called\b/gi, 'so-called'], [/\bmiddle aged\b/gi, 'middle-aged'], [/\bopen minded\b/gi, 'open-minded'], [/\bhard working\b/gi, 'hard-working'], [/\btime consuming\b/gi, 'time-consuming'], [/\bhigh tech\b/gi, 'high-tech'], [/\bface to face\b(?= (communication|contact|conversation|conversations|meeting|meetings|interaction|interactions|lessons|classes|teaching|learning|interview|interviews))/gi, 'face-to-face'], [/\bone way\b(?= (ticket|street|trip|road))/gi, 'one-way'], [/\b(a|an|the|my|our|his|her|their|this|that) (\d+) (year|month|week|day|hour|minute) old\b/gi, '$1 $2-$3-old'], [/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty) (year|month|week|day|hour|minute|mile|kilometre|kilometer|metre|meter|inch|foot|pound|dollar|star|bedroom|storey|story|page|seat|person|man|piece|point|word|item|wheel) (old|long|high|wide|deep|tall|thick|heavy)\b(?= (boy|girl|man|woman|child|son|daughter|student|car|house|building|wall|road|river|bridge|hotel|flight|journey|trip|walk|course|programme|program|project|plan|contract|period|wait|delay|drive|ride))/gi, '$1-$2-$3']];
  function orth(t, ws, out) {
    for (const w of ws) {
      const l = lc(w.w);
      for (const [bad, good] of ORTH) if (l === bad && good) { out.push({ start: w.s, end: w.e, fix: caseLike(w.w, good), why: '"' + good + '" is written as two words', cat: 'g', fam: 'orth' }); break; }
    }
    for (const [re, to] of ORTH_SPLIT) {
      if (to === null) continue;
      re.lastIndex = 0; let m;
      while ((m = re.exec(t))) {
        const li = re.lastIndex;                                    /* replace() with a global pattern resets lastIndex */
        const fix = typeof to === 'function' ? to.apply(null, [m[0]].concat(m.slice(1))) : m[0].replace(re, to);
        re.lastIndex = li;
        if (!fix || fix === m[0]) continue;
        if (m.index > 0 && /[A-Za-z'’-]/.test(t[m.index - 1])) continue;
        if (t[m.index + m[0].length] === '-') continue;              /* 7.43: "her self-perception" */
        out.push({ start: m.index, end: m.index + m[0].length, fix: caseLike(m[0], fix), why: '"' + fix + '" is one word', cat: 'g', fam: 'orth' });
      }
    }
  }

  /* commas */
  const SUBORD = /^(if|when|although|though|because|since|while|after|before|unless|until|once|whenever|whereas|wherever|as long as|as soon as|even if|even though|in case|as)$/i;
  const OPENERS = ['before that', 'this way', 'in this way', 'in the same way', 'at the same time', 'in this case', 'in that case', 'in the meantime', 'in the long run', 'in the future', 'in the past', 'at the moment', 'at that time', 'at the time', 'on the contrary', 'in general', 'in brief', 'in summary', 'to be honest', 'needless to say', 'as far as i am concerned', 'as far as i know', 'from my point of view', 'in my view', 'to my mind', 'for one thing', 'in theory', 'in practice', 'in reality', 'in effect', 'on balance', 'all things considered', 'on the whole', 'by the way', 'by contrast', 'by comparison', 'in comparison', 'in contrast', 'likewise', 'similarly', 'ultimately', 'eventually', 'finally', 'meanwhile', 'suddenly', 'even so', 'also', 'first', 'second', 'third', 'in my opinion', 'first of all', 'on the one hand', 'on the other hand', 'in addition', 'at first', 'after that', 'after all', 'in the end', 'to sum up', 'all in all', 'of course', 'in fact', 'as a result', 'nowadays', 'unfortunately', 'fortunately', 'luckily', 'personally', 'besides', 'furthermore', 'moreover', 'secondly', 'thirdly', 'lastly', 'firstly', 'afterwards', 'actually', 'honestly', 'frankly', 'obviously', 'clearly', 'surprisingly', 'hopefully', 'sadly', 'anyway', 'otherwise', 'however', 'therefore', 'thus', 'hence', 'nevertheless', 'nonetheless', 'consequently', 'for example', 'for instance', 'in conclusion', 'to conclude', 'last but not least', 'in other words', 'for this reason', 'because of this', 'because of that', 'despite this', 'as a consequence', 'in short', 'in particular', 'above all', 'what is more', 'apart from that', 'besides that', 'on top of that', 'by the way', 'as for me', 'in my view', 'in this case', 'in that case', 'in general', 'generally speaking', 'to be honest', 'in contrast', 'by contrast', 'on the contrary', 'at the same time', 'at the end of the day', 'as a matter of fact', 'as far as i am concerned', 'as far as i know', 'to begin with', 'to start with', 'in the first place', 'in the second place', 'at last', 'finally', 'meanwhile', 'eventually', 'indeed', 'similarly', 'likewise', 'instead', 'in the meantime', 'in a word', 'in brief', 'to summarise', 'to summarize', 'in summary'];
  const OPENER_RE = new RegExp('^(' + OPENERS.slice().sort((a, b) => b.length - a.length).map(o => o.replace(/ /g, '\\s+')).join('|') + ')(\\s+)(?=[A-Za-z])', 'i');
  const MAIN_START = /^(will|would|can|could|should|must|may|might|am|is|are|was|were|have|has|had|do|does|did|need|want|think|believe|feel|like|prefer|'ll|'d|'m|'re|'ve|ll|d|m|re|ve|cannot|can't|won't|wouldn't|couldn't|shouldn't|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|wasn't|weren't)$/i;
  function comma(t, ws, out) {
    /* sentences */
    const sents = []; let s0 = 0;
    for (let i = 0; i <= t.length; i++) if (i === t.length || /[.!?\n]/.test(t[i])) { if (i > s0) sents.push([s0, i]); s0 = i + 1; }
    for (const [a, b] of sents) {
      const sent = t.slice(a, b), lead = sent.length - sent.replace(/^[\s"“‘'(\[]+/, '').length, body = sent.slice(lead);
      /* an opener with no comma */
      const om = OPENER_RE.exec(body);
      const restO = om ? body.slice(om[1].length + om[2].length) : '';
      const prepOpener = om && /^(in addition|as a result|in contrast|by contrast|by comparison|in comparison|in the same way|in this way|this way|before that|at the moment|at that time|at the time|in the future|in the past|in theory|in practice|in reality|in effect|on balance|on the whole|on the contrary|in the long run|likewise|similarly|eventually|finally|meanwhile|suddenly|ultimately|even so|besides|instead|apart from that|on top of that|because of this|because of that|despite this|as a consequence|in the end|at first|after all|at last|at the same time|in general|in particular|in short|in brief|in summary|in fact|of course|above all|first of all|to begin with|to start with|on the one hand|on the other hand|in the first place|in the second place|in my opinion|in my view|in this case|in that case|for this reason|in other words|in the meantime|last but not least|all in all|what is more|as for me|by the way|in a word)$/i.test(om[1]);
      /* "In addition to the benefits", "Besides these items": the opener is a preposition here, not an opener */
      const openerIsPrep = prepOpener && /^(to|of|for|from|with|in|on|at|by|about|that|when|which|where|as|than|while|if)\b/i.test(restO) || prepOpener && (/^(these|those|this|his|her|their|its|my|our|your|the|a|an|such|all|some|most|many|several|other|one|two|three)\b/.test(restO) || /^(?:[A-Z][a-z]|\d)/.test(restO)) && !/^(the|a|an|this|these|those|my|our|their|his|her|its|your|one|some|most|many|all|several|two|three) [a-z]+ (is|are|was|were|has|have|had|will|would|can|could|should|must|may|might|do|does|did|[a-z]+ed|[a-z]+s)\b/i.test(restO);   /* 7.50: "I" is a subject, not a name */
      if (om && !/^[,;:]/.test(body.slice(om[1].length)) && !openerIsPrep) {
        const at = a + lead + om[1].length;
        const rest = body.slice(om[1].length + om[2].length);
        /* "However good it is", "Finally home": the opener must be followed by a clause */
        const subjStart = /^(the|a|an|i|you|we|they|he|she|it|there|this|that|these|those|my|our|your|their|his|her|its|people|students|children|parents|teachers|everyone|everybody|someone|nobody|many|most|some|all|no|one)\b/i.test(rest);
        if (/^(of|the|a|an|i|you|we|they|he|she|it|there|this|that|these|those|my|our|your|their|his|her|its|people|students|children|parents|teachers|everyone|everybody|someone|nobody|many|most|some|all|no|one|in|on|at|for|with|by|from|to|if|when|because|although|as|since|while|after|before|not|only|even|also|still|just|now|today|nowadays|during|despite|without|what|how|why|where|who|which|whether|being|having|doing|going|getting|making|taking|using|learning|working|studying|living)\b/i.test(rest) && (subjStart || !/^(also|first|second|third)$/i.test(om[1])) || /^[A-Z][a-z]/.test(rest)) {
          if (!(/^(however|thus|hence|finally|instead|indeed|clearly|obviously|generally)$/i.test(om[1]) && /^(good|bad|much|many|hard|long|far|small|big|little|great|difficult|important|strong|well|fast|slow|the)\b/i.test(rest)) && !(/^(in fact|of course|at first|at last|finally|eventually|meanwhile)$/i.test(om[1]) && false))
            out.push({ start: at, end: at, orig: '', fix: ',', why: 'A comma after an opening phrase such as "' + cap(om[1].toLowerCase()) + ',"', cat: 'g', fam: 'comma' });
        }
      }
      /* a fronted time phrase before a pronoun subject: "Two years ago I" */
      const tm = /^((?:\w+ )?\w+ (?:years?|months?|weeks?|days?|hours?|minutes?) ago|at (?:first|last)|in the end|after (?:that|all|a while)|from (?:then on|now on)|one day|afterwards|meanwhile|eventually|suddenly|unfortunately|fortunately|luckily|sadly|finally|firstly|secondly|lastly)\s+(?=(?:I|we|they|he|she|it|you)\b)/i.exec(body);
      if (tm && !om && !/,/.test(tm[1])) {
        const at = a + lead + tm[1].length;
        out.push({ start: at, end: at, orig: '', fix: ',', why: 'A comma after an opening time phrase such as "' + tm[1] + ',"', cat: 'g', fam: 'comma' });
      }
      /* a fronted clause with no comma */
      const sw = ws.filter(w => w.s >= a + lead && w.e <= b);
      if (sw.length >= 6 && !/,/.test(body) && SUBORD.test(sw[0].w) && !/^as$/i.test(sw[0].w)) {
        let hasVerb = false;
        for (let i = 1; i < Math.min(sw.length, 16); i++) {
          const w = sw[i], l = lc(w.w);
          if (i >= 3 && hasVerb && SUBJ_PRON.test(w.w) && i + 1 < sw.length && !gap(t, w, sw[i + 1]) && MAIN_START.test(sw[i + 1].w) && !/^(that|because|if|when|whether|what|how|why|where|which|who|and|or|but|than|as|so|since|although|while|unless|until|after|before|once|for|to|of|in|on|at|with|by|from|about|like|whom|whose)$/i.test(sw[i - 1].w)) {
            out.push({ start: w.s, end: w.s, orig: '', fix: ', ', why: 'A comma closes the opening "' + sw[0].w + '" clause before the main one', cat: 'g', fam: 'comma', cut0: true });
            /* the space before is absorbed */
            out[out.length - 1].start = sw[i - 1].e; out[out.length - 1].end = w.s; out[out.length - 1].fix = ', ';
            break;
          }
          if (FORM.has(l) || MODAL.test(l) || AUX_BE.test(l) || /^(is|are|was|were|has|have|had|'s|'re|'m|'ve)$/.test(l)) hasVerb = true;
        }
      }
      /* 7.50: an opening phrase or clause the rule above did not see: a
         prepositional phrase of three words or more before a pronoun subject
         ("In the same way I had"), and an opening clause or phrase before a
         determiner and its noun ("When I arrived my uncle was", "After some
         years the girl decided"). The main clause must follow at once with
         its verb; a second subject and verb soon after ("By the time I
         arrived the party was over") leaves the edge uncertain, so nothing
         is said. */
      if (!/,/.test(body) && sw.length >= 5 && !om && !tm) {
        const PREP0 = /^(in|on|at|for|after|before|during|by|with|without|from|under|over|through|despite|like|unlike|among|between|within|across|around|throughout|since|until|inside|outside|near|beside|behind|besides|while|when|whenever|once|although|though|because|if|unless)$/i;
        const DET0 = /^(the|a|an|my|our|your|their|his|her|its|these|those|some|many|most|every|each|all|no)$/i;   /* not this or that: as often a pronoun or a conjunction */
        const NOTNOUN = w => MAIN_START.test(w) || AUX_BE.test(w) || MODAL.test(w) || PAST0.test(w) || SUBJ_PRON.test(w) || /^(there|that|this|it|not|also|then|now|still|just|only|so|very)$/i.test(w);
        const PAST0 = /^(went|came|took|gave|made|saw|knew|thought|said|told|found|left|felt|brought|bought|taught|kept|met|lost|paid|sold|sent|spent|built|heard|held|led|read|meant|learnt|understood|stood|won|sat|put|cut|let|ran|ate|wrote|drove|spoke|broke|chose|forgot|grew|threw|drew|fell|began|drank|sang|swam|wore|became|got|had|was|were|did|could|would|should|might)$/i;
        const VERB0 = w => { const l = lc(w); return MAIN_START.test(l) || FORM.has(l) || /^[a-z]{3,}ed$/.test(l) || PAST0.test(l) || MODAL.test(l) || AUX_BE.test(l); };
        const first = lc(sw[0].w), isClause = SUBORD.test(first) && first !== 'as';
        if (PREP0.test(first) || isClause) {
          let seenVerb = false;
          for (let i = 1; i < Math.min(sw.length - 1, 10); i++) {
            const w = sw[i], p = sw[i - 1], n = sw[i + 1];
            if (gap(t, p, w)) break;
            const l = lc(w.w);
            if (isClause && (FORM.has(l) || /ing$/.test(l) || VERB0(l))) seenVerb = true;
            if (isClause && !seenVerb && !(PREP0.test(first) && i >= 3)) continue;
            if (!isClause && i < 3) continue;
            let subj = false;
            if (SUBJ_PRON.test(w.w) && n && !gap(t, w, n) && VERB0(n.w)) subj = true;
            else if (DET0.test(w.w) && n && i + 2 < sw.length && !gap(t, w, n) && !gap(t, n, sw[i + 2]) && /^[a-z]+$/i.test(n.w) && !NOTNOUN(n.w) && VERB0(sw[i + 2].w) && !/^(the|a|an)$/i.test(sw[i + 2].w)) subj = true;   /* the word after a determiner is its noun ("the match was"), unless it can only be a verb or a pronoun ("that has", "that he") */
            if (!subj) continue;
            if (/^(where|which|that|who|whom|whose|when|because|if|and|or|but|as|than|while|so|what|how|why|to|of|for|with|by|from|in|on|at)$/i.test(p.w)) break;   /* the subject belongs to the phrase */
            let second = false; const vi = SUBJ_PRON.test(w.w) ? i + 1 : i + 2;
            for (let j = vi + 1; j < Math.min(sw.length - 1, vi + 6); j++) {
              if (gap(t, sw[j - 1], sw[j])) break;
              if ((SUBJ_PRON.test(sw[j].w) || /^there$/i.test(sw[j].w)) && VERB0(sw[j + 1].w)) { second = true; break; }
              if (DET0.test(sw[j].w) && j + 2 < sw.length && VERB0(sw[j + 2].w)) { second = true; break; }
            }
            if (second) break;
            if (out.some(e => e.start === p.e || e.start === w.s)) break;
            out.push({ start: p.e, end: w.s, orig: t.slice(p.e, w.s), fix: ', ', why: 'A comma closes the opening ' + (isClause ? '"' + sw[0].w + '" clause' : 'phrase "' + t.slice(sw[0].s, p.e) + ',"') + ' before the main one', cat: 'g', fam: 'comma' });
            break;
          }
        }
      }
      /* "I like it but I" → ", but I" */
      for (let i = 2; i < sw.length - 2; i++) {
        const w = sw[i];
        if (!/^(but|so)$/i.test(w.w)) continue;
        if (gap(t, sw[i - 1], w) || gap(t, w, sw[i + 1])) continue;
        if (!SUBJ_PRON.test(sw[i + 1].w) || !(i + 2 < sw.length && !gap(t, sw[i + 1], sw[i + 2]) && (MAIN_START.test(sw[i + 2].w) || FORM.has(lc(sw[i + 2].w))))) continue;
        if (/^(not|only|also|and|even|nothing|anything|everything|all|none|no|or|,)$/i.test(sw[i - 1].w)) continue;
        if (lc(w.w) === 'so' && /^(that|much|many|far|long)$/i.test(sw[i + 1].w)) continue;
        const left = sw.slice(0, i);
        if (!left.some(x => FORM.has(lc(x.w)) || MODAL.test(x.w) || AUX_BE.test(x.w))) continue;
        out.push({ start: sw[i - 1].e, end: w.s, fix: ', ', why: 'A comma before "' + lc(w.w) + '" when it joins two complete clauses', cat: 'g', fam: 'comma' });
      }
    }
  }

  const FAMS = { sva: sva, form: form, aux: aux, tense: tense, num: num, art: art, prep: prep, orth: orth, comma: comma };
  /* every note, in order, none overlapping another */
  function check(text, opts) {
    const t = String(text || ''), ws = words(t), out = [];
    const only = opts && opts.only ? String(opts.only).split(',') : null;
    for (const k in FAMS) { if (only && only.indexOf(k) < 0) continue; try { FAMS[k](t, ws, out); } catch (e) { } }
    for (const e of out) {
      /* an insertion shows the word it joins: "car" → "car,"; "going" → "am going" */
      if (!t.slice(e.start, e.end).trim()) {
        if (/^[,;:.]/.test(e.fix)) { const pw = /[A-Za-z'’-]+$/.exec(t.slice(0, e.start)); if (pw) { e.start = e.start - pw[0].length; e.fix = pw[0] + e.fix; } }
        else if (/ $/.test(e.fix)) { const nw = /^[A-Za-z'’-]+/.exec(t.slice(e.end)); if (nw) { e.end = e.end + nw[0].length; e.fix = e.fix + nw[0]; } }
      }
      e.orig = t.slice(e.start, e.end); if (e.fix === e.orig) e.drop = true; }
    const res = out.filter(e => !e.drop).sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = []; let last = -1;
    for (const e of res) { if (e.start < last) continue; kept.push(e); last = Math.max(last, e.end); }
    return kept;
  }
  const api = { check: check, families: Object.keys(FAMS), _V: V, _NOUN: NOUN, _FORM: FORM, _ADJ: ADJ, formOf: formOf, verbForm: verbForm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKLRN = api;
})(typeof self !== 'undefined' ? self : this);
