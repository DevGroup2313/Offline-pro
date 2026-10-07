// the app's sources together: rules, spelling, the grammar model (through the safety filter)
// order = which source wins where two touch the same words. usage: combine.js SET ORDER OUTTAG [MODELTAG]
const fs=require('fs'),SP=require('/home/user/inkwell-fire/src/lib/spell_core.js'),F=require('./gec_filter.js'),G=require('./gector_core.js');
const D=SP.load(fs.readFileSync('spell/scowl-words.txt','utf8')); const verbs=G.verbForms(fs.readFileSync('verb-form-vocab.txt','utf8'));
const [set,order,tag,mtag='gectorraw',ltag='']=process.argv.slice(2); const rows=JSON.parse(fs.readFileSync(set+'.json'));
const R=JSON.parse(fs.readFileSync(`edits_rules_${set}.json`)); const MR=fs.existsSync(`hyp_${mtag}_${set}.json`)?JSON.parse(fs.readFileSync(`hyp_${mtag}_${set}.json`)):null; const LR=ltag&&fs.existsSync(`hyp_${ltag}_${set}.json`)?JSON.parse(fs.readFileSync(`hyp_${ltag}_${set}.json`)):null;
const out=rows.map((r,i)=>{const t=r.text, src={
  r:R[i].filter(e=>typeof e.fix==='string'),
  s:SP.check(D,t,{margin:0.2,maxScore:1.35}).filter(e=>e.fix!=null),
  m:MR&&MR[i]?F.filter(t,MR[i],verbs).edits:[], l:LR&&LR[i]?F.filter(t,LR[i],verbs).edits:[]};
  let acc=[]; for(const k of order){ if(!src[k]) continue; for(const e of src[k]) if(!acc.some(a=>a.start<e.end+(e.start===e.end?1:0)&&e.start<a.end+(a.start===a.end?1:0))) acc.push(e); }
  acc.sort((a,b)=>a.start-b.start); let o='',p=0; for(const e of acc){ if(e.start<p) continue; o+=t.slice(p,e.start)+e.fix; p=e.end; } return o+t.slice(p);});
fs.writeFileSync(`hyp_${tag}_${set}.json`,JSON.stringify(out));
