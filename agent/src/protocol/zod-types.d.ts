/**
 * Contract of the Zod API used by the HTTP worker protocol.
 *
 * Root TS gate compiles before `agent/npm ci`, so Zod's own declarations
 * are not available in that checkout. These are type-only signatures:
 * production loads the real Zod dependency from agent/package.json.
 * Keep this aligned with the Zod calls in protocol.ts.
 */
declare module "zod" {
  export type ZodParseResult<T> =
    | { success: true; data: T }
    | { success: false; error: { issues: unknown[] } };

  export interface ZodType<T> {
    strict(): ZodType<T>;
    min(length: number): ZodType<T>;
    max(length: number): ZodType<T>;
    int(): ZodType<T>;
    positive(): ZodType<T>;
    optional(): ZodType<T | undefined>;
    default(value: Exclude<T, undefined>): ZodType<Exclude<T, undefined>>;
    safeParse(input: unknown): ZodParseResult<T>;
  }

  type ValueOf<S> = S extends ZodType<infer T> ? T : never;
  export const z: {
    string(): ZodType<string>;
    number(): ZodType<number>;
    boolean(): ZodType<boolean>;
    unknown(): ZodType<unknown>;
    literal<const T extends string>(value: T): ZodType<T>;
    enum<const T extends readonly string[]>(values: T): ZodType<T[number]>;
    object<const S extends Record<string, ZodType<any>>>(
      shape: S
    ): ZodType<{ [K in keyof S]: ValueOf<S[K]> }>;
    array<T>(type: ZodType<T>): ZodType<T[]>;
    record<T>(key: ZodType<string>, value: ZodType<T>): ZodType<Record<string, T>>;
    union<const T extends readonly ZodType<any>[]>(
      choices: T
    ): ZodType<ValueOf<T[number]>>;
  };
}
