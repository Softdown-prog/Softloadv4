'use strict';

// Nunca usar números decimais de reais em operações críticas.
function calculateCart(items, discountCents = 0) {
  if (!Array.isArray(items)) throw new TypeError('items deve ser lista');
  if (!Number.isSafeInteger(discountCents) || discountCents < 0) throw new RangeError('desconto inválido');
  let subtotalCents = 0;
  for (const { unitPriceCents, quantity } of items) {
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 ||
        !Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError('item inválido');
    const line = unitPriceCents * quantity;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(subtotalCents + line)) throw new RangeError('valor excede precisão segura');
    subtotalCents += line;
  }
  const appliedDiscountCents = Math.min(subtotalCents, discountCents);
  return { subtotalCents, appliedDiscountCents, totalCents: subtotalCents - appliedDiscountCents };
}
module.exports = { calculateCart };
