import { AutoProcessor, AutoModelForAudioFrameClassification, AutoModel, AutoFeatureExtractor, env } from '@huggingface/transformers';
import fs from 'fs'; import { createRequire } from 'module'; const SG = createRequire(import.meta.url)('./segs.cjs'); import { analyse, assign } from './diar.mjs';
env.cacheDir = '../hf';
function wav(p){ const b=fs.readFileSync(p); let o=12, fmt, data; while(o<b.length){ const id=b.toString('ascii',o,o+4), n=b.readUInt32LE(o+4); if(id==='fmt ') fmt={ch:b.readUInt16LE(o+10),sr:b.readUInt32LE(o+12)}; if(id==='data'){ data=b.subarray(o+8,o+8+n); break;} o+=8+n+(n&1);} 
  const N=data.length/2/fmt.ch, f=new Float32Array(N); for(let i=0;i<N;i++) f[i]=data.readInt16LE(i*2*fmt.ch)/32768; return f; }
export function der(ref, hyp, dur, step = 0.01) {
  const T = Math.ceil(dur / step), rs = [...new Set(ref.map(s => s[2]))], hs = [...new Set(hyp.map(s => s.spk))];
  const R = rs.map(() => new Uint8Array(T)), H = hs.map(() => new Uint8Array(T));
  for (const [a, b, s] of ref) { const r = R[rs.indexOf(s)]; for (let t = Math.floor(a / step); t < Math.min(T, Math.ceil(b / step)); t++) r[t] = 1; }
  for (const s of hyp) { const h = H[hs.indexOf(s.spk)]; for (let t = Math.floor(s.start / step); t < Math.min(T, Math.ceil(s.end / step)); t++) h[t] = 1; }
  const ov = R.map(r => H.map(h => { let n = 0; for (let t = 0; t < T; t++) n += r[t] & h[t]; return n; }));
  // best one-to-one mapping (Hungarian by brute force over small sets)
  let best = 0, bestMap = null;
  const rec = (i, used, sum, map) => { if (i === rs.length) { if (sum >= best) { best = sum; bestMap = map.slice(); } return; }
    rec(i + 1, used, sum, [...map, -1]); for (let j = 0; j < hs.length; j++) if (!(used & (1 << j))) rec(i + 1, used | (1 << j), sum + ov[i][j], [...map, j]); };
  rec(0, 0, 0, []);
  let tot = 0, miss = 0, fa = 0, conf = 0;
  for (let t = 0; t < T; t++) { let nr = 0, nh = 0, nc = 0; for (let i = 0; i < rs.length; i++) if (R[i][t]) { nr++; const j = bestMap[i]; if (j >= 0 && H[j][t]) nc++; } for (const h of H) nh += h[t];
    tot += nr; miss += Math.max(0, nr - nh); fa += Math.max(0, nh - nr); conf += Math.min(nr, nh) - nc; }
  return { map: bestMap, R, H, rs, hs, der: (miss + fa + conf) / tot, miss: miss / tot, fa: fa / tot, conf: conf / tot };
}
// paragraphs: Scriba's own pieces (pauses, at most 24 s). A paragraph takes the detected speaker who
// speaks most in it. Score: the share of single-speaker speech time whose paragraph names the right person.
export function paraAcc(E, pieces, step = 0.01, cutTurns = false) {
  const T = E.R[0].length, inv = new Map(); E.map.forEach((j, i) => { if (j >= 0) inv.set(j, i); });
  let paras = pieces.map(p => [Math.floor(p[0] / step), Math.min(T, Math.ceil(p[1] / step))]);
  if (cutTurns) { // split where the detected dominant speaker changes for at least 1 s
    const dom = new Int16Array(T).fill(-1); for (let t = 0; t < T; t++) for (let j = 0; j < E.H.length; j++) if (E.H[j][t]) { dom[t] = j; break; }
    const out = []; for (const [a, b] of paras) { let st = a, cur = -1;
      for (let t = a; t < b; t++) { if (dom[t] < 0 || dom[t] === cur) continue; let run = 0; while (t + run < b && (dom[t + run] === dom[t] || dom[t + run] < 0) && run < 100) run++;
        if (run >= 100 || t + run >= b) { if (cur >= 0 && t - st >= 100) { out.push([st, t]); st = t; } cur = dom[t]; } }
      out.push([st, b]); } paras = out; }
  let ok = 0, tot = 0, n = 0;
  for (const [a, b] of paras) { const cnt = E.H.map(h => { let s = 0; for (let t = a; t < b; t++) s += h[t]; return s; }); let j = -1, bv = 0; cnt.forEach((v, k) => { if (v > bv) { bv = v; j = k; } });
    const lab = j >= 0 && inv.has(j) ? inv.get(j) : -1; n++;
    for (let t = a; t < b; t++) { let nr = 0, who = -1; for (let i = 0; i < E.R.length; i++) if (E.R[i][t]) { nr++; who = i; } if (nr !== 1) continue; tot++; if (who === lab) ok++; } }
  return { acc: ok / tot, n };
}
const man = JSON.parse(fs.readFileSync('../manifest.json'));
const which = process.argv[2] || 'val', grid = JSON.parse(process.argv[3] || '[{}]'), limit = +(process.argv[4] || 99);
const M = { seg: await AutoModelForAudioFrameClassification.from_pretrained('onnx-community/pyannote-segmentation-3.0', { dtype: process.env.SEGQ || 'fp32' }),
  sp: await AutoProcessor.from_pretrained('onnx-community/pyannote-segmentation-3.0'),
  emb: await AutoModel.from_pretrained('onnx-community/wespeaker-voxceleb-resnet34-LM', { dtype: process.env.EMBQ || 'fp32' }),
  fe: await AutoFeatureExtractor.from_pretrained('onnx-community/wespeaker-voxceleb-resnet34-LM') };
