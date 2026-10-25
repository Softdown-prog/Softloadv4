/**
 * Minimal native Node typings for the ESM vendoring script.
 * Declarations only: no extra production dependencies.
 */
declare module "node:fs" {
  const fs: {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options: { recursive: true }): string | undefined;
    copyFileSync(source: string, destination: string): void;
  };
  export default fs;
}
declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
