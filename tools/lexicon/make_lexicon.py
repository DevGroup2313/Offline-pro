#!/usr/bin/env python3
"""Make vendor/wordnet-lex.txt: Inkwell's offline lexicon (7.39).

From Princeton WordNet 3.0 (licence: tools/lexicon/WORDNET-LICENCE.txt, copied
beside the lexicon) and the SCOWL word lists the spelling checker uses.
WordNet gives every meaning of a word, its synonyms for that meaning, a short
definition, how often each meaning is used in its tagged texts, irregular
forms, and usage labels (slang, colloquial, archaic, offensive). SCOWL's size
levels (10 = the commonest words, 70 = rare) give how plain or how rare a
word is. Only words SCOWL knows are kept, so every suggestion is an ordinary
English word. Run:
  python3 tools/lexicon/make_lexicon.py <wordnet-dict-folder> <scowl-words.txt> <out.txt>

The output, one record per line, fields separated by "|":
  S|pos|gloss|lemma:count;...|flags      a meaning (its line number in S order
                                          is its id), each word with how often
                                          it is used in this meaning; flags: c
                                          colloquial or slang, n near-synonyms
                                          only
  W|lemma|level|reg|pos:total,...|id:count,...
                                          a word: its SCOWL level, a register
                                          score (-2 casual .. +2 formal), how
                                          often it is used in all its WordNet
                                          meanings for each part of speech
                                          (kept or not), and its kept meanings,
                                          the most used first; "h<id>:count"
                                          marks a meaning with no synonym of its
                                          own, by its broader meaning <id>
  N|id|id,id                              an adjective meaning and its similar
                                          meanings (WordNet's "similar to")
  E|pos|form|base                         an irregular form and its base
"""
import os
import re
import sys

POS_FILES = (("n", "noun"), ("v", "verb"), ("a", "adj"), ("r", "adv"))
SS_TYPE = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}
LATINATE = re.compile(r"(tion|sion|ment|ity|ance|ence|ive|ous|ate|ize|ise|ify|ial|ary|ory|ure|ism|ical|ible|able|itude|escent)$")
VOWELS = re.compile(r"[aeiouy]+")
PARTICLES = {"up", "out", "off", "down", "in", "on", "over", "away", "back", "around", "about", "through", "along", "by"}
# words a careful writer never wants offered, whatever WordNet says
NEVER = {"ass", "arse", "bitch", "bastard", "crap", "damn", "shit", "piss", "fuck", "cock", "dick", "prick", "tit", "twat"}


def load_scowl(path):
    level = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if not parts:
                continue
            lv = int(parts[0])
            for w in parts[1:]:
                lw = w.lower()
                if lw not in level or lv < level[lw]:
                    level[lw] = lv
    return level


def syllables(w):
    return len(VOWELS.findall(w.lower()))


