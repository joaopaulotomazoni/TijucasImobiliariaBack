import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePositiveBigintId } from '../src/utils/ids.js';

test('normaliza ID e respeita o limite do bigint do PostgreSQL', () => {
  assert.equal(normalizePositiveBigintId('01', 'ID'), '1');
  assert.equal(
    normalizePositiveBigintId('9223372036854775807', 'ID'),
    '9223372036854775807'
  );
  assert.throws(
    () => normalizePositiveBigintId('9223372036854775808', 'ID'),
    /inteiro positivo/
  );
});
