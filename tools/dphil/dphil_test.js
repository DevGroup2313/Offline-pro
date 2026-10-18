/* Tests for src/lib/dphil_core.js (INKDPHIL), the checks a doctoral editor
   makes on a whole document:
   node tools/dphil/dphil_test.js
   Each check is tested on what it must find and on what it must leave
   alone. */
const path = require('path');
const D = require(path.join(__dirname, '..', '..', 'src', 'lib', 'dphil_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got, null, 1).slice(0, 900) : '')); }
const fam = (ns, f) => ns.filter(n => n.fam === f);
const at = (t, ns) => ns.map(n => t.slice(n.start, n.end));
/* every note's words are the words at its place */
function sound(name, t, ns) { ok(name + ': notes point at their words', ns.every(n => t.slice(n.start, n.end) === n.orig), ns.filter(n => t.slice(n.start, n.end) !== n.orig)); }

/* ---------- -ise and -ize ---------- */
{
  const t = 'We organise the data. We recognise the pattern. We realise the cost. Later we organize it again.';
  const ns = D.izeIse(t, {});
  ok('ize: the one -ize among -ise is marked', ns.length === 1 && ns[0].orig === 'organize' && ns[0].fix === 'organise', ns);
  ok('ize: the note says both are British', /Oxford spelling/.test(ns[0] && ns[0].why));
  ok('ize: one spelling throughout is left alone', D.izeIse('We organise, recognise and realise.', {}).length === 0);
  ok('ize: US English marks each -ise', D.izeIse('We organise and recognize.', { dialect: 'us' }).map(n => n.fix).join() === 'organize');
  ok('ize: advertise, exercise and surprise are not -ize words', D.izeIse('We advertise, exercise and surprise. We organize, recognize, realize.', { dialect: 'us' }).length === 0);
  const q = 'We organise it. We recognise it. We realise it. As Taylor wrote, “we organize our lives”.';
  ok('ize: a quotation keeps its author’s spelling', D.izeIse(q, { mask: [[q.indexOf('“'), q.length]] }).length === 0);
  const r = 'We organise it. We recognise it. We realise it.\n\n# References\n\nSmith, J. (2019). Organizing Knowledge. Press.';
  ok('ize: a title in the References is not counted', D.izeIse(r, {}).length === 0);
  const it = 'We organise it. We recognise it. We realise it. See *Organizing the Mind* (2019).';
  ok('ize: a title in italics is not counted', D.izeIse(it, {}).length === 0);
  ok('ize: a name keeps its own spelling', D.izeIse('We organise it. We recognise it. We realise it. The World Health Organization agrees.', {}).length === 0);
  ok('ize: a capital at the start of a sentence is a word', D.izeIse('We organise it. We recognise it. We realise it. Organizing it took time.', {}).map(n => n.fix).join() === 'Organising');
  ok('ize: capitals kept in the fix', D.izeIse('Organise it. Recognise it. Realise it. ORGANIZE it.', {}).map(n => n.fix).join() === 'ORGANISE');
}

/* ---------- abbreviations ---------- */
{
  const t = 'The WHO guidance was clear. Later, the World Health Organization (WHO) revised it. The WHO now advises caution.';
  const ns = fam(D.abbreviations(t, {}), 'abbr');
  ok('abbr: used before it is spelled out', ns.length === 1 && ns[0].orig === 'WHO' && ns[0].start === 4 && ns[0].cat === 'g', ns);
  ok('abbr: the note names the definition', /World Health Organization \(WHO\)/.test(ns[0] && ns[0].why), ns[0] && ns[0].why);
  const once = 'The analysis used interpretative phenomenological analysis (IPA) throughout the study of grief and loss.';
  const n2 = D.abbreviations(once, {});
  ok('abbr: spelled out and never used again', n2.length === 1 && /never used again/.test(n2[0].why) && n2[0].fix === '' && n2[0].orig === ' (IPA)', n2);
  const used = 'We use interpretative phenomenological analysis (IPA). IPA attends to meaning.';
  ok('abbr: spelled out and used is left alone', D.abbreviations(used, {}).length === 0, D.abbreviations(used, {}));
  const twice = '# Chapter 1\n\nThe World Health Organization (WHO) acts. The WHO reports.\n\nLater the World Health Organization (WHO) acts again.\n\n# Chapter 2\n\nThe World Health Organization (WHO) once more. The WHO.';
  const n3 = D.abbreviations(twice, {});
  ok('abbr: spelled out twice in one chapter', n3.length === 1 && /spelled out twice/.test(n3[0].why) && /World Health Organization \(WHO\)/.test(n3[0].orig), n3);
  ok('abbr: spelled out again in a new chapter is right', !n3.some(n => n.start > twice.indexOf('# Chapter 2')), n3);
  const known = 'The UK and the EU differ. The European Union (EU) has members.';
  ok('abbr: abbreviations everyone knows need nothing', D.abbreviations(known, {}).length === 0);
  const notdef = 'The study (N) was large. A large table (AB) here and AB there.';
  ok('abbr: brackets that do not follow their words are not a definition', D.abbreviations(notdef, {}).length === 0, D.abbreviations(notdef, {}));
  const list = '# List of Abbreviations\n\nCBT Cognitive behavioural therapy\n\n# Chapter 1\n\nCognitive behavioural therapy (CBT) helps. CBT is common.';
  ok('abbr: the list of abbreviations is not a use', D.abbreviations(list, {}).length === 0, D.abbreviations(list, {}));
  const head = '# CBT and its critics\n\nCognitive behavioural therapy (CBT) helps. CBT is common.';
  ok('abbr: a heading is not a use', D.abbreviations(head, {}).length === 0);
  const roman = 'In the second part (II) we turn to it.';
  ok('abbr: a Roman numeral is not an abbreviation', D.abbreviations(roman, {}).length === 0);
  const dna = 'The deoxyribonucleic acid (DNA) sample was large.';
  ok('abbr: DNA is known', D.abbreviations(dna, {}).length === 0);
  const inner = 'We used magnetic resonance imaging (MRI) in every case. MRI is safe.';
  ok('abbr: lowercase words spell it out too', D.abbreviations(inner, {}).length === 0);
  sound('abbr', t, ns);
}

/* ---------- citations against the References ---------- */
const DOC = [
  '# Introduction',
  '',
  'Care is relational (Gadamer, 1960; Svenaeus, 2000, p. 4). Toombs (1992) agrees, and so do Smith and Jones (2019).',
  'Some disagree (Carel, 2016). Others are unlisted (Taylor, 2004). Kidd (2018b) is listed under 2018.',
  'A wrong year appears (Carel, 2015). The World Health Organization (2019) reports. Heidegger’s Being and Time (1927) is a book, as is Phenomenology of Perception (1945).',
  '',
  '# References',
  '',
  'Carel, H. (2016). Phenomenology of Illness. Oxford University Press.',
  'Gadamer, H.-G. (1960). Truth and Method. Continuum.',
  'Kidd, I. J. (2018). Epistemic injustice. Journal.',
  'Smith, A. and Jones, B. (2019). On care. Press.',
  'Svenaeus, F. (2000). The Hermeneutics of Medicine. Kluwer.',
  'Toombs, S. K. (1992). The Meaning of Illness. Kluwer.',
  'World Health Organization. (2019). Report. Geneva.',
  'Zahavi, D. (2005). Subjectivity and Selfhood. MIT Press.'
].join('\n');
{
  const ns = D.citesVsRefs(DOC, {});
  const g = ns.filter(n => n.cat === 'g');
  ok('cite: a citation with no entry', g.some(n => /no entry/.test(n.why) && /Taylor/.test(n.orig)), g);
  ok('cite: a year that disagrees', g.some(n => /disagree/.test(n.why) && /Carel, 2015/.test(n.orig)), g);
  ok('cite: nothing else is a fault', g.length === 2, at(DOC, g));
  ok('cite: a title before its year is not a citation', !g.some(n => /Being|Perception|Time/.test(n.orig)));
  ok('cite: "2018b" matches 2018', !g.some(n => /Kidd/.test(n.orig)));
  const c = ns.filter(n => n.cat === 'c');
  ok('cite: an entry cited nowhere', c.length === 1 && c[0].orig === 'Zahavi', c);
  const bib = DOC.replace('# References', '# Bibliography');
  ok('cite: a Bibliography may hold works consulted', !D.citesVsRefs(bib, {}).some(n => /not cited/.test(n.why)));
  const num = '# Intro\n\nAs shown [1] and (Smith, 2019).\n\n# References\n\n[1] Smith, A. (2019). On care. Press.\n[2] Jones, B. (2018). More. Press.';
  ok('cite: a numbered list is not checked for uncited entries', !D.citesVsRefs(num, {}).some(n => /not cited/.test(n.why)));
  ok('cite: no References, no notes', D.citesVsRefs('Smith (2019) says so (Jones, 2020).', {}).length === 0);
  const acc = '# Intro\n\nAs Lévinas (1961) argues, and Ricœur (1990) too (Merleau-Ponty, 1945).\n\n# References\n\nLévinas, E. (1961). Totalité et infini.\nMerleau-Ponty, M. (1945). Phénoménologie.\nRicœur, P. (1990). Soi-même comme un autre.';
  ok('cite: names with accents and hyphens', D.citesVsRefs(acc, {}).length === 0, D.citesVsRefs(acc, {}));
  const poss = '# Intro\n\nSmith’s (2019) view, and Smith\'s (2019) view.\n\n# References\n\nSmith, A. (2019). On care.';
  ok('cite: a possessive is the name', D.citesVsRefs(poss, {}).length === 0, D.citesVsRefs(poss, {}));
  const chicago = '# Intro\n\nArendt (1958) writes.\n\n# References\n\nArendt, Hannah. The Human Condition. Chicago: University of Chicago Press, Second Edition with an Introduction by Margaret Canovan and a Foreword by Danielle Allen, 1958.';
  ok('cite: a long Chicago entry with the year at the end', D.citesVsRefs(chicago, {}).length === 0, D.citesVsRefs(chicago, {}));
  sound('cite', DOC, ns);
}

/* ---------- the reference list in order ---------- */
{
  const t = '# References\n\nArendt, H. (1958). A.\nZahavi, D. (2005). Z.\nCarel, H. (2016). C.\nGadamer, H.-G. (1960). G.\nMerleau-Ponty, M. (1945). M.\nSvenaeus, F. (2000). S.';
  const ns = D.refOrder(t, {});
  ok('order: the one entry out of place', ns.length === 1 && ns[0].orig === 'Zahavi', ns);
  ok('order: the note says where it belongs', /after “Svenaeus”/.test(ns[0] && ns[0].why), ns[0] && ns[0].why);
  const good = '# References\n\nArendt, H. (1958). A.\nCarel, H. (2016). C.\nde Beauvoir, S. (1949). B.\nÉlie, A. (2001). E.\nGadamer, H.-G. (1960). G.\nThe Lancet. (2020). L.\nO’Neill, O. (2002). O.\nSvenaeus, F. (2000). S.';
  ok('order: accents, particles, "The" and apostrophes', D.refOrder(good, {}).length === 0, D.refOrder(good, {}));
  const groups = '# References\n\n## Primary sources\n\nHusserl, E. (1913). I.\nKant, I. (1781). K.\n\n## Secondary sources\n\nAdams, A. (2000). A.\nBrown, B. (2001). B.\nCole, C. (2002). C.';
  ok('order: each group of the list is in order on its own', D.refOrder(groups, {}).length === 0, D.refOrder(groups, {}));
  const num = '# References\n\n[1] Zahavi, D. (2005). Z.\n[2] Arendt, H. (1958). A.\n[3] Carel, H. (2016). C.\n[4] Brown, B. (2001). B.';
  ok('order: a numbered list runs in the order cited', D.refOrder(num, {}).length === 0);
  sound('order', t, ns);
}

/* ---------- the citations' small parts ---------- */
{
  const t = 'A (Smith, 2019). B (Jones, 2018). C (Carel, 2016). D (Kidd, 2017). E (Toombs, 1992). F (Gadamer 1960).';
  const ns = D.citeForm(t, {});
  ok('form: the citation without the comma', ns.length === 1 && ns[0].orig === ' ' && ns[0].fix === ', ' && t.slice(ns[0].start - 7, ns[0].start) === 'Gadamer', ns);
  const pg = 'A (Smith, 2019, p. 4). B (Jones, 2018, p. 12). C (Carel, 2016, pp. 3–5). D (Kidd, 2017, p. 9). E (Toombs, 1992, p. 1). F (Gadamer, 1960: 271).';
  const n2 = D.citeForm(pg, {});
  ok('form: a page given another way', n2.length === 1 && n2[0].orig === ': 271' && n2[0].fix === ', p. 271', n2);
  const yrs = 'A (Smith 2019, 2020). B (Jones 2018). C (Carel 2016, 4). D (Kidd 2017, 9). E (Toombs 1992, 1). F (Gadamer 1960, 271). G (Zahavi 2005, p. 7). H (Leder 1990, 33).';
  const n3 = D.citeForm(yrs, {});
  ok('form: a second year is not a page', n3.length === 1 && n3[0].orig === ', p. 7' && n3[0].fix === ', 7', n3);
  const amp = '(Smith & Jones, 2019). (Carel & Kidd, 2016). (Toombs & Leder, 1992). (Brown & White, 2001). (Black and Green, 2002). Smith and Jones (2019) agree.';
  const n4 = D.citeForm(amp, {});
  ok('form: "and" among "&" in brackets; running text apart', n4.length === 1 && n4[0].orig === 'and' && n4[0].fix === '&' && n4[0].start < amp.indexOf('Green'), n4);
  ok('form: a document in two minds is left alone', D.citeForm('(Smith, 2019). (Jones, 2018). (Carel, 2016). (Kidd 2017). (Toombs 1992). (Leder 1990).', {}).length === 0);
  sound('form', t, ns); sound('form pages', pg, n2);
}

/* ---------- quotations and their pages ---------- */
{
  const t = 'He wrote that “the horizon is the range of vision that includes everything that can be seen” (Gadamer, 1960). Then “the hermeneutic circle is not formal in nature, it is neither subjective nor objective” (Gadamer, 1960, p. 293).';
  const ns = D.quotePages(t, {});
  ok('quote: a quotation with no page', ns.length === 1 && ns[0].orig === '(Gadamer, 1960)', ns);
  ok('quote: a short quotation is a mention', D.quotePages('the “fusion of horizons” (Gadamer, 1960).', {}).length === 0);
  ok('quote: Chicago author-date page', D.quotePages('“the horizon is the range of vision that includes everything that can be seen” (Gadamer 1960, 302).', {}).length === 0);
}

/* ---------- marks written two ways ---------- */
{
  const t = '“One” and “two” and “three”, then "four". It’s here, it’s there, it’s everywhere, isn’t it, can’t it, and it\'s not.';
  const ns = D.quoteMarks(t, {});
  ok('quotes: straight double marks among curly ones', fam(ns, 'quotes').filter(n => n.orig === '"').map(n => n.fix).join('') === '“”', ns);
  ok('quotes: a straight apostrophe among curly ones', ns.some(n => n.orig === "'" && n.fix === '’'));
  ok('quotes: an inch mark is not a quotation mark', D.quoteMarks('“A” “B” “C” “D” and a 12" ruler.', {}).length === 0);
  ok('quotes: one kind throughout is left alone', D.quoteMarks('"A" "B" "C" it\'s, isn\'t, can\'t, won\'t, don\'t, shan\'t.', {}).length === 0);
  sound('quotes', t, ns);
  const p = 'Some 45 per cent agreed; 30 per cent did not; 25 per cent abstained; a further 5 percent left.';
  const n2 = D.perCent(p, {});
  ok('percent: "percent" among "per cent"', n2.length === 1 && n2[0].orig === 'percent' && n2[0].fix === 'per cent', n2);
  const p2 = 'Some 45% agreed; 30% did not; 25% abstained; 12% left; and 5 per cent stayed.';
  const n3 = D.perCent(p2, {});
  ok('percent: words among signs', n3.length === 1 && n3[0].orig === '5 per cent' && n3[0].fix === '5%', n3);
  ok('percent: a table may use the sign', D.perCent('45 per cent, 30 per cent, 25 per cent and 10 per cent.\n| 45% | 30% |', {}).length === 0);
  const e = 'Wait… then… and… but... ';
  const n4 = D.ellipses(e, {});
  ok('ellipsis: three stops among the single character', n4.length === 1 && n4[0].orig === '...' && n4[0].fix === '…', n4);
  ok('ellipsis: Chicago spaced stops kept when they are the rule', D.ellipses('a . . . b . . . c . . . d', {}).length === 0);
  ok('ellipsis: four stops are not an ellipsis', D.ellipses('a… b… c… d....', {}).length === 0, D.ellipses('a… b… c… d....', {}));
  const d = 'The self—as Ricœur says—is narrated; memory—and forgetting—shape it; then a spaced one – here.';
  const n5 = D.dashes(d, {});
  ok('dash: a spaced en dash among closed em dashes', n5.length === 1 && n5[0].orig === ' – ' && n5[0].fix === '—', n5);
  const hy = 'The self—as Ricœur says—is narrated; memory—and forgetting - shape it.';
  const n6 = D.dashes(hy, {});
  ok('dash: a hyphen typed for a dash', n6.length === 1 && n6[0].orig === ' - ' && n6[0].fix === '—', n6);
  ok('dash: hyphens alone are not corrected to anything', D.dashes('a - b, c - d, e - f, g - h', {}).length === 0);
  ok('dash: a range of figures is not a dash', D.dashes('In 1990–2000, 2001–2005, pp. 3–5 and 7–9 — once.', {}).length === 0);
  ok('dash: a list item is not a dash', D.dashes('Items:\n- one\n- two\n- three\n- four', {}).length === 0);
  sound('dash', d, n5);
  const eg = 'Some (e.g., Smith) and others (e.g., Jones), i.e., many, e.g., all; but e.g. this one.';
  const n7 = D.egComma(eg, {});
  ok('e.g.: the one without the comma', n7.length === 1 && n7[0].orig === 'e.g.' && n7[0].fix === 'e.g.,', n7);
  sound('e.g.', eg, n7);
}

/* ---------- numbers ---------- */
{
  const h = '# 1 Introduction\n\n## 1.1 Aims\n\n## 1.3 Scope\n\n# 2 Method\n\n## 2.1 Design\n\n# 4 Results';
  const ns = D.numbering(h, {});
  ok('number: headings that skip', at(h, ns).join('|') === '1.3|4', ns);
  const ch = '# Chapter 1 Introduction\n\n## 1.1 Aims\n\n## 1.2 Scope\n\n# Chapter 2 Method\n\n## 2.1 Design\n\n# Chapter Three Results\n\n## 3.1 First';
  ok('number: "Chapter 2" counts as 2', D.numbering(ch, {}).length === 0, D.numbering(ch, {}));
  const un = '# Introduction\n\n## 1.1 Aims\n\n## 1.2 Scope\n\n# Literature\n\n## 2.1 First\n\n## 2.2 Second';
  ok('number: an unnumbered chapter heading may start the count again', D.numbering(un, {}).length === 0, D.numbering(un, {}));
  const yr = '# 1984 and After\n\n# 1989 Revisited\n\n# 2001 Today';
  ok('number: a year is not a heading number', D.numbering(yr, {}).length === 0);
  const fg = 'Figure 1. A model.\n\nAs Figure 1 shows, and Figure 2.\n\nFigure 2: Another.\n\nFigure 4. A third.\n\nSee Figure 5 and Figures 2 and 3.';
  const n2 = D.numbering(fg, {});
  ok('number: a figure out of sequence', n2.some(n => n.orig === 'Figure 4' && /out of sequence/.test(n.why)), n2);
  ok('number: a figure past the last one', n2.some(n => /^Figure 5/.test(n.orig) && /No Figure 5/.test(n.why)), n2);
  ok('number: a gap inside the run is left to the sequence note', !n2.some(n => /Figures 2 and 3/.test(n.orig)), n2);
  const apa = '**Figure 1**\n\n*A model*\n\n**Figure 2**\n\n*Another*\n\nAs Figure 2 shows.';
  ok('number: APA captions on their own line', D.numbering(apa, {}).length === 0, D.numbering(apa, {}));
  const tb = 'Table 2.1: First.\n\nTable 2.2: Second.\n\nTable 3.1: Third.\n\nSee Table 2.3 and Table 3.1.';
  const n3 = D.numbering(tb, {});
  ok('number: tables by chapter', n3.length === 1 && n3[0].orig === 'Table 2.3', n3);
  const cr = '# Chapter 1\n\nText.\n\n# Chapter 2\n\nAs we see in Chapter 7 below, and (Chapter 8), and see Chapter 2, and as chapter 3 of Truth and Method shows, and Gadamer’s Chapter 9, and in Chapter 24 about The Unicorn Tapestries.';
  const n4 = D.numbering(cr, {});
  ok('number: a chapter that is not there', at(cr, n4).join('|') === 'Chapter 7|Chapter 8', n4);
  ok('number: a quoted title before a year is not a quotation', D.quotePages('translation in “The Bear Came Over the Mountain” (2001) and in “intralingual, interlingual and intersemiotic translation in “The Bear”', {}).length === 0);
  const cs = 'See Figure 1, Figure 2, Figure 3 and Figure 4, then figure 5. Figure 6 begins a sentence.';
  const n5 = D.numbering(cs, {}).filter(n => n.cat === 'c');
  ok('number: "figure 5" among "Figure"', n5.length === 1 && n5[0].orig === 'figure' && n5[0].fix === 'Figure', n5);
  sound('number', h, ns); sound('number figures', fg, n2);
}

/* ---------- all of them together ---------- */
{
  const ns = D.all(DOC, {});
  ok('all: notes in order, none overlapping', ns.every((n, i) => i === 0 || n.start >= ns[i - 1].end), ns.map(n => [n.start, n.end, n.fam]));
  ok('all: each note has a kind and a category', ns.every(n => n.fam && (n.cat === 'g' || n.cat === 'c')));
  ok('all: casual writing gets none', D.all(DOC, { reg: 'casual' }).length === 0);
  ok('all: creative writing gets the typographic checks only', D.all('“A” “B” “C” "D" (Taylor, 2004).\n\n# References\n\nSmith, A. (2019).', { reg: 'creative' }).every(n => n.fam === 'quotes'));
  ok('all: every kind of note has its lesson', ns.every(n => Object.keys(D.LESSONS).some(k => n.why.indexOf(k) === 0)), ns.filter(n => !Object.keys(D.LESSONS).some(k => n.why.indexOf(k) === 0)).map(n => n.why));
  sound('all', DOC, ns);
}
/* the lessons cover every message the checks write */
{
  const texts = [DOC, 'We organise it. We recognise it. We realise it. We organize it.', 'The WHO said. The World Health Organization (WHO) did. WHO.',
    'interpretative phenomenological analysis (IPA) here.', '“One” “two” “three” "four" it’s it’s it’s it’s isn’t it\'s', '45 per cent, 30 per cent, 25 per cent, 5 percent. 1% 2% 3% 4% 5 per cent',
    'a… b… c… d...', 'x—y—z—w – v and q - r', '(e.g., A) (e.g., B) (e.g., C) (e.g., D) e.g. E', '# 1 A\n\n# 2 B\n\n# 4 C', 'Figure 1. A\n\nFigure 3. B\n\nSee Figure 4. Figure 1 figure 1 and figure 3 and figure 1 then figure 3.',
    'Table 1. A\n\nTable 1. B', '# Chapter 1\n\n# Chapter 2\n\nsee Chapter 5', 'A (Smith, 2019). B (Jones, 2018). C (Carel, 2016). D (Kidd, 2017). E (Toombs, 1992). F (Gadamer 1960).',
    '“the horizon is the range of vision that includes everything that can be seen” (Gadamer, 1960).', 'We organise it.'];
  const miss = new Set();
  for (const t of texts) for (const n of D.all(t, {}).concat(D.izeIse(t, { dialect: 'us' }))) if (!Object.keys(D.LESSONS).some(k => n.why.indexOf(k) === 0)) miss.add(n.why);
  ok('lessons: every message has a lesson', miss.size === 0, Array.from(miss));
}

if (fails.length) { console.log(fails.map(f => 'FAIL ' + f).join('\n')); }
console.log('dphil_test: ' + pass + ' passed, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
