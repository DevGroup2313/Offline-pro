"""score.py SET HYP.json [cat]  -> ERRANT span-based correction P, R, F0.5.
HYP.json: corrected texts (plain), one per sentence of SET. Only the words a
system changed are re-tokenised; unchanged words keep the corpus's own
tokens, so tokenisation differences add no false edits."""
import json,subprocess,sys,os,re,difflib,errant
S,H=sys.argv[1],sys.argv[2]; cat=sys.argv[3] if len(sys.argv)>3 else ''
rows=json.load(open(f'{S}.json')); hyp=json.load(open(H)); assert len(hyp)==len(rows),(len(hyp),len(rows))
A=errant.load('en')
W=re.compile(r"[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|n't|'[a-z]+|\S")
def spans(s): return [(m.group(0),m.start(),m.end()) for m in W.finditer(s)]
fallback=0
def to_tokens(r,h):
    global fallback
    src=r['text']; ot=r['orig'].split(' ')
    if h==src: return ot
    offs=[];cur=0
    for t in ot:
        k=src.find(t,cur)
        if k<0: fallback+=1; return [t.text for t in A.parse(h,tokenise=True)]
        offs.append((k,k+len(t))); cur=k+len(t)
    a,b=spans(src),spans(h)
    sm=difflib.SequenceMatcher(a=[x[0] for x in a],b=[x[0] for x in b],autojunk=False)
    hunks=[]
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op=='equal': continue
        s0=a[i1][1] if i1<len(a) else len(src); e0=a[i2-1][2] if i2>i1 else s0
        rep=h[b[j1][1]:b[j2-1][2]] if j2>j1 else ''
        idx=[n for n,(x,y) in enumerate(offs) if x<e0 and y>s0] if e0>s0 else []
        if idx: lo,hi=idx[0],idx[-1]+1
        else: lo=next((n for n,(x,y) in enumerate(offs) if x>=s0),len(ot)); hi=lo
        hunks.append((lo,hi,[t.text for t in A.parse(rep,tokenise=True)] if rep.strip() else []))
    out=list(ot)
    for lo,hi,rt in sorted(hunks,key=lambda x:(x[0],x[1]),reverse=True): out[lo:hi]=rt
    return out
base=os.path.splitext(H)[0]
with open(base+'.orig.txt','w') as fo, open(base+'.cor.txt','w') as fc:
    for r,h in zip(rows,hyp):
        h=(h or '').replace('\n',' ').strip() or r['text']
        fo.write(r['orig']+'\n'); fc.write(' '.join(to_tokens(r,h))+'\n')
subprocess.run(['../venv/bin/errant_parallel','-orig',base+'.orig.txt','-cor',base+'.cor.txt','-out',base+'.hyp.m2'],check=True,stdout=subprocess.DEVNULL)
args=['../venv/bin/errant_compare','-hyp',base+'.hyp.m2','-ref',f'{S}.m2']+(['-cat',cat] if cat else [])
out=subprocess.run(args,capture_output=True,text=True).stdout
print(out.strip()); print('re-tokenised whole sentences:',fallback)
m=re.search(r'TP\tFP\tFN\tPrec\tRec\tF0.5\n(\d+)\t(\d+)\t(\d+)\t([\d.]+)\t([\d.]+)\t([\d.]+)',out)
if m: json.dump(dict(zip(['TP','FP','FN','P','R','F05'],[float(x) for x in m.groups()])),open(base+'.score.json','w'))
