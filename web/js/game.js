/* Spring Train – spelet: inställningar från servern, sparning, menyer, reglage, ritning och ljud.
 * Fysiken ligger i sim.js, standardvärdena i defaults.js. Gränssnittet är på engelska, kommentarerna på svenska.
 */
(function () {
  'use strict';
  var SIM = window.ST_SIM, DEF = window.ST_DEFAULTS;
  var CONFIG_URL = 'https://gr8eam.com/springtrain/api/config.php';
  var SAVE_KEY = 'springtrain.save.v1', CFG_KEY = 'springtrain.config.v1';
  var APP = window.SpringTrainApp || null; // finns bara i Android-appen
  var Q = new URLSearchParams(location.search);
  function $(id) { return document.getElementById(id); }

  /* ---------- inställningar ---------- */

  var CFG = DEF;
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { } }

  function applyConfig(remote) {
    var c = SIM.merge(DEF, remote || {});
    // trasiga listor från servern får aldrig stoppa spelet
    if (!Array.isArray(c.trains) || !c.trains.length) c.trains = DEF.trains;
    if (!Array.isArray(c.levels) || !c.levels.length) c.levels = DEF.levels;
    c.levels = c.levels.filter(function (l) { return l && Array.isArray(l.points) && l.points.length >= 4; });
    if (!c.levels.length) c.levels = DEF.levels;
    CFG = c;
    trackCache = {};
  }

  function fetchConfig(done) {
    var finished = false, timer = setTimeout(function () { end(null); }, 2500);
    function end(data) {
      // ett sent svar sparas till nästa start; det tas bara i bruk direkt om spelaren står kvar på startskärmen
      if (data) { writeJson(CFG_KEY, data); if (finished && mode === 'menu' && $('sMenu').classList.contains('on')) { applyConfig(data); fixSave(); run = null; showMenu(); } }
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (data) applyConfig(data);
      done();
    }
    try {
      fetch(CONFIG_URL + '?v=' + encodeURIComponent(appVersion()), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { end(j && typeof j === 'object' && j.config ? j.config : null); })
        .catch(function () { end(null); });
    } catch (e) { end(null); }
  }
  function appVersion() { try { return APP && APP.appVersion ? APP.appVersion() : 'web'; } catch (e) { return 'web'; } }

  /* ---------- sparning ---------- */

  var save = readJson(SAVE_KEY) || { money: null, train: null, owned: {}, best: {}, stars: {}, sound: true };
  function fixSave() {
    if (typeof save.money !== 'number') save.money = CFG.economy.startMoney || 0;
    save.owned = save.owned || {}; save.best = save.best || {}; save.stars = save.stars || {};
    var first = CFG.trains[0];
    CFG.trains.forEach(function (t) { if (!(t.price > 0) && !save.owned[t.id]) save.owned[t.id] = { engine: 0, brake: 0 }; });
    if (!save.owned[first.id]) save.owned[first.id] = { engine: 0, brake: 0 };
    if (!save.train || !save.owned[save.train] || !trainSpec(save.train)) save.train = first.id;
  }
  function persist() { writeJson(SAVE_KEY, save); }
  function trainSpec(id) { for (var i = 0; i < CFG.trains.length; i++) if (CFG.trains[i].id === id) return CFG.trains[i]; return null; }
  function unlocked(i) { return i === 0 || CFG.unlockAll || save.best[CFG.levels[i - 1].id] !== undefined; }
  function upgradeCost(lvl) { return Math.round(CFG.economy.upgradeBase * Math.pow(CFG.economy.upgradeGrowth, lvl) / 10) * 10; }

  /* ---------- hjälp ---------- */

  function fmtTime(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function money(n) { return '<i class="coin"></i>' + Math.round(n).toLocaleString('en-US'); }
  function starsHtml(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < n ? '<i>★</i>' : '★'; return s; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  var shadeCache = {};
  function shade(hex, f) {
    var key = hex + f, c = shadeCache[key];
    if (c) return c;
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function ch(v) { return Math.max(0, Math.min(255, Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1)))); }
    return (shadeCache[key] = 'rgb(' + ch(r) + ',' + ch(g) + ',' + ch(b) + ')');
  }

  /* ---------- banor ---------- */

  var trackCache = {};
  function levelData(idx) {
    if (trackCache[idx]) return trackCache[idx];
    var lv = CFG.levels[idx], tr = SIM.buildTrack(lv.points, 1), i, N = tr.N;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, kMax = 0;
    for (i = 0; i < N; i++) {
      minX = Math.min(minX, tr.x[i]); maxX = Math.max(maxX, tr.x[i]);
      minY = Math.min(minY, tr.y[i]); maxY = Math.max(maxY, tr.y[i]);
      kMax = Math.max(kMax, Math.abs(tr.k[i]));
    }
    // ritordning för banken: längst bort först (kameran vrids aldrig, så ordningen är fast)
    var order = [];
    for (i = 0; i < N; i++) order.push(i);
    order.sort(function (a, b) { return tr.y[a] - tr.y[b]; });
    // träd, utplacerade med fast slump per bana och aldrig nära spåret
    var R = rng(1000 + idx * 77), trees = [], pad = 70, tries = Math.round((maxX - minX + 2 * pad) * (maxY - minY + 2 * pad) / 520);
    for (var t = 0; t < tries; t++) {
      var x = minX - pad + R() * (maxX - minX + 2 * pad), y = minY - pad + R() * (maxY - minY + 2 * pad), ok = true;
      for (i = 0; i < N; i += 3) { var dx = tr.x[i] - x, dy = tr.y[i] - y; if (dx * dx + dy * dy < 90) { ok = false; break; } }
      if (ok) trees.push({ x: x, y: y, r: 2 + R() * 1.8, h: 4 + R() * 3, c: R() < 0.3 ? '#2f7d3a' : (R() < 0.5 ? '#2a6e33' : '#3a8a40'), pine: R() < 0.35 });
    }
    trees.sort(function (a, b) { return a.y - b.y; });
    return (trackCache[idx] = { lv: lv, tr: tr, order: order, trees: trees, box: [minX, minY, maxX, maxY], kMax: kMax, mini: null });
  }

  // Liten karta över banan; snäva kurvor i orange och rött. Används på körskärmen och i banvalet.
  function drawMini(c, data, w, h, lineW) {
    var tr = data.tr, b = data.box, sc = Math.min((w - 8) / (b[2] - b[0]), (h - 8) / (b[3] - b[1]));
    var ox = w / 2 - (b[0] + b[2]) / 2 * sc, oy = h / 2 - (b[1] + b[3]) / 2 * sc, lim = CFG.physics.derailG;
    c.lineCap = 'round'; c.lineWidth = lineW;
    for (var i = 0; i < tr.N; i += 2) {
      var j = (i + 2) % tr.N, k = Math.abs(tr.k[i]), vs = k > 1e-6 ? Math.sqrt(lim / k) : 99;
      c.strokeStyle = vs < 16 ? '#ff5a3c' : vs < 21 ? '#ffb23c' : '#ffffff';
      c.beginPath(); c.moveTo(ox + tr.x[i] * sc, oy + tr.y[i] * sc); c.lineTo(ox + tr.x[j] * sc, oy + tr.y[j] * sc); c.stroke();
    }
    return { sc: sc, ox: ox, oy: oy };
  }

  /* ---------- körning ---------- */

  var mode = 'boot';   // boot, menu (demo i bakgrunden), play, pause, crash, done
  var run = null;      // pågående körning (även demon bakom menyerna)
  var thr = 0, brk = 0;

  function startRun(idx, demo) {
    var data = levelData(idx), spec = demo ? CFG.trains[0] : trainSpec(save.train);
    var up = demo ? null : save.owned[spec.id];
    var train = new SIM.Train(CFG, data.tr, spec, data.lv, up);
    var p = data.tr.at(0);
    run = { idx: idx, data: data, spec: spec, train: train, demo: demo, auto: demo || Q.get('auto') === '1',
      count: demo ? 0 : 3.2, cam: { x: p.x, y: p.y, z: p.z }, parts: [], wreck: null, crashT: 0, lap: 0, flash: null,
      shake: 0, doneT: 0, wagonCols: [] };
    var cols = ['#8b5a3c', '#3f6f9e', '#7d7f86', '#9a4b3f', '#5d7d49', '#a07a2c'];
    for (var i = 0; i < data.lv.wagons; i++) run.wagonCols.push(cols[i % cols.length]);
    if (!demo) {
      var mc = document.createElement('canvas'); mc.width = 260; mc.height = 170;
      var g = mc.getContext('2d'); g.fillStyle = 'rgba(16,21,31,.62)'; g.beginPath();
      if (g.roundRect) g.roundRect(0, 0, 260, 170, 22); else g.rect(0, 0, 260, 170);
      g.fill();
      run.miniMap = drawMini(g, data, 260, 170, 5); run.miniCanvas = mc;
      thr = brk = 0; setLever('L', 0); setLever('R', 0);
    }
  }

  function play(idx) {
    audioInit();
    startRun(idx, false);
    setMode('play');
    $('hLap').textContent = '1/' + run.train.laps;
  }

  function setMode(m) {
    mode = m;
    document.body.classList.toggle('play', m === 'play' || m === 'crash' || m === 'done' || m === 'pause');
    $('count').style.display = 'none';
  }
  function show(id) {
    ['sMenu', 'sLevels', 'sShop', 'sInfo', 'sPause', 'sResult'].forEach(function (s) { $(s).classList.toggle('on', s === id); });
    var ms = document.querySelectorAll('[data-money]');
    for (var i = 0; i < ms.length; i++) ms[i].innerHTML = money(save.money);
  }
  function showMenu() {
    if (!run || !run.demo) startRun(0, true);
    setMode('menu'); show('sMenu');
    $('menuMoney').innerHTML = money(save.money);
    $('msg').style.display = CFG.message ? 'block' : 'none';
    $('msg').textContent = CFG.message || '';
    $('bQuit').style.display = APP && APP.quit ? '' : 'none';
    $('sndBtn').textContent = 'Sound: ' + (save.sound ? 'on' : 'off');
    $('ver').textContent = appVersion() === 'web' ? '' : 'v' + appVersion();
    engineSound(0, 0, 0);
  }

  function showLevels() {
    var html = '';
    CFG.levels.forEach(function (lv, i) {
      var open = unlocked(i), best = save.best[lv.id];
      html += '<button class="lv' + (open ? '' : ' locked') + '" data-i="' + i + '"><canvas width="148" height="100"></canvas><span><b>' +
        (i + 1) + '. ' + esc(lv.name) + '</b><small>' + lv.wagons + ' wagons · ' + lv.laps + ' laps</small><small>Prize ' + money(lv.reward) + '</small>' +
        (open ? '<small><span class="stars">' + starsHtml(save.stars[lv.id] || 0) + '</span> ' + (best !== undefined ? fmtTime(best) : 'not driven yet') + '</small>'
          : '<small>Finish track ' + i + ' to unlock</small>') + '</span></button>';
    });
    $('levelList').innerHTML = html;
    var cs = $('levelList').querySelectorAll('canvas');
    for (var i = 0; i < cs.length; i++) drawMini(cs[i].getContext('2d'), levelData(i), 148, 100, 3.5);
    show('sLevels');
  }

  function showShop() {
    var e = CFG.economy, html = '', maxP = 0, maxB = 0;
    CFG.trains.forEach(function (t) {
      maxP = Math.max(maxP, t.power * (1 + e.engineStep * e.maxLevel));
      maxB = Math.max(maxB, t.brake * (1 + e.brakeStep * e.maxLevel));
    });
    CFG.trains.forEach(function (t) {
      var own = save.owned[t.id], sel = save.train === t.id;
      var el = own ? own.engine : 0, bl = own ? own.brake : 0;
      html += '<div class="train' + (sel ? ' sel' : '') + '"><div class="top"><span class="sw" style="background:' + esc(t.color) + '"></span><b>' + esc(t.name) +
        '</b><span style="color:var(--dim);font-size:13px">' + t.mass + ' t</span><span style="flex:1"></span>' +
        (own ? (sel ? '<span style="color:var(--gold);font-weight:800">In use</span>' : '<button class="btn small" data-act="use" data-id="' + t.id + '">Use this train</button>')
          : '<button class="btn gold" data-act="buy" data-id="' + t.id + '"' + (save.money < t.price ? ' disabled' : '') + '>Buy ' + money(t.price) + '</button>') + '</div>';
      [['Engine', 'engine', el, t.power * (1 + e.engineStep * el) / maxP, ''], ['Brakes', 'brake', bl, t.brake * (1 + e.brakeStep * bl) / maxB, 'b']].forEach(function (r) {
        var cost = upgradeCost(r[2]), full = r[2] >= e.maxLevel;
        html += '<div class="row"><span class="nm">' + r[0] + '</span><span class="bar"><i class="' + r[4] + '" style="width:' + Math.round(r[3] * 100) + '%"></i></span>' +
          '<span class="lvl">Lv ' + r[2] + '/' + e.maxLevel + '</span>' +
          (own ? (full ? '<button class="btn small" disabled>Max</button>'
            : '<button class="btn small" data-act="up" data-kind="' + r[1] + '" data-id="' + t.id + '"' + (save.money < cost ? ' disabled' : '') + '>Upgrade ' + money(cost) + '</button>')
            : '<span style="min-width:108px"></span>') + '</div>';
      });
      html += '</div>';
    });
    $('shopList').innerHTML = html;
    show('sShop');
  }

  function shopClick(ev) {
    var b = ev.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    var t = trainSpec(b.dataset.id), own = save.owned[t.id];
    if (b.dataset.act === 'buy' && !own && save.money >= t.price) {
      save.money -= t.price; save.owned[t.id] = { engine: 0, brake: 0 }; save.train = t.id; beep(880, .12);
    } else if (b.dataset.act === 'use' && own) {
      save.train = t.id;
    } else if (b.dataset.act === 'up' && own) {
      var kind = b.dataset.kind, cost = upgradeCost(own[kind]);
      if (own[kind] < CFG.economy.maxLevel && save.money >= cost) { save.money -= cost; own[kind]++; beep(660, .1); }
    }
    persist(); showShop();
  }

  function finishRun(derailed) {
    var lv = run.data.lv, e = CFG.economy, t = run.finalTime || run.train.time, stars = 0, pay, first = save.best[lv.id] === undefined;
    if (derailed) {
      pay = Math.round(lv.reward * (e.derailLapPay || 0) * run.train.lap());
      $('rTitle').textContent = 'Derailed!';
      $('rStars').innerHTML = '';
      $('rTime').textContent = 'Lap ' + Math.min(run.train.laps, run.train.lap() + 1) + ' of ' + run.train.laps;
      $('rBest').textContent = run.train.derailed === 0 ? 'The engine left the rails.' : 'Wagon ' + run.train.derailed + ' left the rails.';
      $('rPar').textContent = 'Slow down before the curves. The wagons keep pushing after you brake.';
    } else {
      var par = lv.par || [0, 0, 0];
      stars = t <= par[0] ? 3 : t <= par[1] ? 2 : t <= par[2] ? 1 : 0;
      pay = Math.round(lv.reward * (e.starMult[stars] || 1));
      var old = save.best[lv.id];
      if (old === undefined || t < old) save.best[lv.id] = Math.round(t * 100) / 100;
      save.stars[lv.id] = Math.max(save.stars[lv.id] || 0, stars);
      $('rTitle').textContent = old !== undefined && t < old ? 'New best time!' : 'Finished!';
      $('rStars').innerHTML = starsHtml(stars);
      $('rTime').textContent = fmtTime(t);
      $('rBest').textContent = 'Best ' + fmtTime(save.best[lv.id]);
      $('rPar').textContent = '★★★ ' + fmtTime(par[0]) + '   ★★ ' + fmtTime(par[1]) + '   ★ ' + fmtTime(par[2]);
    }
    save.money += pay; persist();
    $('rTrack').textContent = lv.name;
    $('rEarn').innerHTML = pay > 0 ? '+ ' + money(pay) : 'No coins this time';
    var next = run.idx + 1 < CFG.levels.length && unlocked(run.idx + 1);
    $('bNext').style.display = !derailed && next ? '' : 'none';
    $('bRetry').className = 'btn' + (derailed || !next ? ' go' : '');
    $('sResult').dataset.first = first ? '1' : '';
    show('sResult');
    engineSound(0, 0, 0);
  }

  /* ---------- reglage ---------- */

  function setLever(side, v) {
    var z = $('zone' + side), lev = z.firstElementChild, hgt = lev.clientHeight || 200;
    lev.querySelector('.fill').style.height = Math.round(v * (hgt - 10)) + 'px';
    lev.querySelector('.knob').style.bottom = Math.round(v * (hgt - 30)) + 'px';
  }
  function bindLever(side, set) {
    var z = $('zone' + side), lev = z.firstElementChild, active = null;
    function val(ev) {
      var r = lev.getBoundingClientRect();
      return Math.max(0, Math.min(1, (r.bottom - 15 - ev.clientY) / (r.height - 30)));
    }
    z.addEventListener('pointerdown', function (ev) {
      if (active !== null) return;
      active = ev.pointerId; try { z.setPointerCapture(active); } catch (e) { }
      var v = val(ev); set(v); setLever(side, v); ev.preventDefault();
    });
    z.addEventListener('pointermove', function (ev) { if (ev.pointerId === active) { var v = val(ev); set(v); setLever(side, v); } });
    function up(ev) { if (ev.pointerId === active) { active = null; set(0); setLever(side, 0); } }
    z.addEventListener('pointerup', up); z.addEventListener('pointercancel', up); z.addEventListener('lostpointercapture', up);
  }
  var keys = {};
  function keyState() {
    // tangentbord (för prov i webbläsare): pil upp/W = full gas, pil ned/S/mellanslag = full broms
    thr = keys.ArrowUp || keys.w || keys.ArrowRight ? 1 : 0; brk = keys.ArrowDown || keys.s || keys[' '] || keys.ArrowLeft ? 1 : 0;
    setLever('R', thr); setLever('L', brk);
  }

  /* ---------- ljud ---------- */

  var AC = null, snd = null;
  function audioInit() {
    if (AC || !save.sound) { if (AC && AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      var master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
      var len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      function noise(type, f, q) {
        var s = AC.createBufferSource(); s.buffer = buf; s.loop = true;
        var fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
        var g = AC.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start();
        return { f: fl, g: g };
      }
      var osc = AC.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 45;
      var of = AC.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 260;
      var og = AC.createGain(); og.gain.value = 0; osc.connect(of); of.connect(og); og.connect(master); osc.start();
      snd = { master: master, eng: osc, engG: og, roll: noise('lowpass', 500, 0.5), squeal: noise('bandpass', 3200, 14), buf: buf };
    } catch (e) { AC = null; }
  }
  function engineSound(v, throttle, load) {
    if (!AC || !snd) return;
    var t = AC.currentTime, on = save.sound ? 1 : 0;
    snd.eng.frequency.setTargetAtTime(42 + v * 3.2 + throttle * 16, t, 0.1);
    snd.engG.gain.setTargetAtTime(on * (0.05 + throttle * 0.16) * (v > 0.2 || throttle > 0 ? 1 : 0), t, 0.1);
    snd.roll.g.gain.setTargetAtTime(on * Math.min(0.5, v / 45), t, 0.1);
    snd.roll.f.frequency.setTargetAtTime(300 + v * 30, t, 0.1);
    var w = CFG.physics.warnAt;
    snd.squeal.g.gain.setTargetAtTime(on * Math.max(0, Math.min(1, (load - w) / (1 - w))) * 0.22, t, 0.05);
  }
  function beep(f, dur, type, vol) {
    if (!AC || !save.sound) return;
    var o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(vol || 0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(snd.master); o.start(t); o.stop(t + dur);
  }
  function thud(vol, dur, freq) {
    if (!AC || !save.sound) return;
    var s = AC.createBufferSource(); s.buffer = snd.buf;
    var fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = freq || 400;
    var g = AC.createGain(), t = AC.currentTime;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(snd.master); s.start(t, Math.random()); s.stop(t + dur);
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

  /* ---------- uppdatering ---------- */

  var P1 = {}, P2 = {}, P3 = {};
  function carPose(run, i, out) {
    // läge och riktning ur två punkter på spåret (boggierna), så att fordonet följer kurvor och backar
    var c = run.train.cars[i], tr = run.data.tr;
    if (run.wreck) { var w = run.wreck[i]; out.x = w.x; out.y = w.y; out.z = w.z; out.ux = Math.cos(w.a); out.uy = Math.sin(w.a); out.sl = 0; return out; }
    var a = tr.at(c.s + c.len * 0.32, P1), b = tr.at(c.s - c.len * 0.32, P2);
    var dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
    out.x = (a.x + b.x) / 2; out.y = (a.y + b.y) / 2; out.z = (a.z + b.z) / 2;
    out.ux = dx / d; out.uy = dy / d; out.sl = (a.z - b.z) / d;
    return out;
  }

  function update(dt) {
    if (!run) return;
    var tn = run.train, cars = tn.cars, i;
    if (mode === 'pause') return;
    if (run.wreck) {
      run.crashT += dt;
      run.wreck.forEach(function (w) {
        var sp = Math.hypot(w.vx, w.vy), dec = Math.min(sp, 11 * dt);
        if (sp > 0) { w.vx -= w.vx / sp * dec; w.vy -= w.vy / sp * dec; }
        w.x += w.vx * dt; w.y += w.vy * dt; w.a += w.w * dt; w.w *= Math.exp(-dt * 1.6);
        if (sp > 2 && Math.random() < dt * 12) puff(w.x, w.y, w.z + 0.3, '#b9a27a', 0.7);
      });
      run.shake = Math.max(0, run.shake - dt * 2);
      if (run.demo) { if (run.crashT > 2.5) startRun(run.idx, true); }
      else if (mode === 'crash' && run.crashT > 1.9) { setMode('done'); finishRun(true); }
    } else if (run.count > 0) {
      var before = Math.ceil(run.count - 0.2);
      run.count -= dt;
      var now = Math.ceil(run.count - 0.2), el = $('count');
      el.style.display = 'block';
      el.textContent = run.count > 0.2 ? Math.min(3, now) : 'GO!';
      if (now !== before) beep(now <= 0 ? 880 : 440, now <= 0 ? .4 : .15);
      if (run.count <= 0) setTimeout(function () { el.style.display = 'none'; }, 500);
    } else if (!tn.finished) {
      var a = run.auto ? SIM.autopilot(tn, run.demo ? 0.6 : parseFloat(Q.get('margin') || '0.8')) : { thr: thr, brk: brk };
      tn.clunk = 0;
      tn.step(dt, a.thr, a.brk);
      run.in = a;
      if (tn.clunk > 0.6 && !run.demo) { thud(Math.min(0.5, tn.clunk * 0.12), 0.12, 700); }
      if (tn.lap() !== run.lap && !tn.finished) {
        run.lap = tn.lap();
        if (!run.demo) {
          $('hLap').textContent = Math.min(tn.laps, run.lap + 1) + '/' + tn.laps;
          run.flash = { t: 0, text: run.lap + 1 === tn.laps ? 'FINAL LAP' : 'LAP ' + (run.lap + 1) };
          beep(660, .15); setTimeout(function () { beep(990, .2); }, 130);
        }
      }
      if (tn.derailed >= 0) crash();
      else if (tn.finished) {
        if (run.demo) startRun(run.idx, true);
        else { run.doneT = 0; run.finalTime = tn.time; [523, 659, 784, 1047].forEach(function (f, n) { setTimeout(function () { beep(f, .25); }, n * 120); }); }
      }
      // rök och gnistor
      var sp = run.spec, lp = carPose(run, 0, P3);
      if (sp.style !== 'electric' && Math.random() < dt * (4 + a.thr * 22)) {
        var off = sp.style === 'steam' ? 3.1 : 1.2;
        run.parts.push({ x: lp.x + lp.ux * off, y: lp.y + lp.uy * off, z: lp.z + 3.8, vx: (Math.random() - .5) * 1.2, vy: (Math.random() - .5) * 1.2, vz: 2.6 + Math.random() * 1.6,
          life: 0, max: 1.1 + Math.random() * .7, size: 0.7, grow: 1.6, col: sp.style === 'steam' ? '#f2f2f2' : '#5b5b5b' });
      }
      if (a.brk > 0.5 && cars[0].v > 3 && Math.random() < dt * 40) {
        var sd = Math.random() < .5 ? 1 : -1;
        run.parts.push({ x: lp.x - lp.uy * sd * 1 + lp.ux * (Math.random() * 6 - 3), y: lp.y + lp.ux * sd * 1 + lp.uy * (Math.random() * 6 - 3), z: lp.z + 0.3,
          vx: lp.ux * cars[0].v * .5, vy: lp.uy * cars[0].v * .5, vz: 1.5 + Math.random() * 2, life: 0, max: .25 + Math.random() * .2, size: .22, grow: 0, col: '#ffcf5a', g: 9 });
      }
    } else if (!run.demo) {
      // i mål: tåget rullar ut av sig självt medan resultatet tas fram
      run.doneT += dt;
      tn.finished = false; var keep = tn.laps; tn.laps = 1e9; tn.step(dt, 0, 0.5); tn.laps = keep; tn.finished = true;
      if (mode === 'play' && run.doneT > 1.4) { setMode('done'); finishRun(false); }
    }
    // partiklar
    for (i = run.parts.length - 1; i >= 0; i--) {
      var q = run.parts[i];
      q.life += dt;
      if (q.life >= q.max) { run.parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; if (q.g) q.vz -= q.g * dt;
    }
    // kameran följer loket och tittar lite framåt i färdriktningen
    var lead = carPose(run, 0, P3), v = run.wreck ? 0 : cars[0].v;
    var tx = lead.x + lead.ux * v * 1.1, ty = lead.y + lead.uy * v * 1.1, f = 1 - Math.exp(-dt * 2.6);
    run.cam.x += (tx - run.cam.x) * f; run.cam.y += (ty - run.cam.y) * f; run.cam.z += (lead.z - run.cam.z) * f;
    if (run.flash) { run.flash.t += dt; if (run.flash.t > 1.8) run.flash = null; }
    if (!run.demo && (mode === 'play' || mode === 'crash')) {
      $('hTime').textContent = fmtTime(run.finalTime || tn.time);
      $('hSpeed').textContent = Math.round(Math.abs(cars[0].v) * 3.6);
      var ld = Math.min(1.2, tn.maxLoad), fill = $('loadFill'), wa = CFG.physics.warnAt;
      fill.style.width = (ld / 1.2 * 100) + '%';
      fill.style.background = ld >= 1 ? '#ff2a1f' : ld > wa ? '#ffb23c' : '#4cc95a';
      engineSound(run.wreck ? 0 : Math.abs(cars[0].v), run.in ? run.in.thr : 0, run.wreck ? 0 : tn.maxLoad);
    }
  }
  function puff(x, y, z, col, size) {
    run.parts.push({ x: x + (Math.random() - .5) * 2, y: y + (Math.random() - .5) * 2, z: z, vx: (Math.random() - .5) * 3, vy: (Math.random() - .5) * 3, vz: 1 + Math.random() * 2,
      life: 0, max: .6 + Math.random() * .5, size: size, grow: 1.2, col: col, a: .5 });
  }

  function crash() {
    var tn = run.train, tr = run.data.tr, d = tn.derailed;
    run.wreck = tn.cars.map(function (c, i) {
      var p = carPose(run, i, {}), at = tr.at(c.s, P1), out = at.k > 0 ? -1 : 1; // utåt i kurvan
      var nx = -at.ty * out, ny = at.tx * out;
      var push = i === d ? 5 : i > d ? 2.5 + Math.random() * 2 : 0.6;
      return { x: p.x, y: p.y, z: p.z, a: Math.atan2(p.uy, p.ux), vx: at.tx * c.v + nx * push, vy: at.ty * c.v + ny * push,
        w: (i === d ? 2.2 : i > d ? 1.2 : 0.3) * -out * (0.7 + Math.random() * 0.6) };
    });
    run.crashT = 0; run.shake = 1;
    if (!run.demo) { setMode('crash'); thud(0.9, 0.9, 500); thud(0.5, 0.4, 1800); vibrate(350); thr = brk = 0; setLever('L', 0); setLever('R', 0); }
    for (var n = 0; n < 8; n++) puff(run.wreck[d].x, run.wreck[d].y, run.wreck[d].z + .5, '#b9a27a', 1.0);
  }

  /* ---------- ritning ---------- */

  var cv = $('c'), ctx = cv.getContext('2d'), W = 0, H = 0, DPR = 1;
  var S = 5, TY = 0.62, TZ = 0.78, OX = 0, OY = 0;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  function px(x) { return OX + x * S; }
  function py(y, z) { return OY + (y * TY - z * TZ) * S; }

  // Låda sedd snett uppifrån (kameran står söder om banan): de två sidor som vetter mot kameran och taket ritas.
  function box(cx, cy, cz, ux, uy, sl, hl, hw, z0, z1, colTop, colSide, tint) {
    var X = [], Y = [], Zb = [], i, k = 0;
    for (var a = -1; a <= 1; a += 2) for (var b = -1; b <= 1; b += 2) {
      X[k] = cx + ux * hl * a - uy * hw * b; Y[k] = cy + uy * hl * a + ux * hw * b; Zb[k] = cz + sl * hl * a; k++;
    }
    // hörn: 0 = bak höger(−,−), 1 = bak vänster(−,+), 2 = fram(+,−), 3 = fram(+,+)
    function face(i0, i1, col) {
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(px(X[i0]), py(Y[i0], Zb[i0] + z0)); ctx.lineTo(px(X[i1]), py(Y[i1], Zb[i1] + z0));
      ctx.lineTo(px(X[i1]), py(Y[i1], Zb[i1] + z1)); ctx.lineTo(px(X[i0]), py(Y[i0], Zb[i0] + z1)); ctx.closePath(); ctx.fill();
    }
    var side = shade(colSide, 0.62 + 0.2 * Math.abs(ux)), end = shade(colSide, 0.62 + 0.2 * Math.abs(uy));
    if (ux > 0) face(1, 3, side); else face(0, 2, side);     // långsidan vars normal pekar mot kameran
    if (uy > 0) face(2, 3, end); else face(0, 1, end);       // kortsidan
    ctx.fillStyle = colTop; ctx.beginPath();
    ctx.moveTo(px(X[0]), py(Y[0], Zb[0] + z1)); ctx.lineTo(px(X[1]), py(Y[1], Zb[1] + z1));
    ctx.lineTo(px(X[3]), py(Y[3], Zb[3] + z1)); ctx.lineTo(px(X[2]), py(Y[2], Zb[2] + z1)); ctx.closePath(); ctx.fill();
    if (tint > 0) { ctx.fillStyle = 'rgba(255,40,25,' + tint + ')'; ctx.fill(); }
  }

  function drawCar(run, i) {
    var c = run.train.cars[i], p = carPose(run, i, {}), w = CFG.physics.warnAt;
    var tint = run.wreck ? 0 : Math.max(0, Math.min(0.75, (c.load - w) / (1 - w) * 0.75));
    var hl = c.len / 2;
    // skugga på marken
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(px(p.x) + 3, py(p.y, p.z) + 3, (Math.abs(p.ux) * hl + Math.abs(p.uy) * 1.4 + .6) * S, (Math.abs(p.uy) * hl + Math.abs(p.ux) * 1.4 + .6) * S * TY, 0, 0, 6.3); ctx.fill();
    box(p.x, p.y, p.z, p.ux, p.uy, p.sl, hl, 1.2, 0.25, 0.9, '#30323a', '#3a3d47', 0);
    function part(off, len, hw, z0, z1, top, side, tn) {
      box(p.x + p.ux * off, p.y + p.uy * off, p.z + p.sl * off, p.ux, p.uy, p.sl, len / 2, hw, z0, z1, top, side, tn);
    }
    var parts = [];
    if (i > 0) {
      var col = run.wagonCols[i - 1];
      parts.push([0, c.len - 0.3, 1.3, 0.9, 2.3, i % 2 ? '#2b2b30' : '#6b4a2e', col, tint]);
    } else {
      var col0 = run.spec.color || '#2f6b3a', st = run.spec.style;
      if (st === 'steam') {
        parts.push([-2.9, 3.0, 1.35, 0.9, 3.3, shade(col0, 0.8), col0, tint]);       // hytt
        parts.push([1.5, 5.8, 1.05, 0.9, 2.6, shade(col0, 1.25), col0, tint]);       // panna
        parts.push([3.1, 0.9, 0.42, 2.6, 3.7, '#1d1d20', '#2a2a2e', 0]);             // skorsten
        parts.push([0.6, 0.9, 0.5, 2.6, 3.0, '#d9b23c', '#b38f24', 0]);              // dom
      } else if (st === 'diesel') {
        parts.push([-1.0, 6.6, 1.2, 0.9, 2.7, shade(col0, 1.2), col0, tint]);        // motorhuv
        parts.push([3.2, 2.4, 1.35, 0.9, 3.3, '#e9e4d2', col0, tint]);               // hytt fram
        parts.push([-1.4, 1.0, 0.5, 2.7, 3.1, '#2a2a2e', '#333', 0]);                // avgasrör
      } else {
        parts.push([0, 8.6, 1.3, 0.9, 3.0, shade(col0, 1.25), col0, tint]);          // kaross
        parts.push([3.6, 1.2, 1.32, 2.0, 3.02, '#bfe3f5', '#9fd0ea', 0]);            // frontruta
        parts.push([-0.5, 2.6, 0.5, 3.0, 3.5, '#888c94', '#6b6f77', 0]);             // strömavtagare
      }
    }
    // delarna längst från kameran först
    parts.sort(function (a, b) { return a[0] * p.uy - b[0] * p.uy; });
    parts.forEach(function (q) { part.apply(null, q); });
  }

  function drawSpring(run, j) {
    var a = carPose(run, j, P1), cars = run.train.cars;
    var ax = a.x - a.ux * cars[j].len / 2, ay = a.y - a.uy * cars[j].len / 2, az = a.z - a.sl * cars[j].len / 2 + 1.0;
    var b = carPose(run, j + 1, P2);
    var bx = b.x + b.ux * cars[j + 1].len / 2, by = b.y + b.uy * cars[j + 1].len / 2, bz = b.z + b.sl * cars[j + 1].len / 2 + 1.0;
    var x0 = px(ax), y0 = py(ay, az), x1 = px(bx), y1 = py(by, bz), dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    var nx = -dy / d, ny = dx / d, amp = 0.62 * S, n = 9, lead = Math.min(d * 0.12, 0.35 * S);
    var st = run.wreck ? 0 : run.train.stretch(j) / CFG.physics.springTravel;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + dx / d * lead, y0 + dy / d * lead);
    for (var i = 0; i < n; i++) {
      var f = lead + (d - 2 * lead) * (i + 0.5) / n, sg = i % 2 ? -1 : 1;
      ctx.lineTo(x0 + dx / d * f + nx * amp * sg, y0 + dy / d * f + ny * amp * sg * TY);
    }
    ctx.lineTo(x1 - dx / d * lead, y1 - dy / d * lead); ctx.lineTo(x1, y1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#15181d'; ctx.lineWidth = Math.max(3, 0.62 * S); ctx.stroke();
    ctx.strokeStyle = Math.abs(st) > 0.85 ? '#ff5a3c' : st > 0.4 ? '#ffd27a' : st < -0.4 ? '#8fd3ff' : '#e3e7ec';
    ctx.lineWidth = Math.max(1.4, 0.3 * S); ctx.stroke();
  }

  function drawTree(t) {
    var x = px(t.x), y = py(t.y, 0);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x + t.r * S * .5, y + 1, t.r * S * 1.05, t.r * S * .5, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#5a4128'; ctx.fillRect(x - .28 * S, y - t.h * .5 * TZ * S, .56 * S, t.h * .5 * TZ * S);
    if (t.pine) {
      for (var k = 0; k < 3; k++) {
        var yy = y - (t.h * (.3 + k * .28)) * TZ * S, rr = t.r * (1 - k * .25) * S;
        ctx.fillStyle = shade(t.c, .8 + k * .18); ctx.beginPath(); ctx.moveTo(x - rr, yy); ctx.lineTo(x + rr, yy); ctx.lineTo(x, yy - t.h * .42 * TZ * S); ctx.closePath(); ctx.fill();
      }
    } else {
      var cy = y - t.h * .72 * TZ * S;
      ctx.fillStyle = shade(t.c, .78); ctx.beginPath(); ctx.arc(x, cy + t.r * S * .18, t.r * S, 0, 6.3); ctx.fill();
      ctx.fillStyle = t.c; ctx.beginPath(); ctx.arc(x - t.r * S * .15, cy - t.r * S * .12, t.r * S * .82, 0, 6.3); ctx.fill();
      ctx.fillStyle = shade(t.c, 1.22); ctx.beginPath(); ctx.arc(x - t.r * S * .3, cy - t.r * S * .32, t.r * S * .42, 0, 6.3); ctx.fill();
    }
  }

  // Målflagga på en stolpe bredvid start- och mållinjen (alltid vänd mot kameran).
  function drawGate(tr) {
    var p = tr.at(0, P1), sd = p.tx > 0 ? -1 : 1, fx = p.x - p.ty * 4.2 * sd, fy = p.y + p.tx * 4.2 * sd;
    var x = px(fx), y0 = py(fy, p.z), y1 = py(fy, p.z + 7.5), c = 0.75 * S;
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x + 2, y0, 1.1 * S, .5 * S, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#e9ecf1'; ctx.lineWidth = Math.max(2, .32 * S); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    for (var r = 0; r < 3; r++) for (var i = 0; i < 4; i++) {
      ctx.fillStyle = (i + r) % 2 ? '#111' : '#fff'; ctx.fillRect(x + i * c, y1 + r * c, c + .5, c + .5);
    }
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!run) { ctx.fillStyle = '#3f7a3a'; ctx.fillRect(0, 0, W, H); return; }
    var tr = run.data.tr, N = tr.N, i, j, cam = run.cam;
    S = W / ((CFG.view && CFG.view.meters) || 150);
    var shx = run.shake ? (Math.random() - .5) * run.shake * 14 : 0, shy = run.shake ? (Math.random() - .5) * run.shake * 14 : 0;
    OX = W / 2 - cam.x * S + shx; OY = H * 0.56 - (cam.y * TY - cam.z * TZ) * S + shy;

    // mark: gräs i stora rutor så att farten syns
    ctx.fillStyle = '#4a8f3f'; ctx.fillRect(0, 0, W, H);
    var T = 22, x0 = Math.floor((-OX / S) / T), x1 = Math.floor(((W - OX) / S) / T), y0 = Math.floor((-OY / S / TY) / T), y1 = Math.floor(((H - OY) / S / TY) / T);
    ctx.fillStyle = '#458839';
    for (i = x0; i <= x1; i++) for (j = y0; j <= y1; j++) if ((i + j) & 1) ctx.fillRect(px(i * T), OY + j * T * TY * S, T * S + 1, T * TY * S + 1);

    function vis(k) { var sx = px(tr.x[k]), sy = py(tr.y[k], tr.z[k]); return sx > -60 && sx < W + 60 && sy > -60 && sy < H + 120; }
    var BW = 2.1; // ballastens halva bredd
    function quad(k, z, grow) {
      var m = (k + 1) % N, w = BW + grow, ax = -tr.ty[k] * w, ay = tr.tx[k] * w, bx = -tr.ty[m] * w, by = tr.tx[m] * w;
      var zk = z ? tr.z[k] : 0, zm = z ? tr.z[m] : 0;
      ctx.moveTo(px(tr.x[k] + ax), py(tr.y[k] + ay, zk)); ctx.lineTo(px(tr.x[m] + bx), py(tr.y[m] + by, zm));
      ctx.lineTo(px(tr.x[m] - bx), py(tr.y[m] - by, zm)); ctx.lineTo(px(tr.x[k] - ax), py(tr.y[k] - ay, zk)); ctx.closePath();
    }
    // banvall: jordfyllning under spår som ligger högt, ritad bortifrån och framåt
    if (tr.maxZ > 0.15) {
      for (var o = 0; o < N; o++) {
        i = run.data.order[o];
        if (tr.z[i] < 0.12 || !vis(i)) continue;
        var m = (i + 1) % N, zz = tr.z[i], zm = tr.z[m], sp = 0.5 + zz * 0.45; // släntens bredd växer med höjden
        ctx.fillStyle = '#6f5a3e'; ctx.beginPath();
        quad(i, false, sp);
        // väggarna mellan fot och krön
        var w0 = BW + sp, w1 = BW;
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          ctx.moveTo(px(tr.x[i] - tr.ty[i] * w0 * sgn), py(tr.y[i] + tr.tx[i] * w0 * sgn, 0)); ctx.lineTo(px(tr.x[m] - tr.ty[m] * w0 * sgn), py(tr.y[m] + tr.tx[m] * w0 * sgn, 0));
          ctx.lineTo(px(tr.x[m] - tr.ty[m] * w1 * sgn), py(tr.y[m] + tr.tx[m] * w1 * sgn, zm)); ctx.lineTo(px(tr.x[i] - tr.ty[i] * w1 * sgn), py(tr.y[i] + tr.tx[i] * w1 * sgn, zz)); ctx.closePath();
        }
        ctx.fill();
        // slänten som vetter mot kameran lite ljusare
        var sg2 = tr.tx[i] > 0 ? 1 : -1;
        ctx.fillStyle = '#93784f'; ctx.beginPath();
        ctx.moveTo(px(tr.x[i] - tr.ty[i] * w0 * sg2), py(tr.y[i] + tr.tx[i] * w0 * sg2, 0)); ctx.lineTo(px(tr.x[m] - tr.ty[m] * w0 * sg2), py(tr.y[m] + tr.tx[m] * w0 * sg2, 0));
        ctx.lineTo(px(tr.x[m] - tr.ty[m] * w1 * sg2), py(tr.y[m] + tr.tx[m] * w1 * sg2, zm)); ctx.lineTo(px(tr.x[i] - tr.ty[i] * w1 * sg2), py(tr.y[i] + tr.tx[i] * w1 * sg2, zz)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b9ad98'; ctx.beginPath(); quad(i, true, 0); ctx.fill();
      }
    }
    // ballast på plan mark
    ctx.fillStyle = '#b9ad98'; ctx.beginPath();
    for (i = 0; i < N; i++) if (tr.z[i] < 0.12 && vis(i)) quad(i, true, 0);
    ctx.fill();
    // slipers
    ctx.strokeStyle = '#6a4f35'; ctx.lineWidth = Math.max(1.5, 0.42 * S); ctx.lineCap = 'butt'; ctx.beginPath();
    for (i = 0; i < N; i += 2) if (vis(i)) {
      ctx.moveTo(px(tr.x[i] - tr.ty[i] * 1.45), py(tr.y[i] + tr.tx[i] * 1.45, tr.z[i])); ctx.lineTo(px(tr.x[i] + tr.ty[i] * 1.45), py(tr.y[i] - tr.tx[i] * 1.45, tr.z[i]));
    }
    ctx.stroke();
    // start- och mållinje
    var g0 = tr.at(0, P1);
    for (i = 0; i < 6; i++) {
      var fa = -1 + i / 3, fb = fa + 1 / 3;
      ctx.fillStyle = i % 2 ? '#111' : '#fff'; ctx.beginPath();
      ctx.moveTo(px(g0.x - g0.ty * BW * fa - g0.tx * .5), py(g0.y + g0.tx * BW * fa - g0.ty * .5, g0.z)); ctx.lineTo(px(g0.x - g0.ty * BW * fb - g0.tx * .5), py(g0.y + g0.tx * BW * fb - g0.ty * .5, g0.z));
      ctx.lineTo(px(g0.x - g0.ty * BW * fb + g0.tx * .5), py(g0.y + g0.tx * BW * fb + g0.ty * .5, g0.z)); ctx.lineTo(px(g0.x - g0.ty * BW * fa + g0.tx * .5), py(g0.y + g0.tx * BW * fa + g0.ty * .5, g0.z)); ctx.closePath(); ctx.fill();
    }
    // räls
    ctx.lineWidth = Math.max(1.2, 0.24 * S); ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? '#dfe4ea' : '#4a4f58';
      if (!pass) ctx.lineWidth = Math.max(2.2, 0.4 * S); else ctx.lineWidth = Math.max(1, 0.18 * S);
      for (var sd = -1; sd <= 1; sd += 2) {
        ctx.beginPath(); var pen = false;
        for (i = 0; i <= N; i++) {
          var k = i % N;
          if (!vis(k)) { pen = false; continue; }
          var rx = px(tr.x[k] - tr.ty[k] * .8 * sd), ry = py(tr.y[k] + tr.tx[k] * .8 * sd, tr.z[k] + .12);
          if (pen) ctx.lineTo(rx, ry); else { ctx.moveTo(rx, ry); pen = true; }
        }
        ctx.stroke();
      }
    }

    // föremål sorterade bortifrån och framåt: träd, målport, fordon och fjädrar
    var items = [], cars = run.train.cars, trees = run.data.trees, pose = {};
    for (i = 0; i < trees.length; i++) {
      var tx = px(trees[i].x), ty = py(trees[i].y, 0);
      if (tx > -50 && tx < W + 50 && ty > -10 && ty < H + 90) items.push([trees[i].y, 0, trees[i]]);
    }
    items.push([g0.y, 1, null]);
    for (i = 0; i < cars.length; i++) { carPose(run, i, pose); items.push([pose.y, 2, i]); if (i < cars.length - 1) { var y2 = carPose(run, i + 1, P2).y; items.push([(pose.y + y2) / 2 - 0.01, 3, i]); } }
    items.sort(function (a, b) { return a[0] - b[0]; });
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (it[1] === 0) drawTree(it[2]); else if (it[1] === 1) drawGate(tr); else if (it[1] === 2) drawCar(run, it[2]); else drawSpring(run, it[2]);
    }
    // rök, gnistor, damm
    for (i = 0; i < run.parts.length; i++) {
      var q = run.parts[i], fl = q.life / q.max;
      ctx.globalAlpha = (1 - fl) * (q.a || 0.75); ctx.fillStyle = q.col;
      ctx.beginPath(); ctx.arc(px(q.x), py(q.y, q.z), (q.size + q.grow * fl) * S, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!run.demo) {
      // karta med tågets fordon
      var mw = 130, mh = 85, mx = Math.max(96, W * 0.19) + 6, my = 46, mm = run.miniMap;
      ctx.drawImage(run.miniCanvas, mx, my, mw, mh);
      for (i = cars.length - 1; i >= 0; i--) {
        var cp = carPose(run, i, pose);
        ctx.fillStyle = i ? '#ffd27a' : '#35e0ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(mx + (mm.ox + cp.x * mm.sc) / 2, my + (mm.oy + cp.y * mm.sc) / 2, i ? 2.4 : 3.6, 0, 6.3); ctx.fill(); ctx.stroke();
      }
      if (run.flash) {
        var ft = run.flash.t, al = ft < .2 ? ft / .2 : ft > 1.3 ? Math.max(0, 1 - (ft - 1.3) / .5) : 1;
        ctx.globalAlpha = al; ctx.font = '900 ' + Math.round(Math.min(64, H * .16)) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(run.flash.text, W / 2, H * .3);
        ctx.fillStyle = '#ffc93c'; ctx.fillText(run.flash.text, W / 2, H * .3); ctx.globalAlpha = 1;
      }
    }
  }

  /* ---------- huvudslinga och start ---------- */

  var last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    try { update(dt); render(); } catch (e) { if (!frame.err) { frame.err = true; console.error(e); } }
    requestAnimationFrame(frame);
  }

  function back() {
    // Androids bakåtknapp: true = hanterad i sidan, false = appen får stängas
    if (mode === 'play') { pause(); return true; }
    if (mode === 'pause') { resume(); return true; }
    if (mode === 'crash') return true;
    if (mode === 'done') { showMenu(); return true; }
    if (mode === 'menu' && !$('sMenu').classList.contains('on')) { showMenu(); return true; }
    return false;
  }
  window.stBack = back;
  function pause() { if (mode !== 'play' || run.train.finished) return; setMode('pause'); show('sPause'); engineSound(0, 0, 0); }
  function resume() { show(null); setMode('play'); last = performance.now(); }

  function init() {
    resize(); window.addEventListener('resize', resize);
    bindLever('L', function (v) { brk = v; }); bindLever('R', function (v) { thr = v; });
    window.addEventListener('keydown', function (e) { if (e.repeat) return; keys[e.key] = true; keyState(); if (e.key === 'Escape') back(); });
    window.addEventListener('keyup', function (e) { keys[e.key] = false; keyState(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) { if (mode === 'play') pause(); if (AC) AC.suspend(); } else if (AC && save.sound) AC.resume(); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    $('bPlay').onclick = function () { audioInit(); showLevels(); };
    $('bShop').onclick = function () { audioInit(); showShop(); };
    $('bInfo').onclick = function () { show('sInfo'); };
    $('bQuit').onclick = function () { if (APP && APP.quit) APP.quit(); };
    $('sndBtn').onclick = function () { save.sound = !save.sound; persist(); if (save.sound) audioInit(); showMenu(); };
    var backs = document.querySelectorAll('[data-back]');
    for (var i = 0; i < backs.length; i++) backs[i].onclick = showMenu;
    $('levelList').onclick = function (ev) { var b = ev.target.closest('.lv'); if (b && !b.classList.contains('locked')) { show(null); play(+b.dataset.i); } };
    $('shopList').onclick = shopClick;
    $('pauseBtn').onclick = pause;
    $('bResume').onclick = resume;
    $('bRestart').onclick = function () { show(null); play(run.idx); };
    $('bGiveUp').onclick = showMenu;
    $('bRetry').onclick = function () { show(null); play(run.idx); };
    $('bNext').onclick = function () { show(null); play(run.idx + 1); };
    $('bRShop').onclick = function () { startRun(0, true); setMode('menu'); showShop(); };
    $('bRMenu').onclick = showMenu;

    applyConfig(readJson(CFG_KEY));
    requestAnimationFrame(frame);
    fetchConfig(function () {
      fixSave(); persist();
      $('splash').style.display = 'none';
      var lv = Q.get('level'), sc = Q.get('screen');
      if (lv !== null) {
        // provlägen: ?level=N startar bana N direkt, &auto=1 låter den inbyggda föraren köra, &warp=S spolar fram S sekunder
        show(null); play(Math.min(CFG.levels.length - 1, +lv || 0));
        var warp = +Q.get('warp') || 0;
        if (warp) { run.count = 0; for (var n = 0; n < warp * 60 && mode === 'play'; n++) update(1 / 60); }
      }
      else { showMenu(); if (sc === 'shop') showShop(); else if (sc === 'levels') showLevels(); else if (sc === 'info') show('sInfo'); }
    });
  }
  init();
})();
