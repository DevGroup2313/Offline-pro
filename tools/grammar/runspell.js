// the spelling checker alone, every fix accepted; options from argv JSON
const fs=require('fs'),SP=require('/home/user/inkwell-fire/src/lib/spell_core.js');const D=SP.load(fs.readFileSync('spell/scowl-words.txt','utf8'));
const [set,optj,tag]=process.argv.slice(2); const opt=JSON.parse(optj||'{}');
const rows=JSON.parse(fs.readFileSync(set+'.json')); let t=Date.now(), flagged=0, fixed=0;
const out=rows.map(r=>{const E=SP.check(D,r.text,opt); flagged+=E.length; let o='',p=0; for(const e of E){ if(e.fix==null) continue; fixed++; o+=r.text.slice(p,e.start)+e.fix; p=e.end;} return o+r.text.slice(p);});
fs.writeFileSync(`hyp_${tag}_${set}.json`,JSON.stringify(out)); console.error(set,tag,'flagged',flagged,'fixed',fixed,Math.round((Date.now()-t)/rows.length*10)/10,'ms/sentence');
