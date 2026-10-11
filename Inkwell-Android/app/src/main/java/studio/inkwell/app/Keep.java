/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.util.Arrays;

/**
 * 7.40: the keeping. The page hands over whole copies of the library (every
 * room) and the tablet keeps them in the app's own folder (files/earlier-copies),
 * so a cleared web view never costs the writer a page. A copy is two files:
 * MADE.json, the whole copy, and MADE.meta.json, what the list shows. Which
 * copies stay is the page's rule; it asks for the others to be dropped.
 */
final class Keep {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private final File dir;

    Keep(File dir) {
        this.dir = dir;
        if (!dir.isDirectory()) dir.mkdirs();
    }

    static boolean isMade(String made) {
        return made != null && made.matches("[0-9]{10,16}");
    }

    /** the whole copy first, then its line in the list: a listed copy always has its body */
    synchronized boolean put(String made, String meta, String body) {
        if (!isMade(made) || meta == null || body == null) return false;
        return write(new File(dir, made + ".json"), body) && write(new File(dir, made + ".meta.json"), meta);
    }

    /** the list lines as one JSON array */
    synchronized String list() {
        StringBuilder b = new StringBuilder("[");
        String[] names = dir.list();
        if (names == null) return "[]";
        Arrays.sort(names);
        boolean first = true;
        for (String n : names) {
            if (!n.endsWith(".meta.json")) continue;
            String made = n.substring(0, n.length() - 10);
            if (!isMade(made) || !new File(dir, made + ".json").isFile()) continue;
            try {
                String m = Store.read(new File(dir, n)).trim();
                if (!m.startsWith("{") || !m.endsWith("}")) continue;
                if (!first) b.append(',');
                b.append(m);
                first = false;
            } catch (IOException ignored) {
                // an unreadable line is skipped, never fatal
            }
        }
        return b.append(']').toString();
    }

    synchronized String read(String made) {
        if (!isMade(made)) return "";
        File f = new File(dir, made + ".json");
        if (!f.isFile()) return "";
        try {
            return Store.read(f);
        } catch (IOException e) {
            return "";
        }
    }

    synchronized boolean drop(String made) {
        if (!isMade(made)) return false;
        new File(dir, made + ".meta.json").delete();
        new File(dir, made + ".json").delete();
        return true;
    }

    private static boolean write(File f, String text) {
        File tmp = new File(f.getPath() + ".tmp");
        FileOutputStream os = null;
        try {
            os = new FileOutputStream(tmp);
            os.write(text.getBytes(UTF8));
            os.getFD().sync();
        } catch (IOException e) {
            tmp.delete();
            return false;
        } finally {
            if (os != null) try { os.close(); } catch (IOException ignored) { }
        }
        return tmp.renameTo(f);
    }
}
