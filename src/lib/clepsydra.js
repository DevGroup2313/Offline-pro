/* CLEPSYDRA, carried from Carpe Diem (carpe_diem.html, <script id="cd-mod-pomo">,
   "the REAL extracted engine"), unchanged except four lines marked here:
   1. Custodia's two settings are kept in localStorage (ink_custodia_v1), and
      the audio context the chime needs is declared (Carpe Diem's main app
      declares it; the module assumed it).
   2. Carpe Diem's own loader of the saved timer settings (cd_pomo_v1).
   3. pomoPill tells Inkwell's hourglasses (Tabula's dock, the floating
      windows) the dial's state: window.inkClepDocks.
   4. window.inkClep: open, stop, pill, running. */
(function(){
'use strict';
var $=function(s,r){try{return (r||document).querySelector(s);}catch(e){return null;}};var $$=function(s,r){try{return [].slice.call((r||document).querySelectorAll(s));}catch(e){return [];}};var state=(function(){var s={lang:(window.__cdSelfLang||'en')};try{var o=JSON.parse(localStorage.getItem('ink_custodia_v1')||'{}');if(typeof o.custodiaOn==='boolean')s.custodiaOn=o.custodiaOn;if(typeof o.custodiaLimit==='number')s.custodiaLimit=o.custodiaLimit;}catch(e){}return s;})();function saveState(){try{localStorage.setItem('ink_custodia_v1',JSON.stringify({custodiaOn:state.custodiaOn,custodiaLimit:state.custodiaLimit}));}catch(e){}} function loadState(){return state;}var __cdAC=null;function tr(key,en){return en;}function pomoPresenceEnter(){} function pomoPresenceLeave(){} function pomoSyncToPresence(){}
var pomo = { running:false, phase:"focus", remaining:25*60,
  focusLen:25, shortLen:5, longLen:15, perSet:4,
  done:0, totalDone:0, timer:null, sound:true, autostart:true, fabLive:true };
(function(){ try{ var r=localStorage.getItem("cd_pomo_v1"); if(r){ var o=JSON.parse(r);
  ["focusLen","shortLen","longLen","perSet","sound","autostart","fabLive"].forEach(function(k){ if(o[k]!=null) pomo[k]=o[k]; });
  pomo.remaining=pomoPhaseLen(pomo.phase); } }catch(e){} })();
function openPomodoro(){ var root=$("#modal-root"); if(!root) return; clear(root);
  var backdrop=el("div",{class:"modal-backdrop", onclick:function(e){ if(e.target===backdrop) closeModal(); }});
  if(window.__cdAppDark){try{backdrop.setAttribute("data-theme","night");}catch(e){}}
  var modal=el("div",{class:"modal", style:{maxWidth:"400px"}}); modal.id="pomo-modal";
  var head=el("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 22px 6px"}});
  head.appendChild(el("div",{style:{fontFamily:"var(--cd-serif)",fontSize:"19px",fontWeight:"600",color:"var(--text-primary)"},text:tr("pomo.title","Clepsydra")}));
  var x=el("button",{style:{border:"1px solid rgba(16,42,58,.16)",background:"var(--cream-card,#fff)",cursor:"pointer",fontSize:"16px",lineHeight:"1",color:"var(--text-secondary,#5a5a61)",borderRadius:"10px",padding:"5px 10px",boxShadow:"0 1px 2px rgba(16,42,58,.12)"},text:"\u00d7"}); x.onclick=closeModal; /* cd-761: X gets the Carpe Diem curved-button look */ head.appendChild(x); modal.appendChild(head);
  modal.appendChild(el("div",{style:{padding:"0 22px 4px",fontSize:"12.5px",color:"var(--text-tertiary)"},text:tr("pomo.tagline","Work in focused sprints, with breaks between.")}));
  var body=el("div",{style:{padding:"6px 22px 22px"}});
  var ringWrap=el("div",{style:{display:"flex",justifyContent:"center",margin:"6px 0 2px"}}); ringWrap.id="pomo-ring"; ringWrap.innerHTML=pomoRingSVG(); body.appendChild(ringWrap);
  body.appendChild(el("div",{id:"pomo-dots",style:{textAlign:"center",margin:"2px 0 12px"}}));
  var ctl=el("div",{style:{display:"flex",gap:"8px",alignItems:"center"}}); ctl.id="pomo-controls";
  var toggle=pomoBtn("pomo-toggle", pomo.running?tr("pomo.pause","Pause"):tr("pomo.start","Start"), "primary"); toggle.onclick=function(){ pomoToggleRun(); if(pomo.running){try{closeModal();}catch(e){}} };
  var reset=pomoBtn(null, tr("pomo.reset","Reset")); reset.onclick=pomoReset;
  var skip=pomoBtn(null, tr("pomo.skip","Skip")); skip.onclick=pomoSkip;
  ctl.appendChild(toggle); ctl.appendChild(reset); ctl.appendChild(skip); body.appendChild(ctl);
  body.appendChild(el("div",{id:"pomo-today",style:{textAlign:"center",fontSize:"12px",color:"var(--text-tertiary)",margin:"12px 0 2px"},text:pomoTodayText()}));
  body.appendChild(el("div",{style:{height:"0.5px",background:"var(--hairline-soft)",margin:"12px 0 6px"}}));
  body.appendChild(el("div",{style:{fontSize:"12px",fontWeight:"600",letterSpacing:"0.4px",textTransform:"uppercase",color:"var(--text-tertiary)",margin:"2px 0 2px"},text:tr("pomo.settings","Settings")}));
  body.appendChild(pomoNum("focusLen","pomo.focus","Focus",1,90));
  body.appendChild(pomoNum("shortLen","pomo.short","Short break",1,30));
  body.appendChild(pomoNum("longLen","pomo.long","Long break",1,60));
  body.appendChild(pomoNum("perSet","pomo.perSet","Sessions before a long break",1,8));
  body.appendChild(pomoToggleOpt("sound","pomo.sound","Chime"));
  body.appendChild(pomoToggleOpt("autostart","pomo.autostart","Auto-start next"));
  body.appendChild(pomoToggleOpt("fabLive","pomo.fabLive","Live countdown"));
  body.appendChild(el("div",{style:{height:"0.5px",background:"var(--hairline-soft)",margin:"10px 0 6px"}}));
  var custWrap = el("div",{id:"pomo-custodia"});
  custWrap.appendChild(el("div",{style:{fontSize:"12px",fontWeight:"600",letterSpacing:"0.4px",textTransform:"uppercase",color:"var(--text-tertiary)",margin:"2px 0 2px"},text:tr("custodia.head","Custodia \u00b7 break guard")}));
  body.appendChild(custWrap);
  (function(){
    var r1=el("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0"}});
    r1.appendChild(el("span",{style:{fontSize:"13px",color:"var(--text-secondary)"},text:tr("custodia.on","Guard my focus stretches")}));
    var cbtn=el("button",{}); function paintCust(){ cbtn.textContent=custodiaOn()?tr("ctl.on","On"):tr("ctl.off","Off"); cbtn.setAttribute("style","border:0.5px solid var(--hairline);border-radius:7px;padding:6px 14px;cursor:pointer;font:600 12.5px/1 -apple-system,system-ui,sans-serif;color:var(--text-secondary);background:"+(custodiaOn()?"var(--accent-soft)":"transparent")); }
    paintCust(); cbtn.onclick=function(){ state.custodiaOn = !custodiaOn(); saveState(); paintCust(); };
    r1.appendChild(cbtn); custWrap.appendChild(r1);
    var r2=el("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0"}});
    r2.appendChild(el("span",{style:{fontSize:"13px",color:"var(--text-secondary)"},text:tr("custodia.limit","Break prompt after (minutes of focus)")}));
    var num=el("input",{}); num.type="number"; num.min="5"; num.max="240"; num.value=String(custodiaLimitMin());
    num.setAttribute("style","width:60px;text-align:center;border:0.5px solid var(--hairline);border-radius:7px;padding:6px;font:13px -apple-system,system-ui,sans-serif;background:var(--cl-solid);color:var(--text-primary)");
    num.onchange=function(){ var v=parseInt(num.value,10); if(!isNaN(v)&&v>=5&&v<=240){ state.custodiaLimit=v; saveState(); } else { num.value=String(custodiaLimitMin()); } };
    r2.appendChild(num); custWrap.appendChild(r2);
  })();
  modal.appendChild(body); backdrop.appendChild(modal); root.appendChild(backdrop);
  pomoRender(); }
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(k => {
      if (k === "class") node.className = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k === "style" && typeof attrs[k] === "object") Object.assign(node.style, attrs[k]);
      else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
  }
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null || c === false) return;
      if (typeof c === "string" || typeof c === "number") node.appendChild(document.createTextNode(String(c)));
      else node.appendChild(c);
    });
  }
  return node;
}
function custodiaLimitMin(){ try { var n = state.custodiaLimit; return (typeof n === "number" && n >= 5 && n <= 240) ? n : 50; } catch(e){ return 50; } }
function pomoReset(){ pomoStop(); pomo.phase="focus"; pomo.done=0; try{ if(typeof custodiaBreakReset==="function") custodiaBreakReset(); }catch(e){} pomo.remaining=pomoPhaseLen("focus"); pomoRender(); pomoPill(); }
function pomoStop(){ pomo.running=false; if(pomo.timer){ clearInterval(pomo.timer); pomo.timer=null; } pomoPresenceLeave(); pomoRender(); pomoPill(); }
function pomoRender(){
  var t=document.getElementById("pomo-time"); if(t) t.textContent=pomoFmt(pomo.remaining);
  var ph=document.getElementById("pomo-phase"); if(ph) ph.textContent=pomoPhaseLabel();
  var fg=document.getElementById("pomo-ring-fg");
  if(fg){ var C=565.48, total=pomoPhaseLen(pomo.phase)||1; fg.setAttribute("stroke-dashoffset", C*(1-pomo.remaining/total)); fg.style.stroke=(pomo.phase==="focus")?"var(--accent)":"var(--cream-done-ink)"; }
  var tg=document.getElementById("pomo-toggle"); if(tg) tg.textContent=pomo.running?tr("pomo.pause","Pause"):tr("pomo.start","Start");
  var dd=document.getElementById("pomo-dots"); if(dd) dd.innerHTML=pomoDotsHTML();
  var td=document.getElementById("pomo-today"); if(td) td.textContent=pomoTodayText();
}
function pomoDotsHTML(){ var h=""; for(var i=0;i<pomo.perSet;i++){ h+='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 3px;background:'+(i<pomo.done?"var(--accent)":"var(--accent-soft)")+'"></span>'; } return h; }
function pomoPhaseLabel(){ return pomo.phase==="focus"?tr("pomo.focus","Focus"):(pomo.phase==="long"?tr("pomo.long","Long break"):tr("pomo.short","Short break")); }
function pomoTodayText(){ return pomo.totalDone+" "+tr("pomo.today","focus sessions today"); }
function ring() {
    var t = null; try { t = document.querySelector(sel); } catch (e) { return false; }
    if (!t) return false;
    var r; try { r = t.getBoundingClientRect(); } catch (e) { return false; }
    if (!(r.width > 4 && r.height > 4)) {
      /* cd-721: the corner fabs (moon, bell, Schedae, Clepsydra, chevron) are
         display:none on the Home hero, so the ring had nothing to land on. When
         the subject is hidden, reveal it just for the tour and record it so it is
         put back afterwards. */
      try { var __n = t; var __guard = 0; while (__n && __n.nodeType === 1 && __guard++ < 8) { try { if (getComputedStyle(__n).display === "none") { __n.setAttribute("data-cd-forced", __n.style.cssText || " "); __n.style.setProperty("display", "flex", "important"); (window.__cdForcedFabs = window.__cdForcedFabs || []).push(__n); } } catch (e) {} __n = __n.parentElement; } if (typeof window.__cdDockPos === "function") window.__cdDockPos(); r = t.getBoundingClientRect(); } catch (e) {} /* cd-722: reveal the subject AND any hidden ancestor, so a button inside a hidden container (the dock) can show */
      if (!(r.width > 4 && r.height > 4)) return false;
    }
    t.classList.add("demo-tour-spot-strong"); if (demoTourLively()) t.classList.add("demo-tour-pulse-strong");
    return true;
  }
