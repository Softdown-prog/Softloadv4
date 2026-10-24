# Migração JavaScript → TypeScript — Softloadv4

Estado de referência: inventário da main de 24/10/2026, antes deste lote.

## Contagem e exclusões

- 597 arquivos `.js`; 218 arquivos `.ts`; 480 `.js` sem irmão `.ts/.tsx`.
- **480 NÃO é uma lista de arquivos de produção para converter**: inclui testes em JavaScript, bundles versionados de `public/dist/`, exemplos de código e entradas independentes como `agent/` e `sandbox-efemoro/`.
- `scripts/audit-typescript-migration.js` fornece o **saldo confiável do núcleo**: exclui `.test.js` e confere cadastro, typecheck e espelho CommonJS de cada módulo migrado.
- Diretórios ainda com muitos arquivos JS sem fonte TS: `agent/src/`, `src/routes/dashboard_routes/`, `sandbox-efemoro/src/`, `scripts/codeCorpus/`, `src/services/` e scripts CLI. Não alterar `public/dist/` manualmente: é saída gerada.

## Critério de convivência

O backend executa CommonJS `.js` com Node. Cada migração de scripts e do núcleo deve entregar **fonte TypeScript tipada**, **espelho CommonJS gerado**, cadastro em `scripts/typescript-mirror-sources.json` e `tsconfig.json`, e testes. `npm run typecheck` detecta mirrors divergentes.

Evitar áreas em migração simultânea: conferir os commits da `main` e a presença de `.ts` antes de começar; nunca sobrescrever arquivos cuja origem foi alterada sem reconciliar. Exemplos originais para RAG podem continuar em JavaScript porque são conteúdo didático, não necessariamente legado de runtime.

## Lote inicial feito nesta conversa

- `scripts/diagnostico-sweep.ts`: interfaces tipadas para manifesto, diagnósticos, achados e relatórios; preserva a CLI e o JavaScript usado pelo Node.
- `scripts/limparProjetosSolarisExpirados.ts`: contrato tipado de limpeza Firestore/GCS, retorno e erros; espelho CommonJS preserva os parâmetros e a execução manual. **Não executar esse comando para validar uma migração**: ele elimina projetos reais no ambiente configurado.
- `scripts/typescriptCliSmoke.test.js`: testes com dependências inteiramente simuladas, sem Firestore, GCS ou compilação de templates reais.

## Comandos seguros

```sh
npm run test:typescript-clis
npm run typecheck
npm run audit:typescript
```

Para novos scripts: usar os arquivos já convertidos como referência, executar os testes e manter ambos os arquivos sob controle de versão. Os testes completos em GitHub Actions dependem de um runner disponível.

## Lote complementar — segmentação de código para RAG

- `scripts/codeCorpus/codeChunker.ts` passou a ser a fonte tipada do particionador de código. Mantém o JavaScript CommonJS para os consumidores, a extensão de linguagens, o limite de 220 palavras e os filtros de possíveis segredos.
- `src/solaris/rag/codeCorpus.test.js` já testa chunking por linhas, preservação de recuos, extensões de código e limites. O gate TypeScript também valida o novo espelho.
