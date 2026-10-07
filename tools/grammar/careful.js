// the careful set: only the kinds of suggestion measured reliable; usage careful.js SET RAWTAG OUTTAG [show]
const fs=require('fs'),F=require('./gec_filter.js'),G=require('./gector_core.js');
const verbs=G.verbForms(fs.readFileSync('verb-form-vocab.txt','utf8'));
const KEEP=/^(Agreement|Article|Missing article|Preposition|Missing preposition|Spelling|Verb form)/;
const [set,tag,out,show]=process.argv.slice(2); const rows=JSON.parse(fs.readFileSync(set+'.json')), raw=JSON.parse(fs.readFileSync(`hyp_${tag}_${set}.json`));
let n=0; const res=rows.map((r,i)=>{const E=F.filter(r.text,raw[i],verbs).edits.filter(e=>KEEP.test(F.reason(e.orig,e.fix,verbs)));
  let o='',p=0;for(const e of E){o+=r.text.slice(p,e.start)+e.fix;p=e.end;if(show){n++;console.log(F.reason(e.orig,e.fix,verbs).padEnd(30),JSON.stringify(e.orig),'->',JSON.stringify(e.fix),' | ',r.text.slice(Math.max(0,e.start-50),e.end+40));}}return o+r.text.slice(p);});
fs.writeFileSync(`hyp_${out}_${set}.json`,JSON.stringify(res)); if(show)console.log(n,'suggestions in',rows.length,'sentences');
