import json,subprocess
rows=json.load(open('conll14.json'))
def apply(orig,edits,ann):
    toks=orig.split(' '); ed=[]
    for e in edits:
        p=e[2:].split('|||'); a,b=map(int,p[0].split()); 
        if int(p[5])!=ann or p[1]=='noop': continue
        ed.append((a,b,p[2]))
    for a,b,c in sorted(ed,reverse=True):
        toks[a:b]=[t for t in c.split(' ') if t] if c not in ('-NONE-','') else []
    return ' '.join(toks)
cors=[[apply(r['orig'],r['edits'],k) for r in rows] for k in (0,1)]
open('conll14.origtok.txt','w').write('\n'.join(r['orig'] for r in rows)+'\n')
for k in (0,1): open(f'conll14.ann{k}.txt','w').write('\n'.join(cors[k])+'\n')
subprocess.run(['../venv/bin/errant_parallel','-orig','conll14.origtok.txt','-cor','conll14.ann0.txt','conll14.ann1.txt','-out','conll14.m2'],check=True)
print('ok', sum(1 for a,b in zip(*cors) if a!=b),'sentences where the annotators differ')
