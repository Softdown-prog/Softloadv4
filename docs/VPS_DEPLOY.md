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

## Custos de rebuild e tráfego (outubro de 2026)

O GitHub Actions faz `npm ci`, testes e build no runner hospedado. A VPS **não**
reinstala automaticamente dependências npm ou Chromium após cada push:
ela recebe imagens Docker já construídas. O deploy passa a construir e transferir somente `app` e `agent`.
A desativação efetiva dos serviços `sandbox` e `embeddings` na VPS depende
da atualização coordenada do receptor de deploy; ver `SERVICE_RETIREMENT.md`.

A imagem `app` ainda é reconstruída e enviada em toda revisão publicada,
pois o SHA exposto por `/health` precisa corresponder ao commit ativo.
Antes das melhorias de cache, exemplos reais em 26/10 registraram um
`docker save | gzip -1` do app com cerca de **401 MB** por revisão.
O rsync retoma uploads interrompidos, mas um arquivo de imagem com SHA
novo não é uma transferência incremental de camadas.

O workflow agora usa BuildKit com cache separado por serviço nos runners
GitHub. Isso evita repetir diversas instalações no **build**, mas o arquivo
`.tar.gz` transferido à VPS continua completo. Também exclui `.git` do
contexto/imagem final e injeta `GIT_SHA`/`GIT_DATE` via build args,
verificando o SHA da imagem antes de enviá-la.

**Próxima otimização (exige alteração coordenada e validada no receptor da
VPS):** transporte OCI/registry por camadas reutilizáveis. O receptor SSH
restrito atual aceita `finish:serviço:sha:digest` e importa arquivos
`.tar.gz`; não substituir por `docker pull` sem testar credenciais,
assinaturas/digests, retenção da revisão anterior, rollback e integridade.
Não declarar economia de tráfego na VPS apenas com o cache do BuildKit.

A franquia da Locacloud pode seguir outra metodologia de medição.
