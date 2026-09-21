// Homepage (index.html): meldingentabel, grafiek, filters en kaartlagen; alle cijfers komen uit assets/site.js (WDK).
(function(){
  var map = window.__nlMap;
  if (!map || !window.WDK) return;

  // Alle berekeningen (tellingen, tabel, grafiek, verwachting) komen uit assets/site.js.
  // Een nieuwe diersoort verschijnt hier vanzelf zodra hij in WDK.SPECIES staat en zijn databestand geladen is.
  var TYPE_LABEL = WDK.TYPE_LABEL, fmtDate = WDK.fmtDate, nameHtml = WDK.nameHtml;
  var SPECIES = WDK.loadAll().map(function(d){
    var sp = d.species;
    return { key:sp.key, label:sp.label, plural:sp.plural, mapName:sp.mapName, emoji:sp.emoji, color:sp.color, page:sp.page,
      rows: d.all, data: d };
  });
  if (!SPECIES.length) return;

  function popupHtml(species, b){
    var html = '<div class="tt-name">'+species.emoji+' '+nameHtml(b.n)+'</div>';
    Object.keys(b.c).forEach(function(k){
      if (b.c[k]) html += '<div class="tt-row"><span>'+(TYPE_LABEL[k]||k)+'</span><span>'+b.c[k]+'</span></div>';
    });
    var recent = b.ev.slice(0,5);
    if (recent.length){
      html += '<div class="tt-dates">' + recent.map(function(e){
        return '<div class="date-row">'+fmtDate(e.d)+' &middot; '+(e.diersoort ? WDK.esc(e.diersoort)+' &middot; ' : '')+(TYPE_LABEL[e.ty]||e.ty)+'</div>';
      }).join('') + (b.ev.length>5 ? '<div>+ '+(b.ev.length-5)+' eerdere</div>' : '') + '</div>';
    }
    html += '<div class="tt-dates"><a href="'+species.page+'">Bekijk op de '+species.mapName+'</a></div>';
    return html;
  }

  // ---- legenda: kleurcode van de bolletjes (het filter op soort zit in het paneel "Filter & tijd") ----
  var togglesEl = document.getElementById('mapLegend');
  var chartLegendEl = document.getElementById('chartLegend');
  SPECIES.forEach(function(species){
    if (chartLegendEl){
      chartLegendEl.insertAdjacentHTML('beforeend', '<div class="legend-group"><span class="swatch" style="background:'+species.color+'"></span>'+species.label+'</div>');
    }
    if (!togglesEl) return;
    var item = document.createElement('div');
    item.className = 'legend-group';
    item.innerHTML = '<span class="swatch" style="background:'+species.color+'"></span>'+species.label;
    togglesEl.appendChild(item);
    species.legendItem = item;
  });

  // ---- filterbalk: soort, type, periode, tijdschuif (afspelen), hitte-laag; de stand staat ook in de URL ----
  var EX = WDK.mountExplorer({
    el:document.getElementById('explorer'), map:map, species:SPECIES, onChange:renderMap, heat:false, // hitte-laag alleen op de wolven-/zwijnenpagina
    rows: SPECIES.reduce(function(all, s){ return all.concat(s.rows); }, [])
  });
  window.__nlExplorer = EX;
  // bolletjes die dicht bij elkaar liggen (binnen 5 km) worden één cluster; hoort het cluster bij één soort, dan krijgt het die kleur
  var CL = WDK.clusterLayer(map, { clusterColor: function(list){
    var c = list[0].color;
    return list.every(function(it){ return it.color === c; }) ? c : WDK.CLUSTER_MIXED_COLOR;
  } });
  window.__nlCluster = CL;

  // tekent de bolletjes opnieuw voor het huidige filter (en geeft de punten door aan de hitte-laag)
  function renderMap(){
    var f = EX.get();
    var visible = f.soort || SPECIES.map(function(s){ return s.key; });
    var latest = null, total = 0, places = 0, items = [];
    SPECIES.forEach(function(species){
      var on = visible.indexOf(species.key) > -1;
      if (species.legendItem) species.legendItem.style.opacity = on ? '' : '.45'; // uitgezette soort dimmen in de legenda
      if (!on) return;
      var rows = WDK.applyFilter(species.rows, species.key, f);
      var pm = WDK.placeMarkers(rows, {
        color:function(){ return species.color; },
        popup:function(b){ return popupHtml(species, b); },
        radius:[5, 16], weight:1.2,
        id:function(b){ return species.key + '::' + b.id; }
      });
      items = items.concat(pm.items);
      rows.forEach(function(b){ total += b.t; places++; });
      if (pm.latest && (!latest || pm.latest.ev[0].d > latest.b.ev[0].d)) latest = { b:pm.latest, id:pm.latestId };
    });
    CL.setItems(items, { halo: latest && latest.id });
    EX.setSummary(total, places);
  }
  renderMap();

  // ---- "net binnen gekomen meldingen" tabel: de RECENT_MAX meest recente meldingen over alle soorten (het venster scrolt) ----
  var RECENT_MAX = 25;
  var events = [];
  SPECIES.forEach(function(species){
    WDK.events(species.rows, species).forEach(function(e){ events.push(e); });
  });
  events.sort(WDK.cmpEvents);

  var lastUpdateEl = document.getElementById('lastUpdateNote');
  if (lastUpdateEl){
    var updates = SPECIES.map(function(s){ return s.data.updatedAt; }).filter(Boolean).sort();
    var lastUpdate = updates.length ? updates[updates.length - 1] : null;
    if (lastUpdate){
      var updParts = lastUpdate.split('T');
      var updTime = updParts[1] || '';
      lastUpdateEl.textContent = 'Laatste check op ' + fmtDate(updParts[0]) + (updTime ? ', ' + updTime + ' uur' : '') + '.';
    } else {
      lastUpdateEl.textContent = 'Nog geen meldingen toegevoegd.';
    }
  }

  var recent = events.slice(0, RECENT_MAX);
  var tbody = document.getElementById('recentReportsBody');
  if (tbody && recent.length){
    tbody.innerHTML = recent.map(function(e, i){
      var typeLabel = TYPE_LABEL[e.ty] || e.ty;
      var typeClass = e.ty === 'zichtmelding' ? ' class="rt-type-zicht"' : (e.ty === 'aanval' ? ' class="rt-type-aanval"' : '');
      return '<tr>' +
        '<td class="rt-place" data-label="Plaats">'+nameHtml(e.place)+'</td>' +
        '<td data-label="Datum">'+fmtDate(e.d)+(e.tm ? ', '+e.tm : '')+'</td>' +
        '<td data-label="Dier"><a class="rt-species" href="'+e.species.page+'">'+e.species.emoji+' '+WDK.esc(e.diersoort || e.species.label)+'</a></td>' +
        '<td data-label="Type"'+typeClass+'>'+typeLabel+'</td>' +
        '</tr>';
    }).join('');
  }

  // ---- meldingen per maand + landelijke wolvenverwachting: berekend uit de live data ----
  WDK.renderMonthlyChart(document.getElementById('monthlyChart'), SPECIES);
  var wolf = SPECIES.filter(function(s){ return s.key === 'wolf'; })[0];
  if (wolf){
    WDK.renderForecast(document.getElementById('forecastCard'), {
      species:'wolf', rows:wolf.rows, scope:'nl', updatedAt:wolf.data.updatedAt
    });
  }
})();
