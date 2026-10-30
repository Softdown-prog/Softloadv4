# TypeScript 7.0.2 — Migração segura do gerador Blogger

Esta mudança substitui a compilação TypeScript por **7.0.2 nativo**, sem alterar runtime do Blogger, cobranças, Firebase, ferramentas de compilação HTML ou a VPS.

## Limitação real do novo compilador

TypeScript 7 não expõe `transpileModule` nem `createSourceFile`. O código já usa essas APIs para sincronizar espelhos TS→JS e verificar scripts clássicos carregados pelo navegador. A solução oficial `@typescript/typescript6@6.0.2` é dependência **somente de desenvolvimento** para essa API legada, não um compilador alternativo do produto. Preservamos todos os testes e os espelhos.

## Garantia de TS7 nativo

Para evitar que o pacote `@typescript/old` da compatibilidade assuma acidentalmente `node_modules/.bin/tsc`, os scripts `typecheck` e `typecheck:workers` invocam explicitamente `node node_modules/typescript/bin/tsc`. Rodar `npm run check:typescript-native` antes das verificações.

O projeto usa `tsconfig.workers.json` com `module: Preserve` para scripts globais (opção `None` foi removida no TS7) e `types: []`. Os arquivos gerados permanecem CommonJS na API e scripts clássicos no navegador, pois a geração dos espelhos ainda usa a API TypeScript 6.

## Validação obrigatória

- `npm ci --legacy-peer-deps`
- `npm run check:typescript-native`
- `npm run typecheck` (inclui comparação dos espelhos versionados)
- `npm run typecheck:workers` (inclui validação dos scripts clássicos)
- `npm test`, `npm run test:typescript-clis`, `npm run build`
- CI principal completo e smoke Docker antes de qualquer merge.

O Dependabot PR #123 contém apenas atualização do compilador e falha devido às antigas APIs; este PR substitutivo incorpora essa versão e a adaptação. **Não mesclar os dois PRs.** Nenhum deploy, alteração de infraestrutura ou migração de dados é autorizada aqui.
