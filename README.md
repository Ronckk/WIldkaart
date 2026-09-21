# Wilde Dieren in Kaart — website

Statisch, klaar om te hosten:

- `index.html` — home (landelijke kaart met alle meldingen + meldingentabel)
- `wolven.html` — wolvenmeldingen op de Veluwe
- `zwijnen.html` — zwijnenmeldingen op de Veluwe
- `overig.html` — meldingen van alle andere dieren (ree, hert, vos, ...), heel Nederland
- `over.html` — uitleg: wat is een melding, hoe controleren we, waar komen de gegevens vandaan, wat is een stip, privacy, contact
- `404.html`, `robots.txt`, `sitemap.xml` — voor zoekmachines en foute adressen (zie "Vindbaarheid"; `sitemap.xml` wordt bij
  elke publicatie opnieuw gemaakt door `tools/build_sitemap.py`)
- `data/wolven-data.js`, `data/zwijnen-data.js`, `data/overig-data.js` — de meldingendata (zie hieronder)
- `assets/map-tools.js` + `assets/map-tools.css` — filterbalk onder de zoekbalk van elke kaart (type, periode,
  tijdschuif met afspelen, hitte-laag) en de hitte-laag zelf (canvas, geen extra bibliotheek)
- `tools/seatable_sync.py` (+ `seatable.config.json`) — haalt de meldingen uit SeaTable en schrijft `data/*.js` (zie onder)
- `assets/site.js` — de gedeelde data-laag: berekent alles uit de meldingen (tellingen, statistieken,
  "laatste 2 weken", weekverwachting, hotspots, weetjes, grafiek per maand) voor elke diersoort
- Opmaak en scripts per pagina (zie "Opmaak en scripts" hieronder), `assets/fonts/` (lettertypen) en `assets/vendor/leaflet/`
  (de kaartbibliotheek): alles wat de pagina's nodig hebben staat op de site zelf

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

Dezelfde versienummers komen bij het publiceren ook achter alle eigen scripts en stijlbladen (`assets/*.js`, `assets/*.css`).
De publicatiestap in `.github/workflows/site.yml` doet dat op de kopie in `_site` (`seatable_sync.py --stamp --assets --root _site`),
dus in de repo blijven de pagina's ongewijzigd en je kunt het niet vergeten. GitHub Pages bewaart bestanden ongeveer 10 minuten;
zonder versienummer kan een bezoeker in die tijd een oud script bij een nieuwe pagina krijgen. Nieuwe scripts hoef je nergens aan te
melden: elke `<script src="assets/...">` of `<link href="assets/....css">` in een pagina krijgt vanzelf een nummer.

Bij het eerste echte schrijven vervangt SeaTable de oude handmatige data. Omdat SeaTable dan veel minder meldingen
heeft dan de site nu, weigert het script dat zonder `--force` (beveiliging tegen een lege of verkeerde tabel). De
allereerste oude versie blijft bewaard in `tools/backup/`, de vorige versie steeds als `data/*.js.bak`.

**Hoe een rij een stip wordt.** Verwachte kolommen (namen staan in `tools/seatable.config.json`, hoofdletters maken niet
uit): `Dier` (Wolf/Zwijn), `Datum` (met of zonder tijd; tijdzone wordt naar Nederlandse tijd omgezet) en de plek: twee
getalkolommen `Latitude` en `Longitude` (die vult de kaartpagina in, zie "Meldformulieren") of, voor oudere rijen, een
geolocatie-kolom `Locatie`. Staat er in een rij een breedte- en lengtegraad, dan gaat die voor; anders wordt `Locatie`
gelezen. Ook `52,29`, `52.29°` en `52.29 N` worden begrepen. Bij `Aanval` ook `Gedode dier` en `Aantal dood`. De tabel bepaalt het type (zichtmelding of aanval); een
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
- **Met jonkies:** staat er in `Dier` een keuze als `Zwijn met jonkies` (of `Ree met jonkies`), dan is de melding van het type
  "Met jonkies gezien" en hoort hij bij die diersoort (Zwijn -> zwijnenpagina; andere dieren -> Overig, met alleen de diernaam).
  Het werkt voor elke keuze waarin "jonk" voorkomt; de aanvalstabel blijft altijd een aanval.
- **Diersoort:** `Dier` = Wolf of Zwijn gaat naar de wolven- of zwijnenpagina. **Elk ander dier** (Hert, Ree, Vos, ...) gaat naar de
  pagina Overig (`"catch_all": "andere"` in de config) en onthoudt zijn naam (`diersoort`), zodat de kaart en de popup laten
  zien om welk dier het gaat. Een nieuwe diernaam in de keuzelijst van SeaTable werkt dus meteen; een eigen pagina voor een dier
  (bv. herten) is een blok in `SPECIES` in `assets/site.js` plus een pagina.
