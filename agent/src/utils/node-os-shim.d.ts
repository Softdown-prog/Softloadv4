/**
 * Minimal Node 22 OS declaration, used by the native diff/patch helper.
 * This file emits no JavaScript and adds no container dependencies.
 */
declare module "node:os" {
  const os: {
    tmpdir(): string;
  };
  export default os;
}
