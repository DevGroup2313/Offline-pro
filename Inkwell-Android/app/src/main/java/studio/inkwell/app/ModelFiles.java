/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * 7.35: the rules for the tablet's model files, kept apart from Android so
 * they are tested on a computer: which names are allowed, where downloads may
 * come from, how a file is checked.
 */
final class ModelFiles {
    private ModelFiles() {}

    /** A model file name: letters, digits, dot, dash, underscore; ends in .gguf. */
    static boolean isSafeName(String n) {
        return n != null && n.length() <= 160 && n.matches("[A-Za-z0-9._\\-]+") && !n.startsWith(".")
                && n.toLowerCase(Locale.ROOT).endsWith(".gguf");
    }

    /** Downloads only from Hugging Face over https. */
    static boolean isAllowedUrl(String u) {
        try {
            URL url = new URL(u);
            return "https".equals(url.getProtocol()) && "huggingface.co".equals(url.getHost())
                    && url.getPath().contains("/resolve/") && isSafeName(url.getPath().substring(url.getPath().lastIndexOf('/') + 1));
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    /** A GGUF file starts with the four bytes "GGUF". */
    static boolean looksLikeGguf(File f) {
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[4];
            return in.read(b) == 4 && b[0] == 'G' && b[1] == 'G' && b[2] == 'U' && b[3] == 'F';
        } catch (IOException e) {
            return false;
        }
    }

    static String sha256(File f) throws IOException {
        MessageDigest md;
        try {
            md = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
        byte[] buf = new byte[1 << 20];
        try (InputStream in = new FileInputStream(f)) {
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder s = new StringBuilder();
        for (byte x : md.digest()) s.append(String.format(Locale.ROOT, "%02x", x & 0xff));
        return s.toString();
    }

    /** The finished model files in the folder, largest first. */
    static List<File> list(File dir) {
        List<File> r = new ArrayList<File>();
        File[] fs = dir.listFiles();
        if (fs == null) return r;
        for (File f : fs) if (f.isFile() && isSafeName(f.getName())) r.add(f);
        r.sort((a, b) -> Long.compare(b.length(), a.length()));
        return r;
    }

    /** A name for an imported file: its own name if safe, else a clean one. */
    static String importName(String displayName) {
        String n = displayName == null ? "" : displayName.replaceAll("[^A-Za-z0-9._\\-]", "_");
        while (n.startsWith(".")) n = n.substring(1);
        if (!n.toLowerCase(Locale.ROOT).endsWith(".gguf")) n = n + ".gguf";
        if (n.length() > 160) n = n.substring(n.length() - 160);
        return isSafeName(n) ? n : "imported-model.gguf";
    }

    /** Threads for the model: the processor's cores, at most four. */
    static int defaultThreads(int cores) {
        return Math.max(1, Math.min(4, cores));
    }

    /** Whether this device can run the engine at all (64-bit ARM or x86). */
    static boolean abiSupported(String[] abis) {
        if (abis == null) return false;
        List<String> l = Arrays.asList(abis);
        return l.contains("arm64-v8a") || l.contains("x86_64");
    }
}