function demoTourLively() { try { return (state.motion || "full") === "full"; } catch (e) { return true; } }
function pomoFmt(s){ s=Math.max(0,s|0); var m=Math.floor(s/60), ss=s%60; return m+":"+(ss<10?"0":"")+ss; }
function pomoPhaseLen(p){ return (p==="focus"?pomo.focusLen:(p==="long"?pomo.longLen:pomo.shortLen))*60; }
function pomoPill(){ var fab=document.getElementById("horo-fab");
  if(!fab){ fab=el("button",{}); fab.id="horo-fab"; fab.onclick=function(){ if(pomo && pomo.running){ try{pomoReset();}catch(e){ try{openPomodoro();}catch(_){} } } else { openPomodoro(); } }; /* cd-762: tap the running dial to STOP the Clepsydra (pomoReset), else open the panel */ document.body.appendChild(fab);
    var sf=document.getElementById("sticky-fab"); if(sf&&sf.classList.contains("qn-gilt")) fab.classList.add("qn-gilt"); }
  fab.setAttribute("title", tr("pomo.title","Clepsydra")); fab.setAttribute("aria-label", tr("pomo.title","Clepsydra"));
  var mode=(pomo.running&&pomo.fabLive)?"live":(pomo.running?"dot":"idle");
  if(fab.getAttribute("data-mode")!==mode){ fab.setAttribute("data-mode",mode);
    var clock='<span style="font-size:30px;line-height:1">⏳</span>';
    if(mode==="live"){ fab.innerHTML=clock+'<svg width="46" height="46" viewBox="0 0 46 46" style="position:absolute;left:0;top:0"><circle cx="23" cy="23" r="20" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="3"></circle><circle id="horo-arc" cx="23" cy="23" r="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" transform="rotate(-90 23 23)" stroke-dasharray="125.66" stroke-dashoffset="0" style="transition:stroke-dashoffset 0.95s linear"></circle></svg><span id="horo-num" style="position:relative;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:currentColor;letter-spacing:0.2px"></span>'; }
    else if(mode==="dot"){ fab.innerHTML=clock+'<span style="position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:currentColor"></span>'; }
    else { fab.innerHTML=clock; } }
  if(mode==="live"){ var total=pomoPhaseLen(pomo.phase)||1, arc=document.getElementById("horo-arc"), num=document.getElementById("horo-num");
    if(arc) arc.setAttribute("stroke-dashoffset", 125.66*(1-pomo.remaining/total)); if(num) num.textContent=pomoFmt(pomo.remaining); /* cd-759: fab dial shows MM:SS small in a circle */ }
  try{ if(window.inkClepDocks) window.inkClepDocks(mode, pomo.remaining, pomoPhaseLen(pomo.phase)||1, pomoFmt(pomo.remaining)); }catch(e){} }
