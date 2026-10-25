/**
 * Contrato minimo do modulo Node 22 para o TS isolado do Agent.
 * Arquivo de declaracoes: nao adiciona imports ou runtime ao Docker.
 */
declare module "node:dns/promises" {
  const dns: {
    lookup(hostname: string, options: { all: true }): Promise<Array<{
      address: string;
      family: number;
    }>>;
  };
  export default dns;
}
