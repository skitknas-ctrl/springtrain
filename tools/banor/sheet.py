# Ritar en översiktsbild (uppifrån) av banorna: python st_sheet.py <in.json> <ut.png>
# in = st_shapes.json (x/y-listor) eller st_levels.json (points; ritas då som styrpunkter med räta linjer emellan).
import json, sys
from PIL import Image, ImageDraw

d = json.load(open(sys.argv[1], encoding='utf-8'))
C, R = 5, (len(d) + 4) // 5
W = 300
img = Image.new('RGB', (C * W, R * W), '#2f6b3a')
g = ImageDraw.Draw(img)
for i, lv in enumerate(d):
    if 'x' in lv:
        xs, ys, zs = lv['x'], lv['y'], lv['z']
    else:
        xs = [p[0] for p in lv['points']]; ys = [p[1] for p in lv['points']]; zs = [p[2] for p in lv['points']]
    ox, oy = (i % C) * W, (i // C) * W
    mnx, mxx, mny, mxy = min(xs), max(xs), min(ys), max(ys)
    k = (W - 50) / max(mxx - mnx, mxy - mny, 1)
    cx, cy = (mnx + mxx) / 2, (mny + mxy) / 2
    P = [(ox + W / 2 + (x - cx) * k, oy + W / 2 + 8 - (y - cy) * k) for x, y in zip(xs, ys)]
    zmax = max(max(zs), 0.1)
    n = len(P)
    for j in range(n):
        z = zs[j] / zmax if max(zs) > 0.2 else 0
        col = (int(60 + 195 * z), int(50 + 60 * (1 - z)), int(40))
        g.line([P[j], P[(j + 1) % n]], fill=col if max(zs) > 0.2 else (230, 230, 230), width=4)
    if 'pts' in lv:
        for p in lv['pts']:
            q = (ox + W / 2 + (p[0] - cx) * k, oy + W / 2 + 8 - (p[1] - cy) * k)
            g.ellipse([q[0] - 2, q[1] - 2, q[0] + 2, q[1] + 2], fill='#ffffff')
    g.rectangle([ox, oy, ox + W - 1, oy + W - 1], outline='#1d4526')
    g.text((ox + 6, oy + 4), '%d %s' % (i + 1, lv['name']), fill='#ffffff')
img.save(sys.argv[2])
print('skrev', sys.argv[2])