function custodiaBreakReset(){ var w=custodiaW(); w.acc=0; w.snoozed=false; w.extended=false; }
function custodiaW(){ if(!window.__cust) window.__cust = { acc:0, lastMs:0, snoozed:false, extended:false, open:false, count:0 }; return window.__cust; }
function pomoBtn(id,label,kind){ var b=el("button",{}); if(id)b.id=id; b.textContent=label; b.setAttribute("data-cd-lift","1");
  var base="border-radius:9px;cursor:pointer;font:600 13.5px/1 -apple-system,system-ui,sans-serif;padding:11px 14px;";
  if(kind==="primary") b.setAttribute("style",base+"border:none;color:#fff;background:var(--accent);flex:1");
  else b.setAttribute("style",base+"border:0.5px solid var(--hairline);background:transparent;color:var(--text-secondary)");
  return b; }
function lift(sel) { try { var n = document.querySelector(sel); if (n) n.style.zIndex = String(z); } catch (e) {} }
function pomoNum(key,labelKey,labelEn,min,max){ var wrap=el("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0"}}); wrap.id="pomo-set-"+key;
  wrap.appendChild(el("span",{style:{fontSize:"13px",color:"var(--text-secondary)"},text:tr(labelKey,labelEn)}));
  var inp=el("input",{}); inp.type="number"; inp.value=String(pomo[key]); inp.min=min; inp.max=max;
  inp.setAttribute("style","width:60px;text-align:center;border:0.5px solid var(--hairline);border-radius:7px;padding:6px;font:13px -apple-system,system-ui,sans-serif;background:var(--cl-solid);color:var(--text-primary)");
  inp.onchange=function(){ var v=parseInt(inp.value,10); if(isNaN(v))v=pomo[key]; v=Math.max(min,Math.min(max,v)); pomo[key]=v; inp.value=String(v); pomoSave(); if(!pomo.running) pomo.remaining=pomoPhaseLen(pomo.phase); pomoRender(); };
  wrap.appendChild(inp); return wrap; }
