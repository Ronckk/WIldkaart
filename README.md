# Wilde Dieren in Kaart — website

Statisch, klaar om te hosten:

- `index.html` — home (landelijke kaart met alle meldingen + meldingentabel)
- `wolven.html` — wolvenmeldingen op de Veluwe
- `zwijnen.html` — zwijnenmeldingen op de Veluwe
- `data/wolven-data.js`, `data/zwijnen-data.js` — de meldingendata (zie hieronder)
- `assets/map-tools.js` + `assets/map-tools.css` — filterbalk onder de zoekbalk van elke kaart (type, periode,
  tijdschuif met afspelen, hitte-laag) en de hitte-laag zelf (canvas, geen extra bibliotheek)
- `tools/seatable_sync.py` (+ `seatable.config.json`) — haalt de meldingen uit SeaTable en schrijft `data/*.js` (zie onder)
- `assets/site.js` — de gedeelde data-laag: berekent alles uit de meldingen (tellingen, statistieken,
  "laatste 2 weken", weekverwachting, hotspots, weetjes, grafiek per maand) voor elke diersoort

## Data: één bron, meerdere kaarten

Alle meldingen staan in `data/wolven-data.js` en `data/zwijnen-data.js` (elk `window.WOLVEN_DATA` /
`window.ZWIJNEN_DATA`), niet meer los in elke HTML-pagina. Beide bestanden zijn opgedeeld in:

- `veluwe.all` — meldingen op de Veluwe, voor de eigen kaart en statistieken van `wolven.html`/`zwijnen.html`.
  (`last2w` en `meta` staan er nog, maar worden niet meer gebruikt: die worden berekend.)
- `overig` — meldingen elders in Nederland: een platte lijst, alleen gebruikt door de landelijke kaart
  op de homepage.

**Een nieuwe melding voeg je dus maar op één plek toe** (in het juiste databestand). Ligt de plaats op
de Veluwe? Zet 'm in `veluwe.all` — hij verschijnt dan vanzelf op zowel de wolven-/zwijnenkaart als de
landelijke kaart. Ligt de plaats daarbuiten? Zet 'm alleen in `overig` — hij verschijnt dan alleen op de
landelijke kaart op de homepage, niet op de Veluwe-kaart zelf. `index.html` laadt beide bestanden en telt
`veluwe.all` + `overig` bij elkaar op voor zijn kaart en voor de "Net binnen gekomen meldingen"-tabel (top
10, automatisch gesorteerd op datum — die tabel hoeft dus nooit meer met de hand bijgewerkt te worden).

Per plaats hoef je alleen `n`, `lat`, `lon` en de lijst gebeurtenissen `ev` (`{ d, ty, tm? }`) in te vullen:
`t`, `c`, `dom`, de periodefilters, de statistieken, de weekverwachting, de hotspots en de weetjes worden door
`assets/site.js` uit `ev` berekend. De oude velden `t`/`c`/`dom` worden niet meer gebruikt; wijken ze af van
`ev`, dan waarschuwt de browserconsole daarvoor.

**Een nieuwe diersoort** (bv. herten) = een databestand in hetzelfde formaat + één blok in `SPECIES`
bovenin `assets/site.js` (naam, kleur, pagina, teksten voor de verwachting). De homepage pakt hem dan
vanzelf mee (kaartlaag, vinkje, tabel, grafiek).

**Vergeet bij het toevoegen van een melding niet `updatedAt` bij te werken** (bovenaan hetzelfde
databestand, formaat `"YYYY-MM-DDTHH:MM"`, lokale tijd). De homepage laat onder "Net binnen gekomen
meldingen" zien wanneer er voor het laatst een melding aan de website is toegevoegd — dat is dus niet de
datum van de waarneming zelf, maar het moment waarop jij (of Claude) de melding in `wolven-data.js` of
`zwijnen-data.js` hebt gezet. Zonder deze stap blijft die tekst op de vorige toevoegdatum staan.

## Meldingen uit SeaTable halen

