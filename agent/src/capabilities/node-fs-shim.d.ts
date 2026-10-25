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
    mkdtemp(prefix: string): Promise<string>;
    realpath(path: string): Promise<string>;
    mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    readFile(path: string, encoding: null): Promise<Uint8Array>;
    readFile(path: string, encoding: "utf8" | null): Promise<string | Uint8Array>;
    writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    readdir(path: string, options: { withFileTypes: true }): Promise<MinimalDirent[]>;
    stat(path: string): Promise<{ size: number }>;
    rm(path: string, options: { recursive?: boolean; force: boolean }): Promise<void>;
  };
  export default fs;
}
