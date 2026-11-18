const fs = require('fs'), path = require('path');
const sim = require('P:/Appar/SpringTrain/web/js/sim.js');
const out = [], sheet = [];
for (let i = 1; i <= 20; i++) {
  const o = JSON.parse(fs.readFileSync(path.join(__dirname, 'st_lv_lvl' + String(i).padStart(2, '0') + '.json'), 'utf8'));
  out.push(o);
  const tr = sim.buildTrack(o.points, 1);
  sheet.push({ name: o.name + '  ' + Math.round(tr.L) + ' m x' + o.laps, x: Array.from(tr.x), y: Array.from(tr.y), z: Array.from(tr.z) });
}
fs.writeFileSync(path.join(__dirname, 'st_levels.json'), JSON.stringify(out));
fs.writeFileSync(path.join(__dirname, 'st_final.json'), JSON.stringify(sheet));
console.log(out.length, 'banor');
