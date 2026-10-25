/**
 * Minimal native Node path signatures for the isolated agent typecheck.
 * This is a type-only declaration; runtime still imports node:path.
 */
declare module "node:path" {
  const path: {
    resolve(...paths: string[]): string;
    relative(from: string, to: string): string;
    isAbsolute(value: string): boolean;
    dirname(value: string): string;
    basename(value: string): string;
    join(...paths: string[]): string;
  };
  export default path;
}
