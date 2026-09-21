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
  var map = L.map('nlMap', { zoomControl:false, scrollWheelZoom:true }).setView(INITIAL_CENTER, INITIAL_ZOOM);
  window.__nlMap = map;
  var LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_3pk1_1_4be88f8eb009c48504d37519';
  var DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_3pk1_1_4be88f8eb009c48504d37519';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>-bijdragers &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';
  function currentMapTheme(){
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  var tileLayer = L.tileLayer(currentMapTheme() === 'dark' ? DARK_TILES : LIGHT_TILES, {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: TILE_ATTR
  }).addTo(map);
  function syncTiles(){ tileLayer.setUrl(currentMapTheme() === 'dark' ? DARK_TILES : LIGHT_TILES); }
  var themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) themeToggleBtn.addEventListener('click', function(){ setTimeout(syncTiles, 0); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTiles);

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

  document.getElementById('nlZoomIn').addEventListener('click', function(){ map.zoomIn(); });
  document.getElementById('nlZoomOut').addEventListener('click', function(){ map.zoomOut(); });
  document.getElementById('nlZoomReset').addEventListener('click', function(){ map.setView(INITIAL_CENTER, INITIAL_ZOOM); });

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

  function renderResults(matches, q){
    if (!matches.length){
      searchResultsEl.innerHTML = '<div class="search-empty">Geen plaats gevonden voor &ldquo;'+WDK.esc(q)+'&rdquo;.</div>';
      searchResultsEl.hidden = false;
      return;
    }
    searchResultsEl.innerHTML = matches.map(function(p){
      return '<div class="search-item" data-key="'+p.key.replace(/"/g,'&quot;')+'">' +
        '<span class="si-name">'+nameHtml(p.n)+'</span><span class="si-meta">'+p.kind+'</span>' +
        '</div>';
    }).join('');
    searchResultsEl.hidden = false;
  }

  function doSearch(){
    var q = normalize(searchInput.value.trim());
    if (!q){ searchResultsEl.hidden = true; searchResultsEl.innerHTML=''; return; }
    var starts = [], contains = [];
    allPlaces.forEach(function(p){
      var n = normalize(p.n);
      if (n.indexOf(q) === 0) starts.push(p);
      else if (n.indexOf(q) !== -1) contains.push(p);
    });
    // meerdere exacte punten met dezelfde plaatsnaam tonen we als één zoekresultaat (de drukste)
    var seen = {};
    var hits = starts.concat(contains).filter(function(p){ var k = p.kind+'|'+p.n; if (seen[k]) return false; seen[k] = true; return true; });
    renderResults(hits.slice(0,8), searchInput.value.trim());
  }

  function selectPlace(key){
    searchResultsEl.hidden = true;
    var entry = placeIndex[key];
    if (!entry) return;
    searchInput.value = stripExact(entry.n).base;
    searchInput.blur();
    // verborgen door het filter (of een uitgezette soort)? dan het filter wissen zodat de melding zichtbaar wordt
    if (entry.meldingKey && window.__nlExplorer && !(window.__meldingMarkers && window.__meldingMarkers[entry.meldingKey])){
      window.__nlExplorer.set({ soort:null, types:null, van:null, tot:null });
    }
    map.flyTo([entry.lat, entry.lon], entry.zoom, { duration:0.6 });
    if (entry.meldingKey){
      // pas bij het openen opzoeken: bij een ?plaats=-link bestaan de bolletjes op dit moment nog niet
      setTimeout(function(){
        var m = window.__meldingMarkers && window.__meldingMarkers[entry.meldingKey];
        if (m) m.openPopup();
      }, 650);
    }
    setTimeout(function(){
      var r = mapWrap.getBoundingClientRect();
      var visible = r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight);
      if (!visible) mapWrap.scrollIntoView({ behavior:'smooth', block:'center' });
    }, 80);
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

  searchInput.addEventListener('input', doSearch);
  searchInput.addEventListener('focus', function(){ if (searchInput.value.trim()) doSearch(); });
  searchInput.addEventListener('keydown', function(ev){
    if (ev.key === 'Enter'){
      var first = searchResultsEl.querySelector('.search-item');
      if (first) selectPlace(first.getAttribute('data-key'));
      ev.preventDefault();
    } else if (ev.key === 'Escape'){
      searchResultsEl.hidden = true;
    }
  });
  searchResultsEl.addEventListener('click', function(ev){
    var item = ev.target.closest('.search-item');
    if (item) selectPlace(item.getAttribute('data-key'));
  });
  document.addEventListener('click', function(ev){
    if (!ev.target.closest('.map-search')) searchResultsEl.hidden = true;
  });

  window.addEventListener('resize', function(){ map.invalidateSize(); });

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
