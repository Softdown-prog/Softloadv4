/** Minimal Node runtime type used by plan-tracker.ts; avoid adding a new
 *  production dependency while the Worker retains ESM JavaScript runtime. */
declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHmac(algorithm: "sha256", key: string): {
    update(data: string | Uint8Array): { digest(encoding: "hex"): string };
  };
  export function timingSafeEqual(a: { length: number }, b: { length: number }): boolean;
}
