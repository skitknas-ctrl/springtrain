// Spring Train: 20 banor där VARJE bana har sin egen form sedd uppifrån (Dick 2026-11-18).
// Formerna ritas som hörnpolygoner med rundade hörn eller som kurvor, skalas tills förarens tid träffar målet,
// och får backar med krön strax FÖRE de skarpaste kurvorna (utför ner i svängen).
//   node st_gen2.js --shapes   bara formerna (st_shapes.json) för en översiktsbild
//   node st_gen2.js            skalar + provkör, skriver st_levels.json
const path = require('path');
const fs = require('fs');
const ROOT = 'P:/Appar/SpringTrain';
const sim = require(path.join(ROOT, 'web/js/sim.js'));
const cfg = require(path.join(ROOT, 'web/js/defaults.js'));
cfg.view = { meters: 150 };
const base = cfg.trains[0];
const r1 = v => Math.round(v * 10) / 10;
const TAU = 2 * Math.PI;

// ---- formverktyg ---------------------------------------------------------
// Polygon med rundade hörn. Hörn = [x, y] eller [x, y, radie]. Ger styrpunkter: tangentpunkt, bågpunkter, tangentpunkt
// och en punkt mitt på varje längre raksträcka (håller rakorna raka i Catmull-Rom).
function rp(V, rDef) {
  const n = V.length, out = [];
  for (let i = 0; i < n; i++) {
    const A = V[(i - 1 + n) % n], B = V[i], C = V[(i + 1) % n];
    const ax = A[0] - B[0], ay = A[1] - B[1], cx = C[0] - B[0], cy = C[1] - B[1];
    const la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy);
    const ua = [ax / la, ay / la], uc = [cx / lc, cy / lc];
    const ang = Math.acos(Math.max(-1, Math.min(1, ua[0] * uc[0] + ua[1] * uc[1])));   // inre vinkel
    let r = B[2] || rDef;
    let d = r / Math.tan(ang / 2);
    const dMax = 0.46 * Math.min(la, lc);
    if (d > dMax) { d = dMax; r = d * Math.tan(ang / 2); }
    const T1 = [B[0] + ua[0] * d, B[1] + ua[1] * d], T2 = [B[0] + uc[0] * d, B[1] + uc[1] * d];
    const bx = ua[0] + uc[0], by = ua[1] + uc[1], bl = Math.hypot(bx, by) || 1;
    const cd = r / Math.sin(ang / 2), O = [B[0] + bx / bl * cd, B[1] + by / bl * cd];
    let a1 = Math.atan2(T1[1] - O[1], T1[0] - O[0]), a2 = Math.atan2(T2[1] - O[1], T2[0] - O[0]);
    let da = a2 - a1; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    const k = Math.abs(da) > 2.0 ? 4 : (Math.abs(da) > 1.0 ? 3 : 2);
    // raksträckans mittpunkt före hörnet
    const prevLen = la - d;
    if (prevLen > 2.2 * d) out.push([B[0] + ua[0] * (d + (la - 2 * d) * 0.5), B[1] + ua[1] * (d + (la - 2 * d) * 0.5)]);
    for (let j = 0; j <= k; j++) { const a = a1 + da * j / k; out.push([O[0] + r * Math.cos(a), O[1] + r * Math.sin(a)]); }
  }
  return out;
}
const polar = (n, f) => { const o = []; for (let i = 0; i < n; i++) { const t = TAU * i / n, r = f(t); o.push([r * Math.cos(t), r * Math.sin(t)]); } return o; };
const param = (n, f, t0) => { const o = []; for (let i = 0; i < n; i++) o.push(f(TAU * (i + (t0 || 0)) / n)); return o; };
const rot = (P, a) => P.map(p => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)]);
const mirror = P => P.map(p => [-p[0], p[1]]).reverse();