De meldingen komen uit de SeaTable-base "Wilde Dieren in Kaart" (tabellen `Zichtmeldingen` en `Aanval`, ingevuld via
formulieren). Dat gaat **niet** live vanuit de browser (SeaTable staat dat niet toe, en de token zou zichtbaar zijn
voor bezoekers) maar met een klein script dat de tabellen ophaalt en `data/wolven-data.js` / `data/zwijnen-data.js`
schrijft. De website blijft dus statisch. Alleen Python 3.9+ is nodig, geen extra pakketten.

**Eenmalig:** zet een API-token met alleen leesrechten in `tools/.env` (`SEATABLE_API_TOKEN=...`; dat bestand staat in
`.gitignore`, deel of commit het nooit).

**Bijwerken (na nieuwe meldingen):**

```
python3 tools/seatable_sync.py --dry-run     # proefdraaien: rekent alles door, schrijft niets
python3 tools/seatable_sync.py               # schrijft data/*.js; upload daarna de site (of de data/-map)
```

Het script zet na elke sync ook een versienummer achter de data-scripts in de HTML-pagina's
(`<script src="data/wolven-data.js?v=1d867f0bdf">`, een korte vingerafdruk van het bestand). Zo halen browsers en hosts
(GitHub Pages bewaart bestanden tot ~10 minuten) na een sync het nieuwe databestand op in plaats van een oude kopie
uit de cache. **Upload daarom na een sync de HTML-pagina's én de `data/`-map.** Alleen de versienummers opnieuw
zetten (bv. na een handmatige wijziging van een databestand) kan met `python3 tools/seatable_sync.py --stamp`
(geen token nodig).

Bij het eerste echte schrijven vervangt SeaTable de oude handmatige data. Omdat SeaTable dan veel minder meldingen
heeft dan de site nu, weigert het script dat zonder `--force` (beveiliging tegen een lege of verkeerde tabel). De
allereerste oude versie blijft bewaard in `tools/backup/`, de vorige versie steeds als `data/*.js.bak`.

**Hoe een rij een stip wordt.** Verwachte kolommen (namen staan in `tools/seatable.config.json`, hoofdletters maken niet
uit): `Dier` (Wolf/Zwijn), `Datum` (met of zonder tijd; tijdzone wordt naar Nederlandse tijd omgezet) en `Locatie`
(geolocatie). Bij `Aanval` ook `Gedode dier` en `Aantal dood`. De tabel bepaalt het type (zichtmelding of aanval); een
kolom `Type` mag dat overschrijven. `Tijd`, `Regio` en `Plaats` mogen erbij als je ze toevoegt.

- **Verificatie (moderatie):** elke tabel heeft een checkbox-kolom `Verificatie`. Een melding komt pas op de site als
  die is aangevinkt; nieuwe inzendingen via het formulier staan er dus eerst niet op en wachten op jouw controle.
  Haal je het vinkje weg, dan verdwijnt de melding bij de volgende sync weer van de site. In de sync-log staat hoeveel
  meldingen wachten (`1 wachten op verificatie`). Let op:
  - Zet de kolom **niet in het formulier**, anders kan een inzender zichzelf verifiëren.
  - Ontbreekt de kolom in een tabel, dan stopt het script met een foutmelding in plaats van alles te publiceren
    (uit te zetten met `"required": false` onder `"verification"` in de config).
  - Wordt door het weghalen van veel vinkjes de site plotseling veel kleiner (minder dan de helft), dan weigert de
    beveiliging de sync; controleer dan of dat de bedoeling is en draai lokaal `--force`.
- **Plaatsnaam:** SeaTable bewaart alleen coördinaten. Het script zoekt de woonplaats op bij PDOK (gratis, officieel) en
  onthoudt het antwoord in `tools/place-cache.json`, dus elk punt wordt maar één keer opgevraagd. Punten die meer dan
  5 km van een Nederlandse woonplaats liggen (bv. Duitsland) heten "Onbekende locatie". Valt PDOK even uit, dan blijven
  de meldingen bewaard en draai je het script later opnieuw.
- **Positie:** `"position": "exact"` (nu ingesteld) zet de stip op de exacte gemelde plek; meldingen op hetzelfde punt
  tellen samen. Zet je `"position": "town"`, dan komt er één stip per plaats op het middelpunt van die plaats: geen
  exacte GPS-locatie op de kaart (de voettekst van de site belooft dat nu niet meer bij "exact"; bij aanvallen op vee
  verraadt een exacte stip de plek van het bedrijf).
