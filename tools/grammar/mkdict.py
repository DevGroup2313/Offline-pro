"""Make vendor/scowl-words.txt from SCOWL 2020.12.07: British, American and
Canadian spellings, common variants, names, contractions and abbreviations,
sizes 10 to 70; one line per size: "size word word ...".

7.43: one more line, size 80, for the vocabulary of specialised and
scholarly writing ("deontological", "personhood", "generalizability",
"electroconvulsive"). Only SCOWL's main word lists at size 80 (never its
variant lists, where misspellings such as "accomodate" are kept), only
lower-case words of five letters or more, and only words that are not one
slip (a letter added, missing, changed, or two swapped) from a word of
size 70 or less: a word that close to a common one is more often that word
misspelt ("wich", "persue") than a rare word. A few known misspellings that
pass the test are left out by name. The checker counts these words as
known but never offers them as corrections. """
import glob, sys, collections
src, dst = sys.argv[1], sys.argv[2]
cats = {'english', 'american', 'british', 'british_z', 'canadian', 'variant_1'}
main = {'english', 'american', 'british', 'british_z', 'canadian'}
kinds = {'words', 'contractions', 'proper-names', 'upper', 'abbreviations'}
NOT_WORDS = {'publically'}
lv, rare = {}, set()
for f in glob.glob(src + '/final/*.*'):
    name, l = f.rsplit('/', 1)[1].rsplit('.', 1); l = int(l)
    c, k = name.split('-', 1)
    for w in open(f, encoding='latin-1'):
        w = w.strip()
        if not w or not w.isascii(): continue
        if l <= 70 and c in cats and k in kinds:
            if w not in lv or lv[w] > l: lv[w] = l
        elif l == 80 and c in main and k == 'words':
            rare.add(w)
common = set(w.lower() for w in lv)
ABC = 'abcdefghijklmnopqrstuvwxyz'
def slips(w):
    for i in range(len(w) + 1):
        L, R = w[:i], w[i:]
        if R: yield L + R[1:]
        if len(R) > 1: yield L + R[1] + R[0] + R[2:]
        for c in ABC:
            if R: yield L + c + R[1:]
            yield L + c + R
for w in sorted(rare):
    if w in lv or w in NOT_WORDS or not (w.islower() and w.isalpha() and len(w) >= 5): continue
    if any(x in common for x in slips(w)): continue
    lv[w] = 80
by = collections.defaultdict(list)
for w, l in lv.items(): by[l].append(w)
with open(dst, 'w') as o:
    for l in sorted(by): o.write(str(l) + ' ' + ' '.join(sorted(by[l])) + '\n')
print(len(lv), 'words;', len(by[80]), 'at size 80')
