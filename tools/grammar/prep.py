import json,re,random
def read_m2(p):
    out=[];cur=None
    for line in open(p,encoding='utf8'):
        line=line.rstrip('\n')
        if line.startswith('S '): cur={'orig':line[2:],'edits':[]}; out.append(cur)
        elif line.startswith('A ') and cur is not None: cur['edits'].append(line)
    return out
def detok(s):
    s=re.sub(r'\s+([.,;:!?%)\]}])',r'\1',s); s=re.sub(r'([(\[{$])\s+',r'\1',s)
    s=re.sub(r"\s+(n't|'s|'re|'ve|'ll|'d|'m)\b",r'\1',s,flags=re.I)
    s=re.sub(r'" (.*?) "',r'"\1"',s); s=re.sub(r'\s{2,}',' ',s).strip(); return s
sets={}
wi=read_m2('data/bea/wi+locness/m2/ABCN.dev.gold.bea19.m2')
# keep the W&I part only (A, B, C); the N (LOCNESS) part has a stricter licence
abc=[]
for lvl in 'ABC': abc+=read_m2(f'data/bea/wi+locness/m2/{lvl}.dev.gold.bea19.m2')
random.Random(7).shuffle(abc)
half=len(abc)//2
sets['wi_tune']=abc[:half]; sets['wi_report']=abc[half:]
sets['conll14']=read_m2('data/conll/conll14st-test-data/noalt/official-2014.combined.m2')
for k,v in sets.items():
    for r in v: r['text']=detok(r['orig'])
    json.dump(v,open(f'{k}.json','w'))
    with open(f'{k}.m2','w') as f:
        for r in v: f.write('S '+r['orig']+'\n'+'\n'.join(r['edits'])+'\n\n')
    nerr=sum(1 for r in v if any(not e.split('|||')[1]=='noop' for e in r['edits']))
    print(k,len(v),'sentences;',nerr,'with an error')
