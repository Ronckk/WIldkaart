// Landelijke kaart op de homepage (index.html): tekent de kaart met Leaflet en zet window.__nlMap voor home-stats.js.
(function(){
  var svg = document.getElementById('nlMap');
  if (!svg) return;

  var REF_CITIES = [
    {n:'Amsterdam', lat:52.370, lon:4.895},
    {n:'Rotterdam', lat:51.924, lon:4.478},
    {n:'Den Haag', lat:52.070, lon:4.301},
    {n:'Utrecht', lat:52.090, lon:5.121},
    {n:'Eindhoven', lat:51.441, lon:5.469},
    {n:'Tilburg', lat:51.560, lon:5.083},
    {n:'Groningen', lat:53.219, lon:6.567},
    {n:'Almere', lat:52.372, lon:5.214},
    {n:'Breda', lat:51.586, lon:4.776},
    {n:'Nijmegen', lat:51.845, lon:5.853},
    {n:'Enschede', lat:52.222, lon:6.895},
    {n:'Arnhem', lat:51.985, lon:5.898},
    {n:'Apeldoorn', lat:52.211, lon:5.969},
    {n:'Zwolle', lat:52.516, lon:6.083},
    {n:'Maastricht', lat:50.851, lon:5.690},
    {n:'Leeuwarden', lat:53.201, lon:5.799},
    {n:'Middelburg', lat:51.499, lon:3.611},
    {n:'Haarlem', lat:52.380, lon:4.637},
    {n:'’s-Hertogenbosch', lat:51.698, lon:5.304}
  ];

  var PROVINCES = [
    {n:'Groningen (provincie)', lat:53.25, lon:6.70, zoom:9},
    {n:'Friesland', lat:53.10, lon:5.80, zoom:9},
    {n:'Drenthe', lat:52.86, lon:6.60, zoom:9},
    {n:'Overijssel', lat:52.45, lon:6.40, zoom:9},
    {n:'Flevoland', lat:52.55, lon:5.60, zoom:10},
    {n:'Gelderland', lat:52.05, lon:5.90, zoom:9},
    {n:'Utrecht (provincie)', lat:52.10, lon:5.15, zoom:10},
    {n:'Noord-Holland', lat:52.60, lon:4.85, zoom:9},
    {n:'Zuid-Holland', lat:52.02, lon:4.50, zoom:9},
    {n:'Zeeland', lat:51.50, lon:3.85, zoom:9},
    {n:'Noord-Brabant', lat:51.55, lon:5.15, zoom:9},
    {n:'Limburg', lat:51.15, lon:5.90, zoom:9}
  ];

  var INITIAL_CENTER = [52.18, 5.30], INITIAL_ZOOM = 7;
  var map = WDK.baseMap('nlMap', { center:INITIAL_CENTER, zoom:INITIAL_ZOOM, buttons:{ 'in':'nlZoomIn', out:'nlZoomOut', reset:'nlZoomReset' } });
  window.__nlMap = map;

  // Veluwe ter oriëntatie, zodat de link met de wolven-/zwijnenkaart duidelijk is
  L.circle([52.24, 5.85], {
    radius: 14000,
    color: 'var(--accent)',
    weight: 1.4,
    dashArray: '2 5',
    fillOpacity: 0.05
  }).addTo(map).bindPopup('<b>Veluwe</b> &mdash; bekijk de <a href="wolven">wolvenkaart</a> of <a href="zwijnen">zwijnenkaart</a>');

  var placeIndex = {};
  PROVINCES.forEach(function(p){ placeIndex['provincie::'+p.n] = { lat:p.lat, lon:p.lon, zoom:p.zoom||9, kind:'provincie', n:p.n }; });
  REF_CITIES.forEach(function(c){ placeIndex['plaats::'+c.n] = { lat:c.lat, lon:c.lon, zoom:12, kind:'plaats', n:c.n }; });

  // meldingslocaties (wolf + zwijn) horen ook doorzoekbaar te zijn, niet alleen de vaste steden-/provincielijst
  var MELDING_SOURCES = WDK.loadAll().map(function(d){
    return { speciesKey:d.key, label:d.species.meldingLabel, rows:d.all };
  });
  MELDING_SOURCES.forEach(function(src){
    src.rows.forEach(function(b){
      var key = 'melding::'+src.speciesKey+'::'+b.id;
      placeIndex[key] = { lat:b.lat, lon:b.lon, zoom:13, kind:src.label, n:b.n, meldingKey: src.speciesKey+'::'+b.id };
    });
  });

  var mapWrap = svg.closest('.map-wrap');

  // ---- plaats/provincie zoeken ----
  var normalize = WDK.normalizeText;
  var stripExact = WDK.stripExact, nameHtml = WDK.nameHtml;
  var searchInput = document.getElementById('nlPlaceSearch');
  var searchResultsEl = document.getElementById('nlSearchResults');
  var allPlaces = PROVINCES.map(function(p){ return { key:'provincie::'+p.n, n:p.n, kind:'Provincie' }; })
    .concat(REF_CITIES.map(function(c){ return { key:'plaats::'+c.n, n:c.n, kind:'Plaats' }; }))
    .concat(MELDING_SOURCES.reduce(function(acc, src){
      // drukste plaatsen eerst: bij meerdere plekken met dezelfde naam (exacte punten) is dat de treffer die de zoekbalk toont
      return acc.concat(src.rows.slice().sort(function(a, b){ return b.t - a.t; }).map(function(b){ return { key:'melding::'+src.speciesKey+'::'+b.id, n:b.n, kind:src.label }; }));
    }, []));

  function findPlaces(q){
    var n = normalize(q), starts = [], contains = [];
    allPlaces.forEach(function(p){
      var name = normalize(p.n);
      if (name.indexOf(n) === 0) starts.push(p);
      else if (name.indexOf(n) !== -1) contains.push(p);
    });
    // meerdere exacte punten met dezelfde plaatsnaam tonen we als één zoekresultaat (de drukste)
    var seen = {};
    var hits = starts.concat(contains).filter(function(p){ var k = p.kind+'|'+p.n; if (seen[k]) return false; seen[k] = true; return true; });
    return hits.slice(0,8).map(function(p){ return { key:p.key, label:stripExact(p.n).base, name:nameHtml(p.n), meta:p.kind }; });
  }

  function selectPlace(key){
    searchResultsEl.hidden = true;
    var entry = placeIndex[key];
    if (!entry) return;
    searchInput.value = stripExact(entry.n).base;
    searchInput.blur();
    var cl = window.__nlCluster, mkey = entry.meldingKey;
    // verborgen door het filter (of een uitgezette soort)? dan het filter wissen zodat de melding zichtbaar wordt
    if (mkey && window.__nlExplorer && cl && !cl.has(mkey)){
      window.__nlExplorer.set({ soort:null, types:null, van:null, tot:null });
    }
    if (mkey && cl && cl.has(mkey)){
      cl.openItem(mkey, entry.zoom); // zoomt zo nodig verder in, zodat de melding los van een cluster staat
    } else {
      map.flyTo([entry.lat, entry.lon], entry.zoom, { duration:0.6 });
      if (mkey){
        // bij een ?plaats=-link bestaan de bolletjes op dit moment nog niet (home-stats.js komt later): pas bij het openen opzoeken
        setTimeout(function(){
          var c = window.__nlCluster;
          if (c && c.has(mkey)) c.openItem(mkey, entry.zoom);
        }, 650);
      }
    }
    WDK.revealMap(mapWrap);
    if (window.history && window.history.replaceState){
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('plaats', entry.n);
        window.history.replaceState(null, '', url.toString());
      } catch (e) {}
    }
  }
  window.__selectPlace = selectPlace;
  window.__placeIndex = placeIndex;

  WDK.mountSearch({ input:searchInput, results:searchResultsEl, find:findPlaces, onSelect:function(item){ selectPlace(item.key); } });

  // Deelbare link: ?plaats=Naam opent de kaart direct op die locatie (provincie, plaats of melding)
  (function(){
    var params = new URLSearchParams(window.location.search);
    var wanted = params.get('plaats');
    if (!wanted) return;
    var wantedNorm = normalize(wanted);
    var match = allPlaces.find(function(p){ return normalize(p.n) === wantedNorm; });
    if (!match){
      match = allPlaces.find(function(p){ return normalize(p.n).indexOf(wantedNorm) === 0; });
    }
    if (match) selectPlace(match.key);
  })();
})();
