/* Inkwell 7.30: the app's edges take the page's own colours. Run by the
   Android and iOS hosts (each passes its own send function as SEND). It reads
   the colour the page shows at its top and bottom edges and reports it when it
   changes (day and night, a room opening), so the status bar, the navigation
   bar and the iPhone's top and bottom areas match the page instead of showing
   a band of another colour. */
(function (SEND) {
  function parse(c) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(c || "");
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  }
  function solid(el) {
    while (el && el.nodeType === 1) {
      var p = parse(getComputedStyle(el).backgroundColor);
      if (p && p.a >= 0.5) return p;
      el = el.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  }
  function at(y) {
    var el = document.elementFromPoint(Math.round(innerWidth / 2), y);
    var p = solid(el || document.body);
    return "#" + [p.r, p.g, p.b].map(function (v) { v = Math.round(v).toString(16); return v.length < 2 ? "0" + v : v; }).join("");
  }
  var last = "";
  function check() {
    try {
      if (!document.body) return;
      var top = at(1), bottom = at(Math.max(1, innerHeight - 2)), key = top + bottom;
      if (key !== last) { last = key; SEND(top, bottom); }
    } catch (e) {}
  }
  function start() {
    check();
    try {
      new MutationObserver(check).observe(document.documentElement, { attributes: true, subtree: false });
      new MutationObserver(check).observe(document.body, { attributes: true, childList: true });
    } catch (e) {}
    addEventListener("resize", check);
    setInterval(check, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.__inkEdgeCheck = check;
})
