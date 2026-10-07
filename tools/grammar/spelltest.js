const fs=require('fs'); const SP=require('/home/user/inkwell-fire/src/lib/spell_core.js');
let t=Date.now(); const D=SP.load(fs.readFileSync('spell/scowl-words.txt','utf8')); console.log('load',Date.now()-t,'ms',D.size);
for (const s of ['I recieve alot of informations from my freind.','Teh goverment has decided to procede with the plan.','We visited Paris and Lyon in Febuary; my iPhone and NASA were fine.','She was definately happy, it was a beutiful day.','The colour and the color, organise and organize, travelled.','Its realy importent to adress this.','See https://example.com/foo or mail bob@exmple.com.']) {
  t=Date.now(); const E=SP.check(D,s); console.log(Date.now()-t,'ms', s); E.forEach(e=>console.log('   ',e.orig,'->',e.fix,'|',e.alts.join(', ')));
}
