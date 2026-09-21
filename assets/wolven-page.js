// Wolvenpagina (wolven.html): kaart, statistieken, verwachting en hotspots; de cijfers komen uit assets/site.js (WDK).
(function(){
  var wolvenNavLink = document.querySelector('.nav-link.active');
  if (wolvenNavLink){
    wolvenNavLink.addEventListener('click', function(){
      window.scrollTo({ top:0, behavior:'smooth' });
    });
  }

  // De plaatsen worden in assets/site.js uit de gebeurtenissen (`ev`) berekend. Type, periode, tijdschuif en
  // hitte-laag komen uit de filterbalk (assets/map-tools.js); de tabbladen zijn snelkeuzes voor de periode.
  var RECENT_DAYS = 14;
  var LOADED = WDK.load('wolf');
  var DATA = { all: LOADED.veluwe };
  var placeById = {}; // id -> plaats (meerdere plaatsen kunnen dezelfde naam hebben, de id is uniek)
  DATA.all.forEach(function(b){ placeById[b.id] = b; });
  document.querySelector('.tab[data-set="all"]').textContent = 'Sinds ' + WDK.monthYear(WDK.stats(DATA.all).dateMin);
  document.querySelector('.tab[data-set="last2w"]').textContent = 'Laatste 2 weken (' + WDK.recentLabel(RECENT_DAYS) + ')';

  var COLORS = {
    zichtmelding: 'var(--s-zicht)',
    aanval: 'var(--s-aanval)',
    overig: 'var(--s-overig)'
  };
  var TYPE_LABEL = WDK.TYPE_LABEL, fmtDate = WDK.fmtDate;
  var stripExact = WDK.stripExact, nameHtml = WDK.nameHtml;

  // ---- echte kaart (Leaflet + OpenStreetMap) ----
  var INITIAL_CENTER = [52.24, 5.85], INITIAL_ZOOM = 10;
  var map = L.map('map', { zoomControl:false, scrollWheelZoom:true }).setView(INITIAL_CENTER, INITIAL_ZOOM);
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

  var CL = WDK.clusterLayer(map);
  var markerIndex = {}; // plaatsnaam -> { marker, b }
  var mapWrap = document.querySelector('.map-wrap');

  function radius(count, maxC){
    var R0 = 6, R1 = 26;
    return R0 + (R1-R0) * Math.sqrt(count/maxC);
  }

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
    markerIndex = {};
    var maxCount = 1;
    rows.forEach(function(b){ if (b.t > maxCount) maxCount = b.t; });
    var latestRow = null;
    var items = rows.map(function(b){
      var m = L.circleMarker([b.lat, b.lon], {
        radius: radius(b.t, maxCount),
        color: 'var(--map-surface)',
        weight: 1.4,
        fillColor: COLORS[b.dom],
        fillOpacity: 0.85
      });
      m.bindPopup(popupHtml(b), { maxWidth:240 });
      markerIndex[b.id] = { marker:m, b:b };
      if (b.ev.length && (!latestRow || b.ev[0].d > latestRow.ev[0].d)) latestRow = b;
      return { id:b.id, lat:b.lat, lon:b.lon, w:b.t, rank:WDK.DOM_RANK[b.dom], color:COLORS[b.dom], marker:m };
    });
    CL.setItems(items, { halo: latestRow && latestRow.id }); // dicht bij elkaar (binnen 5 km): één cluster met het aantal meldingen
    var s = renderStats(rows);
    WDK.renderScopeNote(document.getElementById('statsNote'), { rows:LOADED.overig, key:'wolf', filter:f, where:'de Veluwe', attacks:true });
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

  document.getElementById('zoomIn').addEventListener('click', function(){ map.zoomIn(); });
  document.getElementById('zoomOut').addEventListener('click', function(){ map.zoomOut(); });
  document.getElementById('zoomReset').addEventListener('click', function(){ map.setView(INITIAL_CENTER, INITIAL_ZOOM); });

  // ---- plaats zoeken: vind een locatie, vlieg ernaartoe, open de popup ----
  var normalize = WDK.normalizeText;
  var searchInput = document.getElementById('placeSearch');
  var searchResultsEl = document.getElementById('searchResults');

  function mostRecentAanval(b){
    for (var i=0;i<b.ev.length;i++){ if (b.ev[i].ty === 'aanval') return b.ev[i]; }
    return null;
  }

  function renderSearchResults(matches, q){
    if (!matches.length){
      searchResultsEl.innerHTML = '<div class="search-empty">Geen plaats gevonden voor &ldquo;'+WDK.esc(q)+'&rdquo;.</div>';
      searchResultsEl.hidden = false;
      return;
    }
    searchResultsEl.innerHTML = matches.map(function(b){
      var ma = mostRecentAanval(b);
      var meta = ma
        ? '<span class="si-meta has-attack">Meest recente aanval: '+fmtDate(ma.d)+'</span>'
        : '<span class="si-meta">Laatste melding: '+fmtDate(b.ev[0].d)+' &middot; '+TYPE_LABEL[b.ev[0].ty]+'</span>';
      return '<div class="search-item" data-id="'+WDK.esc(b.id)+'">' +
        '<span class="si-name">'+nameHtml(b.n)+'</span>' + meta +
        '</div>';
    }).join('');
    searchResultsEl.hidden = false;
  }

  function doSearch(){
    var q = normalize(searchInput.value.trim());
    if (!q){ searchResultsEl.hidden = true; searchResultsEl.innerHTML=''; return; }
    var starts = [], contains = [];
    DATA.all.forEach(function(b){
      var n = normalize(b.n);
      if (n.indexOf(q) === 0) starts.push(b);
      else if (n.indexOf(q) !== -1) contains.push(b);
    });
    renderSearchResults(starts.concat(contains).slice(0,8), searchInput.value.trim());
  }

  function selectPlace(id){
    searchResultsEl.hidden = true;
    searchInput.value = stripExact(placeById[id].n).base;
    searchInput.blur(); // verberg het mobiele toetsenbord zodat de kaart zichtbaar is
    if (!markerIndex[id]) EX.set({ types:null, van:null, tot:null }); // door het filter verborgen? dan het filter wissen
    if (markerIndex[id]) CL.openItem(id, Math.max(map.getZoom(), 13)); // zoomt zo nodig verder in, zodat het bolletje los van een cluster staat
    setTimeout(function(){
      var r = mapWrap.getBoundingClientRect();
      var visible = r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight);
      if (!visible) mapWrap.scrollIntoView({ behavior:'smooth', block:'center' });
    }, 80);
  }

  searchInput.addEventListener('input', doSearch);
  searchInput.addEventListener('focus', function(){ if (searchInput.value.trim()) doSearch(); });
  searchInput.addEventListener('keydown', function(ev){
    if (ev.key === 'Enter'){
      var first = searchResultsEl.querySelector('.search-item');
      if (first) selectPlace(first.getAttribute('data-id'));
      ev.preventDefault();
    } else if (ev.key === 'Escape'){
      searchResultsEl.hidden = true;
    }
  });
  searchResultsEl.addEventListener('click', function(ev){
    var item = ev.target.closest('.search-item');
    if (item) selectPlace(item.getAttribute('data-id'));
  });
  document.addEventListener('click', function(ev){
    if (!ev.target.closest('.map-search')) searchResultsEl.hidden = true;
  });

  window.addEventListener('resize', function(){ map.invalidateSize(); });

  // ---- alles wat uit de meldingen volgt komt uit assets/site.js: verwachting, hotspots, weetjes ----
  WDK.renderForecast(document.getElementById('forecastCard'), { species:'wolf', rows:LOADED.veluwe, scope:'veluwe', updatedAt:LOADED.updatedAt });
  WDK.renderFunFacts(document.getElementById('funCard'), { rows:LOADED.veluwe });
  WDK.renderLivestock(document.getElementById('attackAnimalsCard'), { rows:LOADED.all, mode:'attacks', where:'in heel Nederland' });
  WDK.renderLivestock(document.getElementById('killedCard'), { rows:LOADED.all, mode:'killed', where:'in heel Nederland' });

  render();
})();