- **Plaatsnaam:** SeaTable bewaart alleen coördinaten. Het script zoekt de woonplaats op bij PDOK (gratis, officieel) en
  onthoudt het antwoord in `tools/place-cache.json`, dus elk punt wordt maar één keer opgevraagd. Punten die meer dan
  5 km van een Nederlandse woonplaats liggen (bv. Duitsland) heten "Onbekende locatie". Valt PDOK even uit, dan blijven
  de meldingen bewaard en draai je het script later opnieuw.
- **Omgewisselde coördinaten:** komt een punt buiten het gebied `coords_box` (Nederland en omgeving) uit, maar liggen breedte en
  lengte andersom wel binnen dat gebied, dan draait de sync ze om en zet een waarschuwing in de log (corrigeer het ook in
  SeaTable). Ligt een punt ver buiten het gebied in beide richtingen, dan wordt het alleen gemeld. Een "niet gevonden" van
  PDOK wordt nooit in `tools/place-cache.json` onthouden, dus een tijdelijke hapering blijft niet hangen.
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

Testen zonder SeaTable of internet: `python3 tools/test_seatable_sync.py` (en `python3 tools/test_site_seo.py` voor de pagina's) (nep-SeaTable en nep-PDOK; 31 tests voor de koppeling, 16 voor de pagina's,
waaronder een rondje oude data → SeaTable → site, met de bevroren oude data in `tools/fixtures/`). Tabellen en kolommen bekijken: `--inspect` (met `--sample`
twee voorbeeldrijen). De oude data als CSV exporteren voor een import in SeaTable kan met `--export-legacy`.

## Meldformulieren