// Asymmetrisk oval (löparbana) i meter – bana 1, skalas inte.
function oval(D, rR, rL) {
  const nx = (rL - rR) / (2 * D), ny = Math.sqrt(Math.max(0, 1 - nx * nx));
  const cR = [D, 0], cL = [-D, 0], aU = Math.atan2(ny, nx), aL = Math.atan2(-ny, nx);
  const P = (c, r, a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  const pts = [], KA = 9, KS = 4;
  for (let i = 0; i <= KA; i++) pts.push(P(cR, rR, aL + (aU - aL) * (i / KA)));
  const tR = P(cR, rR, aU), tL = P(cL, rL, aU);
  for (let i = 1; i < KS; i++) pts.push([tR[0] + (tL[0] - tR[0]) * i / KS, tR[1] + (tL[1] - tR[1]) * i / KS]);
  for (let i = 0; i <= KA; i++) pts.push(P(cL, rL, aU + (aL + TAU - aU) * (i / KA)));
  const bL = P(cL, rL, aL), bR = P(cR, rR, aL);
  for (let i = 1; i < KS; i++) pts.push([bL[0] + (bR[0] - bL[0]) * i / KS, bL[1] + (bR[1] - bL[1]) * i / KS]);
  return pts;
}

// ---- de 20 formerna (enhetslösa, ungefär ±120; skalas sedan) --------------
const SHAPES = [
  { name: 'Warmup Oval', fixed: true, pts: oval(52, 33, 28) },
  { name: 'Kidney Bend', soft: 3, pts: param(14, t => [100 * Math.cos(t), 48 * Math.sin(t) + 26 * Math.cos(2 * t)]) },
  { name: 'Three Corners', pts: rp([[-95, -55], [95, -55], [-10, 85]], 30) },
  { name: 'The Elbow', pts: rp([[-80, -75], [85, -75], [85, -15], [-20, -15], [-20, 80], [-80, 80]], 25) },
  { name: 'Peanut', pts: rot(polar(16, t => 68 * (1 + 0.46 * Math.cos(2 * t))), 0.35) },
  { name: 'Figure Eight', cross: 'tunnel', pts: param(16, t => [85 * Math.cos(t), 40 * Math.sin(2 * t)], 0.5) },
  { name: 'Horseshoe', pts: rp([[-95, 85], [-95, -75, 50], [95, -75, 50], [95, 85], [40, 85], [40, -18, 24], [-40, -18, 24], [-40, 85]], 24) },
  { name: 'Tee Junction', pts: rp([[-105, 85], [-105, 30], [-30, 30], [-30, -85], [30, -85], [30, 30], [105, 30], [105, 85]], 24) },
  { name: 'Clover Run', pts: rot(polar(18, t => 70 * (1 + 0.42 * Math.cos(3 * t))), Math.PI / 2) },
  { name: 'Heartbreak Hill', soft: 4, pts: param(16, t => [6 * 16 * Math.pow(Math.sin(t), 3), 6 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) + 15], 0.5) },
  { name: 'Flyover Eight', cross: 'bridge', pts: rot(param(18, t => { const f = 0.86 - 0.3 * Math.cos(t); return [85 * f * Math.cos(t), 42 * f * Math.sin(2 * t)]; }, 0.5), Math.PI / 2) },
  { name: 'Twin Peaks', soft: 2, pts: (() => { const o = []; for (let i = 0; i <= 12; i++) { const x = -96 + 16 * i; o.push([x, 28 + 34 * Math.sin((x + 96) / 192 * TAU * 1.5)]); } return o.concat([[122, 30], [124, -30], [100, -68], [50, -80], [0, -82], [-50, -80], [-100, -68], [-124, -30], [-122, 0]]).reverse(); })() },
  { name: 'Crossroads', pts: rp([[30, 105], [30, 30], [105, 30], [105, -30], [30, -30], [30, -105], [-30, -105], [-30, -30], [-105, -30], [-105, 30], [-30, 30], [-30, 105]].reverse(), 24) },
  { name: 'Starfish', pts: rot(polar(25, t => 76 * (1 + 0.34 * Math.cos(5 * t))), Math.PI / 2) },
  { name: 'Bow Tie', pts: rp([[-100, 75], [-100, -75], [0, -22, 40], [100, -75], [100, 75], [0, 22, 40]], 26) },
  { name: 'Tunnel Loop', cross: 'tunnel', pts: param(22, t => { const r = 42 + 86 * Math.cos(t); return [r * Math.cos(t) - 50, r * Math.sin(t)]; }, 0.5) },
  { name: 'The Trident', pts: rp([[-105, 90], [105, 90], [105, 54], [-45, 54], [-45, 18], [80, 18], [80, -18], [-45, -18], [-45, -54], [105, -54], [105, -90], [-105, -90]].reverse(), 17) },
  { name: 'Alpine Circuit', pts: [[-120, -40], [-60, -72], [10, -58], [55, -82], [112, -60], [126, -8], [92, 22], [42, 4], [8, 30], [38, 66], [18, 92], [-42, 82], [-70, 40], [-108, 52], [-136, 10]] },
  { name: 'Thread the Needle', pts: rp([[-105, 90], [105, 90], [105, 48], [-28, -48, 15], [105, -48], [105, -90], [-105, -90], [-105, -48], [28, 48, 15], [-105, 48]].reverse(), 19) },
  { name: 'The Gauntlet', pts: [[-145, -55], [-85, -88], [-20, -68], [25, -92], [92, -86], [142, -58], [150, -8], [112, 14], [62, -18], [22, 4], [44, 42], [104, 50], [128, 84], [64, 98], [0, 72], [-30, 30], [-72, 48], [-64, 88], [-112, 96], [-150, 58], [-122, 18], [-152, -18]] },
];
// omväxlande körriktning: varannan bana spegelvänds så att kurvorna inte alltid går åt samma håll
SHAPES.forEach((sh, i) => { if (i > 0 && i % 2 === 0 && !sh.cross) sh.pts = mirror(sh.pts); });

