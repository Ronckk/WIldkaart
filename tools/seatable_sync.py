#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SeaTable -> website: haalt de tabellen met meldingen op en schrijft data/wolven-data.js en data/zwijnen-data.js.

Werking (alles server-side, dus de token komt nooit in de website terecht):
  1. API-token  -> base-token           GET  {server}/api/v2.1/dtable/app-access-token/
  2. tabellen + kolommen                GET  {server}/api-gateway/api/v2/dtables/{uuid}/metadata/
  3. rijen per tabel (pagina's van 1000) GET  {server}/api-gateway/api/v2/dtables/{uuid}/rows/?table_name=...
  4. rijen -> gebeurtenissen -> plaatsen -> data/*.js  (zelfde formaat als de handmatige databestanden)

Gebruik (alleen standaardbibliotheek, Python 3.9+):
  export SEATABLE_API_TOKEN=...            # of zet 'm in tools/.env  (SEATABLE_API_TOKEN=...)
  python3 tools/seatable_sync.py --inspect             # toon tabellen en kolommen, om de koppeling in te stellen
  python3 tools/seatable_sync.py --dry-run             # alles doorrekenen, niets schrijven
  python3 tools/seatable_sync.py                       # schrijf data/*.js  (de vorige versie blijft als *.bak staan)
  python3 tools/seatable_sync.py --export-legacy       # huidige data als CSV, om eenmalig in SeaTable te importeren
  python3 tools/seatable_sync.py --stamp               # alleen de versienummers in de HTML-pagina's bijwerken (geen token nodig)

De token hoort alleen leesrechten te hebben (API-token met "read-only").
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
AMS = ZoneInfo('Europe/Amsterdam')
PAGE = 1000


class SyncError(Exception):
    """Een fout die we aan de gebruiker willen uitleggen (geen stacktrace)."""


# ---------------------------------------------------------------- hulpfuncties
def norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().lower()


def load_env(path):
    """Leest KEY=VALUE-regels uit een .env-bestand (bestaande omgevingsvariabelen winnen)."""
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def is_checked(v):
    """Een SeaTable-checkbox is true/false, of null als hij nog nooit is aangevinkt."""
    if isinstance(v, str):
        return v.strip().lower() in ('true', '1', 'yes', 'ja', 'x')
    return v is True or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 1)


def as_text(v):
    """SeaTable geeft tekst, keuzelijsten (tekst/lijst) en koppelingen (lijst van dicts) terug."""
    if v is None:
        return ''
    if isinstance(v, list):
        return as_text(v[0]) if v else ''
    if isinstance(v, dict):
        for k in ('name', 'display_value', 'text', 'value', 'title'):
            if v.get(k):
                return as_text(v[k])
        return ''
    return str(v).strip()


def to_float(v):
    if isinstance(v, bool) or v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip().replace(',', '.'))
    except ValueError:
        return None


def parse_when(value):
    """-> (datum 'YYYY-MM-DD' of None, tijd 'HH:MM' of None). Tijden met tijdzone worden naar Nederlandse tijd omgezet;
    00:00 geldt als "geen tijd" (een datumkolom heeft geen tijdstip)."""
    s = as_text(value)
    if not s:
        return None, None
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?', s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        hh, mm, tz = m.group(4), m.group(5), m.group(7)
        try:
            day = datetime(y, mo, d)
        except ValueError:
            return None, None
        if hh is None:
            return day.strftime('%Y-%m-%d'), None
        dt = datetime(y, mo, d, int(hh), int(mm))
        if tz:
            off = '+00:00' if tz == 'Z' else (tz if ':' in tz else tz[:3] + ':' + tz[3:])
            dt = datetime.fromisoformat(dt.strftime('%Y-%m-%dT%H:%M:00') + off).astimezone(AMS)
        return dt.strftime('%Y-%m-%d'), (None if dt.strftime('%H:%M') == '00:00' else dt.strftime('%H:%M'))
    m = re.match(r'^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?', s)  # 18-09-2026 21:11
    if m:
        try:
            day = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None, None
        t = '%02d:%s' % (int(m.group(4)), m.group(5)) if m.group(4) else None
        return day.strftime('%Y-%m-%d'), (None if t == '00:00' else t)
    return None, None


def parse_time(value):
    s = as_text(value)
    m = re.search(r'(\d{1,2})[:.](\d{2})', s)
    if not m:
        return None
    t = '%02d:%s' % (int(m.group(1)), m.group(2))
    return None if t == '00:00' else t


def latlon_from(value):
    """Uit een geolocatie-/kaartkolom: {'lat':..,'lng':..} (ook lon/long/longitude/latitude)."""
    if not isinstance(value, dict):
        return None, None
    lat = next((to_float(value[k]) for k in ('lat', 'latitude') if k in value and to_float(value[k]) is not None), None)
    lon = next((to_float(value[k]) for k in ('lng', 'lon', 'long', 'longitude') if k in value and to_float(value[k]) is not None), None)
    return lat, lon


def norm_type(v, default):
    t = norm(as_text(v))
    if not t:
        return default
    if t.startswith('zicht'):
        return 'zichtmelding'
    if 'aanval' in t:
        return 'aanval'
    if 'jonk' in t:
        return 'jonkies'
    if 'aanrij' in t:
        return 'aanrijding'
    if 'schurft' in t:
        return 'schurft'
    return 'overig'


def norm_species(v, default, allowed):
    t = norm(as_text(v))
    if not t:
        return default
    if 'wolf' in t or 'wolven' in t:
        key = 'wolf'
    elif 'zwijn' in t:
        key = 'zwijn'
    else:
        return None
    return key if key in allowed else None


# ---------------------------------------------------------------- SeaTable API
def http_json(url, token=None, retries=3, service='SeaTable'):
    headers = {'Accept': 'application/json', 'User-Agent': 'wilde-dieren-sync/1.0'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, headers=headers)
    last = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SyncError('%s weigert de toegang (HTTP %d). Klopt de API-token, en heeft hij leesrechten op deze base?' % (service, e.code))
            if e.code == 404:
                raise SyncError('%s gaf 404 voor %s. Klopt de servernaam in tools/seatable.config.json?' % (service, urllib.parse.urlsplit(url).path))
            last = 'HTTP %d' % e.code
            if e.code == 429 or e.code >= 500:  # te druk of tijdelijk stuk: even wachten en opnieuw
                time.sleep(2 ** attempt * 2)
                continue
            raise SyncError('%s gaf %s voor %s' % (service, last, urllib.parse.urlsplit(url).path))
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(getattr(e, 'reason', e))
            time.sleep(2 ** attempt)
    raise SyncError('Geen verbinding met %s: %s' % (service, last))


class SeaTable:
    def __init__(self, server, api_token):
        self.server = server.rstrip('/')
        info = http_json(self.server + '/api/v2.1/dtable/app-access-token/', api_token)
        if not info.get('access_token') or not info.get('dtable_uuid'):
            raise SyncError('Onverwacht antwoord van SeaTable bij het ophalen van de base-token.')
        self.token, self.uuid, self.base_name = info['access_token'], info['dtable_uuid'], info.get('dtable_name', '')

    def metadata(self):
        meta = http_json('%s/api-gateway/api/v2/dtables/%s/metadata/' % (self.server, self.uuid), self.token)
        return meta.get('metadata', meta)  # de echte API verpakt het antwoord in {"metadata": {...}}

    def rows(self, table_name):
        out, start = [], 0
        while True:
            q = urllib.parse.urlencode({'table_name': table_name, 'convert_keys': 'true', 'limit': PAGE, 'start': start})
            page = http_json('%s/api-gateway/api/v2/dtables/%s/rows/?%s' % (self.server, self.uuid, q), self.token).get('rows', [])
            out.extend(page)
            if len(page) < PAGE:
                return out
            start += PAGE


# ---------------------------------------------------------------- rijen -> gebeurtenissen
def find_table(meta, name):
    tables = meta.get('tables', [])
    for t in tables:
        if norm(t.get('name')) == norm(name):
            return t
    raise SyncError('Tabel "%s" niet gevonden. Beschikbare tabellen: %s' % (name, ', '.join(t.get('name', '?') for t in tables) or '(geen)'))


def resolve_columns(cols, spec):
    """spec: {veld: kolomnaam of lijst mogelijke namen} -> {veld: echte kolomnaam of None} (hoofdletterongevoelig)."""
    by_norm = {norm(c['name']): c['name'] for c in cols}
    out = {}
    for field, cands in spec.items():
        cands = [cands] if isinstance(cands, str) else cands
        out[field] = next((by_norm[norm(c)] for c in cands if norm(c) in by_norm), None)
    return out


def read_table(sea_rows, tmeta, table_cfg, cfg, warn):
    """Zet de rijen van één tabel om naar (records, aantal_wachtend). Record = {species, place, d, tm, ty, lat, lon, regio, dieren}.
    `place` is leeg als de tabel geen plaatsnaam heeft; die wordt later uit de coördinaten opgezocht.
    Alleen rijen waarvan de verificatie-checkbox is aangevinkt komen op de site; de rest wacht op controle."""
    name = tmeta['name']
    spec = dict(cfg['columns'])
    spec.update(table_cfg.get('columns', {}))
    m = resolve_columns(tmeta['columns'], spec)
    # een geolocatiekolom is geen plaatsnaam, ook al heet hij "Locatie"
    text_cols = [c for c in tmeta['columns'] if c.get('type') not in ('geolocation', 'map_selection')]
    m['plaats'] = resolve_columns(text_cols, {'plaats': spec['plaats']})['plaats']
    geo = m.get('geo') or next((c['name'] for c in tmeta['columns'] if c.get('type') in ('geolocation', 'map_selection')), None)
    has_coords = bool((m['lat'] and m['lon']) or geo)
    if not m['datum'] or not (m['plaats'] or has_coords):
        raise SyncError('Tabel "%s": geen kolom gevonden voor %s. Kolommen in deze tabel: %s\n'
                        'Zet de juiste kolomnaam in tools/seatable.config.json (onder "columns" of onder de tabel).'
                        % (name, 'datum' if not m['datum'] else 'plaats of coördinaten',
                           ', '.join('%s (%s)' % (c['name'], c.get('type', '?')) for c in tmeta['columns'])))
    # slachtoffers: de gewone kolommen (dier/gedood) plus optionele extra paren ("Gedode dier 2" / "Aantal dood 2", ...)
    slots = [(m['dier'], m['gedood'])]
    for extra in cfg.get('extra_victims', []):
        em = resolve_columns(tmeta['columns'], extra)
        slots.append((em['dier'], em['gedood']))
    slots = [(d, g) for d, g in slots if d or g]
    vcfg = cfg.get('verification', {})
    vcol = resolve_columns(tmeta['columns'], {'v': vcfg['column']})['v'] if vcfg.get('column') else None
    if vcfg.get('column') and not vcol and vcfg.get('required', True):
        raise SyncError('Tabel "%s": geen verificatiekolom gevonden (gezocht: %s). Zonder die kolom zou ALLES gepubliceerd worden, dus het script stopt.\n'
                        'Voeg een checkbox-kolom toe, of zet de juiste naam in tools/seatable.config.json onder "verification". '
                        'Kolommen in deze tabel: %s' % (name, ', '.join(vcfg['column']), ', '.join(c['name'] for c in tmeta['columns'])))
    default_type = table_cfg.get('type', 'zichtmelding')
    allowed = set(cfg['output'].keys())
    recs, skipped, pending = [], 0, 0
    for row in sea_rows:
        if vcol and not is_checked(row.get(vcol)):
            pending += 1
            continue
        d, tm = parse_when(row.get(m['datum']))
        if tm is None and m['tijd']:
            tm = parse_time(row.get(m['tijd']))
        gval = row.get(geo) if geo else None
        lat = to_float(row.get(m['lat'])) if m['lat'] else None
        lon = to_float(row.get(m['lon'])) if m['lon'] else None
        if lat is None or lon is None:
            lat, lon = latlon_from(gval)
        place = re.sub(r'\s+', ' ', as_text(row.get(m['plaats'])) if m['plaats'] else '').strip()
        if not place and isinstance(gval, dict):
            place = as_text(gval.get('city') or gval.get('title') or gval.get('district'))
        if not d or not (place or (lat is not None and lon is not None)):
            skipped += 1
            continue
        species = norm_species(row.get(m['soort']) if m['soort'] else None, cfg['default_species'], allowed)
        if species is None:
            warn('Tabel "%s": onbekende diersoort "%s" bij %s - rij overgeslagen.' % (name, as_text(row.get(m['soort'])), d))
            continue
        rec = {'species': species, 'place': place, 'd': d, 'tm': tm,
               'ty': norm_type(row.get(m['type']) if m['type'] else None, default_type),
               'lat': lat, 'lon': lon, 'regio': norm(as_text(row.get(m['regio']))) if m['regio'] else ''}
        dieren = []
        for dcol, gcol in slots:
            dier = as_text(row.get(dcol)) if dcol else ''
            g = to_float(row.get(gcol)) if gcol else None
            if not dier and g is None:
                continue  # lege plek in het formulier
            v = {}
            if dier:
                v['dier'] = dier
            if g is not None:
                v['gedood'] = int(g) if g == int(g) else g
            dieren.append(v)
        if dieren:
            rec['dieren'] = dieren
        recs.append(rec)
    if skipped:
        warn('Tabel "%s": %d rij(en) zonder geldige datum of zonder plaats/coördinaten overgeslagen.' % (name, skipped))
    return recs, pending


# ---------------------------------------------------------------- plaatsnaam uit coördinaten (PDOK)
PDOK_REVERSE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse'
UNKNOWN_PLACE = 'Onbekende locatie'


def pdok_reverse(lat, lon, max_distance):
    """Woonplaats bij een coördinaat (gratis, geen sleutel). -> {'name','lat','lon'} van het dorp/de stad; name=None als er
    binnen max_distance meter geen Nederlandse woonplaats ligt (bv. in Duitsland)."""
    q = urllib.parse.urlencode({'lat': lat, 'lon': lon, 'type': 'woonplaats', 'rows': 1, 'distance': max_distance,
                                'fl': 'woonplaatsnaam,centroide_ll'})
    docs = http_json(PDOK_REVERSE + '?' + q, service='PDOK').get('response', {}).get('docs', [])
    if not docs:
        return {'name': None}
    c = re.match(r'POINT\(([-\d.]+) ([-\d.]+)\)', docs[0].get('centroide_ll', ''))
    return {'name': docs[0].get('woonplaatsnaam'), 'lat': float(c.group(2)) if c else None, 'lon': float(c.group(1)) if c else None}


class PlaceLookup:
    """Zoekt plaatsnamen op uit coördinaten en onthoudt de antwoorden (tools/place-cache.json), zodat elk punt maar één keer
    bij PDOK wordt opgevraagd."""

    def __init__(self, path, max_distance=5000, enabled=True):
        self.path, self.max_distance, self.enabled = path, max_distance, enabled
        self.cache, self.dirty, self.fetched, self.errors = {}, False, 0, []
        if path and path.exists():
            try:
                self.cache = json.loads(path.read_text(encoding='utf-8'))
            except ValueError:
                self.cache = {}

    def get(self, lat, lon):
        key = '%.4f,%.4f' % (lat, lon)  # ~11 m: dichterbij dan de plaatsgrenzen ooit uit elkaar liggen
        if key in self.cache:
            return self.cache[key]
        if not self.enabled:
            return None
        try:
            res = pdok_reverse(lat, lon, self.max_distance)
        except SyncError as e:
            if str(e) not in self.errors:
                self.errors.append(str(e))
            return None
        self.fetched += 1
        self.cache[key] = res
        self.dirty = True
        time.sleep(0.05)
        return res

    def save(self):
        if self.dirty and self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
            self.dirty = False


def resolve_places(recs, lookup, warn, need_town_center=False):
    """Vult `place` in voor records zonder plaatsnaam (en `town_lat/town_lon`, het middelpunt van dat dorp, als dat nodig is).
    Punten met een bekende plaatsnaam worden alleen opgezocht in modus "town"."""
    outside, failed = 0, 0
    for r in recs:
        if r['lat'] is not None and r['lon'] is not None and (not r['place'] or need_town_center):
            res = lookup.get(r['lat'], r['lon'])
            if res and res.get('lat') is not None:
                r['town_lat'], r['town_lon'] = res['lat'], res['lon']
            if not r['place']:
                if res is None:
                    r['place'] = UNKNOWN_PLACE
                    failed += 1
                elif res.get('name'):
                    r['place'] = res['name']
                else:
                    r['place'] = UNKNOWN_PLACE
                    outside += 1
    for e in lookup.errors:
        warn('Plaatsnaam opzoeken lukte niet (%s). Betreffende meldingen staan als "%s"; draai het script later opnieuw.' % (e, UNKNOWN_PLACE))
    if outside:
        warn('%d melding(en) liggen niet bij een Nederlandse woonplaats (>%d m) en staan als "%s".' % (outside, lookup.max_distance, UNKNOWN_PLACE))


# ---------------------------------------------------------------- gebeurtenissen -> plaatsen -> bestanden
def ev_sort_key(e):
    return (e['d'], e.get('tm') or '')


def in_veluwe(lat, lon, box):
    return box[0] <= lat <= box[1] and box[2] <= lon <= box[3]


def load_data_file(path):
    """Leest een bestaand data/*.js-bestand ('window.X = {...};') -> dict of None."""
    if not path.exists():
        return None
    s = path.read_text(encoding='utf-8')
    try:
        return json.loads(s[s.index('=') + 1:].strip().rstrip(';'))
    except ValueError:
        return None


def all_places(data):
    """Alle plaatsen (Veluwe + elders) uit een ingelezen data/*.js."""
    if not data:
        return []
    return list((data.get('veluwe') or {}).get('all', [])) + list(data.get('overig', []))


def known_coords(data):
    return {norm(b['n']): (b['lat'], b['lon']) for b in all_places(data)}


def build_species(recs, cfg, known, warn):
    """recs (één diersoort) -> {'veluwe': [plaatsen], 'overig': [plaatsen]} met plaats = {n, lat, lon, ev}.
    position "exact": één bolletje per exact gemeld punt (meldingen op hetzelfde punt tellen samen);
    position "town":  één bolletje per plaats, op het middelpunt van die plaats."""
    exact = cfg.get('position', 'exact') == 'exact'
    groups = {}
    for r in sorted(recs, key=ev_sort_key, reverse=True):  # nieuwste eerst
        if exact and r['lat'] is not None and r['lon'] is not None:
            key = (norm(r['place']), round(r['lat'], 4), round(r['lon'], 4))
        else:
            key = (norm(r['place']),)
        g = groups.setdefault(key, {'n': r['place'], 'coords': [], 'town': None, 'ev': [], 'regio': set()})
        if r['lat'] is not None and r['lon'] is not None:
            g['coords'].append((r['lat'], r['lon']))
        if r.get('town_lat') is not None and g['town'] is None:
            g['town'] = (r['town_lat'], r['town_lon'])
        if r['regio']:
            g['regio'].add(r['regio'])
        e = {'d': r['d'], 'ty': r['ty']}
        if r['tm']:
            e['tm'] = r['tm']
        if 'dieren' in r:
            e['dieren'] = r['dieren']
        g['ev'].append(e)
    veluwe, overig = [], []
    for key, g in groups.items():
        if not exact and g['town']:
            lat, lon = g['town']
        elif g['coords']:
            lat, lon = g['coords'][0]
            spread = max(abs(c[0] - lat) + abs(c[1] - lon) for c in g['coords'])
            if not exact and spread > 0.05:
                warn('"%s": de coördinaten verschillen tussen meldingen (tot ~%.0f km); de nieuwste worden gebruikt.' % (g['n'], spread * 100))
        elif key[0] in known:
            lat, lon = known[key[0]]
        elif g['town']:
            lat, lon = g['town']
        else:
            warn('"%s": geen coördinaten in SeaTable en niet bekend uit de huidige data - %d melding(en) overgeslagen.' % (g['n'], len(g['ev'])))
            continue
        place = {'n': g['n'], 'lat': round(lat, 6), 'lon': round(lon, 6), 'ev': g['ev']}
        if any('overig' in r for r in g['regio']):
            region = 'overig'
        elif any('veluwe' in r for r in g['regio']):
            region = 'veluwe'
        else:
            region = 'veluwe' if in_veluwe(lat, lon, cfg['veluwe_bbox']) else 'overig'
        (veluwe if region == 'veluwe' else overig).append(place)
    order = lambda p: (-len(p['ev']), p['n'], p['lat'])
    return {'veluwe': sorted(veluwe, key=order), 'overig': sorted(overig, key=order)}


def data_version(path):
    """Korte vingerafdruk van een databestand: verandert alleen als de inhoud verandert."""
    return hashlib.sha1(path.read_bytes()).hexdigest()[:10]


def stamp_html(root, cfg, dry=False):
    """Zet ?v=<vingerafdruk> achter de data-scripts in de HTML-pagina's (<script src="data/x.js?v=abc123">).
    Zo vraagt een browser of host na elke sync het nieuwe databestand op in plaats van een oude kopie uit de cache.
    -> lijst namen van pagina's die (zouden) veranderen."""
    versions = {}
    for outcfg in cfg['output'].values():
        f = root / outcfg['file']
        if f.exists():
            versions[outcfg['file']] = data_version(f)
    changed = []
    for page in sorted(root.glob('*.html')):
        text = page.read_text(encoding='utf-8')
        new = text
        for name, v in versions.items():
            new = re.sub(r'(src="%s)(?:\?v=[^"]*)?(")' % re.escape(name), r'\g<1>?v=%s\g<2>' % v, new)
        if new != text:
            changed.append(page.name)
            if not dry:
                page.write_text(new, encoding='utf-8')
    return changed


def is_unchanged(existing, built):
    """Staat er al precies deze inhoud in het bestand? (`updatedAt` telt niet mee: die zegt wanneer er iets NIEUWS bij kwam.)"""
    return bool(existing) and existing.get('veluwe') == {'all': built['veluwe']} and existing.get('overig') == built['overig']


def write_data_file(path, var, built, now, backup_dir):
    data = {'updatedAt': now, 'veluwe': {'all': built['veluwe']}, 'overig': built['overig']}
    tmp = path.with_suffix('.js.tmp')
    tmp.write_text('window.%s = %s;\n' % (var, json.dumps(data, ensure_ascii=False)), encoding='utf-8')
    if path.exists():
        path.with_suffix('.js.bak').write_bytes(path.read_bytes())  # de vorige versie
        once = backup_dir / path.name  # de allereerste versie (van vóór de koppeling) blijft altijd bewaard
        if not once.exists():
            backup_dir.mkdir(parents=True, exist_ok=True)
            once.write_bytes(path.read_bytes())
    tmp.replace(path)


def count_events(places):
    return sum(len(p.get('ev', [])) for p in places)


# ---------------------------------------------------------------- commando's
def cmd_inspect(sea, cfg, sample):
    meta = sea.metadata()
    print('Base: %s\n' % (sea.base_name or sea.uuid))
    for t in meta.get('tables', []):
        print('Tabel "%s"' % t['name'])
        for c in t['columns']:
            print('    - %-28s %s' % (c['name'], c.get('type', '?')))
        if sample and norm(t['name']) in [norm(n) for n in cfg['tables']]:
            rows = sea.rows(t['name'])
            print('    (%d rijen; voorbeeld van de nieuwste 2, persoonlijke gegevens eerst weghalen voordat je dit deelt)' % len(rows))
            for r in rows[-2:]:
                print('    ' + json.dumps({k: v for k, v in r.items() if not k.startswith('_')}, ensure_ascii=False)[:600])
        print()


def cmd_sync(sea, cfg, root, dry, force):
    warns = []
    warn = warns.append
    meta = sea.metadata()
    recs = []
    for tname, tcfg in cfg['tables'].items():
        tmeta = find_table(meta, tname)
        got, pending = read_table(sea.rows(tmeta['name']), tmeta, tcfg, cfg, warn)
        print('Tabel "%s": %d meldingen gelezen%s' % (tmeta['name'], len(got),
              ', %d wachten op verificatie (niet gepubliceerd)' % pending if pending else ''))
        recs.extend(got)
    lcfg = cfg.get('place_lookup', {})
    lookup = PlaceLookup(root / 'tools' / 'place-cache.json', lcfg.get('max_distance_m', 5000), lcfg.get('enabled', True))
    resolve_places(recs, lookup, warn, cfg.get('position', 'exact') == 'town')
    lookup.save()
    if lookup.fetched:
        print('Plaatsnamen opgezocht bij PDOK: %d nieuwe punten (de rest kwam uit tools/place-cache.json)' % lookup.fetched)
    now = datetime.now(AMS).strftime('%Y-%m-%dT%H:%M')
    problems = []
    plan = []
    for species, outcfg in cfg['output'].items():
        path = root / outcfg['file']
        existing = load_data_file(path)
        built = build_species([r for r in recs if r['species'] == species], cfg, known_coords(existing), warn)
        new_n, old_n = count_events(built['veluwe'] + built['overig']), count_events(all_places(existing))
        print('%-6s %4d meldingen in %3d plaatsen (Veluwe %d, elders %d)   [nu in %s: %d]' % (
            species, new_n, len(built['veluwe']) + len(built['overig']), len(built['veluwe']), len(built['overig']), outcfg['file'], old_n))
        if old_n and new_n < old_n * 0.5 and not force:
            problems.append('%s: SeaTable levert %d meldingen, het huidige bestand heeft er %d. Dat lijkt fout (bv. een lege of verkeerde tabel). '
                            'Controleer de koppeling, of gebruik --force als dit klopt.' % (species, new_n, old_n))
        plan.append((root / outcfg['file'], outcfg['var'], built, is_unchanged(existing, built)))
    for w in warns:
        print('LET OP: ' + w)
    if problems:
        raise SyncError('Niets geschreven.\n' + '\n'.join(problems))
    if dry:
        print('\nDry-run: niets geschreven.')
        return
    wrote = False
    for path, var, built, same in plan:
        if same:
            print('Ongewijzigd: %s' % path.relative_to(root))
            continue
        write_data_file(path, var, built, now, root / 'tools' / 'backup')
        print('Geschreven: %s' % path.relative_to(root))
        wrote = True
    changed = stamp_html(root, cfg)
    if changed:
        print('Versienummer van de data bijgewerkt in: %s' % ', '.join(changed))
    if not wrote:
        print('\nGeen nieuwe meldingen: alle bestanden zijn ongewijzigd.')
        return
    print('\nKlaar. De vorige versies staan als *.bak naast de bestanden (en de allereerste in tools/backup/). Upload de HTML-pagina\'s én de data/-map om het online te zetten.')


def cmd_export_legacy(cfg, root, outdir):
    """De huidige handmatige data als twee CSV-bestanden voor een eenmalige import in SeaTable."""
    outdir.mkdir(parents=True, exist_ok=True)
    zicht, aanval, undated = [], [], []
    label = {'zichtmelding': 'Zichtmelding', 'jonkies': 'Met jonkies', 'aanrijding': 'Aanrijding', 'schurft': 'Schurft', 'overig': 'Overig'}
    for species, outcfg in cfg['output'].items():
        data = load_data_file(root / outcfg['file'])
        if not data:
            continue
        for b in all_places(data):
            if not b.get('ev'):
                undated.append(b['n'])
            for e in b.get('ev', []):
                base = [b['n'], e['d'], e.get('tm', ''), b['lat'], b['lon'], species]
                if e['ty'] == 'aanval':
                    first = (e.get('dieren') or [{}])[0]  # de export kent één slachtoffer-paar per aanval
                    aanval.append(base + [first.get('dier', ''), first.get('gedood', '')])
                else:
                    zicht.append(base + [label.get(e['ty'], 'Overig')])
    head = ['Plaats', 'Datum', 'Tijd', 'Latitude', 'Longitude', 'Diersoort']
    for name, header, rows in (('zichtmeldingen', head + ['Type'], zicht), ('aanval', head + ['Dier', 'Gedood'], aanval)):
        path = outdir / (name + '.csv')
        with open(path, 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(sorted(rows, key=lambda r: (r[1], r[2]), reverse=True))
        print('%s: %d rijen' % (path.relative_to(root) if root in path.parents else path, len(rows)))
    if undated:
        print('LET OP: %d plaats(en) hebben een melding zonder datum en staan niet in de export: %s. Voeg ze zelf met datum toe in SeaTable.'
              % (len(undated), ', '.join(undated)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--config', default=str(ROOT / 'tools' / 'seatable.config.json'))
    ap.add_argument('--root', default=str(ROOT), help='projectmap met data/ (standaard: deze site)')
    ap.add_argument('--inspect', action='store_true', help='toon tabellen en kolommen van de base')
    ap.add_argument('--sample', action='store_true', help='bij --inspect: ook twee voorbeeldrijen tonen')
    ap.add_argument('--dry-run', action='store_true', help='alles doorrekenen maar niets schrijven')
    ap.add_argument('--force', action='store_true', help='schrijf ook als er veel minder meldingen zijn dan nu')
    ap.add_argument('--stamp', action='store_true', help='alleen de versienummers achter de data-scripts in de HTML-pagina\'s bijwerken')
    ap.add_argument('--export-legacy', action='store_true', help='schrijf de huidige data als CSV voor import in SeaTable')
    ap.add_argument('--server', help='overschrijft "server" uit de config')
    args = ap.parse_args(argv)
    root = Path(args.root)
    try:
        cfg = json.loads(Path(args.config).read_text(encoding='utf-8'))
        if args.export_legacy:
            return cmd_export_legacy(cfg, root, root / 'tools' / 'export')
        if args.stamp:
            changed = stamp_html(root, cfg)
            print('Versienummer bijgewerkt in: %s' % ', '.join(changed) if changed else 'Alle versienummers waren al actueel.')
            return 0
        load_env(ROOT / 'tools' / '.env')
        token = os.environ.get('SEATABLE_API_TOKEN', '').strip()
        if not token:
            raise SyncError('Geen token gevonden. Zet SEATABLE_API_TOKEN in je omgeving of in tools/.env (regel: SEATABLE_API_TOKEN=...).')
        sea = SeaTable(args.server or cfg['server'], token)
        if args.inspect:
            return cmd_inspect(sea, cfg, args.sample)
        cmd_sync(sea, cfg, root, args.dry_run, args.force)
    except SyncError as e:
        print('FOUT: %s' % e, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
