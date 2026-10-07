import json,collections,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.startswith('{')]
agg=collections.defaultdict(list)
for r in rows: agg[json.dumps(r['o'],sort_keys=True)].append(r)
for k,v in agg.items():
    tot=sum(r['min'] for r in v); w=lambda key: sum(r[key]*r['min'] for r in v)/tot
    print(k.ljust(44), 'DER %.1f'%w('der'), 'miss %.1f fa %.1f conf %.1f'%(w('miss'),w('fa'),w('conf')), 'para %.1f'%(w('para')), 'cut %.1f'%(w('paraCut')), 'spk', [r['hypSpk'] for r in v], [r['der'] for r in v])
