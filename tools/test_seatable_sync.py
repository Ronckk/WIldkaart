#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test voor seatable_sync.py zonder echt SeaTable: een nep-server met dezelfde endpoints, en een rondje
huidige data -> CSV-export -> "SeaTable"-tabellen -> sync -> vergelijken met het origineel.

Draai:  python3 tools/test_seatable_sync.py
"""
import csv
import json
import re
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seatable_sync as sync  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TOKEN = 'test-api-token'


class Mock:
    """Nep-SeaTable: tabellen = {naam: {'columns': [(naam, type)], 'rows': [dict]}}."""
    tables = {}
    calls = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlsplit(self.path)
        q = parse_qs(u.query)
        auth = self.headers.get('Authorization', '')
        Mock.calls.append(u.path)
        if u.path == '/api/v2.1/dtable/app-access-token/':
            if auth != 'Bearer ' + TOKEN:
                return self._send(403, {'error_msg': 'Permission denied.'})
            return self._send(200, {'access_token': 'BASE', 'dtable_uuid': 'uuid-1', 'dtable_name': 'Mock base'})
        if auth != 'Bearer BASE':
            return self._send(403, {'error_msg': 'Permission denied.'})
        if u.path == '/api-gateway/api/v2/dtables/uuid-1/metadata/':
            return self._send(200, {'metadata': {'version': 1, 'tables': [
                {'_id': 't%d' % i, 'name': n, 'columns': [{'key': 'k%d' % j, 'name': c, 'type': t} for j, (c, t) in enumerate(spec['columns'])]}
                for i, (n, spec) in enumerate(Mock.tables.items())]}})
        if u.path == '/api-gateway/api/v2/dtables/uuid-1/rows/':
            spec = Mock.tables.get(q['table_name'][0])
            if spec is None:
                return self._send(404, {'error_msg': 'table not found'})
            start, limit = int(q.get('start', ['0'])[0]), int(q.get('limit', ['1000'])[0])
            return self._send(200, {'rows': spec['rows'][start:start + limit]})
        return self._send(404, {})


def csv_rows(path):
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def snapshot(path):
    """{plaatsnaam: (lat, lon, gesorteerde gebeurtenissen)} en welke plaatsen op de Veluwe liggen."""
    data = sync.load_data_file(path)
    veluwe = {b['n']: b for b in data['veluwe']['all']}
    overig = {b['n']: b for b in data['overig']}
    def pack(b):
        return (round(b['lat'], 4), round(b['lon'], 4), sorted((e['d'], e['ty'], e.get('tm')) for e in b['ev']))
    return ({n: pack(b) for n, b in veluwe.items() if b['ev']}, {n: pack(b) for n, b in overig.items() if b['ev']}, data)


class SyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(('127.0.0.1', 0), Handler)
        cls.url = 'http://127.0.0.1:%d' % cls.srv.server_port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / 'tools' / 'fixtures', self.tmp / 'data')  # bevroren kopie van de oude handmatige data
        for page in ROOT.glob('*.html'):
            shutil.copy(page, self.tmp / page.name)
        (self.tmp / 'tools').mkdir()
        self.cfg_path = self.tmp / 'config.json'
        shutil.copy(ROOT / 'tools' / 'seatable.config.json', self.cfg_path)
        self.cfg = json.loads(self.cfg_path.read_text(encoding='utf-8'))
        Mock.calls = []
        import os
        os.environ['SEATABLE_API_TOKEN'] = TOKEN
        sync.PAGE = 100  # dwing paginering af
        sync.pdok_reverse = lambda lat, lon, d: (_ for _ in ()).throw(AssertionError('onverwachte PDOK-aanroep'))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def verified(tables=None):
        """Voegt aan elke nep-tabel de checkbox-kolom 'Verificatie' toe en vinkt alle bestaande rijen aan."""
        for spec in (tables if tables is not None else Mock.tables).values():
            if not any(c == 'Verificatie' for c, _ in spec['columns']):
                spec['columns'].append(('Verificatie', 'checkbox'))
            for row in spec['rows']:
                row.setdefault('Verificatie', True)

    def run_sync(self, *extra):
        return sync.main(['--config', str(self.cfg_path), '--root', str(self.tmp), '--server', self.url] + list(extra))

    def load_tables_from_export(self):
        sync.main(['--config', str(self.cfg_path), '--root', str(self.tmp), '--export-legacy'])
        exp = self.tmp / 'tools' / 'export'
        Mock.tables = {
            'zichtmeldingen': {'columns': [('Plaats', 'text'), ('Datum', 'date'), ('Tijd', 'text'), ('Latitude', 'number'), ('Longitude', 'number'),
                                           ('Diersoort', 'single-select'), ('Type', 'single-select')],
                               'rows': csv_rows(exp / 'zichtmeldingen.csv')},
            'aanval': {'columns': [('Plaats', 'text'), ('Datum', 'date'), ('Tijd', 'text'), ('Latitude', 'number'), ('Longitude', 'number'),
                                   ('Diersoort', 'single-select'), ('Dier', 'text'), ('Gedood', 'number')],
                       'rows': csv_rows(exp / 'aanval.csv')},
        }
        self.verified()

    # ------------------------------------------------------------ rondje: origineel -> SeaTable -> origineel
    def test_roundtrip_reproduces_current_data(self):
        before = {k: snapshot(self.tmp / 'data' / f) for k, f in (('wolf', 'wolven-data.js'), ('zwijn', 'zwijnen-data.js'))}
        self.load_tables_from_export()
        self.assertEqual(self.run_sync(), 0)
        for k, f in (('wolf', 'wolven-data.js'), ('zwijn', 'zwijnen-data.js')):
            after = snapshot(self.tmp / 'data' / f)
            self.assertEqual(after[0], before[k][0], k + ': Veluwe-plaatsen verschillen')
            self.assertEqual(after[1], before[k][1], k + ': plaatsen elders verschillen')
        # pagina's van 100 rijen -> meerdere aanroepen naar /rows/
        self.assertGreater(sum(1 for c in Mock.calls if c.endswith('/rows/')), 4)
        # vorige versie bewaard
        self.assertTrue((self.tmp / 'data' / 'wolven-data.js.bak').exists())

    def test_output_is_readable_by_the_site(self):
        self.load_tables_from_export()
        self.run_sync()
        s = (self.tmp / 'data' / 'wolven-data.js').read_text(encoding='utf-8')
        self.assertTrue(s.startswith('window.WOLVEN_DATA = {'))
        data = sync.load_data_file(self.tmp / 'data' / 'wolven-data.js')
        self.assertRegex(data['updatedAt'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')
        self.assertEqual(set(data['veluwe']['all'][0].keys()), {'n', 'lat', 'lon', 'ev'})

    def test_dry_run_writes_nothing(self):
        self.load_tables_from_export()
        before = (self.tmp / 'data' / 'wolven-data.js').read_bytes()
        self.assertEqual(self.run_sync('--dry-run'), 0)
        self.assertEqual((self.tmp / 'data' / 'wolven-data.js').read_bytes(), before)

    # ------------------------------------------------------------ veiligheid
    def test_empty_tables_do_not_wipe_the_site(self):
        Mock.tables = {'zichtmeldingen': {'columns': [('Plaats', 'text'), ('Datum', 'date')], 'rows': []},
                       'aanval': {'columns': [('Plaats', 'text'), ('Datum', 'date')], 'rows': []}}
        self.verified()
        before = (self.tmp / 'data' / 'wolven-data.js').read_bytes()
        self.assertEqual(self.run_sync(), 1)
        self.assertEqual((self.tmp / 'data' / 'wolven-data.js').read_bytes(), before)

    def test_wrong_token_is_explained(self):
        import os
        os.environ['SEATABLE_API_TOKEN'] = 'fout'
        self.assertEqual(self.run_sync(), 1)

    def test_missing_table_lists_available_ones(self):
        Mock.tables = {'iets-anders': {'columns': [('Plaats', 'text')], 'rows': []}}
        try:
            sync.find_table({'tables': [{'name': 'iets-anders', 'columns': []}]}, 'aanval')
        except sync.SyncError as e:
            self.assertIn('iets-anders', str(e))
        else:
            self.fail('SyncError verwacht')

    # ------------------------------------------------------------ omzetting van waarden
    def test_parse_when(self):
        p = sync.parse_when
        self.assertEqual(p('2026-09-18'), ('2026-09-18', None))
        self.assertEqual(p('2026-09-18 21:11'), ('2026-09-18', '21:11'))
        self.assertEqual(p('2026-09-18T21:11:00+02:00'), ('2026-09-18', '21:11'))
        self.assertEqual(p('2026-09-18T19:11:00.000Z'), ('2026-09-18', '21:11'))      # UTC -> zomertijd
        self.assertEqual(p('2026-01-05T23:30:00Z'), ('2026-01-06', '00:30'))         # datum schuift mee over middernacht
        self.assertEqual(p('2026-09-18T00:00:00'), ('2026-09-18', None))             # 00:00 = geen tijd
        self.assertEqual(p('18-09-2026 21:11'), ('2026-09-18', '21:11'))
        self.assertEqual(p('2026-02-31'), (None, None))
        self.assertEqual(p(''), (None, None))
        self.assertEqual(p(None), (None, None))

    def test_geolocation_and_choice_columns(self):
        self.assertEqual(sync.latlon_from({'lat': 52.2, 'lng': 5.9, 'city': 'Epe'}), (52.2, 5.9))
        self.assertEqual(sync.latlon_from({'latitude': '52,2', 'longitude': '5,9'}), (52.2, 5.9))
        self.assertEqual(sync.latlon_from('geen dict'), (None, None))
        self.assertEqual(sync.as_text([{'display_value': 'Putten'}]), 'Putten')
        self.assertEqual(sync.as_text({'name': 'Aanval op vee'}), 'Aanval op vee')
        self.assertEqual(sync.norm_type('Aanval op vee', 'zichtmelding'), 'aanval')
        self.assertEqual(sync.norm_type('Met jonkies gezien', 'zichtmelding'), 'jonkies')
        self.assertEqual(sync.norm_type('', 'aanval'), 'aanval')
        self.assertEqual(sync.norm_species('Wolven', 'wolf', {'wolf', 'zwijn'}), 'wolf')
        self.assertEqual(sync.norm_species('Wild zwijn', 'wolf', {'wolf', 'zwijn'}), 'zwijn')
        self.assertIsNone(sync.norm_species('Hert', 'wolf', {'wolf', 'zwijn'}))                  # zonder vangnet: onbekend
        self.assertEqual(sync.norm_species('Hert', 'wolf', {'wolf', 'zwijn', 'andere'}, 'andere'), 'andere')
        self.assertEqual(sync.norm_species('Wolf', 'wolf', {'wolf', 'zwijn', 'andere'}, 'andere'), 'wolf')

    # ------------------------------------------------------------ jouw echte tabelindeling (Dier / Datum / Locatie ...)
    def real_layout(self):
        first = {'lng': 5.716819, 'lat': 52.301537}
        Mock.tables = {
            'Zichtmeldingen': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation')],
                               'rows': [{'Dier': 'Wolf', 'Datum': '2026-09-18T21:11:00+02:00', 'Locatie': first},
                                        {'Dier': 'Wolf', 'Datum': '2026-09-19', 'Locatie': {'lng': 5.7300, 'lat': 52.3100}},
                                        {'Dier': 'Zwijn', 'Datum': '2026-09-10', 'Locatie': {'lng': 5.75, 'lat': 52.32}},
                                        {'Dier': 'Wolf', 'Datum': '2026-09-01', 'Locatie': {'lng': 6.62, 'lat': 51.84}}]},
            'Aanval': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), ('Gedode dier', 'single-select'),
                                   ('Aantal dood', 'number')],
                       'rows': [{'Dier': 'Wolf', 'Datum': '2026-09-17T23:10:00+02:00', 'Locatie': first, 'Gedode dier': 'Schaap', 'Aantal dood': 3}]},
        }
        self.verified()
        self.geocoded = []

        def fake(lat, lon, max_distance):
            self.geocoded.append((round(lat, 4), round(lon, 4)))
            if lon > 6:
                return {'name': None}                                   # buiten Nederland
            return {'name': 'Ermelo', 'lat': 52.288, 'lon': 5.666} if lat < 52.315 else {'name': 'Elspeet', 'lat': 52.29, 'lon': 5.8}
        sync.pdok_reverse = fake

    def places(self, filename):
        data = sync.load_data_file(self.tmp / 'data' / filename)
        return data, data['veluwe']['all'] + data['overig']

    def test_real_layout_names_from_coordinates_and_exact_dots(self):
        self.real_layout()
        self.assertEqual(self.run_sync('--force'), 0)
        data, wolf = self.places('wolven-data.js')
        ermelo = sorted((b for b in wolf if b['n'] == 'Ermelo'), key=lambda b: b['lat'])
        self.assertEqual(len(ermelo), 2)                                     # twee exacte punten in dezelfde plaats = twee bolletjes
        self.assertEqual((ermelo[0]['lat'], ermelo[0]['lon']), (52.301537, 5.716819))   # exacte positie
        self.assertEqual(ermelo[0]['ev'], [{'d': '2026-09-18', 'ty': 'zichtmelding', 'tm': '21:11'},
                                           {'d': '2026-09-17', 'ty': 'aanval', 'tm': '23:10', 'dieren': [{'dier': 'Schaap', 'gedood': 3}]}])
        abroad = [b for b in wolf if b['n'] == 'Onbekende locatie']
        self.assertEqual(len(abroad), 1)                                     # buiten NL: niet naar een verkeerd dorp
        _, zwijn = self.places('zwijnen-data.js')
        self.assertEqual([b['n'] for b in zwijn], ['Elspeet'])
        # eerste versie (de oude handmatige data) staat veilig in tools/backup
        self.assertTrue((self.tmp / 'tools' / 'backup' / 'wolven-data.js').exists())

    def test_place_lookups_are_cached(self):
        self.real_layout()
        self.run_sync('--force')
        n = len(self.geocoded)
        self.assertGreater(n, 0)
        self.run_sync('--force')
        # tweede keer: alles uit tools/place-cache.json, behalve het punt buiten Nederland (een "niet gevonden" wordt nooit onthouden)
        self.assertEqual(len(self.geocoded), n + 1)

    def test_town_mode_puts_one_dot_on_the_town_centre(self):
        self.real_layout()
        self.cfg['position'] = 'town'
        self.cfg_path.write_text(json.dumps(self.cfg), encoding='utf-8')
        self.assertEqual(self.run_sync('--force'), 0)
        _, wolf = self.places('wolven-data.js')
        ermelo = [b for b in wolf if b['n'] == 'Ermelo']
        self.assertEqual(len(ermelo), 1)
        self.assertEqual((ermelo[0]['lat'], ermelo[0]['lon']), (52.288, 5.666))          # middelpunt, niet de exacte plek
        self.assertEqual(len(ermelo[0]['ev']), 3)

    def test_pdok_outage_keeps_the_reports(self):
        self.real_layout()

        def down(lat, lon, d):
            raise sync.SyncError('Geen verbinding met PDOK: nep')
        sync.pdok_reverse = down
        self.assertEqual(self.run_sync('--force'), 0)
        _, wolf = self.places('wolven-data.js')
        self.assertEqual(sum(len(b['ev']) for b in wolf), 4)                 # niets kwijt, alleen tijdelijk "Onbekende locatie"
        self.assertFalse((self.tmp / 'tools' / 'place-cache.json').exists())  # mislukte opzoekingen worden niet onthouden

    # ------------------------------------------------------------ versienummers tegen verouderde cache
    def script_tags(self, page):
        return re.findall(r'<script src="(data/[^"]+)"', (self.tmp / page).read_text(encoding='utf-8'))

    def test_sync_stamps_data_scripts_with_content_hash(self):
        self.real_layout()
        self.assertEqual(self.run_sync('--force'), 0)
        for f in ('wolven-data.js', 'zwijnen-data.js'):
            v = sync.data_version(self.tmp / 'data' / f)
            for page in ('index.html', 'wolven.html' if f.startswith('wolven') else 'zwijnen.html'):
                self.assertIn('data/%s?v=%s' % (f, v), self.script_tags(page))
        # andere scripts blijven ongemoeid
        self.assertIn('<script src="assets/site.js">', (self.tmp / 'index.html').read_text(encoding='utf-8'))

    def test_stamp_is_stable_and_follows_content(self):
        cfg = self.cfg
        first = sync.stamp_html(self.tmp, cfg)
        self.assertTrue(first)                                          # eerste keer: er zit nog geen ?v= in
        self.assertEqual(sync.stamp_html(self.tmp, cfg), [])            # tweede keer: niets te doen
        before = self.script_tags('wolven.html')
        (self.tmp / 'data' / 'wolven-data.js').write_text((self.tmp / 'data' / 'wolven-data.js').read_text() + '\n// x', encoding='utf-8')
        self.assertIn('wolven.html', sync.stamp_html(self.tmp, cfg))    # andere inhoud = ander nummer
        self.assertNotEqual(before, self.script_tags('wolven.html'))
        self.assertEqual(len(self.script_tags('index.html')), len(cfg['output']))   # één per databestand, geen dubbele ?v= (?v=..?v=..)
        self.assertTrue(all(t.count('?v=') == 1 for t in self.script_tags('index.html')))

    def test_dry_run_and_export_leave_html_alone(self):
        self.real_layout()
        before = (self.tmp / 'index.html').read_bytes()
        self.run_sync('--force', '--dry-run')
        self.assertEqual((self.tmp / 'index.html').read_bytes(), before)

    def test_stamp_command_needs_no_token(self):
        import os
        os.environ.pop('SEATABLE_API_TOKEN', None)
        self.assertEqual(sync.main(['--config', str(self.cfg_path), '--root', str(self.tmp), '--stamp']), 0)
        self.assertTrue(all('?v=' in t for t in self.script_tags('wolven.html')))


    # ------------------------------------------------------------ geen ruis bij een geplande run zonder nieuwe meldingen
    def test_second_run_without_new_reports_writes_nothing(self):
        self.real_layout()
        self.assertEqual(self.run_sync('--force'), 0)
        first = {f: (self.tmp / 'data' / f).read_bytes() for f in ('wolven-data.js', 'zwijnen-data.js')}
        pages = {f: (self.tmp / f).read_bytes() for f in ('index.html', 'wolven.html', 'zwijnen.html')}
        calls = []
        real = sync.write_data_file
        sync.write_data_file = lambda *a, **k: calls.append(a) or real(*a, **k)
        try:
            self.assertEqual(self.run_sync(), 0)               # zonder --force: ook de beveiliging blijft tevreden
        finally:
            sync.write_data_file = real
        self.assertEqual(calls, [])
        self.assertEqual({f: (self.tmp / 'data' / f).read_bytes() for f in first}, first)
        self.assertEqual({f: (self.tmp / f).read_bytes() for f in pages}, pages)

    def test_new_report_is_written_and_only_that_file(self):
        self.real_layout()
        self.run_sync('--force')
        zw = (self.tmp / 'data' / 'zwijnen-data.js').read_bytes()
        Mock.tables['Zichtmeldingen']['rows'].append({'Dier': 'Wolf', 'Datum': '2026-09-20', 'Locatie': {'lng': 5.7, 'lat': 52.29}, 'Verificatie': True})
        self.assertEqual(self.run_sync(), 0)
        data, wolf = self.places('wolven-data.js')
        self.assertEqual(sum(len(b['ev']) for b in wolf), 5)
        self.assertEqual((self.tmp / 'data' / 'zwijnen-data.js').read_bytes(), zw)   # zwijn veranderde niet


    # ------------------------------------------------------------ moderatie: alleen aangevinkte meldingen op de site
    def test_is_checked(self):
        for yes in (True, 'true', 'True', 1, 'ja'):
            self.assertTrue(sync.is_checked(yes), yes)
        for no in (None, False, 0, '', 'false', 'nee', []):
            self.assertFalse(sync.is_checked(no), no)

    def test_unverified_reports_are_not_published(self):
        self.real_layout()
        rows = Mock.tables['Zichtmeldingen']['rows']
        rows[1]['Verificatie'] = None      # nooit aangevinkt (zo komt een formulier-inzending binnen)
        rows[3]['Verificatie'] = False     # ooit aangevinkt en weer uitgezet
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(self.run_sync('--force'), 0)
        self.assertIn('2 wachten op verificatie', buf.getvalue())
        _, wolf = self.places('wolven-data.js')
        self.assertEqual(sum(len(b['ev']) for b in wolf), 2)     # 3 wolf-rijen in Zichtmeldingen - 2 onverifieerd + 1 aanval
        published = {e['d'] for b in wolf for e in b['ev']}
        self.assertNotIn('2026-09-19', published)                # rows[1]
        self.assertNotIn('2026-09-01', published)                # rows[3]

    def test_unchecking_removes_a_report_again(self):
        self.real_layout()
        self.run_sync('--force')
        Mock.tables['Zichtmeldingen']['rows'][0]['Verificatie'] = False
        self.assertEqual(self.run_sync(), 0)                     # 4 -> 3 meldingen: geen alarm van de beveiliging
        _, wolf = self.places('wolven-data.js')
        self.assertEqual(sum(len(b['ev']) for b in wolf), 3)
        self.assertNotIn('2026-09-18', {e['d'] for b in wolf for e in b['ev'] if e['ty'] == 'zichtmelding'})

    def test_missing_verification_column_stops_instead_of_publishing_everything(self):
        self.real_layout()
        for spec in Mock.tables.values():
            spec['columns'] = [c for c in spec['columns'] if c[0] != 'Verificatie']
        before = (self.tmp / 'data' / 'wolven-data.js').read_bytes()
        self.assertEqual(self.run_sync('--force'), 1)
        self.assertEqual((self.tmp / 'data' / 'wolven-data.js').read_bytes(), before)

    def test_verification_can_be_switched_off(self):
        self.real_layout()
        for spec in Mock.tables.values():
            spec['columns'] = [c for c in spec['columns'] if c[0] != 'Verificatie']
            for row in spec['rows']:
                row.pop('Verificatie', None)
        self.cfg['verification']['required'] = False
        self.cfg_path.write_text(json.dumps(self.cfg), encoding='utf-8')
        self.assertEqual(self.run_sync('--force'), 0)
        _, wolf = self.places('wolven-data.js')
        self.assertEqual(sum(len(b['ev']) for b in wolf), 4)     # zonder kolom en met required=false: alle wolf-meldingen


    # ------------------------------------------------------------ een aanval met meerdere diersoorten (één rij)
    def test_attack_with_several_victim_species_stays_one_report(self):
        loc = {'lng': 5.79, 'lat': 52.40}
        Mock.tables = {
            'Zichtmeldingen': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), ('Verificatie', 'checkbox')], 'rows': []},
            'Aanval': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), ('Gedode dier', 'single-select'),
                                   ('Aantal dood', 'number'), ('Gedode dier 2', 'single-select'), ('Aantal dood 2', 'number'), ('Verificatie', 'checkbox')],
                       'rows': [
                           {'Dier': 'Wolf', 'Datum': '2026-09-14', 'Locatie': loc, 'Gedode dier': 'Pony', 'Aantal dood': 1,
                            'Gedode dier 2': 'Veulen', 'Aantal dood 2': 2, 'Verificatie': True},          # twee soorten in één aanval
                           {'Dier': 'Wolf', 'Datum': '2026-09-10', 'Locatie': loc, 'Gedode dier': 'Pink', 'Aantal dood': 1,
                            'Gedode dier 2': None, 'Aantal dood 2': None, 'Verificatie': True},           # tweede plek leeg
                           {'Dier': 'Wolf', 'Datum': '2026-09-09', 'Locatie': loc, 'Aantal dood 2': 4, 'Verificatie': True},  # alleen een aantal in plek 2
                           {'Dier': 'Wolf', 'Datum': '2026-09-08', 'Locatie': loc, 'Verificatie': True},   # helemaal geen slachtoffers genoemd
                       ]}}
        self.geocoded = []
        sync.pdok_reverse = lambda lat, lon, d: {'name': 'Doornspijk', 'lat': 52.4, 'lon': 5.79}
        self.assertEqual(self.run_sync('--force'), 0)                # let op: geen 'Gedode dier 3'-kolom in deze tabel: wordt overgeslagen
        _, wolf = self.places('wolven-data.js')
        evs = {e['d']: e for b in wolf for e in b['ev']}
        self.assertEqual(len(evs), 4)                                # vier aanvallen = vier meldingen, niet meer
        self.assertEqual(evs['2026-09-14']['dieren'], [{'dier': 'Pony', 'gedood': 1}, {'dier': 'Veulen', 'gedood': 2}])
        self.assertEqual(evs['2026-09-10']['dieren'], [{'dier': 'Pink', 'gedood': 1}])
        self.assertEqual(evs['2026-09-09']['dieren'], [{'gedood': 4}])
        self.assertNotIn('dieren', evs['2026-09-08'])
        self.assertTrue(all(e['ty'] == 'aanval' for e in evs.values()))


    # ------------------------------------------------------------ overige dieren (Hert, Ree, Vos, ...) -> pagina Overig
    def test_other_animals_go_to_the_overig_file_with_their_name(self):
        loc = lambda lat, lng: {'lat': lat, 'lng': lng}
        Mock.tables = {
            'Zichtmeldingen': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), ('Verificatie', 'checkbox')],
                               'rows': [
                                   {'Dier': 'Wolf', 'Datum': '2026-09-01', 'Locatie': loc(52.3, 5.7), 'Verificatie': True},
                                   {'Dier': 'Ree', 'Datum': '2026-09-02T20:36:00+02:00', 'Locatie': loc(52.1, 5.5), 'Verificatie': True},
                                   {'Dier': 'Vos', 'Datum': '2026-09-03', 'Locatie': loc(52.1, 5.5), 'Verificatie': True},
                                   {'Dier': 'Hert', 'Datum': '2026-09-04', 'Locatie': loc(52.9, 6.4), 'Verificatie': False},   # nog niet geverifieerd
                               ]},
            'Aanval': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), ('Verificatie', 'checkbox')], 'rows': []},
        }
        sync.pdok_reverse = lambda lat, lon, d: {'name': 'Teststad', 'lat': lat, 'lon': lon}
        self.assertEqual(self.run_sync('--force'), 0)
        _, wolf = self.places('wolven-data.js')
        self.assertEqual(sum(len(b['ev']) for b in wolf), 1)                # de wolf blijft bij de wolf
        data, other = self.places('overig-data.js')
        evs = sorted((e['d'], e['diersoort'], e['ty']) for b in other for e in b['ev'])
        self.assertEqual(evs, [('2026-09-02', 'Ree', 'zichtmelding'), ('2026-09-03', 'Vos', 'zichtmelding')])   # Hert wacht op verificatie
        self.assertEqual(data['updatedAt'][:4], '2026')
        self.assertNotIn('diersoort', [k for b in wolf for e in b['ev'] for k in e])     # alleen op de Overig-pagina


    # ------------------------------------------------------------ coördinaten uit de kaartpagina (vooraf ingevulde tekstkolommen)
    def test_coord_float(self):
        f = sync.coord_float
        self.assertEqual(f('52.2913'), 52.2913)
        self.assertEqual(f('52,2913'), 52.2913)                # komma als decimaalteken
        self.assertEqual(f(' 5.7189° '), 5.7189)               # graden-teken
        self.assertEqual(f('52.2913 N'), 52.2913)
        self.assertEqual(f('5.7189 E'), 5.7189)
        self.assertEqual(f(5.7189), 5.7189)                    # een getalkolom
        self.assertIsNone(f(''))
        self.assertIsNone(f(None))
        self.assertIsNone(f('ergens bij Ermelo'))

    def test_form_prefilled_lat_lon_columns_are_read_next_to_the_old_location_column(self):
        """De kaartpagina vult de getalkolommen Latitude/Longitude in. Oude rijen met een geolocatie-kolom blijven werken."""
        prefill = re.findall(r"PREFILL = \{ lat:'([^']+)', lon:'([^']+)' \}", (ROOT / 'assets' / 'site.js').read_text(encoding='utf-8'))[0]
        cols = [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), (prefill[0], 'number'), (prefill[1], 'number')]
        Mock.tables = {
            'Zichtmeldingen': {'columns': cols, 'rows': [
                {'Dier': 'Wolf', 'Datum': '2026-09-20', prefill[0]: 52.2913, prefill[1]: 5.7189},                        # nieuw: kaartpagina
                {'Dier': 'Wolf', 'Datum': '2026-09-19', prefill[0]: 52.3010, prefill[1]: 5.7300},                                      # tweede punt
                {'Dier': 'Wolf', 'Datum': '2026-09-18', 'Locatie': {'lat': 52.3100, 'lng': 5.7400}},                          # oud: alleen geolocatie
                {'Dier': 'Wolf', 'Datum': '2026-09-17', prefill[0]: 5.7000, prefill[1]: 52.2000},                                      # omgewisseld
            ]},
            'Aanval': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation')], 'rows': []},
        }
        self.verified()
        sync.pdok_reverse = lambda lat, lon, d: {'name': 'Ermelo', 'lat': 52.288, 'lon': 5.666}
        self.assertEqual(self.run_sync('--force'), 0)
        _, wolf = self.places('wolven-data.js')
        got = sorted((b['lat'], b['lon'], b['ev'][0]['d']) for b in wolf)
        self.assertEqual(got, [(52.2, 5.7, '2026-09-17'), (52.2913, 5.7189, '2026-09-20'), (52.301, 5.73, '2026-09-19'), (52.31, 5.74, '2026-09-18')])

    # ------------------------------------------------------------ omgewisselde coördinaten en mislukte opzoekingen
    def test_fix_coords(self):
        box = [49.0, 55.0, 2.0, 9.0]
        self.assertEqual(sync.fix_coords(52.3, 5.7, box), (52.3, 5.7, 'ok'))
        self.assertEqual(sync.fix_coords(5.66, 52.35, box), (52.35, 5.66, 'swapped'))
        self.assertEqual(sync.fix_coords(5.1279711, 52.1515898, box), (52.1515898, 5.1279711, 'swapped'))
        self.assertEqual(sync.fix_coords(40.4, -3.7, box), (40.4, -3.7, 'outside'))       # Madrid: niet raden, wel melden
        self.assertEqual(sync.fix_coords(None, None, box), (None, None, 'ok'))

    def test_swapped_coordinates_are_corrected_and_reported(self):
        Mock.tables = {
            'Zichtmeldingen': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), ('Verificatie', 'checkbox')],
                               'rows': [{'Dier': 'Wolf', 'Datum': '2026-09-18T16:00:00+02:00', 'Locatie': {'lat': 5.6558578, 'lng': 52.3493864}, 'Verificatie': True},
                                        {'Dier': 'Wolf', 'Datum': '2026-09-17', 'Locatie': {'lat': 52.30, 'lng': 5.70}, 'Verificatie': True}]},
            'Aanval': {'columns': [('Dier', 'single-select'), ('Datum', 'date'), ('Locatie', 'geolocation'), ('Verificatie', 'checkbox')], 'rows': []},
        }
        asked = []
        sync.pdok_reverse = lambda lat, lon, d: asked.append((round(lat, 2), round(lon, 2))) or {'name': 'Zeewolde', 'lat': lat, 'lon': lon}
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(self.run_sync('--force'), 0)
        self.assertIn('omgewisselde coördinaten', buf.getvalue())
        self.assertIn('Tabel "Zichtmeldingen": de melding van 2026-09-18', buf.getvalue())   # de waarschuwing noemt de juiste tabel
        _, wolf = self.places('wolven-data.js')
        self.assertEqual({b['n'] for b in wolf}, {'Zeewolde'})                       # geen "Onbekende locatie"
        self.assertTrue(all(49 < b['lat'] < 55 and 2 < b['lon'] < 9 for b in wolf))  # allebei in Nederland
        self.assertIn((52.35, 5.66), asked)                                          # PDOK kreeg de gecorrigeerde volgorde

    def test_failed_lookups_are_never_remembered(self):
        self.real_layout()
        calls = []
        sync.pdok_reverse = lambda lat, lon, d: calls.append(1) or {'name': None}    # PDOK "vindt niets" (haperende dienst of punt buiten NL)
        self.run_sync('--force')
        cache = self.tmp / 'tools' / 'place-cache.json'
        self.assertFalse(cache.exists() and json.loads(cache.read_text()) != {})     # niets onthouden
        first = len(calls)
        self.run_sync('--force')
        self.assertEqual(len(calls), first * 2)                                     # dus de volgende run vraagt het opnieuw

    def test_stale_negative_cache_entries_are_purged_and_retried(self):
        self.real_layout()
        cache = self.tmp / 'tools' / 'place-cache.json'
        cache.write_text(json.dumps({'52.3015,5.7168': {'name': None}, '52.3100,5.7300': {'name': 'Ermelo', 'lat': 52.288, 'lon': 5.666}}))
        self.geocoded = []
        sync.pdok_reverse = lambda lat, lon, d: self.geocoded.append((round(lat, 4), round(lon, 4))) or {'name': 'Ermelo', 'lat': 52.288, 'lon': 5.666}
        self.assertEqual(self.run_sync('--force'), 0)
        self.assertIn((52.3015, 5.7168), self.geocoded)                              # het oude "niet gevonden" is opnieuw opgevraagd
        self.assertNotIn((52.31, 5.73), self.geocoded)                              # het goede antwoord bleef uit de cache komen
        self.assertTrue(all(v.get('name') for v in json.loads(cache.read_text()).values()))


if __name__ == '__main__':
    unittest.main(verbosity=2)
