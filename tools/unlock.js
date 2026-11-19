// Räknar fram upplåsningstider: tiden man måste klara en bana på för att nästa bana ska öppnas (Dick 2026-11-19).
// Tanken: tiden ska vara omöjlig med tåget man har när man kommer till banan första gången, men gå att nå när
// tåget uppgraderats ett steg.
//   node tools/unlock.js [antal banor] [config.json]     (config.json = svaret från api/config.php, annars defaults.js)
//
// "Bästa möjliga förare" = den inbyggda förarens princip (gasa tills kommande kurvor kräver broms), men med alla
// kombinationer av kurvmarginal och bromsförtroende provade; den snabbaste körningen som går i mål räknas.
// Det är ingen bevisad undre gräns, men föraren ser hela banan och reagerar på 1/60 s, så en människa slår den knappt.
const path = require('path');
const fs = require('fs');
const sim = require(path.join(__dirname, '..', 'web', 'js', 'sim.js'));
let cfg = require(path.join(__dirname, '..', 'web', 'js', 'defaults.js'));
const args = process.argv.slice(2);
const N = parseInt(args[0], 10) || 4;
if (args[1]) { const j = JSON.parse(fs.readFileSync(args[1], 'utf8')); cfg = sim.merge(cfg, j.config || j); }

function driver(train, margin, bf, p) {
  const ph = train.ph, tr = train.track, cars = train.cars;
  const v = cars[0].v, s0 = cars[0].s;
  const aB = bf * train.stats.brake / train.mass;
  const tail = s0 - cars[cars.length - 1].s + 6;
  let target = Infinity;
  for (let d = -tail; d < 400; d += 2) {
    tr.at(s0 + d, p);
    const kk = Math.abs(p.k);
    if (kk < 1e-5) continue;
    const lim = Math.sqrt(margin * ph.derailG / kk + 2 * aB * Math.max(0, d - 4 - v * 0.35));
    if (lim < target) target = lim;
  }
  if (v > target) return [0, Math.min(1, (v - target) * 0.9 + 0.25)];
  if (v > target - 0.3) return [0, 0];
  return [1, 0];
}
const tracks = {};
function run(level, spec, up, margin, bf) {
  const track = tracks[level.id] || (tracks[level.id] = sim.buildTrack(level.points, 1));
  const t = new sim.Train(cfg, track, spec, level, up);
  const p = {};
  while (!t.finished && t.derailed < 0 && t.time < 900) { const a = driver(t, margin, bf, p); t.step(1 / 60, a[0], a[1]); }
  return t.finished ? t.time : Infinity;
}
// snabbaste körningen som går i mål
function best(level, spec, up) {
  let b = Infinity, at = null;
  for (let m = 0.80; m <= 1.301; m += 0.025) for (let bf = 0.6; bf <= 1.101; bf += 0.1) {
    const x = run(level, spec, up, m, bf);
    if (x < b) { b = x; at = [m, bf]; }
  }
  return { t: b, at };
}
// en duktig människa: 85 % av kurvgränsen och försiktig bromsning
const human = (level, spec, up) => { let m = 0.85, x; do { x = run(level, spec, up, m, 0.75); m -= 0.05; } while (x === Infinity && m > 0.4); return x; };

const e = cfg.economy, base = cfg.trains[0];
const cost = lvl => Math.round(e.upgradeBase * Math.pow(e.upgradeGrowth, lvl));
const f = x => (x === Infinity ? '  spår' : x.toFixed(1).padStart(6));
const ups = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1], [2, 2], [3, 2], [3, 3]];
console.log('Starttåg: ' + base.name + ', motor +' + e.engineStep * 100 + ' % och broms +' + e.brakeStep * 100 + ' % per nivå, första uppgraderingen kostar ' + cost(0) + ', nästa ' + cost(1) + ', ' + cost(2));
for (let i = 0; i < Math.min(N, cfg.levels.length); i++) {
  const lv = cfg.levels[i];
  console.log('\n' + (i + 1) + '. ' + lv.name + ' (' + lv.laps + ' varv, ' + lv.wagons + ' vagnar, belöning ' + lv.reward + ', stjärntider ' + lv.par.join('/') + ')');
  console.log('  motor broms |  bästa förare   duktig människa');
  const row = {};
  for (const [en, br] of ups) {
    const up = { engine: en, brake: br, spring: 0 };
    const b = best(lv, base, up), h = human(lv, base, up);
    row[en + '' + br] = { b: b.t, h };
    console.log('    ' + en + '     ' + br + '   | ' + f(b.t) + ' (m ' + b.at[0].toFixed(2) + ', b ' + b.at[1].toFixed(1) + ')   ' + f(h));
  }
}