Bezoekers melden via twee SeaTable-formulieren ("Meld een zichtmelding" en "Meld een aanval op vee"), maar ze komen er
eerst langs de pagina `melden.html` (`/melden`). Daar kiezen ze de plek op de kaart (tikken, de pin verslepen, "Gebruik mijn
locatie" met de GPS van de telefoon, of een plaats/straat zoeken om de kaart te verplaatsen) en gaan dan door naar het
SeaTable-formulier met de coördinaten al ingevuld; ze vullen nog diersoort en datum in. Reden: op een telefoon toont
SeaTable bij een geolocatie-kolom alleen losse lengte- en breedtegraadvelden, en die kunnen veel mensen niet invullen.

De pagina is gewone statische HTML/JS (`melden.html`, `assets/melden.js`, `assets/melden.css`): geen server, geen token, niets
dat naar SeaTable schrijft. De plek reist mee in het adres van het formulier
(`.../forms/<id>/?prefill_Latitude=52.2913&prefill_Longitude=5.7189`); de plaatsnaam bij de pin komt (in de browser van de
bezoeker) van PDOK. De adressen van de formulieren, de pagina-adressen en de namen van de kolommen die worden ingevuld staan
op één plek: `FORMS` en `PREFILL` bovenin `assets/site.js`. De knoppen op de homepage, de wolven- en zwijnenpagina en de
links in de voettekst wijzen naar `/melden?type=zichtmelding` of `?type=aanval`.

**Eenmalig in SeaTable (per tabel, dus `Zichtmeldingen` én `Aanval`):**

1. Voeg twee kolommen van het type **Getal** toe: `Latitude` en `Longitude` (staat er "precisie" aan, zet die dan uit of op 6
   decimalen, anders wordt de plek afgerond). De sync leest ook een tekstkolom, met komma of graden-teken. Andere namen kan ook, maar dan moet `PREFILL` in
   `assets/site.js` en `columns.lat/lon` in `tools/seatable.config.json` meeveranderen (een test controleert dat).
2. Zet beide kolommen in het formulier, als verplicht veld. Zet ze **niet** verborgen: dan ziet de melder ook wat er wordt
   doorgegeven en kan hij het aanpassen.
3. Haal het veld `Locatie` uit het formulier (de kolom zelf laat je staan: oude meldingen blijven werken). Anders moet de melder
   nog steeds een locatie invullen.
4. Test met: `https://cloud.seatable.io/dtable/forms/<id>/?prefill_Latitude=52.29&prefill_Longitude=5.72`. Beide velden
   moeten al gevuld zijn. (Een geolocatie-kolom kan SeaTable niet vooraf invullen; tekst en getallen wel.)

Zet je deze wijziging online **voordat** de kolommen in de formulieren staan, dan kiezen bezoekers een plek die niet
meekomt. Doe dus eerst de stappen hierboven, dan pas de site.

Nieuwe inzendingen wachten op jouw vinkje in de kolom `Verificatie` (zie hierboven). Zonder JavaScript verwijst `melden.html`
rechtstreeks naar de formulieren.

## Clusteren op de kaart

Op de homepage en de wolven-, zwijnen- en overig-pagina voegt `WDK.clusterLayer` (`assets/map-tools.js`) bolletjes die dicht bij
elkaar liggen samen tot één cluster met het totale aantal meldingen. Klik je op een cluster, dan zoom je in en valt het uit elkaar;
uitzoomen voegt ze weer samen. "Dicht bij elkaar" betekent: hoogstens **5 km** in werkelijkheid én hoogstens **60 pixels** op het
scherm, en vanaf zoomniveau **16** staat elk bolletje los. De drie getallen staan in `CLUSTER` bovenin dat blok
(`maxKm`, `maxPx`, `noClusterZoom`). Wil je dat bolletjes ook bij een landelijk beeld al eerder samengaan (nu gebeurt dat alleen
binnen 5 km), verhoog dan `maxKm`. De kleur van een cluster is die van de belangrijkste melding erin (aanval, dan jonkies, dan zicht);
op de homepage is een cluster met meerdere diersoorten grijs. Het zoeken van een plaats zoomt zo ver in dat het bolletje los staat en opent
dan zijn popup. De rekenregel zelf is `WDK.clusterPoints(items, zoom)` en heeft geen kaart nodig.

## Gedeelde kaartcode

Wat elke kaartpagina nodig heeft staat één keer in `assets/map-base.js` (geladen na Leaflet en `site.js`):

- `WDK.baseMap(id, { center, zoom, buttons? })`: de kaart met kaarttegels (licht/donker), formaat en zoomknoppen (`zoomIn`, `zoomOut`, `zoomReset`).
- `WDK.mountSearch({ input, results, find, onSelect, debounce? })`: de zoekbalk met lijst; `find(q)` geeft de resultaten (of een belofte, zoals bij PDOK op de meldpagina).
- `WDK.placeMarkers(rows, { color, popup, radius?, weight?, id? })`: de bolletjes van een lijst plaatsen, klaar voor `WDK.clusterLayer(...).setItems`.
- `WDK.revealMap(el)`: scrolt de kaart in beeld. De actieve menuknop die naar boven scrolt staat in `assets/theme.js`.

De pagina's (`wolven-page.js`, `zwijnen-page.js`, `overig-page.js`, `home-map.js`, `home-stats.js`, `melden.js`) houden alleen over wat bij hen hoort:
cijfers, popups, kleuren en welke plaatsen er zijn. Een nieuwe kaartpagina laadt `map-base.js` (en `map-tools.js` voor filters en clusters).

## Menubalk en voettekst

De menubalk en de voettekst (met een eigen achtergrondkleur over de volle breedte) staan als één sjabloon in
`tools/build_shell.py` en worden in alle pagina's tussen de markeringen `<!-- shell:nav -->` en `<!-- shell:footer -->`
gezet. Wijzig je iets (een link, een kolom, de tekst), pas dan het sjabloon aan en draai
`python3 tools/build_shell.py`; de pagina's niet met de hand aanpassen. `--check` controleert alleen (en draait mee in
`test_site_seo.py`). De opmaak staat in `assets/shell.css`; de kleur van de balken is `--bar-bg` bovenin dat bestand.
De meldlinks in de voettekst (`melden?type=...`) staan in het sjabloon zelf. Pagina-eigen voetnoten (bv. de uitleg over
plaatsnamen) staan per pagina in `PAGES` in het script.

## Vindbaarheid (SEO)

- Elke pagina heeft een eigen titel, beschrijving, canonical-adres, Open Graph/Twitter-gegevens en structured data (JSON-LD),
  en een korte, voor zoekmachines leesbare introtekst. Alle pagina's linken in de footer naar elkaar.
- `robots.txt` laat alles toe en wijst naar `sitemap.xml`. Die sitemap wordt niet met de hand bijgehouden: `tools/build_sitemap.py`
  maakt hem bij elke publicatie en zet bij elke pagina een `<lastmod>` (de datum van de laatste wijziging aan de pagina of aan
  haar meldingendata, uit de git-geschiedenis; de sync commit `data/` alleen bij nieuwe meldingen, dus de datum verandert precies
  dan). Daarom haalt de publicatiestap de volledige git-geschiedenis op (`fetch-depth: 0`); bij een ondiepe checkout blijft
  `<lastmod>` weg in plaats van een verkeerde datum te tonen. Het `sitemap.xml` in de repo is de kopie van een lokale run
  (`python3 tools/build_sitemap.py`) en wordt bij het publiceren vervangen.
