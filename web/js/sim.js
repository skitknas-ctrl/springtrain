/* Spring Train – bana och tågfysik. Körs både i spelet (webbläsare/WebView) och i Node (tools/calibrate.js).
 *
 * Enheter: meter, sekunder, kg, newton. Konfigurationen (defaults.js / admin) anger ton, kN och kW.
 * Tåget rör sig i en dimension längs banan: varje fordon har ett läge s (meter längs spåret) och en fart v.
 * Fordonen är förbundna med fjädrar som både kan sträckas och tryckas ihop kring ett viloläge; teleskopet
 * ger hårda stopp i båda ändar.
 */
(function (root) {
  'use strict';

  /* ---------- Bana ---------- */

  // Sluten Catmull-Rom-kurva genom kontrollpunkterna [x, y, z], omsamplad i jämna steg längs spåret.
  function buildTrack(points, step) {
    step = step || 1;
    var n = points.length, fine = [], i, j;
    function P(k) { return points[((k % n) + n) % n]; }
    function cr(a, b, c, d, t) {
      var t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    }
    var SUB = 48;
    for (i = 0; i < n; i++) {
      var p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (j = 0; j < SUB; j++) {
        var t = j / SUB;
        fine.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t),
          cr(p0[2] || 0, p1[2] || 0, p2[2] || 0, p3[2] || 0, t)]);
      }
    }
    var m = fine.length, cum = [0];
    for (i = 0; i < m; i++) {
      var a = fine[i], b = fine[(i + 1) % m];
      cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    var L = cum[m], N = Math.max(8, Math.round(L / step)), ds = L / N;
    var x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
    var seg = 0;
    for (i = 0; i < N; i++) {
      var s = i * ds;
      while (seg < m - 1 && cum[seg + 1] < s) seg++;
      var f = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
      var q0 = fine[seg], q1 = fine[(seg + 1) % m];
      x[i] = q0[0] + (q1[0] - q0[0]) * f;
      y[i] = q0[1] + (q1[1] - q0[1]) * f;
      z[i] = Math.max(0, q0[2] + (q1[2] - q0[2]) * f);
    }
    // riktning, krökning (1/radie, med tecken) och lutning (dz/ds)
    var th = new Float64Array(N), kRaw = new Float64Array(N), k = new Float64Array(N), g = new Float64Array(N);
    var tx = new Float64Array(N), ty = new Float64Array(N);
    for (i = 0; i < N; i++) {
      var ip = (i + 1) % N, im = (i - 1 + N) % N;
      var dx = x[ip] - x[im], dy = y[ip] - y[im], d = Math.hypot(dx, dy) || 1;
      tx[i] = dx / d; ty[i] = dy / d;
      th[i] = Math.atan2(dy, dx);
      g[i] = (z[ip] - z[im]) / (2 * ds);
    }
    for (i = 0; i < N; i++) {
      var dth = th[(i + 1) % N] - th[(i - 1 + N) % N];
      while (dth > Math.PI) dth -= 2 * Math.PI;
      while (dth < -Math.PI) dth += 2 * Math.PI;
      kRaw[i] = dth / (2 * ds);
    }
    var W = Math.max(1, Math.round(3 / ds)); // glättning över ungefär ±3 m
    for (i = 0; i < N; i++) {
      var sum = 0;
      for (j = -W; j <= W; j++) sum += kRaw[(i + j + N) % N];
      k[i] = sum / (2 * W + 1);
    }
    var track = {
      L: L, N: N, ds: ds, x: x, y: y, z: z, tx: tx, ty: ty, k: k, g: g,
      // läget s (valfritt tal, även negativt) -> punkt, riktning, krökning, lutning
      at: function (s, out) {
        out = out || {};
        var u = ((s % L) + L) % L / ds, i0 = Math.floor(u) % N, i1 = (i0 + 1) % N, fr = u - Math.floor(u);
        out.x = x[i0] + (x[i1] - x[i0]) * fr;
        out.y = y[i0] + (y[i1] - y[i0]) * fr;
        out.z = z[i0] + (z[i1] - z[i0]) * fr;
        var ax = tx[i0] + (tx[i1] - tx[i0]) * fr, ay = ty[i0] + (ty[i1] - ty[i0]) * fr, al = Math.hypot(ax, ay) || 1;
        out.tx = ax / al; out.ty = ay / al;
        out.k = k[i0] + (k[i1] - k[i0]) * fr;
        out.g = g[i0] + (g[i1] - g[i0]) * fr;
        return out;
      }
    };
    var minR = Infinity, maxG = 0, maxZ = 0;
    for (i = 0; i < N; i++) {
      if (Math.abs(k[i]) > 1e-9) minR = Math.min(minR, 1 / Math.abs(k[i]));
      maxG = Math.max(maxG, Math.abs(g[i]));
      maxZ = Math.max(maxZ, z[i]);
    }
    track.minRadius = minR; track.maxGrade = maxG; track.maxZ = maxZ;
    return track;
  }

  /* ---------- Tåg ---------- */

  var LOCO_LEN = 9, WAGON_LEN = 6; // loket är 50 % längre än vagnarna

  /** Lokets värden med uppgraderingar inräknade. up = {engine: nivå, brake: nivå}. */
  function locoStats(cfg, spec, up) {
    var e = 1 + (cfg.economy.engineStep || 0) * ((up && up.engine) || 0);
    var b = 1 + (cfg.economy.brakeStep || 0) * ((up && up.brake) || 0);
    return { power: spec.power * 1000 * e, force: spec.force * 1000 * e, brake: spec.brake * 1000 * b, mass: spec.mass * 1000 };
  }

  function Train(cfg, track, spec, level, up) {
    var ph = cfg.physics, st = locoStats(cfg, spec, up), i;
    this.cfg = cfg; this.ph = ph; this.track = track; this.stats = st;
    this.laps = level.laps || 5;
    this.cars = [{ s: 0, v: 0, m: st.mass, len: LOCO_LEN, load: 0, over: 0 }];
    var wm = (level.wagonMass || ph.wagonMass) * 1000;
    for (i = 0; i < level.wagons; i++) this.cars.push({ s: 0, v: 0, m: wm, len: WAGON_LEN, load: 0, over: 0 });
    for (i = 1; i < this.cars.length; i++) {
      this.cars[i].s = this.cars[i - 1].s - this.restDist(i - 1);
    }
    this.mass = 0;
    for (i = 0; i < this.cars.length; i++) this.mass += this.cars[i].m;
    this.time = 0;          // körtid (s)
    this.derailed = -1;     // index för fordonet som spårade ur, annars -1
    this.finished = false;
    this.maxLoad = 0;       // högsta kurvbelastning just nu (1 = gränsen)
    this.clunk = 0;         // styrkan i senaste smällen mot teleskopets stopp (ljud), nollas av spelet
    this._p = {};
  }

  // Avståndet mellan två fordons mittpunkter när fjädern vilar.
  Train.prototype.restDist = function (j) {
    return this.cars[j].len / 2 + this.ph.springRest + this.cars[j + 1].len / 2;
  };
  /** Fjäderns utsträckning i koppling j (meter, + = utdragen, − = hoptryckt). */
  Train.prototype.stretch = function (j) {
    return this.cars[j].s - this.cars[j + 1].s - this.restDist(j);
  };
  Train.prototype.lap = function () { return Math.max(0, Math.floor(this.cars[0].s / this.track.L)); };

  Train.prototype.step = function (dt, thr, brk) {
    if (this.derailed >= 0 || this.finished) return;
    var n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (var i = 0; i < n && this.derailed < 0 && !this.finished; i++) this._sub(h, thr, brk);
  };

  Train.prototype._sub = function (h, thr, brk) {
    var ph = this.ph, cars = this.cars, st = this.stats, tr = this.track, G = ph.gravity, p = this._p, i, c;
    var k = ph.springK * 1000, damp = ph.springDamp * 1000;
    var f = [];
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      tr.at(c.s, p);
      c.grade = p.g;
      c.kappa = p.k;
      f[i] = -c.m * G * p.g - ph.drag * c.v * Math.abs(c.v);
    }
    // loket: dragkraft (effekt/fart, begränsad av största dragkraft)
    var v0 = cars[0].v;
    f[0] += thr * Math.min(st.force, st.power / Math.max(Math.abs(v0), 0.5));
    // fjädrar
    for (i = 0; i < cars.length - 1; i++) {
      var x = this.stretch(i), F = k * x + damp * (cars[i].v - cars[i + 1].v);
      f[i] -= F; f[i + 1] += F;
    }
    // friktion (rullmotstånd på alla, broms bara på loket): motverkar rörelsen och kan hålla fordonet stilla
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      var fr = ph.rolling * c.m * G + (i === 0 ? brk * st.brake : 0);
      var vNew = c.v + f[i] / c.m * h;
      if (c.v === 0 && Math.abs(f[i]) <= fr) vNew = 0;
      else {
        var dv = fr / c.m * h, sgn = c.v !== 0 ? Math.sign(c.v) : Math.sign(f[i]);
        vNew -= sgn * dv;
        if (c.v !== 0 && Math.sign(vNew) !== Math.sign(c.v) && Math.abs(vNew) <= dv) vNew = 0; // stannade
        else if (c.v === 0 && Math.sign(vNew) !== sgn) vNew = 0;
      }
      c.v = vNew;
    }
    for (i = 0; i < cars.length; i++) cars[i].s += cars[i].v * h;
    // teleskopets hårda stopp
    var lim = ph.springTravel, e = ph.stopBounce;
    for (i = 0; i < cars.length - 1; i++) {
      var a = cars[i], b = cars[i + 1], xs = this.stretch(i);
      if (xs > lim || xs < -lim) {
        var rel = a.v - b.v, over = xs > lim ? xs - lim : xs + lim;
        var ma = a.m, mb = b.m, tot = ma + mb;
        a.s -= over * mb / tot; b.s += over * ma / tot;
        if ((xs > lim && rel > 0) || (xs < -lim && rel < 0)) {
          var vc = (ma * a.v + mb * b.v) / tot;
          a.v = vc - e * (a.v - vc); b.v = vc - e * (b.v - vc);
          this.clunk = Math.max(this.clunk, Math.abs(rel));
        }
      }
    }
    // urspårning: sidkraften v²/R över gränsen längre än en kort stund
    var ml = 0;
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      c.load = c.v * c.v * Math.abs(c.kappa) / ph.derailG;
      if (c.load > 1) { c.over += h; if (c.over > ph.derailGrace && this.derailed < 0) this.derailed = i; }
      else c.over = Math.max(0, c.over - h * 2);
      if (c.load > ml) ml = c.load;
    }
    this.maxLoad = ml;
    this.time += h;
    if (cars[0].s >= this.laps * tr.L) this.finished = true;
  };

  /** Enkel förare: gasar tills farten närmar sig vad kommande kurvor tål, bromsar annars.
   *  margin = andel av urspårningsgränsen som utnyttjas (0–1). Används för demo och kalibrering av partider. */
  function autopilot(train, margin) {
    var ph = train.ph, tr = train.track, cars = train.cars, p = train._p;
    var v = cars[0].v, s0 = cars[0].s;
    var aB = 0.75 * train.stats.brake / train.mass;
    var tail = s0 - cars[cars.length - 1].s + 6;
    var target = Infinity;
    for (var d = -tail; d < 260; d += 2) {
      tr.at(s0 + d, p);
      var kk = Math.abs(p.k);
      if (kk < 1e-5) continue;
      var va2 = margin * ph.derailG / kk;
      // vagnarna hinner ikapp loket när det bromsar: räkna med lite kortare sträcka
      var dist = Math.max(0, d - 4 - v * 0.35);
      var lim = Math.sqrt(va2 + 2 * aB * dist);
      if (lim < target) target = lim;
    }
    if (v > target) return { thr: 0, brk: Math.min(1, (v - target) * 0.9 + 0.25) };
    if (v > target - 0.6) return { thr: 0, brk: 0 };
    return { thr: 1, brk: 0 };
  }

  /** Djup sammanslagning: objekt slås ihop nyckel för nyckel, allt annat (tal, text, listor) ersätts. */
  function merge(base, over) {
    if (over === undefined || over === null) return base;
    if (typeof base !== 'object' || base === null || Array.isArray(base) ||
        typeof over !== 'object' || Array.isArray(over)) return over;
    var out = {}, key;
    for (key in base) out[key] = base[key];
    for (key in over) out[key] = merge(base[key], over[key]);
    return out;
  }

  var api = { buildTrack: buildTrack, Train: Train, autopilot: autopilot, locoStats: locoStats, merge: merge,
    LOCO_LEN: LOCO_LEN, WAGON_LEN: WAGON_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ST_SIM = api;
})(this);
