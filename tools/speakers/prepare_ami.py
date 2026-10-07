"""Fetch two shards of the AMI meeting corpus (single distant microphone,
CC BY 4.0, from huggingface.co/datasets/diarizers-community/ami) and write
each meeting as a WAV file with its reference speaker turns.

usage: python3 prepare_ami.py WORKDIR
   then, in WORKDIR/js: npm i @huggingface/transformers@3.8.1, copy diar.mjs,
   eval.mjs, segs.cjs and agg.py there, and run
   node eval.mjs val  '[{"thr":0.3,"minFrac":0.02}]'
   node eval.mjs test '[{"thr":0.3,"minFrac":0.02}]' > test.log; python3 agg.py test.log
"""
import io, json, os, subprocess, sys, wave
import pyarrow.parquet as pq

W = sys.argv[1]
os.makedirs(os.path.join(W, 'data'), exist_ok=True)
os.makedirs(os.path.join(W, 'clips'), exist_ok=True)
SHARDS = [('val', 'sdm/validation-00000-of-00003'), ('test', 'sdm/test-00000-of-00003')]
man = []
for split, sh in SHARDS:
    f = os.path.join(W, 'data', os.path.basename(sh) + '.parquet')
    if not os.path.exists(f):
        subprocess.check_call(['curl', '-sSL', '-o', f, 'https://huggingface.co/datasets/diarizers-community/ami/resolve/main/' + sh + '.parquet'])
    t = pq.ParquetFile(f)
    for g in range(t.num_row_groups):
        for i, r in enumerate(t.read_row_group(g).to_pylist()):
            b = r['audio']['bytes']; name = '%s_%d_%d' % (split, g, i)
            open(os.path.join(W, 'clips', name + '.wav'), 'wb').write(b)
            w = wave.open(io.BytesIO(b))
            man.append({'name': name, 'split': split, 'file': 'clips/' + name + '.wav', 'dur': w.getnframes() / w.getframerate(),
                        'path': r['audio']['path'], 'nspk': len(set(r['speakers'])),
                        'segs': list(zip(r['timestamps_start'], r['timestamps_end'], r['speakers']))})
json.dump(man, open(os.path.join(W, 'manifest.json'), 'w'))
print(len(man), 'meetings')