function pomoSave(){ try{ localStorage.setItem("cd_pomo_v1", JSON.stringify({focusLen:pomo.focusLen,shortLen:pomo.shortLen,longLen:pomo.longLen,perSet:pomo.perSet,sound:pomo.sound,autostart:pomo.autostart,fabLive:pomo.fabLive})); }catch(e){} }
function pomoToggleOpt(key,labelKey,labelEn){ var wrap=el("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0"}}); wrap.id="pomo-set-"+key;
  wrap.appendChild(el("span",{style:{fontSize:"13px",color:"var(--text-secondary)"},text:tr(labelKey,labelEn)}));
  var b=el("button",{}); function paint(){ b.textContent=pomo[key]?tr("ctl.on","On"):tr("ctl.off","Off"); b.setAttribute("style","border:0.5px solid var(--hairline);border-radius:7px;padding:6px 14px;cursor:pointer;font:600 12.5px/1 -apple-system,system-ui,sans-serif;color:var(--text-secondary);background:"+(pomo[key]?"var(--accent-soft)":"transparent")); }
  paint(); b.onclick=function(){ pomo[key]=!pomo[key]; pomoSave(); paint(); try{pomoPill();}catch(e){} if(key==="sound"&&pomo.sound){ try{ pomoChime(); }catch(e){} } }; wrap.appendChild(b); return wrap; }
