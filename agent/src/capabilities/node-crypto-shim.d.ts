/** Minimal Node runtime type used by plan-tracker.ts; avoid adding a new
 *  production dependency while the Worker retains ESM JavaScript runtime. */
declare module "node:crypto" {
  export function randomUUID(): string;
}
