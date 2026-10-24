/**
 * positiveIntEnvOverride: lê `process.env[envVarName]`, devolvendo o
 * valor como inteiro positivo se for válido, ou `defaultValue` caso
 * contrário (ausente, não numérico, zero, negativo ou fracionário).
 *
 * Extraído de duas implementações idênticas em extractArchive.js
 * (`bsdtarMemoryLimitKb`) e extractZip.js (`zipWorkerMaxOldGenMb`) --
 * mesmo padrão nos dois: lido a cada chamada (não uma vez no import),
 * pra permitir override em teste sem precisar recarregar o módulo, e
 * pra permitir ajustar por ambiente sem rebuild.
 *
 * @param {string} envVarName
 * @param {number} defaultValue
 * @returns {number}
 */
export function positiveIntEnvOverride(envVarName, defaultValue) {
  const override = Number(process.env[envVarName]);
  return Number.isInteger(override) && override > 0 ? override : defaultValue;
}
