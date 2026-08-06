import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCpfCnpj } from '../src/utils/brazilianDocument.js';

test('valida dígitos verificadores de CPF e CNPJ', () => {
  assert.equal(isValidCpfCnpj('529.982.247-25'), true);
  assert.equal(isValidCpfCnpj('04.252.011/0001-10'), true);
  assert.equal(isValidCpfCnpj('529.982.247-24'), false);
  assert.equal(isValidCpfCnpj('11.111.111/1111-11'), false);
});
