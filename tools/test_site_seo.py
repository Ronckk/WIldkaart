#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SEO-controle van de statische pagina's: unieke titels en beschrijvingen, canonical en Open Graph kloppen, structured data
is geldig JSON, sitemap en robots.txt zijn compleet, interne links en ankers bestaan, en de workflow publiceert alle bestanden.

Draai:  python3 tools/test_site_seo.py
"""
import json
import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://wildkaart.rlode.nl/'
INDEXABLE = {'index.html': '', 'wolven.html': 'wolven', 'zwijnen.html': 'zwijnen', 'overig.html': 'overig', 'over.html': 'over'}


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

    def test_robots_points_to_the_sitemap_and_blocks_nothing(self):
        r = read('robots.txt')
        self.assertIn('Sitemap: ' + BASE + 'sitemap.xml', r)
        self.assertNotRegex(r, r'(?m)^Disallow:\s*/\s*$')

    def test_internal_links_and_anchors_exist(self):
        pages = {'', 'wolven', 'zwijnen', 'overig', 'over'}
        over_ids = set(re.findall(r'id="([^"]+)"', read('over.html')))
        for name in list(INDEXABLE) + ['404.html', 'assets/site.js']:
            text = read(name)
            for href in re.findall(r'href="((?:\./|wolven|zwijnen|overig|over)[^"]*)"', text.replace('\\"', '"')):
                path, _, frag = href.partition('#')
                with self.subTest(page=name, href=href):
                    self.assertIn(path.replace('./', ''), pages)
                    if path == 'over' and frag:
                        self.assertIn(frag, over_ids)

    def test_workflow_publishes_every_file_the_site_needs(self):
        wf = read('.github/workflows/site.yml')
        for f in list(INDEXABLE) + ['404.html', 'robots.txt', 'sitemap.xml']:
            self.assertIn(f, wf, f + ' ontbreekt in de publicatie-stap van site.yml')
        for f in list(INDEXABLE) + ['404.html', 'robots.txt', 'sitemap.xml', 'assets/og-image.png']:
            self.assertTrue((ROOT / f).exists(), f)


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

    def test_footer_form_links_match_the_forms_in_site_js(self):
        js = read('assets/site.js')
        footer = read('index.html')
        for key in ('zichtmelding', 'aanval'):
            url = re.search(r"%s:\s*\{[^}]*url:'([^']+)'" % key, js).group(1)
            self.assertIn('href="%s"' % url, footer)


if __name__ == '__main__':
    unittest.main(verbosity=2)