const res = [];
// EXC="3,5,10": excerpts of that many minutes, starting 5 minutes in, instead of whole meetings
let list = man.filter(m => m.split === which).slice(0, limit);
if (process.env.EXC) list = list.flatMap(m => process.env.EXC.split(',').map(Number).filter(x => 300 + x * 60 <= m.dur).map(x => ({ ...m, name: m.name + '_x' + x, x0: 300, dur: x * 60,
  segs: m.segs.filter(s => s[1] > 300 && s[0] < 300 + x * 60).map(s => [Math.max(0, s[0] - 300), Math.min(x * 60, s[1] - 300), s[2]]) })));
for (const m of list) {
  let f = wav('../' + m.file.replace(/_x\d+$/, '')); if (m.x0 != null) f = f.slice(m.x0 * 16000, (m.x0 * 16000) + m.dur * 16000);
  m.nspk = new Set(m.segs.map(s => s[2])).size;
  const pieces = SG.scribaSegments(f, 16000, 24).map(g => [g.from / 16000, g.to / 16000]);
  const cache = '../cache_' + m.name + '_' + (process.env.TAG || 'a') + '.json'; let A;
  const t0 = Date.now();
  if (fs.existsSync(cache)) { A = JSON.parse(fs.readFileSync(cache)); A.embs.forEach(e => e.v = Float32Array.from(e.v)); A.wins.forEach(w => w.act = w.act.map(a => Uint8Array.from(a))); }
  else { A = await analyse(f, M, JSON.parse(process.env.AOPT || "{}")); fs.writeFileSync(cache, JSON.stringify({ ...A, embs: A.embs.map(e => ({ ...e, v: [...e.v] })), wins: A.wins.map(w => ({ ...w, act: w.act.map(a => [...a]) })) })); A.secs = (Date.now() - t0) / 1000; }
  for (const o of grid) {
    const t = Date.now(); const r = assign(A, f.length, o.n === 'ref' ? { ...o, n: m.nspk } : o); const e = der(m.segs, r.segs, m.dur); const pa = paraAcc(e, pieces), pb = paraAcc(e, pieces, 0.01, true); delete e.map; delete e.R; delete e.H; delete e.rs; delete e.hs; e.para = pa.acc; e.paraCut = pb.acc; e.nPara = pa.n / 100; e.nParaCut = pb.n / 100;
    const row = { clip: m.name, path: m.path, min: +(m.dur / 60).toFixed(1), o, refSpk: m.nspk, hypSpk: r.nspk, nEmb: r.nEmb, ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, +(v * 100).toFixed(1)])), secs: +((Date.now() - t) / 1000).toFixed(0), segS: r.tSeg / 1000 | 0, embS: r.tEmb / 1000 | 0 };
    console.log(JSON.stringify(row)); res.push(row);
  }
}
fs.writeFileSync(`res_${which}_${Date.now()}.json`, JSON.stringify(res));
