// how often a system changes a sentence that is already correct (Wikipedia)
const fs=require('fs'); const [set,hyp]=process.argv.slice(2);
const rows=JSON.parse(fs.readFileSync(set+'.json')), H=JSON.parse(fs.readFileSync(hyp));
const ch=rows.map((r,i)=>[r.text,H[i]]).filter(([a,b])=>a!==b);
console.log(JSON.stringify({changed:ch.length, of:rows.length, pct:+(100*ch.length/rows.length).toFixed(1)}));
if(process.env.SHOW) ch.slice(0,+process.env.SHOW).forEach(([a,b])=>{const A=a.split(' '),B=b.split(' ');console.log('  ',A.filter((x,i)=>x!==B[i]).slice(0,3).join(' '),'->',B.filter((x,i)=>x!==A[i]).slice(0,3).join(' '));});
