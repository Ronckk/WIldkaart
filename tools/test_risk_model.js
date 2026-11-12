#!/usr/bin/env node
// Test van het risicomodel (assets/risk-model.js): gewichten, afname in de tijd, uitstraling, zones en terugtoets.
// Draai:  node tools/test_risk_model.js
'use strict';
const assert = require('assert');
const path = require('path');
const risk = require(path.join(__dirname, '..', 'assets', 'risk-model.js'));
const P = risk.PARAMS;

function iso(day){ return new Date(day * 86400000).toISOString().slice(0, 10); }
const T = risk.dayNumber('2026-11-12');
function ev(daysAgo, ty, lat, lon){ return { d: iso(T - daysAgo), ty: ty || 'zichtmelding', lat: lat == null ? 52.25 : lat, lon: lon == null ? 5.7 : lon, place: 'Test' }; }
function many(n, f){ const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const tests = [];
function test(name, fn){ tests.push([name, fn]); }

test('de aandelen van alle vakken zijn samen 100%', () => {
  const m = risk.modelAt(many(30, i => ev(i % 20)), T + 1);
  assert.ok(Math.abs(m.cells.reduce((s, c) => s + c.share, 0) - 1) < 1e-9);
});

test('te weinig meldingen: model.ok is onwaar', () => {
  assert.strictEqual(risk.modelAt(many(P.minEvents - 1, i => ev(i)), T + 1).ok, false);
  assert.strictEqual(risk.modelAt(many(P.minEvents, i => ev(i)), T + 1).ok, true);
});

test('het hoogste vak ligt bij de meldingen, en de kern is het kleinste gebied', () => {
  const m = risk.modelAt(many(30, i => ev(i % 10)), T + 1);
  const top = m.cells[0], c = risk.cellOf(52.25, 5.7);
  assert.ok(Math.abs(top.i - c.i) <= 1 && Math.abs(top.j - c.j) <= 1);
  assert.strictEqual(top.zone, 0);
  assert.ok(m.zones[0].cells < m.zones[1].cells && m.zones[1].cells < m.zones[2].cells);
});

test('een aanval weegt zwaarder dan een zichtmelding, en nieuw zwaarder dan oud', () => {
  const base = many(25, i => ev(5, 'zichtmelding', 52.0, 5.0));      // filler elders
  const a = risk.modelAt(base.concat([ev(3, 'aanval', 52.6, 6.2), ev(3, 'zichtmelding', 52.3, 4.4)]), T + 1);
  const at = (lat, lon) => { const c = risk.cellOf(lat, lon); return a.byKey[c.i + ',' + c.j].score; };
  assert.ok(at(52.6, 6.2) > at(52.3, 4.4) * 1.9);
  const b = risk.modelAt(base.concat([ev(1, 'zichtmelding', 52.6, 6.2), ev(60, 'zichtmelding', 52.3, 4.4)]), T + 1);
  const bt = (lat, lon) => { const c = risk.cellOf(lat, lon); return b.byKey[c.i + ',' + c.j].score; };
  assert.ok(bt(52.6, 6.2) > bt(52.3, 4.4) * 3);
});

test('de helft van het gewicht verdwijnt na de halfwaardetijd', () => {
  const one = risk.modelAt([ev(0)].concat(many(P.minEvents, () => ev(P.maxAgeDays + 10))), T + 1).cells[0].score;
  const old = risk.modelAt([ev(P.halfLifeDays)].concat(many(P.minEvents, () => ev(P.maxAgeDays + 10))), T + 1).cells[0].score;
  assert.ok(Math.abs(old / one - 0.5) < 0.01);
});

test('meldingen ouder dan maxAgeDays, in de toekomst, of zonder plek tellen niet', () => {
  const m = risk.modelAt([ev(P.maxAgeDays + 1), ev(-3), { d: iso(T - 2), ty: 'aanval', lat: null, lon: null }, { ty: 'aanval', lat: 52, lon: 5 }], T + 1);
  assert.strictEqual(m.used, 0);
  assert.strictEqual(m.cells.length, 0);
});

test('de uitstraling is een paar kilometer, niet tientallen', () => {
  const m = risk.modelAt(many(25, () => ev(1)), T + 1);
  const far = risk.cellOf(52.25 + 40 / 111.2, 5.7);
  assert.strictEqual(m.byKey[far.i + ',' + far.j], undefined);
});

test('de terugtoets gebruikt alleen meldingen van vóór de week die hij toetst', () => {
  // twee gebieden: A actief in de eerste helft, B pas vanaf de laatste week; B mag dus niet als "voorspeld" tellen
  const evs = [];
  for (let d = 70; d > 12; d--) evs.push(ev(d, 'zichtmelding', 52.0, 5.0));
  for (let d = 12; d > 0; d--) evs.push(ev(d, 'zichtmelding', 53.0, 6.5));
  const bt = risk.backtest(evs, new Date(2026, 10, 12), P);
  assert.ok(bt.ok);
  const last = bt.weeks[bt.weeks.length - 1];
  assert.ok(last.hits[2] < last.events, 'de nieuwe plek had niet voorspeld kunnen worden');
  const first = bt.weeks[0];
  assert.strictEqual(first.hits[2], first.events, 'de bekende plek wel');
});

test('de terugtoets heeft eerlijke getallen: treffers <= meldingen, aandeel land tussen 0 en 1', () => {
  const evs = many(60, i => ev(i, i % 5 === 0 ? 'aanval' : 'zichtmelding', 52.2 + (i % 3) * 0.1, 5.6));
  const bt = risk.backtest(evs, new Date(2026, 10, 12));
  bt.zones.forEach(z => { assert.ok(z.hits <= bt.total); assert.ok(z.landShare > 0 && z.landShare < 1); });
  assert.ok(bt.zones[0].hits <= bt.zones[1].hits && bt.zones[1].hits <= bt.zones[2].hits);
});

let failed = 0;
tests.forEach(([name, fn]) => {
  try { fn(); console.log('ok   - ' + name); } catch (e) { failed++; console.log('FAIL - ' + name + '\n       ' + e.message); }
});
console.log(failed ? failed + ' van ' + tests.length + ' mislukt' : tests.length + ' tests ok');
process.exit(failed ? 1 : 0);
