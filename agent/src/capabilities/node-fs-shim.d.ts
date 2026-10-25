/**
 * Interfaces locais para o subconjunto de fs usado em capabilities
 * migradas. Somente tipos: Node 22 continua usando o módulo nativo.
 */
declare module "node:fs/promises" {
  interface MinimalDirent {
    name: string;
    isDirectory(): boolean;
  }
  const fs: {
    access(path: string): Promise<void>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    readdir(path: string, options: { withFileTypes: true }): Promise<MinimalDirent[]>;
    stat(path: string): Promise<{ size: number }>;
  };
  export default fs;
}
