'use strict';
const { toCents } = require('./money.cjs');
const { balanceCents } = require('./money-balance.cjs');

function assertAccountFunds(db, accountId, chargeCents, creditCents = 0) {
  if (accountId == null) return;
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !Number.isSafeInteger(chargeCents) || !Number.isSafeInteger(creditCents)) throw Error('CONTA_INVALIDA');
  const balance = balanceCents(db, accountId);
  if (balance === null) throw Error('CONTA_INEXISTENTE');
  if (balance + creditCents < chargeCents) throw Error('SALDO_INSUFICIENTE');
}
function transactionDebitCents(t) {
  return t && t.kind !== 'receita' && t.card_id == null && t.account_id != null && Number(t.paid) === 1 ? toCents(t.amount) : 0;
}
function assertTransactionFunds(db, next, previous = null) {
  const previousAccount = previous?.account_id;
  const previousDebit = transactionDebitCents(previous);
  const nextDebit = transactionDebitCents(next);
  if (nextDebit) assertAccountFunds(db, next.account_id, nextDebit, next.account_id === previousAccount ? previousDebit : 0);
}
function assertCardLimit(db, cardId, purchaseCents, oldPurchaseCents = 0) {
  if (cardId == null) return;
  const card = db.prepare(`SELECT credit_limit_cents AS limit_cents,
    COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE card_id=? AND kind='despesa'),0) AS purchases_cents,
    COALESCE((SELECT SUM(amount_cents) FROM card_payments WHERE card_id=?),0) AS payments_cents
    FROM credit_cards WHERE id=?`).get(cardId, cardId, cardId);
  if (!card) throw Error('CARTAO_INEXISTENTE');
  if (card.purchases_cents - card.payments_cents + purchaseCents - oldPurchaseCents > card.limit_cents) throw Error('LIMITE_INSUFICIENTE');
}
module.exports = { assertAccountFunds, transactionDebitCents, assertTransactionFunds, assertCardLimit };
