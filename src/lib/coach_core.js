/* Inkwell's writing coach, offline (7.38). Some prompts ask for what rules
   cannot write: "Show, don't tell", "Signpost the argument", "Synthesis, not
   a list". For those the coach does not pretend. It reads the passage, points
   to the exact words that answer the prompt, says how to change them in one
   or two lines, and gives a short example that is marked as an example. Then
   the writer tries one sentence and asks the coach to check it.
   "Tell me and I forget. Teach me and I remember. Involve me and I learn."
   plan(prompt) maps a prompt, from the library or the writer's own, to the
   rule rewrites (INKRW modes) and the coaching that answer it. Each function
   takes and returns plain data; tools/rewrite/coach_cases.js holds the tests.
   No regular expression here uses a lookbehind (Safari before 16.4). */
(function (root) {
  /* ---- helpers ---- */
  function sentences(t) {
    const out = [], re = /[^.!?\n]+(?:[.!?]+["”’)]*|$)/g;
    let m;
    while ((m = re.exec(String(t || '')))) { const s = m[0].trim(); if (s) out.push(s); if (!m[0].length) re.lastIndex++; }
    return out;
  }
  const words = s => String(s || '').match(/[A-Za-z0-9][A-Za-z0-9’'-]*/g) || [];
  /* every match, with no repeats, as the writer wrote it */
  function finds(t, re) {
    const seen = {}, out = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      const k = m[0].toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(m[0]); }
      if (!m[0].length) re.lastIndex++;
    }
    return out;
  }
  const q = s => '“' + s + '”';
  const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const first = (s, n) => { const w = s.split(/\s+/); return w.length > n ? w.slice(0, n).join(' ') + '…' : s; };
  /* the first sentence that holds one of the found words, for "Your turn" */
  function sentenceWith(t, hits) {
    const ss = sentences(t);
    for (const s of ss) for (const h of hits) if (s.toLowerCase().indexOf(h.toLowerCase()) >= 0) return s;
    return ss[0] || '';
  }

  /* ---- what each coach looks for ---- */
  const FEEL = '(?:sad|happy|angry|nervous|anxious|afraid|scared|frightened|excited|tired|exhausted|bored|lonely|jealous|ashamed|embarrassed|proud|worried|upset|furious|calm|relieved|confused|surprised|shocked|disappointed|frustrated|hopeful|guilty|miserable|delighted|thrilled|terrified|overwhelmed|heartbroken|content|annoyed|irritated|grateful|desperate|hurt)';
  const TELL = new RegExp('\\b(?:felt|feel|feels|feeling|was|were|is|are|am|seemed|seems|looked|looks|became|becomes|got|grew)\\s+(?:very |so |really |quite |extremely |a bit |rather |deeply |utterly )?' + FEEL + '\\b|\\b(?:with|in|out of) (?:anger|joy|fear|sadness|happiness|excitement|frustration|relief|despair|panic)\\b|\\b(?:angrily|sadly|happily|nervously|anxiously|excitedly|fearfully|joyfully|miserably)\\b', 'gi');
  const VAGUE = /\b(?:things?|stuff|nice|good|bad|great|interesting|a lot|lots|very|really|big|small|something|somewhere|someone|somehow|kind of|sort of|beautiful|amazing|awesome|cool|fine|okay|ok)\b/gi;
  const LINK = /^(?:However|Therefore|Thus|Hence|Moreover|Furthermore|Additionally|In addition|Also|First|Firstly|Second|Secondly|Third|Thirdly|Finally|Lastly|Next|Then|Meanwhile|For example|For instance|In particular|Specifically|Notably|In contrast|By contrast|Conversely|On the other hand|Similarly|Likewise|Consequently|As a result|Accordingly|Nevertheless|Nonetheless|Yet|Still|Instead|Indeed|In fact|In short|In sum|Overall|Above all|To this end|In turn|This|These|Such|That|Admittedly|Of course|Granted|Equally|Even so|Ultimately|Taken together|By extension)\b/;
  const SOURCE = /^(?:[A-Z][A-Za-z’'-]+(?: (?:and|&) [A-Z][A-Za-z’'-]+| et al\.?)?\s*\(\d{4}[a-z]?\)|According to [A-Z]|[A-Z][A-Za-z’'-]+(?: (?:and|&) [A-Z][A-Za-z’'-]+| et al\.?)? (?:argues|argued|states|stated|claims|claimed|finds|found|shows|showed|suggests|suggested|notes|noted|says|said|writes|wrote|reports|reported|believes|believed|contends|maintains|observes|observed|proposes|proposed))/;
  /* a sentence led by a source: "Smith (2019) found", "According to Lee";
     not "One found" or "Research shows", whose first word is no name */
  const NOTNAME = /^(?:One|Two|Three|Four|Five|This|That|These|Those|It|He|She|They|We|I|You|Research|Evidence|Work|Data|Study|Studies|Analysis|The|A|An|Each|Every|Most|Some|Many|Other|Others|Later|Earlier|Recent|Previous|Further|Both|Neither|Either|Such|Here|There|Experts|Scholars|Critics|Historians|Scientists|Researchers|Authors|Writers|Teachers|Students|Readers|Reviewers|Everyone|Nobody|Someone|Science|History|Theory|Literature)$/;
  const isSource = s => SOURCE.test(s) && (/^According to/.test(s) || !NOTNAME.test((s.match(/^[A-Za-z’'-]+/) || [''])[0]));
  const VAGUEQ = /\b(?:some|several|a few|many|various|numerous|a number of|approximately|roughly|around|about|a lot of|lots of|a while|a long time|recently|soon|later|eventually|at some point|regularly|often|sometimes|a little|a bit|quite a few)\b/gi;
  const ORDER = /\b(?:first|firstly|second|secondly|then|next|after|afterwards|finally|subsequently|before|following)\b/i;
  const HEDGES = /\b(?:may|might|could|perhaps|possibly|probably|somewhat|arguably|seems?|appears?|apparently|likely|tends? to|I think|I believe|it is possible|in a sense|to some extent|sort of|kind of)\b/gi;
  const ABSOL = /\b(?:always|never|all|none|every|everyone|everything|nobody|no one|nothing|entirely|completely|totally|undoubtedly|definitely|certainly|proves?|proved|must|impossible|without exception)\b/gi;
  const BLUNT = /\b(?:you must|you need to|you have to|you should|must|wrong|failed?|failure|unacceptable|immediately|asap|obviously|clearly|demand|insist|never|always|your fault|you did not|you didn['’]t)\b/gi;
  const LOADED = /\b(?:amazing|incredible|terrible|awful|horrible|fantastic|wonderful|shocking|outrageous|ridiculous|absurd|disastrous|brilliant|pathetic|stupid|disgraceful|appalling|glorious|tragic|unbelievable|insane|crazy|perfect|worst|best)\b/gi;
  const PASSIVE = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:[a-z]+ed|written|taken|given|shown|seen|done|known|made|found|held|built|sent|told|sold|said|brought|thought|bought|caught|taught|led|read|put|set|chosen|driven|spoken|broken|drawn|grown|thrown|won|kept|lost|paid|understood|felt|heard|begun|hidden|stolen|forgotten)\b(?! by)/gi;
  const REASON = /\b(?:because|since|as a result|so that|therefore|thus|for example|for instance|such as|this means|which means|in other words|that is|i\.e\.|e\.g\.)\b/i;
  const PROBLEM = /\b(?:problem|gap|unclear|unknown|little is known|remains?|challenge|question|debate|however|yet|lack|limited|few studies|unresolved|contested)\b/i;
  const APPROACH = /\b(?:we|this (?:study|paper|thesis|chapter|article|project)|using|uses?|examines?|investigates?|analy[sz]es|analy[sz]ed|method|interviews?|surveys?|data|sample|corpus|experiments?|trial|compares?|draws on)\b/i;
  const FINDING = /\b(?:found|find|finds|shows?|showed|results?|reveals?|revealed|indicates?|indicated|suggests?|suggested|demonstrates?|identif(?:y|ies|ied))\b/i;
  const IMPLIC = /\b(?:implications?|therefore|thus|contributes?|significance|significant for|matters?|future|policy|practice|informs?|calls? for|should|recommend)\b/i;

  /* each coach: what it found in the passage, how to change it, an example,
     and how to check the writer's own try. found() returns the words
     ("hits") and a sentence to try on; nothing found means this coach has
     nothing to say about the passage, and it says so plainly */
  const C = {
    show: {
      title: 'Show, don’t tell',
      found(t) { const h = finds(t, TELL); return { hits: h, say: h.length ? list(h.map(q)) + (h.length === 1 ? ' names a feeling.' : ' name feelings.') + ' The reader is told, not shown.' : 'No feeling is named outright. The passage already shows rather than tells.' }; },
      how: 'Replace the named feeling with what a camera would catch: what the body does, what is said, what is done.',
      ex: ['She was nervous before the interview.', 'She turned her ring twice and read the same line of her notes three times.'],
      check(src, mine) { const h = finds(mine, TELL); return h.length ? q(h[0]) + ' still tells the feeling. What would someone watching see?' : 'No feeling is named now; it comes through what happens.'; }
    },
    vivid: {
      title: 'Vivid and concrete',
      found(t) { const h = finds(t, VAGUE); return { hits: h, say: h.length ? list(h.slice(0, 6).map(q)) + (h.length === 1 ? ' is' : ' are') + ' general. A reader cannot picture ' + (h.length === 1 ? 'it.' : 'them.') : 'No general words stand out. The detail is already concrete.' }; },
      how: 'Ask “which one, exactly?” of each general word, and name it: the colour, the sound, the number, the kind.',
      ex: ['The room had a lot of old stuff in it.', 'The room held three cracked violins and a stack of yellowed scores.'],
      check(src, mine) { const before = finds(src, VAGUE).length, now = finds(mine, VAGUE); return now.length ? q(now[0]) + ' is still general. Which one, exactly?' : (before ? 'Every general word is now a particular one.' : 'Concrete throughout.'); }
    },
    signpost: {
      title: 'Signpost the argument',
      found(t) {
        const ss = sentences(t);
        if (ss.length < 2) return { hits: [], say: 'Signposts link sentences, so select at least two.' };
        const bare = ss.slice(1).filter(s => !LINK.test(s));
        return { hits: bare.map(s => first(s, 4)), on: bare[0], say: bare.length ? plural(ss.length - 1 - bare.length, 'of the later sentences opens', 'of the later sentences open') + ' with a link to the one before. ' + (bare.length === 1 ? 'This one does not: ' : 'These do not: ') + list(bare.slice(0, 3).map(s => q(first(s, 4)))) + '.' : 'Every later sentence opens with a link to the one before.' };
      },
      how: 'Open each step with how it relates to the last: adding (Moreover), contrasting (However), causing (Therefore), illustrating (For example), concluding (Thus).',
      ex: ['The sample was small. The effect was large.', 'The sample was small. Even so, the effect was large.'],
      check(src, mine) { return LINK.test(mine.trim()) ? 'It now opens with a link, so the reader knows how it follows.' : 'Start it with a link word that says how it follows from the sentence before.'; }
    },
    topic: {
      title: 'A topic sentence',
      found(t) {
        const s = sentences(t)[0] || '';
        const issues = [];
        if (/\?$/.test(s)) issues.push('it is a question');
        if (/^["“]/.test(s)) issues.push('it opens with a quotation');
        if (/^[A-Z][A-Za-z’'-]+(?: et al\.?)?\s*\(\d{4}/.test(s) || /^According to/.test(s)) issues.push('it opens with a source, not your point');
        if (words(s).length < 6) issues.push('it is very short');
        return { hits: s ? [s] : [], on: s, say: s ? 'The passage opens: ' + q(first(s, 14)) + (issues.length ? ' Here ' + list(issues) + '.' : ' Check that it states the point the rest supports.') : 'There is no sentence to read yet.' };
      },
      how: 'State the paragraph’s point in your own words first: what will the reader know by the end? The evidence follows it.',
      ex: ['In 2019, forty schools took part in a trial.', 'Smaller classes helped pupils less than better teaching did.'],
      check(src, mine) { const s = sentences(mine)[0] || ''; if (/\?$/.test(s)) return 'A question opens a topic; a topic sentence answers it.'; if (/^[A-Z][A-Za-z’'-]+(?: et al\.?)?\s*\(\d{4}/.test(s)) return 'It still opens with a source. Lead with your point, then the source.'; return words(s).length < 6 ? 'A little more: what is the claim, and about what?' : 'It states a point the paragraph can now support.'; }
    },
    synthesis: {
      title: 'Synthesis, not a list',
      found(t) {
        const ss = sentences(t), led = ss.filter(isSource);
        return { hits: led.map(s => first(s, 3)), on: led[0], say: led.length >= 2 ? plural(led.length, 'sentence', 'sentences') + ' of ' + ss.length + ' begin with a source: ' + list(led.slice(0, 3).map(s => q(first(s, 3)))) + '. The paragraph reads as a list of who said what.' : 'The sentences lead with ideas, not with sources. That is already synthesis.' };
      },
      how: 'Group the sources by what they share or dispute, and lead with the idea: “Both X and Y find…”, “Whereas X…, Y…”. The names follow the idea.',
      ex: ['Smith (2019) found a fall. Jones (2020) found a fall too.', 'Two studies found a fall (Smith 2019; Jones 2020).'],
      check(src, mine) { const n = sentences(mine).filter(isSource).length; return n ? 'It still opens with a source. Start with the idea the sources share.' : 'It now leads with the idea; the sources support it.'; }
    },
    method: {
      title: 'A precise method',
      found(t) {
        const h = finds(t, VAGUEQ), ord = ORDER.test(t), ss = sentences(t);
        const say = (h.length ? list(h.slice(0, 6).map(q)) + (h.length === 1 ? ' is' : ' are') + ' not exact enough to repeat.' : 'The quantities are exact.') + (ss.length > 2 && !ord ? ' No word marks the order of the steps.' : '');
        return { hits: h, say: say };
      },
      how: 'Write it so another researcher could repeat it: exact numbers, units and durations, and the order of the steps (First, Then, Finally).',
      ex: ['Some participants were tested for a while.', 'Twenty-four participants were each tested for thirty minutes.'],
      check(src, mine) { const h = finds(mine, VAGUEQ); return h.length ? q(h[0]) + ' could still be exact: how many, how long?' : 'Exact enough to repeat.'; }
    },
    abstract: {
      title: 'Abstract style',
      found(t) {
        const parts = [['the problem', PROBLEM], ['the approach', APPROACH], ['the finding', FINDING], ['why it matters', IMPLIC]];
        const has = parts.filter(p => p[1].test(t)).map(p => p[0]), miss = parts.filter(p => !p[1].test(t)).map(p => p[0]);
        return { hits: miss, say: (has.length ? 'Present: ' + list(has) + '. ' : '') + (miss.length ? 'Not yet clear: ' + list(miss) + '.' : 'All four parts are there.') };
      },
      how: 'An abstract answers four questions in order, a sentence or two each: What problem? What did you do? What did you find? Why does it matter?',
      ex: ['(problem) Little is known about … (approach) This study interviews … (finding) It finds that … (why it matters) This suggests that …', ''],
      check(src, mine) { const miss = [['the problem', PROBLEM], ['the approach', APPROACH], ['the finding', FINDING], ['why it matters', IMPLIC]].filter(p => !p[1].test(mine)).map(p => p[0]); return miss.length ? 'Still to add: ' + list(miss) + '.' : 'Problem, approach, finding and why it matters are all there.'; }
    },
    rhythm: {
      title: 'Rhythm and pace',
      found(t) {
        const ss = sentences(t), n = ss.map(s => words(s).length);
        if (ss.length < 3) return { hits: [], say: 'Rhythm lives across sentences, so select three or more.' };
        let flat = 0;
        for (let i = 2; i < n.length; i++) if (Math.max(n[i], n[i - 1], n[i - 2]) - Math.min(n[i], n[i - 1], n[i - 2]) <= 3) flat++;
        const open = {}; ss.forEach(s => { const w = (words(s)[0] || '').toLowerCase(); open[w] = (open[w] || 0) + 1; });
        const rep = Object.keys(open).filter(w => open[w] >= 3 && w);
        return { hits: rep, say: 'Sentence lengths: ' + n.join(', ') + ' words.' + (flat ? ' Runs of similar length make a steady drone.' : ' The lengths already vary.') + (rep.length ? ' ' + plural(open[rep[0]], 'sentence opens', 'sentences open') + ' with ' + q(rep[0][0].toUpperCase() + rep[0].slice(1)) + '.' : '') };
      },
      how: 'Vary the beat: after a long sentence, a short one lands. Read it aloud and listen for where you breathe.',
      ex: ['We walked for hours. We were tired. We stopped at the inn.', 'We walked for hours, until the road blurred. Tired, we stopped at the inn.'],
      check(src, mine) { const n = sentences(mine).map(s => words(s).length); if (n.length < 2) return 'Try two sentences of different lengths.'; return Math.max.apply(null, n) - Math.min.apply(null, n) >= 6 ? 'The lengths now vary; read it aloud to hear the change.' : 'The sentences are still close in length. Make one much shorter.'; }
    },
    expand: {
      title: 'Expand without new facts',
      found(t) {
        const bare = sentences(t).filter(s => words(s).length > 4 && !REASON.test(s));
        return { hits: bare.map(s => first(s, 4)), on: bare[0], say: 'Offline, Inkwell adds no words of its own, so the expansion is yours. ' + (bare.length ? plural(bare.length, 'sentence states', 'sentences state') + ' a point with no reason or example after it.' : 'Each sentence already gives a reason or an example.') };
      },
      how: 'After a claim, add one of three things from your own notes: the reason (because…), an example (for example…), or what it means (this means…).',
      ex: ['Smaller classes did not help.', 'Smaller classes did not help, because the extra teachers were the least experienced.'],
      check(src, mine) { return REASON.test(mine) ? 'It now says why, or shows an example.' : 'Add a reason (because…) or an example (for example…).'; }
    },
    warm: {
      title: 'A warmer tone',
      found(t) {
        const you = /\b(?:you|your|we|our|us)\b/i.test(t), thanks = /\b(?:thank|thanks|please|glad|happy to|hope)\b/i.test(t);
        const notes = [];
        if (!you) notes.push('it does not speak to the reader (“you”, “we”)');
        if (!thanks) notes.push('it has no thanks or “please”');
        return { hits: notes, say: notes.length ? 'The passage sounds formal: ' + list(notes) + '.' : 'It already speaks to the reader warmly.' };
      },
      how: 'Write to one person: “you” and “we”, a contraction or two, and thanks where it is due.',
      ex: ['Applicants must submit the form by Friday.', 'Please send us your form by Friday. Thank you!'],
      check(src, mine) { return /\b(?:you|your|we|our)\b/i.test(mine) ? 'It now speaks to the reader.' : 'Try addressing the reader as “you”.'; }
    },
    diplomatic: {
      title: 'A diplomatic tone',
      found(t) { const h = finds(t, BLUNT); return { hits: h, say: h.length ? list(h.slice(0, 5).map(q)) + ' may sound blunt or blaming to the reader.' : 'Nothing reads as blunt. The tone is already courteous.' }; },
      how: 'Keep the substance, soften the demand: “Could we…”, “It would help if…”, “I wonder whether…”. Name the issue, not the person.',
      ex: ['You must fix this today.', 'Could you fix this today? It would help us finish on time.'],
      check(src, mine) { const h = finds(mine, BLUNT); return h.length ? q(h[0]) + ' may still sound blunt.' : 'Courteous, and the request is still clear.'; }
    },
    absolutes: {
      title: 'Claims that admit no exception',
      found(t) { const h = finds(t, ABSOL); return { hits: h, say: h.length ? list(h.slice(0, 6).map(q)) + (h.length === 1 ? ' claims' : ' claim') + ' every case, or certainty. Does the evidence cover every case?' : 'No absolute words. The claims are already measured.' }; },
      how: 'Keep an absolute word only where the evidence covers every case. Otherwise “often”, “most”, “rarely”, “suggests”.',
      ex: ['Students always learn more in small classes.', 'Students often learn more in small classes.'],
      check(src, mine) { const h = finds(mine, ABSOL); return h.length ? q(h[0]) + ' still claims every case: is that what the evidence shows?' : 'Measured: the claim now matches what the evidence can show.'; }
    },
    claim: {
      title: 'A sharper claim',
      found(t) {
        const h = finds(t, HEDGES), ss = sentences(t);
        return { hits: h, say: h.length ? plural(h.length, 'softener', 'softeners') + ' (' + list(h.slice(0, 5).map(q)) + ') in ' + plural(ss.length, 'sentence', 'sentences') + '. One careful hedge signals care; several blur the point.' : 'No softeners: the claim is stated plainly.' };
      },
      how: 'State the claim once, plainly, then the evidence for it: “X causes Y, because …”. Keep a hedge only where the evidence is uncertain.',
      ex: ['It could perhaps be argued that class size may matter.', 'Class size matters, as the two trials show.'],
      check(src, mine) { const h = finds(mine, HEDGES); return h.length > 1 ? plural(h.length, 'softener is', 'softeners are') + ' left. Which one does the evidence need?' : 'The claim is plain now.'; }
    },
    long: {
      title: 'Long sentences',
      found(t) {
        const ss = sentences(t), lg = ss.filter(s => words(s).length > 28);
        return { hits: lg.map(s => first(s, 4)), on: lg[0], say: lg.length ? plural(lg.length, 'sentence runs', 'sentences run') + ' past 28 words, the length at which readers start to lose the thread: ' + list(lg.slice(0, 2).map(s => q(first(s, 5)))) + '.' : 'No sentence runs past 28 words.' };
      },
      how: 'Find where a second idea begins (often at “and”, “which” or a semicolon) and start a new sentence there.',
      ex: ['The trial ran for a year and it found that smaller classes helped, which surprised the team.', 'The trial ran for a year. It found that smaller classes helped, which surprised the team.'],
      check(src, mine) { const n = sentences(mine).map(s => words(s).length); return n.some(x => x > 28) ? 'One sentence is still past 28 words.' : 'Each sentence now carries a load a reader can hold.'; }
    },
    passive: {
      title: 'Who did it?',
      found(t) { const h = finds(t, PASSIVE); return { hits: h, say: h.length ? list(h.slice(0, 4).map(q)) + ' hide' + (h.length === 1 ? 's' : '') + ' who acted. Inkwell can only turn a sentence round when it names the doer after “by”.' : 'Every action says who did it.' }; },
      how: 'Ask who did it, and start with them: “The samples were analysed” becomes “We analysed the samples”. Keep the passive where the doer truly does not matter.',
      ex: ['The results were checked twice.', 'Two reviewers checked the results twice.'],
      check(src, mine) { const h = finds(mine, PASSIVE); return h.length ? q(h[0]) + ' still hides who acted.' : 'The doer now comes first.'; }
    },
    loaded: {
      title: 'Words that judge',
      found(t) { const h = finds(t, LOADED); return { hits: h, say: h.length ? list(h.slice(0, 5).map(q)) + (h.length === 1 ? ' is a judgement' : ' are judgements') + ', not a measure.' : 'No judging words remain. The tone is neutral.' }; },
      how: 'Replace each judgement with the fact behind it: a number, a comparison, or what happened.',
      ex: ['The results were terrible.', 'Two of the ten tests passed.'],
      check(src, mine) { const h = finds(mine, LOADED); return h.length ? q(h[0]) + ' still judges. What is the fact behind it?' : 'Neutral: the facts carry the weight.'; }
    },
    cut: {
      title: 'Shorter by a third',
      found(t) {
        const n = words(t).length, ss = sentences(t), target = Math.round(n * 2 / 3);
        const longest = ss.slice().sort((a, b) => words(b).length - words(a).length)[0] || '';
        return { hits: [longest], on: longest, n: n, target: target, say: 'The passage has ' + n + ' words; a third shorter is about ' + target + '. Rules can trim phrases, but a third usually means cutting a whole sentence or clause.' };
      },
      how: 'Find the sentence the argument could lose: a repeat, a detour, or a point made twice. Then trim the phrases in what is left.',
      ex: ['', ''],
      check(src, mine) { const a = words(src).length, b = words(mine).length; return b >= a ? 'It is not shorter yet.' : 'Shorter by ' + Math.round(100 * (a - b) / a) + '%.'; }
    }
  };

  /* ---- a prompt, read for what it asks ---- */
  const ASK = [
    [/\bshow\b.*\btell\b|\bshow,? (?:don['’]t|do not)\b/i, [], ['show']],
    [/\bvivid|concrete|imager|sensory|descriptive|paint a picture/i, [], ['vivid']],
    [/\bsignpost|transition|link(?:s|ing)? (?:the )?(?:steps|sentences|ideas)|flow of the argument/i, [], ['signpost']],
    [/\btopic sentence|opening sentence|first sentence/i, [], ['topic']],
    [/\bsynthes/i, [], ['synthesis']],
    [/\bmethod|replicab|reproducib/i, [], ['method']],
    [/\babstract\b/i, [], ['abstract']],
    [/\blyric|rhythm|poetic|musical|cadence/i, [], ['rhythm']],
    [/\bpac(?:e|ing)\b/i, ['concise'], ['rhythm']],
    [/\bexpand|elaborat|longer|develop (?:it|this)|flesh out/i, [], ['expand']],
    [/\bwarm|friendly|approachable|kinder\b|gentle/i, ['casual'], ['warm']],
    [/\bdiplomat|courteous|polite|tactful|softer|gentler/i, [], ['diplomatic']],
    [/\bhedge|cautious|careful (?:claims?|wording)|tentative|match (?:the )?evidence|overclaim/i, ['hedge'], ['absolutes']],
    [/\bsharpen|explicit|clear(?:er)? claim|central claim|thesis statement/i, ['confident'], ['claim']],
    [/\bconfiden|assertive|decisive|stronger|bold/i, ['confident'], ['claim']],
    [/\bneutral|objective|impartial|unbiased|balanced/i, ['neutral'], ['loaded']],
    [/\bactive voice|active\b|passive/i, ['active'], ['passive']],
    [/\bone idea|split|break (?:it )?up|shorter sentences|long sentences/i, ['split'], ['long']],
    [/\bshorter by|a third|half|cut (?:it )?(?:down|by)|condense|trim/i, ['shorten'], ['cut']],
    [/\bshort(?:er|en)?\b|brief|concise|tight|wordy|wordiness/i, ['concise', 'shorten'], []],
    [/\bsimplif|simple|plain(?:er)?|easier|general reader|readab|accessible/i, ['simplify'], ['long']],
    [/\bdphil|phd|doctoral|thesis|scholarly|academic|formal|register/i, ['scholarly'], []],
    [/\bprofessional|polish|business|workplace/i, ['professional'], []],
    [/\bcasual|relaxed|informal|conversational/i, ['casual'], []],
    [/\bcorrect only|only (?:the )?(?:grammar|spelling)|proofread|fix (?:the )?(?:grammar|spelling|errors|mistakes)|grammar|spelling|punctuation/i, ['correct'], []],
    [/\bnatural|native|fluent|idiomatic/i, [['correct', 'concise']], []],
    [/\bimprove|better|clarity|clearer|clear\b/i, [['correct', 'concise']], ['long']]
  ];
  /* every rule rewrite and coach the prompt asks for, in order, without repeats.
     A step that is a list is one rewrite made of several (correct, then concise). */
  function plan(prompt) {
    const p = String(prompt || ''), rw = [], coach = [], seen = {};
    for (const [re, r, c] of ASK) if (re.test(p)) {
      r.forEach(x => { const k = [].concat(x).join('+'); if (!seen['r' + k]) { seen['r' + k] = 1; rw.push(x); } });
      c.forEach(x => { if (!seen['c' + x]) { seen['c' + x] = 1; coach.push(x); } });
    }
    return { rw: rw, coach: coach, known: !!(rw.length || coach.length) };
  }
  /* one coach's reading of a passage, ready for the panel */
  function read(id, t) {
    const c = C[id]; if (!c) return null;
    const f = c.found(String(t || ''));
    return { id: id, title: c.title, say: f.say, hits: f.hits, how: c.how, ex: c.ex, on: f.on || sentenceWith(t, f.hits || []), n: f.n, target: f.target };
  }
  function check(id, src, mine) { const c = C[id]; return c ? c.check(String(src || ''), String(mine || '')) : ''; }
  const api = { plan: plan, read: read, check: check, ids: Object.keys(C), sentences: sentences };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKCOACH = api;
})(typeof self !== 'undefined' ? self : this);
