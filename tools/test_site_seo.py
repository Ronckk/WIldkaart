#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SEO-controle van de statische pagina's: unieke titels en beschrijvingen, canonical en Open Graph kloppen, structured data
is geldig JSON, sitemap en robots.txt zijn compleet, interne links en ankers bestaan, en de workflow publiceert alle bestanden.

Draai:  python3 tools/test_site_seo.py
"""
import datetime
import json
import re
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://wildkaart.rlode.nl/'
INDEXABLE = {'index.html': '', 'wolven.html': 'wolven', 'zwijnen.html': 'zwijnen', 'overig.html': 'overig', 'over.html': 'over', 'melden.html': 'melden'}


def read(name):
    return (ROOT / name).read_text(encoding='utf-8')


def meta(s, attr, key):
    m = re.search(r'<meta %s="%s" content="([^"]*)"' % (attr, re.escape(key)), s)
    return m.group(1) if m else None


class SeoTest(unittest.TestCase):
    def test_each_indexable_page_has_complete_metadata(self):
        for page, path in INDEXABLE.items():
            s = read(page)
            with self.subTest(page=page):
                self.assertIn('<html lang="nl">', s)
                title = re.search(r'<title>([^<]*)</title>', s).group(1)
                self.assertTrue(15 <= len(title) <= 65, 'titel %d tekens: %s' % (len(title), title))
                desc = meta(s, 'name', 'description')
                self.assertTrue(70 <= len(desc) <= 165, 'beschrijving %d tekens' % len(desc))
                self.assertIn('index', meta(s, 'name', 'robots'))
                self.assertEqual(re.search(r'<link rel="canonical" href="([^"]*)"', s).group(1), BASE + path)
                self.assertEqual(meta(s, 'property', 'og:url'), BASE + path)
                self.assertEqual(meta(s, 'property', 'og:title'), title.replace('&', '&amp;') if '&' in title else title)
                self.assertEqual(meta(s, 'property', 'og:description'), desc)
                self.assertEqual(meta(s, 'name', 'twitter:description'), desc)
                self.assertTrue(meta(s, 'property', 'og:image').startswith('https://'))
                self.assertEqual(len(re.findall(r'<h1[ >]', s)), 1, 'precies één <h1>')
                for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
                    self.assertEqual(json.loads(block)['@context'], 'https://schema.org')

    def test_titles_and_descriptions_are_unique(self):
        titles = [re.search(r'<title>([^<]*)</title>', read(p)).group(1) for p in INDEXABLE]
        descs = [meta(read(p), 'name', 'description') for p in INDEXABLE]
        self.assertEqual(len(set(titles)), len(titles))
        self.assertEqual(len(set(descs)), len(descs))

    def test_404_is_not_indexed(self):
        s = read('404.html')
        self.assertIn('noindex', meta(s, 'name', 'robots'))
        self.assertNotIn('rel="canonical"', s)

    def test_sitemap_lists_exactly_the_indexable_pages(self):
        ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
        urls = {u.text for u in ET.parse(ROOT / 'sitemap.xml').getroot().findall('s:url/s:loc', ns)}
        self.assertEqual(urls, {BASE + p for p in INDEXABLE.values()})

    def test_sitemap_lastmod_is_a_valid_date_when_present(self):
        ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
        for u in ET.parse(ROOT / 'sitemap.xml').getroot().findall('s:url', ns):
            day = u.findtext('s:lastmod', default=None, namespaces=ns)
            if day is not None:
                with self.subTest(url=u.findtext('s:loc', namespaces=ns)):
                    self.assertRegex(day, r'^\d{4}-\d{2}-\d{2}$')
                    datetime.date.fromisoformat(day)

    def test_build_sitemap_covers_exactly_the_indexable_pages(self):
        sys.path.insert(0, str(ROOT / 'tools'))
        try:
            import build_sitemap
        finally:
            sys.path.pop(0)
        self.assertEqual({(path, page) for path, page, _ in build_sitemap.PAGES}, {(path, page) for page, path in INDEXABLE.items()})
        for _, page, data in build_sitemap.PAGES:
            for f in [page] + data:
                self.assertTrue((ROOT / f).exists(), f)
        urls = set(re.findall(r'<loc>([^<]+)</loc>', build_sitemap.build()))
        self.assertEqual(urls, {BASE + p for p in INDEXABLE.values()})

    def test_robots_points_to_the_sitemap_and_blocks_nothing(self):
        r = read('robots.txt')
        self.assertIn('Sitemap: ' + BASE + 'sitemap.xml', r)
        self.assertNotRegex(r, r'(?m)^Disallow:\s*/\s*$')

    def test_internal_links_and_anchors_exist(self):
        pages = {'', 'wolven', 'zwijnen', 'overig', 'over', 'melden'}
        over_ids = set(re.findall(r'id="([^"]+)"', read('over.html')))
        scripts = sorted(str(f.relative_to(ROOT)) for f in (ROOT / 'assets').glob('*.js'))
        for name in list(INDEXABLE) + ['404.html'] + scripts:
            text = read(name)
            for href in re.findall(r'href="((?:\./|wolven|zwijnen|overig|over|melden)[^"]*)"', text.replace('\\"', '"')):
                path, _, frag = href.partition('#')
                path = path.partition('?')[0]     # 'melden?type=aanval' is de pagina 'melden'
                with self.subTest(page=name, href=href):
                    self.assertIn(path.replace('./', ''), pages)
                    if path == 'over' and frag:
                        self.assertIn(frag, over_ids)

    def test_workflow_publishes_every_file_the_site_needs(self):
        wf = read('.github/workflows/site.yml')
        for f in list(INDEXABLE) + ['404.html', 'robots.txt', 'sitemap.xml']:
            self.assertIn(f, wf, f + ' ontbreekt in de publicatie-stap van site.yml')
        self.assertIn('tools/build_sitemap.py', wf, 'de publicatie moet sitemap.xml met <lastmod> maken')
        self.assertIn('fetch-depth: 0', wf, '<lastmod> komt uit de git-geschiedenis, dus de publicatie heeft de volledige geschiedenis nodig')
        for f in list(INDEXABLE) + ['404.html', 'robots.txt', 'sitemap.xml', 'assets/og-image.png']:
            self.assertTrue((ROOT / f).exists(), f)

    def test_report_buttons_lead_to_the_map_page_and_use_columns_the_sync_reads(self):
        js = read('assets/site.js')
        forms = dict(re.findall(r"(zichtmelding|aanval):\s*\{[^}]*?url:'([^']+)'", js))
        self.assertEqual(set(forms), {'zichtmelding', 'aanval'})
        for key in forms:
            self.assertIn("page:'melden?type=%s'" % key, js)
        # zonder JavaScript staan de directe formulierlinks in de <noscript> van de meldpagina: die horen bij dezelfde formulieren
        noscript = re.search(r'<noscript>(.*?)</noscript>', read('melden.html'), re.S).group(1)
        self.assertEqual(set(re.findall(r'href="(https://cloud\.seatable\.io/dtable/forms/[^"]+)"', noscript)), set(forms.values()))
        # de kolommen die de kaartpagina invult moeten dezelfde zijn als die de sync leest
        lat, lon = re.search(r"PREFILL = \{ lat:'([^']+)', lon:'([^']+)' \}", js).groups()
        cols = json.loads(read('tools/seatable.config.json'))['columns']
        self.assertIn(lat.lower(), [c.lower() for c in cols['lat']])
        self.assertIn(lon.lower(), [c.lower() for c in cols['lon']])

    def test_menu_and_footer_match_the_shared_template(self):
        import subprocess, sys
        r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_shell.py'), '--check'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_every_page_links_the_shell_stylesheet_and_has_both_blocks(self):
        for page in list(INDEXABLE) + ['404.html']:
            s = read(page)
            with self.subTest(page=page):
                self.assertIn('href="assets/shell.css"', s)
                for marker in ('shell:nav', 'shell:footer'):
                    self.assertEqual(s.count('<!-- %s -->' % marker), 1)
                    self.assertEqual(s.count('<!-- /%s -->' % marker), 1)

    def test_footer_report_links_match_the_forms_in_site_js(self):
        js = read('assets/site.js')
        footer = read('index.html')
        for key in ('zichtmelding', 'aanval'):
            page = re.search(r"%s:\s*\{[^}]*page:'([^']+)'" % key, js).group(1)
            self.assertIn('href="%s"' % page, footer)


    def test_pages_load_fonts_and_leaflet_from_the_site_itself(self):
        """Privacy en snelheid: geen verbinding met Google Fonts of unpkg; alleen de kaarttegels komen van een externe dienst."""
        for page in list(INDEXABLE) + ['404.html']:
            s = read(page)
            with self.subTest(page=page):
                for host in ('fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'):
                    self.assertNotIn(host, s)
                self.assertIn('href="assets/fonts/fonts.css"', s)
        fonts = read('assets/fonts/fonts.css')
        for f in re.findall(r'url\(([^)]+\.woff2)\)', fonts):
            self.assertTrue((ROOT / 'assets' / 'fonts' / f).exists(), f)
        self.assertNotIn('http', re.sub(r'/\*.*?\*/', '', fonts, flags=re.S))
        for page in ('index.html', 'wolven.html', 'zwijnen.html', 'overig.html'):
            s = read(page)
            self.assertIn('src="assets/vendor/leaflet/leaflet.js"', s, page)
            self.assertIn('href="assets/vendor/leaflet/leaflet.css"', s, page)
        for f in ('leaflet.js', 'leaflet.css', 'LICENSE', 'images/layers.png', 'images/marker-icon.png'):
            self.assertTrue((ROOT / 'assets' / 'vendor' / 'leaflet' / f).exists(), f)

    def test_every_local_asset_a_page_references_exists(self):
        for page in list(INDEXABLE) + ['404.html']:
            s = read(page)
            for ref in re.findall(r'(?:src|href)="(assets/[^"?#]+)', s):
                with self.subTest(page=page, ref=ref):
                    self.assertTrue((ROOT / ref).exists(), ref)
        for css in (ROOT / 'assets').glob('*.css'):
            for ref in re.findall(r'url\(["\']?(?!data:|https?:|#)([^)"\']+)', css.read_text(encoding='utf-8')):
                with self.subTest(css=css.name, ref=ref):
                    self.assertTrue((css.parent / ref).exists(), ref)

    def test_pages_keep_css_and_scripts_in_assets(self):
        """De opmaak en de scripts staan in assets/ (gedeeld en gecachet); in de pagina blijft alleen kleine inline-code."""
        for page in list(INDEXABLE) + ['404.html']:
            s = read(page)
            with self.subTest(page=page):
                self.assertNotIn('<style', s, 'zet CSS in een bestand in assets/')
                for body in re.findall(r'<script>(.*?)</script>', s, re.S):
                    self.assertLess(len(body), 600, 'inline script te groot; zet het in assets/')


if __name__ == '__main__':
    unittest.main(verbosity=2)