// ---- styrpunkter i meter + höjdprofil -------------------------------------
function flat(pts, s) { return pts.map(p => [p[0] * s, p[1] * s, 0]); }

// Styrpunkternas lägen (m) längs spåret, sökta framåt i tur och ordning (så att en punkt nära en korsning inte
// hamnar på fel spår).
function arcPos(P, tr) {
  const out = []; let prev = 0;
  const win = Math.ceil(tr.N / P.length * 4) + 10;
  for (let i = 0; i < P.length; i++) {
    let b = prev, bd = Infinity;
    const from = i === 0 ? 0 : prev, to = i === 0 ? Math.min(tr.N, win) : Math.min(tr.N - 1, prev + win);
    for (let j = from; j <= to && j < tr.N; j++) { const d = (tr.x[j] - P[i][0]) ** 2 + (tr.y[j] - P[i][1]) ** 2; if (d < bd) { bd = d; b = j; } }
    if (i === 0) b = 0;
    out.push(b * tr.ds); prev = b;
  }
  return out;
}

// Lägger till styrpunkter där det är långt mellan två (så att backarnas form går fram), hämtade från själva kurvan.
function densify(P, maxGap) {
  const tr = sim.buildTrack(P, 1), out = [], sAt = arcPos(P, tr), o = {};
  for (let i = 0; i < P.length; i++) {
    out.push([P[i][0], P[i][1], 0]);
    let a = sAt[i], b = i + 1 < P.length ? sAt[i + 1] : tr.L;
    const gaps = Math.floor((b - a) / maxGap);
    for (let j = 1; j <= gaps; j++) { tr.at(a + (b - a) * j / (gaps + 1), o); out.push([o.x, o.y, 0]); }
  }
  return out;
}

// Höjdprofil: krön före de skarpaste kurvorna, och (för åttor) ett lyft så att spåren korsar varandra i olika plan.
function withHeights(P, opt) {
  const tr = sim.buildTrack(P, 1), L = tr.L, N = tr.N;
  const bumps = [];          // {c: mitt (m), hw: halv bredd (m), a: höjd (m)}
  if (opt.hills > 0 && opt.amp > 0) {
    const cand = [];
    for (let i = 0; i < N; i++) {
      const k = Math.abs(tr.k[i]);
      if (k > Math.abs(tr.k[(i - 1 + N) % N]) && k >= Math.abs(tr.k[(i + 1) % N]) && k > 0.004) cand.push({ s: i * tr.ds, k });
    }
    cand.sort((a, b) => b.k - a.k);
    const hw = Math.min(opt.amp * Math.PI / (2 * opt.grade), L / (2.2 * opt.hills)), amp = hw * 2 * opt.grade / Math.PI, picked = [];
    for (const c of cand) {
      if (picked.length >= opt.hills) break;
      if (picked.every(p => { const d = Math.abs(p.s - c.s); return Math.min(d, L - d) > 2.1 * hw; })) picked.push(c);
    }
    // krönet 0,7 halvbredder före kurvan: kurvan ligger långt ner i utförsbacken
    for (const c of picked) bumps.push({ c: c.s - (opt.lead === undefined ? 0.7 : opt.lead) * hw, hw, a: amp });
  }
  let lift = null;
  if (opt.cross && tr.crossings.length) {
    const c = tr.crossings[0], si = c.lo * tr.ds, sj = c.hi * tr.ds;
    const d = Math.abs(si - sj), dd = Math.min(d, L - d);
    lift = { c: sj, hw: Math.min(0.45 * L, 0.92 * dd, 150), a: 6.5 };
  }
  const bump = (s, b) => { let d = Math.abs(s - b.c) % L; d = Math.min(d, L - d); return d >= b.hw ? 0 : b.a * (0.5 + 0.5 * Math.cos(Math.PI * d / b.hw)); };
  const zOf = s => {
    let z = 0;
    for (const b of bumps) z = Math.max(z, bump(s, b));
    if (lift) z = bump(s, lift) + z * 0.45;
    return z;
  };
  const sAt = arcPos(P, tr);
  return P.map((p, i) => [r1(p[0]), r1(p[1]), r1(zOf(sAt[i]))]);
}