- **Veluwe of elders:** volgt uit een `Regio`-kolom, anders uit de rechthoek `veluwe_bbox` in de config (die
  reproduceert de oude indeling precies).
- **Vee:** de kaarten "Welk vee wordt aangevallen?" en "Hoeveel vee is daadwerkelijk gedood?" op de wolvenpagina worden
  berekend uit de aanvalsmeldingen (heel Nederland, dus ook aanvallen buiten de Veluwe); zonder aanvallen (of zonder
  die gegevens) verbergen ze zichzelf. Eén aanval kan meerdere diersoorten treffen: vul in het formulier `Gedode dier` +
  `Aantal dood` in, en eventueel `Gedode dier 2` + `Aantal dood 2` (en `... 3`, als je die kolommen toevoegt; zie
  `extra_victims` in de config). Het blijft **één** aanval; de kaart "Welk vee" telt die aanval bij elke betrokken
  soort, en "Hoeveel gedood" telt de aantallen per soort op. Gebruik voor dezelfde soort steeds dezelfde keuzewaarde
  (bv. "Pony" of "Veulen", niet door elkaar), anders zijn het aparte balken.
- Twee dezelfde plaatsnamen op verschillende plekken zijn twee stippen; de website houdt ze uit elkaar met een intern
  `id`.

Testen zonder SeaTable of internet: `python3 tools/test_seatable_sync.py` (nep-SeaTable en nep-PDOK; 12 tests,
waaronder een rondje oude data → SeaTable → site, met de bevroren oude data in `tools/fixtures/`). Tabellen en kolommen bekijken: `--inspect` (met `--sample`
twee voorbeeldrijen). De oude data als CSV exporteren voor een import in SeaTable kan met `--export-legacy`.

## Filteren, afspelen, hitte-laag en delen

Onder de zoekbalk van elke kaart staat een inklapbaar paneel "Filter & tijd" (open op een computer, dicht op een
telefoon; ingeklapt zie je alleen een "actief"-label en het aantal meldingen). Het bevat: **type** (zicht / aanval / jonkies / overig; alleen typen
die in de data voorkomen), **periode** (van/tot), een **tijdschuif** per maand met een afspeelknop (met de optie
"opgebouwd" = alles t/m die maand) en — alleen op de wolven- en zwijnenpagina, niet op de homepage — een
**hitte-laag** onder de bolletjes. Op de homepage staat in hetzelfde paneel ook de **soort** (wolf/zwijn); de legenda onder de kaart is alleen nog de kleurcode. De hele stand staat in de URL, dus je kunt een weergave delen ("Kopieer link"):

    ?soort=wolf&type=aanval,zichtmelding&van=2026-05&tot=2026-08&heat=1

`van`/`tot` mogen `JJJJ-MM-DD` of `JJJJ-MM` zijn (`tot=2026-08` = t/m 31 aug). Onbekende of ongeldige waarden
worden genegeerd. `?plaats=Epe` werkt er nog steeds naast. De filterlogica staat in `assets/site.js`
(`parseFilter`, `applyFilter`, `monthList`); de knoppen en de hitte-laag in `assets/map-tools.js`. Het filter
geldt voor de kaart (en de kaartstatistieken); tabel, grafiek en verwachting blijven altijd op alle data gebaseerd.

## De kaart

De kaarten gebruiken **Leaflet** voor de interactie (zoom, pan, zoeken, popups) met **CARTO's
basemap-tegels** (Voyager voor licht, Dark Matter voor donker — schakelt automatisch mee met de
licht/donker-knop). CARTO vereist tegenwoordig een gratis API-key in de tegel-URL (`?key=...`); die
staat al in de drie HTML-bestanden.

**Waarom niet de "kale" OpenStreetMap-tegels (tile.openstreetmap.org)?** Dat was de eerste versie, maar
die tegelserver wordt onderhouden door vrijwilligers en blokkeert actief clients die niet aan hun
tile usage policy voldoen (osm.wiki/Blocked) — dat sloeg raak bij het testen, waarschijnlijk doordat de
pagina zonder geldige Referer werd geladen (bv. rechtstreeks vanaf schijf, of vanuit een embedded
weergave). CARTO's basemaps zijn bedoeld voor precies dit gebruik en hebben dat probleem niet.

