/* INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
   No licence is granted. See LICENCE.txt.

   7.48: footnotes through the clipboard, for the desk and for Tabula.

   Copying writes the notes the way Word writes them in its own HTML (the
   form Word reads back as real footnotes when it opens or pastes HTML):
   each reference an <a> with mso-footnote-id, each note a <div> with
   mso-element:footnote inside one mso-element:footnote-list. Elsewhere the
   same markup shows a raised number in the text and the notes at the end.

   Pasting reads notes from Word (that same markup), from LibreOffice
   (sdfootnote anchors), from Google Docs (ftnt anchors) and from any page
   whose reference and note link to each other: a reference links to its
   note, and the note links back to it.

   INKFNCLIP.wordHTML(bodyHTML, notes)
     bodyHTML holds each reference as <sup data-fnk="i"></sup> (i from 1);
     notes is [{html}] in the same order. Returns a whole HTML document.
   INKFNCLIP.parse(html)
     null when the HTML has no notes; otherwise {html, notes}: the body with
     each reference as <sup data-fnk="i">i</sup>, the notes as [{html,
     text}] (text: the note as plain text, italics as *this*). */
(function (root) {
  'use strict';
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function refHTML(i, back) {
    var id = 'ftn' + i, nm = back ? '_ftn' + i : '_ftnref' + i, hr = back ? '#_ftnref' + i : '#_ftn' + i;
    return '<a style="mso-footnote-id:' + id + '" href="' + hr + '" name="' + nm + '" title="">' +
      '<span class="MsoFootnoteReference"><span style="mso-special-character:footnote">' +
      '<![if !supportFootnotes]><span class="MsoFootnoteReference"><sup>' + i + '</sup></span><![endif]>' +
      '</span></span></a>';
  }

  function wordHTML(bodyHTML, notes) {
    var body = String(bodyHTML || '').replace(/<sup data-fnk="(\d+)"[^>]*>[\s\S]*?<\/sup>/g, function (m, i) { return refHTML(+i, false); });
    var list = '';
    if (notes && notes.length) {
      list = '<div style="mso-element:footnote-list"><![if !supportFootnotes]><br clear="all"><hr align="left" size="1" width="33%"><![endif]>';
      for (var i = 0; i < notes.length; i++) {
        list += '<div style="mso-element:footnote" id="ftn' + (i + 1) + '"><p class="MsoFootnoteText">' + refHTML(i + 1, true) + ' ' + (notes[i].html || '') + '</p></div>';
      }
      list += '</div>';
    }
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><style>p.MsoFootnoteText{margin:0;font-size:10.0pt}span.MsoFootnoteReference{vertical-align:super}</style></head>' +
      '<body>' + body + list + '</body></html>';
  }

  /* a note's text, italics as *this* */
  function noteText(el) {
    var out = '';
    (function walk(n, it) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { out += it ? '\u0001' + c.nodeValue + '\u0002' : c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        var tg = c.nodeName, st = (c.getAttribute && c.getAttribute('style')) || '';
        if (tg === 'BR') { out += ' '; continue; }
        var i2 = it || tg === 'I' || tg === 'EM' || /font-style\s*:\s*italic/i.test(st);
        if (/mso-element|display\s*:\s*none/i.test(st) && tg !== 'SPAN') { continue; }
        walk(c, i2);
        if (/^(P|DIV|LI)$/.test(tg)) out += ' ';
      }
    })(el, false);
    out = out.replace(/\u0002\u0001/g, '').replace(/\u0001(\s*)([^\u0002]*?)(\s*)\u0002/g, function (m, a, b, c) { return b ? a + '*' + b + '*' + c : a + c; });
    return out.replace(/[\u0001\u0002]/g, '').replace(/\s+/g, ' ').trim();
  }

  function parse(html) {
    html = String(html || '');
    if (!/href\s*=\s*["']?#/i.test(html)) return null;
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
    var body = doc.body; if (!body) return null;
    var as = [].slice.call(body.querySelectorAll('a[href^="#"]')), key = {};
    as.forEach(function (a) { var k = a.getAttribute('name') || a.getAttribute('id'); if (k) key[k] = a; });
    /* pairs: a reference and its note's anchor link to each other; the one
       that comes first in the page is the reference */
    var pairs = [], used = new Set();
    as.forEach(function (a) {
      if (used.has(a)) return;
      var t = key[(a.getAttribute('href') || '').slice(1)];
      if (!t || t === a || used.has(t)) return;
      var mine = a.getAttribute('name') || a.getAttribute('id');
      if (!mine || (t.getAttribute('href') || '') !== '#' + mine) return;
      var first = (a.compareDocumentPosition(t) & 4) ? a : t, second = first === a ? t : a;
      used.add(a); used.add(t); pairs.push({ ref: first, back: second });
    });
    if (!pairs.length) return null;
    var notes = [], holders = [];
    pairs.forEach(function (p, i) {
      /* the note: Word's footnote div, else the paragraph that holds its anchor */
      var box = null, n = p.back;
      while (n && n !== body) { var st = (n.getAttribute && n.getAttribute('style')) || '';
        if (/mso-element\s*:\s*(foot|end)note\b/i.test(st)) { box = n; break; } n = n.parentNode; }
      if (!box) box = p.back.closest('p,li,div') || p.back.parentNode;
      var cl = box.cloneNode(true);
      /* the note's own number goes; the text stays */
      var b2 = null, all = cl.querySelectorAll('a[href]');
      for (var j = 0; j < all.length; j++) if (all[j].getAttribute('href') === p.back.getAttribute('href')) { b2 = all[j]; break; }
      if (b2) b2.remove();
      var inner = cl.innerHTML.replace(/<!\[if[^>]*>|<!\[endif\]>/gi, '').replace(/^(\s|&nbsp;| )+/, '');
      var tx = noteText(cl);
      notes.push({ html: inner.replace(/^\s*(<p[^>]*>)?\s*/i, '').replace(/\s*(<\/p>)?\s*$/i, ''), text: tx });
      holders.push(box);
      var sup = doc.createElement('sup'); sup.setAttribute('data-fnk', String(i + 1)); sup.textContent = String(i + 1);
      /* the reference with its wrapping (Word's spans, a <sup>) */
      var r = p.ref, up = r.parentNode;
      while (up && up !== body && /^(SUP|SPAN)$/.test(up.nodeName) && up.textContent.trim() === r.textContent.trim()) { r = up; up = up.parentNode; }
      r.parentNode.replaceChild(sup, r);
    });
    /* the notes, and the rule above them, leave the body */
    var list = null;
    [].slice.call(body.querySelectorAll('div')).some(function (d) { if (/mso-element\s*:\s*(foot|end)note-list/i.test(d.getAttribute('style') || '')) { list = d; return true; } return false; });
    holders.forEach(function (h) { if (h.parentNode) h.parentNode.removeChild(h); });
    if (list && list.parentNode) list.parentNode.removeChild(list);
    var last = body.lastElementChild;
    while (last && (last.nodeName === 'HR' || last.nodeName === 'BR' || (last.nodeName === 'DIV' && !last.textContent.trim() && !last.querySelector('img')))) { var pv = last.previousElementSibling; last.remove(); last = pv; }
    var out = body.innerHTML.replace(/<!\[if[^>]*>|<!\[endif\]>/gi, '');
    return { html: out, notes: notes };
  }

  root.INKFNCLIP = { wordHTML: wordHTML, parse: parse, noteText: noteText };
})(typeof window !== 'undefined' ? window : this);