def main():
    wn, scowl_path, out_path = sys.argv[1:4]
    level = load_scowl(scowl_path)

    def known(lemma):
        parts = lemma.lower().split("_")
        return len(parts) <= 3 and all(p in level and p.isalpha() for p in parts)

    synsets = {}  # (pos, offset) -> dict
    for pos, name in POS_FILES:
        with open(os.path.join(wn, "data." + name), encoding="utf-8") as f:
            for line in f:
                if line.startswith("  "):
                    continue
                head, _, gloss = line.partition(" | ")
                t = head.split()
                off, ss = t[0], t[2]
                wcnt = int(t[3], 16)
                words = []
                for i in range(wcnt):
                    w = t[4 + 2 * i]
                    w = re.sub(r"\([a-z]+\)$", "", w)
                    words.append(w)
                k = 4 + 2 * wcnt
                pcnt = int(t[k])
                ptrs = []
                for i in range(pcnt):
                    sym, poff, ppos = t[k + 1 + 4 * i], t[k + 2 + 4 * i], t[k + 3 + 4 * i]
                    ptrs.append((sym, poff, "a" if ppos == "s" else ppos))
                gl = gloss.strip().split(";")[0].strip().strip('"')
                if len(gl) > 80:
                    gl = gl[:77].rsplit(" ", 1)[0] + "..."
                synsets[(pos, off)] = {"words": words, "ptrs": ptrs, "gloss": gl, "ss": ss}

    # usage labels: the meanings WordNet files under slang, colloquialism and
    # the like are casual; archaic ones are left out; offensive ones never offered
    def find(pos, lemma):
        return [k for k, v in synsets.items() if k[0] == pos and lemma in v["words"]]
    casual_dom = set(find("n", "colloquialism") + find("n", "slang") + find("n", "Americanism") + find("n", "Britishism"))
    archaic_dom = set(find("n", "archaism"))
    bad_dom = set(find("n", "vulgarism") + find("n", "obscenity") + find("n", "ethnic_slur") + find("n", "disparagement"))

    def usage(v):
        doms = {(p[2], p[1]) for p in v["ptrs"] if p[0] == ";u"}
        if doms & bad_dom:
            return "x"
        if doms & archaic_dom:
            return "a"
        if doms & casual_dom:
            return "c"
        return ""

    # how often each meaning of each word is used (WordNet's tagged texts)
    counts, order = {}, {}
    with open(os.path.join(wn, "index.sense"), encoding="utf-8") as f:
        for line in f:
            key, off, sense_no, cnt = line.split()
            lemma, rest = key.split("%", 1)
            pos = SS_TYPE[rest[0]]
            counts[(lemma, pos, off)] = int(cnt)
            order[(lemma, pos, off)] = int(sense_no)

    # keep a meaning if at least two of its words are ordinary English words
    # (an adjective with similar meanings is kept with one)
    ids, rows = {}, []
    for k, v in synsets.items():
        u = usage(v)
        if u in ("x", "a"):
            continue
        keep = [w for w in v["words"] if known(w) and w.lower() not in NEVER and not w[0].isupper()]
        near = k[0] == "a" and any(p[0] == "&" for p in v["ptrs"])
        if len(keep) >= 2 or (keep and near):
            v["keep"] = keep
            v["use"] = u
            ids[k] = len(rows)
            rows.append(k)

    def reg(lemma, pos):
        w = lemma.replace("_", " ")
        parts = w.split()
        lv = max(level.get(p.lower(), 70) for p in parts)
        r = (lv - 35) / 20.0
        if LATINATE.search(parts[-1]) and len(parts[-1]) >= 7:
            r += 0.8
        if syllables(parts[-1]) >= 4:
            r += 0.5
        if pos == "v" and len(parts) == 2 and parts[1] in PARTICLES:
            r -= 1.2
        if len(parts) > 1 and pos != "v":
            r -= 0.2
        return max(-2, min(2, int(round(r)))), lv

    with open(out_path, "w", encoding="utf-8") as out:
        out.write("# Inkwell lexicon from Princeton WordNet 3.0 (see WORDNET-LICENCE.txt) and SCOWL levels\n")
        for k in rows:
            v = synsets[k]
            flags = v["use"] + ("n" if len(v["keep"]) < 2 else "")
            out.write("S|%s|%s|%s|%s\n" % (k[0], v["gloss"].replace("|", "/"), ";".join("%s:%d" % (w.replace("_", " "), counts.get((w.lower(), k[0], k[1]), 0)) for w in v["keep"]), flags))
        # each word's meanings, in WordNet's order of use
        lem = {}
        for k in rows:
            for w in synsets[k]["keep"]:
                lem.setdefault((w.lower(), k[0]), []).append(k)
        # a well-used meaning with no synonym of its own ("house", a dwelling)
        # points to its broader meaning when that one has synonyms
        senses_of = {}
        for (w, pos, off), c in counts.items():
            senses_of.setdefault((w, pos), []).append((off, c))
        broader = {}
        for (w, pos), lst in senses_of.items():
            for off, c in lst:
                k = (pos, off)
                if k in ids or c < 2 or k not in synsets:
                    continue
                for p in synsets[k]["ptrs"]:
                    if p[0] in ("@", "@i") and (p[2], p[1]) in ids:
                        broader.setdefault((w, pos), []).append((ids[(p[2], p[1])], c, order.get((w, pos, off), 99)))
                        break
        for (w, pos) in broader:
            if (w, pos) not in lem and w.isalpha() and w in level:
                lem[(w, pos)] = []
        total = {}
        for (w, pos, off), c in counts.items():
            total[(w, pos)] = total.get((w, pos), 0) + c
        byword = {}
        for (w, pos), ks in lem.items():
            ks.sort(key=lambda k: (-counts.get((w, pos, k[1]), 0), order.get((w, pos, k[1]), 99)))
            byword.setdefault(w, []).extend(ks)
        for w in sorted(byword):
            ks = byword[w]
            poss = sorted({k[0] for k in ks} | {p for (x, p) in broader if x == w}, key="nvar".index)
            r, lv = reg(w, poss[0])
            pos_tot = ",".join("%s:%d" % (p, total.get((w, p), 0)) for p in poss)
            items = [(counts.get((w, k[0], k[1]), 0), "%d:%d" % (ids[k], counts.get((w, k[0], k[1]), 0))) for k in ks]
            for p in poss:
                items += [(c, "h%d:%d" % (i, c)) for i, c, o in broader.get((w, p), [])]
            items.sort(key=lambda x: -x[0])
            out.write("W|%s|%d|%d|%s|%s\n" % (w.replace("_", " "), lv, r, pos_tot, ",".join(x[1] for x in items)))
        for k in rows:
            if k[0] != "a":
                continue
            sim = [ids[("a", p[1])] for p in synsets[k]["ptrs"] if p[0] == "&" and ("a", p[1]) in ids]
            if sim:
                out.write("N|%d|%s\n" % (ids[k], ",".join(map(str, sim))))
        for pos, name in POS_FILES:
            with open(os.path.join(wn, name + ".exc"), encoding="utf-8") as f:
                for line in f:
                    t = line.split()
                    if len(t) >= 2 and known(t[1]) and t[0].isalpha():
                        out.write("E|%s|%s|%s\n" % (pos, t[0], t[1].replace("_", " ")))
    print("meanings", len(rows), "words", len(byword), "->", out_path, os.path.getsize(out_path), "bytes")


if __name__ == "__main__":
    main()
