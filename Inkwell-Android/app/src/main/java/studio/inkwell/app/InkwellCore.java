/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The logic of the Android host that needs no Android classes, kept apart so
 * it can be tested on any Java runtime: JSON quoting, the bridge script that
 * is placed in the page, safe names and paths.
 */
final class InkwellCore {
    static final String BUILD = "7.35";
    /** A secure (https) origin that never touches the network: every request
     *  to it is answered from the app's own assets. Secure origins may use the
     *  microphone; the origin never changes, so the page's storage is stable. */
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/Inkwell.html";

    private InkwellCore() {}

    /** A JSON string literal that is also safe inside an HTML script element. */
    static String jsonQuote(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder(s.length() + 16).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                case '<': b.append("\\u003c"); break;   // no "</script>" or "<!--" can form
                case '>': b.append("\\u003e"); break;
                case '&': b.append("\\u0026"); break;
                case '\u2028': b.append("\\u2028"); break;
                case '\u2029': b.append("\\u2029"); break;
                default:
                    if (c < 0x20) b.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    static boolean isSafeKey(String k) {
        return k != null && k.matches("[A-Za-z0-9_]{1,40}");
    }

    static boolean isSafeAssetPath(String p) {
        if (p == null || p.isEmpty() || p.startsWith("/") || p.contains("..") || p.contains("\\")) return false;
        return p.matches("[A-Za-z0-9._\\-/]+");
    }

    static boolean isEmptyList(String v) {
        if (v == null) return true;
        String t = v.trim();
        return t.isEmpty() || t.equals("[]") || t.equals("null");
    }

    /** The on-disk store as one JSON object of JSON-text values, the shape the
     *  page expects in window.__inkBridgeStore. */
    static String storeJson(Map<String, String> store) {
        StringBuilder b = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> e : new TreeMap<String, String>(store).entrySet()) {
            if (!isSafeKey(e.getKey()) || e.getValue() == null) continue;
            if (!first) b.append(',');
            first = false;
            b.append(jsonQuote(e.getKey())).append(':').append(jsonQuote(e.getValue()));
        }
        return b.append('}').toString();
    }

    static String hostInfoJson(String webview, boolean speechService, boolean micGranted) {
        return "{\"launcher\":" + jsonQuote(BUILD + "-android")
                + ",\"platform\":\"android\",\"native_host\":true,\"mic_handler\":true,\"local_model\":true"
                + ",\"mic_permission\":" + micGranted
                + ",\"speech_service\":" + speechService
                + ",\"webview\":" + jsonQuote(webview == null ? "" : webview) + "}";
    }

    /** The bridge the page already knows from the desktop app (window.pywebview.api)
     *  plus window.InkwellNative, which the page's save routine looks for first.
     *  start_server is deliberately absent: there is no engine on a tablet, and
     *  its presence would make the page offer to start one. */
    static final String BRIDGE_JS =
        "(function(){var A=window.InkwellAndroid;if(!A)return;\n"
      + " function P(v){return Promise.resolve(v);}\n"
      + " window.InkwellNative={saveFile:function(n,m,b){try{return A.saveFile(String(n),String(m||'application/octet-stream'),String(b))==='true';}catch(e){return false;}}};\n"
      + " var HQ={},HN=0;window.__inkHttpDone=function(id,st,tx){var f=HQ[id];delete HQ[id];if(f)f({status:st,text:tx});};\n"
      + " window.InkwellNative.http=function(m,u,h,b){return new Promise(function(res){var id='h'+(++HN);HQ[id]=res;\n"
      + "  try{A.httpRequest(id,String(m||'GET'),String(u),JSON.stringify(h||{}),b==null?'':String(b));}catch(e){delete HQ[id];res({status:0,text:String(e)});}});};\n"
      // 7.35: the tablet's own writing model (MainActivity.Bridge model*, ModelHost)
      + " if(A.modelStatus){var MC={},MP={},ML=[],MS=0,MLD=null;\n"
      + "  window.__inkModelEvent=function(j){var e;try{e=JSON.parse(j);}catch(x){return;}\n"
      + "   if(e.type==='piece'&&MC[e.id]){var c=MC[e.id];c.acc+=e.text;if(c.on)try{c.on(c.acc);}catch(x){}}\n"
      + "   else if(e.type==='done'&&MC[e.id]){var d=MC[e.id];delete MC[e.id];if(e.ok)d.res({text:e.text,ms:e.ms});else d.rej(new Error(e.error||'no answer'));}\n"
      + "   else if(e.type==='loaded'&&MLD){var l=MLD;MLD=null;if(e.state==='ready')l.res(e);else l.rej(new Error(e.error||'the model did not start'));}\n"
      + "   else if(e.type==='stopped'){for(var k in MC){try{MC[k].rej(new Error(e.error||'the model stopped'));}catch(x){}}MC={};if(MLD){MLD.rej(new Error(e.error||'the model stopped'));MLD=null;}}\n"
      + "   for(var i=0;i<ML.length;i++){try{ML[i](e);}catch(x){}}};\n"
      + "  window.InkwellNative.model={\n"
      + "   status:function(){try{return JSON.parse(A.modelStatus());}catch(x){return null;}},\n"
      + "   download:function(u,f,b,h){return String(A.modelDownload(String(u),String(f),String(b||0),String(h||'')));},\n"
      + "   cancelDownload:function(){A.modelCancelDownload();},\n"
      + "   importFile:function(){A.modelImport();},\n"
      + "   remove:function(f){return !!A.modelRemove(String(f));},\n"
      + "   load:function(f,ctx,th){return new Promise(function(res,rej){if(MLD)MLD.rej(new Error('replaced'));MLD={res:res,rej:rej};A.modelLoad(String(f),ctx|0,th|0);});},\n"
      + "   unload:function(){A.modelUnload();},\n"
      + "   chat:function(sys,user,max,on){return new Promise(function(res,rej){var id='m'+(++MS);MC[id]={res:res,rej:rej,on:on||null,acc:''};A.modelChat(id,String(sys||''),String(user||''),max|0,!!on);});},\n"
      + "   cancelAll:function(){for(var k in MC)A.modelCancel(k);},\n"
      + "   on:function(f){ML.push(f);}};}\n"
      + " window.pywebview={api:{\n"
      + "  save_file:function(n,m,b){return P(window.InkwellNative.saveFile(n,m,b));},\n"
      + "  storage_set:function(k,v){try{A.storageSet(String(k),String(v));return P(true);}catch(e){return P(false);}},\n"
      + "  rescue_offer:function(){try{var st=JSON.parse(A.storeJson());if(!st.docs)return P('');\n"
      + "   var o={docs:JSON.parse(st.docs),active:st.active?JSON.parse(st.active):null,notes:st.notes?JSON.parse(st.notes):[],snaps:st.snaps?JSON.parse(st.snaps):{}};\n"
      + "   return P(o.docs&&o.docs.length?JSON.stringify(o):'');}catch(e){return P('');}},\n"
      + "  host_info:function(){try{return P(JSON.parse(A.hostInfo()));}catch(e){return P(window.__inkAndroidHost||null);}},\n"
      + "  mark_booted:function(){return P(true);},\n"
      + "  report_error:function(d){try{A.log('page: '+String(d).slice(0,2000));}catch(e){}return P(true);},\n"
      + "  bake_icon:function(){return P(false);}\n"
      + " }};\n"
      + " document.addEventListener('DOMContentLoaded',function(){try{window.dispatchEvent(new Event('pywebviewready'));}catch(e){}});\n"
      + "})();";

