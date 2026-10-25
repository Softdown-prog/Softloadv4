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
    options: { cwd: string; reject: false; timeout: number },
  ): Promise<{
    exitCode: number | undefined;
    stdout: string;
    stderr: string;
    failed: boolean;
  }>;
}
