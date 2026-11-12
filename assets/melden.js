// Pagina "Meld een waarneming" (melden.html): de bezoeker kiest de plek op de kaart of met GPS en gaat daarna naar het
// SeaTable-formulier met de coördinaten al ingevuld (WDK.FORMS en WDK.PREFILL in assets/site.js). Alles gebeurt in de browser:
// er is geen server en geen token; de plek reist alleen mee in het adres van het formulier.
// Bij een AANVAL op vee kiest de bezoeker alleen een plaats of dorp (geen kaart, geen GPS): er gaat het middelpunt van die
// plaats naar het formulier, nooit een exacte plek. Zo kan niemand de getroffen boer opzoeken. (De sync zet aanvallen ook zelf
// op het dorpsmiddelpunt, voor het geval iemand het formulier toch met een exacte plek invult: tools/seatable_sync.py.)
(function(){
  var WDK = window.WDK;
  var PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/';
  var INITIAL_CENTER = [52.18, 5.30], INITIAL_ZOOM = 7;

  var $ = function(id){ return document.getElementById(id); };
  var goBtn = $('goBtn'), goHint = $('goHint'), picked = $('picked'), locateBtn = $('locateBtn'), locateLabel = $('locateLabel');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('#typeTabs .tab'));

  var type = 'zichtmelding', pos = null;

  // ---------------------------------------------------------------- soort melding
  var wanted = new URLSearchParams(window.location.search).get('type');
  if (WDK.FORMS[wanted]) type = wanted;

  function setType(t, focus){
    type = t;
    tabs.forEach(function(b){
      var on = b.getAttribute('data-type') === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    $('plainLink').href = WDK.FORMS[t].url;
    // aanval: alleen een plaats kiezen (geen kaart); een eerder gekozen plek hoort niet mee naar het andere formulier
    var townOnly = t === 'aanval';
    $('mapCard').hidden = townOnly;
    $('townCard').hidden = !townOnly;
    pos = null;
    if (marker){ map.removeLayer(marker); marker = null; }
    clearAccuracy();
    picked.textContent = 'Nog geen plek gekozen.';
    $('townPicked').textContent = 'Nog geen plaats gekozen.';
    $('townSearch').value = '';
    if (!townOnly) setTimeout(function(){ map.invalidateSize(); }, 0); // de kaart was verborgen en heeft zijn formaat nodig
    if (window.history && window.history.replaceState){
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('type', t);
        window.history.replaceState(null, '', url.toString());
      } catch (e) {}
    }
    updateGo();
  }
  tabs.forEach(function(b, i){
    b.addEventListener('click', function(){ setType(b.getAttribute('data-type')); });
    b.addEventListener('keydown', function(ev){ // pijltjestoetsen wisselen binnen de groep, zoals bij radioknoppen
      var d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      ev.preventDefault();
      setType(tabs[(i + d + tabs.length) % tabs.length].getAttribute('data-type'), true);
    });
  });

  // ---------------------------------------------------------------- kaart
  var map = WDK.baseMap('map', { center:INITIAL_CENTER, zoom:INITIAL_ZOOM }); // tegels, licht/donker en de zoomknoppen: assets/map-base.js

  var marker = null, accuracy = null, lookupToken = 0;

  function fmt(n, digits){ return n.toFixed(digits).replace('.', ','); }

  // Zet de pin (of verplaatst hem) en werkt tekst en knop bij. `note` is een extra zin onder de gekozen plek (bv. de GPS-nauwkeurigheid).
  function setPos(lat, lon, note){
    pos = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
    if (!marker){
      marker = L.marker([pos.lat, pos.lon], { draggable:true, title:'Gekozen plek (sleep om te verplaatsen)', alt:'Gekozen plek' }).addTo(map);
      marker.on('dragstart', function(){ clearAccuracy(); });
      marker.on('dragend', function(){ var ll = marker.getLatLng(); setPos(ll.lat, ll.lng); });
    } else {
      marker.setLatLng([pos.lat, pos.lon]);
    }
    var coords = fmt(pos.lat, 5) + ', ' + fmt(pos.lon, 5);
    picked.innerHTML = 'Gekozen plek: <b class="mp-place" id="pickedPlace">plaats opzoeken&hellip;</b> <span class="mp-coords">(' + coords + ')</span>' +
      (note ? ' ' + note : '') + '<span id="pickedWarn"></span>';
    lookupPlace(pos.lat, pos.lon);
    updateGo();
  }

  // Dichtstbijzijnde woonplaats, alleen ter bevestiging voor de bezoeker. Lukt het niet, dan blijven de coördinaten staan.
  function lookupPlace(lat, lon){
    var mine = ++lookupToken;
    var q = 'reverse?type=woonplaats&rows=1&distance=5000&fl=woonplaatsnaam&lat=' + lat + '&lon=' + lon;
    fetch(PDOK + q).then(function(r){ return r.json(); }).then(function(j){
      if (mine !== lookupToken) return; // intussen is de pin al weer verplaatst
      var docs = (j.response && j.response.docs) || [], el = $('pickedPlace'), warn = $('pickedWarn');
      if (el) el.textContent = docs.length ? docs[0].woonplaatsnaam : 'geen Nederlandse woonplaats in de buurt';
      if (warn && !docs.length) warn.innerHTML = ' <span class="mp-warn">Ligt deze plek buiten Nederland? Controleer de pin.</span>';
    }).catch(function(){
      var el = $('pickedPlace');
      if (mine === lookupToken && el) el.textContent = 'plek op de kaart';
    });
  }

  function clearAccuracy(){
    if (accuracy){ map.removeLayer(accuracy); accuracy = null; }
  }

  map.on('click', function(ev){ clearAccuracy(); setPos(ev.latlng.lat, ev.latlng.lng); });

  $('centerBtn').addEventListener('click', function(){
    var c = map.getCenter();
    clearAccuracy();
    setPos(c.lat, c.lng, map.getZoom() < 13 ? 'Zoom in en versleep de pin voor een nauwkeurigere plek.' : '');
  });

  // ---------------------------------------------------------------- knop "verder"
  function formUrl(){
    var f = WDK.FORMS[type];
    if (!pos) return f.url;
    return f.url + '?prefill_' + encodeURIComponent(WDK.PREFILL.lat) + '=' + pos.lat + '&prefill_' + encodeURIComponent(WDK.PREFILL.lon) + '=' + pos.lon;
  }
  function updateGo(){
    var ready = !!pos;
    goBtn.classList.toggle('is-disabled', !ready);
    goBtn.setAttribute('aria-disabled', ready ? 'false' : 'true');
    if (ready) goBtn.href = formUrl(); else goBtn.removeAttribute('href');
    var townOnly = type === 'aanval';
    goHint.textContent = ready
      ? 'Je gaat naar het formulier “' + WDK.FORMS[type].label + '”. De ' + (townOnly ? 'plaats' : 'plek') + ' is al ingevuld; jij geeft nog het ' +
        (townOnly ? 'vee, het aantal en de datum' : 'dier en de datum') + ' door.'
      : (townOnly ? 'Kies eerst de plaats waar het was.' : 'Kies eerst een plek op de kaart.');
  }
  goBtn.addEventListener('click', function(ev){
    if (pos) return;
    ev.preventDefault();
    if (type === 'aanval'){
      goHint.textContent = 'Kies eerst de plaats waar het was, dan kun je verder.';
      $('townSearch').scrollIntoView({ behavior:'smooth', block:'center' });
      return;
    }
    goHint.textContent = 'Kies eerst een plek op de kaart, dan kun je verder.';
    $('map').scrollIntoView({ behavior:'smooth', block:'center' });
  });

  // ---------------------------------------------------------------- huidige locatie (GPS)
  // Een melding over het bepalen van de locatie: staat er al een pin, dan blijft de gekozen plek zichtbaar.
  function say(msg){
    if (pos) setPos(pos.lat, pos.lon, msg); else picked.textContent = msg;
  }
  function resetLocateBtn(){ locateBtn.disabled = false; locateLabel.textContent = 'Gebruik mijn locatie'; }
  locateBtn.addEventListener('click', function(){
    if (!navigator.geolocation){
      say('Deze browser kan je locatie niet bepalen. Tik op de kaart of zoek een plaats.');
      return;
    }
    locateBtn.disabled = true;
    locateLabel.textContent = 'Locatie zoeken…';
    navigator.geolocation.getCurrentPosition(function(p){
      resetLocateBtn();
      var lat = p.coords.latitude, lon = p.coords.longitude, acc = Math.round(p.coords.accuracy || 0);
      clearAccuracy();
      var note = '';
      if (acc){
        accuracy = L.circle([lat, lon], { radius: acc, color:'var(--s-zicht)', weight:1, fillOpacity:0.08, interactive:false }).addTo(map);
        note = 'Nauwkeurigheid ongeveer ' + acc + ' m.' + (acc > 300 ? ' Versleep de pin naar de juiste plek.' : '');
      }
      setPos(lat, lon, note);
      map.setView([lat, lon], acc > 300 ? 14 : 16);
    }, function(err){
      resetLocateBtn();
      say(err.code === 1
        ? 'Je hebt geen toestemming gegeven voor je locatie. Sta die toe in je browser, of tik op de kaart.'
        : err.code === 3
          ? 'Het bepalen van je locatie duurde te lang. Probeer het opnieuw, of tik op de kaart.'
          : 'Je locatie kon niet worden bepaald. Tik op de kaart, of zoek een plaats.');
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:60000 });
  });

  // ---------------------------------------------------------------- plaats of straat zoeken (verplaatst alleen de kaart)
  // De pin zetten we hier bewust niet: het middelpunt van een dorp is niet de plek van je waarneming.
  var KIND = { woonplaats:['Plaats', 13], weg:['Straat', 15], gemeente:['Gemeente', 12] };

  function findPlaces(q){
    return fetch(PDOK + 'free?rows=8&fl=weergavenaam,centroide_ll,type&fq=' + encodeURIComponent('type:(woonplaats OR weg OR gemeente)') + '&q=' + encodeURIComponent(q))
      .then(function(r){ return r.json(); }).then(function(j){
        return ((j.response && j.response.docs) || []).map(function(d){
          var m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d.centroide_ll || '');
          return m && KIND[d.type] ? { key:d.weergavenaam, label:d.weergavenaam, name:WDK.esc(d.weergavenaam), meta:KIND[d.type][0],
            lat:parseFloat(m[2]), lon:parseFloat(m[1]), zoom:KIND[d.type][1] } : null;
        }).filter(Boolean);
      });
  }
  WDK.mountSearch({ input:$('placeSearch'), results:$('searchResults'), find:findPlaces, debounce:300,
    error:'Zoeken lukt nu niet. Verplaats de kaart zelf, of gebruik je locatie.',
    onSelect:function(item){ map.flyTo([item.lat, item.lon], item.zoom, { duration:0.6 }); } });

  // ---------------------------------------------------------------- aanval: alleen de plaats of het dorp
  // Er gaat het middelpunt van de gekozen plaats naar het formulier (PDOK), nooit een exacte plek.
  function findTowns(q){
    return fetch(PDOK + 'free?rows=8&fl=weergavenaam,centroide_ll,type&fq=' + encodeURIComponent('type:woonplaats') + '&q=' + encodeURIComponent(q))
      .then(function(r){ return r.json(); }).then(function(j){
        return ((j.response && j.response.docs) || []).map(function(d){
          var m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d.centroide_ll || '');
          return m ? { key:d.weergavenaam, label:d.weergavenaam, name:WDK.esc(d.weergavenaam), meta:'Plaats',
            lat:parseFloat(m[2]), lon:parseFloat(m[1]) } : null;
        }).filter(Boolean);
      });
  }
  WDK.mountSearch({ input:$('townSearch'), results:$('townResults'), find:findTowns, debounce:300,
    empty:function(q){ return 'Geen plaats gevonden voor &ldquo;' + WDK.esc(q) + '&rdquo;. Probeer de naam van het dorp.'; },
    error:'Zoeken lukt nu niet. Probeer het over een minuut opnieuw.',
    onSelect:function(item){
      pos = { lat: Math.round(item.lat * 1e6) / 1e6, lon: Math.round(item.lon * 1e6) / 1e6 };
      $('townPicked').innerHTML = 'Gekozen plaats: <b class="mp-place">' + item.name + '</b>';
      updateGo();
    } });
  $('townSearch').addEventListener('input', function(){ // een nieuwe zoekopdracht wist de gekozen plaats
    if (!pos) return;
    pos = null;
    $('townPicked').textContent = 'Nog geen plaats gekozen.';
    updateGo();
  });

  setType(type);
})();