    /** True when dark icons read well on this colour (0xRRGGBB, alpha ignored). */
    static boolean isLight(int color) {
        int r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0 > 0.6;
    }

    /** 7.30: the page reports the colours at its top and bottom edges, and the
     *  status and navigation bars take them, so no band of another colour
     *  frames the page. edgeSource is ink-host/edge-colours.js. */
    static String edgeScript(String edgeSource) {
        if (edgeSource == null || edgeSource.isEmpty()) return "";
        return "<script>\n" + edgeSource
                + "(function(t,b){try{window.InkwellAndroid.setEdges(t,b);}catch(e){}});\n</script>\n";
    }

    static String bridgeScript(String storeJson, String hostInfoJson) {
        return "<script>\n/* Inkwell for Android " + BUILD + ": the native bridge and the on-disk copy of the library. */\n"
                + "window.__inkBridgeStore=" + storeJson + ";\n"
                + "window.__inkAndroidHost=" + hostInfoJson + ";\n"
                + BRIDGE_JS + "\n</script>\n";
    }

    /** Insert the script just before the first closing head tag (any case). */
    static String injectHead(String html, String script) {
        final String tag = "</head>";
        for (int i = 0; i + tag.length() <= html.length(); i++) {
            if (html.regionMatches(true, i, tag, 0, tag.length())) {
                return html.substring(0, i) + script + html.substring(i);
            }
        }
        return script + html;
    }

    static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".txt")) return "text/plain";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
    }

    static String safeFileName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n.isEmpty() ? "inkwell-export" : n;
    }

    static String extensionFor(String mime) {
        if (mime == null) return "";
        String m = mime.toLowerCase(Locale.ROOT);
        if (m.contains("json")) return ".json";
        if (m.contains("wordprocessingml")) return ".docx";
        if (m.contains("msword")) return ".doc";
        if (m.contains("pdf")) return ".pdf";
        if (m.contains("html")) return ".html";
        if (m.contains("markdown")) return ".md";
        if (m.startsWith("text/")) return ".txt";
        if (m.contains("webm")) return ".webm";
        if (m.contains("mp4") || m.contains("m4a")) return ".m4a";
        if (m.contains("wav")) return ".wav";
        if (m.contains("bibtex") || m.contains("x-bibtex")) return ".bib";
        return "";
    }

    static String fileNameFrom(String disposition, String mime) {
        if (disposition != null) {
            Matcher m = Pattern.compile("filename\\*\\s*=\\s*(?:UTF-8|utf-8)''([^;]+)").matcher(disposition);
            if (m.find()) {
                try {
                    return safeFileName(URLDecoder.decode(m.group(1).trim(), "UTF-8"));
                } catch (UnsupportedEncodingException | IllegalArgumentException ignored) {
                    // fall through to the plain form
                }
            }
            m = Pattern.compile("filename\\s*=\\s*\"?([^\";]+)\"?").matcher(disposition);
            if (m.find()) return safeFileName(m.group(1).trim());
        }
        return "inkwell-download" + extensionFor(mime);
    }

    /** Script that reads a blob: or data: URL inside the page and hands its
     *  bytes to the native save dialog (Android's download manager cannot read
     *  blob: URLs, which is how pages normally offer files). */
    static String blobFetchScript(String url, String name, String mime) {
        return "(function(){fetch(" + jsonQuote(url) + ").then(function(r){return r.blob();}).then(function(b){"
                + "var fr=new FileReader();fr.onload=function(){var s=String(fr.result);"
                + "InkwellAndroid.saveFile(" + jsonQuote(name) + ",b.type||" + jsonQuote(mime == null ? "" : mime)
                + ",s.slice(s.indexOf(',')+1));};fr.readAsDataURL(b);})"
                + ".catch(function(e){InkwellAndroid.log('download failed: '+e);});})();";
    }
}
