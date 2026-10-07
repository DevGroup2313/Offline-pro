/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * 7.35: the writing model, in a process of its own (":model" in the
 * manifest). If the system needs the memory back, it closes this process,
 * not the page: the documents stay open and saved, and the page says the
 * model stopped. Requests are answered one at a time, in order.
 */
public class ModelService extends Service {
    static final String TAG = "InkwellModel";
    // requests from the app
    static final int MSG_LOAD = 1, MSG_CHAT = 2, MSG_CANCEL = 3, MSG_UNLOAD = 4, MSG_STATUS = 5;
    // answers to the app
    static final int R_LOADED = 101, R_PIECE = 102, R_DONE = 103, R_STATUS = 104;

    private HandlerThread worker;
    private Handler work;
    private NativeLlm llm;
    private volatile String loadedPath = "";
    private volatile String description = "";
    private volatile boolean busy;
    private final Set<String> cancelled = Collections.synchronizedSet(new HashSet<String>());

    private final Messenger messenger = new Messenger(new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(Message m) {
            onRequest(m);
        }
    });

    @Override
    public void onCreate() {
        super.onCreate();
        worker = new HandlerThread("inkwell-model");
        worker.start();
        work = new Handler(worker.getLooper());
    }

    @Override
    public IBinder onBind(Intent intent) {
        return messenger.getBinder();
    }

    @Override
    public void onDestroy() {
        if (work != null) {
            work.post(() -> {
                if (llm != null) {
                    llm.close();
                    llm = null;
                }
            });
        }
        if (worker != null) worker.quitSafely();
        super.onDestroy();
    }

    private void onRequest(Message m) {
        final Bundle d = m.getData() == null ? new Bundle() : new Bundle(m.getData());
        final Messenger reply = m.replyTo;
        switch (m.what) {
            case MSG_LOAD:
                work.post(() -> doLoad(d.getString("path", ""), d.getInt("nCtx", 4096), d.getInt("nThreads", 4), reply));
                break;
            case MSG_CHAT:
                work.post(() -> doChat(d.getString("id", ""), d.getString("system", ""), d.getString("user", ""),
                        d.getInt("maxTokens", 400), d.getBoolean("stream", false), reply));
                break;
            case MSG_CANCEL:
                cancelled.add(d.getString("id", ""));
                break;
            case MSG_UNLOAD:
                work.post(() -> {
                    if (llm != null) llm.unload();
                    loadedPath = "";
                    description = "";
                    send(reply, R_STATUS, status());
                });
                break;
            case MSG_STATUS:
                send(reply, R_STATUS, status());
                break;
            default:
                break;
        }
    }

    private Bundle status() {
        Bundle b = new Bundle();
        b.putString("path", loadedPath);
        b.putString("desc", description);
        b.putBoolean("busy", busy);
        return b;
    }

    private void doLoad(String path, int nCtx, int nThreads, Messenger reply) {
        Bundle b = new Bundle();
        b.putString("path", path);
        long t0 = SystemClock.elapsedRealtime();
        String err;
        try {
            if (path.equals(loadedPath) && llm != null) {
                err = "";
            } else if (!new File(path).isFile()) {
                err = "the model file is missing";
            } else {
                if (llm == null) {
                    NativeLlm.init(getApplicationInfo().nativeLibraryDir);
                    llm = new NativeLlm();
                }
                loadedPath = "";
                description = "";
                err = llm.load(path, nCtx, nThreads);
                if (err.isEmpty()) {
                    loadedPath = path;
                    description = llm.describe();
                }
            }
        } catch (UnsatisfiedLinkError e) {
            err = "this tablet's processor is not one the model's engine was built for (" + e.getMessage() + ")";
        } catch (RuntimeException e) {
            err = "the model did not start: " + e;
        }
        b.putString("error", err);
        b.putString("desc", description);
        b.putLong("ms", SystemClock.elapsedRealtime() - t0);
        Log.i(TAG, "load " + path + ": " + (err.isEmpty() ? "ready, " + description : err));
        send(reply, R_LOADED, b);
    }

    private void doChat(final String id, String system, String user, int maxTokens, final boolean stream,
                        final Messenger reply) {
        Bundle b = new Bundle();
        b.putString("id", id);
        if (llm == null || loadedPath.isEmpty()) {
            b.putBoolean("ok", false);
            b.putString("error", "the tablet's model is not started");
            send(reply, R_DONE, b);
            return;
        }
        if (cancelled.remove(id)) {
            b.putBoolean("ok", false);
            b.putString("error", "cancelled");
            send(reply, R_DONE, b);
            return;
        }
        busy = true;
        final long t0 = SystemClock.elapsedRealtime();
        final StringBuilder chunk = new StringBuilder();
        final long[] lastSent = {t0};
        final int[] pieces = {0};
        String answer = llm.chat(system, user, maxTokens, piece -> {
            pieces[0]++;
            if (cancelled.contains(id)) return false;
            if (stream) {
                chunk.append(piece);
                long now = SystemClock.elapsedRealtime();
                // pieces travel in small bundles, not one message per token
                if (now - lastSent[0] > 120 || piece.indexOf('\n') >= 0) {
                    Bundle p = new Bundle();
                    p.putString("id", id);
                    p.putString("text", chunk.toString());
                    send(reply, R_PIECE, p);
                    chunk.setLength(0);
                    lastSent[0] = now;
                }
            }
            return true;
        });
        busy = false;
        if (stream && chunk.length() > 0) {
            Bundle p = new Bundle();
            p.putString("id", id);
            p.putString("text", chunk.toString());
            send(reply, R_PIECE, p);
        }
        boolean wasCancelled = cancelled.remove(id);
        b.putBoolean("ok", answer != null && !wasCancelled);
        b.putString("text", answer == null ? "" : answer);
        b.putString("error", wasCancelled ? "cancelled" : answer == null ? llm.lastError() : "");
        b.putLong("ms", SystemClock.elapsedRealtime() - t0);
        b.putInt("pieces", pieces[0]);
        send(reply, R_DONE, b);
    }

    private static void send(Messenger to, int what, Bundle data) {
        if (to == null) return;
        Message r = Message.obtain(null, what);
        r.setData(data);
        try {
            to.send(r);
        } catch (RemoteException e) {
            Log.w(TAG, "the app is gone: " + e);
        }
    }
}
