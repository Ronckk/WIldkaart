/* Wilde Dieren in Kaart — risicomodel voor de voorspellingspagina (assets/risk-model.js)
 *
 * Rekent uit de wolvenmeldingen uit waar de komende week de meeste kans is op een nieuwe melding. Geen kunstmatige
 * intelligentie, maar een eenvoudige en uitlegbare dichtheidsschatting:
 *
 *   1. Elke melding telt mee met een gewicht naar type (aanval 2, jonkies 1,5, zicht 1, overig 0,5): bij een aanval is zeker
 *      dat er een wolf was én dat hij vee heeft gevonden, waar hij vaak terugkomt.
 *   2. Dat gewicht halveert elke 21 dagen: de wolf trekt rond, een melding van vorige maand zegt minder dan die van gisteren.
 *   3. Elke melding straalt uit over de omgeving (een zachte klok, 6 km breed): een wolf legt makkelijk een paar kilometer
 *      af, dus naast een melding is de kans ook hoog.
 *   4. Dat wordt opgeteld voor elk vak van 5 x 5 km en omgerekend naar een aandeel: "welk deel van de meldingen van volgende
 *      week verwachten we in dit vak". Alle vakken samen zijn 100%.
 *   5. De vakken met samen 30% van de kans zijn het kerngebied, tot 60% het waarschijnlijke gebied en tot 85% het ruime gebied.
 *
 * Elke aanname staat in PARAMS. `backtest` toetst het model aan het verleden: voor elke week sinds het begin rekenen we uit wat
 * het model toen, met alleen de meldingen tot dan toe, had verwacht, en kijken we hoeveel van de echte meldingen van die week
 * in de gekleurde gebieden vielen. Zo weet je wat de kaart waard is, en blijft hij eerlijk als het model slecht scoort.
 *
 * Gebruik: WDK.risk.model(events, asOf) en WDK.risk.backtest(events, asOf); `events` komt uit WDK.events(plaatsen)
 * ({ d:'2026-09-14', ty, lat, lon, place }). Het bestand werkt ook in Node (module.exports), voor de tests.
 */
