/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * No licence is granted. See LICENCE.txt.
 */
package studio.inkwell.app;

import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/**
 * 7.35: the whole path on an emulator: the page asks the tablet's model
 * through the app's bridge, and Check shows its corrections with reasons.
 * Runs after ModelEndToEndTest, which leaves the model file on the device.
 */
@RunWith(AndroidJUnit4.class)
public class PageModelTest {
    private static String eval(ActivityScenario<MainActivity> sc, String js) throws Exception {
        final AtomicReference<String> out = new AtomicReference<String>();
        final CountDownLatch done = new CountDownLatch(1);
        sc.onActivity(a -> {
            WebView w = a.webViewForTests();
            w.evaluateJavascript(js, v -> {
                out.set(v);
                done.countDown();
            });
        });
        done.await(30, TimeUnit.SECONDS);
        return out.get();
    }

    private static String until(ActivityScenario<MainActivity> sc, String js, long seconds) throws Exception {
        long end = System.currentTimeMillis() + seconds * 1000;
        String v = null;
        while (System.currentTimeMillis() < end) {
            v = eval(sc, js);
            if (v != null && !v.equals("null") && !v.equals("false") && !v.equals("\"\"")) return v;
            Thread.sleep(1000);
        }
        fail("waited " + seconds + " s for " + js + " (last: " + v + ")");
        return v;
    }

    @Test
    public void checkUsesTheTabletsModel() throws Exception {
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            until(sc, "typeof S==='object'&&typeof correct==='function'&&typeof ed==='object'", 120);
            String st = until(sc, "JSON.stringify(window.InkwellNative&&InkwellNative.model&&InkwellNative.model.status())", 30);
            assertTrue(st, st.contains("supported") && st.contains("true"));
            eval(sc, "window.__t=null;inkTabletStart('LFM2.5-1.2B-Instruct-Q4_K_M.gguf',true).then(function(){window.__t=PRO&&PRO.native?'ready':'no'})");
            String ready = until(sc, "window.__t", 600);
            assertTrue(ready, ready.contains("ready"));
            eval(sc, "window.__c=null;newDoc();ed.value='The results of the study shows that participants was more likely to recall items, as Smith (2019, p. 12) argues.';afterChange();"
                    + "correct().then(function(){setTimeout(function(){window.__c=JSON.stringify(EDITS.filter(function(e){return e.cat==='ai'}).map(function(e){return [e.orig,e.fix,e.why]}))},500)})");
            String edits = until(sc, "window.__c", 900);
            android.util.Log.i("InkwellTest", "suggestions from the tablet's model: " + edits);
            assertTrue(edits, edits.contains("show") || edits.contains("were"));
            assertTrue(edits, edits.contains("tablet"));
        }
    }
}
