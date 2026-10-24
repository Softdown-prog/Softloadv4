/**
 * CLI de coleta do corpus de codigo Solaris. Dry-run por padrao; nunca aplica
 * mudancas sem --apply. O coletor valida licencas e limites de fontes.
 */
declare const console: { warn(...args: unknown[]): void; log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exitCode?: number };

interface CodeCollectionResult { errors: readonly string[]; [key: string]: unknown }
const { collectCode, validateLimit, DEFAULT_LIMIT, OUTPUT_DIR } = require('./codeCorpus/codeCollector') as {
  collectCode(options: { limit: number; apply: boolean }): Promise<CodeCollectionResult>;
  validateLimit(limit: number): number;
  DEFAULT_LIMIT: number;
  OUTPUT_DIR: string;
};

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(x => x !== '--apply' && !/^--limit=\d+$/.test(x))) throw new Error('Uso: npm run rag:code-collect -- [--limit=40] [--apply]');
  const limitArg = args.find(x => x.startsWith('--limit='));
  const limit = limitArg ? validateLimit(Number(limitArg.slice(8))) : DEFAULT_LIMIT;
  const apply = args.includes('--apply');
  console.log('[SOLARIS-CODE] Coleta ' + (apply ? 'ativa' : 'simulação') + ', limite=' + limit);
  const result = await collectCode({ limit, apply });
  console.log(JSON.stringify(result, null, 2));
  if (apply) console.log('Arquivos locais: ' + OUTPUT_DIR);
  if (result.errors.length) process.exitCode = 1;
}
if (require.main === module) main().catch(err => { console.error((err as Error).message); process.exitCode = 1; });
