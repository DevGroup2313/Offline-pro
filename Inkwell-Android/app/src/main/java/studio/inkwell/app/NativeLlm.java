/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import java.nio.charset.StandardCharsets;

/**
 * 7.35: the writing model on the tablet, through llama.cpp (libinkllm.so).
 * One instance holds one loaded model and answers one request at a time.
 * It has no Android classes, so it is tested on a computer as well.
 */
final class NativeLlm {
    interface Pieces {
        /** A piece of the answer as it grows; return false to stop. */
        boolean onPiece(String piece);
    }

    private static boolean libraryLoaded;
    private long handle;

    static synchronized void init(String nativeLibDir) {
        if (!libraryLoaded) {
            System.loadLibrary("inkllm");
            libraryLoaded = true;
        }
        nativeInit(nativeLibDir == null ? "" : nativeLibDir);
    }

    NativeLlm() {
        handle = nativeCreate();
    }

    /** Loads the model; returns "" on success, else the reason in words. */
    synchronized String load(String path, int nCtx, int nThreads) {
        if (handle == 0) return "closed";
        return nativeLoad(handle, path, nCtx, nThreads);
    }

    synchronized void unload() {
        if (handle != 0) nativeUnload(handle);
    }

    synchronized String describe() {
        return handle == 0 ? "" : nativeDescribe(handle);
    }

    synchronized int countTokens(String text) {
        return handle == 0 ? -1 : nativeCountTokens(handle, text.getBytes(StandardCharsets.UTF_8));
    }

    /** The answer, or null on error (then lastError() says why). */
    synchronized String chat(String system, String user, int maxTokens, final Pieces pieces) {
        if (handle == 0) return null;
        Object cb = pieces == null ? null : new Object() {
            @SuppressWarnings("unused")
            public boolean onPiece(byte[] b) {
                return pieces.onPiece(new String(b, StandardCharsets.UTF_8));
            }
        };
        byte[] r = nativeChat(handle, (system == null ? "" : system).getBytes(StandardCharsets.UTF_8),
                (user == null ? "" : user).getBytes(StandardCharsets.UTF_8), maxTokens, cb);
        return r == null ? null : new String(r, StandardCharsets.UTF_8);
    }

    synchronized String lastError() {
        return handle == 0 ? "closed" : nativeLastError(handle);
    }

    synchronized void close() {
        if (handle != 0) {
            nativeDestroy(handle);
            handle = 0;
        }
    }

    static String systemInfo() {
        return nativeSystemInfo();
    }

    private static native void nativeInit(String libDir);
    private static native long nativeCreate();
    private static native void nativeDestroy(long h);
    private static native String nativeLoad(long h, String path, int nCtx, int nThreads);
    private static native void nativeUnload(long h);
    private static native String nativeDescribe(long h);
    private static native String nativeLastError(long h);
    private static native int nativeCountTokens(long h, byte[] text);
    private static native byte[] nativeChat(long h, byte[] system, byte[] user, int maxTokens, Object cb);
    private static native String nativeSystemInfo();
}
