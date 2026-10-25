/**
 * Interfaces locais para o subconjunto de fs usado em capabilities
 * migradas. Somente tipos: Node 22 continua usando o módulo nativo.
 */
declare module "node:fs/promises" {
  const fs: {
    access(path: string): Promise<void>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
  };
  export default fs;
}
