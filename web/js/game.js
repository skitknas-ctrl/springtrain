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
    if (Q.get('local') === '1') { done(); return; } // provläge: bara de inbyggda värdena, ingen hämtning
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
    CFG.trains.forEach(function (t) { if (!(t.price > 0) && !save.owned[t.id]) save.owned[t.id] = { engine: 0, brake: 0, spring: 0 }; });
    if (!save.owned[first.id]) save.owned[first.id] = { engine: 0, brake: 0, spring: 0 };
    // sparningar från före fjäderuppgraderingen saknar nivån
    for (var id in save.owned) ['engine', 'brake', 'spring'].forEach(function (k) { if (typeof save.owned[id][k] !== 'number') save.owned[id][k] = 0; });
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
  var BW = 2.1;      // ballastens halva bredd (m)
  var HILL = 1.15;   // tunnelkullens släntbredd per meter höjd
  var CELL = 48;     // landskapets föremål ligger i rutor om så många meter, så att bara de synliga gås igenom

  function levelData(idx) {
    if (trackCache[idx]) return trackCache[idx];
    var lv = CFG.levels[idx], tr = SIM.buildTrack(lv.points, 1), i, k, N = tr.N, key;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, kMax = 0;
    for (i = 0; i < N; i++) {
      minX = Math.min(minX, tr.x[i]); maxX = Math.max(maxX, tr.x[i]);
      minY = Math.min(minY, tr.y[i]); maxY = Math.max(maxY, tr.y[i]);
      kMax = Math.max(kMax, Math.abs(tr.k[i]));
    }

    // Korsningar i olika plan: det övre spåret får ett "spann" (bro eller tunnelkulle) som ritas efter det undre.
    var span = new Uint8Array(N), spans = [];
    (tr.crossings || []).forEach(function (c) {
      if (!c.sep) return;
      var kind = lv.crossing === 'tunnel' ? 2 : 1, sn = Math.max(0.35, Math.sin(c.angle)), cs = Math.cos(c.angle);
      // tunnelkullen har flackare slänter än en vanlig banvall (HILL i stället för 0.45 m bredd per meter höjd)
      var foot = BW + 0.5 + c.zHi * (kind === 2 ? HILL : 0.45);
      var half = Math.max(7, Math.min(34, kind === 2 ? 2.8 / sn + foot / sn + 6 : 4.8 / sn + 1.5));
      var h = Math.round(half / tr.ds), list = [];
      for (k = -h; k <= h; k++) { var q = ((c.hi + k) % N + N) % N; span[q] = kind; list.push(q); }
      var sp = { kind: kind, c: c, list: list, order: list.slice().sort(function (a, b) { return tr.y[a] - tr.y[b]; }), portals: [] };
      if (kind === 2) {
        // tunnelmynningar av sten på det undre spåret, en på var sida om kullen
        var inner = Math.max(BW, foot - 4.9 / c.zHi * (foot - BW)) - 0.6; // där kullen är lika hög som mynningen
        var dC = (inner + foot + 0.5) / (2 * sn), hl = (foot + 0.5 - inner) / (2 * sn);
        [1, -1].forEach(function (dir) {
          var p = tr.at(c.lo * tr.ds + dir * dC);
          sp.portals.push({ x: p.x, y: p.y, z: p.z, dx: p.tx * dir, dy: p.ty * dir, hl: hl });
        });
        sp.portals.sort(function (a, b) { return a.y - b.y; });
      }
      spans.push(sp);
    });
    spans.sort(function (a, b) { return a.c.y - b.c.y; });

    // ritordning för banvallen: längst bort först (kameran vrids aldrig, så ordningen är fast)
    var order = [];
    for (i = 0; i < N; i++) if (!span[i]) order.push(i);
    order.sort(function (a, b) { return tr.y[a] - tr.y[b]; });

    // rutnät över spåret, för att snabbt kunna fråga "ligger det spår nära den här punkten?" även på stora banor
    var G = 8, grid = {};
    for (i = 0; i < N; i++) { key = Math.floor(tr.x[i] / G) + ',' + Math.floor(tr.y[i] / G); (grid[key] || (grid[key] = [])).push(i); }
    function clearOfTrack(x, y, r) {
      var n = Math.ceil((r + 8) / G), cx = Math.floor(x / G), cy = Math.floor(y / G);
      for (var gx = cx - n; gx <= cx + n; gx++) for (var gy = cy - n; gy <= cy + n; gy++) {
        var l = grid[gx + ',' + gy];
        if (!l) continue;
        for (var q = 0; q < l.length; q++) {
          var j = l[q];
          if (Math.hypot(tr.x[j] - x, tr.y[j] - y) - (BW + 0.5 + tr.z[j] * 0.45) < r) return false;
        }
      }
      return true;
    }

    // landskapet: dammar, hus, djur, träd, buskar och stenar, utplacerade med fast slump per bana och aldrig på spåret
    var R = rng(1000 + idx * 77), pad = 110, x0 = minX - pad, y0 = minY - pad, w = maxX - minX + 2 * pad, h2 = maxY - minY + 2 * pad;
    var area = w * h2, cells = {}, big = [], count = 0;
    function put(o) { key = Math.floor(o.x / CELL) + ',' + Math.floor(o.y / CELL); (cells[key] || (cells[key] = [])).push(o); count++; return o; }
    function free(x, y, r) { for (var b = 0; b < big.length; b++) if (Math.hypot(big[b].x - x, big[b].y - y) < r + big[b].r) return false; return true; }
    function scatter(n, fn) { for (var t = 0; t < n; t++) fn(x0 + R() * w, y0 + R() * h2); }
    var p1 = R() * 6, p2 = R() * 6, p3 = R() * 6;
    function grove(x, y) { return Math.sin(x * 0.021 + p1) + Math.sin(y * 0.027 + p2) + Math.sin((x + y) * 0.013 + p3); }

    scatter(Math.round(area / 5200), function (x, y) {            // dammar
      var r = 6 + R() * 6;
      if (big.length < area / 14000 && clearOfTrack(x, y, r + 3) && free(x, y, r + 4)) { big.push(put({ t: 'pond', g: 1, x: x, y: y, r: r, v: R() })); }
    });
    var houseCols = ['#c9463a', '#c9463a', '#f3d36b', '#f4f0e4', '#8fc0de'], nHouse = 0;
    scatter(Math.round(area / 3000), function (x, y) {            // hus, lador och väderkvarnar
      if (nHouse >= area / 15000 || !clearOfTrack(x, y, 11) || !free(x, y, 10)) return;
      nHouse++;
      var q = R(), o = { x: x, y: y, r: 8, v: R(), a: (R() - 0.5) * 1.2 };
      if (q < 0.18) { o.t = 'mill'; o.r = 6; }
      else if (q < 0.42) { o.t = 'house'; o.barn = 1; o.hl = 5.5; o.hw = 3.4; o.h = 4.2; o.rh = 3.2; o.c = '#b83a30'; o.roof = '#4a4d57'; }
      else { o.t = 'house'; o.hl = 3.6 + R() * 1.2; o.hw = 2.7; o.h = 3; o.rh = 2.6; o.c = houseCols[Math.floor(R() * houseCols.length)]; o.roof = R() < 0.5 ? '#d9703a' : '#5b5f6b'; }
      big.push(put(o));
      if (o.barn) for (var b = 0; b < 3; b++) {                   // höbalar vid ladan
        var hx = x + (R() - 0.5) * 22, hy = y + 5 + R() * 8;
        if (clearOfTrack(hx, hy, 3) && free(hx, hy, 1.5)) put({ t: 'hay', x: hx, y: hy, v: R() });
      }
    });
    scatter(Math.round(area / 6000), function (x, y) {            // fårflockar och kor
      if (!clearOfTrack(x, y, 7) || !free(x, y, 6)) return;
      var kind = R() < 0.6 ? 'sheep' : 'cow', n = 2 + Math.floor(R() * 4);
      for (var b = 0; b < n; b++) {
        var ax = x + (R() - 0.5) * 13, ay = y + (R() - 0.5) * 10;
        if (clearOfTrack(ax, ay, 3) && free(ax, ay, 1)) put({ t: kind, x: ax, y: ay, v: R(), f: R() < 0.5 ? 1 : -1 });
      }
      big.push({ x: x, y: y, r: 7 });
    });
    var greens = ['#3f9c46', '#35893f', '#4cae4f', '#2f7d3a'];
    scatter(Math.round(area / 330), function (x, y) {             // träd, tätare i dungar
      if (grove(x, y) < -0.5 + R() * 1.6) return;
      var r = 2 + R() * 1.9;
      if (!clearOfTrack(x, y, r + 2.5) || !free(x, y, r * 0.5)) return;
      var q = R();
      put({ t: 'tree', x: x, y: y, r: r, h: 4.5 + R() * 3.5, c: greens[Math.floor(R() * greens.length)], k: q < 0.3 ? 1 : q < 0.42 ? 2 : q < 0.52 ? 3 : 0, v: R() });
    });
    scatter(Math.round(area / 900), function (x, y) {             // buskar
      if (clearOfTrack(x, y, 3) && free(x, y, 0.5)) put({ t: 'bush', x: x, y: y, r: 0.9 + R() * 0.8, c: greens[Math.floor(R() * 3)], v: R() });
    });
    scatter(Math.round(area / 2400), function (x, y) {            // stenar
      if (clearOfTrack(x, y, 2.5) && free(x, y, 0.5)) put({ t: 'rock', x: x, y: y, r: 0.7 + R() * 1.1, v: R() });
    });

    return (trackCache[idx] = { lv: lv, tr: tr, order: order, span: span, spans: spans, cells: cells, box: [minX, minY, maxX, maxY], kMax: kMax });
  }

  // Liten karta över banan; snäva kurvor i orange och rött. Används på körskärmen och i banvalet.
  function drawMini(c, data, w, h, lineW) {
    var tr = data.tr, b = data.box, sc = Math.min((w - 8) / (b[2] - b[0]), (h - 8) / (b[3] - b[1]));
    var ox = w / 2 - (b[0] + b[2]) / 2 * sc, oy = h / 2 - (b[1] + b[3]) / 2 * sc, lim = CFG.physics.derailG;
    var st = Math.max(2, Math.round(tr.N / 400));
    c.lineCap = 'round'; c.lineWidth = lineW;
    function seg(i) {
      var j = (i + st) % tr.N, k = Math.abs(tr.k[i]), vs = k > 1e-6 ? Math.sqrt(lim / k) : 99;
      c.strokeStyle = vs < 16 ? '#ff5a3c' : vs < 21 ? '#ffb23c' : '#ffffff';
      c.beginPath(); c.moveTo(ox + tr.x[i] * sc, oy + tr.y[i] * sc); c.lineTo(ox + tr.x[j] * sc, oy + tr.y[j] * sc); c.stroke();
    }
    for (var i = 0; i < tr.N; i += st) seg(i);
    // vid bro/tunnel: det övre spåret ritas om överst med mörk kant, så att man ser vilket som går över
    data.spans.forEach(function (sp) {
      var a = sp.c.hi - 7, n;
      c.strokeStyle = '#10151f'; c.lineWidth = lineW * 2.1; c.beginPath();
      for (n = 0; n <= 14; n++) { var q = ((a + n) % tr.N + tr.N) % tr.N; c[n ? 'lineTo' : 'moveTo'](ox + tr.x[q] * sc, oy + tr.y[q] * sc); }
      c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = lineW; c.stroke();
    });
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
    var cols = ['#c0563f', '#3f7fbf', '#e0a530', '#4f9a55', '#8a62b8', '#d9773a'];
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
      var el = own ? own.engine : 0, bl = own ? own.brake : 0, sl = own ? own.spring : 0, sMax = 1 + (e.springStep || 0) * e.maxLevel;
      html += '<div class="train' + (sel ? ' sel' : '') + '"><div class="top"><span class="sw" style="background:' + esc(t.color) + '"></span><b>' + esc(t.name) +
        '</b><span style="color:var(--dim);font-size:13px">' + t.mass + ' t</span><span style="flex:1"></span>' +
        (own ? (sel ? '<span style="color:var(--gold);font-weight:800">In use</span>' : '<button class="btn small" data-act="use" data-id="' + t.id + '">Use this train</button>')
          : '<button class="btn gold" data-act="buy" data-id="' + t.id + '"' + (save.money < t.price ? ' disabled' : '') + '>Buy ' + money(t.price) + '</button>') + '</div>';
      [['Engine', 'engine', el, t.power * (1 + e.engineStep * el) / maxP, ''], ['Brakes', 'brake', bl, t.brake * (1 + e.brakeStep * bl) / maxB, 'b'],
        ['Springs', 'spring', sl, (1 + (e.springStep || 0) * sl) / sMax, 's']].forEach(function (r) {
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
      save.money -= t.price; save.owned[t.id] = { engine: 0, brake: 0, spring: 0 }; save.train = t.id; beep(880, .12);
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
    } else if (run.hold) {
      // provläge &hold=1: tåget står stilla där &pos= ställde det
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
    if (run.findCam) { run.cam.x = run.findCam.x; run.cam.y = run.findCam.y; run.cam.z = 0; return; }
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
  var S = 5, TY = 0.62, TZ = 0.78, OX = 0, OY = 0, LW = 1, NOW = 0;
  var INK = 'rgba(24,28,40,.55)'; // mörk konturlinje runt allt, ger det tecknade utseendet
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  function px(x) { return OX + x * S; }
  function py(y, z) { return OY + (y * TY - z * TZ) * S; }

  // Månghörning i världen: pts = [x, y, z, x, y, z, ...]. stroke = true ger konturlinje.
  function poly(pts, fill, stroke) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i += 3) { if (i) ctx.lineTo(px(pts[i]), py(pts[i + 1], pts[i + 2])); else ctx.moveTo(px(pts[i]), py(pts[i + 1], pts[i + 2])); }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke === true ? INK : stroke; ctx.lineWidth = LW; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function disc(x, y, r, fill, stroke) { // cirkel i skärmens koordinater
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = INK; ctx.lineWidth = LW; ctx.stroke(); }
  }
  function groundShadow(x, y, rx, ry) {
    ctx.fillStyle = 'rgba(10,50,20,.22)'; ctx.beginPath();
    ctx.ellipse(px(x) + rx * S * 0.35, py(y, 0) + 1, rx * S, ry * S * TY, 0, 0, 6.3); ctx.fill();
  }

  // Låda sedd snett uppifrån (kameran står söder om banan): de två sidor som vetter mot kameran och taket ritas.
  function box(cx, cy, cz, ux, uy, sl, hl, hw, z0, z1, colTop, colSide, tint) {
    var X = [], Y = [], Zb = [], k = 0;
    for (var a = -1; a <= 1; a += 2) for (var b = -1; b <= 1; b += 2) {
      X[k] = cx + ux * hl * a - uy * hw * b; Y[k] = cy + uy * hl * a + ux * hw * b; Zb[k] = cz + sl * hl * a; k++;
    }
    // hörn: 0 = bak höger(−,−), 1 = bak vänster(−,+), 2 = fram(+,−), 3 = fram(+,+)
    ctx.lineWidth = LW; ctx.lineJoin = 'round'; ctx.strokeStyle = INK;
    function face(i0, i1, col) {
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(px(X[i0]), py(Y[i0], Zb[i0] + z0)); ctx.lineTo(px(X[i1]), py(Y[i1], Zb[i1] + z0));
      ctx.lineTo(px(X[i1]), py(Y[i1], Zb[i1] + z1)); ctx.lineTo(px(X[i0]), py(Y[i0], Zb[i0] + z1)); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    var side = shade(colSide, 0.66 + 0.2 * Math.abs(ux)), end = shade(colSide, 0.66 + 0.2 * Math.abs(uy));
    if (ux > 0) face(1, 3, side); else face(0, 2, side);     // långsidan vars normal pekar mot kameran
    if (uy > 0) face(2, 3, end); else face(0, 1, end);       // kortsidan
    ctx.fillStyle = colTop; ctx.beginPath();
    ctx.moveTo(px(X[0]), py(Y[0], Zb[0] + z1)); ctx.lineTo(px(X[1]), py(Y[1], Zb[1] + z1));
    ctx.lineTo(px(X[3]), py(Y[3], Zb[3] + z1)); ctx.lineTo(px(X[2]), py(Y[2], Zb[2] + z1)); ctx.closePath(); ctx.fill();
    if (tint > 0) { ctx.fillStyle = 'rgba(255,40,25,' + tint + ')'; ctx.fill(); }
    ctx.stroke();
  }

  /* ----- marken ----- */

  // En gräsruta som upprepas: fält i olika gröna toner, tuvor och blommor. Ritas en gång och läggs sedan ut som plattor.
  var grassTile = null, TILE = 48;
  function makeGrass() {
    var w = 512, h = 318, c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'), R = rng(4711), i;
    function wrap(x, y, fn) { for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) fn(x + a * w, y + b * h); }
    g.fillStyle = '#62b54a'; g.fillRect(0, 0, w, h);
    for (i = 0; i < 30; i++) (function () {
      var x = R() * w, y = R() * h, rx = 26 + R() * 64, col = R() < 0.5 ? 'rgba(150,215,95,.25)' : 'rgba(40,130,60,.17)';
      wrap(x, y, function (a, b) { g.fillStyle = col; g.beginPath(); g.ellipse(a, b, rx, rx * 0.55, 0, 0, 6.3); g.fill(); });
    })();
    g.lineCap = 'round'; g.lineWidth = 1.7;
    for (i = 0; i < 230; i++) (function () {
      var x = R() * w, y = R() * h, col = R() < 0.5 ? 'rgba(38,120,52,.6)' : 'rgba(170,225,110,.6)';
      wrap(x, y, function (a, b) { g.strokeStyle = col; g.beginPath(); g.moveTo(a - 3, b); g.lineTo(a - 4.5, b - 5); g.moveTo(a, b); g.lineTo(a, b - 6.5); g.moveTo(a + 3, b); g.lineTo(a + 4.5, b - 5); g.stroke(); });
    })();
    var fl = ['#ffffff', '#ffe04a', '#ff9ecb', '#ffffff', '#c9a6ff', '#ff7a5c'];
    for (i = 0; i < 60; i++) (function () {
      var x = R() * w, y = R() * h, col = fl[Math.floor(R() * fl.length)], r = 2.2 + R() * 1.6;
      wrap(x, y, function (a, b) {
        g.fillStyle = 'rgba(30,90,40,.35)'; g.beginPath(); g.arc(a + 0.8, b + 1, r, 0, 6.3); g.fill();
        g.fillStyle = col; g.beginPath(); g.arc(a, b, r, 0, 6.3); g.fill();
        g.fillStyle = col === '#ffe04a' ? '#e08a1e' : '#ffd23c'; g.beginPath(); g.arc(a, b, r * 0.38, 0, 6.3); g.fill();
      });
    })();
    return c;
  }
  function drawGround() {
    if (!grassTile) grassTile = makeGrass();
    var i0 = Math.floor((-OX / S) / TILE), i1 = Math.floor(((W - OX) / S) / TILE);
    var j0 = Math.floor((-OY / S / TY) / TILE), j1 = Math.floor(((H - OY) / S / TY) / TILE);
    for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) {
      var xa = Math.round(px(i * TILE)), xb = Math.round(px((i + 1) * TILE)), ya = Math.round(OY + j * TILE * TY * S), yb = Math.round(OY + (j + 1) * TILE * TY * S);
      ctx.drawImage(grassTile, xa, ya, xb - xa, yb - ya);
    }
  }

  /* ----- landskapets föremål ----- */

  function drawPond(o) {
    var x = px(o.x), y = py(o.y, 0), rx = o.r * S, ry = o.r * 0.72 * S * TY;
    ctx.fillStyle = '#e3d3a0'; ctx.beginPath(); ctx.ellipse(x, y, rx + 0.9 * S, ry + 0.7 * S, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#3f9fd8'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.3); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = LW; ctx.stroke();
    ctx.fillStyle = '#62bdee'; ctx.beginPath(); ctx.ellipse(x - rx * 0.12, y - ry * 0.14, rx * 0.74, ry * 0.68, 0, 0, 6.3); ctx.fill();
    // ringar på vattnet som sakta växer
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, 0.14 * S);
    for (var k = 0; k < 2; k++) {
      var f = ((NOW * 0.25 + o.v + k * 0.5) % 1), cx = x + (k ? 0.3 : -0.35) * rx, cy = y + (k ? -0.2 : 0.15) * ry;
      ctx.globalAlpha = 1 - f; ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.3 * f + 1, ry * 0.3 * f + 0.6, 0, 0, 6.3); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (k = 0; k < 3; k++) { // näckrosblad
      var a = o.v * 6 + k * 2.2, lx = x + Math.cos(a) * rx * 0.55, ly = y + Math.sin(a) * ry * 0.5;
      ctx.fillStyle = '#3d9a45'; ctx.beginPath(); ctx.ellipse(lx, ly, 0.75 * S, 0.5 * S, 0, 0.5, 6.0); ctx.lineTo(lx, ly); ctx.fill();
      if (k === 0) disc(lx + 0.2 * S, ly - 0.1 * S, 0.28 * S, '#ffb7d9');
    }
  }

  function drawTree(t) {
    var x = px(t.x), y = py(t.y, 0), r = t.r * S, hh = t.h * TZ * S, sway = Math.sin(NOW * 1.3 + t.v * 9) * 0.05 * r;
    groundShadow(t.x, t.y, t.r * 1.05, t.r * 0.8);
    ctx.lineWidth = LW; ctx.strokeStyle = INK;
    ctx.fillStyle = t.k === 3 ? '#f1eee4' : '#7a5330'; ctx.beginPath(); ctx.rect(x - 0.3 * S, y - hh * 0.55, 0.6 * S, hh * 0.55); ctx.fill(); ctx.stroke();
    if (t.k === 1) { // gran
      for (var k = 0; k < 3; k++) {
        var yy = y - hh * (0.28 + k * 0.27), rr = r * (1 - k * 0.24);
        ctx.fillStyle = shade(t.c, 0.74 + k * 0.16); ctx.beginPath(); ctx.moveTo(x - rr, yy); ctx.lineTo(x + rr, yy); ctx.lineTo(x + sway * (k + 1), yy - hh * 0.44); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      return;
    }
    var cy = y - hh * 0.74, col = t.k === 3 ? '#8fd06a' : t.c;
    disc(x + sway, cy + r * 0.16, r, shade(col, 0.8), true);
    disc(x - r * 0.16 + sway, cy - r * 0.12, r * 0.8, col);
    disc(x - r * 0.3 + sway, cy - r * 0.34, r * 0.4, shade(col, 1.25));
    if (t.k === 2) for (k = 0; k < 5; k++) { // äppelträd
      var a = t.v * 6 + k * 1.3;
      disc(x + sway + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.5, Math.max(1.2, 0.22 * S), '#e63b2e');
    }
  }
  function drawBush(o) {
    var x = px(o.x), y = py(o.y, 0), r = o.r * S;
    groundShadow(o.x, o.y, o.r * 1.2, o.r * 0.6);
    disc(x - r * 0.6, y - r * 0.5, r * 0.75, shade(o.c, 0.82), true);
    disc(x + r * 0.55, y - r * 0.55, r * 0.8, shade(o.c, 0.9), true);
    disc(x, y - r * 0.85, r * 0.9, o.c, true);
    disc(x - r * 0.25, y - r * 1.1, r * 0.35, shade(o.c, 1.25));
    if (o.v < 0.35) { disc(x + r * 0.3, y - r * 0.6, Math.max(1, 0.16 * S), '#ff6f91'); disc(x - r * 0.5, y - r * 0.8, Math.max(1, 0.16 * S), '#ff6f91'); }
  }
  function drawRock(o) {
    var x = px(o.x), y = py(o.y, 0), r = o.r * S;
    groundShadow(o.x, o.y, o.r * 1.1, o.r * 0.6);
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.7, y - r * 0.8); ctx.lineTo(x - r * 0.1, y - r * 1.15); ctx.lineTo(x + r * 0.7, y - r * 0.75); ctx.lineTo(x + r, y); ctx.closePath();
    ctx.fillStyle = '#9aa1ab'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = LW; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.6, y - r * 0.7); ctx.lineTo(x - r * 0.1, y - r * 1.05); ctx.lineTo(x + r * 0.15, y - r * 0.55); ctx.closePath(); ctx.fillStyle = '#c3c9d1'; ctx.fill();
  }
  function drawHay(o) {
    var x = px(o.x), y = py(o.y, 0), r = 1.0 * S;
    groundShadow(o.x, o.y, 1.3, 0.8);
    ctx.fillStyle = '#d9a93a'; ctx.strokeStyle = INK; ctx.lineWidth = LW;
    ctx.beginPath(); ctx.rect(x - r * 1.1, y - r * 1.5, r * 2.2, r * 1.5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - r * 1.1, y - r * 0.75, r * 0.5, r * 0.75, 0, 0, 6.3); ctx.fillStyle = '#f0c95a'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - r * 1.1, y - r * 0.75, r * 0.2, r * 0.3, 0, 0, 6.3); ctx.stroke();
  }
  function drawSheep(o, cow) {
    var x = px(o.x), y = py(o.y, 0), u = S * (cow ? 1.25 : 1), f = o.f, bob = Math.abs(Math.sin(NOW * 1.6 + o.v * 20)) * 0.12 * u;
    groundShadow(o.x, o.y, cow ? 1.5 : 1.1, 0.6);
    ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = Math.max(1.2, 0.22 * u); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 0.5 * u, y - 0.5 * u); ctx.lineTo(x - 0.5 * u, y); ctx.moveTo(x + 0.5 * u, y - 0.5 * u); ctx.lineTo(x + 0.5 * u, y); ctx.stroke();
    if (cow) {
      ctx.beginPath(); ctx.ellipse(x, y - 0.95 * u, 1.05 * u, 0.6 * u, 0, 0, 6.3); ctx.fillStyle = '#fbfaf5'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = LW; ctx.stroke();
      ctx.fillStyle = '#33333a';
      ctx.beginPath(); ctx.ellipse(x - 0.35 * u * f, y - 1.05 * u, 0.36 * u, 0.28 * u, 0.4, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 0.4 * u * f, y - 0.8 * u, 0.25 * u, 0.2 * u, 0, 0, 6.3); ctx.fill();
      disc(x + 1.1 * u * f, y - 1.25 * u + bob, 0.42 * u, '#fbfaf5', true);
      disc(x + 1.3 * u * f, y - 1.12 * u + bob, 0.22 * u, '#f5a9b8');
    } else {
      disc(x - 0.45 * u, y - 0.85 * u, 0.55 * u, '#fdfdf8', true); disc(x + 0.4 * u, y - 0.85 * u, 0.55 * u, '#fdfdf8', true);
      disc(x, y - 1.05 * u, 0.62 * u, '#fdfdf8', true); disc(x, y - 0.8 * u, 0.5 * u, '#fdfdf8');
      disc(x + 0.95 * u * f, y - 1.0 * u + bob, 0.34 * u, '#33333a');
    }
  }
  function drawHouse(o) {
    var ux = Math.cos(o.a), uy = Math.sin(o.a), hl = o.hl, hw = o.hw, h = o.h, rh = o.rh, x = o.x, y = o.y;
    var e = uy > 0 ? 1 : -1, ov = 0.45; // e = gaveln som syns från kameran
    groundShadow(x + 1.5, y + 0.5, hl * 1.15, hw * 1.2);
    box(x, y, 0, ux, uy, 0, hl, hw, 0, h, o.roof, o.c, 0);
    function wall(a0, a1, z0, z1, col) { // rektangel på långsidan mot kameran (ux > 0 för alla hus)
      poly([x + ux * a0 - uy * hw, y + uy * a0 + ux * hw, z0, x + ux * a1 - uy * hw, y + uy * a1 + ux * hw, z0,
        x + ux * a1 - uy * hw, y + uy * a1 + ux * hw, z1, x + ux * a0 - uy * hw, y + uy * a0 + ux * hw, z1], col, true);
    }
    if (o.barn) { wall(-1.5, 1.5, 0, 3.2, '#f4f0e4'); wall(-1.3, 1.3, 0, 3.0, '#8e2b23'); }
    else { wall(-0.5, 0.5, 0, 2.0, '#6b4a2e'); wall(-hl + 0.7, -hl + 1.9, 1.1, 2.2, '#bfe9ff'); wall(hl - 1.9, hl - 0.7, 1.1, 2.2, '#bfe9ff'); }
    // gavel, sedan takets bortre och hitre sida
    var gx = x + ux * hl * e, gy = y + uy * hl * e;
    poly([gx - uy * hw, gy + ux * hw, h, gx + uy * hw, gy - ux * hw, h, gx, gy, h + rh], shade(o.c, 0.66 + 0.2 * Math.abs(uy)), true);
    var L = hl + ov, Wd = hw + ov;
    poly([x - ux * L + uy * Wd, y - uy * L - ux * Wd, h - 0.2, x + ux * L + uy * Wd, y + uy * L - ux * Wd, h - 0.2, x + ux * L, y + uy * L, h + rh, x - ux * L, y - uy * L, h + rh], shade(o.roof, 0.75), true);
    poly([x - ux * L - uy * Wd, y - uy * L + ux * Wd, h - 0.2, x + ux * L - uy * Wd, y + uy * L + ux * Wd, h - 0.2, x + ux * L, y + uy * L, h + rh, x - ux * L, y - uy * L, h + rh], o.roof, true);
    if (!o.barn) box(x + ux * hl * 0.45, y + uy * hl * 0.45, 0, ux, uy, 0, 0.4, 0.4, h + rh * 0.55, h + rh + 0.9, '#8b8f99', '#a9584a', 0);
  }
  function drawMill(o) {
    var x = px(o.x), y = py(o.y, 0), u = S, top = y - 8.5 * TZ * u;
    groundShadow(o.x + 1, o.y, 2.6, 1.8);
    ctx.lineWidth = LW; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - 2 * u, y); ctx.lineTo(x + 2 * u, y); ctx.lineTo(x + 1.15 * u, top); ctx.lineTo(x - 1.15 * u, top); ctx.closePath(); ctx.fillStyle = '#f5eeda'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 0.6 * u, y); ctx.lineTo(x + 2 * u, y); ctx.lineTo(x + 1.15 * u, top); ctx.lineTo(x + 0.4 * u, top); ctx.closePath(); ctx.fillStyle = 'rgba(120,100,60,.22)'; ctx.fill();
    ctx.fillStyle = '#6b4a2e'; ctx.beginPath(); ctx.rect(x - 0.5 * u, y - 1.7 * u, 1.0 * u, 1.7 * u); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#bfe9ff'; ctx.beginPath(); ctx.rect(x - 0.35 * u, y - 4.2 * u, 0.7 * u, 0.8 * u); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 1.5 * u, top); ctx.lineTo(x + 1.5 * u, top); ctx.lineTo(x, top - 1.9 * u); ctx.closePath(); ctx.fillStyle = '#c9463a'; ctx.fill(); ctx.stroke();
    var hy = top + 0.2 * u;
    for (var k = 0; k < 4; k++) {
      ctx.save(); ctx.translate(x, hy); ctx.rotate(NOW * 0.7 + o.v * 6 + k * Math.PI / 2);
      ctx.fillStyle = '#fffbe9'; ctx.beginPath(); ctx.rect(0.7 * u, -0.1 * u, 4.6 * u, 1.05 * u); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5.3 * u, 0); ctx.lineWidth = Math.max(1.5, 0.22 * u); ctx.strokeStyle = '#6b4a2e'; ctx.stroke();
      ctx.restore(); ctx.lineWidth = LW; ctx.strokeStyle = INK;
    }
    disc(x, hy, 0.35 * u, '#6b4a2e', true);
  }
  function drawThing(o) {
    switch (o.t) {
      case 'tree': drawTree(o); break;
      case 'bush': drawBush(o); break;
      case 'rock': drawRock(o); break;
      case 'hay': drawHay(o); break;
      case 'sheep': drawSheep(o, false); break;
      case 'cow': drawSheep(o, true); break;
      case 'house': drawHouse(o); break;
      case 'mill': drawMill(o); break;
    }
  }

  /* ----- tåget ----- */

  var WAGON_KINDS = ['coal', 'logs', 'box', 'tank', 'crates'];

  function drawCar(run, i) {
    var c = run.train.cars[i], p = carPose(run, i, {}), w = CFG.physics.warnAt;
    var tint = run.wreck ? 0 : Math.max(0, Math.min(0.75, (c.load - w) / (1 - w) * 0.75));
    var hl = c.len / 2, sg = p.ux > 0 ? 1 : -1, nx = -p.uy * sg, ny = p.ux * sg; // (nx, ny) = sidan mot kameran
    // skugga på marken
    ctx.fillStyle = 'rgba(0,0,0,.24)';
    ctx.beginPath(); ctx.ellipse(px(p.x) + 3, py(p.y, p.z) + 3, (Math.abs(p.ux) * hl + Math.abs(p.uy) * 1.4 + .6) * S, (Math.abs(p.uy) * hl + Math.abs(p.ux) * 1.4 + .6) * S * TY, 0, 0, 6.3); ctx.fill();

    var parts = [];
    // låda: off = läge längs fordonet, lat = sidled, ord = annan lådas off som den står på (styr ritordningen)
    function bx(off, len, hw, z0, z1, top, side, tn, lat, ord) {
      lat = lat || 0;
      var o = ord === undefined ? off : ord, q = { d: o * p.uy + lat * p.ux, z: z1, deco: [], f: function () {
        box(p.x + p.ux * off - p.uy * lat, p.y + p.uy * off + p.ux * lat, p.z + p.sl * off, p.ux, p.uy, p.sl, len / 2, hw, z0, z1, top, side, tn || 0);
      } };
      parts.push(q); return q;
    }
    // rektangel på långsidan mot kameran (fönster, dörrar, ränder)
    function sideRect(part, o0, o1, hw, z0, z1, col) {
      part.deco.push(function () {
        var ax = p.x + p.ux * o0 + nx * hw, ay = p.y + p.uy * o0 + ny * hw, bxx = p.x + p.ux * o1 + nx * hw, by = p.y + p.uy * o1 + ny * hw;
        poly([ax, ay, p.z + p.sl * o0 + z0, bxx, by, p.z + p.sl * o1 + z0, bxx, by, p.z + p.sl * o1 + z1, ax, ay, p.z + p.sl * o0 + z1], col, true);
      });
    }
    // rektangel på gaveln (bara när gaveln vetter mot kameran)
    function endRect(part, off, l0, l1, z0, z1, col) {
      if ((off > 0) !== (p.uy > 0)) return;
      part.deco.push(function () {
        var cx = p.x + p.ux * off, cy = p.y + p.uy * off, cz = p.z + p.sl * off;
        poly([cx - p.uy * l0, cy + p.ux * l0, cz + z0, cx - p.uy * l1, cy + p.ux * l1, cz + z0, cx - p.uy * l1, cy + p.ux * l1, cz + z1, cx - p.uy * l0, cy + p.ux * l0, cz + z1], col, true);
      });
    }
    var wheels = [];
    function wheel(off, r, hub) { wheels.push([off, r, hub]); }

    bx(0, c.len - 0.2, 1.2, 0.35, 0.95, '#2b2e36', '#3a3d47');
    var b, col;
    if (i > 0) {
      col = run.wagonCols[i - 1];
      var kind = WAGON_KINDS[(i - 1) % WAGON_KINDS.length];
      if (kind === 'box') {
        b = bx(0, 5.6, 1.3, 0.95, 2.85, shade(col, 0.9), col, tint);
        sideRect(b, -0.9, 0.9, 1.31, 1.1, 2.7, shade(col, 0.72));
        bx(0, 5.8, 1.42, 2.85, 3.02, '#e3ded0', '#aaa59a', tint);
      } else if (kind === 'coal') {
        b = bx(0, 5.6, 1.3, 0.95, 2.1, '#25262b', col, tint);
        sideRect(b, -2.6, -2.35, 1.31, 0.95, 2.1, shade(col, 0.7)); sideRect(b, -0.12, 0.12, 1.31, 0.95, 2.1, shade(col, 0.7)); sideRect(b, 2.35, 2.6, 1.31, 0.95, 2.1, shade(col, 0.7));
        bx(0, 4.7, 0.95, 2.1, 2.4, '#3a3b42', '#25262b', 0);
        bx(0.3, 2.6, 0.55, 2.4, 2.66, '#474851', '#2e2f35', 0);
      } else if (kind === 'logs') {
        bx(0, 5.6, 1.3, 0.95, 1.15, '#6b4a2e', col, tint);
        [-0.8, 0, 0.8].forEach(function (lat) { bx(0, 5.3, 0.37, 1.15, 1.88, '#c08a4c', '#8f5f2e', 0, lat); });
        [-0.4, 0.4].forEach(function (lat) { bx(0, 5.0, 0.37, 1.88, 2.6, '#cc9658', '#99682f', 0, lat); });
      } else if (kind === 'tank') {
        b = bx(0, 5.2, 1.08, 1.0, 2.5, '#f2f4f7', '#d3d8df', tint);
        sideRect(b, -0.7, 0.7, 1.09, 1.0, 2.5, col);
        bx(0, 5.2, 0.55, 2.5, 2.7, '#ffffff', '#e6eaef', 0);
        bx(0, 0.9, 0.42, 2.7, 3.02, '#8d929b', '#6f747d', 0);
      } else {
        bx(0, 5.6, 1.3, 0.95, 1.15, '#6b4a2e', col, tint);
        b = bx(-1.6, 2.2, 1.05, 1.15, 2.55, '#f0b95a', '#d19a35', 0); sideRect(b, -2.5, -0.7, 1.06, 1.75, 1.95, '#a9772a');
        b = bx(1.0, 2.4, 1.1, 1.15, 2.25, '#7fc0e6', '#5a9fc8', 0); sideRect(b, 0.0, 2.0, 1.11, 1.6, 1.8, '#3f7fa8');
        bx(1.0, 1.3, 0.65, 2.25, 2.95, '#f08a7d', '#d2685c', 0);
      }
      wheel(-2.25, 0.44, '#9aa0aa'); wheel(-1.35, 0.44, '#9aa0aa'); wheel(1.35, 0.44, '#9aa0aa'); wheel(2.25, 0.44, '#9aa0aa');
    } else {
      col = run.spec.color || '#2f6b3a';
      var st = run.spec.style, dark = '#23252b', glass = '#bfe9ff';
      if (st === 'steam') {
        b = bx(-2.9, 2.8, 1.35, 0.95, 3.15, shade(col, 0.85), col, tint);                       // hytt
        sideRect(b, -3.75, -2.05, 1.36, 2.0, 2.85, glass);
        bx(-2.9, 3.4, 1.52, 3.15, 3.36, '#454955', '#2b2e36', 0);                                // hyttens tak
        b = bx(1.25, 5.5, 1.0, 0.95, 2.55, shade(col, 1.15), col, tint);                         // panna
        [-0.6, 1.2, 3.0].forEach(function (o) { sideRect(b, o - 0.1, o + 0.1, 1.01, 0.95, 2.55, '#f1cf55'); });
        bx(1.25, 5.5, 0.5, 2.55, 2.74, shade(col, 1.45), shade(col, 1.2), tint);                 // pannans rundade topp
        b = bx(4.15, 0.55, 1.03, 0.95, 2.58, '#2e3038', dark, 0);                                // rökskåp
        endRect(b, 4.43, -0.32, 0.32, 1.85, 2.4, '#ffe98a');                                     // lykta
        bx(3.35, 0.7, 0.36, 2.74, 3.75, '#1c1d22', '#2c2e35', 0, 0, 1.25);                       // skorsten
        bx(3.35, 0.98, 0.5, 3.75, 3.95, '#3a3d47', dark, 0, 0, 1.25);
        bx(1.15, 0.9, 0.42, 2.74, 3.18, '#f6d968', '#cfa92f', 0, 0, 1.25);                       // dom
        bx(4.6, 0.45, 1.15, 0.15, 0.85, '#e0564a', '#b83a30', 0);                                // kofångare
        wheel(-3.3, 0.46, '#e0564a'); wheel(-1.7, 0.7, '#e0564a'); wheel(-0.1, 0.7, '#e0564a'); wheel(1.5, 0.7, '#e0564a'); wheel(3.1, 0.44, '#e0564a'); wheel(3.95, 0.44, '#e0564a');
      } else if (st === 'diesel') {
        b = bx(-1.2, 6.2, 1.1, 0.95, 2.55, shade(col, 1.18), col, tint);                         // motorhuv
        sideRect(b, -4.25, 1.85, 1.11, 1.45, 1.75, '#fff6d8');
        [-3.5, -2.5, -1.5].forEach(function (o) { sideRect(b, o - 0.3, o + 0.3, 1.11, 1.9, 2.4, '#3a3d47'); });
        bx(-0.6, 1.5, 0.6, 2.55, 2.68, '#454955', '#2b2e36', 0, 0, -1.2);                        // fläkt
        bx(-2.6, 0.6, 0.3, 2.55, 3.05, '#1c1d22', '#2c2e35', 0, 0, -1.2);                        // avgasrör
        b = bx(3.05, 2.6, 1.35, 0.95, 3.15, '#f6f1df', col, tint);                               // hytt
        sideRect(b, 2.1, 4.0, 1.36, 2.05, 2.9, glass);
        endRect(b, 4.35, -1.05, 1.05, 2.05, 2.9, glass); endRect(b, 4.35, -1.0, -0.5, 1.15, 1.5, '#ffe98a'); endRect(b, 4.35, 0.5, 1.0, 1.15, 1.5, '#ffe98a');
        bx(3.05, 2.9, 1.47, 3.15, 3.33, '#454955', '#2b2e36', 0);
        wheel(-3.3, 0.5, '#c9ccd3'); wheel(-2.2, 0.5, '#c9ccd3'); wheel(2.2, 0.5, '#c9ccd3'); wheel(3.3, 0.5, '#c9ccd3');
      } else {
        b = bx(0, 8.6, 1.3, 0.95, 3.0, shade(col, 1.2), col, tint);                              // kaross
        sideRect(b, -4.3, 4.3, 1.31, 1.3, 1.62, '#fff6d8');
        [-2.7, -1.5, -0.3, 0.9].forEach(function (o) { sideRect(b, o - 0.4, o + 0.4, 1.31, 2.05, 2.7, glass); });
        sideRect(b, 2.9, 4.0, 1.31, 2.0, 2.75, glass);
        endRect(b, 4.3, -1.0, 1.0, 2.0, 2.8, glass); endRect(b, 4.3, -1.0, -0.5, 1.15, 1.5, '#ffe98a'); endRect(b, 4.3, 0.5, 1.0, 1.15, 1.5, '#ffe98a');
        b = bx(0, 8.0, 1.0, 3.0, 3.16, '#a7adb8', '#7d828c', 0);                                 // tak
        b.deco.push(function () {                                                                // strömavtagare
          ctx.strokeStyle = '#2b2e36'; ctx.lineWidth = Math.max(1.5, 0.2 * S); ctx.lineCap = 'round'; ctx.beginPath();
          var o0 = -1.6, o1 = -0.6, o2 = 0.4;
          ctx.moveTo(px(p.x + p.ux * o0), py(p.y + p.uy * o0, p.z + 3.16)); ctx.lineTo(px(p.x + p.ux * o1), py(p.y + p.uy * o1, p.z + 4.1)); ctx.lineTo(px(p.x + p.ux * o2), py(p.y + p.uy * o2, p.z + 3.16));
          ctx.moveTo(px(p.x + p.ux * o1 - p.uy * 0.9), py(p.y + p.uy * o1 + p.ux * 0.9, p.z + 4.1)); ctx.lineTo(px(p.x + p.ux * o1 + p.uy * 0.9), py(p.y + p.uy * o1 - p.ux * 0.9, p.z + 4.1));
          ctx.stroke();
        });
        wheel(-3.3, 0.5, '#c9ccd3'); wheel(-2.2, 0.5, '#c9ccd3'); wheel(2.2, 0.5, '#c9ccd3'); wheel(3.3, 0.5, '#c9ccd3');
      }
    }
    // delarna längst från kameran först, lägre delar före högre
    parts.sort(function (a, b2) { return (a.d - b2.d) || (a.z - b2.z); });
    parts.forEach(function (q) { q.f(); for (var n = 0; n < q.deco.length; n++) q.deco[n](); });
    // hjulen på sidan mot kameran; ekern snurrar med farten
    for (var n = 0; n < wheels.length; n++) {
      var off = wheels[n][0], r = wheels[n][1];
      var cx = px(p.x + p.ux * off + nx * 1.27), cy = py(p.y + p.uy * off + ny * 1.27, p.z + p.sl * off + r + 0.04);
      var ax = p.ux * S * r, ay = p.uy * TY * S * r, by = -TZ * S * r;
      ctx.save(); ctx.transform(ax, ay, 0, by, cx, cy); ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.3); ctx.restore();
      ctx.fillStyle = '#1d1f25'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = LW; ctx.stroke();
      ctx.save(); ctx.transform(ax, ay, 0, by, cx, cy); ctx.beginPath(); ctx.arc(0, 0, 0.6, 0, 6.3); ctx.restore();
      ctx.fillStyle = wheels[n][2]; ctx.fill();
      var ph = c.s / r, co = Math.cos(ph) * 0.6, si = Math.sin(ph) * 0.6;
      ctx.strokeStyle = '#1d1f25'; ctx.lineWidth = Math.max(1, 0.12 * S); ctx.beginPath();
      ctx.moveTo(cx - ax * co, cy - ay * co - by * si); ctx.lineTo(cx + ax * co, cy + ay * co + by * si);
      ctx.moveTo(cx + ax * si, cy + ay * si - by * co); ctx.lineTo(cx - ax * si, cy - ay * si + by * co); ctx.stroke();
    }
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

  // Målflagga på en stolpe bredvid start- och mållinjen (alltid vänd mot kameran).
  function drawGate(tr) {
    var p = tr.at(0, P1), sd = p.tx > 0 ? -1 : 1, fx = p.x - p.ty * 4.2 * sd, fy = p.y + p.tx * 4.2 * sd;
    var x = px(fx), y0 = py(fy, p.z), y1 = py(fy, p.z + 7.5), c = 0.75 * S, wave = Math.sin(NOW * 3) * 0.12 * S;
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x + 2, y0, 1.1 * S, .5 * S, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#2b2e36'; ctx.lineWidth = Math.max(3, .46 * S); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    ctx.strokeStyle = '#f4f6f9'; ctx.lineWidth = Math.max(2, .28 * S); ctx.stroke();
    for (var r = 0; r < 3; r++) for (var i = 0; i < 4; i++) {
      ctx.fillStyle = (i + r) % 2 ? '#111' : '#fff'; ctx.fillRect(x + i * c, y1 + r * c + wave * i / 3, c + .5, c + .5);
    }
    ctx.strokeStyle = INK; ctx.lineWidth = LW; ctx.strokeRect(x, y1, 4 * c, 3 * c + wave);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!run) { ctx.fillStyle = '#62b54a'; ctx.fillRect(0, 0, W, H); return; }
    var data = run.data, tr = data.tr, N = tr.N, span = data.span, i, k, cam = run.cam;
    S = W / ((CFG.view && CFG.view.meters) || 150);
    LW = Math.max(1, 0.14 * S);
    var shx = run.shake ? (Math.random() - .5) * run.shake * 14 : 0, shy = run.shake ? (Math.random() - .5) * run.shake * 14 : 0;
    OX = W / 2 - cam.x * S + shx; OY = H * 0.56 - (cam.y * TY - cam.z * TZ) * S + shy;

    drawGround();

    // landskapets föremål i de rutor som syns: dammar ligger på marken, resten sorteras in bland fordonen
    var items = [], ca = Math.floor((-OX / S - 14) / CELL), cb = Math.floor(((W - OX) / S + 14) / CELL);
    var ra = Math.floor((-OY / S / TY - 8) / CELL), rb = Math.floor(((H - OY) / S / TY + 16) / CELL);
    for (i = ca; i <= cb; i++) for (k = ra; k <= rb; k++) {
      var cell = data.cells[i + ',' + k];
      if (!cell) continue;
      for (var n = 0; n < cell.length; n++) { if (cell[n].g) drawPond(cell[n]); else items.push([cell[n].y, 0, cell[n]]); }
    }

    function vis(q) { var sx = px(tr.x[q]), sy = py(tr.y[q], tr.z[q]); return sx > -60 && sx < W + 60 && sy > -60 && sy < H + 120; }
    function quad(q, z, grow) {
      var m = (q + 1) % N, w = BW + grow, ax = -tr.ty[q] * w, ay = tr.tx[q] * w, bx = -tr.ty[m] * w, by = tr.tx[m] * w;
      var zk = z ? tr.z[q] : 0, zm = z ? tr.z[m] : 0;
      ctx.moveTo(px(tr.x[q] + ax), py(tr.y[q] + ay, zk)); ctx.lineTo(px(tr.x[m] + bx), py(tr.y[m] + by, zm));
      ctx.lineTo(px(tr.x[m] - bx), py(tr.y[m] - by, zm)); ctx.lineTo(px(tr.x[q] - ax), py(tr.y[q] - ay, zk)); ctx.closePath();
    }
    // banvall under ett spårstycke som ligger högt: jordfyllning (eller gräskulle över en tunnel) och ballast överst
    function embank(q, grass, wide) {
      var m = (q + 1) % N, zz = tr.z[q], zm = tr.z[m], sp = 0.5 + zz * (0.45 + (HILL - 0.45) * (wide || 0)); // släntens bredd växer med höjden
      ctx.fillStyle = grass ? '#3f8f3c' : '#7a6243'; ctx.beginPath();
      quad(q, false, sp);
      var w0 = BW + sp, w1 = BW;
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        ctx.moveTo(px(tr.x[q] - tr.ty[q] * w0 * sgn), py(tr.y[q] + tr.tx[q] * w0 * sgn, 0)); ctx.lineTo(px(tr.x[m] - tr.ty[m] * w0 * sgn), py(tr.y[m] + tr.tx[m] * w0 * sgn, 0));
        ctx.lineTo(px(tr.x[m] - tr.ty[m] * w1 * sgn), py(tr.y[m] + tr.tx[m] * w1 * sgn, zm)); ctx.lineTo(px(tr.x[q] - tr.ty[q] * w1 * sgn), py(tr.y[q] + tr.tx[q] * w1 * sgn, zz)); ctx.closePath();
      }
      ctx.fill();
      var sg2 = tr.tx[q] > 0 ? 1 : -1; // slänten som vetter mot kameran lite ljusare
      ctx.fillStyle = grass ? '#55a84a' : '#a08458'; ctx.beginPath();
      ctx.moveTo(px(tr.x[q] - tr.ty[q] * w0 * sg2), py(tr.y[q] + tr.tx[q] * w0 * sg2, 0)); ctx.lineTo(px(tr.x[m] - tr.ty[m] * w0 * sg2), py(tr.y[m] + tr.tx[m] * w0 * sg2, 0));
      ctx.lineTo(px(tr.x[m] - tr.ty[m] * w1 * sg2), py(tr.y[m] + tr.tx[m] * w1 * sg2, zm)); ctx.lineTo(px(tr.x[q] - tr.ty[q] * w1 * sg2), py(tr.y[q] + tr.tx[q] * w1 * sg2, zz)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d2c6ad'; ctx.beginPath(); quad(q, true, 0); ctx.fill();
    }
    // slipers och räls för punkterna from .. from+count som klarar test
    function rails(from, count, test) {
      var q, m;
      ctx.strokeStyle = '#7a5836'; ctx.lineWidth = Math.max(1.5, 0.46 * S); ctx.lineCap = 'butt'; ctx.beginPath();
      for (m = 0; m < count; m++) {
        q = ((from + m) % N + N) % N;
        if (q % 2 || !test(q) || !vis(q)) continue;
        ctx.moveTo(px(tr.x[q] - tr.ty[q] * 1.45), py(tr.y[q] + tr.tx[q] * 1.45, tr.z[q])); ctx.lineTo(px(tr.x[q] + tr.ty[q] * 1.45), py(tr.y[q] - tr.tx[q] * 1.45, tr.z[q]));
      }
      ctx.stroke();
      ctx.lineJoin = 'round';
      for (var pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? '#eef1f5' : '#3d424c';
        ctx.lineWidth = pass ? Math.max(1, 0.18 * S) : Math.max(2.2, 0.42 * S);
        for (var sd = -1; sd <= 1; sd += 2) {
          ctx.beginPath(); var pen = false;
          for (m = 0; m <= count; m++) {
            q = ((from + m) % N + N) % N;
            if (!test(q) || !vis(q)) { pen = false; continue; }
            var rx = px(tr.x[q] - tr.ty[q] * .8 * sd), ry = py(tr.y[q] + tr.tx[q] * .8 * sd, tr.z[q] + .12);
            if (pen) ctx.lineTo(rx, ry); else { ctx.moveTo(rx, ry); pen = true; }
          }
          ctx.stroke();
        }
      }
    }
    function notSpan(q) { return !span[q]; }
    function always() { return true; }

    // 1. allt spår utom spannen över korsningar: banvall bortifrån och framåt, ballast, slipers, räls
    if (tr.maxZ > 0.15) for (var o = 0; o < data.order.length; o++) { i = data.order[o]; if (tr.z[i] >= 0.12 && vis(i)) embank(i, false); }
    ctx.fillStyle = '#a3957b'; ctx.beginPath();
    for (i = 0; i < N; i++) if (!span[i] && tr.z[i] < 0.12 && vis(i)) quad(i, true, 0.32);
    ctx.fill();
    ctx.fillStyle = '#d2c6ad'; ctx.beginPath();
    for (i = 0; i < N; i++) if (!span[i] && tr.z[i] < 0.12 && vis(i)) quad(i, true, 0);
    ctx.fill();
    // start- och mållinje
    var g0 = tr.at(0, P1);
    for (i = 0; i < 6; i++) {
      var fa = -1 + i / 3, fb = fa + 1 / 3;
      ctx.fillStyle = i % 2 ? '#111' : '#fff'; ctx.beginPath();
      ctx.moveTo(px(g0.x - g0.ty * BW * fa - g0.tx * .5), py(g0.y + g0.tx * BW * fa - g0.ty * .5, g0.z)); ctx.lineTo(px(g0.x - g0.ty * BW * fb - g0.tx * .5), py(g0.y + g0.tx * BW * fb - g0.ty * .5, g0.z));
      ctx.lineTo(px(g0.x - g0.ty * BW * fb + g0.tx * .5), py(g0.y + g0.tx * BW * fb + g0.ty * .5, g0.z)); ctx.lineTo(px(g0.x - g0.ty * BW * fa + g0.tx * .5), py(g0.y + g0.tx * BW * fa + g0.ty * .5, g0.z)); ctx.closePath(); ctx.fill();
    }
    rails(0, N, notSpan);

    // 2. föremål sorterade bortifrån och framåt: landskap, målflagga, fordon och fjädrar.
    //    Fordon som står på en bro eller tunnelkulle väntar till steg 4.
    var cars = run.train.cars, pose = {}, high = [], late = [], gy = g0.y;
    for (i = 0; i < cars.length; i++) {
      high[i] = false;
      for (k = -1; k <= 1 && data.spans.length; k++) {
        var u = (((cars[i].s + k * cars[i].len * 0.5) % tr.L) + tr.L) % tr.L;
        if (span[Math.floor(u / tr.ds) % N]) high[i] = true;
      }
    }
    items.push([gy, 1, null]);
    for (i = 0; i < cars.length; i++) {
      carPose(run, i, pose);
      (high[i] ? late : items).push([pose.y, 2, i]);
      if (i < cars.length - 1) { var y2 = carPose(run, i + 1, P2).y; (high[i] || high[i + 1] ? late : items).push([(pose.y + y2) / 2 - 0.01, 3, i]); }
    }
    function byY(a, b) { return a[0] - b[0]; }
    function drawItems(list) {
      list.sort(byY);
      for (var q = 0; q < list.length; q++) {
        var it = list[q];
        if (it[1] === 0) drawThing(it[2]); else if (it[1] === 1) drawGate(tr); else if (it[1] === 2) drawCar(run, it[2]); else drawSpring(run, it[2]);
      }
    }
    drawItems(items);

    // 3. spannen: bro (pelare, balk, däck) eller tunnel (gräskulle med stenmynningar) över det undre spåret
    data.spans.forEach(function (sp) {
      var L = sp.list, e0 = L[0], e1 = L[L.length - 1], q, m;
      if (!vis(sp.c.hi) && !vis(e0) && !vis(e1)) return;
      if (sp.kind === 1) {
        ctx.fillStyle = 'rgba(0,20,10,.2)'; ctx.beginPath(); for (m = 0; m < L.length; m++) quad(L[m], false, 0.3); ctx.fill();
        [e0, e1].sort(function (a, b) { return tr.y[a] - tr.y[b]; }).forEach(function (e) {
          box(tr.x[e], tr.y[e], 0, tr.tx[e], tr.ty[e], 0, 1.3, BW + 0.9, 0, tr.z[e] + 0.06, '#cfc9bd', '#a9a39a', 0);
        });
        // balkarna: först den bortre, sedan däcket, sist den som vetter mot kameran
        for (var pass = 0; pass < 2; pass++) {
          if (pass) {
            ctx.fillStyle = '#8a5a3a'; ctx.beginPath(); for (m = 0; m < L.length; m++) quad(L[m], true, 0.45); ctx.fill();
            ctx.fillStyle = '#d2c6ad'; ctx.beginPath(); for (m = 0; m < L.length; m++) quad(L[m], true, 0); ctx.fill();
          }
          for (m = 0; m < L.length - 1; m++) {
            q = L[m]; var q2 = L[m + 1], sgn = (tr.tx[q] > 0 ? 1 : -1) * (pass ? 1 : -1), wg = BW + 0.45;
            var ax = tr.x[q] - tr.ty[q] * wg * sgn, ay = tr.y[q] + tr.tx[q] * wg * sgn, bx2 = tr.x[q2] - tr.ty[q2] * wg * sgn, by2 = tr.y[q2] + tr.tx[q2] * wg * sgn;
            poly([ax, ay, tr.z[q] - 1.3, bx2, by2, tr.z[q2] - 1.3, bx2, by2, tr.z[q2] + 0.05, ax, ay, tr.z[q] + 0.05], pass ? '#d4483b' : '#9c3229', false);
            if (pass && m % 3 === 0) poly([ax, ay, tr.z[q] - 1.3, ax, ay, tr.z[q] + 0.05], null, 'rgba(60,15,10,.6)');
          }
        }
        rails(e0 - 1, L.length + 1, always);
      } else {
        // kullen bortifrån och framåt, med stenmynningarna instuckna på sin plats i ordningen
        var pi = 0, hw = 2.7, ht = 4.9;
        function portalBox(po) { box(po.x, po.y, po.z, po.dx, po.dy, 0, po.hl, hw, 0, ht, '#c3c6cd', '#a3a7b0', 0); }
        for (m = 0; m < sp.order.length; m++) {
          q = sp.order[m];
          while (pi < sp.portals.length && sp.portals[pi].y < tr.y[q]) portalBox(sp.portals[pi++]);
          var idx = (q - e0 + N) % N;
          embank(q, true, Math.min(1, Math.min(idx, L.length - 1 - idx) / 7));
        }
        while (pi < sp.portals.length) portalBox(sp.portals[pi++]);
        rails(e0 - 1, L.length + 1, always);
        sp.portals.forEach(function (po) {
          if (po.dy <= 0.05) return;
          // mynningen på gaveln mot kameran, och fordonen i den ritas om inuti öppningen
          var fx = po.x + po.dx * po.hl, fy = po.y + po.dy * po.hl, nx = -po.dy, ny = po.dx, a, pts = [];
          pts.push(fx - nx * 1.85, fy - ny * 1.85, po.z);
          for (a = 0; a <= 8; a++) { var an = Math.PI - a * Math.PI / 8; pts.push(fx + nx * 1.85 * Math.cos(an), fy + ny * 1.85 * Math.cos(an), po.z + 2.6 + 1.85 * Math.sin(an)); }
          pts.push(fx + nx * 1.85, fy + ny * 1.85, po.z);
          poly(pts, '#12141a', true);
          ctx.save(); ctx.beginPath();
          var far = 24, c8 = [];
          [[0, 1.9], [far, 4.2]].forEach(function (d) {
            [-1, 1].forEach(function (s2) { [0, 4.6].forEach(function (zz) {
              c8.push([px(fx + po.dx * d[0] + nx * d[1] * s2), py(fy + po.dy * d[0] + ny * d[1] * s2, po.z + zz)]);
            }); });
          });
          hull(c8); ctx.clip();
          for (m = 0; m < cars.length; m++) {
            if (high[m]) continue;
            carPose(run, m, pose);
            if (Math.hypot(pose.x - po.x, pose.y - po.y) > 34) continue;
            if (m > 0 && !high[m - 1]) drawSpring(run, m - 1);
            drawCar(run, m);
          }
          ctx.restore();
        });
      }
    });

    // 4. fordon uppe på spannen
    drawItems(late);

    // rök, gnistor, damm
    for (i = 0; i < run.parts.length; i++) {
      var pq = run.parts[i], fl = pq.life / pq.max;
      ctx.globalAlpha = (1 - fl) * (pq.a || 0.8); ctx.fillStyle = pq.col;
      ctx.beginPath(); ctx.arc(px(pq.x), py(pq.y, pq.z), (pq.size + pq.grow * fl) * S, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // molnskuggor som sakta driver över landskapet
    ctx.fillStyle = 'rgba(10,40,60,.07)';
    for (i = 0; i < 4; i++) {
      var mx0 = cam.x + ((((i * 173 + NOW * 4 - cam.x) % 460) + 460) % 460) - 230, my0 = cam.y + ((((i * 97 + NOW * 1.4 - cam.y) % 320) + 320) % 320) - 160;
      ctx.beginPath(); ctx.ellipse(px(mx0), py(my0, 0), 40 * S, 22 * S * TY, 0, 0, 6.3); ctx.ellipse(px(mx0 + 30), py(my0 + 8, 0), 28 * S, 16 * S * TY, 0, 0, 6.3); ctx.fill();
    }

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

  // Lägger det konvexa höljet av skärmpunkterna som bana i ctx (används som urklipp vid tunnelmynningar).
  function hull(pts) {
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    var h = lo.slice(0, -1).concat(up.slice(0, -1));
    for (i = 0; i < h.length; i++) { if (i) ctx.lineTo(h[i][0], h[i][1]); else ctx.moveTo(h[i][0], h[i][1]); }
    ctx.closePath();
  }

  /* ---------- huvudslinga och start ---------- */

  var last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; NOW = t / 1000;
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
    // Nollställning under utprovningen (Dick 2026-11-19): pengar, tåg, uppgraderingar, tider och öppnade banor försvinner.
    // Visas bara när inställningen testReset är på. Två tryck, eftersom WebView saknar confirm().
    var resetArmed = false;
    function resetLabel() { $('bReset').textContent = resetArmed ? 'Tap again to erase coins, trains, upgrades and unlocked tracks' : 'Reset progress (testing)'; }
    $('bInfo').onclick = function () { resetArmed = false; resetLabel(); $('resetBox').hidden = !CFG.testReset; show('sInfo'); };
    $('bReset').onclick = function () {
      if (!resetArmed) { resetArmed = true; resetLabel(); return; }
      save = { money: null, train: null, owned: {}, best: {}, stars: {}, sound: save.sound };
      fixSave(); persist(); showMenu();
    };
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
        var pos = +Q.get('pos') || 0;
        if (pos) { run.count = 0; run.train.cars.forEach(function (c) { c.s += pos; }); run.hold = Q.get('hold') === '1'; var pp = run.data.tr.at(pos); run.cam.x = pp.x; run.cam.y = pp.y; run.cam.z = pp.z; }
        var find = Q.get('find'); // provläge &find=house|mill|pond|sheep|cow: kameran ställs vid första föremålet av den sorten
        if (find) { run.count = 0; run.hold = true; run.findCam = null; for (var ck in run.data.cells) run.data.cells[ck].forEach(function (o) { if (o.t === find && !run.findCam) run.findCam = o; }); }
        var warp = +Q.get('warp') || 0;
        if (warp) { run.count = 0; for (var n = 0; n < warp * 60 && mode === 'play'; n++) update(1 / 60); }
      }
      else { showMenu(); if (sc === 'shop') showShop(); else if (sc === 'levels') showLevels(); else if (sc === 'info') show('sInfo'); }
    });
  }
  init();
})();