// Formen görs om till jämnt fördelade styrpunkter (samma antal oavsett skala), så att kurvan blir mjuk utan knyckar
// och backarnas form går fram även på raksträckorna.
function uniform(sh) {
  if (sh._u) return sh._u;
  const tr = sim.buildTrack(flat(sh.pts, 1), 1), n = Math.max(20, Math.min(64, Math.round(tr.L / (sh.gap || 15)))), o = {}, out = [];
  for (let i = 0; i < n; i++) { tr.at(tr.L * i / n, o); out.push([o.x, o.y]); }
  // mjuka upp spetsar: varje punkt dras mot grannarnas medel (soft = antal varv)
  let cur = out;
  for (let k = 0; k < (sh.soft === undefined ? 1 : sh.soft); k++) cur = cur.map((p, i) => { const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n]; return [0.25 * a[0] + 0.5 * p[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * p[1] + 0.25 * b[1]]; });
  sh._minR = sim.buildTrack(flat(cur, 1), 1).minRadius;
  return (sh._u = cur);
}
function build(sh, s, opt) {
  if (sh.fixed) return sh.pts.map(p => [r1(p[0]), r1(p[1]), 0]);
  return withHeights(flat(uniform(sh), s), opt);
}

// ---- provkörning ------------------------------------------------------------
function drive(points, laps, wagons, margin) {
  const track = sim.buildTrack(points, 1);
  const t = new sim.Train(cfg, track, base, { laps, wagons }, null);
  const dt = 1 / 50;
  while (!t.finished && t.derailed < 0 && t.time < 900) { const a = sim.autopilot(t, margin); t.step(dt, a.thr, a.brk); }
  return { track, time: t.time, ok: t.finished };
}
function gold(points, laps, wagons) { let m = 0.85, r; do { r = drive(points, laps, wagons, m); m -= 0.05; } while (!r.ok && m > 0.4); return r; }

function spec(i) {
  const laps = i <= 8 ? 3 : 2;
  const wagons = Math.min(6, 2 + Math.floor(i / 3));
  const target = i === 0 ? 90 : Math.round(105 + (i - 1) * (195 - 105) / 18);
  // backar: inga på bana 1–2, sedan fler, högre och brantare
  const hills = i < 2 ? 0 : Math.min(4, 1 + Math.floor((i - 2) / 4));
  const amp = i < 2 ? 0 : Math.min(7, 2 + (i - 2) * 0.3);
  const grade = Math.min(0.09, 0.045 + i * 0.0025);
  return { laps, wagons, target, hills, amp, grade };
}

if (process.argv.includes('--shapes')) {
  const o = SHAPES.map((sh, i) => { const P = build(sh, sh.fixed ? 1 : 1, Object.assign({ cross: sh.cross }, spec(i))); const tr = sim.buildTrack(P, 1); return { name: sh.name, x: Array.from(tr.x), y: Array.from(tr.y), z: Array.from(tr.z), pts: P, cross: tr.crossings.length, minR: tr.minRadius, L: tr.L }; });
  fs.writeFileSync(path.join(__dirname, 'st_shapes.json'), JSON.stringify(o));
  o.forEach((s, i) => console.log(i + 1, s.name.padEnd(18), 'L', Math.round(s.L), 'minR', Math.round(s.minR), 'kors', s.cross, 'pkt', s.pts.length));
  process.exit(0);
}

