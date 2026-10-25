/** Lê um override inteiro positivo do ambiente sem capturá-lo no import. */
export function positiveIntEnvOverride(envVarName: string, defaultValue: number): number {
  const override = Number(process.env[envVarName]);
  return Number.isInteger(override) && override > 0 ? override : defaultValue;
}
