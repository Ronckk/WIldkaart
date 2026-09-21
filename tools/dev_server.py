#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Lokale testserver die zich net zo gedraagt als GitHub Pages: /wolven geeft wolven.html.

  python3 tools/dev_server.py          # http://localhost:8000
  python3 tools/dev_server.py 9000     # andere poort

(De gewone `python3 -m http.server` kent geen "nette" adressen zonder .html en geeft dan een 404.)
"""
import http.server
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # nooit uit de cache: na een wijziging in een script of stijlblad toont een gewone verversing meteen de nieuwe versie
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def translate_path(self, path):
        p = super().translate_path(path)
        if not os.path.exists(p) and os.path.exists(p + '.html'):
            return p + '.html'
        return p


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print('Site op http://localhost:%d  (stoppen: Ctrl+C)' % port)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