if (process.argv[2] === 'probe') {
  const i = +process.argv[3] - 1, sh = SHAPES[i], sp = spec(i);
  const opt = Object.assign({ cross: sh.cross }, sp);
  if (process.argv.includes('nohills')) { opt.hills = 0; }
  for (const sc of process.argv[4].split(',').map(Number)) {
    const pts = build(sh, sc, opt);
    for (const m of [0.8, 0.6]) {
      const track = sim.buildTrack(pts, 1);
      const t = new sim.Train(cfg, track, base, { laps: sp.laps, wagons: sp.wagons }, null);
      while (!t.finished && t.derailed < 0 && t.time < 900) { const a = sim.autopilot(t, m); t.step(1 / 50, a.thr, a.brk); }
      const s0 = ((t.cars[0].s % track.L) + track.L) % track.L, o = track.at(s0, {});
      console.log('skala', sc, 'marg', m, 'L', Math.round(track.L), 'minR', Math.round(track.minRadius), 'lut%', (track.maxGrade * 100).toFixed(1), 'kors', track.crossings.length,
        t.finished ? 'KLAR ' + t.time.toFixed(0) + ' s' : 'SPÅR vagn ' + t.derailed + ' vid s=' + Math.round(s0) + ' t=' + t.time.toFixed(0) + ' v=' + t.cars[0].v.toFixed(1) + ' R=' + (1 / Math.abs(o.k)).toFixed(0) + ' lut=' + (o.g * 100).toFixed(1));
    }
  }
  process.exit(0);
}
const args = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const from = args[0] || 1, to = args[1] || args[0] || 20;
const out = [];
for (let i = from - 1; i < to; i++) {
  const sh = SHAPES[i], sp = spec(i), opt = Object.assign({ cross: sh.cross }, sp);
  let s = 1, laps = sp.laps, pts = build(sh, 1, opt);
  if (!sh.fixed) {
    uniform(sh);
    // minsta skala: snävaste kurvan ska ha minst rMin meters radie (snävare på senare banor)
    const rMin = Math.max(13, 19 - i * 0.3);
    const sMin = Math.max(0.75, rMin / sh._minR);
    // flest varv (högst sp.laps) som ryms i måltiden på minsta skalan
    let tMin;
    for (laps = sp.laps; laps >= 1; laps--) { tMin = gold(build(sh, sMin, opt), laps, sp.wagons); if (tMin.ok && tMin.time <= sp.target * 1.3) break; }
    if (laps < 1) laps = 1;
    let lo = sMin, hi = Math.max(sMin * 1.05, 5);
    s = sMin; pts = build(sh, s, opt);
    if (tMin.ok && tMin.time < sp.target) {
      for (let it = 0; it < 9; it++) {
        s = (lo + hi) / 2; pts = build(sh, s, opt);
        const r = gold(pts, laps, sp.wagons);
        if (r.ok && r.time <= sp.target) lo = s; else hi = s;
      }
      s = lo; pts = build(sh, s, opt);
    }
    // bygget kräver att banan går att köra klart med försiktig förare: sänk först backarna, förstora sedan
    let guard = 0;
    while (!drive(pts, laps, sp.wagons, 0.6).ok && guard++ < 30) { if (guard <= 5) opt.amp *= 0.8; else s *= 1.05; pts = build(sh, s, opt); }
  }
  const g = gold(pts, laps, sp.wagons), tr = g.track;
  const ok06 = drive(pts, laps, sp.wagons, 0.6).ok;
  const cr = tr.crossings;
  const o = { id: 'lvl' + String(i + 1).padStart(2, '0'), name: sh.name, laps, wagons: sp.wagons, reward: 200 + i * 120,
    par: [Math.ceil(g.time), Math.ceil(g.time * 1.14), Math.ceil(g.time * 1.32)], crossing: sh.cross || null, points: pts };
  out.push(o);
  console.log(o.id, sh.name.padEnd(18), 'skala', s.toFixed(2), 'varv', laps, 'vagn', sp.wagons, 'L', Math.round(tr.L), 'minR', Math.round(tr.minRadius),
    'lut%', (tr.maxGrade * 100).toFixed(1), 'maxZ', tr.maxZ.toFixed(1), 'guld', o.par[0], 'mål', sp.target, ok06 ? 'ok06' : 'EJ-OK06', g.ok ? '' : 'GULD-SPÅRAR',
    'kors', cr.length, cr.map(c => (c.sep ? 'plan-skilda' : 'SAMMA-PLAN') + ' dz' + c.dz.toFixed(1)).join(','), 'pkt', pts.length);
  fs.writeFileSync(path.join(__dirname, 'st_lv_' + o.id + '.json'), JSON.stringify(o));
}