- Een nieuwe pagina voeg je toe aan `PAGES` in `tools/build_sitemap.py`, aan `INDEXABLE` in `tools/test_site_seo.py` en aan de
  publicatiestap in `.github/workflows/site.yml`; `python3 tools/test_site_seo.py` controleert dat (en titels, beschrijvingen,
  canonicals, interne links en ankers).
- `google3490471582df8f40.html` in de root is het verificatiebestand van Google Search Console (eigendom van `wildkaart.rlode.nl`).
  Laat het staan en ongewijzigd; de publicatiestap kopieert het mee en een test bewaakt dat.
- **Eenmalig na de eerste publicatie:** meld `https://wildkaart.rlode.nl/sitemap.xml` aan in Google Search Console (en Bing
  Webmaster Tools), en controleer daar of de pagina's worden geïndexeerd.
- Beperking: de meldingen, cijfers en kaart worden met JavaScript getekend. Google voert dat uit, maar de introteksten en de
  Over-pagina zijn gewoon HTML en dus altijd leesbaar.

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

## Opmaak en scripts

De pagina's zelf zijn klein: alle opmaak en (bijna) alle code staat in `assets/`, zodat de browser ze één keer ophaalt en
onthoudt. In elke pagina blijven alleen het regeltje dat het gekozen thema meteen zet (anders flitst de pagina wit), de structured
data (JSON-LD) en de paar regels die de pagina aan een diersoort koppelen (`WDK.renderReportCta(...)`) inline staan.

| Bestand | Voor |
| --- | --- |
| `assets/species.css` | wolven-, zwijnen- en overig-pagina |
| `assets/home.css` | homepage |
| `assets/text.css` | `over.html` en `404.html` |
| `assets/shell.css`, `assets/map-tools.css` | menubalk en voettekst; filterbalk en hitte-laag (op alle pagina's) |
| `assets/wolven-page.js`, `zwijnen-page.js`, `overig-page.js` | de kaart, statistieken en verwachting van die pagina |
| `assets/home-map.js`, `assets/home-stats.js` | homepage: de landelijke kaart, dan tabel, grafiek en filters |
| `assets/theme.js`, `assets/back-to-top.js` | licht/donker-knop (alle pagina's); knop "Naar boven" (wolvenpagina) |
| `assets/fonts/` | lettertypen Fraunces, IBM Plex Sans en Plex Mono (alleen de subsets `latin` en `latin-ext`), zelf gehost |

Een wijziging in een pagina-eigen script of stijlblad werkt voor iedereen pas als hun browser het bestand opnieuw ophaalt
(GitHub Pages laat de browser bestanden ~10 minuten bewaren). De data-scripts krijgen daarom een versienummer (zie boven),
de bestanden in `assets/` niet. Een paginascript rekent op wat eerder wordt geladen: eerst de data, dan `site.js`, Leaflet en
`map-tools.js`, en pas daarna het paginascript; houd die volgorde aan als je een script toevoegt.

**Lettertypen** komen niet meer van Google Fonts. `assets/fonts/fonts.css` verwijst naar `.woff2`-bestanden in dezelfde map
(Google Fonts, SIL Open Font License). Nog een gewicht of stijl nodig? Haal het bestand op bij Google Fonts, zet het in
die map en voeg een `@font-face` toe aan `fonts.css`. `test_site_seo.py` faalt als een pagina weer naar Google Fonts of unpkg linkt.

## De kaart

De kaarten gebruiken **Leaflet** voor de interactie (zoom, pan, zoeken, popups) met **CARTO's
basemap-tegels** (Voyager voor licht, Dark Matter voor donker — schakelt automatisch mee met de
licht/donker-knop). CARTO vereist tegenwoordig een gratis API-key in de tegel-URL (`?key=...`); die
staat in de vier kaartscripts (`assets/home-map.js`, `wolven-page.js`, `zwijnen-page.js`, `overig-page.js`). Verandert de key,
pas hem dan in alle vier aan. De tegels zijn de enige externe dienst die de pagina's nog aanroepen.

Leaflet zelf (versie 1.9.4, BSD-2) staat in `assets/vendor/leaflet/` en wordt dus niet meer van unpkg.com geladen; dat is
sneller, werkt ook als unpkg even uitvalt en stuurt geen bezoekersgegevens naar een derde. Upgraden: nieuwe `leaflet.js`,
`leaflet.css` en de map `images/` van dezelfde versie uit het npm-pakket `leaflet` (`dist/`) in die map zetten.

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
- **Bij elke push naar `main`**: de site opnieuw publiceren. Gepubliceerd worden de pagina's (`index.html`, `wolven.html`,
  `zwijnen.html`, `overig.html`, `over.html`, `404.html`), `robots.txt`, een vers gemaakte `sitemap.xml`, `assets/` en `data/`
  (dus niet `tools/`, de tests of deze README).

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
