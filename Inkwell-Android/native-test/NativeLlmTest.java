/*
 * INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
 * Tests NativeLlm (the Java side of the tablet's model) on a computer:
 *   java -Djava.library.path=<dir of libinkllm.so> studio.inkwell.app.NativeLlmTest model.gguf
 */
package studio.inkwell.app;

public final class NativeLlmTest {
    static int fails = 0;

    static void check(String what, boolean ok) {
        System.out.println((ok ? "PASS " : "FAIL ") + what);
        if (!ok) fails++;
    }

    public static void main(String[] a) throws Exception {
        NativeLlm.init("");
        NativeLlm m = new NativeLlm();
        check("a missing file is refused with a reason", !m.load("/nonexistent.gguf", 4096, 4).isEmpty());
        String e = m.load(a[0], 4096, 4);
        check("the model loads (" + e + ")", e.isEmpty());
        check("it describes itself: " + m.describe(), !m.describe().isEmpty());
        String sys = "You are a careful copy editor. Correct only errors of grammar, spelling and punctuation in the user's text. "
                + "Change as little as possible: keep every word that is already correct, keep the writer's meaning, register and "
                + "voice, keep names, numbers, quotations and citations exactly. If the text is already correct, return it unchanged. "
                + "Output only the corrected text, with no explanation.";
        final StringBuilder streamed = new StringBuilder();
        long t0 = System.currentTimeMillis();
        String r = m.chat(sys, "The results of the study shows that participants was more likely to recall items, as Smith (2019, p. 12) argues.", 120,
                p -> { streamed.append(p); return true; });
        long t1 = System.currentTimeMillis();
        System.out.println("  answer (" + (t1 - t0) + " ms): " + r);
        check("an answer comes back", r != null && !r.isEmpty());
        check("the streamed pieces equal the answer", r != null && streamed.toString().trim().equals(r));
        check("the citation is kept", r != null && r.contains("Smith (2019, p. 12)"));
        // characters outside the basic plane and accents survive the crossing
        String u = m.chat(sys, "Café naïve résumé — “quoted” 𝔄 test 😀 is fine.", 60, null);
        System.out.println("  unicode: " + u);
        check("accents, quotation marks and emoji survive", u != null && u.contains("Café") && u.contains("😀") && u.contains("𝔄"));
        // stopping early
        final int[] n = {0};
        String s = m.chat("", "Write a long essay about the history of the printing press.", 400, p -> ++n[0] < 5);
        check("a request can be stopped (" + n[0] + " pieces)", s != null && n[0] == 5);
        // too long
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 20000; i++) big.append("word ");
        String t = m.chat(sys, big.toString(), 50, null);
        check("a text too long is refused, not a crash: " + m.lastError(), t == null && m.lastError().contains("too long"));
        check("tokens are counted", m.countTokens("Hello there, reader.") > 0);
        m.unload();
        check("after unload, a request says no model is loaded", m.chat(sys, "Test.", 10, null) == null && m.lastError().contains("no model"));
        m.close();
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
