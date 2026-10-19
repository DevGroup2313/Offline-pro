/* Inkwell's spelling checker, offline. A word the dictionary lacks is marked
   and given suggestions: the known words one or two keystroke-errors away
   (a letter missing, added, changed or two swapped), ranked by how likely
   the slip is (a neighbouring key, a doubled letter, a vowel for a vowel)
   and by how common the word is. The dictionary is SCOWL (Kevin Atkinson's
   word lists, permissive licence; vendor/SCOWL-LICENCE.txt), British,
   American and Canadian spellings, sizes 10 to 70, each word kept with its
   size as a measure of how common it is. 7.43: and size 80, the vocabulary
   of specialised and scholarly writing (tools/grammar/mkdict.py), counted
   as known but never offered as a correction; words formed from known
   words by the usual prefixes and suffixes of scholarly English
   ("neuroethics", "operationalize", "sagehood"); a name at the start of a
   sentence; and a term the writer uses three times or more.
   Pure functions; shared by the app and its test harness. */
(function (root) {
  const LEVEL_COST = { 10: 0, 20: 0.04, 35: 0.08, 40: 0.12, 50: 0.2, 55: 0.26, 60: 0.38, 70: 0.7 };
  const lc = lv => { for (const k of [10, 20, 35, 40, 50, 55, 60, 70]) if (lv <= k) return LEVEL_COST[k]; return 0.9; };
  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const POS = {}; ROWS.forEach((r, y) => [...r].forEach((c, x) => { POS[c] = [x + y * 0.5, y]; }));
  const near = (a, b) => { const p = POS[a], q = POS[b]; return p && q && Math.abs(p[0] - q[0]) <= 1.01 && Math.abs(p[1] - q[1]) <= 1; };
  const VOW = new Set('aeiouy');
  const ABC = 'abcdefghijklmnopqrstuvwxyz';
  const PREFIX = new Set('pre post non anti co re self semi multi inter intra sub super ultra mid ex pro counter neo quasi pseudo micro macro mini bi tri un well cross over under out e socio neuro psycho bio meta proto techno cyber geo eco auto hyper hypo trans infra extra retro tele mono poly para'.split(' '));
  /* 7.43: the Latin of scholarly prose and its apparatus, and Roman numerals */
  const LATIN = new Set('se vitro vivo situ sensus communis ibid idem passim viz alia mutandis mutatis facie priori posteriori jure sui generis paribus ceteris qua quo versa fide bona ante sine ergo sic supra infra et al cf vs qtd foci syllabi lemmata schemata stigmata minutiae personae formulae vertebrae larvae algae alumnae'.split(' ')
    /* 7.47: and the Latin and Greek terms of philosophy, law and the
       humanities ("prima facie", "stricto sensu", "analogia entis") */
    .concat('factical facticity thrownness ownmost worldhood enframing prima stricto lato sensu modus operandi vivendi analogia entis substantia individua rationalis ipso facto novo hominem infinitum nauseam fortiori contrario relata relatum explanandum explanans definiendum definiens desideratum desiderata apud seq sqq judice obiter dicta dictum decidendi stare decisis locus standi mens rea actus reus amicus curiae habeas lege lex scripta nullius imago dei telos eudaimonia phronesis poiesis techne episteme doxa praxis aporia arete hexis kairos qua sic'.split(' ')));
  /* the particles of Arabic names ("Muhammad ibn Tarhan"); "al-" names are
     names */
  const NAME_PART = new Set('ibn bin bint abu abd abdul al el ul ud'.split(' '));
  /* 7.47: bases whose plural or past is irregular: "childs" and "teached"
     stay marked though "child" and "teach" are words */
  const IRREG = new Set('child woman foot tooth mouse goose criterion phenomenon teach catch bring think write speak break choose drive begin build drink fight forget forgive freeze sleep steal sweep swing swear throw understand stand spend send lend shake shine shoot sling sting stink strike strive swim wake ride arise bleed breed cling creep dwell flee fling grind kneel leave light mislead seek sell shrink slide speed split spread spring stride swell tear thrust tread upset weep wind withdraw undertake overtake mistake forbid forsake'.split(' '));
  const ROMAN = /^(?=[ivxlc]{1,7}$)(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
  const RUN_ON = new Set('a an in at as of on up so no to each even every any some all thank per out over be'.split(' '));
  const CALENDAR = /^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;

  /* the dictionary: lines "level word word ..." */
  function load(text) {
    const exact = new Map(), lower = new Map();
    for (const line of String(text || '').split('\n')) {
      const sp = line.indexOf(' '); if (sp < 1) continue;
      const lv = +line.slice(0, sp);
      for (const w of line.slice(sp + 1).split(' ')) {
        if (!w) continue;
        if (!exact.has(w) || exact.get(w) > lv) exact.set(w, lv);
        const l = w.toLowerCase();
        /* a lower-case entry is a word anyone may capitalise; a capitalised
           one (a name) is known in lower case only for lookup, not offered */
        if (!lower.has(l) || lower.get(l).lv > lv || (w === l && !lower.get(l).plain)) lower.set(l, { lv, plain: w === l, form: w });
      }
    }
    return { exact, lower, size: exact.size, memo: new Map() };
  }
  function level(D, w) {
    if (D.exact.has(w)) return D.exact.get(w);
    const l = w.toLowerCase(), e = D.lower.get(l);
    if (!e) return -1;
    /* "Paris" may be written "Paris"; "paris" is not the name */
    if (!e.plain && w === l) return -1;
    return e.lv;
  }
  function known(D, w) {
    if (level(D, w) >= 0) return true;
    const m = /^(.+?)(?:'s|’s|s'|’)$/.exec(w); if (m && level(D, m[1]) >= 0) return true;
    const lw = w.toLowerCase();
    if (w.indexOf('-') > 0) {
      if (w.split('-').every(p => p && (level(D, p) >= 0 || /^\d+$/.test(p) || PREFIX.has(p.toLowerCase()) || inflected(D, p.toLowerCase())))) return true;
      /* 7.47: "pre-emptive", "co-operate", "re-examine": the British hyphen
         after a prefix, where the word without it is known */
      const j = lw.replace(/-/g, ''), pre = lw.slice(0, lw.indexOf('-'));
      return PREFIX.has(pre) && (level(D, j) >= 0 || inflected(D, j));
    }
    if (variant(D, lw) || inflected(D, lw)) return true;
    const f = formed(D, lw, 2);
    return f === 'suf' || (f === 'pre' && !nearCommon(D, lw));
  }
  /* a formation one slip from a common word is that word misspelt:
     "intergrated" (integrated), "transpotation" (transportation). 7.47: not
     when the common word is the same formation with another prefix
     ("devitalization", "revitalization"; "miscrediting", "discrediting") or
     the word without its prefix ("atemporal", "temporal") */
  function nearCommon(D, w) {
    for (const [c] of edits1(w)) {
      if (c + 's' === w) continue; // its own singular: "declaratives"
      const e = D.lower.get(c); if (!(e && e.plain && e.lv <= 70)) continue;
      if ((w[0] === 'a' && c === w.slice(1)) || FORM_PRE.some(p => w.startsWith(p) && (c === w.slice(p.length) || FORM_PRE.some(q => q !== p && c.startsWith(q) && c.slice(q.length) === w.slice(p.length))))) continue;
      return true;
    }
    return false;
  }
  /* 7.47: the British forms of known American ones: -ise for -ize
     ("weaponised"), oe and ae ("foetal", "aetiological", "paediatric"), a
     consonant doubled before -ed, -ing and -es ("focusses", "modelled") */
  function variant(D, w) {
    const ok = x => x !== w && (level(D, x) >= 0 || inflected(D, x));
    if (/is(?:e|es|ed|ing|ation|ations|er|ers)$/.test(w) && ok(w.replace(/is(e|es|ed|ing|ation|ations|er|ers)$/, 'iz$1'))) return true;
    if (/(?:^|[^a])(?:oe|ae)/.test(w) && ok(w.replace(/oe/, 'e').replace(/ae/, 'e'))) return true;
    if (/(ll|ss)(?:ed|ing|es|er|ers)$/.test(w) && ok(w.replace(/(ll|ss)(ed|ing|es|er|ers)$/, (m0, d, suf) => d[0] + suf))) return true;
    return false;
  }
  /* 7.47: a regular inflection or derivation of a known word is a word:
     "attaches", "logics", "triaging", "cognitions", "interiority",
     "personalist", "enaction", "intubation", "relatedly". Measured on 40
     published articles (247,426 words): 85 of the 97 spelling fixes were
     wrong, most of them such words "corrected" to a neighbour one letter
     away ("attaches" to "attached", "interiority" to "inferiority",
     "intubation" to "incubation"). Being one slip from a common word is no
     reason against a word built by rule from a known one. A single
     consonant where the known form doubles it is ("occured": "occurred"),
     and so is a form made the wrong way ("studys", "attachs", "teached"). */
  const SIB = /(?:s|x|z|ch|sh)$/, CY = /[^aeiou]y$/;
  const STOPW = new Set('again until which there their where about above after along among around before behind below beside between beyond during except inside outside since through toward towards under unless while within without whose other these those'.split(' '));
  const INFL = [['es', ''], ['s', ''], ['ies', 'y'], ['ied', 'y'], ['ed', ''], ['d', ''], ['ing', ''], ['ing', 'e'],
    ['ion', ''], ['ion', 'e'], ['ions', ''], ['ions', 'e'], ['ity', ''], ['ities', ''], ['ist', ''], ['ist', 'e'], ['ists', ''], ['ists', 'e'],
    ['ism', 'e'], ['isms', 'e'], ['ly', ''], ['able', 'e']];
  const plainBase = (D, b) => b.length >= 5 && !!D.lower.get(b) && D.lower.get(b).plain;
  function inflected(D, w) {
    if (!/^[a-z]{6,}$/.test(w)) return false;
    for (const [suf, add] of INFL) {
      if (!w.endsWith(suf) || w.length - suf.length < 4) continue;
      const cut = w.slice(0, w.length - suf.length), b = cut + add;
      /* the British doubled consonant: "focussed", "travelled" */
      const dbl = /(ed|ing|es)$/.test(suf) && !add && /([lst])\1$/.test(cut) && plainBase(D, cut.slice(0, -1)) ? cut.slice(0, -1) : '';
      const base = plainBase(D, b) ? b : dbl;
      if (!base || IRREG.has(base) || STOPW.has(base)) continue;
      /* -ion after a verb's own ending only ("enaction", "intubation"; not
         "guestion"), and a dropped e only after a common or -ate base (not
         "launcing" from "launce") */
      if (/^ions?$/.test(suf) && !(add ? /(?:ate|ute)$/.test(base) : /(?:ct|pt|ss|rt)$/.test(base))) continue;
      if (suf === 'ing' && add && !(D.lower.get(base).lv <= 60 || /(?:ate|ize|ise)$/.test(base))) continue;
      if (suf === 'es' && !dbl && (!SIB.test(base) || /(?:sis|xis)$/.test(base))) continue;
      if (suf === 's' && (SIB.test(base) || CY.test(base))) continue;
      if (suf === 'd' && !/e$/.test(base)) continue;
      if ((suf === 'ed' || (suf === 'ing' && !add)) && (/e$/.test(base) && suf === 'ed' || CY.test(base) && suf === 'ed')) continue;
      if ((suf === 'ed' || suf === 'ing') && !add && !dbl) {
        const last = base.slice(-1);
        if (/[^aeiouwxy]/.test(last) && /[aeiou]/.test(base.slice(-2, -1)) && !/[aeiou]/.test(base.slice(-3, -2)) && D.lower.has(base + last + suf)) continue;
      }
      if (suf === 'ly' && !/(?:ive|al|ous|ar|ed)$/.test(base)) continue;
      return true;
    }
    return false;
  }
  /* 7.43: a word formed from a known one by a prefix or suffix of scholarly
     English. Each part must be a known word of five letters or more, so a
     slip is not taken for a formation: "unecessary" (no "ecessary"),
     "basicly" (no "-ly" after "-ic"), "accidently" (no "-ly" after
     "-ent"), "occuring" ("-ing" only replaces a final "e": "triaging"). */
  const FORM_PRE = ['neuro', 'socio', 'psycho', 'bio', 'meta', 'proto', 'pseudo', 'post', 'pre', 'non', 'anti', 'counter', 'inter', 'intra', 'multi', 'trans', 'hetero', 'homo', 'cyber', 'techno', 'geo', 'eco', 'auto', 'hyper', 'hypo', 'macro', 'micro', 'mis', 'dis', 'de', 're', 'un', 'over', 'under', 'co', 'sub', 'super', 'semi', 'mono', 'poly', 'para', 'infra', 'extra', 'ultra', 'quasi', 'neo', 'retro', 'tele', 'cross', 'self'];
  const FORM_SUF = [['ness', ''], ['hood', ''], ['ship', ''], ['ism', ''], ['isms', ''], ['ist', ''], ['ists', ''], ['ity', ''], ['ities', ''],
    ['ize', ''], ['ise', ''], ['izes', ''], ['ises', ''], ['ized', ''], ['ised', ''], ['izing', ''], ['ising', ''], ['ization', ''], ['isation', ''], ['izations', ''], ['isations', ''],
    ['ability', 'able'], ['ibility', 'ible'], ['ly', '']];
  const knownBase = (D, w, depth) => w.length >= 5 && ((D.lower.has(w) && D.lower.get(w).plain) || inflected(D, w) || (depth > 1 && !!formed(D, w, depth - 1)));
  /* 'pre' for a formation by a prefix, 'suf' by a suffix (7.47) */
  function formed(D, w, depth) {
    if (!/^[a-z]{7,}$/.test(w) || !depth) return false;
    for (const [suf, add] of FORM_SUF) {
      if (!w.endsWith(suf)) continue;
      const stem = w.slice(0, w.length - suf.length) + add;
      if (suf === 'ly' && !/(?:ive|al|ous|ar)$/.test(stem)) continue;
      if (suf === 'ing' && !add) continue;
      if (knownBase(D, stem, depth)) return 'suf';
    }
    for (const p of FORM_PRE) if (w.startsWith(p) && w.length - p.length >= (p.length <= 3 ? 5 : 4) && knownBase(D, w.slice(p.length), depth)) return 'pre';
    /* "atemporal", "apolitical", "ahistorical" */
    if (w[0] === 'a' && w.length >= 8 && D.lower.has(w.slice(1)) && D.lower.get(w.slice(1)).plain && /(?:al|ic|ical|ive|ous)$/.test(w)) return 'pre';
    return false;
  }
  /* the cost of one slip turning the intended word a into the written word w */
  function edits1(w) {
    const out = [];
    for (let i = 0; i <= w.length; i++) {
      const L = w.slice(0, i), R = w.slice(i);
      if (R) out.push([L + R.slice(1), R[0] === L.slice(-1) || R[0] === R[1] ? 0.45 : 0.95]); // the writer added a letter (a doubled one is likelier)
      if (R.length > 1 && R[0] !== R[1]) out.push([L + R[1] + R[0] + R.slice(2), 0.6]); // two letters swapped
      for (const c of ABC) {
        if (R && c !== R[0]) out.push([L + c + R.slice(1), near(c, R[0]) ? 0.75 : (VOW.has(c) && VOW.has(R[0]) ? 0.8 : 1)]); // a letter changed
        out.push([L + c + R, c === L.slice(-1) || c === R[0] ? 0.5 : 0.95]); // the writer left a letter out (often a doubled one)
      }
    }
    return out;
  }
  function suggest(D, word, max, names) {
    /* the same word is looked up once per session */
    const key = word + '|' + (max || 5) + '|' + (names ? 1 : 0);
    if (D.memo && D.memo.has(key)) return D.memo.get(key);
    const res = suggest0(D, word, max, names);
    if (D.memo) { if (D.memo.size > 5000) D.memo.clear(); D.memo.set(key, res); }
    return res;
  }
  function suggest0(D, word, max, names) {
    const w = word.toLowerCase(), best = new Map(), cap = !!names;
    const take = (cand, cost) => {
      const e = D.lower.get(cand); if (!e || e.lv >= 80) return;
      const s = cost + lc(e.lv) + (e.plain || cap ? 0 : 0.35);
      const f = e.plain ? cand : e.form;
      if (!best.has(f) || best.get(f) > s) best.set(f, s);
    };
    const e1 = edits1(w);
    for (const [c, k] of e1) take(c, k);
    /* two slips, only when one finds nothing close */
    if (!best.size || Math.min(...best.values()) > 1.0) {
      const seen = new Set();
      for (const [c, k] of e1) { if (seen.has(c)) continue; seen.add(c); if (c.length < 2) continue;
        for (const [c2, k2] of edits1(c)) if (D.lower.has(c2)) take(c2, k + k2 + 0.15); }
    }
    /* two words run together after a small word: "alot", "infact",
       "eventhough", "eachother" (a closed list, so "offsprings" is not split) */
    for (let i = 1; i < w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i), eb = D.lower.get(b);
      if (RUN_ON.has(a) && eb && eb.plain && eb.lv <= 20 && b.length > 1) best.set(a + ' ' + b, 0.55 + lc(eb.lv));
    }
    /* a name written in lower case: "sunday", "london" */
    const nm = D.lower.get(w);
    if (nm && !nm.plain && nm.lv <= 50 && (w.length > 3 || (nm.form === nm.form.toUpperCase() && nm.lv <= 20))) best.set(nm.form, 0.1);
    return [...best.entries()].sort((x, y) => x[1] - y[1]).slice(0, max || 5).map(([s, sc]) => ({ word: s, score: sc }));
  }
  function matchCase(orig, s) {
    if (orig === orig.toUpperCase() && orig.length > 1) return s.toUpperCase();
    if (orig[0] === orig[0].toUpperCase()) return s[0].toUpperCase() + s.slice(1);
    return s;
  }
  /* the words to look at, and the ones to leave alone: names (a capital
     mid-sentence), acronyms, words with digits, web and e-mail addresses */
  function check(D, text, opt) {
    opt = opt || {}; const out = [], ignore = opt.ignore || new Set();
    const re = /[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'’]*(?:-[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'’]*)*/g; let m;
    /* 7.43: how often each word is written; a term used three times or more
       is the writer's own, unless one cheap slip turns it into a known word */
    /* 7.44: a long document is checked a paragraph at a time; opt.uses then
       carries the counts of the whole document */
    const uses = opt.uses || new Map(); if (!opt.uses) for (const x of String(text).match(re) || []) { const k = x.toLowerCase(); uses.set(k, (uses.get(k) || 0) + 1); }
    /* 7.47: a word next to a letter of another language's alphabet
       ("al-madīna al-fāḍila"), or one of a run of unknown words, is
       another language ("Il buio e il miele", "substantia individua") */
    const FOREIGN = /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u1E00-\u1EFF]/;
    const hold = [];
    while ((m = re.exec(text))) {
      let w = m[0].replace(/['’]+$/, ''); const s = m.index, e = s + w.length;
      if (w.length < 2 || ignore.has(w.toLowerCase())) continue;
      /* 7.47: speech written as spoken ("buildin’", "preparin’"), the
         plural of capitals ("MRIs"), the parts of Arabic names */
      if (m[0].length > w.length && /in$/.test(w)) continue;
      if (/^[A-Z]{2,}s$/.test(w)) continue;
      if (NAME_PART.has(w.toLowerCase()) || /^(?:al|el|ul|an|ad|as|at|ar)-/i.test(w)) continue;
      /* 7.47: a capital changed in a quotation ("[c]riteria", "[b]lindness")
         is read with its bracketed letter; a word the writer introduces
         ("the local name berdi", "called asuras"), one alone in quotation
         marks (a “unisono”), one after Latin "et" ("Luctor et emergo"), and
         one beside the particles of an Arabic name, are not English */
      const pre = text.slice(Math.max(0, s - 28), s);
      if (/\[[A-Za-z]\]$/.test(pre) || /(?:called|named|name|term|termed|word|known as|so-called|meaning)\s+["“‘']?$/i.test(pre) || /\bet\s+$/.test(pre)) continue;
      if (/[“"‘]$/.test(pre) && /^[.,;:!?]?[”"’]/.test(text.slice(e, e + 2))) continue;
      if (/(?:^|[\s\[(])(?:al|el)-\w|\b(?:ibn|bint|abu|abd)\b/i.test(text.slice(Math.max(0, s - 24), Math.min(text.length, e + 24)))) continue;
      if ((uses.get(w.toLowerCase()) || 0) >= 4) continue;
      if (/[^\x00-\x7F]/.test(w) || /['’][A-Z]/.test(w)) continue; // a word from another language; a joined "okay'I"
      const before = text.slice(Math.max(0, s - 40), s);
      /* the whole run of text without spaces around the word: a web or e-mail
         address, a path, a file name, a word joined to digits */
      let a = s, b = e; while (a > 0 && !/\s/.test(text[a - 1])) a--; while (b < text.length && !/\s/.test(text[b])) b++;
      const tok = text.slice(a, b);
      if (/:\/\/|^www\.|@|\\|\/\w|\w\.\w+\.\w|_|\d/.test(tok)) continue;
      if (w.length > 1 && w === w.toUpperCase()) continue; // an acronym
      if (/[a-z][A-Z]/.test(w)) continue; // camelCase, iPhone
      if (known(D, w)) continue;
      if (LATIN.has(w.toLowerCase()) || ROMAN.test(w)) continue;
      if (FOREIGN.test(text.slice(Math.max(0, s - 24), Math.min(text.length, e + 24)).replace(/[’‘“”–—…]/g, ''))) continue;
      /* a word alone in brackets is a gloss: "filial piety (xiao)" */
      if (/\(\s*$/.test(text.slice(Math.max(0, s - 2), s)) && /^\s*\)/.test(text.slice(e, e + 2))) continue;
      const sentenceStart = !before.trim() || /[.!?]["”’)]?\s+$|\n\s*$|^\s*["“(]\s*$/.test(before);
      if (/^[A-Z]/.test(w) && !sentenceStart) {
        /* a capital mid-sentence is a name the dictionary may lack; it is
           marked only when it is one slip from a name it knows ("Febuary") */
        const sg = suggest(D, w, 2, true).filter(x => /^[A-Z]/.test(x.word) && (CALENDAR.test(x.word) || D.lower.get(x.word.toLowerCase()).lv <= 20));
        if (!(sg.length && sg[0].score <= (opt.nameMax ?? 1.2) && (sg.length < 2 || sg[1].score - sg[0].score >= 0.12))) continue;
        out.push({ start: s, end: e, orig: w, fix: sg[0].word, alts: sg.map(x => x.word), why: 'Spelling', cat: 'g', spell: true });
        continue;
      }
      if (/^[A-Z]/.test(w) && sentenceStart && D.lower.has(w.toLowerCase())) continue;
      /* 7.47: a capital at a sentence's start is a name when another name,
         "et al.", a citation or a possessive follows ("Scholl and Sabat
         (2008)", "Toombs ([44]", "Alaa Fayez", "Dera's article") */
      if (/^[A-Z]/.test(w) && sentenceStart) {
        const after = text.slice(e, e + 48);
        if (/['’]s$/.test(w) || (uses.get(w.toLowerCase()) || 0) >= 2) continue;
        if (/^['’]s\b/.test(text.slice(e, e + 3)) || /^\s+[A-Z][a-z]/.test(after) || /^\s*(?:et al|and [A-Z][\w'’-]+\s*\(|\(\s*\[?\d|\[\d|,?\s*\(\d{4})/.test(after)) continue;
      }
      const sug = suggest(D, w, 5);
      /* a capital at the start of a sentence may be a name the dictionary
         lacks ("Fincher"): a fix only for one cheap slip to a common word */
      const capStart = /^[A-Z]/.test(w);
      const o = { start: s, end: e, orig: w, fix: null, alts: sug.map(x => matchCase(w, x.word)), why: 'Spelling', cat: 'g', spell: true };
      /* the first suggestion is offered as the fix only when it stands clear of the second */
      const short = w.length <= 3, mx = short ? 0.6 : (opt.maxScore ?? 1.35), mg = short ? 0.3 : (opt.margin ?? 0.12);
      const ok0 = sug.length && sug[0].score <= mx && (sug.length < 2 || sug[1].score - sug[0].score >= mg);
      const capOk = !capStart || (sug.length && sug[0].score <= 0.8 && (D.lower.get(sug[0].word.toLowerCase()) || { lv: 99 }).lv <= 35);
      if (ok0 && capOk) o.fix = matchCase(w, sug[0].word);
      /* 7.47: a fix that only swaps a last letter of -s, -d, -r is a guess at
         a form, not a spelling ("brainwasher" to "brainwashed"): marked,
         with no fix */
      if (o.fix && o.fix.length === w.length && o.fix.slice(0, -1).toLowerCase() === w.slice(0, -1).toLowerCase() && /[sdr]$/i.test(w) && /[sdr]$/i.test(o.fix)) o.fix = null;
      /* 7.43: a capital at a sentence's start with no clear fix is a name
         ("Kraemer discusses"); a term the writer uses three times or more
         with no clear fix is theirs ("gaslighting") */
      const nearPlain = sug.some(x => x.score < 1.2 && x.word === x.word.toLowerCase());
      if (!o.fix && ((capStart && !nearPlain) || (uses.get(w.toLowerCase()) || 0) >= 3)) continue;
      hold.push(o);
    }
    /* 7.47: three unknown words or more with at most one short word between
       each, or two inside brackets or quotation marks, are a phrase of
       another language: none is marked. (Two side by side are left marked:
       learners often slip twice running, "mor convient".) */
    const run = new Set();
    for (let i = 0; i < hold.length;) {
      let j = i;
      while (j + 1 < hold.length && /^\s+(?:[A-Za-z]{1,3}\s+)?$/.test(text.slice(hold[j].end, hold[j + 1].start))) j++;
      const n = j - i + 1;
      const quoted = n >= 2 && /[(\[“"«]\s*(?:[A-Za-z]{1,3}\s+)?$/.test(text.slice(Math.max(0, hold[i].start - 6), hold[i].start)) && /^\s*(?:\s[A-Za-z]{1,3})?[)\]”"»]/.test(text.slice(hold[j].end, hold[j].end + 6));
      if (n >= 3 || quoted) for (let k = i; k <= j; k++) run.add(k);
      i = j + 1;
    }
    hold.forEach((o, i) => { if (!run.has(i)) out.push(o); });
    return out;
  }
  /* 7.49: the writer's own words join the dictionary: known, and offered
     as corrections ("Gadamar" to "Gadamer"). A capitalised word is kept as
     a name; a word the list already knows is left as it is. */
  function addWords(D, words) {
    D.user = D.user || new Set();
    for (const raw of words || []) {
      const w = String(raw || '').trim(); if (!w || /\s/.test(w)) continue;
      const l = w.toLowerCase(), had = D.lower.get(l);
      if (had && had.plain) continue;
      /* a rare name the list knows becomes common once the writer adds it,
         so its slips are corrected to it */
      D.userWas = D.userWas || new Map();
      if (had && had.form === w) { if (had.lv > 15) { D.userWas.set(w, had.lv); had.lv = 15; D.exact.set(w, 15); D.user.add(w); } continue; }
      if (had && w !== l) continue;
      D.exact.set(w, 15); D.lower.set(l, { lv: 15, plain: w === l, form: w }); D.user.add(w);
    }
    if (D.memo) D.memo.clear();
  }
  function dropWord(D, w) {
    if (!D.user) return; w = String(w || '').trim();
    for (const u of [...D.user]) if (u.toLowerCase() === w.toLowerCase()) {
      D.user.delete(u); const e = D.lower.get(u.toLowerCase());
      if (D.userWas && D.userWas.has(u)) { const lv = D.userWas.get(u); D.userWas.delete(u); D.exact.set(u, lv); if (e) e.lv = lv; continue; }
      D.exact.delete(u); if (e && e.form === u) D.lower.delete(u.toLowerCase());
    }
    if (D.memo) D.memo.clear();
  }
  const api = { load, known, suggest, check, level, addWords, dropWord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.INKSPELL = api;
})(typeof self !== 'undefined' ? self : this);