(function(root){
  'use strict';

  var PARAMS = {
    cellKm: 5,            // zijde van een vak
    sigmaKm: 6,           // breedte van de uitstraling van een melding
    halfLifeDays: 21,     // na zoveel dagen telt een melding half
    maxAgeDays: 150,      // oudere meldingen laten we weg (hun gewicht is dan < 1%)
    weights: { aanval: 2, jonkies: 1.5, zichtmelding: 1, overig: 0.5 },
    zones: [              // cumulatief aandeel van de verwachte meldingen
      { key: 'kern',           label: 'Kerngebied',            mass: 0.30 },
      { key: 'waarschijnlijk', label: 'Waarschijnlijk gebied', mass: 0.60 },
      { key: 'ruim',           label: 'Ruimer gebied',         mass: 0.85 }
    ],
    landKm2: 33700,       // landoppervlak van Nederland, voor "hoeveel van het land is gekleurd"
    horizonDays: 7,
    minEvents: 20,        // onder dit aantal (in de weegperiode) geven we geen verwachting
    minHistoryDays: 28    // de eerste week waarvoor we terugkijken
  };

  var KM_PER_DEG = 111.2;
  var LAT0 = 50.6, LON0 = 3.1;                     // zuidwesthoek van het zoekgebied (Nederland met marge)
  var DLAT = PARAMS.cellKm / KM_PER_DEG;
  var DLON = PARAMS.cellKm / (KM_PER_DEG * Math.cos(52.2 * Math.PI / 180));
  var KM_PER_DLON = KM_PER_DEG * Math.cos(52.2 * Math.PI / 180);

  function dayNumber(iso){
    var p = iso.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function dayOf(date){ return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000); }
  function bucket(ty){ return (ty === 'zichtmelding' || ty === 'aanval' || ty === 'jonkies') ? ty : 'overig'; }
  function cellOf(lat, lon){ return { i: Math.floor((lat - LAT0) / DLAT), j: Math.floor((lon - LON0) / DLON) }; }
  function cellCenter(i, j){ return { lat: LAT0 + (i + 0.5) * DLAT, lon: LON0 + (j + 0.5) * DLON }; }

  // events: [{ d, ty, lat, lon, place }]; asOfDay: dagnummer (alleen meldingen vóór die dag tellen); params: overschrijft PARAMS
  function modelAt(events, asOfDay, params){
    var p = params || PARAMS;
    var reach = Math.ceil(3 * p.sigmaKm / p.cellKm);
    var inv2s2 = 1 / (2 * p.sigmaKm * p.sigmaKm), cells = {}, used = 0, weightSum = 0;
    events.forEach(function(e){
      if (!e.d || e.lat == null || e.lon == null) return;
      var age = asOfDay - dayNumber(e.d);
      if (age < 0 || age > p.maxAgeDays) return;
      var w = (p.weights[bucket(e.ty)] || 0) * Math.pow(0.5, age / p.halfLifeDays);
      if (w <= 0) return;
      used++; weightSum += w;
      var c = cellOf(e.lat, e.lon);
      for (var i = c.i - reach; i <= c.i + reach; i++){
        for (var j = c.j - reach; j <= c.j + reach; j++){
          var ctr = cellCenter(i, j);
          var dy = (ctr.lat - e.lat) * KM_PER_DEG, dx = (ctr.lon - e.lon) * KM_PER_DLON;
          var k = i + ',' + j;
          cells[k] = (cells[k] || 0) + w * Math.exp(-(dx * dx + dy * dy) * inv2s2);
        }
      }
    });
    var list = Object.keys(cells).map(function(k){
      var ij = k.split(',');
      var i = +ij[0], j = +ij[1], ctr = cellCenter(i, j);
      return { i:i, j:j, lat:ctr.lat, lon:ctr.lon, score:cells[k], share:0, zone:-1 };
    });
    var total = list.reduce(function(s, c){ return s + c.score; }, 0);
    list.sort(function(a, b){ return b.score - a.score; });
    var cum = 0;
    list.forEach(function(c){
      c.share = total ? c.score / total : 0;
      for (var z = 0; z < p.zones.length; z++){ if (cum < p.zones[z].mass){ c.zone = z; break; } }
      cum += c.share;
    });
    var byZone = p.zones.map(function(z, zi){
      var n = list.filter(function(c){ return c.zone >= 0 && c.zone <= zi; }).length;
      return { key:z.key, label:z.label, mass:z.mass, cells:n, km2:n * p.cellKm * p.cellKm, landShare:n * p.cellKm * p.cellKm / p.landKm2 };
    });
    return { ok: used >= p.minEvents, used:used, cells:list, zones:byZone, asOfDay:asOfDay,
             cellKm:p.cellKm, dlat:DLAT, dlon:DLON, byKey:(function(){ var m = {}; list.forEach(function(c){ m[c.i + ',' + c.j] = c; }); return m; })() };
  }

  function model(events, asOf, params){ return modelAt(events, dayOf(asOf || new Date()) + 1, params); }
  // asOf = vandaag: de meldingen van vandaag tellen mee, dus rekenen we "vanaf morgen"

  // Terugkijken: voor elke maandag T (vanaf minHistoryDays na de eerste melding, tot de laatste volledige week) het model met
  // alleen de meldingen vóór T, getoetst aan de meldingen van T t/m T+6. -> { weeks:[...], totals, zones }
  function backtest(events, asOf, params){
    var p = params || PARAMS;
    var dated = events.filter(function(e){ return e.d && e.lat != null && e.lon != null; });
    if (!dated.length) return { ok:false, weeks:[], total:0 };
    var first = Math.min.apply(null, dated.map(function(e){ return dayNumber(e.d); }));
    var today = dayOf(asOf || new Date());
    // eerste maandag op of na first + minHistoryDays
    var t = first + p.minHistoryDays;
    var dow = (t + 3) % 7;                 // 1 jan 1970 was een donderdag: (dag+3)%7 = 0 voor maandag
    t += (7 - dow) % 7;
    var weeks = [], zoneHits = p.zones.map(function(){ return 0; }), total = 0, areaSum = p.zones.map(function(){ return 0; }), n = 0;
    for (; t + p.horizonDays - 1 <= today; t += 7){
      var prior = dated.filter(function(e){ return dayNumber(e.d) < t; });
      var m = modelAt(prior, t, p);
      if (!m.ok) continue;
      var truth = dated.filter(function(e){ var d = dayNumber(e.d); return d >= t && d < t + p.horizonDays; });
      if (!truth.length) { n++; m.zones.forEach(function(z, zi){ areaSum[zi] += z.landShare; }); weeks.push({ day:t, events:0, hits:p.zones.map(function(){ return 0; }) }); continue; }
      var hits = p.zones.map(function(){ return 0; });
      truth.forEach(function(e){
        var c = cellOf(e.lat, e.lon), cell = m.byKey[c.i + ',' + c.j];
        if (cell && cell.zone >= 0) for (var z = cell.zone; z < p.zones.length; z++) hits[z]++;
      });
      hits.forEach(function(h, zi){ zoneHits[zi] += h; });
      total += truth.length; n++;
      m.zones.forEach(function(z, zi){ areaSum[zi] += z.landShare; });
      weeks.push({ day:t, events:truth.length, hits:hits });
    }
    return { ok: n > 0 && total > 0, weeks:weeks, total:total, evaluatedWeeks:n,
      zones: p.zones.map(function(z, zi){
        return { key:z.key, label:z.label, mass:z.mass, hits:zoneHits[zi], hitRate: total ? zoneHits[zi] / total : 0, landShare: n ? areaSum[zi] / n : 0 };
      }) };
  }

  var api = { PARAMS:PARAMS, model:model, modelAt:modelAt, backtest:backtest, cellOf:cellOf, cellCenter:cellCenter, dayNumber:dayNumber, dayOf:dayOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.WDK) root.WDK.risk = api;
})(typeof window !== 'undefined' ? window : this);
