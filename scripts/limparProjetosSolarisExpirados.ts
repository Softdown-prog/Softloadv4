export {};
/**
 * CLI de limpeza manual dos projetos expirados do Solaris.
 * Execute somente como CLI; como antes, importar seu JS aciona a limpeza.
 * Uso: npm run solaris:limpar-projetos-expirados -- [dias]
 * Atenção: em execução real usa Firestore e GCS configurados no backend.
 */
interface CleanupError { id: string; erro: string }
interface CleanupResult { apagados: string[]; erros: CleanupError[] }

declare const console: { log(...values: unknown[]): void; error(...values: unknown[]): void };
declare const require: (id: string) => unknown;
declare const process: { argv: string[]; exit(code: number): never };
(require('dotenv') as { config(): void }).config();
const { apagarProjetosExpirados, DIAS_RETENCAO_PADRAO } = require('../src/solaris/tools/projectStorage') as {
    apagarProjetosExpirados(options: { diasParaExpirar: number }): Promise<CleanupResult>;
    DIAS_RETENCAO_PADRAO: number;
};

const diasArg = Number(process.argv[2]);
const dias = Number.isFinite(diasArg) && diasArg > 0 ? diasArg : DIAS_RETENCAO_PADRAO;

apagarProjetosExpirados({ diasParaExpirar: dias })
    .then((r) => {
        console.log(`\n✅ ${r.apagados.length} projeto(s) expirado(s) (>${dias}d) removido(s): ${r.apagados.join(', ') || '-'}`);
        if (r.erros.length) {
            console.log(`❌ ${r.erros.length} erro(s):`);
            for (const e of r.erros) console.log(`   - ${e.id}: ${e.erro}`);
        }
        process.exit(r.erros.length > 0 ? 1 : 0);
    })
    .catch((err: Error) => {
        console.error('[SOLARIS-CLEANUP] falhou:', err.message);
        process.exit(1);
    });
