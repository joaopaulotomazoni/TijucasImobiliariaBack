import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsoDate } from '../src/utils/isoDate.js';

test('rejeita datas civis inexistentes mesmo com formato ISO', () => {
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('2026-02-30'), false);
});

test('aceita data válida em ano bissexto', () => {
  assert.equal(isValidIsoDate('2028-02-29'), true);
});
