/* Wilde Dieren in Kaart — gedeelde data-laag
 *
 * Alles wat uit de meldingen wordt berekend staat hier, één keer, voor elke diersoort:
 * tellingen per plaats, statistieken, "laatste 2 weken", de weekverwachting, de hotspots,
 * de weetjes en de grafiek per maand. De pagina's (index/wolven/zwijnen) tekenen alleen nog
 * de kaart en roepen deze functies aan.
 *
 * De enige bron van waarheid is de lijst gebeurtenissen (`ev`) per plaats. Getallen die daaruit
 * volgen (`t`, `c`, `dom`, `last2w`, `meta`) worden hier opnieuw berekend en dus niet meer met de
 * hand bijgehouden — zie `validate()` voor een controle op de oude, handmatige velden.
 *
 * Een nieuwe diersoort toevoegen = een databestand (`window.XXX_DATA`) + één blok in SPECIES.
 */
(function(root){
  'use strict';

  var MONTHS = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  var TYPE_LABEL = {
    zichtmelding:'Zichtmelding', aanval:'Aanval op vee', jonkies:'Met jonkies gezien',
    aanrijding:'Aanrijding', schurft:'Schurft', overig:'Overig'
  };
  // Alle typen die niet zicht/aanval/jonkies zijn (aanrijding, schurft, overig) tellen als "overig".
  var BUCKETS = ['zichtmelding','aanval','jonkies','overig'];

  var SCOPE = {
    nl:      { of:'heel Nederland', where:'in heel Nederland' },
    veluwe:  { of:'de Veluwe',      where:'op de Veluwe' }
  };

  // ---------------------------------------------------------------- diersoorten
  var SPECIES = {
    wolf: {
      key:'wolf', label:'Wolf', plural:'wolven', meldingLabel:'Wolvenmelding',
      emoji:'🐺', color:'var(--pal-7)', page:'wolven', dataVar:'WOLVEN_DATA',
      // welke soort melding bepaalt de kleur van een plaats (eerste die voorkomt wint)
      dominantOrder:['aanval','jonkies','zichtmelding'],
      forecast:{
        title:'Wanneer en waar slaat de wolf de komende weken waarschijnlijk toe?',
        noticeIntro:'Dit is <b>geen voorspelling</b> van een specifieke aanval &mdash; een wolf houdt zich niet aan een agenda.',
        activityPhrase:'waar het de laatste tijd het vaakst raak was',
        hotspotTypes:['aanval'],
        hotspotHeading:'Waar is het nu het vaakst raak?',
        hotspotNoun:'aanvalsmeldingen',
        cta:'Weet je van een wolvenmelding op de Veluwe? Geef ‘m door, dan groeit deze kaart mee.'
      }
    },
    zwijn: {
      key:'zwijn', label:'Zwijn', plural:'zwijnen', meldingLabel:'Zwijnenmelding',
      emoji:'🐗', color:'var(--species-zwijn)', page:'zwijnen', dataVar:'ZWIJNEN_DATA',
      dominantOrder:['aanval','jonkies','zichtmelding'],
      forecast:{
        title:'Wanneer worden zwijnen de komende weken waarschijnlijk gemeld?',
        noticeIntro:'Dit is <b>geen voorspelling</b> van waar een zwijn zich laat zien &mdash; zwijnen houden zich niet aan een agenda.',
        activityPhrase:'waar het de laatste tijd het vaakst gemeld werd',
        hotspotTypes:null, // alle soorten meldingen
        hotspotHeading:'Waar wordt het nu het vaakst gemeld?',
        hotspotNoun:'meldingen',
        cta:'Weet je van een zwijnenmelding op de Veluwe (met of zonder schade)? Geef ‘m door, dan groeit deze kaart mee.'
      }
    }
  };
  var SPECIES_ORDER = ['wolf','zwijn'];

  // ---------------------------------------------------------------- tekst & datum
  function esc(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function normalizeText(s){
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  }
  // plaatsnamen die eindigen op "(exacte locatie)" tonen we als naam + vinkje i.p.v. de letterlijke tekst
  var EXACT_SUFFIX = / \(exacte locatie\)$/;
  function stripExact(n){
    var m = EXACT_SUFFIX.test(n);
    return { base: n.replace(EXACT_SUFFIX, ''), exact: m };
  }
  function nameHtml(n){
    var s = stripExact(n);
    return esc(s.base) + (s.exact ? '<span class="exact-badge" title="Exacte locatie">&#10003;</span>' : '');
  }

  function pad(n){ return n < 10 ? '0'+n : ''+n; }
  function parseISO(iso){ var p = iso.split('-'); return new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10)); }
  function toISO(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function daysBetween(a, b){ return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
  function mondayOf(d){
    var x = startOfDay(d);
    var day = x.getDay();
    return addDays(x, day === 0 ? -6 : 1 - day);
  }
  function fmtDate(iso){
    var p = iso.split('-');
    return parseInt(p[2],10) + ' ' + MONTHS[parseInt(p[1],10)-1] + ' ' + p[0];
  }
  function fmtDM(d){ return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function fmtMonthYear(d){ return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  // 6–19 sep 2026  /  29 aug–11 sep 2026  /  29 dec 2026–11 jan 2027
  function fmtSpan(a, b, withYear){
    if (a.getFullYear() !== b.getFullYear()) return fmtDM(a) + ' ' + a.getFullYear() + '–' + fmtDM(b) + ' ' + b.getFullYear();
    var y = withYear ? ' ' + b.getFullYear() : '';
    if (a.getMonth() === b.getMonth()) return a.getDate() + '–' + b.getDate() + ' ' + MONTHS[b.getMonth()] + y;
    return fmtDM(a) + '–' + fmtDM(b) + y;
  }
  function meldingen(n){ return n + ' ' + (n === 1 ? 'melding' : 'meldingen'); }

  // ---------------------------------------------------------------- laden & normaliseren
  function bucketOf(ty){ return (ty === 'zichtmelding' || ty === 'aanval' || ty === 'jonkies') ? ty : 'overig'; }

  // nieuwste eerst; op dezelfde dag gaan meldingen mét tijdstip voor
  function cmpEvents(a, b){
    if (a.d !== b.d) return a.d < b.d ? 1 : -1;
    var at = a.tm || '', bt = b.tm || '';
    if (at !== bt){
      if (!at) return 1;
      if (!bt) return -1;
      return at < bt ? 1 : -1;
    }
    return 0;
  }

  // Uniek per plek: meerdere exacte punten in dezelfde plaats delen een naam, maar niet hun positie.
  function placeId(b){ return b.id || (b.n + '@' + b.lat + ',' + b.lon); }

  function summarize(base, ev, sp){
    var c = { zichtmelding:0, aanval:0, jonkies:0, overig:0 };
    ev.forEach(function(e){ c[bucketOf(e.ty)]++; });
    var dom = 'overig';
    for (var i = 0; i < sp.dominantOrder.length; i++){
      if (c[sp.dominantOrder[i]] > 0){ dom = sp.dominantOrder[i]; break; }
    }
    return { id:placeId(base), n:base.n, lat:base.lat, lon:base.lon, c:c, t:ev.length, dom:dom, ev:ev };
  }

  function makePlace(raw, sp){
    var ev = (raw.ev || []).slice().sort(cmpEvents);
    if (!ev.length){
      // een melding zonder gedateerde gebeurtenis: dan houden we de getallen uit het databestand aan
      var c = { zichtmelding:0, aanval:0, jonkies:0, overig:0 };
      Object.keys(raw.c || {}).forEach(function(k){ c[bucketOf(k)] += raw.c[k] || 0; });
      return { id:placeId(raw), n:raw.n, lat:raw.lat, lon:raw.lon, c:c, t:raw.t || 0, dom:raw.dom || 'overig', ev:[] };
    }
    return summarize(raw, ev, sp);
  }

  // Controle op de oude, met de hand bijgehouden velden (t, c, dom) — als die er (nog) zijn. Geeft een lijst afwijkingen.
  function validate(key){
    var sp = SPECIES[key], raw = sp && root[sp.dataVar], problems = [];
    if (!raw) return problems;
    (raw.veluwe && raw.veluwe.all || []).concat(raw.overig || []).forEach(function(b){
      if (!b.ev || !b.ev.length) return;
      var p = summarize(b, b.ev, sp);
      if (b.t !== undefined && b.t !== p.t) problems.push(b.n + ': t=' + b.t + ' maar ' + p.t + ' gebeurtenissen');
      if (b.dom && b.dom !== p.dom) problems.push(b.n + ': dom=' + b.dom + ' maar berekend ' + p.dom);
      BUCKETS.forEach(function(k){
        if (b.c && (b.c[k] || 0) !== p.c[k]) problems.push(b.n + ': c.' + k + '=' + (b.c && b.c[k] || 0) + ' maar berekend ' + p.c[k]);
      });
    });
    return problems;
  }

  // -> { key, species, updatedAt, veluwe:[plaatsen], overig:[plaatsen], all:[veluwe+overig] } of null
  function load(key){
    var sp = SPECIES[key], raw = sp && root[sp.dataVar];
    if (!raw) return null;
    var veluwe = (raw.veluwe && raw.veluwe.all || []).map(function(b){ return makePlace(b, sp); });
    var overig = (raw.overig || []).map(function(b){ return makePlace(b, sp); });
    var problems = validate(key);
    if (problems.length && root.console && console.warn){
      console.warn('[WDK] ' + sp.label + '-data wijkt af van de gebeurtenissen (' + problems.length + '):\n' + problems.slice(0, 20).join('\n'));
    }
    return { key:key, species:sp, updatedAt:raw.updatedAt || null, veluwe:veluwe, overig:overig, all:veluwe.concat(overig) };
  }
  function loadAll(){
    return SPECIES_ORDER.map(load).filter(Boolean);
  }

  // ---------------------------------------------------------------- gebeurtenissen & statistieken
  // plaatsen -> platte lijst gebeurtenissen (nieuwste eerst)
  function events(rows, sp){
    var out = [];
    rows.forEach(function(b){
      b.ev.forEach(function(e){
        var x = { d:e.d, tm:e.tm, ty:e.ty, place:b.n, lat:b.lat, lon:b.lon };
        if (sp) x.species = sp;
        out.push(x);
      });
    });
    return out.sort(cmpEvents);
  }

  // dezelfde plaatsen, maar alleen met meldingen van de laatste `days` dagen (vandaag meegeteld)
  function recent(rows, key, days, asOf){
    var sp = SPECIES[key];
    var cutoff = toISO(addDays(startOfDay(asOf || new Date()), -(days - 1)));
    var out = [];
    rows.forEach(function(b){
      var ev = b.ev.filter(function(e){ return e.d >= cutoff; });
      if (ev.length) out.push(summarize(b, ev, sp));
    });
    return out;
  }
  function recentLabel(days, asOf){
    var end = startOfDay(asOf || new Date());
    return fmtSpan(addDays(end, -(days - 1)), end, false);
  }

  function stats(rows){
    var s = { total:0, byType:{ zichtmelding:0, aanval:0, jonkies:0, overig:0 }, places:rows.length, dateMin:null, dateMax:null };
    rows.forEach(function(b){
      s.total += b.t;
      BUCKETS.forEach(function(k){ s.byType[k] += b.c[k] || 0; });
      b.ev.forEach(function(e){
        if (s.dateMin === null || e.d < s.dateMin) s.dateMin = e.d;
        if (s.dateMax === null || e.d > s.dateMax) s.dateMax = e.d;
      });
    });
    return s;
  }
  function periodLabel(s){
    if (!s.dateMin) return '';
    return fmtDate(s.dateMin) + ' – ' + fmtDate(s.dateMax);
  }

  // ---------------------------------------------------------------- weekverwachting + hotspots
  function percentile(sorted, p){
    if (!sorted.length) return 0;
    return sorted[Math.floor(p * (sorted.length - 1))];
  }

  // Meldingsdruk per week voor de komende weken. Geen voorspelling van een aanval, maar een indicatie:
  // gemiddelde van (recente basislijn, dezelfde week een jaar eerder) — en alleen de basislijn als er
  // nog geen jaar aan data is. Alleen volledige weken tellen mee in de geschiedenis: een lopende week
  // (of een eerste week die halverwege begint) drukt anders het gemiddelde en de drempels omlaag.
  function forecast(evs, opts){
    opts = opts || {};
    var today = startOfDay(opts.asOf || new Date());
    var weeksAhead = opts.weeksAhead || 9;
    var minEvents = opts.minEvents == null ? 30 : opts.minEvents;
    var minWeeks = opts.minWeeks == null ? 8 : opts.minWeeks;
    var hotspotDays = opts.hotspotDays || 60;
    var types = opts.hotspotTypes || null;

    var dated = evs.filter(function(e){ return e.d; });
    var res = { ok:false, eventCount:dated.length, minEvents:minEvents, minWeeks:minWeeks, historyWeeks:0 };
    if (!dated.length) return res;

    var firstStr = dated[0].d, lastStr = dated[0].d;
    dated.forEach(function(e){ if (e.d < firstStr) firstStr = e.d; if (e.d > lastStr) lastStr = e.d; });
    var first = parseISO(firstStr);

    var firstMonday = mondayOf(first);
    if (toISO(firstMonday) !== firstStr) firstMonday = addDays(firstMonday, 7); // eerste week is maar deels gemeten
    var thisMonday = mondayOf(today);
    var lastMonday = addDays(thisMonday, -7); // de week vóór de huidige is de laatste volledige

    var counts = {}, keys = [];
    for (var m = firstMonday; m.getTime() <= lastMonday.getTime(); m = addDays(m, 7)){
      var k = toISO(m);
      counts[k] = 0;
      keys.push(k);
    }
    res.historyWeeks = keys.length;
    if (dated.length < minEvents || keys.length < minWeeks) return res;

    dated.forEach(function(e){
      var wk = toISO(mondayOf(parseISO(e.d)));
      if (counts[wk] !== undefined) counts[wk]++;
    });
    var sorted = keys.map(function(k){ return counts[k]; }).sort(function(a, b){ return a - b; });
    var p33 = percentile(sorted, 0.33), p66 = percentile(sorted, 0.66);
    var last6 = keys.slice(-6);
    var recentAvg = last6.reduce(function(s, k){ return s + counts[k]; }, 0) / last6.length;

    // vanaf de eerstvolgende maandag (of vandaag, als vandaag een maandag is)
    var startMonday = toISO(thisMonday) === toISO(today) ? thisMonday : addDays(thisMonday, 7);
    var weeks = [], seasonalWeeks = 0;
    for (var i = 0; i < weeksAhead; i++){
      var monday = addDays(startMonday, i * 7);
      var seasonal = counts[toISO(addDays(monday, -364))]; // 52 weken terug, blijft op een maandag
      var projected = seasonal !== undefined ? (recentAvg + seasonal) / 2 : recentAvg;
      if (seasonal !== undefined) seasonalWeeks++;
      weeks.push({
        monday:monday, sunday:addDays(monday, 6), projected:projected,
        level: projected <= p33 ? 'rustig' : (projected <= p66 ? 'gemiddeld' : 'verhoogd')
      });
    }

    var windowStart = addDays(today, -hotspotDays);
    var byPlace = {};
    dated.forEach(function(e){
      if (types && types.indexOf(e.ty) === -1) return;
      var d = parseISO(e.d);
      if (d.getTime() < windowStart.getTime() || d.getTime() > today.getTime()) return;
      var name = stripExact(e.place).base; // "Ermelo" en "Ermelo (exacte locatie)" zijn dezelfde plek
      byPlace[name] = (byPlace[name] || 0) + 1;
    });
    var hotspots = Object.keys(byPlace).map(function(n){ return { n:n, c:byPlace[n] }; })
      .sort(function(a, b){ return b.c - a.c || (a.n < b.n ? -1 : 1); })
      .slice(0, 5);

    res.ok = true;
    res.weeks = weeks;
    res.startMonday = startMonday;
    res.endSunday = weeks[weeks.length - 1].sunday;
    res.seasonalWeeks = seasonalWeeks;
    res.p33 = p33; res.p66 = p66; res.recentAvg = recentAvg;
    res.firstDate = first; res.lastDate = parseISO(lastStr);
    res.hotspots = hotspots;
    res.hotspotStart = windowStart; res.hotspotEnd = today;
    return res;
  }

  // Vult een kaart (<section class="animal-card">) met de verwachting van één diersoort, of met een
  // "nog te weinig meldingen"-tekst zolang er te weinig data is.
  // o: { species:'wolf', rows:[plaatsen], scope:'nl'|'veluwe', updatedAt:'YYYY-MM-DDTHH:MM', asOf:Date }
  function renderForecast(el, o){
    if (!el) return null;
    var sp = SPECIES[o.species], cfg = sp.forecast, scope = SCOPE[o.scope || 'veluwe'];
    var f = forecast(events(o.rows), { asOf:o.asOf, hotspotTypes:cfg.hotspotTypes });
    var html;

    if (!f.ok){
      html = '<h2 class="card-title">Nog te weinig meldingen voor een verwachting</h2>' +
        '<p class="sub">' + (f.eventCount === 0
          ? 'Voor ' + sp.plural + ' zijn er nog geen meldingen in de data.'
          : 'Voor ' + sp.plural + ' ' + (f.eventCount === 1 ? 'staat' : 'staan') + ' er nu ' + meldingen(f.eventCount) + ' in de data, verdeeld over ' +
            f.historyWeeks + ' volledige ' + (f.historyWeeks === 1 ? 'week' : 'weken') + '.') + ' Vanaf ' + f.minEvents + ' meldingen en ' + f.minWeeks +
        ' weken geschiedenis rekenen we hier automatisch een voorzichtige inschatting uit van de meldingsdruk per week en de plekken waar het het vaakst gemeld wordt. ' +
        'Met minder is er nog geen betrouwbaar patroon te herkennen, en dat gaan we hier dus niet verzinnen.</p>' +
        '<div class="card-foot">' + cfg.cta + '</div>';
      el.innerHTML = html;
      return f;
    }

    var cards = f.weeks.map(function(w){
      return '<div class="week-card"><div class="week-range">' + fmtSpan(w.monday, w.sunday, false) + '</div>' +
        '<div class="week-badge lvl-' + w.level + '"><span class="dot"></span>' + w.level + '</div></div>';
    }).join('');

    var hotspots = f.hotspots.length ? f.hotspots.map(function(h){
      return '<div class="hotspot-chip"><span class="hc-n">' + h.c + '&times;</span>' + esc(h.n) + '</div>';
    }).join('') : '<div class="hotspot-chip">Geen ' + cfg.hotspotNoun + ' in deze periode</div>';

    var basis = '';
    if (f.seasonalWeeks < f.weeks.length){
      basis = '<div class="card-foot">' + (f.seasonalWeeks === 0
        ? 'Er is nog geen jaar aan meldingen, dus deze inschatting leunt volledig op het gemiddelde van de laatste 6 weken.'
        : 'Voor ' + (f.weeks.length - f.seasonalWeeks) + ' van de ' + f.weeks.length + ' weken is er nog geen data van een jaar eerder; die weken leunen op het gemiddelde van de laatste 6 weken.') +
        '</div>';
    }
    var stale = '';
    if (o.updatedAt){
      var upd = parseISO(o.updatedAt.split('T')[0]);
      var ago = daysBetween(upd, f.hotspotEnd);
      if (ago > 14) stale = '<div class="card-foot">Let op: de meldingen zijn voor het laatst bijgewerkt op ' + fmtDate(toISO(upd)) + ' (' + ago + ' dagen geleden). De inschatting kan daardoor achterlopen.</div>';
    }

    el.innerHTML =
      '<h2 class="card-title">' + cfg.title + '</h2>' +
      '<div class="notice">' + cfg.noticeIntro + ' Het is een berekening op basis van het meldingspatroon van ' + scope.of + ' sinds ' + fmtMonthYear(f.firstDate) +
        ': hoe vaak en wanneer er historisch werd gemeld, vergeleken met dezelfde periode een jaar eerder waar we die data hebben, en ' + cfg.activityPhrase +
        '. Zie het als een indicatie van meldingsdruk, geen garantie.</div>' +
      '<p class="sub-h">Verwachte meldingsdruk per week (' + fmtDM(f.startMonday) + ' – ' + fmtDM(f.endSunday) + ' ' + f.endSunday.getFullYear() + ')</p>' +
      '<div class="week-strip">' + cards + '</div>' +
      '<div class="level-legend">' +
        '<div class="week-badge lvl-rustig"><span class="dot"></span>rustig</div>' +
        '<div class="week-badge lvl-gemiddeld"><span class="dot"></span>gemiddeld</div>' +
        '<div class="week-badge lvl-verhoogd"><span class="dot"></span>verhoogd</div>' +
      '</div>' + basis +
      '<p class="sub-h">' + cfg.hotspotHeading + '</p>' +
      '<p class="sub">Op basis van de ' + cfg.hotspotNoun + ' van de afgelopen ~2 maanden (' + fmtDM(f.hotspotStart) + ' – ' + fmtDM(f.hotspotEnd) + ' ' + f.hotspotEnd.getFullYear() +
        ') zijn dit de actiefste plekken ' + scope.where + ':</p>' +
      '<div class="hotspot-list">' + hotspots + '</div>' + stale;
    return f;
  }

  // ---------------------------------------------------------------- weetjes
  function longestSilence(dayCounts, first, last){
    var best = { n:0, from:null, to:null }, run = 0, runStart = null;
    for (var d = first; d.getTime() <= last.getTime(); d = addDays(d, 1)){
      if (dayCounts[toISO(d)]){ run = 0; continue; }
      if (run === 0) runStart = d;
      run++;
      if (run > best.n) best = { n:run, from:runStart, to:d };
    }
    return best;
  }
  function fmtBetween(a, b){
    if (toISO(a) === toISO(b)) return 'op ' + fmtDM(a) + ' ' + a.getFullYear();
    var s = fmtSpan(a, b, true); // 20–26 jul 2026
    var i = s.indexOf('–');
    return 'tussen ' + s.slice(0, i) + ' en ' + s.slice(i + 1);
  }

  // Vult een kaart met weetjes die uit de meldingen volgen; verbergt de kaart bij te weinig data.
  // o: { rows:[plaatsen] }
  function renderFunFacts(el, o){
    if (!el) return;
    var evs = events(o.rows).filter(function(e){ return e.d; });
    if (evs.length < 30){ el.style.display = 'none'; return; }
    el.style.display = '';

    var dayCounts = {}, placeCounts = {}, firstStr = evs[0].d, lastStr = evs[0].d;
    evs.forEach(function(e){
      dayCounts[e.d] = (dayCounts[e.d] || 0) + 1;
      var name = stripExact(e.place).base;
      placeCounts[name] = (placeCounts[name] || 0) + 1;
      if (e.d < firstStr) firstStr = e.d;
      if (e.d > lastStr) lastStr = e.d;
    });
    var first = parseISO(firstStr), last = parseISO(lastStr);
    var totalDays = daysBetween(first, last) + 1;
    var daysWith = Object.keys(dayCounts).length;
    var tiles = [];

    tiles.push({ n: daysWith + ' / ' + totalDays + ' dagen',
      l: 'hadden minstens één melding sinds ' + fmtMonthYear(first) + ' &mdash; ongeveer ' + Math.round(daysWith / totalDays * 10) + ' van de 10 dagen' });

    var sil = longestSilence(dayCounts, first, last);
    if (sil.n > 0){
      tiles.push({ n: sil.n + (sil.n === 1 ? ' dag' : ' dagen'), l: 'langste stilte: geen enkele melding ' + fmtBetween(sil.from, sil.to) });
    }

    var top = Object.keys(placeCounts).sort(function(a, b){ return placeCounts[b] - placeCounts[a] || (a < b ? -1 : 1); })[0];
    var share = Math.round(evs.length / placeCounts[top]);
    tiles.push({ n: esc(top),
      l: 'koploper met ' + placeCounts[top] + ' meldingen &mdash; ' + (share <= 1 ? 'vrijwel alle' : 'ongeveer 1 op de ' + share + ' van alle') + ' ' + evs.length + ' meldingen' });

    var max = 0, busiest = [];
    Object.keys(dayCounts).sort().forEach(function(d){
      if (dayCounts[d] > max){ max = dayCounts[d]; busiest = [d]; }
      else if (dayCounts[d] === max) busiest.push(d);
    });
    tiles.push({ n: max + ' meldingen',
      l: 'op de drukste ' + (busiest.length === 1 ? 'dag' : 'dagen tegelijk') + ' (' + (busiest.length > 2 ? 'o.a. ' : '') +
        busiest.slice(0, 2).map(fmtDate).join(' en ') + ')' });

    el.innerHTML = '<h2 class="card-title">Nog een paar weetjes</h2><div class="fun-grid">' +
      tiles.map(function(t){ return '<div class="fun-tile"><div class="n">' + t.n + '</div><div class="l">' + t.l + '</div></div>'; }).join('') +
      '</div>';
  }

  // ---------------------------------------------------------------- vee: welke dieren, hoeveel gedood
  // Uit de aanvalsmeldingen: `dier` (welk vee) en `gedood` (aantal) komen uit SeaTable ("Gedode dier", "Aantal dood").
  // o: { rows:[plaatsen], mode:'attacks' | 'killed' }; een kaart zonder gegevens verbergt zichzelf.
  function renderLivestock(el, o){
    if (!el) return;
    var attacks = events(o.rows).filter(function(e){ return e.ty === 'aanval'; });
    var src = [];
    o.rows.forEach(function(b){ b.ev.forEach(function(e){ if (e.ty === 'aanval') src.push(e); }); });
    var byAnimal = {}, order = [], total = 0, withCount = 0, killedTotal = 0;
    src.forEach(function(e){
      var raw = (e.dier || '').trim(), key = raw ? normalizeText(raw) : '';
      var isKilled = o.mode === 'killed';
      if (isKilled){
        if (e.gedood === undefined || e.gedood === null) return;
        withCount++;
        if (!(e.gedood > 0)) return;
      }
      var add = isKilled ? e.gedood : 1;
      if (!byAnimal[key]){ byAnimal[key] = { label: raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Onbekend', n:0, unknown:!raw }; order.push(key); }
      byAnimal[key].n += add;
      total += add;
    });
    var items = order.map(function(k){ return byAnimal[k]; })
      .sort(function(a, b){ return (a.unknown - b.unknown) || (b.n - a.n) || (a.label < b.label ? -1 : 1); });
    if (!total){ el.style.display = 'none'; return; }
    el.style.display = '';

    var top = items[0], max = Math.max.apply(null, items.map(function(i){ return i.n; }));
    var title, sub, aria;
    if (o.mode === 'killed'){
      title = 'Hoeveel vee is daadwerkelijk gedood?';
      sub = 'Van de ' + attacks.length + ' aanvalsmeldingen ' + (withCount === 1 ? 'noemde er 1 een' : 'noemden er ' + withCount + ' een') +
        ' concreet aantal gedode dieren &mdash; samen minstens <b>' + total + '</b> ' + (total === 1 ? 'dier' : 'dieren') +
        (items.length > 1 && !top.unknown ? ', het meest ' + esc(top.label.toLowerCase()) + ' (' + top.n + ')' : '') +
        '. Meldingen zonder genoemd aantal staan hier niet bij: dat betekent niet dat er geen dieren omkwamen, alleen dat de melding geen telling gaf.';
      aria = 'Balkdiagram: minstens aantal gedode dieren per diersoort. ';
    } else {
      title = 'Welk vee wordt aangevallen?';
      var pct = Math.round(top.n / total * 100);
      sub = (top.unknown ? '' : 'Het vaakst getroffen: <b>' + esc(top.label) + '</b> (' + pct + '% van de ') + (top.unknown ? 'De ' : '') + total +
        ' geregistreerde aanvallen op vee' + (top.unknown ? '' : ')') + '. De balken tonen het aantal aanvalsmeldingen per diersoort.';
      aria = 'Balkdiagram: aantal aanvallen per diersoort. ';
    }
    var rows = items.map(function(it, i){
      return '<div class="bar-row' + (it.unknown ? ' is-unknown' : '') + '"><div class="bar-top">' +
        '<span class="bar-label" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + (it.n / max * 100).toFixed(1) + '%; --bar-color:var(--pal-' + ((i % 7) + 1) + ')"></div></div>' +
        '<span class="bar-value">' + it.n + '</span></div></div>';
    }).join('');
    el.innerHTML = '<h2 class="card-title">' + title + '</h2><p class="sub">' + sub + '</p>' +
      '<div class="bar-chart" role="img" aria-label="' + esc(aria + items.map(function(i){ return i.label + ' ' + i.n; }).join(', ')) + '.">' + rows + '</div>';
  }

  // ---------------------------------------------------------------- grafiek: meldingen per maand
  // series: [{ key, label, color, rows:[plaatsen] }]  ->  gestapelde staafgrafiek in `el`
  function renderMonthlyChart(el, series){
    if (!el) return;
    var perMonth = {}, minKey = null, maxKey = null;
    series.forEach(function(s){
      s.rows.forEach(function(b){
        b.ev.forEach(function(e){
          var key = e.d.slice(0, 7);
          if (!perMonth[key]) perMonth[key] = {};
          perMonth[key][s.key] = (perMonth[key][s.key] || 0) + 1;
          if (minKey === null || key < minKey) minKey = key;
          if (maxKey === null || key > maxKey) maxKey = key;
        });
      });
    });
    if (!minKey){ el.innerHTML = ''; return; }

    // maanden aaneengesloten opvullen, ook als een maand toevallig 0 meldingen had
    var months = [];
    var cy = parseInt(minKey.slice(0, 4), 10), cm = parseInt(minKey.slice(5, 7), 10);
    var ey = parseInt(maxKey.slice(0, 4), 10), em = parseInt(maxKey.slice(5, 7), 10);
    while (cy < ey || (cy === ey && cm <= em)){
      var counts = perMonth[cy + '-' + pad(cm)] || {};
      var total = 0;
      series.forEach(function(s){ total += counts[s.key] || 0; });
      months.push({ year:cy, month:cm, counts:counts, total:total });
      cm++;
      if (cm > 12){ cm = 1; cy++; }
    }
    var maxTotal = 1;
    months.forEach(function(m){ if (m.total > maxTotal) maxTotal = m.total; });

    var W = 640, H = 200, padTop = 16, padBottom = 26, padSide = 6;
    var plotH = H - padTop - padBottom, baseline = H - padBottom;
    var slotW = (W - padSide * 2) / months.length;
    var barW = Math.max(6, Math.min(34, slotW - 8));
    var GAP = 2; // vaste 2px-tussenruimte tussen gestapelde segmenten

    function roundedTopRectPath(x, y, w, h, r){
      r = Math.max(0, Math.min(r, w / 2, h));
      return 'M' + x + ',' + (y + h) + ' L' + x + ',' + (y + r) + ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        ' L' + (x + w - r) + ',' + y + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + ' L' + (x + w) + ',' + (y + h) + ' Z';
    }

    var parts = ['<line x1="' + padSide + '" y1="' + baseline + '" x2="' + (W - padSide) + '" y2="' + baseline + '" stroke="var(--border)" stroke-width="1"></line>'];
    months.forEach(function(m, i){
      var cx = padSide + slotW * i + slotW / 2, x = cx - barW / 2;
      var segs = series.filter(function(s){ return m.counts[s.key] > 0; });
      var cursorY = baseline;
      segs.forEach(function(s, si){
        var n = m.counts[s.key], segH = (n / maxTotal) * plotH, y = cursorY - segH;
        var title = m.year + '-' + pad(m.month) + ' · ' + esc(s.label) + ': ' + n;
        if (si === segs.length - 1){
          parts.push('<path class="chart-bar" d="' + roundedTopRectPath(x, y, barW, segH, 4) + '" fill="' + s.color + '"><title>' + title + '</title></path>');
        } else {
          parts.push('<rect class="chart-bar" x="' + x + '" y="' + y + '" width="' + barW + '" height="' + segH + '" fill="' + s.color + '"><title>' + title + '</title></rect>');
        }
        cursorY = y - GAP;
      });
      if (m.total > 0 && slotW >= 18){
        parts.push('<text x="' + cx + '" y="' + (cursorY + GAP - 4) + '" font-size="9" text-anchor="middle">' + m.total + '</text>');
      }
      var yr = (m.month === 1 || i === 0) ? "'" + String(m.year).slice(2) : '';
      parts.push('<text x="' + cx + '" y="' + (baseline + 16) + '" font-size="9.5" text-anchor="middle">' + MONTHS[m.month - 1] + yr + '</text>');
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' + parts.join('') + '</svg>';
  }

  // ---------------------------------------------------------------- kaartfilter (type, periode, soort)
  // Eén filterobject, ook als URL te delen:  ?soort=wolf&type=aanval,zichtmelding&van=2026-05-01&tot=2026-08-31&heat=1
  // van/tot mogen ook als maand (van=2026-05 = 1 mei, tot=2026-05 = 31 mei). Onbekende waarden worden genegeerd.
  var FILTER_TYPES = ['zichtmelding','aanval','jonkies','overig'];
  function emptyFilter(){ return { soort:null, types:null, van:null, tot:null, heat:false }; }
  // alleen type en periode zijn filters op de meldingen; soort en heat bepalen wat de pagina toont
  function isEmptyFilter(f){ return !f || (!f.types && !f.van && !f.tot); }

  function dateParam(v, isEnd){
    if (!v) return null;
    v = String(v).trim();
    if (/^\d{4}-\d{2}$/.test(v)){
      var y = parseInt(v.slice(0, 4), 10), m = parseInt(v.slice(5, 7), 10);
      if (m < 1 || m > 12) return null;
      return isEnd ? toISO(new Date(y, m, 0)) : v + '-01';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return toISO(parseISO(v)) === v ? v : null; // wijst 2026-02-31 af
  }
  function uniq(a){ return a.filter(function(x, i){ return a.indexOf(x) === i; }); }

  function parseFilter(search){
    var q = new URLSearchParams(search || ''), f = emptyFilter();
    var soort = uniq((q.get('soort') || '').split(',').map(function(x){ return x.trim(); }).filter(function(k){ return SPECIES[k]; }));
    if (soort.length) f.soort = soort;
    var types = uniq((q.get('type') || '').split(',').map(function(x){ return x.trim(); }).filter(function(t){ return FILTER_TYPES.indexOf(t) > -1; }));
    if (types.length) f.types = types;
    f.van = dateParam(q.get('van'), false);
    f.tot = dateParam(q.get('tot'), true);
    if (f.van && f.tot && f.van > f.tot){ var t = f.van; f.van = f.tot; f.tot = t; }
    f.heat = q.get('heat') === '1';
    return f;
  }
  // schrijft het filter in een URLSearchParams (andere parameters, zoals ?plaats=, blijven staan)
  function filterToParams(f, params){
    function put(k, v){ if (v) params.set(k, v); else params.delete(k); }
    put('soort', f.soort && f.soort.length ? f.soort.join(',') : '');
    put('type', f.types && f.types.length ? f.types.join(',') : '');
    put('van', f.van);
    put('tot', f.tot);
    put('heat', f.heat ? '1' : '');
    return params;
  }

  // plaatsen met alleen de meldingen die het filter doorstaan (plaatsen zonder treffers vallen af)
  function applyFilter(rows, key, f){
    if (isEmptyFilter(f)) return rows;
    var sp = SPECIES[key], out = [];
    rows.forEach(function(b){
      var ev = b.ev.filter(function(e){
        if (f.types && f.types.indexOf(bucketOf(e.ty)) === -1) return false;
        if (f.van && e.d < f.van) return false;
        if (f.tot && e.d > f.tot) return false;
        return true;
      });
      if (ev.length) out.push(summarize(b, ev, sp));
    });
    return out;
  }

  // alle kalendermaanden tussen de eerste en laatste melding: [{ key:'2026-05', van, tot, label:'mei 2026' }]
  function monthList(rows){
    var minKey = null, maxKey = null;
    rows.forEach(function(b){
      b.ev.forEach(function(e){
        var k = e.d.slice(0, 7);
        if (minKey === null || k < minKey) minKey = k;
        if (maxKey === null || k > maxKey) maxKey = k;
      });
    });
    var out = [];
    if (!minKey) return out;
    var y = parseInt(minKey.slice(0, 4), 10), m = parseInt(minKey.slice(5, 7), 10);
    var ey = parseInt(maxKey.slice(0, 4), 10), em = parseInt(maxKey.slice(5, 7), 10);
    while (y < ey || (y === ey && m <= em)){
      out.push({ key:y + '-' + pad(m), van:y + '-' + pad(m) + '-01', tot:toISO(new Date(y, m, 0)), label:MONTHS[m - 1] + ' ' + y });
      m++;
      if (m > 12){ m = 1; y++; }
    }
    return out;
  }
  // welke van de vier typen komen in deze plaatsen voor (in vaste volgorde)
  function typesPresent(rows){
    var seen = {};
    rows.forEach(function(b){ b.ev.forEach(function(e){ seen[bucketOf(e.ty)] = true; }); });
    return FILTER_TYPES.filter(function(t){ return seen[t]; });
  }
  // eerste dag van een venster van `days` dagen dat vandaag meetelt (voor "laatste 2 weken")
  function recentCutoff(days, asOf){
    return toISO(addDays(startOfDay(asOf || new Date()), -(days - 1)));
  }

  root.WDK = {
    SPECIES:SPECIES, TYPE_LABEL:TYPE_LABEL, MONTHS:MONTHS,
    esc:esc, normalizeText:normalizeText, stripExact:stripExact, nameHtml:nameHtml, fmtDate:fmtDate,
    monthYear:function(iso){ return fmtMonthYear(parseISO(iso)); },
    load:load, loadAll:loadAll, validate:validate,
    events:events, cmpEvents:cmpEvents, recent:recent, recentLabel:recentLabel, stats:stats, periodLabel:periodLabel,
    FILTER_TYPES:FILTER_TYPES, emptyFilter:emptyFilter, isEmptyFilter:isEmptyFilter, parseFilter:parseFilter, filterToParams:filterToParams,
    applyFilter:applyFilter, monthList:monthList, typesPresent:typesPresent, recentCutoff:recentCutoff,
    forecast:forecast, renderForecast:renderForecast, renderFunFacts:renderFunFacts, renderLivestock:renderLivestock, renderMonthlyChart:renderMonthlyChart
  };
})(window);
