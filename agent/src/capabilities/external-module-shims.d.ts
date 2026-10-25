/**
 * Contratos usados apenas pela checagem TS do Agent.
 * Runtime real continua usando forge/index.cjs e execa da instalação npm.
 */
declare module "*.cjs" {
  const forge: {
    catalog(): unknown;
    readRecipe(recipeId?: string): unknown;
    render(task: {
      type: string;
      id?: string;
      command?: string;
      recipe?: unknown;
      receitaJson?: string;
      recipeId?: string;
    }, options: { baseDir: string }): Promise<unknown>;
  };
  export default forge;
}

declare module "execa" {
  export function execa(
    executable: string,
    args: string[],
    options: { cwd?: string; reject: false; timeout?: number },
  ): Promise<{
    exitCode: number | undefined;
    stdout: string;
    stderr: string;
    failed: boolean;
  }>;
}

/** Subconjunto tipado do Octokit exigido pelas operações do Agent. */
declare module "@octokit/rest" {
  export class Octokit {
    constructor(options: { auth: string });
    rest: import("./github.js").GithubClient["rest"];
  }
}

/** Limitador assíncrono tipado; nenhuma dependência extra em produção. */
declare module "p-limit" {
  export default function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
}
