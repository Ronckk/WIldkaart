#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Maakt sitemap.xml, met per pagina een <lastmod>: de datum waarop de pagina of haar meldingendata voor het laatst is gewijzigd.

Die datum komt uit de git-geschiedenis (laatste commit die de pagina of een van haar databestanden raakt). De sync met SeaTable
commit `data/*.js` alleen als er iets nieuws is, dus `lastmod` verandert precies als er nieuwe meldingen zijn. Zit er een
niet-gecommitte wijziging in, dan geldt vandaag. Is er geen git-geschiedenis (bv. een ondiepe checkout), dan blijft `lastmod`
weg; liever geen datum dan een verkeerde.

  python3 tools/build_sitemap.py                    # schrijf sitemap.xml in de map van de site
  python3 tools/build_sitemap.py --out _site/sitemap.xml
  python3 tools/build_sitemap.py --print            # alleen tonen

De publicatie-workflow (.github/workflows/site.yml) draait dit bij elke publicatie, met de volledige geschiedenis.
Een nieuwe pagina voeg je hieronder toe aan PAGES (en aan `INDEXABLE` in tools/test_site_seo.py).
"""
import argparse
import datetime
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://wildkaart.rlode.nl/'

# (pad, pagina, databestanden waar de pagina van afhangt)
PAGES = [
    ('',        'index.html',   ['data/wolven-data.js', 'data/zwijnen-data.js', 'data/overig-data.js']),
    ('wolven',  'wolven.html',  ['data/wolven-data.js']),
    ('zwijnen', 'zwijnen.html', ['data/zwijnen-data.js']),
    ('overig',  'overig.html',  ['data/overig-data.js']),
    ('over',    'over.html',    []),
    ('melden',  'melden.html',  []),
]


def _git(*args):
    try:
        r = subprocess.run(['git', '-C', str(ROOT)] + list(args), capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def lastmod(files):
    """YYYY-MM-DD van de laatste wijziging aan één van deze bestanden, of None als dat niet te bepalen is."""
    if _git('rev-parse', '--is-shallow-repository') != 'false':
        return None    # ondiepe checkout: elk bestand lijkt dan in de laatste commit te zijn gewijzigd
    dirty = _git('status', '--porcelain', '--', *files)
    if dirty:
        return datetime.date.today().isoformat()
    day = _git('log', '-1', '--format=%cs', '--', *files)
    return day or None


def build():
    urls = []
    for path, page, data in PAGES:
        urls.append((BASE + path, lastmod([page] + data)))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, day in urls:
        lines.append('  <url><loc>%s</loc>%s</url>' % (loc, '<lastmod>%s</lastmod>' % day if day else ''))
    lines.append('</urlset>')
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', default=str(ROOT / 'sitemap.xml'), help='waar sitemap.xml naartoe geschreven wordt')
    ap.add_argument('--print', action='store_true', help='alleen tonen, niets schrijven')
    args = ap.parse_args()
    xml = build()
    if args.print:
        print(xml, end='')
        return
    Path(args.out).write_text(xml, encoding='utf-8')
    print('sitemap geschreven:', args.out)


if __name__ == '__main__':
    main()
