declare const process: { env: Record<string, string | undefined> };

// Contrato mínimo Node para imports usados no sandbox tipado.
declare module "node:fs" {
  const fs: { readFileSync(path: URL, encoding: "utf8"): string };
  export default fs;
}
interface ImportMeta { resolve(specifier: string): string; }
