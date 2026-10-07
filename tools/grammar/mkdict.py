"""Make vendor/scowl-words.txt from SCOWL 2020.12.07: British, American and
Canadian spellings, common variants, names, contractions and abbreviations,
sizes 10 to 70; one line per size: "size word word ...". """
import glob,sys,collections
src,dst=sys.argv[1],sys.argv[2]
cats={'english','american','british','british_z','canadian','variant_1'}
kinds={'words','contractions','proper-names','upper','abbreviations'}
lv={}
for f in glob.glob(src+'/final/*.*'):
    name,l=f.rsplit('/',1)[1].rsplit('.',1); l=int(l)
    c,k=name.split('-',1)
    if c not in cats or k not in kinds or l>70: continue
    for w in open(f,encoding='latin-1'):
        w=w.strip()
        if not w or not w.isascii(): continue
        if w not in lv or lv[w]>l: lv[w]=l
by=collections.defaultdict(list)
for w,l in lv.items(): by[l].append(w)
with open(dst,'w') as o:
    for l in sorted(by): o.write(str(l)+' '+' '.join(sorted(by[l]))+'\n')
print(len(lv),'words')
