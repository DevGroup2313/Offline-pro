function scribaSegments(a,rate,maxSec){
  var segs=[], start=0, maxN=Math.round(rate*maxSec), minN=Math.round(rate*3);
  var pauses=scribaPauses(a,rate,0.3);
  while(a.length-start>maxN){
    var best=null;
    for(var i=0;i<pauses.length;i++){ var p=pauses[i], mid=(p.from+p.to)>>1;
      if(mid>start+minN&&mid<=start+maxN&&(!best||(p.to-p.from)>=(best.to-best.from)*0.8)) best=p; }
    var cut;
    if(best) cut=(best.from+best.to)>>1;
    else { var win=a.subarray(start+maxN-Math.round(rate*3),start+maxN); cut=start+maxN-Math.round(rate*3)+scribaQuietCut(win,rate,true); }
    segs.push({from:start, to:cut}); start=cut;
  }
  if(a.length-start>rate*0.3) segs.push({from:start, to:a.length});
  return segs;
}
function scribaPauses(a,rate,minPause){
  var F=scribaFrames(a,rate), q=scribaQuietLevel(F.rms), need=Math.max(1,Math.round(minPause/0.02)), out=[], run=-1;
  for(var i=0;i<=F.rms.length;i++){
    var quiet=i<F.rms.length&&F.rms[i]<q;
    if(quiet&&run<0) run=i;
    if(!quiet&&run>=0){ if(i-run>=need) out.push({from:run*F.f, to:i*F.f}); run=-1; }
  }
  return out;
}
function scribaQuietCut(a,rate,force){
  var f=Math.max(1,Math.round(rate*0.02)), from=Math.max(0,a.length-Math.round(rate*1.5)), best=-1, bestR=1e9;
  for(var i=from;i+f<=a.length;i+=f){ var r=scribaFrameRms(a,i,i+f); if(r<=bestR){ bestR=r; best=i+(f>>1); } }
  if(best<0) return force?a.length:0;
  if(bestR<0.015||force) return best;
  return 0;
}
function scribaFrameRms(a,start,end){ var s2=0,n=0; for(var i=start;i<end&&i<a.length;i++){ s2+=a[i]*a[i]; n++; } return n?Math.sqrt(s2/n):0; }
function scribaPeakRms(a,rate){ var f=Math.max(1,Math.round(rate*0.02)), mx=0; for(var i=0;i+f<=a.length;i+=f){ var r=scribaFrameRms(a,i,i+f); if(r>mx) mx=r; } return mx; }
function scribaFrames(a,rate){
  var f=Math.max(1,Math.round(rate*0.02)), out=[];
  for(var i=0;i+f<=a.length;i+=f) out.push(scribaFrameRms(a,i,i+f));
  return {rms:out, f:f};
}
function scribaQuietLevel(rms){
  if(!rms.length) return 0.006;
  var s2=rms.slice().sort(function(x,y){return x-y;});
  var floor=s2[Math.floor(s2.length*0.15)], loud=s2[Math.floor(s2.length*0.9)];
  return Math.max(0.004, floor*2.5, floor+(loud-floor)*0.12);
}
module.exports={scribaSegments,scribaPauses,scribaQuietCut,scribaFrameRms,scribaPeakRms,scribaFrames,scribaQuietLevel};