function paint(){ b.textContent=pomo[key]?tr("ctl.on","On"):tr("ctl.off","Off"); b.setAttribute("style","border:0.5px solid var(--hairline);border-radius:7px;padding:6px 14px;cursor:pointer;font:600 12.5px/1 -apple-system,system-ui,sans-serif;color:var(--text-secondary);background:"+(pomo[key]?"var(--accent-soft)":"transparent")); }
function pomoChime(){ if(!pomo.sound) return; try{ var ac=cdAudioCtx(); if(!ac) return; if(ac.state==="suspended"){ try{ ac.resume(); }catch(e){} } [660,880].forEach(function(f,i){ var o=ac.createOscillator(), g=ac.createGain(); o.type="sine"; o.frequency.value=f; o.connect(g); g.connect(ac.destination); var t=ac.currentTime+i*0.18; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.16,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.34); o.start(t); o.stop(t+0.36); }); window.__cdChimeRang=Date.now(); }catch(e){} }
function cdAudioCtx(){ if(__cdAC) return __cdAC; try{ var C=window.AudioContext||window.webkitAudioContext; if(!C) return null; __cdAC=new C(); }catch(e){ return null; } return __cdAC; }
function paintCust(){ cbtn.textContent=custodiaOn()?tr("ctl.on","On"):tr("ctl.off","Off"); cbtn.setAttribute("style","border:0.5px solid var(--hairline);border-radius:7px;padding:6px 14px;cursor:pointer;font:600 12.5px/1 -apple-system,system-ui,sans-serif;color:var(--text-secondary);background:"+(custodiaOn()?"var(--accent-soft)":"transparent")); }
function custodiaOn(){ try { return state.custodiaOn !== false; } catch(e){ return true; } }
function closeModal() { clear($("#modal-root")); }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function pomoToggleRun(){ if(pomo.running) pomoStop(); else pomoStart(); }
function pomoStart(){ if(pomo.running) return; pomo.running=true; if(pomo.timer) clearInterval(pomo.timer); pomo.timer=setInterval(pomoTick,1000); pomoPresenceEnter(); pomoRender(); pomoPill(); }
function pomoTick(){ try{ if(typeof custodiaTick==="function") custodiaTick(); }catch(e){} pomo.remaining--; if(pomo.remaining<=0){ pomoAdvance(true); return; } pomoRender(); pomoPill(); }
function custodiaTick(){
  try {
    if (!custodiaOn()) return;
    var w = custodiaW();
    if (pomo.phase !== "focus" || !pomo.running) { if (pomo.phase !== "focus") custodiaBreakReset(); return; }
    var now = Date.now();
    if (w.lastMs && (now - w.lastMs) > 5*60000) custodiaBreakReset();
    w.lastMs = now;
    w.acc++;
    if (w.acc >= custodiaLimitMin()*60 && !w.open) custodiaPrompt();
  } catch(e){}
}
function custodiaPrompt(){
  try {
    var w = custodiaW(); if (w.open) return; w.open = true; w.count++;
    var m = custodiaMsg();
    var back = el("div",{style:{position:"fixed",inset:"0",background:"rgba(10,8,5,0.55)",zIndex:"9990",display:"flex",alignItems:"center",justifyContent:"center",padding:"22px"}});
    back.id = "custodia-overlay";
    var card = el("div",{className:"glass",style:{maxWidth:"430px",width:"100%",borderRadius:"14px",padding:"22px 24px"}});
    card.appendChild(el("div",{style:{fontSize:"26px",textAlign:"center",marginBottom:"4px"},text:m[0]}));
    card.appendChild(el("div",{style:{fontFamily:"var(--cd-serif)",fontSize:"17px",fontWeight:"600",textAlign:"center",marginBottom:"8px"},text:tr("custodia.title","A pause, earned")}));
    card.appendChild(el("div",{style:{fontSize:"13.5px",color:"var(--text-secondary)",lineHeight:"1.55",textAlign:"center",marginBottom:"14px"},text:m[1]}));
    var row = el("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap",justifyContent:"center"}});
    function bb(label,primary,fn){ var x=el("button",{className: primary?"btn btn-primary":"btn btn-ghost",style:{fontSize:"12.5px"},text:label}); x.onclick=fn; return x; }
    row.appendChild(bb(tr("pomo.short","Short break")+" \u00b7 "+Math.round(pomoPhaseLen("short")/60)+" min", true, function(){ custodiaTakeBreak("short"); }));
    row.appendChild(bb(tr("pomo.long","Long break")+" \u00b7 "+Math.round(pomoPhaseLen("long")/60)+" min", true, function(){ custodiaTakeBreak("long"); }));
    card.appendChild(row);
    var row2 = el("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap",justifyContent:"center",marginTop:"8px"}});
    if (!w.snoozed) row2.appendChild(bb(tr("custodia.snooze","Ten more minutes, then ask again"), false, function(){ var ww=custodiaW(); ww.snoozed=true; ww.acc=Math.max(0, custodiaLimitMin()*60-600); custodiaClose(); }));
    if (!w.extended) row2.appendChild(bb(tr("custodia.extend","Two minutes to finish the thought"), false, function(){ var ww=custodiaW(); ww.extended=true; ww.acc=custodiaLimitMin()*60-120; custodiaClose(); }));
    if (row2.childNodes.length) card.appendChild(row2);
    card.appendChild(el("div",{style:{fontSize:"11px",color:"var(--text-tertiary)",textAlign:"center",marginTop:"12px"},text:tr("custodia.foot","Custodia watches the clock so you can forget it.")}));
    back.appendChild(card);
    document.body.appendChild(back);
  } catch(e){ try{ custodiaW().open=false; }catch(e2){} }
}
function bb(label,primary,fn){ var x=el("button",{className: primary?"btn btn-primary":"btn btn-ghost",style:{fontSize:"12.5px"},text:label}); x.onclick=fn; return x; }
function custodiaTakeBreak(kind){
  try { pomo.phase = kind; pomo.remaining = pomoPhaseLen(kind); custodiaBreakReset(); custodiaClose(); if(!pomo.running) pomoStart(); pomoRender(); pomoPill(); } catch(e){}
}
function custodiaClose(){ var w=custodiaW(); w.open=false; try { var n=document.getElementById("custodia-overlay"); if(n&&n.parentNode) n.parentNode.removeChild(n); } catch(e){} }
function custodiaMsg(){
  var M = [
    ["\ud83e\udd38", tr("custodia.msg.0","A long stretch of honest focus. Stand, roll the shoulders, and let the spine remember it is not furniture.")],
    ["\ud83d\udca7", tr("custodia.msg.1","The work will hold. Fetch a glass of water; hydration is scholarship maintenance.")],
    ["\ud83d\udc40", tr("custodia.msg.2","Give your eyes twenty seconds on something twenty feet away. They keep their own ledger.")],
    ["\ud83c\udf5e", tr("custodia.msg.3","Minds run on meals as surely as on method. Eat something real before the next stretch.")],
    ["\ud83d\udeb6", tr("custodia.msg.4","You have earned a pause. Walk to a window and back; thought travels better on moving legs.")],
    ["\ud83d\udca7", tr("custodia.msg.5","Pause the page, not the progress. Water first; the paragraph will wait faithfully.")],
    ["\ud83c\udf05", tr("custodia.msg.6","Blink, look far, breathe once slowly. The screen has no claim on the horizon.")],
    ["\ud83c\udf72", tr("custodia.msg.7","It is the body that carries the scholar. A proper bite now buys a clearer hour later.")]
  ];
  var w = custodiaW(); var hh = new Date().getHours();
  var idx;
  if (hh >= 11 && hh < 14 && (w.count % 2 === 1)) idx = (w.count % 4 === 1) ? 3 : 7; else idx = (w.count + new Date().getDate()) % M.length;
  return M[idx];
}
function pomoAdvance(auto){ pomoChime();
  if(pomo.phase==="focus"){ pomo.done++; pomo.totalDone++; try{ if(typeof custodiaBreakReset==="function") custodiaBreakReset(); }catch(e){} pomo.phase=(pomo.done>=pomo.perSet)?"long":"short"; }
  else { if(pomo.phase==="long") pomo.done=0; pomo.phase="focus"; }
  pomo.remaining=pomoPhaseLen(pomo.phase);
  if(!(pomo.autostart && auto)) pomoStop();
  pomoRender(); pomoPill(); }
