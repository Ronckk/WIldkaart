// Homepage (index.html): meldingentabel, grafiek per maand en wolvenverwachting; alle cijfers komen uit assets/site.js (WDK).
// De landelijke kaart staat niet meer op de homepage: elke diersoort heeft een eigen pagina met kaart (zie de knoppen op index.html).
(function(){
  if (!window.WDK) return;

  // Alle berekeningen (tellingen, tabel, grafiek, verwachting) komen uit assets/site.js.
  // Een nieuwe diersoort verschijnt hier vanzelf zodra hij in WDK.SPECIES staat en zijn databestand geladen is.
  var TYPE_LABEL = WDK.TYPE_LABEL, fmtDate = WDK.fmtDate, nameHtml = WDK.nameHtml;
  var SPECIES = WDK.loadAll().map(function(d){
    var sp = d.species;
    return { key:sp.key, label:sp.label, plural:sp.plural, mapName:sp.mapName, emoji:sp.emoji, color:sp.color, page:sp.page,
      rows: d.all, data: d };
  });
  if (!SPECIES.length) return;

  // ---- legenda van de grafiek: kleurcode per diersoort ----
  var chartLegendEl = document.getElementById('chartLegend');
  if (chartLegendEl){
    SPECIES.forEach(function(species){
      chartLegendEl.insertAdjacentHTML('beforeend', '<div class="legend-group"><span class="swatch" style="background:'+species.color+'"></span>'+species.label+'</div>');
    });
  }

  // ---- "net binnen gekomen meldingen" tabel: de RECENT_MAX meest recente meldingen over alle soorten (geen scrollvenster) ----
  var RECENT_MAX = 10; // houd gelijk aan RECENT_MAX in render_home_page (tools/seatable_sync.py)
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
