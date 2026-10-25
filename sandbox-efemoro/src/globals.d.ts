declare const process: { env: Record<string, string | undefined>; hrtime: { bigint(): bigint } };

// Contrato mínimo Node para imports usados no sandbox tipado.
declare module "node:fs" {
  const fs: {
    readFileSync(path: URL, encoding: "utf8"): string;
    mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  };
  export default fs;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}
interface ImportMeta { resolve(specifier: string): string; }

// Interfaces estritamente necessárias para manter as fontes TS separadas do runtime.
declare module "node:dns/promises" {
  const dns: { lookup(hostname: string, options: { all: true }): Promise<Array<{ address: string; family: number }>> };
  export default dns;
}
declare module "node:os" {
  const os: { tmpdir(): string };
  export default os;
}
declare module "node:path" {
  const path: { join(...paths: string[]): string };
  export default path;
  export function isAbsolute(path: string): boolean;
}

declare module "node:url" {
  export function fileURLToPath(path: string | URL): string;
}
declare module "node:worker_threads" {
  export const workerData: unknown;
  export const parentPort: { postMessage(value: unknown): void } | null;
}
declare const Buffer: {
  from(data: ArrayBuffer | Uint8Array): Uint8Array;
};
