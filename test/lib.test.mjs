import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gradeNumber, maskId, parseIdList, pickCert, pickImages, pickOrder, planCertWork, priceFieldForGrade,
} from '../scripts/lib.mjs';

test('gradeNumber reads PSA grade labels', () => {
  assert.equal(gradeNumber('GEM MT 10'), 10);
  assert.equal(gradeNumber('NM-MT+ 8.5'), 8.5);
  assert.equal(gradeNumber('MINT 9 (OC)'), 9);
  assert.equal(gradeNumber('Authentic'), null);
  assert.equal(gradeNumber(null), null);
});

test('price field follows the card grade', () => {
  assert.equal(priceFieldForGrade(10), 'manual-only-price');
  assert.equal(priceFieldForGrade(8.5), 'new-price');
  assert.equal(priceFieldForGrade(6), null);
});

test('parseIdList drops unsafe values and duplicates', () => {
  assert.deepEqual(parseIdList('123, 456\n123 ../evil'), ['123', '456']);
  assert.deepEqual(parseIdList(undefined), []);
});

test('pickOrder never publishes tracking data or the real number', () => {
  const order = pickOrder({
    orderNumber: '99887766', shipped: true, shipTrackingNumber: 'TRACK123', shipCarrier: 'UPS',
    orderProgressSteps: [{ index: 2, step: 'B', completed: false }, { index: 1, step: 'A', completed: true }],
  }, '99887766', 'order');
  const json = JSON.stringify(order);
  assert.ok(!json.includes('TRACK123') && !json.includes('UPS') && !json.includes('99887766'));
  assert.equal(order.id, maskId('99887766'));
  assert.deepEqual(order.steps.map((s) => s.name), ['A', 'B']);
});

test('pickCert keeps whitelisted fields only', () => {
  const card = pickCert({ CertNumber: 1, CardGrade: 'MINT 9', Secret: 'x' });
  assert.equal(card.grade, 9);
  assert.ok(!('Secret' in card));
});

test('pickImages separates sides and rejects non-https urls', () => {
  assert.deepEqual(
    pickImages([{ IsFrontImage: true, ImageURL: 'https://x.test/f.jpg' }, { IsFrontImage: false, ImageURL: 'javascript:alert(1)' }]),
    { front: 'https://x.test/f.jpg', back: null },
  );
  assert.deepEqual(pickImages(null), { front: null, back: null });
});

test('planCertWork prefers new certs and respects the budget', () => {
  const now = Date.parse('2026-11-01');
  const cache = {
    fresh: { fetchedAt: '2026-10-31', images: { front: 'u' } },
    stale: { fetchedAt: '2026-01-01', images: { front: 'u' } },
  };
  const plan = planCertWork(['fresh', 'stale', 'new1', 'new2'], cache, 3, now);
  assert.deepEqual(plan.map((j) => j.cert), ['new1', 'stale']);
});
