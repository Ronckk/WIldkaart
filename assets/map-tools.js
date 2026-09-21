/* Wilde Dieren in Kaart — kaartgereedschap (assets/map-tools.js)
 *
 * Bovenop Leaflet en assets/site.js:
 *  - WDK.HeatLayer      dichtheids-/hitte-laag (canvas, zonder extra bibliotheek) die onder de bolletjes ligt
 *  - WDK.mountExplorer  filterbalk voor een kaart: type, periode, tijdschuif met afspelen, hitte-laag,
 *                       en de hele toestand als deelbare URL (?soort=wolf&type=aanval&van=2026-05&tot=2026-08&heat=1)
 *  - WDK.clusterLayer   bolletjes die dicht bij elkaar liggen (binnen 5 km), of uitgezoomd in dezelfde gemeente liggen,
 *                       samenvoegen tot één cluster met het aantal meldingen; bij inzoomen vallen ze weer uit elkaar
 *                       (WDK.clusterPoints is de berekening zelf)
 *
 * De pagina houdt zelf de bolletjes bij: bij elke wijziging roept de balk `onChange(filter)` aan, de pagina
 * filtert met WDK.applyFilter, tekent opnieuw en geeft de punten voor de hitte-laag terug via setHeatPoints.
 */
(function(root){
  'use strict';
  var WDK = root.WDK, L = root.L;
  if (!WDK || !L) return;

  var TYPE_META = {
    zichtmelding: { label:'Zichtmelding',  color:'var(--s-zicht)' },
    aanval:       { label:'Aanval op vee', color:'var(--s-aanval)' },
    jonkies:      { label:'Met jonkies',   color:'var(--pal-4)' },
    overig:       { label:'Overig',        color:'var(--s-overig)' }
  };
  var PLAY_MS = 1000; // duur per maand bij afspelen

  // ---------------------------------------------------------------- hitte-laag
  var palette = null;
  function getPalette(){
    if (palette) return palette;
    var c = document.createElement('canvas');
    c.width = 1; c.height = 256;
    var g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, 'rgba(42,120,214,0)');
    grad.addColorStop(0.15, 'rgba(42,120,214,0.35)');
    grad.addColorStop(0.40, 'rgba(27,175,122,0.55)');
    grad.addColorStop(0.65, 'rgba(237,161,0,0.70)');
    grad.addColorStop(0.85, 'rgba(235,104,52,0.80)');
    grad.addColorStop(1.00, 'rgba(190,30,45,0.88)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1, 256);
    palette = g.getImageData(0, 0, 1, 256).data;
    return palette;
  }

  // Elke plaats tekent een zachte cirkel; waar cirkels overlappen wordt het "heter". Het gewicht staat vast
  // (niet genormaliseerd op de drukste plek), zodat de kleuren tijdens het afspelen vergelijkbaar blijven.
  var HeatLayer = L.Layer.extend({
    initialize: function(){ this._pts = []; this._sprites = {}; },
    onAdd: function(map){
      this._map = map;
      var pane = map.getPane('wdkHeat') || map.createPane('wdkHeat');
      pane.style.zIndex = 390;            // onder de bolletjes (overlayPane = 400)
      pane.style.pointerEvents = 'none';
      var c = this._canvas = document.createElement('canvas');
      c.style.position = 'absolute';
      c.style.left = '0';
      c.style.top = '0';
      pane.appendChild(c);
      map.on('moveend zoomend resize', this._redraw, this);
      map.on('zoomstart', this._hide, this);
      this._redraw();
    },
    onRemove: function(map){
      map.off('moveend zoomend resize', this._redraw, this);
      map.off('zoomstart', this._hide, this);
      if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      this._map = null;
    },
    // pts: [{ lat, lon, w }]  (w = aantal meldingen)
    setPoints: function(pts){ this._pts = pts || []; if (this._map) this._redraw(); },
    _hide: function(){ if (this._canvas) this._canvas.style.visibility = 'hidden'; },
    _sprite: function(r){
      if (this._sprites[r]) return this._sprites[r];
      var c = document.createElement('canvas');
      c.width = c.height = r * 2;
      var g = c.getContext('2d'), grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.4, 'rgba(0,0,0,0.6)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
      return (this._sprites[r] = c);
    },
    _redraw: function(){
      var map = this._map, c = this._canvas;
      if (!map || !c) return;
      var size = map.getSize();
      L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
      c.width = size.x;
      c.height = size.y;
      c.style.visibility = 'visible';
      if (!this._pts.length) return;
      var r = Math.max(22, Math.min(70, Math.round(25 + (map.getZoom() - 7) * 5)));
      var sprite = this._sprite(r), ctx = c.getContext('2d', { willReadFrequently:true });
      this._pts.forEach(function(p){
        var pt = map.latLngToContainerPoint([p.lat, p.lon]);
        if (pt.x < -r || pt.y < -r || pt.x > size.x + r || pt.y > size.y + r) return;
        ctx.globalAlpha = Math.min(1, 0.22 * Math.sqrt(p.w) + 0.08);
        ctx.drawImage(sprite, pt.x - r, pt.y - r);
      });
      ctx.globalAlpha = 1;
      // de opgetelde dekking (0-255) omzetten in kleur
      var img = ctx.getImageData(0, 0, size.x, size.y), d = img.data, pal = getPalette();
      for (var i = 3; i < d.length; i += 4){
        var a = d[i];
        if (a){
          var j = a * 4;
          d[i - 3] = pal[j]; d[i - 2] = pal[j + 1]; d[i - 1] = pal[j + 2]; d[i] = pal[j + 3];
        }
      }
      ctx.putImageData(img, 0, 0);
    }
  });

  // ---------------------------------------------------------------- filterbalk
  // o: { el, map, rows:[alle plaatsen, ongefilterd], species?:[{key,label}] (alleen als er meerdere soorten zijn),
  //      heat?:false (geen hitte-laag), onChange:function(filter) }
  function mountExplorer(o){
    var map = o.map, el = o.el, months = WDK.monthList(o.rows), types = WDK.typesPresent(o.rows);
    var speciesKeys = (o.species || []).map(function(s){ return s.key; });
    var heatEnabled = o.heat !== false; // { heat:false } = geen hitte-laag op deze kaart (bv. de homepage)
    var heat = new HeatLayer();
    var f = WDK.parseFilter(root.location.search);

    // waarden uit de URL die niet bij deze pagina passen, laten we vallen
    if (f.types){
      f.types = f.types.filter(function(t){ return types.indexOf(t) > -1; });
      if (!f.types.length || f.types.length === types.length) f.types = null;
    }
    if (f.soort){
      f.soort = f.soort.filter(function(k){ return speciesKeys.indexOf(k) > -1; });
      if (!f.soort.length || f.soort.length === speciesKeys.length) f.soort = null;
    }

    if (!heatEnabled) f.heat = false;

    var timer = null, cumulative = false;

    el.classList.add('wdk-ex');
    el.innerHTML =
      '<details class="wdk-panel">' +
      '<summary class="wdk-head"><span class="wdk-title">Filter &amp; tijd</span><span class="wdk-badge" hidden>actief</span><span class="wdk-head-sum"></span></summary>' +
      '<div class="wdk-body">' +
      (speciesKeys.length > 1 ?
        '<div class="wdk-row" role="group" aria-label="Filter op diersoort">' +
          '<span class="wdk-label">Soort</span>' +
          o.species.map(function(s){
            return '<button type="button" class="wdk-chip" data-species="' + s.key + '" aria-pressed="true">' +
              '<span class="swatch" style="background:' + s.color + '"></span>' + WDK.esc(s.label) + '</button>';
          }).join('') +
        '</div>' : '') +
      (types.length ? '<div class="wdk-row" role="group" aria-label="Filter op soort melding">' +
        '<span class="wdk-label">Type</span>' +
        types.map(function(t){
          return '<button type="button" class="wdk-chip" data-type="' + t + '" aria-pressed="true">' +
            '<span class="swatch" style="background:' + TYPE_META[t].color + '"></span>' + TYPE_META[t].label + '</button>';
        }).join('') +
      '</div>' : '') +
      '<div class="wdk-row">' +
        '<span class="wdk-label">Periode</span>' +
        '<label class="wdk-field">van <input type="date" class="wdk-date" data-k="van"></label>' +
        '<label class="wdk-field">tot <input type="date" class="wdk-date" data-k="tot"></label>' +
        '<button type="button" class="wdk-btn wdk-reset">Wis filter</button>' +
      '</div>' +
      '<div class="wdk-row wdk-time">' +
        '<span class="wdk-label">Tijd</span>' +
        '<button type="button" class="wdk-play" aria-label="Maanden afspelen"' + (months.length < 2 ? ' disabled' : '') + '>&#9654;</button>' +
        '<input type="range" class="wdk-slider" min="0" max="' + Math.max(0, months.length - 1) + '" step="1" value="0" aria-label="Kies een maand"' + (months.length < 2 ? ' disabled' : '') + '>' +
        '<output class="wdk-month" aria-live="polite"></output>' +
        '<label class="wdk-check"><input type="checkbox" class="wdk-cum"> opgebouwd</label>' +
      '</div>' +
      '<div class="wdk-row wdk-foot">' +
        (heatEnabled ? '<label class="wdk-check"><input type="checkbox" class="wdk-heat"> Hitte-laag</label>' : '') +
        '<span class="wdk-summary" aria-live="polite"></span>' +
        '<button type="button" class="wdk-btn wdk-share">Kopieer link</button>' +
      '</div>' +
      '</div></details>';

    var $ = function(sel){ return el.querySelector(sel); };
    var chips = el.querySelectorAll('.wdk-chip[data-type]'), speciesChips = el.querySelectorAll('.wdk-chip[data-species]');
    var dateInputs = { van:$('[data-k="van"]'), tot:$('[data-k="tot"]') };
    var slider = $('.wdk-slider'), monthOut = $('.wdk-month'), cumBox = $('.wdk-cum');
    var playBtn = $('.wdk-play'), heatBox = $('.wdk-heat'), resetBtn = $('.wdk-reset'), shareBtn = $('.wdk-share');
    var summaryEl = $('.wdk-summary'), panel = $('.wdk-panel'), badge = $('.wdk-badge'), headSum = $('.wdk-head-sum');
    // op een telefoon start het paneel ingeklapt, zodat de kaart meteen in beeld is
    panel.open = !(root.matchMedia && root.matchMedia('(max-width:640px)').matches);

    function copy(){
      return { soort:f.soort ? f.soort.slice() : null, types:f.types ? f.types.slice() : null, van:f.van, tot:f.tot, heat:f.heat };
    }
    function writeUrl(){
      try {
        var url = new URL(root.location.href);
        WDK.filterToParams(f, url.searchParams);
        root.history.replaceState(null, '', url.toString().replace(/%2C/gi, ',')); // komma's leesbaar houden
      } catch (e) {}
    }
    // welke maand hoort bij het huidige van/tot? (-1 = geen)
    function monthIndex(){
      for (var i = 0; i < months.length; i++){
        if (f.tot === months[i].tot && (f.van === months[i].van || !f.van)) return i;
      }
      return -1;
    }
    function sync(){
      chips.forEach(function(c){
        var on = f.types ? f.types.indexOf(c.getAttribute('data-type')) > -1 : true;
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      speciesChips.forEach(function(c){
        var on = f.soort ? f.soort.indexOf(c.getAttribute('data-species')) > -1 : true;
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      dateInputs.van.value = f.van || '';
      dateInputs.tot.value = f.tot || '';
      var idx = monthIndex();
      if (idx > -1){
        slider.value = idx;
        cumulative = !f.van;
        monthOut.textContent = months[idx].label + (cumulative ? ' (t/m)' : '');
      } else {
        monthOut.textContent = (f.van || f.tot) ? 'eigen periode' : 'alle maanden';
      }
      cumBox.checked = cumulative;
      if (heatBox) heatBox.checked = !!f.heat;
      resetBtn.disabled = WDK.isEmptyFilter(f) && !f.soort;
      badge.hidden = WDK.isEmptyFilter(f) && !f.soort && !f.heat;
      if (f.heat && !map.hasLayer(heat)) map.addLayer(heat);
      if (!f.heat && map.hasLayer(heat)) map.removeLayer(heat);
    }
    function setPlaying(on){
      if (!on && timer){ clearInterval(timer); timer = null; }
      playBtn.innerHTML = on ? '&#10074;&#10074;' : '&#9654;';
      playBtn.setAttribute('aria-label', on ? 'Afspelen pauzeren' : 'Maanden afspelen');
      playBtn.classList.toggle('is-playing', !!on);
    }
    function update(patch, opts){
      Object.keys(patch).forEach(function(k){ f[k] = patch[k]; });
      if (!heatEnabled) f.heat = false;
      if (f.van && f.tot && f.van > f.tot){ var t = f.van; f.van = f.tot; f.tot = t; }
      sync();
      writeUrl();
      if (!(opts && opts.silent) && o.onChange) o.onChange(copy());
    }
    function setMonth(i){
      var m = months[i];
      if (!m) return;
      update({ van: cumulative ? null : m.van, tot: m.tot });
    }

    chips.forEach(function(c){
      c.addEventListener('click', function(){
        setPlaying(false);
        var t = c.getAttribute('data-type');
        var cur = f.types ? f.types.slice() : types.slice();
        var i = cur.indexOf(t);
        if (i > -1) cur.splice(i, 1); else cur.push(t);
        // alles aan = geen filter; alles uit kan niet (dan houden we het laatste type aan)
        if (cur.length === types.length) cur = null;
        else if (!cur.length) cur = [t];
        update({ types: cur ? types.filter(function(x){ return cur.indexOf(x) > -1; }) : null });
      });
    });
    speciesChips.forEach(function(c){
      c.addEventListener('click', function(){
        setPlaying(false);
        var k = c.getAttribute('data-species');
        var cur = f.soort ? f.soort.slice() : speciesKeys.slice();
        var i = cur.indexOf(k);
        if (i > -1) cur.splice(i, 1); else cur.push(k);
        // alles aan = geen filter; alles uit kan niet (dan houden we de laatste soort aan)
        if (cur.length === speciesKeys.length) cur = null;
        else if (!cur.length) cur = [k];
        update({ soort: cur ? speciesKeys.filter(function(x){ return cur.indexOf(x) > -1; }) : null });
      });
    });
    ['van', 'tot'].forEach(function(k){
      dateInputs[k].addEventListener('change', function(){
        setPlaying(false);
        var p = {};
        p[k] = dateInputs[k].value || null;
        update(p);
      });
    });
    resetBtn.addEventListener('click', function(){ setPlaying(false); cumulative = false; update({ soort:null, types:null, van:null, tot:null }); });
    slider.addEventListener('input', function(){ setPlaying(false); setMonth(parseInt(slider.value, 10)); });
    cumBox.addEventListener('change', function(){
      setPlaying(false);
      cumulative = cumBox.checked;
      setMonth(parseInt(slider.value, 10));
    });
    playBtn.addEventListener('click', function(){
      if (timer){ setPlaying(false); return; }
      if (months.length < 2) return;
      var idx = monthIndex();
      var i = (idx < 0 || idx >= months.length - 1) ? 0 : idx + 1; // vanaf het einde begint hij opnieuw
      cumulative = cumBox.checked;
      setMonth(i);
      setPlaying(true);
      timer = setInterval(function(){
        i++;
        if (i >= months.length){ setPlaying(false); return; }
        setMonth(i);
      }, PLAY_MS);
    });
    if (heatBox) heatBox.addEventListener('change', function(){ update({ heat:heatBox.checked }, { silent:true }); });
    shareBtn.addEventListener('click', function(){
      var url = root.location.href, label = shareBtn.textContent;
      function done(t){ shareBtn.textContent = t; setTimeout(function(){ shareBtn.textContent = label; }, 1800); }
      if (root.navigator.clipboard && root.navigator.clipboard.writeText){
        root.navigator.clipboard.writeText(url).then(function(){ done('Gekopieerd'); }, function(){ root.prompt('Kopieer deze link:', url); });
      } else {
        root.prompt('Kopieer deze link:', url);
      }
    });

    sync();

    return {
      get: copy,
      // patch: { soort, types, van, tot, heat }; { silent:true } = niet opnieuw laten tekenen
      set: function(patch, opts){ setPlaying(false); update(patch, opts); },
      setHeatPoints: function(pts){ heat.setPoints(pts); },
      // aantal meldingen en plaatsen in de huidige selectie
      setSummary: function(total, places){
        var text = total
          ? total + (total === 1 ? ' melding' : ' meldingen') + ' in ' + places + (places === 1 ? ' plaats' : ' plaatsen')
          : (o.rows.length ? 'Geen meldingen voor deze selectie' : 'Nog geen meldingen');
        summaryEl.textContent = text;
        headSum.textContent = text;
      },
      months: months
    };
  }

  // ---------------------------------------------------------------- clusteren
  // Meldingen die dicht bij elkaar liggen worden één bolletje met het totaal aantal meldingen. "Dicht bij elkaar" is
  // hoogstens CLUSTER.maxKm in werkelijkheid én hoogstens CLUSTER.maxPx op het scherm: zo staan bolletjes die elkaar
  // overlappen niet meer in de weg, en vallen ze uit elkaar zodra je genoeg inzoomt. Verder gaan bolletjes die in dezelfde
  // gemeente liggen (item.g) samen zolang het zoomniveau lager is dan CLUSTER.gemeenteZoom, hoe ver ze ook uit elkaar staan.
  // Vanaf CLUSTER.noClusterZoom staat elk bolletje los. De berekening (clusterPoints) heeft geen Leaflet nodig.
  var CLUSTER = { maxKm:5, maxPx:60, noClusterZoom:16, gemeenteZoom:10 };
  var MIXED_COLOR = '#6b6b66'; // cluster met bolletjes van verschillende kleur (bv. meerdere diersoorten op de homepage)
  var DOM_RANK = { aanval:0, jonkies:1, zichtmelding:2, overig:3 }; // welke soort melding de kleur van een cluster bepaalt

  function mercator(lat, lon, z){ // wereldpixels bij zoom z (tegels van 256 px), zoals Leaflet ze gebruikt
    var scale = 256 * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180);
    return { x:(lon + 180) / 360 * scale, y:(0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
  }
  function metersPerPx(lat, z){ return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z); }

  // items: [{ id, lat, lon, w, g? }]  ->  [{ items:[...], lat, lon, w, g }]
  // (lat/lon = middelpunt, gewogen op w = aantal meldingen; g = de gemeente als alle items daar liggen)
  // Onder CLUSTER.gemeenteZoom vormen de items van één gemeente eerst samen één blok; daarna gaan blokken die dicht bij elkaar
  // liggen samen. Grootste eerst als kern; alles binnen de straal van een kern hoort erbij. Zo is de uitkomst niet afhankelijk
  // van de volgorde.
  function clusterPoints(items, z, opts){
    var o = { maxKm:CLUSTER.maxKm, maxPx:CLUSTER.maxPx, noClusterZoom:CLUSTER.noClusterZoom, gemeenteZoom:CLUSTER.gemeenteZoom };
    for (var k in (opts || {})) o[k] = opts[k];
    function make(list){
      var w = 0, lat = 0, lon = 0, g = list[0].g || null;
      list.forEach(function(it){ var x = it.w || 1; w += x; lat += it.lat * x; lon += it.lon * x; if (it.g !== g) g = null; });
      return { items:list, lat:lat / w, lon:lon / w, w:w, g:g };
    }
    if (z >= o.noClusterZoom) return items.map(function(it){ return make([it]); });
    var blocks = [], byGemeente = {};
    items.forEach(function(it){
      if (!it.g || z >= o.gemeenteZoom){ blocks.push([it]); return; }
      if (!byGemeente[it.g]){ byGemeente[it.g] = []; blocks.push(byGemeente[it.g]); }
      byGemeente[it.g].push(it);
    });
    var pts = blocks.map(function(list){
      var m = make(list), p = mercator(m.lat, m.lon, z), id = list[0].id;
      list.forEach(function(it){ if (it.id < id) id = it.id; });
      return { list:list, w:m.w, lat:m.lat, id:id, x:p.x, y:p.y, used:false };
    });
    pts.sort(function(a, b){ return b.w - a.w || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    var out = [];
    pts.forEach(function(seed){
      if (seed.used) return;
      seed.used = true;
      var r = Math.min(o.maxPx, o.maxKm * 1000 / metersPerPx(seed.lat, z)), r2 = r * r, list = seed.list.slice();
      pts.forEach(function(q){
        if (q.used) return;
        var dx = q.x - seed.x, dy = q.y - seed.y;
        if (dx * dx + dy * dy <= r2){ q.used = true; list = list.concat(q.list); }
      });
      out.push(make(list));
    });
    return out;
  }

  // Een kaartlaag die de bolletjes (items) laat zien als losse punten of clusters, afhankelijk van het zoomniveau.
  //   item = { id, lat, lon, w (aantal meldingen), rank (lager = belangrijker voor de kleur), color, marker (het losse bolletje, met popup) }
  //   o.clusterColor(items) mag de kleur van een cluster anders bepalen (standaard: de kleur van het belangrijkste bolletje)
  function ClusterLayer(map, o){
    this._map = map;
    this._o = o || {};
    this._items = [];
    this._byId = {};
    this._singles = L.layerGroup().addTo(map);   // losse bolletjes: blijven staan zolang ze los blijven (een open popup blijft dus open)
    this._extra = L.layerGroup().addTo(map);     // clusters en de pulserende ring; wordt bij elke zoom opnieuw opgebouwd
    this._shown = {};
    this._halo = null;
    map.on('zoomend', this._draw, this);
  }
  ClusterLayer.prototype = {
    setItems: function(items, opts){
      var self = this;
      this._items = items;
      this._byId = {};
      items.forEach(function(it){ self._byId[it.id] = it; });
      this._halo = (opts && opts.halo) || null;
      this._singles.clearLayers();
      this._shown = {};
      this._draw();
    },
    has: function(id){ return !!this._byId[id]; },
    _color: function(list){
      if (this._o.clusterColor) return this._o.clusterColor(list);
      var best = list.reduce(function(a, b){
        return ((b.rank == null ? 9 : b.rank) < (a.rank == null ? 9 : a.rank) || ((b.rank == null ? 9 : b.rank) === (a.rank == null ? 9 : a.rank) && (b.w || 1) > (a.w || 1))) ? b : a;
      });
      return best.color || MIXED_COLOR;
    },
    _draw: function(){
      var self = this, map = this._map, clusters = clusterPoints(this._items, map.getZoom(), this._o);
      this._extra.clearLayers();
      var keep = {};
      clusters.forEach(function(c){
        var color = self._color(c.items);
        if (c.items.length === 1){
          var it = c.items[0];
          keep[it.id] = true;
          if (!self._shown[it.id]){ it.marker.addTo(self._singles); self._shown[it.id] = it.marker; }
          if (it.id === self._halo) self._ring(it.lat, it.lon, it.marker.getRadius(), color);
          return;
        }
        var d = Math.max(16, Math.min(34, 13 + 3.2 * Math.sqrt(c.w))), size = Math.round(d * 2);
        var title = c.w + ' meldingen ' + (c.g ? 'in gemeente ' + c.g : 'op ' + c.items.length + ' plekken') + '. Klik om in te zoomen.';
        var icon = L.divIcon({ className:'wdk-cluster-icon', iconSize:[size, size],
          html:'<div class="wdk-cluster" style="--c:' + color + '"><span>' + c.w + '</span></div>' });
        var mk = L.marker([c.lat, c.lon], { icon:icon, title:title, alt:title, keyboard:true }).addTo(self._extra);
        mk.on('click', function(){ self._zoomInto(c); });
        if (c.items.some(function(it){ return it.id === self._halo; })) self._ring(c.lat, c.lon, d, color);
      });
      Object.keys(this._shown).forEach(function(id){
        if (!keep[id]){ self._singles.removeLayer(self._shown[id]); delete self._shown[id]; }
      });
    },
    _ring: function(lat, lon, radius, color){
      L.circleMarker([lat, lon], { radius:radius, className:'pulse-halo', color:color, weight:2, fill:false, interactive:false }).addTo(this._extra);
    },
    // inzoomen tot (minstens) een deel van het cluster los komt te staan
    _zoomInto: function(c){
      var map = this._map, o = this._o, bounds = L.latLngBounds(c.items.map(function(it){ return [it.lat, it.lon]; }));
      var z = Math.max(map.getZoom() + 1, Math.min(map.getBoundsZoom(bounds, false, L.point(60, 60)), CLUSTER.noClusterZoom));
      while (z < CLUSTER.noClusterZoom && clusterPoints(c.items, z, o).length === 1) z++;
      map.flyTo(bounds.getCenter(), z, { duration:0.5 });
    },
    _singleAt: function(it, z){
      var cl = clusterPoints(this._items, z, this._o);
      for (var i = 0; i < cl.length; i++){
        if (cl[i].items.length === 1 && cl[i].items[0].id === it.id) return true;
      }
      return false;
    },
    // Vliegt naar een bolletje en opent zijn popup; zoomt minstens zo ver in dat het bolletje los van andere staat.
    openItem: function(id, minZoom){
      var it = this._byId[id], map = this._map, self = this;
      if (!it) return false;
      var z = Math.max(minZoom || 0, 0);
      while (z < CLUSTER.noClusterZoom && !this._singleAt(it, z)) z++;
      var target = L.latLng(it.lat, it.lon);
      function open(){ if (it.marker._map) it.marker.openPopup(); }
      if (map.getZoom() === z && map.getCenter().distanceTo(target) < 1){ open(); return true; }
      map.once('moveend', open);   // moveend komt ná zoomend, dus het bolletje is dan al getekend
      map.flyTo(target, z, { duration:0.6 });
      return true;
    }
  };

  WDK.DOM_RANK = DOM_RANK;
  WDK.CLUSTER_MIXED_COLOR = MIXED_COLOR;
  WDK.clusterPoints = clusterPoints;
  WDK.clusterLayer = function(map, o){ return new ClusterLayer(map, o); };

  WDK.HeatLayer = HeatLayer;
  WDK.mountExplorer = mountExplorer;
})(window);
