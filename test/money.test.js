import test from 'node:test';
import assert from 'node:assert/strict';
import {
  percentageOfMoney,
  roundMoney,
  sumMoney,
  toCents,
} from '../src/utils/money.js';

test('arredonda decimais monetários sem erro binário', () => {
  assert.equal(roundMoney('1.005'), 1.01);
  assert.equal(roundMoney('-1.005'), -1.01);
  assert.equal(toCents('100.75'), 10075n);
});

test('calcula percentual e soma em centavos exatos', () => {
  assert.equal(percentageOfMoney('100.75', '10.00'), 10.08);
  assert.equal(sumMoney(['0.10', '0.20', '100.75']), 101.05);
});
