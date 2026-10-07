/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import android.app.ActivityManager;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Process;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

import java.io.File;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/**
 * 7.35: the tablet's model, end to end on an emulator: the real download
 * (checked by SHA-256), the model process, an answer, a stop, and the system
 * closing the model's process for memory without touching the app.
 */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class ModelEndToEndTest {
    static final String URL = "https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf";
    static final String FILE = "LFM2.5-1.2B-Instruct-Q4_K_M.gguf";
    static final long BYTES = 730895168L;
    static final String SHA = "b1b3de114215d9507409a662a501a631095a479a419584e8a2ded6304b19b4f5";
    static final String PROOF = "You are a careful copy editor. Correct only errors of grammar, spelling and punctuation in the user's text. "
            + "Change as little as possible: keep every word that is already correct, keep the writer's meaning, register and "
            + "voice, keep names, numbers, quotations and citations exactly. If the text is already correct, return it unchanged. "
            + "Output only the corrected text, with no explanation.";

    private static ModelHost host;
    private static final LinkedBlockingQueue<JSONObject> events = new LinkedBlockingQueue<JSONObject>();

    private static ModelHost host() {
        if (host == null) {
            final Instrumentation in = InstrumentationRegistry.getInstrumentation();
            in.runOnMainSync(() -> host = new ModelHost(in.getTargetContext(), events::add));
        }
        return host;
    }

    /** The next event of one of the given types, failing on an error event. */
    private static JSONObject await(long seconds, String... types) throws Exception {
        long end = System.currentTimeMillis() + seconds * 1000;
        while (System.currentTimeMillis() < end) {
            JSONObject e = events.poll(1, TimeUnit.SECONDS);
            if (e == null) continue;
            String t = e.optString("type");
            for (String want : types) if (want.equals(t)) return e;
            if ("downloadError".equals(t)) fail("download error: " + e.optString("error"));
        }
        fail("no " + String.join("/", types) + " event in " + seconds + " s");
        return null;
    }

    private static void runOnMain(Runnable r) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(r);
    }

    @Test
    public void a_downloadsAndChecksTheModel() throws Exception {
        ModelHost h = host();
        File f = new File(h.folder(), FILE);
        if (f.isFile() && f.length() == BYTES) return;  // kept from an earlier run
        final String[] r = new String[1];
        runOnMain(() -> r[0] = h.startDownload(URL, FILE, BYTES, SHA));
        assertEquals("", r[0]);
        await(1800, "downloaded");
        assertTrue(f.isFile());
        assertEquals(BYTES, f.length());
    }

    @Test
    public void b_refusesForeignDownloads() {
        ModelHost h = host();
        assertTrue(!h.startDownload("https://example.com/x.gguf", "x.gguf", 10, "").isEmpty());
        assertTrue(!h.startDownload(URL, "../evil.gguf", 10, "").isEmpty());
    }

    @Test
    public void c_startsAndAnswers() throws Exception {
        ModelHost h = host();
        runOnMain(() -> h.load(FILE, 4096, 4));
        JSONObject e = await(600, "loaded");
        assertEquals(e.toString(), "ready", e.optString("state"));
        events.clear();
        runOnMain(() -> h.chat("t1", PROOF,
                "The results of the study shows that participants was more likely to recall items, as Smith (2019, p. 12) argues.", 120, true));
        boolean sawPiece = false;
        JSONObject done = null;
        long end = System.currentTimeMillis() + 600_000;
        while (done == null && System.currentTimeMillis() < end) {
            JSONObject x = events.poll(1, TimeUnit.SECONDS);
            if (x == null) continue;
            if ("piece".equals(x.optString("type"))) sawPiece = true;
            if ("done".equals(x.optString("type"))) done = x;
        }
        assertNotNull("no answer", done);
        String text = done.optString("text");
        android.util.Log.i("InkwellTest", "answer in " + done.optLong("ms") + " ms: " + text);
        assertTrue(done.toString(), done.optBoolean("ok"));
        assertTrue("streamed", sawPiece);
        assertTrue(text, text.contains("Smith (2019, p. 12)"));
        assertTrue(text, text.contains("show ") || text.contains("showed"));
    }

    @Test
    public void d_keepsEveryCharacter() throws Exception {
        ModelHost h = host();
        events.clear();
        runOnMain(() -> h.chat("t2", PROOF, "Café naïve résumé — “quoted” 𝔄 test 😀 is fine.", 60, false));
        JSONObject done = await(600, "done");
        String text = done.optString("text");
        assertTrue(text, text.contains("Café") && text.contains("😀") && text.contains("𝔄"));
    }

    @Test
    public void e_stopsWhenAsked() throws Exception {
        ModelHost h = host();
        events.clear();
        runOnMain(() -> h.chat("t3", "", "Write a long essay on the history of the printing press.", 600, true));
        await(300, "piece");
        runOnMain(() -> h.cancel("t3"));
        JSONObject done = await(300, "done");
        assertTrue(done.toString(), !done.optBoolean("ok") && "cancelled".equals(done.optString("error")));
    }

    @Test
    public void f_survivesTheSystemClosingTheModel() throws Exception {
        ModelHost h = host();
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        int pid = 0;
        for (ActivityManager.RunningAppProcessInfo p : am.getRunningAppProcesses()) {
            if (p.processName.endsWith(":model")) pid = p.pid;
        }
        assertTrue("the model runs in its own process", pid != 0 && pid != Process.myPid());
        events.clear();
        Process.killProcess(pid);
        JSONObject e = await(120, "stopped");
        assertTrue(e.optString("error"), e.optString("error").contains("documents"));
        // this process (the app) is still here, and the model starts again
        runOnMain(() -> h.load(FILE, 4096, 4));
        JSONObject l = await(600, "loaded");
        assertEquals(l.toString(), "ready", l.optString("state"));
    }
}
