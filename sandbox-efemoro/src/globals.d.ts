declare const process: { env: Record<string, string | undefined>; hrtime: { bigint(): bigint }; exit(code: number): never; on(signal: "SIGTERM" | "SIGINT", listener: () => void): void };

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
interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}
declare const Buffer: {
  from(data: ArrayBuffer | Uint8Array | string, encoding?: string): Buffer;
  isBuffer(value: unknown): value is Buffer;
  alloc(size: number): Buffer;
};

declare module "express" {
  interface SandboxExpress {
    (): {
      use(...handlers: unknown[]): void;
      get(path: string, handler: (...args: any[]) => unknown): void;
      post(path: string, ...handlers: unknown[]): void;
      listen(port: string | number, listener: () => void): { close(listener: () => void): void };
    };
    json(opts: { limit: string }): unknown;
    raw(opts: { type: () => boolean; limit: number }): unknown;
  }
  const express: SandboxExpress;
  export default express;
}
