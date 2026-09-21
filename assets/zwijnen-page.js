// Zwijnenpagina (zwijnen.html): kaart, statistieken, verwachting en hotspots; de cijfers komen uit assets/site.js (WDK).
(function(){
  // De plaatsen worden in assets/site.js uit de gebeurtenissen (`ev`) berekend.
  var LOADED = WDK.load('zwijn');
  var DATA = { all: LOADED.veluwe };

  var COLORS = {
    zichtmelding: 'var(--s-zicht)',
    jonkies: 'var(--pal-4)',
    overig: 'var(--s-overig)'
  };
  var TYPE_LABEL = WDK.TYPE_LABEL, fmtDate = WDK.fmtDate, nameHtml = WDK.nameHtml;

  // ---- echte kaart (Leaflet + OpenStreetMap; tegels, licht/donker en zoomknoppen: assets/map-base.js) ----
  var INITIAL_CENTER = [52.24, 5.85], INITIAL_ZOOM = 10;
  var map = WDK.baseMap('map', { center:INITIAL_CENTER, zoom:INITIAL_ZOOM });

  var CL = WDK.clusterLayer(map);

  function popupHtml(b){
    var html = '<div class="tt-name">'+nameHtml(b.n)+'</div>';
    if (b.c.zichtmelding) html += '<div class="tt-row"><span>Zichtmeldingen</span><span>'+b.c.zichtmelding+'</span></div>';
    if (b.c.jonkies) html += '<div class="tt-row"><span>Met jonkies gezien</span><span>'+b.c.jonkies+'</span></div>';
    if (b.c.overig) html += '<div class="tt-row"><span>Overig</span><span>'+b.c.overig+'</span></div>';
    var recent = b.ev.slice(0,5);
    html += '<div class="tt-dates">' + recent.map(function(e){
      return '<div class="date-row">'+fmtDate(e.d)+(e.tm ? ', '+e.tm : '')+' &middot; '+TYPE_LABEL[e.ty]+'</div>';
    }).join('') + (b.ev.length>5 ? '<div>+ '+(b.ev.length-5)+' eerdere</div>' : '') + '</div>';
    return html;
  }

  function render(){
    var rows = WDK.applyFilter(DATA.all, 'zwijn', EX.get());
    var pm = WDK.placeMarkers(rows, { color:function(b){ return COLORS[b.dom]; }, popup:popupHtml });
    CL.setItems(pm.items, { halo: pm.latestId }); // dicht bij elkaar (binnen 5 km): één cluster met het aantal meldingen
    var s = renderStats(rows);
    WDK.renderScopeNote(document.getElementById('statsNote'), { rows:LOADED.overig, key:'zwijn', filter:EX.get(), where:'de Veluwe', attacks:false });
    EX.setHeatPoints(rows.map(function(b){ return { lat:b.lat, lon:b.lon, w:b.t }; }));
    EX.setSummary(s.total, s.places);
  }

  function renderStats(rows){
    var s = WDK.stats(rows);
    var statsEl = document.getElementById('stats');
    statsEl.innerHTML =
      '<div class="stat"><div class="n">'+s.total+'</div><div class="l">Meldingen</div></div>' +
      '<div class="stat k-zicht"><div class="n">'+s.byType.zichtmelding+'</div><div class="l">Zichtmeldingen</div></div>' +
      '<div class="stat k-jonkies"><div class="n">'+s.byType.jonkies+'</div><div class="l">Met jonkies</div></div>' +
      '<div class="stat"><div class="n">'+s.places+'</div><div class="l">Plaatsen'+(s.dateMin ? ' &middot; '+WDK.periodLabel(s) : '')+'</div></div>';
    return s;
  }

  // ---- filterbalk: type, periode, tijdschuif (afspelen), hitte-laag; de stand staat ook in de URL ----
  var EX = WDK.mountExplorer({ el:document.getElementById('explorer'), map:map, rows:DATA.all, onChange:render });

  // ---- plaats zoeken: vind een locatie, vlieg ernaartoe, open de popup ----
  var normalize = WDK.normalizeText;
  var mapWrap = document.querySelector('.map-wrap');

  function findPlaces(q){
    var n = normalize(q), starts = [], contains = [];
    DATA.all.forEach(function(b){
      var name = normalize(b.n);
      if (name.indexOf(n) === 0) starts.push(b);
      else if (name.indexOf(n) !== -1) contains.push(b);
    });
    return starts.concat(contains).slice(0,8).map(function(b){
      return { key:b.id, label:b.n, name:nameHtml(b.n), meta:'Laatste melding: '+fmtDate(b.ev[0].d)+' &middot; '+TYPE_LABEL[b.ev[0].ty] };
    });
  }

  function selectPlace(item){
    if (!CL.has(item.key)) EX.set({ types:null, van:null, tot:null }); // door het filter verborgen? dan het filter wissen
    if (CL.has(item.key)) CL.openItem(item.key, Math.max(map.getZoom(), 13)); // zoomt zo nodig verder in, zodat het bolletje los van een cluster staat
    WDK.revealMap(mapWrap);
  }

  WDK.mountSearch({ input:document.getElementById('placeSearch'), results:document.getElementById('searchResults'), find:findPlaces, onSelect:selectPlace });


  // ---- verwachting komt uit assets/site.js: zolang er te weinig meldingen zijn toont die kaart dat zelf ----
  WDK.renderForecast(document.getElementById('forecastCard'), { species:'zwijn', rows:LOADED.veluwe, scope:'veluwe', updatedAt:LOADED.updatedAt });

  render();
})();
