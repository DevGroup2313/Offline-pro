// GECToR base (the app's grammar model) with the app's settings and the app's safety filter
import { AutoTokenizer, env } from '@huggingface/transformers';
import ort from 'onnxruntime-node'; import fs from 'fs'; import { createRequire } from 'module';
const req = createRequire(import.meta.url); const G = req('./gector_core.js'); const F = req('./gec_filter.js');
env.localModelPath = '/tmp/claude-0/-home-user/fd852a08-466f-59e0-bd9a-5267adb02128/scratchpad/gec/models/'; env.allowRemoteModels = false;
const M = 'Meyssa/gector-base-2020', dir = env.localModelPath + M;
const tok = await AutoTokenizer.from_pretrained(M);
const id2 = JSON.parse(fs.readFileSync(dir + '/config.json')).id2label; const labels = []; for (const k in id2) labels[+k] = id2[k];
const verbs = G.verbForms(fs.readFileSync('verb-form-vocab.txt', 'utf8'));
const sess = await ort.InferenceSession.create(dir + '/onnx/model_quantized.onnx', { intraOpNumThreads: 1, interOpNumThreads: 1 });
const infer = async ids => { const t = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const m = new ort.Tensor('int64', BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]); return (await sess.run({ input_ids: t, attention_mask: m })).logits.data; };
const TUNING = JSON.parse(process.env.TUNING || '{"keepBias":0.5,"minErrorProb":0.7,"minProb":0.8}');
const cfg = Object.assign({ encodeWord: w => tok.encode(' ' + w, { add_special_tokens: false }), infer, labels, verbs, START_ID: 50265, prefixIds: [0], suffixIds: [2], iterations: 3 }, TUNING);
const tag = process.env.TAG || 'gector';
for (const set of process.argv.slice(2)) {
  const rows = JSON.parse(fs.readFileSync(set + '.json')); const out = [], raw = []; const t0 = Date.now();
  for (const r of rows) { const o = G.join(await G.correct(G.split(r.text), cfg)); raw.push(o); out.push(F.filter(r.text, o, verbs).text); }
  fs.writeFileSync(`hyp_${tag}_${set}.json`, JSON.stringify(out)); fs.writeFileSync(`hyp_${tag}raw_${set}.json`, JSON.stringify(raw));
  console.log(set, Math.round((Date.now() - t0) / rows.length), 'ms per sentence');
}