## Hosten en automatisch bijwerken (GitHub Pages, wildkaart.rlode.nl)

De site staat in een GitHub-repo en wordt met GitHub Pages gepubliceerd op **wildkaart.rlode.nl**. De workflow
`.github/workflows/site.yml` doet twee dingen:

- **Elke 3 uur** (en met de knop *Actions > Site > Run workflow*): `tools/seatable_sync.py` draaien. Zijn er nieuwe
  meldingen, dan worden `data/`, het versienummer in de HTML en `tools/place-cache.json` gecommit en wordt de site
  opnieuw gepubliceerd. Zijn er geen nieuwe meldingen, dan gebeurt er niets (geen commit, geen publicatie).
- **Bij elke push naar `main`**: de site opnieuw publiceren. Gepubliceerd worden alleen `index.html`, `wolven.html`,
  `zwijnen.html`, `assets/` en `data/` (dus niet `tools/`, de tests of deze README).

`tests.yml` draait bij elke push de tests van de koppeling. Faalt de sync (bv. token ongeldig, of SeaTable levert veel
minder meldingen dan de site heeft), dan wordt de run rood en krijg je van GitHub een mail; de site blijft dan gewoon
op de laatste goede data staan.

**Frequentie:** SeaTable Cloud Free staat 3000 API-calls per maand toe; een sync kost er ongeveer 4. Elke 3 uur is
ongeveer 1000 per maand. Wil je vaker, pas dan `cron` in `site.yml` aan, maar houd je limiet in de gaten (bij een
betaald plan is er meer ruimte). Voor direct verversen gebruik je de knop *Run workflow*.

### Eenmalig instellen

1. **Repo aanmaken** op github.com (Pages op een gratis account vereist een *publieke* repo; de meldingen staan
   sowieso al publiek op de site) en de code pushen:
   ```
   git remote add origin git@github.com:<jouw-gebruikersnaam>/<repo>.git
   git push -u origin main
   ```
2. **Secret:** *Settings > Secrets and variables > Actions > New repository secret*, naam `SEATABLE_API_TOKEN`,
   waarde = de API-token (alleen leesrechten). Maak bij voorkeur een verse token aan voor GitHub, los van de
   token in `tools/.env`.
3. **Pages:** *Settings > Pages > Build and deployment > Source* = **GitHub Actions**.
4. **Domein:** bij je DNS-beheer van rlode.nl een `CNAME`-record `wildkaart` toevoegen met als waarde
   `<jouw-gebruikersnaam>.github.io`. Vul daarna in *Settings > Pages > Custom domain* `wildkaart.rlode.nl` in en zet
   *Enforce HTTPS* aan (het certificaat verschijnt na enkele minuten tot een uur). Verifieer het domein ook onder
   *Settings > Pages > Verified domains* (of in je account-instellingen), zodat niemand anders het kan claimen.
5. **Eerste publicatie:** *Actions > Site > Run workflow*. Daarna draait het vanzelf.

**Nette adressen:** de pagina's zijn bereikbaar als `/wolven` en `/zwijnen` (GitHub Pages voegt zelf `.html` toe); de
links in de site en de canonieke adressen gebruiken die vorm. Oude adressen met `.html` blijven ook werken. Lokaal
werkt dat met `python3 tools/dev_server.py` (de gewone `python3 -m http.server` kent geen adressen zonder `.html`).

Handmatig bijwerken zonder GitHub kan nog steeds (`python3 tools/seatable_sync.py`, dan de HTML-pagina's en `data/`
uploaden). Test bij voorkeur via een lokale webserver (`python3 tools/dev_server.py`) in plaats van rechtstreeks
dubbelklikken vanaf schijf; sommige browsers blokkeren `data/*.js` via `file://` om veiligheidsredenen.

## Tegel-gebruik bij groei

CARTO's gratis laag is bedoeld voor precies dit soort projecten en heeft een ruimere policy dan de kale
OSM-tegelserver, maar bij serieus veel verkeer is het gebruikelijk om over te stappen op een betaalde
tile-provider (bv. MapTiler, Stadia Maps, Mapbox) of een eigen tile-server. Voor een schoolproject met
bescheiden bezoekersaantallen is dit ruim voldoende.
