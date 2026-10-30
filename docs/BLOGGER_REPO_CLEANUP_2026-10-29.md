# Limpeza do repositório para Softload Blogger (29/10/2026)

## Lote removido

- 98 arquivos em `public/dist/`: bundles antigos do React/Mermaid/Vite, já ausentes da imagem Blogger de produção; não são código-fonte do compilador. A saída é gerada pelo Vite somente quando ferramentas legadas a exigem.
- 2 relatórios em `out/template-fidelity/`: resultados reproduzíveis por `npm run test:quality`.
- 2 mídias `public/media/solaris-code-demo.*`: demonstração do chat Solaris que não é oferecido na landing Blogger.
- 2 workflows de gravação/publicação de vídeo Solaris, e respectivos script e teste (2 arquivos).
- `bun.lock` (a implantação usa `npm ci` + `package-lock.json`).
- `cloudbuild-rag-index.yaml` (pipeline Cloud Build de embeddings antigo, sem uso no deploy atual).

Total: **108 arquivos versionados**, cerca de **5,16 MB** de blobs removidos do HEAD. Não diminui imediatamente o histórico Git nem o consumo do Docker em produção.

## Preservado intencionalmente

- `server.ts/js`, `src/core` e `src/rag/templates`: compilador Blogger.
- `src/routes/authRoutes`, sessão Firestore, arquivos, Mercado Pago, webhook, conciliação e histórico/recibos.
- `agent/` e `Power-up/`: embora obsoletos como produto público, o **receptor v2 da VPS exige duas imagens app+agent**. Só retirar após migrar o contrato do receptor/Compose e validar deploy e rollback; apagá-los agora quebraria o deploy.
- `frontend/`: não faz parte da imagem Blogger, mas workflows de CI e `vite build` ainda dependem do código-fonte. Sua exclusão precisa ser acompanhada da substituição dos gates de frontend e atualização das dependências/lockfile.
- `src/solaris/` e outros módulos de IA: rotas e auditorias do backend ainda mantêm referências. Exigem retirar as rotas de compatibilidade e reconstruir o grafo de módulos e testes antes de apagar.

## Critério de validação

O PR de limpeza deve passar pelo typecheck e testes, construir a imagem atual e, após integração, pelo deploy de app+agent e smoke de compilação XML real de `/criar/download`. **Não habilitar** pagamentos nem apagar arquivos/contas/buckets Firestore/Storage.
