declare const process: { env: Record<string, string | undefined>; hrtime: { bigint(): bigint }; exit(code: number): never; on(signal: "SIGTERM" | "SIGINT", listener: () => void): void };

// Contrato mínimo Node para imports usados no sandbox tipado.
declare module "node:fs" {
  const fs: {
    readFileSync(path: URL, encoding: "utf8"): string;
    mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
    createWriteStream(path: string): { destroy(): void; on(event: "error", listener: (error: Error) => void): void; on(event: "close", listener: () => void): void };
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
  const path: {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
    dirname(path: string): string;
    sep: string;
  };
  export default path;
  export function isAbsolute(path: string): boolean;
}

declare module "node:url" {
  export function fileURLToPath(path: string | URL): string;
}
declare module "node:worker_threads" {
  export const workerData: unknown;
  export const parentPort: { postMessage(value: unknown): void } | null;
  export class Worker {
    constructor(file: string, options: { workerData: { baseDir: string; zipBuffer: ArrayBuffer | Buffer; opts: unknown }; transferList: ArrayBuffer[]; resourceLimits: { maxOldGenerationSizeMb: number } });
    terminate(): Promise<number>;
    once(event: "message", listener: (message: { ok: boolean; arquivos: Array<{ caminho: string; conteudo: string | null; binario: boolean }>; message: string }) => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    once(event: "exit", listener: (code: number) => void): this;
  }
}
interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
  subarray(begin?: number, end?: number): Buffer;
}
declare const Buffer: {
  from(data: ArrayBuffer | Uint8Array | string, encoding?: string): Buffer;
  isBuffer(value: unknown): value is Buffer;
  alloc(size: number): Buffer;
  concat(chunks: readonly Uint8Array[]): Buffer;
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

declare module "node:child_process" {
  interface ChildStream { on(event: "data", listener: (chunk: Buffer) => void): void }
  interface Child {
    stdout: ChildStream;
    stderr: ChildStream;
    on(event: "error", listener: (error: Error & { code?: string }) => void): void;
    on(event: "close", listener: (code: number | null, signal: string | null) => void): void;
    kill(signal: string): boolean;
  }
  export function spawn(file: string, args: string[], opts: { stdio: string[]; windowsHide: boolean }): Child;
}
declare module "node:fs/promises" {
  const fsp: {
    mkdtemp(prefix: string): Promise<string>;
    writeFile(path: string, data: Uint8Array, opts?: { flag?: string }): Promise<void>;
    rm(path: string, opts: { recursive: boolean; force: boolean }): Promise<void>;
    readFile(path: string): Promise<Buffer>;
    statfs(path: string): Promise<{ bavail: number; bsize: number }>;
  };
  export default fsp;
}

declare module "yauzl" {
  export interface ZipEntry { fileName: string; uncompressedSize: number; externalFileAttributes: number }
  export interface ZipReadable {
    destroy(): void;
    pipe(dest: unknown): void;
    on(event: "data", cb: (chunk: Buffer) => void): void;
    on(event: "error", cb: (error: Error) => void): void;
  }
  export interface ZipFile {
    readEntry(): void;
    close(): void;
    on(event: "entry", cb: (entry: ZipEntry) => void): void;
    on(event: "error", cb: (err: Error) => void): void;
    on(event: "end", cb: () => void): void;
    openReadStream(entry: ZipEntry, cb: (error: Error | null, stream: ZipReadable) => void): void;
  }
  const yauzl: {
    fromBuffer(buffer: Buffer, options: { lazyEntries: boolean }, cb: (error: Error | null, file: ZipFile) => void): void;
    validateFileName(name: string): string | null;
  };
  export default yauzl;
}
