# Läser st_levels.json och skriver (a) levels-blocket i web/js/defaults.js + gr8eam.com/springtrain/defaults.js,
# (b) hela serverns config-JSON (st_config.json). Sätter även view.meters = 150.
import json, re, sys

SP = r'C:\Users\dick\AppData\Local\Temp\claude\4fd78c189b132ce5\ed7cc222-037d-444d-a39e-a6a65cce1de5\scratchpad'
levels = json.load(open(SP + r'\st_levels.json', encoding='utf-8'))
clean = []
for lv in levels:
    o = {'id': lv['id'], 'name': lv['name'], 'laps': lv['laps'], 'wagons': lv['wagons'],
         'reward': lv['reward'], 'par': lv['par']}
    if lv.get('crossing'):
        o['crossing'] = lv['crossing']
    o['points'] = [[round(p[0], 1), round(p[1], 1), round(p[2], 1)] for p in lv['points']]
    clean.append(o)


def num(v):
    f = float(v)
    return str(int(f)) if f == int(f) else ('%g' % f)


def pts_js(points):
    return '[' + ', '.join('[' + ', '.join(num(c) for c in p) + ']' for p in points) + ']'


def level_js(o):
    head = "      { id: '%s', name: '%s', laps: %d, wagons: %d, reward: %d, par: [%s]%s,\n" % (
        o['id'], o['name'], o['laps'], o['wagons'], o['reward'], ', '.join(str(x) for x in o['par']),
        (", crossing: '%s'" % o['crossing']) if o.get('crossing') else '')
    return head + "        points: " + pts_js(o['points']) + " }"


levels_block = "levels: [\n" + ",\n".join(level_js(o) for o in clean) + "\n    ]"

# ---- patcha defaults.js (två kopior) ----
for path in [r'P:\Appar\SpringTrain\web\js\defaults.js', r'C:\Users\dick\kod\gr8eam.com\springtrain\defaults.js']:
    s = open(path, encoding='utf-8', newline='').read()
    s2 = re.sub(r'levels: \[[\s\S]*?\n    \]', levels_block, s, count=1)
    assert s2 != s and s2.count("id: 'lvl01'") == 1, path
    s2 = s2.replace('meters: 120', 'meters: 150')
    open(path, 'w', encoding='utf-8', newline='').write(s2)
    print('patchade', path)

# ---- hela serverns config (defaults + nya banor + view 150) ----
cfg = json.load(open(SP + r'\st_server_config.json', encoding='utf-8'))
cfg['view'] = {'meters': 150}
cfg['levels'] = clean
json.dump(cfg, open(SP + r'\st_config.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('skrev st_config.json  (banor:', len(clean), ')')
