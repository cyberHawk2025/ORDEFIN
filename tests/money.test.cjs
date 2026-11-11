const { test } = require('node:test')
const assert = require('node:assert/strict')
const { toCents, fromCents, isMoney } = require('../electron/money.cjs')
test('conversão exata de centavos', () => {
  assert.equal(toCents('0.01'), 1)
  assert.equal(toCents('1234.56'), 123456)
  assert.equal(toCents('-0.01'), -1)
  assert.equal(toCents(0.29), 29)
  assert.equal(fromCents(123456), 1234.56)
})
test('rejeita frações, entradas inválidas e estouro', () => {
  for (const v of ['1.001', '1e3', '1,20', '', Infinity, NaN, {}, '999999999999999999999']) {
    assert.equal(isMoney(v), false)
    assert.throws(() => toCents(v))
  }
})
