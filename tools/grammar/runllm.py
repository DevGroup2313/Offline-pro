"""A model behind llama-server, with the app's proofreading prompt; output passed
later through the app's safety filter. usage: runllm.py MODEL.gguf TAG SET [N]"""
import json,re,subprocess,sys,time,urllib.request,os,random
model,tag,S=sys.argv[1],sys.argv[2],sys.argv[3]; N=int(sys.argv[4]) if len(sys.argv)>4 else 0
LS='/tmp/claude-0/-home-user/fd852a08-466f-59e0-bd9a-5267adb02128/scratchpad/srvtest/bin/linux/llama-server'
port=random.randint(8500,8999)
env=dict(os.environ,LD_LIBRARY_PATH=os.path.dirname(LS))
proc=subprocess.Popen([LS,'-m',model,'--port',str(port),'-c','4096','-t',os.environ.get('THREADS','3'),'--no-webui','--jinja','--reasoning-budget','0'],stdout=subprocess.DEVNULL,stderr=open(f'llm_{tag}.log','w'),env=env)
for _ in range(600):
    try:
        if urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=2).status==200: break
    except Exception: time.sleep(1)
SYS=os.environ.get('SYS') or ("You are a careful copy editor. Correct only errors of grammar, spelling and punctuation in the user's text. Change as little as possible: keep every word that is already correct, keep the writer's meaning, register and voice, keep names, numbers, quotations and citations exactly. If the text is already correct, return it unchanged. Output only the corrected text, with no explanation. Never invent facts, citations or statistics.")
def chat(user,n):
    req=urllib.request.Request(f'http://127.0.0.1:{port}/v1/chat/completions',data=json.dumps({'messages':[{'role':'system','content':SYS},{'role':'user','content':user}],'temperature':float(os.environ.get('TEMP','0')),'max_tokens':n,'stream':False}).encode(),headers={'Content-Type':'application/json'})
    j=json.loads(urllib.request.urlopen(req,timeout=900).read()); c=j['choices'][0]['message'].get('content') or ''
    return re.sub(r'<think>.*?</think>','',c,flags=re.S).strip()
rows=json.load(open(f'{S}.json'))
if N: rows=rows[:N]
out=[];t0=time.time()
for i,r in enumerate(rows):
    out.append(chat(r['text'],min(900,len(r['text'].split())*2+60)))
    if i%100==99: print(i+1,round((time.time()-t0)/(i+1),2),'s each',flush=True)
json.dump(out,open(f'raw_{tag}_{S}{"_"+str(N) if N else ""}.json','w'))
proc.terminate()
print(tag,S,len(rows),'done in',round(time.time()-t0),'s')
