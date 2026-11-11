'use strict'
// Converte valores decimais em centavos sem multiplicação de ponto flutuante.
// Aceita números finitos e strings decimais; rejeita frações de centavo.
function toCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError('VALOR_MONETARIO_INVALIDO')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('VALOR_MONETARIO_INVALIDO')
  const s = String(value).trim()
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!match) throw new TypeError('VALOR_MONETARIO_INVALIDO')
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'))
  const signed = match[1] === '-' ? -cents : cents
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('VALOR_MONETARIO_FORA_DO_LIMITE')
  return Number(signed)
}
function fromCents(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('CENTAVOS_INVALIDOS')
  return value / 100
}
function isMoney(value) {
  try { toCents(value); return true } catch { return false }
}
module.exports = { toCents, fromCents, isMoney }
