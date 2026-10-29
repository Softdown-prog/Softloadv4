# Dockerfile Lite — compilador Blogger sem A7 Forge

O piloto isolado `Dockerfile.lite` não substitui automaticamente a imagem do App em produção. O workflow `lite-image-ci.yml` valida apenas no GitHub Actions, sem enviar containers nem modificar dados.

## Inclusões
- Node 20, Express, EJS e compilador procedural Blogger.
- Firebase Auth/Firestore, Mercado Pago e os módulos que o servidor atual precisa carregar.
- Views de landing, editor público `/criar`, dashboard, arquivos antigos, contato e páginas legais.
- Bootstrap e Chart.js usados pelos templates EJS.

## Exclusões
- Frontend React/Vite e `public/dist`.
- A7 Forge (`agent/forge`), Agent (`agent/src`) e Python/Pillow/FFmpeg.
- Documentação, exemplos, arquivos temporários e ferramentas de desenvolvimento não usadas pelo App.

## Validações
```bash
node --test scripts/liteImage.contract.test.cjs src/routes/publicBlogger.contract.test.cjs
docker build --progress plain -f Dockerfile.lite -t softload-blogger-lite:local .
docker image inspect softload-blogger-lite:local --format '{{.Size}}'
```

A imagem deve carregar módulos de servidor sem erro, ter o editor público, validar páginas EJS e negar presença de Forge/React. Não confundir tamanho do Docker no runner com espaço recuperado na VPS.

## Etapas pendentes para aposentadoria do Agent
1. Homologar login, download público, quota, compilação XML real, pagamento Mercado Pago e histórico.
2. Atualizar receptor, contrato do Actions e Docker Compose da VPS para aceitar somente App, com health externo e rollback.
3. Preservar backup e revisões anteriores. Remover apenas imagens não usadas **depois** da troca confirmada, sem apagar volumes nem arquivos de clientes.
4. Descontinuar códigos/testes herdados de Forge/Agent que ainda residem no repositório. Não os excluir antecipadamente se o deploy de produção ainda os exige.

O gerador público permite dois XML por sessão, com limite de IP e CSRF. Uma pessoa pode reiniciar sua sessão ao limpar cookies; não apresentar esse limite como garantia de identidade.
