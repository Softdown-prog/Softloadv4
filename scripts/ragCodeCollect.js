"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const { collectCode, validateLimit, DEFAULT_LIMIT, OUTPUT_DIR } = require('./codeCorpus/codeCollector');
async function main() {
    const args = process.argv.slice(2);
    if (args.some(x => x !== '--apply' && !/^--limit=\d+$/.test(x)))
        throw new Error('Uso: npm run rag:code-collect -- [--limit=40] [--apply]');
    const limitArg = args.find(x => x.startsWith('--limit='));
    const limit = limitArg ? validateLimit(Number(limitArg.slice(8))) : DEFAULT_LIMIT;
    const apply = args.includes('--apply');
    console.log('[SOLARIS-CODE] Coleta ' + (apply ? 'ativa' : 'simulação') + ', limite=' + limit);
    const result = await collectCode({ limit, apply });
    console.log(JSON.stringify(result, null, 2));
    if (apply)
        console.log('Arquivos locais: ' + OUTPUT_DIR);
    if (result.errors.length)
        process.exitCode = 1;
}
if (require.main === module)
    main().catch(err => { console.error(err.message); process.exitCode = 1; });
