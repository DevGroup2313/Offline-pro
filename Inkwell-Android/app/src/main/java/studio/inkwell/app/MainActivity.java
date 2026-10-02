/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.Arrays;
import java.util.Iterator;

import org.json.JSONObject;

/**
 * Inkwell for Android and the Fire tablet: one web view showing Inkwell.html
 * from the app's own assets at a fixed https address, with the microphone,
 * file opening and file saving wired to the system.
 */
public class MainActivity extends Activity {
    private static final String TAG = "Inkwell";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int REQ_MIC = 1, REQ_FILE = 2, REQ_SAVE = 3;

    private WebView web;
    private Store store;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSaveBytes;
    private String pendingSaveName;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new Store(new File(getFilesDir(), "store"));
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        // 7.31: the laptop's model over the home Wi-Fi is plain http (a local
        // address cannot have a certificate); the page itself is https
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.addJavascriptInterface(new Bridge(), "InkwellAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> onDownload(url, disposition, mime));

        if (state == null || web.restoreState(state) == null) web.loadUrl(InkwellCore.START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** 7.30: the status bar and the navigation bar take the page's own edge
     *  colours, with dark or light icons to suit, so the page meets the screen
     *  edges seamlessly instead of sitting between two navy bands. */
    private void applyEdges(String top, String bottom) {
        int t, b;
        try {
            t = Color.parseColor(top);
            b = Color.parseColor(bottom);
        } catch (IllegalArgumentException | NullPointerException e) {
            return;
        }
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(t);
        w.setNavigationBarColor(b);
        View d = w.getDecorView();
        int flags = d.getSystemUiVisibility();
        flags = InkwellCore.isLight(t) ? (flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR)
                : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        if (Build.VERSION.SDK_INT >= 26) {
            flags = InkwellCore.isLight(b) ? (flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
                    : (flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        d.setSystemUiVisibility(flags);
    }

    private boolean micGranted() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private String hostInfoJson() {
        boolean speech = false;
        try {
            speech = SpeechRecognizer.isRecognitionAvailable(this);
        } catch (RuntimeException ignored) {
            // no recognition service on this device (Fire tablets have none)
        }
        String ua = "";
        try {
            ua = web != null ? web.getSettings().getUserAgentString() : "";
        } catch (RuntimeException ignored) { }
        return InkwellCore.hostInfoJson(ua, speech, micGranted());
    }

    private String readAssetText(String path) throws IOException {
        InputStream in = getAssets().open(path);
        try {
            return new String(Store.readAll(in), UTF8);
        } finally {
            in.close();
        }
    }

    /* ---------------------------------------------------------------- pages */
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (u == null || !InkwellCore.HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/Inkwell.html";
            String asset = path.substring(1);
            if (!InkwellCore.isSafeAssetPath(asset)) return missing();
            try {
                if (asset.equals("Inkwell.html")) {
                    String edge = "";
                    try { edge = readAssetText("ink-host/edge-colours.js"); } catch (IOException ignored) { }
                    String page = InkwellCore.injectHead(readAssetText(asset),
                            InkwellCore.bridgeScript(InkwellCore.storeJson(store.readAll()), hostInfoJson())
                                    + InkwellCore.edgeScript(edge));
                    return new WebResourceResponse("text/html", "UTF-8",
                            new ByteArrayInputStream(page.getBytes(UTF8)));
                }
                String mime = InkwellCore.mimeFor(asset);
                return new WebResourceResponse(mime, InkwellCore.isText(mime) ? "UTF-8" : null,
                        getAssets().open(asset));
            } catch (IOException e) {
                return missing();
            }
        }

        private WebResourceResponse missing() {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                    new ByteArrayInputStream(new byte[0]));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (u == null) return false;
            if (InkwellCore.HOST.equals(u.getHost())) return false;
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if (scheme.equals("http") || scheme.equals("https") || scheme.equals("mailto") || scheme.equals("tel")) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) { }
                return true;   // other sites open in the browser, never inside Inkwell
            }
            return false;
        }
    }

    /* ----------------------------------------------- microphone and files */
    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> {
                boolean audio = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                Uri origin = request.getOrigin();
                if (!audio || origin == null || !InkwellCore.HOST.equals(origin.getHost())) {
                    request.deny();
                    return;
                }
                if (micGranted()) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    if (pendingPermission != null) pendingPermission.deny();
                    pendingPermission = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                }
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (request == pendingPermission) pendingPermission = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent;
            try {
                intent = params.createIntent();
            } catch (RuntimeException e) {
                intent = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            }
            try {
                startActivityForResult(intent, REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != REQ_MIC || pendingPermission == null) return;
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (ok) pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else pendingPermission.deny();
        pendingPermission = null;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
                fileCallback = null;
            }
            return;
        }
        if (code == REQ_SAVE) {
            byte[] bytes = pendingSaveBytes;
            pendingSaveBytes = null;
            if (result == RESULT_OK && data != null && data.getData() != null && bytes != null) {
                try {
                    OutputStream os = getContentResolver().openOutputStream(data.getData());
                    if (os == null) throw new IOException("no output stream");
                    try {
                        os.write(bytes);
                    } finally {
                        os.close();
                    }
                    Toast.makeText(this, "Saved.", Toast.LENGTH_SHORT).show();
                } catch (IOException e) {
                    Toast.makeText(this, "The file could not be saved: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            return;
        }
        super.onActivityResult(code, result, data);
    }

    private void startSave(String name, String mime, byte[] bytes) {
        pendingSaveBytes = bytes;
        pendingSaveName = InkwellCore.safeFileName(name);
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime)
                .putExtra(Intent.EXTRA_TITLE, pendingSaveName);
        try {
            startActivityForResult(i, REQ_SAVE);
        } catch (ActivityNotFoundException e) {
            // no system save dialog: keep the file in the app's own Documents folder
            pendingSaveBytes = null;
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
            if (dir == null) dir = new File(getFilesDir(), "exports");
            if (!dir.isDirectory()) dir.mkdirs();
            File f = new File(dir, pendingSaveName);
            try {
                FileOutputStream os = new FileOutputStream(f);
                try {
                    os.write(bytes);
                } finally {
                    os.close();
                }
                Toast.makeText(this, "Saved to " + f.getAbsolutePath(), Toast.LENGTH_LONG).show();
            } catch (IOException ex) {
                Toast.makeText(this, "The file could not be saved: " + ex.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    private void onDownload(String url, String disposition, String mime) {
        if (url == null) return;
        String name = InkwellCore.fileNameFrom(disposition, mime);
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            if (web != null) web.evaluateJavascript(InkwellCore.blobFetchScript(url, name, mime), null);
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) { }
    }

    /* -------------------------------------------- what the page may call */
    private class Bridge {
        @JavascriptInterface
        public String saveFile(final String name, final String mime, String base64) {
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return "false";
            }
            runOnUiThread(() -> startSave(name, mime, bytes));
            return "true";
        }

        @JavascriptInterface
        public void storageSet(String key, String value) {
            store.put(key, value);
        }

        @JavascriptInterface
        public String storeJson() {
            return InkwellCore.storeJson(store.readAll());
        }

        @JavascriptInterface
        public String hostInfo() {
            return hostInfoJson();
        }

        /** 7.31: the page's requests to the laptop's model, made by the app
         *  itself. A page's own requests from its secure address to a plain
         *  http address on the home network are blocked or held for a
         *  permission the app window cannot show; the app's are not. The
         *  answer comes back through window.__inkHttpDone(id, status, text). */
        @JavascriptInterface
        public void httpRequest(final String id, final String method, final String url,
                                final String headersJson, final String body) {
            new Thread(() -> {
                int status = 0;
                String text;
                HttpURLConnection c = null;
                try {
                    URL u = new URL(url);
                    if (!"http".equals(u.getProtocol()) && !"https".equals(u.getProtocol())) {
                        throw new IOException("only http and https");
                    }
                    c = (HttpURLConnection) u.openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(240000);
                    c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    Iterator<String> keys = h.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        c.setRequestProperty(k, h.optString(k));
                    }
                    if (body != null && !body.isEmpty() && !"GET".equals(c.getRequestMethod())) {
                        byte[] b = body.getBytes(UTF8);
                        c.setDoOutput(true);
                        c.setFixedLengthStreamingMode(b.length);
                        OutputStream o = c.getOutputStream();
                        try {
                            o.write(b);
                        } finally {
                            o.close();
                        }
                    }
                    status = c.getResponseCode();
                    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    text = in == null ? "" : new String(Store.readAll(in), UTF8);
                } catch (Exception e) {
                    status = 0;
                    text = String.valueOf(e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
                final String js = "window.__inkHttpDone&&window.__inkHttpDone(" + InkwellCore.jsonQuote(id)
                        + "," + status + "," + InkwellCore.jsonQuote(text) + ")";
                runOnUiThread(() -> {
                    if (web != null) web.evaluateJavascript(js, null);
                });
            }).start();
        }

        @JavascriptInterface
        public void setEdges(final String top, final String bottom) {
            runOnUiThread(() -> applyEdges(top, bottom));
        }

        @JavascriptInterface
        public void log(String message) {
            Log.i(TAG, message == null ? "" : message);
        }
    }
}
