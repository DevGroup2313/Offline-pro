/* Fontes core (7.34): the library format, import and export, lookups, and
   formatting through citeproc-js with the official CSL styles (the engine and
   styles Zotero uses). Shared by the desk and the Fontes room.
   Canonical format: CSL-JSON (https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html).
   Fontes' own records (author "Surname, First; Surname, First", title,
   container, year, ...) convert both ways. */
(function (root) {
  const TYPE_TO_CSL = { article: 'article-journal', book: 'book', chapter: 'chapter', website: 'webpage', newspaper: 'article-newspaper',
    magazine: 'article-magazine', thesis: 'thesis', report: 'report', conference: 'paper-conference', case: 'legal_case',
    legislation: 'legislation', film: 'motion_picture', interview: 'interview', dataset: 'dataset', manuscript: 'manuscript' };
  const CSL_TO_TYPE = {}; for (const k in TYPE_TO_CSL) CSL_TO_TYPE[TYPE_TO_CSL[k]] = k;

  function names(s) {
    return String(s || '').split(/\s*;\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean).map(x => {
      if (x.indexOf(',') >= 0) { const [family, given] = x.split(/\s*,\s*/, 2); return { family: family, given: given || '' }; }
      const p = x.split(/\s+/); if (p.length === 1) return { literal: x };
      return { family: p.pop(), given: p.join(' ') };
    });
  }
  function nameStr(list) { return (list || []).map(n => n.literal || (n.family + (n.given ? ', ' + n.given : ''))).join('; '); }
  function dateParts(y) { const m = String(y || '').match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/); if (!m) return undefined;
    return { 'date-parts': [[+m[1]].concat(m[2] ? [+m[2]] : []).concat(m[3] ? [+m[3]] : [])] }; }
  function yearOf(d) { return d && d['date-parts'] && d['date-parts'][0] ? String(d['date-parts'][0][0] || '') : (d && d.literal) || ''; }

  /* a Fontes record -> CSL-JSON */
  function toCSL(s) {
    if (s && s.csl) return Object.assign({ id: s.id }, s.csl);
    const c = { id: String(s.id || ('fo' + Math.random().toString(36).slice(2, 9))), type: TYPE_TO_CSL[s.type] || 'book' };
    if (s.author) c.author = names(s.author);
    if (s.editor) c.editor = names(s.editor);
    if (s.title) c.title = s.title;
    if (s.container) c['container-title'] = s.container;
    if (s.publisher) c.publisher = s.publisher;
    if (s.city) c['publisher-place'] = s.city;
    if (s.volume) c.volume = String(s.volume);
    if (s.issue) c.issue = String(s.issue);
    if (s.pages) c.page = String(s.pages).replace(/\s*[-–]\s*/, '–');
    if (s.year) c.issued = dateParts(s.year) || { literal: String(s.year) };
    if (s.url) c.URL = s.url;
    if (s.doi) c.DOI = s.doi;
    if (s.isbn) c.ISBN = s.isbn;
    if (s.accessed) { const a = dateParts(s.accessed); if (a) c.accessed = a; }
    if (s.abstract) c.abstract = s.abstract;
    return c;
  }
  /* CSL-JSON -> a Fontes record (the CSL is kept whole, so nothing is lost) */
  function fromCSL(c, extra) {
    const r = { id: String(c.id || ('fo' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
      type: CSL_TO_TYPE[c.type] || (c.type === 'article' ? 'article' : 'book'),
      author: nameStr(c.author), editor: nameStr(c.editor), title: c.title || '', container: c['container-title'] || '',
      publisher: c.publisher || '', city: c['publisher-place'] || '', volume: c.volume || '', issue: c.issue || '',
      year: yearOf(c.issued), pages: c.page || '', url: c.URL || (c.DOI ? 'https://doi.org/' + c.DOI : ''), doi: c.DOI || '',
      isbn: c.ISBN || '', accessed: '', tags: '', notes: '', added: Date.now() };
    r.csl = Object.assign({}, c, { id: r.id });
    return Object.assign(r, extra || {});
  }

  /* ---------- BibTeX ---------- */
  const TEX = { '\\"a': 'ä', '\\"o': 'ö', '\\"u': 'ü', '\\"A': 'Ä', '\\"O': 'Ö', '\\"U': 'Ü', "\\'e": 'é', "\\'a": 'á', "\\'i": 'í', "\\'o": 'ó', "\\'u": 'ú', "\\'E": 'É',
    '\\`e': 'è', '\\`a': 'à', '\\^e': 'ê', '\\^o': 'ô', '\\~n': 'ñ', '\\c c': 'ç', '\\c{c}': 'ç', '\\ss': 'ß', '\\o': 'ø', '\\aa': 'å', '\\&': '&', '\\%': '%', '\\_': '_', '--': '–' };
  function untex(v) {
    let s = String(v);
    s = s.replace(/\{\\([`'^"~=.])\s*\{?([A-Za-z])\}?\}/g, (m, a, b) => TEX['\\' + a + b] || b).replace(/\\([`'^"~=.])\s*\{?([A-Za-z])\}?/g, (m, a, b) => TEX['\\' + a + b] || b);
    for (const k of ['\\ss', '\\aa', '\\o', '\\&', '\\%', '\\_']) s = s.split(k).join(TEX[k]);
    return s.replace(/[{}]/g, '').replace(/---/g, '—').replace(/--/g, '–').replace(/\s+/g, ' ').trim();
  }
  function bibNames(v) { return untex(v).split(/\s+and\s+/i).map(x => x.trim()).filter(Boolean).map(x => {
    if (x.indexOf(',') >= 0) { const p = x.split(/\s*,\s*/); return { family: p[0], given: p.slice(1).join(' ') }; }
    const p = x.split(/\s+/); return p.length > 1 ? { family: p.pop(), given: p.join(' ') } : { literal: x }; }); }
  const BIB_TYPE = { article: 'article-journal', book: 'book', incollection: 'chapter', inbook: 'chapter', inproceedings: 'paper-conference',
    conference: 'paper-conference', phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report', misc: 'document', online: 'webpage', unpublished: 'manuscript', report: 'report', thesis: 'thesis' };
  function parseBibTeX(text) {
    const out = []; const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g; let m;
    while ((m = re.exec(text))) {
      const type = m[1].toLowerCase(); if (type === 'comment' || type === 'string' || type === 'preamble') continue;
      let i = re.lastIndex, depth = 1; const start = i;
      while (i < text.length && depth > 0) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
      const body = text.slice(start, i - 1); re.lastIndex = i;
      const f = {}; let j = 0;
      while (j < body.length) {
        const fm = /\s*([A-Za-z][\w-]*)\s*=\s*/y; fm.lastIndex = j; const mm = fm.exec(body); if (!mm) break;
        j = fm.lastIndex; let val = '';
        if (body[j] === '{') { let d = 0, k = j; for (; k < body.length; k++) { if (body[k] === '{') d++; else if (body[k] === '}') { d--; if (d === 0) break; } } val = body.slice(j + 1, k); j = k + 1; }
        else if (body[j] === '"') { let k = j + 1; while (k < body.length && !(body[k] === '"' && body[k - 1] !== '\\')) k++; val = body.slice(j + 1, k); j = k + 1; }
        else { const k = body.slice(j).search(/[,}]|$/); val = body.slice(j, j + (k < 0 ? body.length : k)); j += (k < 0 ? body.length : k); }
        f[mm[1].toLowerCase()] = val.trim();
        const comma = body.indexOf(',', j); j = comma < 0 ? body.length : comma + 1;
      }
      const c = { id: m[2] || ('bib' + out.length), type: BIB_TYPE[type] || 'document' };
      if (f.author) c.author = bibNames(f.author);
      if (f.editor) c.editor = bibNames(f.editor);
      if (f.title) c.title = untex(f.title);
      const cont = f.journal || f.journaltitle || f.booktitle; if (cont) c['container-title'] = untex(cont);
      if (f.publisher || f.institution || f.school) c.publisher = untex(f.publisher || f.institution || f.school);
      if (f.address || f.location) c['publisher-place'] = untex(f.address || f.location);
      if (f.volume) c.volume = untex(f.volume); if (f.number || f.issue) c.issue = untex(f.number || f.issue);
      if (f.pages) c.page = untex(f.pages);
      if (f.year || f.date) c.issued = dateParts(f.date || f.year) || { literal: untex(f.year) };
      if (f.doi) c.DOI = untex(f.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
      if (f.url) c.URL = untex(f.url); if (f.isbn) c.ISBN = untex(f.isbn); if (f.abstract) c.abstract = untex(f.abstract);
      if (f.edition) c.edition = untex(f.edition);
      if (type === 'phdthesis') c.genre = 'PhD thesis'; if (type === 'mastersthesis') c.genre = "Master's thesis";
      out.push(c);
    }
    return out;
  }
  function bibKey(c) { const a = (c.author && c.author[0] && (c.author[0].family || c.author[0].literal)) || 'anon';
    return (a.replace(/[^A-Za-z]/g, '') || 'anon').toLowerCase() + (yearOf(c.issued) || 'nd') + ((c.title || '').split(/\s+/).find(w => w.length > 3) || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function toBibTeX(list) {
    const rev = { 'article-journal': 'article', book: 'book', chapter: 'incollection', 'paper-conference': 'inproceedings', thesis: 'phdthesis', report: 'techreport', webpage: 'online' };
    const nm = l => (l || []).map(n => n.literal ? '{' + n.literal + '}' : n.family + (n.given ? ', ' + n.given : '')).join(' and ');
    return list.map(c => { const f = [];
      const add = (k, v) => { if (v) f.push('  ' + k + ' = {' + String(v).replace(/[{}]/g, '') + '}'); };
      add('author', nm(c.author)); add('editor', nm(c.editor)); add('title', c.title);
      add(c.type === 'article-journal' ? 'journal' : 'booktitle', c['container-title']); add('publisher', c.publisher); add('address', c['publisher-place']);
      add('volume', c.volume); add('number', c.issue); add('pages', (c.page || '').replace('–', '--')); add('year', yearOf(c.issued));
      add('doi', c.DOI); add('url', c.URL); add('isbn', c.ISBN);
      return '@' + (rev[c.type] || 'misc') + '{' + bibKey(c) + ',\n' + f.join(',\n') + '\n}'; }).join('\n\n') + '\n';
  }
  /* ---------- RIS ---------- */
  const RIS_TYPE = { JOUR: 'article-journal', BOOK: 'book', CHAP: 'chapter', CONF: 'paper-conference', CPAPER: 'paper-conference', THES: 'thesis', RPRT: 'report', ELEC: 'webpage', WEB: 'webpage', NEWS: 'article-newspaper', MGZN: 'article-magazine', CASE: 'legal_case', STAT: 'legislation', GEN: 'document' };
  function parseRIS(text) {
    const out = []; let c = null, sp = '', ep = '';
    for (const line of String(text).split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/); if (!m) continue;
      const [, tag, val] = m; const v = val.trim();
      if (tag === 'TY') { c = { id: 'ris' + out.length + '-' + Date.now().toString(36), type: RIS_TYPE[v] || 'document' }; sp = ep = ''; continue; }
      if (!c) continue;
      if (tag === 'ER') { if (sp) c.page = sp + (ep ? '–' + ep : ''); out.push(c); c = null; continue; }
      const nm = () => { const p = v.split(/\s*,\s*/); return p.length > 1 ? { family: p[0], given: p.slice(1).join(' ') } : { literal: v }; };
      if (tag === 'AU' || tag === 'A1') (c.author = c.author || []).push(nm());
      else if (tag === 'ED' || tag === 'A2' && c.type === 'chapter') (c.editor = c.editor || []).push(nm());
      else if (tag === 'TI' || tag === 'T1') c.title = v;
      else if (tag === 'JO' || tag === 'JF' || tag === 'T2' || tag === 'BT') c['container-title'] = c['container-title'] || v;
      else if (tag === 'VL') c.volume = v; else if (tag === 'IS') c.issue = v;
      else if (tag === 'SP') sp = v; else if (tag === 'EP') ep = v;
      else if (tag === 'PY' || tag === 'Y1' || tag === 'DA') c.issued = c.issued || dateParts(v.replace(/\//g, '-'));
      else if (tag === 'PB') c.publisher = v; else if (tag === 'CY') c['publisher-place'] = v;
      else if (tag === 'DO') c.DOI = v.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''); else if (tag === 'UR') c.URL = v;
      else if (tag === 'SN') c.ISBN = v; else if (tag === 'AB') c.abstract = v;
    }
    return out;
  }
  function toRIS(list) {
    const rev = {}; for (const k in RIS_TYPE) if (!rev[RIS_TYPE[k]]) rev[RIS_TYPE[k]] = k;
    return list.map(c => { const L = ['TY  - ' + (rev[c.type] || 'GEN')];
      (c.author || []).forEach(n => L.push('AU  - ' + (n.literal || n.family + (n.given ? ', ' + n.given : ''))));
      (c.editor || []).forEach(n => L.push('ED  - ' + (n.literal || n.family + (n.given ? ', ' + n.given : ''))));
      const add = (t, v) => { if (v) L.push(t + '  - ' + v); };
      add('TI', c.title); add(c.type === 'article-journal' ? 'JO' : 'T2', c['container-title']); add('VL', c.volume); add('IS', c.issue);
      if (c.page) { const p = String(c.page).split(/[–-]/); add('SP', p[0]); add('EP', p[1]); }
      add('PY', yearOf(c.issued)); add('PB', c.publisher); add('CY', c['publisher-place']); add('DO', c.DOI); add('UR', c.URL); add('SN', c.ISBN);
      L.push('ER  - '); return L.join('\r\n'); }).join('\r\n') + '\r\n';
  }
  /* any of the three, by its look */
  function parseAny(text) {
    const t = String(text || '').trim();
    if (/^[\[{]/.test(t)) { const j = JSON.parse(t); const arr = Array.isArray(j) ? j : (j.items || [j]); return arr; }
    if (/^TY\s{2}-/m.test(t)) return parseRIS(t);
    if (/@\w+\s*\{/.test(t)) return parseBibTeX(t);
    return [];
  }

  /* ---------- lookups (online, once per source) ---------- */
  const CROSSREF_TYPE = { 'journal-article': 'article-journal', 'book-chapter': 'chapter', 'proceedings-article': 'paper-conference',
    'posted-content': 'article', dissertation: 'thesis', monograph: 'book', 'edited-book': 'book', 'reference-book': 'book',
    'reference-entry': 'entry-dictionary', 'book-section': 'chapter', 'book-part': 'chapter', component: 'article', 'peer-review': 'review' };
  function cleanDOI(x) { const m = String(x || '').match(/10\.\d{4,9}\/[^\s"<>]+/); return m ? m[0].replace(/[.,;)\]]+$/, '') : ''; }
  async function lookupDOI(doi, fetchFn) {
    doi = cleanDOI(doi); if (!doi) throw new Error('not a DOI');
    const f = fetchFn || fetch;
    const r = await f('https://api.crossref.org/works/' + encodeURIComponent(doi) + '/transform/application/vnd.citationstyles.csl+json');
    if (!r.ok) throw new Error('Crossref answered ' + r.status);
    const c = await r.json(); c.id = 'doi:' + doi.toLowerCase(); c.DOI = doi;
    /* Crossref's own type names are not CSL's: "journal-article" would be
       formatted as a chapter */
    c.type = CROSSREF_TYPE[c.type] || c.type;
    if (Array.isArray(c['container-title'])) c['container-title'] = c['container-title'][0];
    if (Array.isArray(c.title)) c.title = c.title[0];
    delete c.reference; delete c['reference-count']; delete c.license; delete c.link; delete c['content-domain'];
    return c;
  }
  async function lookupISBN(isbn, fetchFn) {
    const n = String(isbn || '').replace(/[^0-9Xx]/g, ''); if (n.length !== 10 && n.length !== 13) throw new Error('not an ISBN');
    const f = fetchFn || fetch;
    const r = await f('https://openlibrary.org/api/books?bibkeys=ISBN:' + n + '&format=json&jscmd=data');
    if (!r.ok) throw new Error('Open Library answered ' + r.status);
    const j = await r.json(); const b = j['ISBN:' + n]; if (!b) throw new Error('Open Library does not know this ISBN');
    return { id: 'isbn:' + n, type: 'book', title: b.title + (b.subtitle ? ': ' + b.subtitle : ''),
      author: (b.authors || []).filter((a, i, all) => all.findIndex(x => x.name === a.name) === i)
        .map(a => { const p = a.name.split(/\s+/); return p.length > 1 ? { family: p.pop(), given: p.join(' ') } : { literal: a.name }; }),
      publisher: b.publishers && b.publishers[0] && b.publishers[0].name, 'publisher-place': b.publish_places && b.publish_places[0] && b.publish_places[0].name,
      issued: dateParts((String(b.publish_date || '').match(/\d{4}/) || [''])[0]), ISBN: n };
  }

  /* ---------- formatting with citeproc-js ---------- */
  /* engine(CSL, styleXML, localeXML, items) -> {cite(ids, locator), bibliography(ids), isNote} */
  function engine(CSL, styleXML, localeXML, items, lang) {
    const byId = {}; for (const c of items) byId[String(c.id)] = c;
    const sys = { retrieveLocale: () => localeXML, retrieveItem: id => byId[String(id)] };
    /* markdown: the text format, with italics kept as *...*, which Inkwell's
       Word export turns back into italics */
    if (CSL.Output && CSL.Output.Formats && !CSL.Output.Formats.markdown && CSL.Output.Formats.text) {
      CSL.Output.Formats.markdown = Object.assign({}, CSL.Output.Formats.text, { '@font-style/italic': '*%%STRING%%*', '@font-style/oblique': '*%%STRING%%*' });
    }
    const e = new CSL.Engine(sys, styleXML, lang || 'en-GB');
    e.opt.development_extensions.wrap_url_and_doi = false;
    const isNote = e.cslXml && /class="note"/.test(styleXML) || /class="note"/.test(styleXML);
    return {
      isNote: isNote,
      isNumeric: /citation-format="numeric"/.test(styleXML),
      /* the bibliography with each entry's id: [{id, text}] in the style's order */
      bibliographyIds(ids) { e.updateItems(ids.map(String)); const b = e.makeBibliography(); if (!b) return [];
        return b[1].map((x, i) => ({ id: String((b[0].entry_ids[i] || [])[0]), text: x.trim() })); },
      cite(ids, locator, label) {
        const ci = { citationItems: ids.map(id => Object.assign({ id: String(id) }, locator ? { locator: String(locator), label: label || 'page' } : {})), properties: { noteIndex: isNote ? 1 : 0 } };
        const r = e.processCitationCluster(ci, [], []);
        return (r[1][0] && r[1][0][1]) || '';
      },
      /* every citation of a document, in document order, in one pass, so that
         later notes take the short form or "ibid" and numbered styles number
         in order of first citation. list: [{items:[{id,locator,label}], noteIndex}] */
      citeAll(list, mode) {
        const cits = list.map((c, i) => ({ citationID: 'C' + i, citationItems: c.items.map(x => Object.assign({}, x, { id: String(x.id) })), properties: { noteIndex: isNote ? (c.noteIndex || i + 1) : 0 } }));
        const r = e.rebuildProcessorState(cits, mode || 'text', []);
        const by = {}; for (const x of r) by[x[0]] = x[2];
        return cits.map(c => by[c.citationID] || '');
      },
      bibliography(ids) { e.updateItems(ids.map(String)); const b = e.makeBibliography(); return b ? b[1].map(x => x.trim()) : []; },
      setOutput(fmt) { e.setOutputFormat(fmt); }
    };
  }
  /* citeproc's html entry without its div wrappers ("[1]" and the entry kept apart by a space) */
  function htmlFlat(h) { return String(h || '').replace(/<\/div>\s*<div[^>]*>/g, ' ').replace(/<\/?div[^>]*>/g, '').trim(); }
  function htmlToText(h) { return htmlFlat(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#38;/g, '&').replace(/&#x2F;/g, '/').trim(); }

  const STYLES = [
    ['apa', 'APA, 7th edition'], ['harvard-cite-them-right', 'Harvard (Cite Them Right)'], ['chicago-author-date', 'Chicago, author-date'],
    ['chicago-notes-bibliography', 'Chicago, notes and bibliography'], ['oscola', 'OSCOLA (Oxford, law)'], ['oscola-no-ibid', 'OSCOLA, without ibid'],
    ['mhra-notes', 'MHRA, notes (humanities)'], ['modern-language-association', 'MLA, 9th edition'], ['ieee', 'IEEE'], ['nature', 'Nature']];

  const api = { toCSL, fromCSL, parseBibTeX, toBibTeX, parseRIS, toRIS, parseAny, cleanDOI, lookupDOI, lookupISBN, engine, htmlToText, htmlFlat, STYLES, yearOf, nameStr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FONTES = api;
})(typeof self !== 'undefined' ? self : this);
