export type ServerConfig = Readonly<{
  port: number;
  mode: 'development' | 'test' | 'production';
  trustProxy: boolean;
}>;

export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const rawMode = env.NODE_ENV || 'development';
  if (rawMode !== 'development' && rawMode !== 'test' && rawMode !== 'production') {
    throw new Error('NODE_ENV inválido');
  }
  const rawPort = env.PORT === undefined ? '3000' : env.PORT;
  if (!/^[1-9]\d{0,4}$/.test(rawPort)) throw new Error('PORT inválido');
  const port = Number(rawPort);
  if (port > 65535) throw new Error('PORT fora do intervalo permitido');
  // Em produção, habilitar apenas quando houver proxy reverso confiável.
  const trustProxy = env.TRUST_PROXY === 'true';
  if (env.TRUST_PROXY !== undefined && !['true', 'false'].includes(env.TRUST_PROXY)) {
    throw new Error('TRUST_PROXY inválido');
  }
  return Object.freeze({ port, mode: rawMode, trustProxy });
}
