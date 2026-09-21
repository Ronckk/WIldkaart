#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Menubalk en voettekst: één sjabloon voor alle pagina's.

Elke pagina heeft twee blokken tussen markeringen:
    <!-- shell:nav --> ... <!-- /shell:nav -->
    <!-- shell:footer --> ... <!-- /shell:footer -->
Dit script schrijft daar de menubalk en voettekst in (met de juiste actieve pagina en de eigen voetnoten van die pagina).
Pas je iets aan in het sjabloon hieronder, draai dan dit script; niet met de hand in de pagina's wijzigen.

  python3 tools/build_shell.py            # schrijf alle pagina's bij
  python3 tools/build_shell.py --check    # alleen controleren (exit 1 als een pagina achterloopt); draait ook in de tests
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PLACE_NOTE = ('De plaatsnaam wordt automatisch bepaald op basis van de locatie die de melder heeft aangegeven; de stip staat op die '
              'aangegeven plek. Meerdere meldingen op precies dezelfde plek vormen samen één bolletje ter grootte van het aantal; '
              'klik erop voor de volledige lijst.')

# pagina -> welk menu-item actief is, en de eigen voetnoten van die pagina (ruwe HTML)
PAGES = {
    'index.html':   {'active': 'home',    'notes': []},
    'wolven.html':  {'active': 'wolven',  'notes': ['<div>Klopt er iets niet? Laat het ons weten via <a href="over#contact">Over deze site</a>.</div>']},
    'zwijnen.html': {'active': 'zwijnen', 'notes': ['<div>%s</div>' % PLACE_NOTE]},
    'overig.html':  {'active': 'overig',  'notes': ['<div>%s</div>' % PLACE_NOTE]},
    'over.html':    {'active': None,      'notes': []},
    '404.html':     {'active': None,      'notes': []},
    'melden.html':  {'active': None,      'notes': []},
}

MENU = [('home', 'Home', './'), ('wolven', 'Wolven', 'wolven'), ('zwijnen', 'Zwijnen', 'zwijnen')]


def nav_html(active):
    def item(key, label, href):
        if active == key:
            return '<button type="button" class="nav-link active" aria-current="page">%s</button>' % label
        return '<a href="%s" class="nav-link">%s</a>' % (href, label)
    links = [item(*m) for m in MENU]
    links.append('<button type="button" class="nav-link is-soon" disabled title="Binnenkort beschikbaar &mdash; we verzamelen nog data">Herten <span class="soon-tag">binnenkort</span></button>')
    links.append(item('overig', 'Overig', 'overig'))
    return '''<header class="site-header"><div class="site-header-inner">
  <nav class="navbar" aria-label="Hoofdmenu">
    <div class="nav-links">
      %s
    </div>
    <button type="button" class="theme-toggle" id="themeToggle" aria-label="Wissel tussen licht en donker">
      <span class="icon-sun">&#9728;&#65039;</span><span class="icon-moon">&#127769;</span>
    </button>
  </nav>
</div></header>''' % '\n      '.join(links)


def footer_html(notes):
    ext = 'target="_blank" rel="noopener noreferrer"'
    notes_html = ''
    if notes:
        notes_html = '\n    <div class="footer-notes">\n      %s\n    </div>' % '\n      '.join(notes)
    return '''<footer class="site-footer"><div class="site-footer-inner">
    <div class="footer-cols">
      <div class="footer-col footer-brand">
        <p class="fb-name">Wilde Dieren in Kaart</p>
        <p>Gecontroleerde meldingen van wolven, zwijnen en andere wilde dieren in Nederland.</p>
      </div>
      <nav class="footer-col" aria-label="Kaarten">
        <h2>Kaarten</h2>
        <ul>
          <li><a href="./">Home</a></li>
          <li><a href="wolven">Wolven</a></li>
          <li><a href="zwijnen">Zwijnen</a></li>
          <li><a href="overig">Overig</a></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="Melden">
        <h2>Melden</h2>
        <ul>
          <li><a href="melden?type=zichtmelding">Meld een zichtmelding</a></li>
          <li><a href="melden?type=aanval">Meld een aanval op vee</a></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="Over de site">
        <h2>Over de site</h2>
        <ul>
          <li><a href="over">Over deze site</a></li>
          <li><a href="over#controle">Hoe controleren we meldingen?</a></li>
          <li><a href="over#bronnen">Waar komen de gegevens vandaan?</a></li>
          <li><a href="over#privacy">Privacy</a></li>
          <li><a href="over#contact">Contact</a></li>
        </ul>
      </nav>
    </div>%(notes)s
    <div class="footer-bottom">
      <div>&copy; 2026 Wilde Dieren in Kaart &middot; Gebouwd door <a href="https://rlode.nl/" %(ext)s>rlode.nl</a></div>
      <div>Kaart: <a href="https://www.openstreetmap.org/copyright" %(ext)s>OpenStreetMap</a>-bijdragers, <a href="https://carto.com/attributions" %(ext)s>CARTO</a> &middot; Plaatsnamen: <a href="https://www.pdok.nl/" %(ext)s>PDOK</a></div>
    </div>
  </div></footer>''' % {'ext': ext, 'notes': notes_html}


def block(name, inner):
    return '<!-- shell:%s -->\n%s\n<!-- /shell:%s -->' % (name, inner, name)


def render(page, cfg):
    s = (ROOT / page).read_text(encoding='utf-8')
    for name, inner in (('nav', nav_html(cfg['active'])), ('footer', footer_html(cfg['notes']))):
        pat = re.compile(r'<!-- shell:%s -->.*?<!-- /shell:%s -->' % (name, name), re.S)
        if not pat.search(s):
            raise SystemExit('%s: markering <!-- shell:%s --> ontbreekt' % (page, name))
        s = pat.sub(lambda m: block(name, inner), s, count=1)
    return s


def main(argv):
    check = '--check' in argv
    stale = []
    for page, cfg in PAGES.items():
        new = render(page, cfg)
        old = (ROOT / page).read_text(encoding='utf-8')
        if new != old:
            stale.append(page)
            if not check:
                (ROOT / page).write_text(new, encoding='utf-8')
    if check:
        if stale:
            print('Loopt achter op het sjabloon: %s. Draai: python3 tools/build_shell.py' % ', '.join(stale))
            return 1
        print('Menubalk en voettekst zijn overal gelijk aan het sjabloon.')
        return 0
    print('Bijgewerkt: %s' % (', '.join(stale) if stale else 'niets (alles was al gelijk)'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
