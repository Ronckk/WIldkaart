#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Draait tools/test_risk_model.js (Node) als onderdeel van de Python-tests.  Draai:  python3 tools/test_risk_model.py"""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class RiskModelTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is niet geïnstalleerd')
    def test_risk_model_js(self):
        r = subprocess.run(['node', str(ROOT / 'tools' / 'test_risk_model.js')], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == '__main__':
    unittest.main()
