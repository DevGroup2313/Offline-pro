// for one model run: per kind of suggestion (the safety filter's reason), a hypothesis with only that kind
const fs=require('fs'),F=require('./gec_filter.js'),G=require('./gector_core.js');
const verbs=G.verbForms(fs.readFileSync('verb-form-vocab.txt','utf8'));
const [set,tag]=process.argv.slice(2); const rows=JSON.parse(fs.readFileSync(set+'.json')), raw=JSON.parse(fs.readFileSync(`hyp_${tag}_${set}.json`));
const kinds={};
const E=rows.map((r,i)=>F.filter(r.text,raw[i],verbs).edits.map(e=>{const k=F.reason(e.orig,e.fix,verbs).replace(/:.*/,'');kinds[k]=(kinds[k]||0)+1;return Object.assign(e,{k});}));
for(const k of Object.keys(kinds)){
  const out=rows.map((r,i)=>{let o='',p=0;for(const e of E[i]){if(e.k!==k)continue;o+=r.text.slice(p,e.start)+e.fix;p=e.end;}return o+r.text.slice(p);});
  fs.writeFileSync(`kind_${tag}_${set}_${k.replace(/\W+/g,'_')}.json`,JSON.stringify(out));
}
console.log(JSON.stringify(kinds));
