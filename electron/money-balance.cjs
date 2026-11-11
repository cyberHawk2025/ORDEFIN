// Integer-cent account balance; callers convert to reais only at the UI boundary.
const balanceCentsSql = (alias = 'a') => `
  ${alias}.opening_balance_cents
  + COALESCE((SELECT SUM(amount_cents) FROM account_adjustments WHERE account_id=${alias}.id),0)
  + COALESCE((SELECT SUM(CASE WHEN kind='receita' THEN amount_cents ELSE -amount_cents END)
       FROM transactions WHERE account_id=${alias}.id AND (kind='receita' OR paid=1)),0)
  - COALESCE((SELECT SUM(amount_cents) FROM card_payments WHERE account_id=${alias}.id),0)
  + COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE destination_account_id=${alias}.id),0)
  - COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE source_account_id=${alias}.id),0)`
function balanceCents(db, id) {
  const row = db.prepare(`SELECT (${balanceCentsSql()}) AS cents FROM accounts a WHERE a.id=?`).get(id)
  return row ? row.cents : null
}
function centsToReais(cents) {
  if (!Number.isSafeInteger(cents)) throw Error('SALDO_FORA_DO_LIMITE_SEGURO')
  return cents / 100
}
module.exports = { balanceCentsSql, balanceCents, centsToReais }
