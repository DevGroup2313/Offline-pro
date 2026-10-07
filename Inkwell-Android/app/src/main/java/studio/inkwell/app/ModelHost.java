/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.os.StatFs;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * 7.35: the app's side of the tablet's model. It starts ModelService (its own
 * process) when the page first asks, downloads or imports model files into
 * the app's private folder, and reports everything to the page as events:
 * window.__inkModelEvent(json).
 */
final class ModelHost {
    interface Events {
        void emit(JSONObject event);
    }

    private static final String TAG = "InkwellModel";
    private final Context ctx;
    private final Events events;
    private final File dir;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Messenger replies = new Messenger(new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(Message m) {
            onReply(m);
        }
    });
    private Messenger service;
    private boolean binding;
    private final List<Message> queue = new ArrayList<Message>();

    // what the page sees
    private String state = "none";          // none, loading, ready, error, stopped
    private String error = "";
    private String loadedFile = "";
    private String description = "";
    private long loadMs;
    private String wantedFile = "";
    private int wantedCtx = 4096, wantedThreads = 4;
    private final JSONObject download = new JSONObject();
    private volatile boolean cancelDownload;
    private Thread downloadThread;

    ModelHost(Context ctx, Events events) {
        this.ctx = ctx.getApplicationContext();
        this.events = events;
        this.dir = new File(ctx.getFilesDir(), "models");
        if (!dir.isDirectory()) dir.mkdirs();
        try {
            download.put("state", "idle");
        } catch (JSONException ignored) { }
        wantedThreads = ModelFiles.defaultThreads(Runtime.getRuntime().availableProcessors());
    }

    File folder() {
        return dir;
    }

    /* ------------------------------------------------------------ status */
    synchronized JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("supported", ModelFiles.abiSupported(Build.SUPPORTED_64_BIT_ABIS));
            o.put("abis", new JSONArray(Build.SUPPORTED_ABIS));
            o.put("cores", Runtime.getRuntime().availableProcessors());
            o.put("threads", wantedThreads);
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                o.put("ramMB", mi.totalMem / (1 << 20));
                o.put("availMB", mi.availMem / (1 << 20));
            }
            StatFs fs = new StatFs(dir.getAbsolutePath());
            o.put("freeMB", fs.getAvailableBytes() / (1 << 20));
            JSONArray models = new JSONArray();
            for (File f : ModelFiles.list(dir)) {
                JSONObject m = new JSONObject();
                m.put("file", f.getName());
                m.put("bytes", f.length());
                models.put(m);
            }
            o.put("models", models);
            o.put("state", state);
            o.put("error", error);
            o.put("file", loadedFile);
            o.put("desc", description);
            o.put("loadMs", loadMs);
            o.put("download", new JSONObject(download.toString()));
        } catch (JSONException ignored) { }
        return o;
    }

    private void emit(String type, JSONObject o) {
        try {
            o.put("type", type);
        } catch (JSONException ignored) { }
        main.post(() -> events.emit(o));
    }

    private void emitStatus() {
        emit("status", status());
    }

    /* ------------------------------------------------------- the service */
    private final ServiceConnection conn = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder b) {
            service = new Messenger(b);
            binding = false;
            for (Message m : queue) sendNow(m);
            queue.clear();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            // the system closed the model's process (usually for memory). The
            // binding stays: Android starts the service again by itself and
            // calls onServiceConnected; requests wait in the queue until then.
            service = null;
            binding = true;
            boolean was = !loadedFile.isEmpty() || "loading".equals(state);
            loadedFile = "";
            description = "";
            if (was) {
                state = "stopped";
                error = "the system closed the tablet's model to free memory; your documents are untouched";
            }
            JSONObject o = new JSONObject();
            try {
                o.put("error", error);
            } catch (JSONException ignored) { }
            emit("stopped", o);
            emitStatus();
        }
    };

    private void ensureBound() {
        if (service != null || binding) return;
        binding = true;
        Intent i = new Intent(ctx, ModelService.class);
        if (!ctx.bindService(i, conn, Context.BIND_AUTO_CREATE)) {
            binding = false;
            state = "error";
            error = "the model service could not start";
            emitStatus();
        }
    }

    private void send(int what, Bundle data) {
        Message m = Message.obtain(null, what);
        m.setData(data);
        m.replyTo = replies;
        if (service != null) sendNow(m);
        else {
            queue.add(m);
            ensureBound();
        }
    }

    private void sendNow(Message m) {
        try {
            service.send(m);
        } catch (RemoteException e) {
            Log.w(TAG, "send failed: " + e);
        }
    }

    void release() {
        if (service != null || binding) {
            try {
                ctx.unbindService(conn);
            } catch (IllegalArgumentException ignored) { }
        }
        service = null;
        binding = false;
        cancelDownload = true;
    }

    /* ------------------------------------------------------ the requests */
    void load(String file, int nCtx, int nThreads) {
        if (!ModelFiles.isSafeName(file) || !new File(dir, file).isFile()) {
            state = "error";
            error = "no model file named " + file + " on this tablet";
            emit("loaded", status());
            return;
        }
        wantedFile = file;
        if (nCtx > 0) wantedCtx = nCtx;
        if (nThreads > 0) wantedThreads = nThreads;
        state = "loading";
        error = "";
        emitStatus();
        Bundle b = new Bundle();
        b.putString("path", new File(dir, file).getAbsolutePath());
        b.putInt("nCtx", wantedCtx);
        b.putInt("nThreads", wantedThreads);
        send(ModelService.MSG_LOAD, b);
    }

    void unload() {
        Bundle b = new Bundle();
        send(ModelService.MSG_UNLOAD, b);
        loadedFile = "";
        description = "";
        state = "none";
        emitStatus();
    }

    void chat(String id, String system, String user, int maxTokens, boolean stream) {
        Bundle b = new Bundle();
        b.putString("id", id);
        b.putString("system", system);
        b.putString("user", user);
        b.putInt("maxTokens", maxTokens);
        b.putBoolean("stream", stream);
        if (!"ready".equals(state)) {
            JSONObject o = new JSONObject();
            try {
                o.put("id", id);
                o.put("ok", false);
                o.put("error", "the tablet's model is not started");
            } catch (JSONException ignored) { }
            emit("done", o);
            return;
        }
        send(ModelService.MSG_CHAT, b);
    }

    void cancel(String id) {
        Bundle b = new Bundle();
        b.putString("id", id);
        if (service != null) send(ModelService.MSG_CANCEL, b);
    }

    boolean remove(String file) {
        if (!ModelFiles.isSafeName(file)) return false;
        if (file.equals(loadedFile)) unload();
        boolean ok = new File(dir, file).delete();
        emitStatus();
        return ok;
    }

    private void onReply(Message m) {
        Bundle d = m.getData();
        if (d == null) d = new Bundle();
        JSONObject o = new JSONObject();
        try {
            switch (m.what) {
                case ModelService.R_LOADED: {
                    String err = d.getString("error", "");
                    String path = d.getString("path", "");
                    loadMs = d.getLong("ms", 0);
                    if (err.isEmpty()) {
                        state = "ready";
                        error = "";
                        loadedFile = new File(path).getName();
                        description = d.getString("desc", "");
                    } else {
                        state = "error";
                        error = err;
                        loadedFile = "";
                        description = "";
                    }
                    emit("loaded", status());
                    break;
                }
                case ModelService.R_PIECE:
                    o.put("id", d.getString("id", ""));
                    o.put("text", d.getString("text", ""));
                    emit("piece", o);
                    break;
                case ModelService.R_DONE:
                    o.put("id", d.getString("id", ""));
                    o.put("ok", d.getBoolean("ok", false));
                    o.put("text", d.getString("text", ""));
                    o.put("error", d.getString("error", ""));
                    o.put("ms", d.getLong("ms", 0));
                    o.put("pieces", d.getInt("pieces", 0));
                    emit("done", o);
                    break;
                case ModelService.R_STATUS:
                    emitStatus();
                    break;
                default:
                    break;
            }
        } catch (JSONException ignored) { }
    }

    /* ---------------------------------------------- download and import */
    private synchronized void setDownload(String st, String file, long done, long total, String err) {
        try {
            download.put("state", st);
            download.put("file", file);
            download.put("done", done);
            download.put("total", total);
            download.put("error", err == null ? "" : err);
        } catch (JSONException ignored) { }
    }

    synchronized boolean downloading() {
        return downloadThread != null && downloadThread.isAlive();
    }

    /** Downloads url into the models folder as file, resuming a broken
     *  download, then checks its size and its SHA-256 before keeping it. */
    synchronized String startDownload(final String url, final String file, final long bytes, final String sha256) {
        if (downloading()) return "a download is already running";
        if (!ModelFiles.isAllowedUrl(url) || !ModelFiles.isSafeName(file)) return "that download is not allowed";
        long free = new StatFs(dir.getAbsolutePath()).getAvailableBytes();
        final File part = new File(dir, file + ".part");
        long have = part.isFile() ? part.length() : 0;
        if (bytes > 0 && free < bytes - have + (64L << 20)) {
            return "not enough free space: the model needs " + (bytes >> 20) + " MB and the tablet has " + (free >> 20) + " MB free";
        }
        cancelDownload = false;
        setDownload("downloading", file, have, bytes, "");
        emitStatus();
        downloadThread = new Thread(() -> runDownload(url, file, bytes, sha256, part), "inkwell-model-download");
        downloadThread.start();
        return "";
    }

    void cancelDownload() {
        cancelDownload = true;
    }

    private void runDownload(String url, String file, long bytes, String sha256, File part) {
        HttpURLConnection c = null;
        try {
            long have = part.isFile() ? part.length() : 0;
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(60000);
            if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
            int code = c.getResponseCode();
            if (code == 200) have = 0;  // the server sent the whole file: start again
            else if (code != 206) throw new IOException("the server answered " + code);
            long total = bytes > 0 ? bytes : (have + Math.max(0, c.getContentLengthLong()));
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part, have > 0)) {
                byte[] buf = new byte[1 << 16];
                long done = have, lastEmit = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancelDownload) throw new IOException("cancelled");
                    out.write(buf, 0, n);
                    done += n;
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastEmit > 500) {
                        lastEmit = now;
                        setDownload("downloading", file, done, total, "");
                        JSONObject o = new JSONObject();
                        o.put("file", file);
                        o.put("done", done);
                        o.put("total", total);
                        emit("progress", o);
                    }
                }
            }
            if (bytes > 0 && part.length() != bytes) {
                throw new IOException("the download is incomplete (" + part.length() + " of " + bytes + " bytes); press Install again to resume");
            }
            setDownload("verifying", file, part.length(), part.length(), "");
            emitStatus();
            if (!ModelFiles.looksLikeGguf(part)) {
                part.delete();
                throw new IOException("the downloaded file is not a GGUF model");
            }
            if (sha256 != null && !sha256.isEmpty() && !ModelFiles.sha256(part).equalsIgnoreCase(sha256)) {
                part.delete();
                throw new IOException("the downloaded file failed its check (SHA-256) and was deleted; press Install to download it again");
            }
            File dest = new File(dir, file);
            if (dest.exists()) dest.delete();
            if (!part.renameTo(dest)) throw new IOException("the file could not be kept");
            setDownload("done", file, dest.length(), dest.length(), "");
            JSONObject o = new JSONObject();
            o.put("file", file);
            emit("downloaded", o);
        } catch (IOException | JSONException | RuntimeException e) {
            String why = e.getMessage() == null ? e.toString() : e.getMessage();
            setDownload(cancelDownload ? "cancelled" : "error", file, part.isFile() ? part.length() : 0, bytes, why);
            JSONObject o = new JSONObject();
            try {
                o.put("file", file);
                o.put("error", why);
            } catch (JSONException ignored) { }
            emit("downloadError", o);
        } finally {
            if (c != null) c.disconnect();
            emitStatus();
        }
    }

    /** Copies a model file the user picked (for instance from Downloads, or
     *  copied over by USB) into the app's folder. */
    void importFrom(final Uri uri, final String displayName) {
        new Thread(() -> {
            String name = ModelFiles.importName(displayName);
            File part = new File(dir, name + ".part");
            try (InputStream in = ctx.getContentResolver().openInputStream(uri);
                 OutputStream out = new FileOutputStream(part)) {
                if (in == null) throw new IOException("the file could not be opened");
                byte[] buf = new byte[1 << 16];
                long done = 0, lastEmit = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastEmit > 500) {
                        lastEmit = now;
                        JSONObject o = new JSONObject();
                        o.put("file", name);
                        o.put("done", done);
                        o.put("total", 0);
                        emit("progress", o);
                    }
                }
            } catch (IOException | JSONException | SecurityException e) {
                part.delete();
                JSONObject o = new JSONObject();
                try {
                    o.put("file", name);
                    o.put("error", "the file could not be copied: " + e.getMessage());
                } catch (JSONException ignored) { }
                emit("downloadError", o);
                emitStatus();
                return;
            }
            if (!ModelFiles.looksLikeGguf(part)) {
                part.delete();
                JSONObject o = new JSONObject();
                try {
                    o.put("file", name);
                    o.put("error", "that file is not a GGUF model");
                } catch (JSONException ignored) { }
                emit("downloadError", o);
                emitStatus();
                return;
            }
            File dest = new File(dir, name);
            if (dest.exists()) dest.delete();
            part.renameTo(dest);
            JSONObject o = new JSONObject();
            try {
                o.put("file", name);
            } catch (JSONException ignored) { }
            emit("downloaded", o);
            emitStatus();
        }, "inkwell-model-import").start();
    }
}