function pomoSkip(){ if(pomo.phase==="focus"){ pomo.done++; try{ if(typeof custodiaBreakReset==="function") custodiaBreakReset(); }catch(e){} pomo.phase=(pomo.done>=pomo.perSet)?"long":"short"; } else { if(pomo.phase==="long") pomo.done=0; pomo.phase="focus"; } pomo.remaining=pomoPhaseLen(pomo.phase); pomoRender(); pomoPill(); }
function pomoRingSVG(){ var C=565.48; return '<svg viewBox="0 0 200 200" width="188" height="188" style="display:block">'
  +'<circle cx="100" cy="100" r="90" fill="none" style="stroke:var(--accent-soft)" stroke-width="9"/>'
  +'<circle id="pomo-ring-fg" cx="100" cy="100" r="90" fill="none" style="stroke:var(--accent)" stroke-width="9" stroke-linecap="round" transform="rotate(-90 100 100)" stroke-dasharray="'+C+'" stroke-dashoffset="0"/>'
  +'<text id="pomo-time" x="100" y="98" text-anchor="middle" dominant-baseline="central" style="fill:var(--text-primary)" font-size="42" font-family="var(--cd-serif)">'+pomoFmt(pomo.remaining)+'</text>'
  +'<text id="pomo-phase" x="100" y="134" text-anchor="middle" style="fill:var(--text-tertiary)" font-size="12.5" letter-spacing="0.4">'+pomoPhaseLabel()+'</text></svg>'; }
try{window.__cdEng=window.__cdEng||{};window.__cdEng.pomo=openPomodoro;}catch(e){}
try{window.inkClep={open:openPomodoro,stop:pomoReset,pill:pomoPill,running:function(){return !!pomo.running;}};}catch(e){}
})();