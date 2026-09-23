/* Wilde Dieren in Kaart — gedeelde kaartonderdelen
 *
 * Wat alle kaartpagina's (home, wolven, zwijnen, overig, melden) samen doen, één keer:
 *  - WDK.baseMap        de kaart zelf: Leaflet met kaarttegels die meegaan met licht/donker, de zoomknoppen en het formaat
 *  - WDK.mountSearch    zoekbalk met een lijst resultaten (direct of via een dienst als PDOK)
 *  - WDK.placeMarkers   de bolletjes van een lijst plaatsen (grootte naar aantal, kleur, popup), klaar voor WDK.clusterLayer
 *  - WDK.revealMap      scrolt de kaart in beeld als je hem niet (helemaal) ziet
 * De pagina's houden alleen over wat bij hen hoort: cijfers, popups, kleuren en welke plaatsen er zijn.
 */
(function(root){
  'use strict';
  var WDK = root.WDK, L = root.L;
  if (!WDK || !L) return;

  var LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_3pk1_1_4be88f8eb009c48504d37519';
  var DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_3pk1_1_4be88f8eb009c48504d37519';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>-bijdragers &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';

  function currentMapTheme(){
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return (root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  // id: het element voor de kaart. o: { center:[lat, lon], zoom, buttons? }
  // buttons: ids van de zoomknoppen ({ in, out, reset }, standaard zoomIn/zoomOut/zoomReset); ontbreekt een knop op de pagina, dan slaan we hem over.
  WDK.baseMap = function(id, o){
    var map = L.map(id, { zoomControl:false, scrollWheelZoom:true }).setView(o.center, o.zoom);
    var tileLayer = L.tileLayer(currentMapTheme() === 'dark' ? DARK_TILES : LIGHT_TILES, {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: TILE_ATTR
    }).addTo(map);
    function syncTiles(){ tileLayer.setUrl(currentMapTheme() === 'dark' ? DARK_TILES : LIGHT_TILES); }
    var themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', function(){ setTimeout(syncTiles, 0); });
    if (root.matchMedia) root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTiles);
    root.addEventListener('resize', function(){ map.invalidateSize(); });

    var ids = o.buttons || { 'in':'zoomIn', out:'zoomOut', reset:'zoomReset' };
    function on(btnId, fn){
      var el = btnId && document.getElementById(btnId);
      if (el) el.addEventListener('click', fn);
    }
    on(ids['in'], function(){ map.zoomIn(); });
    on(ids.out, function(){ map.zoomOut(); });
    on(ids.reset, function(){ map.setView(o.center, o.zoom); });
    return map;
  };

  // Zoekbalk. o: {
  //   input, results        de invoerbalk en het element voor de lijst
  //   find(q)               geeft de resultaten voor de zoektekst, of een belofte daarvan: [{ key, name (html), meta (html), metaClass, label }]
  //   onSelect(item)        wordt aangeroepen als er een resultaat is gekozen (klik, Enter of spatie)
  //   debounce              wachttijd in ms na het typen (standaard 0: meteen)
  //   empty(q), error       teksten voor "niets gevonden" en "zoeken lukt niet"
  // }
  // Na een keuze komt `label` (als het er is) in de balk en verdwijnt het toetsenbord, zodat de kaart zichtbaar wordt.
  WDK.mountSearch = function(o){
    var input = o.input, box = o.results, found = [], token = 0, timer = null;

    function show(html){ box.innerHTML = html; box.hidden = false; }
    function render(list, q){
      found = list;
      if (!list.length){
        show('<div class="search-empty">' + (o.empty ? o.empty(q) : 'Geen plaats gevonden voor &ldquo;' + WDK.esc(q) + '&rdquo;.') + '</div>');
        return;
      }
      show(list.map(function(it, i){
        return '<div class="search-item" role="button" tabindex="0" data-i="' + i + '"><span class="si-name">' + it.name + '</span>' +
          (it.meta ? '<span class="si-meta' + (it.metaClass ? ' ' + it.metaClass : '') + '">' + it.meta + '</span>' : '') + '</div>';
      }).join(''));
    }
    function run(){
      var q = input.value.trim();
      if (!q){ box.hidden = true; box.innerHTML = ''; found = []; return; }
      var mine = ++token;   // een oud antwoord dat te laat komt, negeren we
      Promise.resolve(o.find(q)).then(function(list){
        if (mine === token) render(list || [], q);
      }).catch(function(){
        if (mine === token){ found = []; show('<div class="search-empty">' + (o.error || 'Zoeken lukt nu niet.') + '</div>'); }
      });
    }
    function pick(i){
      var it = found[i];
      if (!it) return;
      box.hidden = true;
      if (it.label != null) input.value = it.label;
      input.blur();
      o.onSelect(it);
    }

    input.addEventListener('input', function(){
      clearTimeout(timer);
      if (o.debounce) timer = setTimeout(run, o.debounce); else run();
    });
    input.addEventListener('focus', function(){ if (input.value.trim()) run(); });
    input.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter'){
        ev.preventDefault();
        if (!box.hidden && found.length) pick(0); else run();
      } else if (ev.key === 'Escape'){
        box.hidden = true;
      }
    });
    box.addEventListener('click', function(ev){
      var el = ev.target.closest('.search-item');
      if (el) pick(parseInt(el.getAttribute('data-i'), 10));
    });
    box.addEventListener('keydown', function(ev){
      var el = ev.target.closest('.search-item');
      if (el && (ev.key === 'Enter' || ev.key === ' ')){ ev.preventDefault(); pick(parseInt(el.getAttribute('data-i'), 10)); }
    });
    var container = input.closest('.map-search');
    document.addEventListener('click', function(ev){
      if (!container || !container.contains(ev.target)) box.hidden = true;
    });
    return { hide:function(){ box.hidden = true; } };
  };

  // Bolletjes voor een lijst plaatsen (uit WDK.load/applyFilter). o: {
  //   color(b)              kleur van het bolletje van plaats b
  //   popup(b)              html van de popup
  //   radius:[klein, groot] straal in pixels voor de kleinste en de drukste plaats (standaard 6 en 26)
  //   weight                dikte van de rand (standaard 1.4)
  //   id(b)                 sleutel van de plaats (standaard b.id)
  // }
  // -> { items, latest, latestId }: `items` geef je aan WDK.clusterLayer(...).setItems; `latest` is de plaats met de nieuwste melding
  WDK.placeMarkers = function(rows, o){
    var r = o.radius || [6, 26], maxCount = 1, latest = null, latestId = null;
    rows.forEach(function(b){ if (b.t > maxCount) maxCount = b.t; });
    var items = rows.map(function(b){
      var id = o.id ? o.id(b) : b.id, color = o.color(b);
      var m = L.circleMarker([b.lat, b.lon], {
        radius: r[0] + (r[1] - r[0]) * Math.sqrt(b.t / maxCount),
        color: 'var(--map-surface)',
        weight: o.weight || 1.4,
        fillColor: color,
        fillOpacity: 0.85
      });
      m.bindPopup(o.popup(b), { maxWidth:240 });
      if (b.ev.length && (!latest || b.ev[0].d > latest.ev[0].d)){ latest = b; latestId = id; }
      return { id:id, lat:b.lat, lon:b.lon, g:b.g, w:b.t, rank:WDK.DOM_RANK[b.dom], color:color, marker:m };
    });
    return { items:items, latest:latest, latestId:latestId };
  };

  // Scrolt `el` in beeld (rustig, gecentreerd) als je hem niet helemaal ziet; wacht heel even tot de kaart is bijgewerkt.
  WDK.revealMap = function(el){
    setTimeout(function(){
      var r = el.getBoundingClientRect();
      var visible = r.top >= 0 && r.bottom <= (root.innerHeight || document.documentElement.clientHeight);
      if (!visible) el.scrollIntoView({ behavior:'smooth', block:'center' });
    }, 80);
  };
})(window);
