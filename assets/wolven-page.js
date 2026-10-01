// Wolvenpagina (wolven.html): kaart, statistieken, verwachting en hotspots; de cijfers komen uit assets/site.js (WDK).
// Anders dan zwijnen/herten telt deze pagina heel Nederland (DATA.all = LOADED.all, niet LOADED.veluwe): een wolf houdt
// zich niet aan de grens van de Veluwe, en zwerft ook door Drenthe, Utrecht, Brabant, ... Zie ook de vergelijkbare
// keuze op overig.html (WDK.load('andere')).
(function(){
  // De plaatsen worden in assets/site.js uit de gebeurtenissen (`ev`) berekend. Type, periode, tijdschuif en
  // hitte-laag komen uit de filterbalk (assets/map-tools.js); de tabbladen zijn snelkeuzes voor de periode.
  var RECENT_DAYS = 14;
  var LOADED = WDK.load('wolf');
  var DATA = { all: LOADED.all };
  document.querySelector('.tab[data-set="all"]').textContent = 'Sinds ' + WDK.monthYear(WDK.stats(DATA.all).dateMin);
  document.querySelector('.tab[data-set="last2w"]').textContent = 'Laatste 2 weken (' + WDK.recentLabel(RECENT_DAYS) + ')';

  var COLORS = {
    zichtmelding: 'var(--s-zicht)',
    aanval: 'var(--s-aanval)',
    overig: 'var(--s-overig)'
  };
  var TYPE_LABEL = WDK.TYPE_LABEL, fmtDate = WDK.fmtDate;
  var stripExact = WDK.stripExact, nameHtml = WDK.nameHtml;

  // ---- echte kaart (Leaflet + OpenStreetMap; tegels, licht/donker en zoomknoppen: assets/map-base.js) ----
  // heel Nederland in beeld (zelfde beginstand als de landelijke kaart op de homepage en overig.html), niet alleen de Veluwe
  var INITIAL_CENTER = [52.18, 5.30], INITIAL_ZOOM = 7;
  var map = WDK.baseMap('map', { center:INITIAL_CENTER, zoom:INITIAL_ZOOM });

  var CL = WDK.clusterLayer(map);

  function popupHtml(b){
    var html = '<div class="tt-name">'+nameHtml(b.n)+'</div>';
    if (b.c.zichtmelding) html += '<div class="tt-row"><span>Zichtmeldingen</span><span>'+b.c.zichtmelding+'</span></div>';
    if (b.c.aanval) html += '<div class="tt-row"><span>Aanvallen op vee</span><span>'+b.c.aanval+'</span></div>';
    if (b.c.overig) html += '<div class="tt-row"><span>Overig</span><span>'+b.c.overig+'</span></div>';
    var recent = b.ev.slice(0,5);
    html += '<div class="tt-dates">' + recent.map(function(e){
      return '<div class="date-row">'+fmtDate(e.d)+(e.tm ? ', '+e.tm : '')+' &middot; '+TYPE_LABEL[e.ty]+'</div>';
    }).join('') + (b.ev.length>5 ? '<div>+ '+(b.ev.length-5)+' eerdere</div>' : '') + '</div>';
    return html;
  }

  function render(){
    var f = EX.get();
    var rows = WDK.applyFilter(DATA.all, 'wolf', f);
    var pm = WDK.placeMarkers(rows, { color:function(b){ return COLORS[b.dom]; }, popup:popupHtml });
    CL.setItems(pm.items, { halo: pm.latestId }); // dicht bij elkaar (binnen 5 km): één cluster met het aantal meldingen
    var s = renderStats(rows);
    EX.setHeatPoints(rows.map(function(b){ return { lat:b.lat, lon:b.lon, w:b.t }; }));
    EX.setSummary(s.total, s.places);
    syncTabs(f);
  }

  function renderStats(rows){
    var s = WDK.stats(rows);
    var periodLabel = WDK.periodLabel(s);
    var statsEl = document.getElementById('stats');
    statsEl.innerHTML =
      '<div class="stat"><div class="n">'+s.total+'</div><div class="l">Meldingen</div></div>' +
      '<div class="stat k-zicht"><div class="n">'+s.byType.zichtmelding+'</div><div class="l">Zichtmeldingen</div></div>' +
      '<div class="stat k-aanval"><div class="n">'+s.byType.aanval+'</div><div class="l">Aanvallen op vee</div></div>' +
      '<div class="stat"><div class="n">'+s.places+'</div><div class="l">Plaatsen'+(periodLabel ? ' &middot; '+periodLabel : '')+'</div></div>';
    return s;
  }

  // ---- filterbalk: type, periode, tijdschuif (afspelen), hitte-laag; de stand staat ook in de URL ----
  var EX = WDK.mountExplorer({ el:document.getElementById('explorer'), map:map, rows:DATA.all, onChange:render });

  // de tabbladen zijn snelkeuzes voor de periode: "sinds het begin" of "laatste 2 weken"
  function recentFrom(){ return WDK.recentCutoff(RECENT_DAYS); }
  function syncTabs(f){
    var which = (!f.van && !f.tot) ? 'all' : (f.van === recentFrom() && !f.tot ? 'last2w' : null);
    document.querySelectorAll('.tab').forEach(function(t){
      var on = t.getAttribute('data-set') === which;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  document.querySelectorAll('.tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      EX.set({ van: tab.getAttribute('data-set') === 'last2w' ? recentFrom() : null, tot:null });
    });
  });

  // ---- plaats zoeken: vind een locatie, vlieg ernaartoe, open de popup ----
  var normalize = WDK.normalizeText;
  var mapWrap = document.querySelector('.map-wrap');

  function mostRecentAanval(b){
    for (var i=0;i<b.ev.length;i++){ if (b.ev[i].ty === 'aanval') return b.ev[i]; }
    return null;
  }

  function findPlaces(q){
    var n = normalize(q), starts = [], contains = [];
    DATA.all.forEach(function(b){
      var name = normalize(b.n);
      if (name.indexOf(n) === 0) starts.push(b);
      else if (name.indexOf(n) !== -1) contains.push(b);
    });
    return starts.concat(contains).slice(0,8).map(function(b){
      var ma = mostRecentAanval(b);
      return { key:b.id, label:stripExact(b.n).base, name:nameHtml(b.n),
        meta: ma ? 'Meest recente aanval: '+fmtDate(ma.d) : 'Laatste melding: '+fmtDate(b.ev[0].d)+' &middot; '+TYPE_LABEL[b.ev[0].ty],
        metaClass: ma ? 'has-attack' : '' };
    });
  }

  function selectPlace(item){
    if (!CL.has(item.key)) EX.set({ types:null, van:null, tot:null }); // door het filter verborgen? dan het filter wissen
    if (CL.has(item.key)) CL.openItem(item.key, Math.max(map.getZoom(), 13)); // zoomt zo nodig verder in, zodat het bolletje los van een cluster staat
    WDK.revealMap(mapWrap);
  }

  WDK.mountSearch({ input:document.getElementById('placeSearch'), results:document.getElementById('searchResults'), find:findPlaces, onSelect:selectPlace });

  // ---- meldingen per maand, per type (zelfde grafiek als de homepage, maar dan één soort uitgesplitst naar type
  // in plaats van meerdere soorten) ----
  var TYPE_SERIES = [
    { key:'zichtmelding', label:'Zichtmelding', color:'var(--s-zicht)' },
    { key:'aanval', label:'Aanval op vee', color:'var(--s-aanval)' },
    { key:'overig', label:'Overig', color:'var(--s-overig)' }
  ];
  var chartLegendEl = document.getElementById('chartLegend');
  TYPE_SERIES.forEach(function(t){
    if (chartLegendEl) chartLegendEl.insertAdjacentHTML('beforeend', '<div class="legend-group"><span class="swatch" style="background:'+t.color+'"></span>'+t.label+'</div>');
  });
  WDK.renderMonthlyChart(document.getElementById('monthlyChart'), TYPE_SERIES.map(function(t){
    return { key:t.key, label:t.label, color:t.color, rows: WDK.applyFilter(LOADED.all, 'wolf', { types:[t.key] }) };
  }));

  // ---- waar wordt de wolf het vaakst gemeld? (top gemeenten; `g` komt van PDOK bij het synchroniseren, zie README) ----
  function renderGemeenten(el, rows){
    if (!el) return;
    var by = {}, order = [], total = 0;
    rows.forEach(function(b){
      var raw = (b.g || '').trim(), key = raw ? normalize(raw) : '';
      if (!by[key]){ by[key] = { label: raw || 'Onbekend', n:0, unknown:!raw }; order.push(key); }
      by[key].n += b.t;
      total += b.t;
    });
    if (!total){ el.style.display = 'none'; return; }
    el.style.display = '';
    var all = order.map(function(k){ return by[k]; })
      .sort(function(a, b){ return (a.unknown - b.unknown) || (b.n - a.n) || (a.label < b.label ? -1 : 1); });
    var items = all.slice(0, 8);
    var top = items[0];
    var sub = (top.unknown ? 'De gemeente is niet van elke melding bekend.' :
      'Het vaakst in <b>' + WDK.esc(top.label) + '</b> (' + top.n + ' van de ' + total + ' meldingen' +
      (all.length > items.length ? ', top ' + items.length + ' van ' + all.length + ' gemeenten' : '') + ').');
    el.innerHTML = '<h2 class="card-title">Waar wordt de wolf het vaakst gemeld?</h2><p class="sub">' + sub + '</p>' +
      WDK.barChartHtml(items, 'Balkdiagram: aantal meldingen per gemeente. ');
  }
  renderGemeenten(document.getElementById('gemeenteCard'), LOADED.all);

  // ---- op welk moment van de dag wordt een wolf gemeld? (alleen meldingen met een bekend tijdstip) ----
  function renderDaypart(el, rows){
    if (!el) return;
    var BUCKETS = [
      { key:'nacht', label:'Nacht', range:'0–06u', from:0, to:6 },
      { key:'ochtend', label:'Ochtend', range:'6–12u', from:6, to:12 },
      { key:'middag', label:'Middag', range:'12–18u', from:12, to:18 },
      { key:'avond', label:'Avond', range:'18–24u', from:18, to:24 }
    ];
    var counts = {}, total = 0, withTime = 0;
    BUCKETS.forEach(function(b){ counts[b.key] = 0; });
    rows.forEach(function(b){
      b.ev.forEach(function(e){
        total++;
        if (!e.tm) return;
        withTime++;
        var h = parseInt(e.tm.slice(0, 2), 10);
        var bucket = BUCKETS.filter(function(bk){ return h >= bk.from && h < bk.to; })[0];
        if (bucket) counts[bucket.key]++;
      });
    });
    if (!withTime){ el.style.display = 'none'; return; }
    el.style.display = '';
    var top = BUCKETS.slice().sort(function(a, b){ return counts[b.key] - counts[a.key]; })[0];
    var items = BUCKETS.map(function(b){ return { label: b.label + ' (' + b.range + ')', n: counts[b.key] }; });
    var sub = 'Van de ' + total + ' meldingen is bij ' + withTime + ' ook het tijdstip bekend; het vaakst in de <b>' +
      WDK.esc(top.label.toLowerCase()) + '</b>.';
    el.innerHTML = '<h2 class="card-title">Op welk moment van de dag wordt een wolf gemeld?</h2><p class="sub">' + sub + '</p>' +
      WDK.barChartHtml(items, 'Balkdiagram: aantal meldingen per dagdeel. ');
  }
  renderDaypart(document.getElementById('daypartCard'), LOADED.all);

  // ---- alles wat uit de meldingen volgt komt uit assets/site.js: verwachting, hotspots, weetjes ----
  WDK.renderForecast(document.getElementById('forecastCard'), { species:'wolf', rows:LOADED.all, scope:'nl', updatedAt:LOADED.updatedAt });
  WDK.renderFunFacts(document.getElementById('funCard'), { rows:LOADED.all });
  WDK.renderLivestock(document.getElementById('attackAnimalsCard'), { rows:LOADED.all, mode:'attacks', where:'in heel Nederland' });
  WDK.renderLivestock(document.getElementById('killedCard'), { rows:LOADED.all, mode:'killed', where:'in heel Nederland' });

  render();
})();
