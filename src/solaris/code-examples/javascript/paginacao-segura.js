'use strict';

function positiveInteger(raw, fallback, max, label) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw);
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError(label + ' deve ser inteiro positivo');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw new RangeError(label + ' excede limite');
  return number;
}
function paginate(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new TypeError('query inválida');
  const page = positiveInteger(query.page, 1, 100000, 'page');
  const pageSize = positiveInteger(query.pageSize, 20, 100, 'pageSize');
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}
module.exports = { paginate };
