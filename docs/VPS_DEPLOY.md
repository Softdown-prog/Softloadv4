# Deploy da Softloadv4 na VPS

Cada push na branch `main` executa `.github/workflows/deploy.yml`. O workflow
valida o projeto, cria imagens Docker identificadas pelo SHA do commit, envia
as imagens alteradas à VPS com retomada de transferência e ativa a revisão
somente após as verificações de saúde. O domínio público é
`https://softload.analysepro.com`.

A chave SSH de deploy fica no segredo Actions `SOFTLOAD_VPS_SSH_KEY`. A chave
autorizada na VPS executa apenas o receptor de deploy, sem acesso a shell.
As imagens da revisão em uso e da revisão anterior são mantidas para reversão.

`.github/workflows/reconcile-deploy.yml` compara periodicamente o SHA da
`main` ao SHA publicado e solicita uma nova tentativa quando necessário.
