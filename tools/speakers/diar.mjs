// Offline speaker detection, for measurement. The same steps will run in the app's worker.
// 1. pyannote segmentation 3.0 on 10 s windows: who speaks when, within each window (up to 3 local speakers).
// 2. a voice print (WeSpeaker ResNet34) for each local speaker, from the audio where they speak alone.
// 3. voice prints grouped (agglomerative, centroid linkage, cosine); small groups join the nearest large one.
// 4. each frame takes as many speakers as the windows say are speaking, by the strongest groups.
export const FR = 10 / 589; // seconds per segmentation frame
const POW = [[], [0], [1], [2], [0, 1], [0, 2], [1, 2]];
export async function diarize(f, M, o = {}) { return assign(await analyse(f, M, o), f.length, o); }
export async function analyse(f, M, o = {}) {
  const SR = 16000, W = 160000, step = Math.round((o.step || 2.5) * SR), minClean = o.minClean ?? 0.6;
  const starts = []; for (let s = 0; s + W <= f.length; s += step) starts.push(s);
  if (!starts.length || starts[starts.length - 1] + W < f.length) starts.push(Math.max(0, f.length - W));
  const wins = []; const embs = []; let tSeg = 0, tEmb = 0;
  for (const s of starts) {
    let chunk = f.subarray(s, s + W); if (chunk.length < W) { const p = new Float32Array(W); p.set(chunk); chunk = p; }
    let t = Date.now(); const { logits } = await M.seg(await M.sp(chunk)); tSeg += Date.now() - t;
    const nF = logits.dims[1], L = logits.data, act = [new Uint8Array(nF), new Uint8Array(nF), new Uint8Array(nF)];
    for (let i = 0; i < nF; i++) { let b = 0, bv = -1e9; for (let c = 0; c < 7; c++) if (L[i * 7 + c] > bv) { bv = L[i * 7 + c]; b = c; } for (const k of POW[b]) act[k][i] = 1; }
    const w = { s, nF, act, cl: [-1, -1, -1] }; wins.push(w);
    for (let k = 0; k < 3; k++) {
      let clean = [], any = 0;
      for (let i = 0; i < nF; i++) if (act[k][i]) { any++; if (act[0][i] + act[1][i] + act[2][i] === 1) clean.push(i); }
      let use = clean.length * FR >= minClean ? clean : null;
      if (!use) continue;
      const parts = []; let n = 0;
      for (const i of use) { const a = Math.floor(i * FR * SR), b = Math.min(chunk.length, Math.floor((i + 1) * FR * SR)); parts.push([a, b]); n += b - a; }
      const buf = new Float32Array(n); let p = 0; for (const [a, b] of parts) { buf.set(chunk.subarray(a, b), p); p += b - a; }
      t = Date.now(); const out = await M.emb(await M.fe(buf)); tEmb += Date.now() - t;
      const v = Float32Array.from(out.last_hidden_state.data); let nn = 0; for (const x of v) nn += x * x; nn = Math.sqrt(nn) || 1; for (let j = 0; j < v.length; j++) v[j] /= nn;
      embs.push({ v, w: wins.length - 1, k, dur: use.length * FR });
    }
  }
  return { wins, embs, tSeg, tEmb };
}
export function assign(A, nSamples, o = {}) {
  const SR = 16000, thr = o.thr ?? 0.6, { embs, tSeg, tEmb } = A, minSize = Math.max(o.minSize ?? 3, Math.round((o.minFrac || 0) * embs.length));
  const wins = A.wins.map(w => Object.assign({}, w, { cl: [-1, -1, -1] }));
  // clustering: centroid linkage on cosine distance, until the closest pair is farther than thr
  const D = embs.length ? embs[0].v.length : 0;
  let cl = embs.map((e, i) => ({ id: i, sum: Float32Array.from(e.v), n: 1, members: [i], alive: true }));
  const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let j = 0; j < D; j++) { d += a.sum[j] * b.sum[j]; na += a.sum[j] * a.sum[j]; nb += b.sum[j] * b.sum[j]; } return 1 - d / Math.sqrt(na * nb); };
  // a heap of pairs, lazily invalidated
  const heap = []; const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const ver = cl.map(() => 0);
  // with a known number of speakers: merge with no threshold, as far as the
  // last point where at least n groups are big enough to be a person
  let stopAt = Infinity;
  if (o.n) {
    const sz = embs.map(() => 1), par = embs.map((_, i) => i), find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    const c2 = embs.map(e => ({ sum: Float32Array.from(e.v), n: 1, alive: true })), h2 = [], v2 = c2.map(() => 0);
    const ms = minSize; let big = 0, step = 0, last = 0;
    const H = { heap: h2 }; const push2 = x => { h2.push(x); let i = h2.length - 1; while (i) { const p = (i - 1) >> 1; if (h2[p][0] <= h2[i][0]) break; [h2[p], h2[i]] = [h2[i], h2[p]]; i = p; } };
    const pop2 = () => { const top = h2[0], lst = h2.pop(); if (h2.length) { h2[0] = lst; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h2.length && h2[l][0] < h2[m][0]) m = l; if (r < h2.length && h2[r][0] < h2[m][0]) m = r; if (m === i) break; [h2[m], h2[i]] = [h2[i], h2[m]]; i = m; } } return top; };
    for (let i = 0; i < c2.length; i++) for (let j = i + 1; j < c2.length; j++) push2([cos(c2[i], c2[j]), i, j, 0, 0]);
    if (ms <= 1) big = c2.length;
    while (h2.length) { const [d, i, j, vi, vj] = pop2(); if (!c2[i].alive || !c2[j].alive || v2[i] !== vi || v2[j] !== vj) continue;
      const a = c2[i], b = c2[j]; const before = (a.n >= ms) + (b.n >= ms);
      for (let q = 0; q < D; q++) a.sum[q] += b.sum[q]; a.n += b.n; b.alive = false; v2[i]++; step++;
      big += (a.n >= ms) - before; if (big >= o.n) last = step;
      for (let k = 0; k < c2.length; k++) if (k !== i && c2[k].alive) { const dd = cos(a, c2[k]); push2(k < i ? [dd, k, i, v2[k], v2[i]] : [dd, i, k, v2[i], v2[k]]); } }
    stopAt = last;
  }
  const lim = o.n ? Infinity : thr; let steps = 0;
  for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const d = cos(cl[i], cl[j]); if (d < lim) push([d, i, j, 0, 0]); }
  while (heap.length) {
    const [d, i, j, vi, vj] = pop(); if (!cl[i].alive || !cl[j].alive || ver[i] !== vi || ver[j] !== vj) continue;
    if (d >= lim || steps >= stopAt) break; steps++;
    const a = cl[i], b = cl[j]; for (let q = 0; q < D; q++) a.sum[q] += b.sum[q]; a.n += b.n; a.members.push(...b.members); b.alive = false; ver[i]++;
    for (let k = 0; k < cl.length; k++) if (k !== i && cl[k].alive) { const dd = cos(a, cl[k]); if (dd < thr) push(k < i ? [dd, k, i, ver[k], ver[i]] : [dd, i, k, ver[i], ver[k]]); }
  }
  let groups = cl.filter(c => c.alive);
  const big = groups.filter(g => g.n >= minSize), small = groups.filter(g => g.n < minSize);
  const final = big.length ? big : groups;
  if (big.length) for (const s of small) { let best = null, bd = 9; for (const g of big) { const d = cos(s, g); if (d < bd) { bd = d; best = g; } } best.members.push(...s.members); for (let q = 0; q < D; q++) best.sum[q] += s.sum[q]; best.n += s.n; }
  // a number of speakers the writer knows: the closest groups join until it is reached
  if (o.n) while (final.length > o.n) { let bi = 0, bj = 1, bd = 9; for (let i = 0; i < final.length; i++) for (let j = i + 1; j < final.length; j++) { const d = cos(final[i], final[j]); if (d < bd) { bd = d; bi = i; bj = j; } }
    const a = final[bi], b = final[bj]; for (let q = 0; q < D; q++) a.sum[q] += b.sum[q]; a.n += b.n; a.members.push(...b.members); final.splice(bj, 1); }
  final.forEach((g, gi) => g.members.forEach(m => { const e = embs[m]; wins[e.w].cl[e.k] = gi; }));
  // local speakers without a voice print: the nearest group by the window's other speakers is unknown, so they stay out
  const total = Math.ceil(nSamples / SR / FR) + 1, K = final.length;
  const score = Array.from({ length: K }, () => new Float32Array(total)), cnt = new Float32Array(total), cov = new Float32Array(total);
  for (const w of wins) { const off = Math.round(w.s / SR / FR);
    for (let i = 0; i < w.nF; i++) { const g = off + i; if (g >= total) break; cov[g]++; cnt[g] += w.act[0][i] + w.act[1][i] + w.act[2][i];
      for (let k = 0; k < 3; k++) if (w.act[k][i] && w.cl[k] >= 0) score[w.cl[k]][g] += 1; } }
  const lab = Array.from({ length: K }, () => new Uint8Array(total));
  for (let g = 0; g < total; g++) { if (!cov[g]) continue; const c = Math.round(cnt[g] / cov[g]); if (!c) continue;
    const order = [...Array(K).keys()].filter(k => score[k][g] > 0).sort((a, b) => score[b][g] - score[a][g]).slice(0, c); for (const k of order) lab[k][g] = 1; }
  const segs = []; for (let k = 0; k < K; k++) { let st = -1; for (let g = 0; g <= total; g++) { const on = g < total && lab[k][g]; if (on && st < 0) st = g; if (!on && st >= 0) { if ((g - st) * FR >= 0.1) segs.push({ start: st * FR, end: g * FR, spk: k }); st = -1; } } }
  segs.sort((a, b) => a.start - b.start);
  return { segs, nspk: K, nEmb: embs.length, tSeg, tEmb };
}
