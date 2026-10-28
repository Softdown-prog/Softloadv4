# Deploy da Softloadv4 na VPS

Cada push na branch `main` executa `.github/workflows/deploy.yml`. O workflow
valida o projeto, cria imagens Docker identificadas pelo SHA do commit, envia
as imagens alteradas à VPS por HTTPS e ativa a revisão somente após carregar
ambos os serviços. O sucesso exige saúde pública e o SHA completo esperado. O domínio público é
`https://softload.analysepro.com`.

Validação, build e ativação usam runners hospedados no GitHub. A entrega
`receive` usa o runner `softloadrunner` na VPS, sem checkout, sudo ou Docker: ele
baixa bytes criptografados e usa a rota SSH **local**, confirmada por `ip route`,
para entregar os arquivos ao receptor v2 já instalado. O job
`activate` **não** executa dentro da VPS: utiliza a chave SSH restrita
para falar com o receptor de deploy instalado no servidor. A chave é
apagada do diretório temporário ao fim do job; o runner não recebe socket
Docker da VPS.

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
O rsync é usado apenas na cópia **local** na VPS. Um arquivo de imagem com SHA
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

## Pré-validação do receptor v2

A retirada dos serviços pesados introduz um contrato novo. Antes de qualquer build ou transferência, o job `plan` chama pelo SSH restrito o comando de consulta `contract:v2` e exige resposta exata `softload-deploy:v2:app,agent`. Resposta ausente/incorreta **interrompe o deploy antes de enviar as imagens**; não ativa app/agent parcialmente. A implementação do receptor da VPS ainda precisa ser migrada fora deste repositório (issue #20). O handshake não libera espaço em disco por si só.

Para provas de regressão, a CI compila a imagem do Agent em runner GitHub e executa o smoke real do Asset Forge com base Debian slim. Os valores de tamanho antes/depois devem ser medidos no Docker de produção após a troca da imagem e limpeza seletiva validada.

## Diagnóstico da incompatibilidade do receptor v2 (26/10/2026)

O job plan de 40419393923 foi interrompido com 'Command not allowed' quando
consultou 'contract:v2'. O receptor SSH na VPS ainda não aceita o contrato de
dois serviços; o deploy foi barrado antes de build/transferência. No run
40413155240, anterior à proteção, a ativação falhou com
'No such image: softload-sandbox:366eed8...'.

O código real do receptor instalado no host da VPS não pertence a este repositório.
Não desligar o handshake, não recriar a imagem removida e não falsificar tags.

O Painel possui um Terminal VPS administrativo. Após login autorizado, esta
consulta é apenas leitura e localiza candidatos sem mostrar chaves privadas:

    linux find /usr/local/bin /usr/local/sbin /opt/softload-infra /opt/softload /srv -maxdepth 3 -type f -iname '*deploy*' -print

Com acesso ao host e após localizar o receptor, é possível executar localmente
scripts/vps/inspect-receiver-readonly.sh (se o script estiver no host). Ele mostra
caminhos e indicadores estáticos da compatibilidade v2, sem ler variáveis Env
nem imprimir o conteúdo de authorized_keys. Não instala nem executa o receptor.

**Não aplicar atualização automática do receptor desconhecido.** Um operador
autorizado deve revisar o arquivo efetivo apontado pela regra SSH, fazer backup
da configuração, da revisão ativa e do Compose, adaptar apenas app/agent
(finish, reuse, deploy e rollback), e validar a resposta exata de
'contract:v2': 'softload-deploy:v2:app,agent'. Após testes e saúde pública,
retirar serviços antigos e imagens especificamente auditadas, sem prune.

A atualização do código no GitHub não equivale à migração da VPS.


## Bloqueio persistente identificado em 27/10/2026

As execuções #40476530713, #40476647309 e #40476919428 aprovaram o job
`verify`, porém o job `plan` terminou com `Command not allowed` ao
consultar via SSH `contract:v2`. Nesse estado, **nenhuma imagem é enviada**
e **nenhuma ativação é feita**. A limpeza de Sandbox/Embeddings no Docker
não altera o receptor SSH instalado, por isso novos commits seguem falhando.

Para reduzir custos de GitHub Actions até a atualização administrativa do
receptor na VPS, a ordem agora é **`plan` (preflight somente-leitura) →
`verify` (testes e build) → `build_and_transfer` → `activate`**. A
verificação independente de TypeScript continua em seu próprio workflow.
O reconciliador agendado passa a reconhecer a falha conhecida no contrato
do receptor e não solicitar novamente o mesmo deploy sem intervenção.

**Recuperação:** o administrador deve acessar a VPS pelo Terminal SSH
autenticado do Painel (não pela chave SSH restrita do Actions), verificar o
script receptor real apontado pelo forced-command, salvar backup e migrar
seus comandos `finish`, `reuse`, `deploy` e rollback para apenas
`app`/`agent`. O comando `contract:v2` deve então retornar **exatamente**
`softload-deploy:v2:app,agent`. Confirme a identidade SSH e o comportamento
do rollback num ambiente controlado. Somente após essa migração,
acionar manualmente **Actions → Deploy Softload VPS → Run workflow** e
verificar se o SHA público de `/health` corresponde ao commit.

**Não remover o preflight e não criar imagens falsas de sandbox/embeddings**
para contornar o receptor.

## Recuperação confirmada no host — 27/10/2026

O operador confirmou a execução no Terminal VPS administrativo do utilitário
`scripts/vps/migrate_receiver_v2.py`, com os seguintes resultados:

- Download conferido por SHA-256;
- `PREFLIGHT_OK`: Compose ativo contém `app` e `agent`, sem `sandbox`/`embeddings`;
- `MIGRACAO_OK`: comando `contract:v2` devolve `softload-deploy:v2:app,agent`;
- `BACKUP_OK`: backup local do receptor original criado antes da troca;
- `NENHUM_CONTAINER_ALTERADO`: atualização apenas do receptor SSH.

Esses resultados são confirmações da execução administrativa, **não** prova de
deploy completo. O próximo push aciona a validação real pelo SSH restrito do
GitHub Actions; só considere resolvido depois dos jobs `plan`, `verify`,
`build_and_transfer`, `activate` e da confirmação de SHA em
`https://softload.analysepro.com/health`. Em caso de erro, preservar backup
e imagens de rollback, sem limpeza automática de Docker.

## Travamento de transferencia obsoleta — 27/10/2026

O deploy do SHA `01e394fabc7bd4abd80ad1c6d2d34a71e1872587` passou
por `plan` (contrato SSH v2) e `verify`, mas permaneceu na etapa
`Transfer resumable image to VPS` da imagem `app`. Enquanto a
transferencia nao termina, a concorrencia `softload-vps-production`
impede a proxima revisao de executar. O `rsync` permitia ate 24
tentativas de 180 segundos para cada imagem, mesmo com `main` avancada.

O fluxo agora verifica o SHA atual de `main` **antes** de testes, build,
transferencia, novas tentativas de rsync e ativacao, encerrando com
sucesso as etapas obsoletas sem mudar os containers. A transferencia em
curso nao e interrompida a meio de uma tentativa; e verificada entre
tentativas. A revisao mais recente continua na fila serializada.

A workflow de recuperacao pontual
`.github/workflows/unstick-obsolete-vps-deploy.yml` so solicita
cancelamento do run acima apos confirmar: SHA conhecido, nova `main`,
a etapa exata de upload `app` em execucao e **nenhum** job de ativacao
iniciado. Ela tambem consulta estado de disco e nomes dos processos
no runner VPS somente-leitura. Nenhuma limpeza Docker e realizada.
Se o cancelamento falhar por permissao, o operador pode cancelar aquele
run pelo Actions, apos repetir as mesmas verificacoes.

## Convergencia de uploads obsoletos no Actions

O workflow `.github/workflows/unstick-obsolete-vps-deploy.yml` agora e
acionado em cada push para `main`, com permissao limitada a Actions,
para procurar runs anteriores de `deploy.yml` ainda pendentes/ativos.
Somente quando a SHA for diferente da atual e quando o job `activate`
ainda **nao tiver iniciado**, solicita o cancelamento do run ultrapassado.
Se `activate` estiver em andamento/concluido, nao interfere: o mecanismo
de verificacao/rollback deve acabar sem interrupcoes externas.
Isso evita ficar enviando centenas de MB a cada revisao intermediaria.
O upload da revisao mais nova ainda precisa de transporte mais eficiente
para superar a banda observada de aproximadamente 30-50 KB/s.

## 27/10/2026 — Falhas reproduzidas do upload e reconciliação com scale-to-zero

O run `40562901405` falhou depois de o `rsync` indicar **0 bytes** a
transferir para um arquivo remoto do mesmo tamanho (386.858.773 bytes).
O receptor recusou as quatro chamadas `finish` com `Archive checksum
mismatch`. Teste local reproduziu que `--append-verify` pode ignorar um
arquivo remoto do mesmo comprimento mas conteúdo divergente. Para
corrigir **esse caso específico**, o workflow passa a usar
`--checksum --inplace --partial`: compara conteúdo e corrige blocos
mesmo quando o tamanho coincide. O receptor conserva a validação SHA-256
final e bloqueia a ativação se o arquivo não bater.

Isso **não** resolve a baixa banda de SSH nem prova compatibilidade do
receptor restrito com novas flags. Testar uma transferência controlada e
manter o fallback/revisão ativa até validar o fluxo GHCR.

Outro defeito era confundir `/health` indisponível (inclusive 503 ao
parar o App por scale-to-zero) com `main` diferente da VPS. O reconciliador
agora não dispara deploy com base em HTTP falho/sem SHA válido; só
reconcilia quando recebe revisão pública válida e divergente.
A correção **não reconfigura o wake-up**: a rota real do Caddy deve
encaminhar acessos ao componente que inicia o App e aguarda saúde antes
de fazer proxy. Caso o Caddy aponte direto ao App desligado, o site
continuará sujeito a 503. Auditar no host Caddy ativo, wake e política
de parada antes de alterar containers ou regras de produção.


## Transporte HTTPS autenticado (28/10/2026)

Causa confirmada no deploy `40650681576`: testes/build passaram, mas o envio
externo por SSH de ~386 MB ficou em ~30 KB/s, terminando após 24 tentativas.
A revisão ativa continuou `65769cb`; aumentar timeout não corrige o transporte.

O novo fluxo mantém o receptor v2 e a configuração de containers:

1. `plan` verifica contrato v2 e SHA atual; `verify` roda os gates existentes.
2. `build_and_transfer` constrói no GitHub e criptografa a imagem (AES-256-CBC,
   PBKDF2/200.000 iterações, salt aleatório) antes de criar o artefato.
   Um HMAC-SHA256 independente autentica o ciphertext e o contexto
   repositório/run/SHA/serviço. O segredo vem de `SOFTLOAD_VPS_SSH_KEY` com
   separação de domínio; nunca é gravado no artefato, argumento ou log.
   Os artefatos expiram em um dia e contêm somente `image.enc` e `image.mac`.
3. `receive` exige runner sem sudo/grupo Docker, rota local para o endereço da
   VPS e pelo menos 3 GiB livres. O download usa 12 conexões HTTPS limitadas
   a ranges de até 8 MiB, com quatro tentativas por range. Não repete o download
   inteiro quando só um bloco falha. URLs assinadas e tokens não são exibidos.
   A listagem é do mesmo run e exige SHA idêntico. A extração aceita apenas
   os dois nomes esperados; não executa conteúdo do artefato.
4. Todos os HMACs são verificados **antes** de descriptografar/carregar imagens.
   `rsync --checksum --inplace --partial` copia pelo kernel local; `finish`
   verifica SHA-256 e carrega a imagem pelo receptor restrito. Agent sem mudanças
   usa `reuse`. Arquivos temporários/chaves são removidos em `always()`.
5. `activate` depende da entrega dos dois serviços e reconfirma contrato e ponta
   da main. O receptor conserva sua lógica de ativação/rollback. O job só passa
   quando `/health` tem `status=ok` e o SHA **completo** da revisão publicada;
   o bundle público também é validado.

Não há fallback automático para SSH externo, nova credencial, permissão sudo,
Docker socket, mudança do receptor, Caddy, DNS ou softload-wake. GHCR permanece
como otimização futura de camadas, não como pré-requisito deste transporte.

O workflow `Check encrypted HTTPS delivery to VPS` permite testar a rota com
4 MiB aleatórios sem carregar imagens nem alterar containers. Testes offline:
`node --test scripts/artifactDelivery.test.cjs` cobrem corrupção, contexto
incorreto, roundtrip real OpenSSL, ranges, retry, ZIP malformado e path traversal.

Teste real do transporte: execução `40667259154`, runner sem privilégios,
4.194.582 bytes criptografados recebidos em 6,2 segundos (0,65 MiB/s),
com integridade/descriptografia e contrato local v2 aprovados. O teste anterior
de download sequencial levou ~42 s para 4 MiB. Esse teste pequeno não substitui
a confirmação do deploy completo nem mede oficialmente o tráfego da VPS.
