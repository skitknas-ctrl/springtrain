// Provkör varje bana med den inbyggda föraren (autopilot) och skriver ut banfakta och förslag på partider.
//   node tools/calibrate.js            tabell
//   node tools/calibrate.js --par      dessutom rader att klistra in som par i web/js/defaults.js
// Guld = förarens tid med starttåget utan uppgraderingar och 85 % av urspårningsgränsen.
const path = require('path');
const sim = require(path.join(__dirname, '..', 'web', 'js', 'sim.js'));
const cfg = require(path.join(__dirname, '..', 'web', 'js', 'defaults.js'));

function run(level, spec, up, margin) {
  const track = sim.buildTrack(level.points, 1);
  const t = new sim.Train(cfg, track, spec, level, up);
  const dt = 1 / 60;
  let maxV = 0, maxStretch = 0, lapTimes = [], lap = 0;
  while (!t.finished && t.derailed < 0 && t.time < 1500) {
    const a = sim.autopilot(t, margin);
    t.step(dt, a.thr, a.brk);
    maxV = Math.max(maxV, t.cars[0].v);
    for (let j = 0; j < t.cars.length - 1; j++) maxStretch = Math.max(maxStretch, Math.abs(t.stretch(j)));
    if (t.lap() > lap) { lap = t.lap(); lapTimes.push(t.time); }
  }
  return { track, time: t.time, ok: t.finished, derailed: t.derailed, maxV, maxStretch, lapTimes };
}

const base = cfg.trains[0];
console.log('bana            längd  minR  lutn%  maxZ | tid(85%)  maxfart  fjäder | tid(60%)  bästa tåg fullt uppgr.');
const pars = [];
for (const lv of cfg.levels) {
  let a, m = 0.85;
  do { a = run(lv, base, null, m); m -= 0.05; } while (!a.ok && m > 0.4);
  const b = run(lv, base, null, 0.6);
  const top = cfg.trains[cfg.trains.length - 1];
  const c = run(lv, top, { engine: cfg.economy.maxLevel, brake: cfg.economy.maxLevel }, 0.9);
  const f = (x, n = 1) => x.toFixed(n).padStart(6);
  console.log(lv.id.padEnd(14), f(a.track.L, 0), f(a.track.minRadius, 0), f(a.track.maxGrade * 100), f(a.track.maxZ),
    '|', a.ok ? f(a.time) : ' SPÅR' + a.derailed, f(a.maxV * 3.6, 0) + ' km/h', f(a.maxStretch, 2),
    '|', b.ok ? f(b.time) : ' SPÅR' + b.derailed, c.ok ? f(c.time) : ' SPÅR' + c.derailed);
  const gold = Math.ceil(a.time), silver = Math.ceil(a.time * 1.12), bronze = Math.ceil(a.time * 1.3);
  pars.push(`${lv.id}: par: [${gold}, ${silver}, ${bronze}]`);
}
if (process.argv.includes('--check')) {
  // används av bygget: varje bana ska gå att köra klart med starttåget och en försiktig förare
  let bad = 0;
  for (const lv of cfg.levels) {
    const r = run(lv, base, null, 0.6);
    if (!r.ok) { console.error('FEL: banan ' + lv.id + ' går inte att köra klart med starttåget'); bad++; }
  }
  process.exit(bad ? 1 : 0);
}
if (process.argv.includes('--par')) console.log('\n' + pars.join('\n'));
