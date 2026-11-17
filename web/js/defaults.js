/* Spring Train – inbyggda standardinställningar.
 *
 * Samma struktur som admin på gr8eam.com/springtrain/ sparar. Vid start hämtar appen serverns inställningar och
 * lägger dem ovanpå de här (objekt slås ihop nyckel för nyckel, listor som trains och levels ersätts helt).
 * Filen kopieras också till servern, där adminsidan använder den som utgångsläge och för "Återställ".
 *
 * Enheter: massa i ton, kraft i kN, effekt i kW, längder i meter, tider i sekunder.
 */
(function (root) {
  'use strict';

  // Banans kontrollpunkter ur en "rund" beskrivning: radier jämnt fördelade runt ett varv, utdragna i x-led.
  // Formen korsar aldrig sig själv. z = höjd över marken vid varje punkt.
  function ring(r, sx, sy, z) {
    var pts = [], n = r.length;
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * i / n - Math.PI / 2;
      pts.push([Math.round(r[i] * Math.cos(a) * sx * 10) / 10, Math.round(r[i] * Math.sin(a) * sy * 10) / 10, z ? z[i] : 0]);
    }
    return pts;
  }

  // En åtta (liggande): bredd 2a, höjd b, n punkter. Spåret korsar sig självt i mitten. lift = höjden på det ena
  // spåret i korsningen (0 = korsning i samma plan, minst 4.5 = bro eller tunnel).
  function eight(a, b, n, lift) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = 2 * Math.PI * i / n + 3.9;
      pts.push([Math.round(a * Math.cos(t) * 10) / 10, Math.round(b * Math.sin(2 * t) * 10) / 10,
        Math.round((lift || 0) * (0.5 + 0.5 * Math.sin(t)) * 10) / 10]);
    }
    return pts;
  }

  var D = {
    version: 1,
    // Visas på startskärmen om den inte är tom (nyheter, hälsning).
    message: '',
    // true = alla banor öppna från början (för test).
    unlockAll: false,

    physics: {
      springK: 50,        // fjäderns styvhet utan uppgradering, kN per meter (mjukast)
      springDamp: 8,      // fjäderns dämpning, kN per (m/s)
      springRest: 2.8,    // avstånd mellan fordonen när fjädern vilar, m
      springTravel: 1.8,  // hur långt teleskopet kan dras ut eller tryckas ihop från viloläget, m
      stopBounce: 0.2,    // studs när teleskopet slår i stoppet (0 = ingen, 1 = full)
      rolling: 0.004,     // rullmotstånd (andel av tyngden)
      drag: 6,            // luftmotstånd per fordon, N per (m/s)²
      gravity: 9.81,
      derailG: 12,        // sidkraft (m/s²) där fordonet spårar ur
      derailGrace: 0.25,  // så länge (s) får gränsen överskridas innan det spårar ur
      warnAt: 0.75,       // andel av gränsen där varningen börjar
      wagonMass: 25       // vagnens vikt, ton (kan sättas per bana)
    },

    view: {
      meters: 120         // så många meter av världen som ryms på skärmens bredd
    },

    economy: {
      startMoney: 0,
      upgradeBase: 250,       // pris för första uppgraderingen
      upgradeGrowth: 1.7,     // varje nästa nivå kostar så många gånger mer
      engineStep: 0.15,       // motorn blir så mycket starkare per nivå (0.15 = 15 %)
      brakeStep: 0.15,
      springStep: 0.4,        // fjädrarna blir så mycket styvare per köpt nivå (0.4 = 40 % av grundstyvheten)
      maxLevel: 5,
      starMult: [1, 1.5, 2, 3], // utbetalning × banans belöning vid 0, 1, 2 och 3 stjärnor
      derailLapPay: 0.1       // andel av belöningen per avklarat varv om man spårar ur
    },

    trains: [
      { id: 'puffer', name: 'Old Puffer', style: 'steam', color: '#2466b0', price: 0, power: 1000, force: 150, brake: 160, mass: 40 },
      { id: 'bull', name: 'Diesel Bull', style: 'diesel', color: '#e08a1e', price: 2500, power: 1400, force: 190, brake: 210, mass: 48 },
      { id: 'arrow', name: 'Volt Arrow', style: 'electric', color: '#d23b3b', price: 8000, power: 1900, force: 230, brake: 270, mass: 44 }
    ],

    // par = tider (s) för 3, 2 och 1 stjärna. Räknas fram med tools/calibrate.js.
    // crossing = hur en korsning i olika plan ritas: 'bridge' (standard) eller 'tunnel'.
    levels: [
      { id: 'meadow', name: 'Meadow Loop', laps: 5, wagons: 2, reward: 200, par: [123, 137, 159],
        points: ring([62, 63, 61, 62, 64, 62, 62, 63, 61, 62, 64, 62], 1.32, 1) },
      { id: 'bends', name: 'Twin Bends', laps: 5, wagons: 2, reward: 300, par: [159, 178, 207],
        points: ring([64, 68, 62, 66, 70, 64, 59, 64, 69, 62, 58, 63, 68, 63], 1.45, 1) },
      { id: 'cross', name: 'Crossroads', laps: 5, wagons: 3, reward: 380, par: [178, 199, 231],
        points: eight(105, 40, 16, 0) },
      { id: 'hills', name: 'Rolling Hills', laps: 5, wagons: 3, reward: 450, par: [167, 187, 217],
        points: ring([68, 71, 66, 70, 74, 68, 64, 68, 72, 67, 64, 68, 71, 67], 1.5, 1,
          [0, 0, 0.8, 2, 3, 3, 2, 0.8, 0, 0, 1, 2.2, 2.2, 1]) },
      { id: 'hairpin', name: 'Hairpin Valley', laps: 5, wagons: 3, reward: 650, par: [197, 221, 256],
        points: ring([72, 74, 73, 68, 60, 66, 73, 75, 72, 70, 73, 75, 68, 60, 66, 73, 75, 73], 1.55, 1,
          [3, 3, 2.4, 1.2, 0.3, 0, 0, 0.6, 1.6, 2.6, 3, 2.4, 1.4, 0.6, 0.6, 1.4, 2.4, 3]) },
      { id: 'flyover', name: 'Flyover Eight', laps: 5, wagons: 4, reward: 780, par: [194, 217, 252], crossing: 'bridge',
        points: eight(120, 45, 16, 6) },
      { id: 'pass', name: 'Mountain Pass', laps: 5, wagons: 4, reward: 900, par: [224, 251, 291],
        points: ring([76, 80, 74, 78, 82, 76, 70, 76, 81, 76, 70, 76, 82, 77, 72, 77], 1.6, 1.05,
          [0, 0, 1.2, 3, 5, 6.5, 6.5, 5, 3, 1.2, 0, 0, 1.5, 3.2, 3.2, 1.5]) },
      { id: 'haul', name: 'Long Haul', laps: 5, wagons: 5, reward: 1300, par: [256, 287, 333],
        points: ring([86, 90, 84, 88, 92, 84, 78, 86, 92, 86, 80, 86, 92, 84, 76, 84, 91, 86, 82, 86], 1.65, 1.05,
          [0, 0, 0.8, 2, 3.4, 4.2, 4.2, 3.4, 2, 0.8, 0, 0, 1.2, 2.8, 4.4, 5.2, 4.4, 2.8, 1.2, 0]) },
      { id: 'burrow', name: 'Tunnel Hill', laps: 5, wagons: 5, reward: 1500, par: [219, 245, 285], crossing: 'tunnel',
        points: eight(135, 50, 18, 6.5) }
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
  else root.ST_DEFAULTS = D;
})(this);
