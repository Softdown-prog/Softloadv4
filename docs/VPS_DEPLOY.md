# Deploy da Softloadv4 na VPS

Cada push na branch `main` executa `.github/workflows/deploy.yml`. O workflow
valida o projeto, cria imagens Docker identificadas pelo SHA do commit, envia
as imagens alteradas à VPS com retomada de transferência e ativa a revisão
somente após as verificações de saúde. O domínio público é
`https://softload.analysepro.com`.

Os jobs de validação e build usam runners do GitHub. O job `activate` usa o
runner `softloadeng` instalado na VPS, com a etiqueta `softload-vps-deploy`.
Ele roda como `softloadrunner`, sem sudo ou acesso ao Docker. A ativação dos
containers passa pela chave SSH restrita ao receptor de deploy; a chave é
apagada do diretório temporário ao fim do job.

A chave SSH de deploy fica no segredo Actions `SOFTLOAD_VPS_SSH_KEY`. A chave
autorizada na VPS executa apenas o receptor de deploy, sem acesso a shell.
As imagens da revisão em uso e da revisão anterior são mantidas para reversão.

`.github/workflows/reconcile-deploy.yml` compara periodicamente o SHA da
`main` ao SHA publicado e solicita uma nova tentativa quando necessário.

O grupo de concorrência mantém um deploy em execução e substitui o deploy
pendente pelo commit mais recente. Cada execução confere novamente a ponta da
`main` antes de construir, transferir e ativar imagens. Se outro commit já a
substituiu, a execução antiga termina sem trocar os containers. Assim, uma
sequência rápida de pushes converge para a versão mais recente sem enviar
imagens obsoletas à VPS.
