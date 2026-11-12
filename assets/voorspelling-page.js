// Voorspellingspagina (voorspelling.html): kaart met de verwachte wolvenmeldingen van de komende week.
// De berekening zelf staat in assets/risk-model.js (WDK.risk); hier alleen tekenen en uitleggen.
(function(){
  if (!window.WDK || !WDK.risk) return;
  var risk = WDK.risk, esc = WDK.esc, fmtDate = WDK.fmtDate;
  var LOADED = WDK.load('wolf');
  var EVENTS = WDK.events(LOADED.all);
  var TODAY = new Date();
  var model = risk.model(EVENTS, TODAY);
  var bt = risk.backtest(EVENTS, TODAY);
  var P = risk.PARAMS;

  // kleur per zone: vast (geen thema-variabelen), want de kaarttegels wisselen met licht/donker en de vlakken moeten altijd opvallen
  var ZONE = [
    { color:'#b3261e', opacity:0.62 },   // kerngebied
    { color:'#e8590c', opacity:0.46 },   // waarschijnlijk gebied
    { color:'#f2a900', opacity:0.32 }    // ruimer gebied
  ];
  function pct(x){ return (x >= 0.1 ? Math.round(x * 100) : Math.round(x * 1000) / 10).toString().replace('.', ',') + '%'; }
  function nl(n){ return Math.round(n).toLocaleString('nl-NL'); }
  function dm(d){ return d.getDate() + ' ' + ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][d.getMonth()]; }
  var from = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 1);
  var to = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + P.horizonDays);
  var periodLabel = dm(from) + ' – ' + dm(to);

  var statsEl = document.getElementById('stats'), mapCard = document.querySelector('.map-card');
  var areasEl = document.getElementById('areasCard'), btEl = document.getElementById('backtestCard');

  if (!model.ok){
    statsEl.innerHTML = '<div class="notice" style="grid-column:1/-1">Er zijn nog te weinig recente meldingen (' + model.used + ' van de minimaal ' + P.minEvents +
      ') om een verwachting te berekenen. Kijk intussen op de <a href="wolven">wolvenkaart</a>.</div>';
    mapCard.style.display = 'none'; areasEl.style.display = 'none'; btEl.style.display = 'none';
    return;
  }

  // ---- cijfers ----
  var core = model.zones[0], wide = model.zones[2];
  statsEl.innerHTML =
    '<div class="stat"><div class="n">' + periodLabel + '</div><div class="l">Verwachting voor de komende 7 dagen</div></div>' +
    '<div class="stat"><div class="n">' + model.used + '</div><div class="l">Meldingen in de berekening (laatste ' + P.maxAgeDays + ' dagen)</div></div>' +
    '<div class="stat k-aanval"><div class="n">' + nl(core.km2) + ' km&sup2;</div><div class="l">Kerngebied: 30% van de verwachte meldingen</div></div>' +
    '<div class="stat"><div class="n">' + nl(wide.km2) + ' km&sup2;</div><div class="l">Ruimer gebied: 85% &middot; ' + pct(wide.landShare) + ' van Nederland</div></div>';

  // ---- kaart ----
  var map = WDK.baseMap('map', { center:[52.18, 5.30], zoom:7 });
  var cellsLayer = L.layerGroup().addTo(map), reportsLayer = L.layerGroup().addTo(map);

  function nearbyReports(c, km, days){
    var out = { n:0, last:null, place:null, best:1e9 };
    var cutoff = risk.dayNumber(isoOf(TODAY)) - days;
    EVENTS.forEach(function(e){
      var dy = (e.lat - c.lat) * 111.2, dx = (e.lon - c.lon) * 111.2 * Math.cos(52.2 * Math.PI / 180), d = Math.sqrt(dx * dx + dy * dy);
      if (d < out.best){ out.best = d; out.place = WDK.stripExact(e.place).base; }
      if (d <= km && risk.dayNumber(e.d) >= cutoff){ out.n++; if (!out.last || e.d > out.last) out.last = e.d; }
    });
    return out;
  }
  function isoOf(d){ return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  var bounds = null;
  model.cells.forEach(function(c){
    if (c.zone < 0) return;
    var z = ZONE[c.zone], b = [[c.lat - model.dlat / 2, c.lon - model.dlon / 2], [c.lat + model.dlat / 2, c.lon + model.dlon / 2]];
    var r = L.rectangle(b, { stroke:false, fillColor:z.color, fillOpacity:z.opacity, interactive:true });
    r.on('click', function(){
      var near = nearbyReports(c, 10, 60);
      r.bindPopup('<div class="risk-popup"><div class="tt-name">Bij ' + esc(near.place || 'onbekend') + '</div>' +
        '<div class="tt-row"><span>Gebied</span><span>' + P.zones[c.zone].label + '</span></div>' +
        '<div class="tt-row"><span>Verwacht aandeel</span><span>' + pct(c.share) + '</span></div>' +
        '<div class="tt-row"><span>Meldingen &lt; 10 km, 60 dgn</span><span>' + near.n + '</span></div>' +
        '<div class="tt-sub">Vak van ' + model.cellKm + ' &times; ' + model.cellKm + ' km' + (near.last ? '. Laatste melding in de buurt: ' + fmtDate(near.last) : '') + '.</div></div>',
        { maxWidth:260 }).openPopup();
    });
    r.addTo(cellsLayer);
    bounds = bounds ? bounds.extend(b) : L.latLngBounds(b);
  });
  if (bounds){
    map.fitBounds(bounds, { padding:[24, 24], maxZoom:9 });
  }

  // meldingen van de afgelopen 2 weken, ter controle van wat het model "ziet"
  var TYPE_COLOR = { zichtmelding:'var(--s-zicht)', aanval:'var(--s-aanval)' };
  var cutoff = risk.dayNumber(isoOf(TODAY)) - 13;
  EVENTS.forEach(function(e){
    if (risk.dayNumber(e.d) < cutoff || e.lat == null) return;
    L.circleMarker([e.lat, e.lon], { radius:5, color:'var(--map-surface)', weight:1.4, fillColor:TYPE_COLOR[e.ty] || 'var(--s-overig)', fillOpacity:.95 })
      .bindPopup('<div class="tt-name">' + esc(WDK.stripExact(e.place).base) + '</div><div class="tt-row"><span>' + (WDK.TYPE_LABEL[e.ty] || 'Overig') +
        '</span><span>' + fmtDate(e.d) + '</span></div>', { maxWidth:240 }).addTo(reportsLayer);
  });
  document.getElementById('showReports').addEventListener('change', function(ev){
    if (ev.target.checked) reportsLayer.addTo(map); else map.removeLayer(reportsLayer);
  });

  document.getElementById('riskLegend').innerHTML = P.zones.map(function(z, i){
    return '<div class="legend-group"><span class="risk-swatch" style="background:' + ZONE[i].color + ';opacity:' + (0.35 + ZONE[i].opacity / 1.2) + '"></span>' +
      z.label + ' (' + Math.round(z.mass * 100) + '%)</div>';
  }).join('') +
    '<div class="legend-group"><span class="swatch" style="background:var(--s-zicht)"></span>Zichtmelding</div>' +
    '<div class="legend-group"><span class="swatch" style="background:var(--s-aanval)"></span>Aanval (plaats)</div>';

  // ---- gebieden: waar zit het grootste deel van de verwachte meldingen? (per gemeente van de dichtstbijzijnde melding) ----
  var byArea = {}, total = 0;
  model.cells.forEach(function(c){
    var best = null, bd = 1e9;
    LOADED.all.forEach(function(b){
      var dy = (b.lat - c.lat) * 111.2, dx = (b.lon - c.lon) * 111.2 * Math.cos(52.2 * Math.PI / 180), d = dx * dx + dy * dy;
      if (d < bd){ bd = d; best = b; }
    });
    var name = (best.g || WDK.stripExact(best.n).base || 'Onbekend').trim();
    byArea[name] = (byArea[name] || 0) + c.share; total += c.share;
  });
  var areas = Object.keys(byArea).map(function(k){ return { label:k, n:Math.round(byArea[k] * 100) }; })
    .filter(function(a){ return a.n >= 1; }).sort(function(a, b){ return b.n - a.n || (a.label < b.label ? -1 : 1); }).slice(0, 8);
  areasEl.innerHTML = '<h2 class="card-title">Waar zit het grootste deel van de verwachting?</h2>' +
    '<p class="sub">Aandeel van de verwachte meldingen in procenten, per gemeente. De verwachting is groter waar de laatste weken meer is gemeld.</p>' +
    (areas.length ? WDK.barChartHtml(areas, 'Balkdiagram: verwacht aandeel van de meldingen per gemeente in procenten. ') : '<p class="sub">Geen gemeente heeft een aandeel van 1% of meer.</p>');
  Array.prototype.forEach.call(areasEl.querySelectorAll('.bar-value'), function(v){ v.textContent += '%'; });

  // ---- terugtoets ----
  if (!bt.ok){
    btEl.innerHTML = '<h2 class="card-title">Hoe goed is dit model?</h2><p class="sub">Er is nog te weinig geschiedenis om het model aan het verleden te toetsen.</p>';
  } else {
    var wideBt = bt.zones[bt.zones.length - 1], lift = wideBt.landShare ? wideBt.hitRate / wideBt.landShare : 0;
    var rows = bt.zones.map(function(z){
      return '<tr><td><b>' + z.label + '</b></td><td class="num">' + pct(z.hitRate) + '</td><td class="num">' + pct(z.landShare) + '</td></tr>';
    }).join('');
    btEl.innerHTML = '<h2 class="card-title">Hoe goed is dit model?</h2>' +
      '<p class="sub">We hebben het model teruggetoetst: voor elk van de <b>' + bt.evaluatedWeeks + ' weken</b> hebben we uitgerekend wat het toen, met alleen de meldingen tot dan toe, had verwacht. ' +
      'Van de <b>' + bt.total + ' meldingen</b> die in die weken echt binnenkwamen, lag <b>' + pct(wideBt.hitRate) + '</b> in het ruimere gebied, dat maar <b>' + pct(wideBt.landShare) + '</b> van Nederland beslaat. ' +
      'Raden zonder model zou ongeveer ' + pct(wideBt.landShare) + ' halen' + (lift >= 1.2 ? ', dus het model is ruim <b>' + (Math.round(lift * 10) / 10).toString().replace('.', ',') + ' keer</b> beter dan toeval' : '') + '.</p>' +
      '<table class="risk-table"><thead><tr><th>Gebied</th><th class="num">Meldingen erin</th><th class="num">Deel van Nederland</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="sub" style="margin-top:12px">Let op: dit zijn weinig weken en weinig meldingen, dus de cijfers schommelen. Meldingen op dezelfde plek tellen apart mee, en een wolf die ergens nieuw opduikt, mist het model altijd.</p>';
  }
})();
