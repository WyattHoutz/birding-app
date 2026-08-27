'use strict';
/*
 * F143 — QR field sharing.
 *
 * The encoder itself is verified by assets/verify-qr.py, which renders every
 * matrix and asks an independent decoder to read it back. These tests guard
 * the wiring around it: only the three eBird resource identifiers may become
 * QR controls, and every shared card family has a slot that preserves that
 * control.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const WWW = path.join(__dirname, '..', 'www');
const QR = require(path.join(WWW, 'qr.js'));
const SpeciesCards = require(path.join(WWW, 'cards-species.js'));
const HotspotCards = require(path.join(WWW, 'cards-hotspot.js'));
const ChecklistCards = require(path.join(WWW, 'cards-checklist.js'));

test('QR controls accept only typed eBird resource identifiers', () => {
  const cases = [
    ['species', 'baleag', 'eBird species page'],
    ['hotspot', 'L128530', 'eBird hotspot page'],
    ['checklist', 'S123456789', 'eBird checklist page'],
  ];
  for (const [kind, id, label] of cases) {
    const html = QR.control(kind, id);
    assert.match(html, new RegExp('data-qr-kind="' + kind + '"'));
    assert.match(html, new RegExp('data-qr-id="' + id + '"'));
    assert.match(html, new RegExp('aria-label="Show QR code for ' + label + '"'));
    assert.match(html, /<button\b/, 'the icon is a real keyboard control');
    assert.match(html, /<svg\b/, 'the visible label is a QR-shaped SVG');
  }

  // A QR path that accepts arbitrary URLs could turn any card into a home or
  // sensitive-location broadcaster. The app maps this typed input to the
  // already-existing eBird page; no arbitrary payload gets past the card.
  for (const bad of [
    ['species', 'bald eagle'],
    ['species', 'baleag<script>'],
    ['hotspot', 'https://example.invalid'],
    ['hotspot', 'L12" onclick="x'],
    ['checklist', 'S12?location=home'],
    ['unknown', 'S123456'],
  ]) {
    assert.equal(QR.control(...bad), '', JSON.stringify(bad) + ' must be refused');
  }
});

test('all requested card families preserve a QR control', () => {
  const species = QR.control('species', 'baleag');
  const hotspot = QR.control('hotspot', 'L128530');
  const checklist = QR.control('checklist', 'S123456789');

  assert.match(SpeciesCards.medium({
    name: 'Bald Eagle', actions: species,
  }), /data-qr-kind="species"/,
  'a species card has an actions slot for its species-page QR');

  assert.match(HotspotCards.medium({
    num: 1, name: 'Marymoor', qr: hotspot,
  }), /data-qr-kind="hotspot"/,
  'a hotspot card creates an action row for its hotspot-page QR');

  assert.match(ChecklistCards.small({
    place: 'Marymoor', href: 'https://ebird.org/checklist/S123456789',
    qr: checklist,
  }), /data-qr-kind="checklist"/,
  'a checklist row keeps its checklist-page QR beside its row actions');
});
