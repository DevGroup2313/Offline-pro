/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.Map;
import java.util.TreeMap;

/**
 * The on-disk copy of the library, one file per key (docs.json, notes.json...).
 * The page writes through to it on every save, so a fresh web-view profile can
 * boot from it. Writes are atomic (temporary file, then rename). A store that
 * holds documents is never replaced by one that holds none.
 */
final class Store {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private final File dir;

    Store(File dir) {
        this.dir = dir;
        if (!dir.isDirectory()) dir.mkdirs();
    }

    synchronized boolean put(String key, String value) {
        if (!InkwellCore.isSafeKey(key) || value == null) return false;
        File f = new File(dir, key + ".json");
        if ("docs".equals(key) && InkwellCore.isEmptyList(value) && f.length() > 2) return false;
        File tmp = new File(dir, key + ".json.tmp");
        FileOutputStream os = null;
        try {
            os = new FileOutputStream(tmp);
            os.write(value.getBytes(UTF8));
            os.getFD().sync();
        } catch (IOException e) {
            tmp.delete();
            return false;
        } finally {
            if (os != null) try { os.close(); } catch (IOException ignored) { }
        }
        return tmp.renameTo(f);
    }

    synchronized Map<String, String> readAll() {
        Map<String, String> out = new TreeMap<String, String>();
        File[] files = dir.listFiles();
        if (files == null) return out;
        for (File f : files) {
            String n = f.getName();
            if (!n.endsWith(".json")) continue;
            String key = n.substring(0, n.length() - 5);
            if (!InkwellCore.isSafeKey(key)) continue;
            try {
                out.put(key, read(f));
            } catch (IOException ignored) {
                // an unreadable entry is skipped, never fatal
            }
        }
        return out;
    }

    static String read(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            return new String(readAll(in), UTF8);
        } finally {
            in.close();
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }
}
