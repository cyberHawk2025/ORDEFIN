'use strict';
// Only payments exceeding the remaining purchase debt may be reversed.
// All inputs and the return value are integer cents.
function cardRefundCents(purchases, payments, deletedPurchase) {
  for (const n of [purchases, payments, deletedPurchase]) {
    if (!Number.isSafeInteger(n) || n < 0) throw Error('VALOR_MONETARIO_INVALIDO');
  }
  if (deletedPurchase > purchases) throw Error('COMPRA_INCONSISTENTE');
  return Math.max(0, payments - (purchases - deletedPurchase));
}
module.exports = { cardRefundCents };
