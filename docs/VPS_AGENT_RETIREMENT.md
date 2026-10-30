# Retirada operacional do Agent

A aplicação publicada em `5c11ac1` já executa somente o produto Blogger. O PR
#118 retira fontes legadas, mas sua revisão inicial ainda usa o protocolo de
transporte v2 e declara a migração da VPS como pendente. A retirada do container
não pode depender de apagar apenas uma linha na interface do Painel.

## Configuração por projeto

O administrador configura `SOFTLOAD_AGENT_RETIRED=1` no `.env` privado da Softload
e no ambiente do gateway **deste projeto**. O Painel genérico não depende desse
arquivo, do Agent, das redes internas desse projeto nem do seu gateway.

Com o sinalizador:

- O Compose instalado mantém somente `app`, sem dependência de Agent, Sandbox ou
  Embeddings. Credenciais antigas e o volume de workspace são preservados.
- O receptor exige imagem e saúde apenas de `app`, inclusive na reversão de uma
  ativação malsucedida. Não ativa serviços opcionais ou de outros projetos.
- O gateway inicia, aguarda e suspende somente `app`; a ausência do Agent não
  provoca 503. O transformador `retire_agent_gateway.py` recusa código inesperado
  e é idempotente; sua aplicação exige validação/instalação administrativa.
- `contract:v2` continua aceitando o transporte legado para não quebrar workflows
  em trânsito. `reuse:agent:<sha>` não cria tags nem exige imagem. Se um workflow
  antigo enviar um pacote Agent, `finish` confere o checksum e descarta o pacote
  sem importar sua imagem. Isso não inventa um Agent em execução.
- `contract:v3` informa `softload-deploy:v3:app`, permitindo ao workflow futuro
  negociar transporte somente App. Ainda pode haver tráfego de um workflow antigo
  que resolva construir Agent; ele não reinstala esse serviço no host.

Sem o sinalizador, o comportamento legado App+Agent continua disponível. O
sinalizador é configuração local de root, não um parâmetro do navegador/modelo
ou do comando SSH recebido.

## Instalação segura

1. Registrar disco, IDs, volumes, saúde, SHA e configuração atual. Não fazer limpeza
   durante deploy/transferência ou quando a aplicação está com falha.
2. Preparar imagem de gateway, Compose efetivo e receptor. Rodar testes Linux,
   `bash -n` e `node --check` antes de qualquer substituição.
3. Sob a trava do deploy, conferir hashes e ociosidade, instalar atomicamente e
   ativar somente o gateway do projeto. Não executar `compose up` global.
4. Parar somente Agent; testar o proxy e controle com App já saudável e Agent
   parado. Se falhar, restaurar sua execução e investigar antes de apagar imagem.
5. Remover o container sem `-v` e sem força. Preservar o workspace e todos os dados.
6. Conferir referências por todos os containers e remover somente IDs de imagens
   realmente sem uso. Não apagar diretórios do containerd nem executar prune de
   volumes. Medir economia por `df`, não somando tamanhos lógicos compartilhados.

O App em execução não precisa ser recriado durante a limpeza: a nova definição
de ambiente/montagens passa a valer no próximo deploy normal. Não afirmar que
o container atual recebeu essas alterações sem conferir sua revisão efetiva.

## Testes

`test_receiver_retention.py` cobre os dois modos, autenticação de pacotes por
checksum, trava de transferência, ausência de operações Agent no deploy e
reversão após falha de saúde sem Agent. `test_retire_agent_gateway.py` executa
Node real com um adaptador Docker simulado: início/parada somente App, ordem
legada, recusa de fonte inesperada e transformação idempotente. Esses testes
não param aplicações de produção para simular inatividade.

## Resultado real na VPS — 30/10/2026

Instalado pelo acesso administrativo independente, sem modificar a refatoração
do PR #118 e sem mesclar código com CI falhando. Fontes desta correção no commit
`04f017bf8e8cb374de7fa8412258d40c5e988409`, PR #119. Seus checks TypeScript/Blogger,
Worker legado e testes operacionais passaram. O código de produto em execução
permaneceu `5c11ac1cdbba35731e80a3c7cddbdb5b491bc56a`.

O container `softload-vps-agent-1` foi parado e removido sem apagar volumes.
Receptor, Compose e gateway do projeto foram adaptados antes disso. O gateway
instalado usa `softload-wake:agent-retired-20261030`; apenas ele foi recriado.
App, Painel, Terrania e Caddy conservaram IDs, imagens e horários de início na
janela da operação. Os cinco volumes foram preservados; o workspace antigo
ficou sem container associado, contendo seus dados.

| Medição física | Inicial, antes dos preparativos | Final |
| --- | ---: | ---: |
| Raiz usada, bytes | 9.691.713.536 | 6.525.890.560 |
| Raiz disponível, bytes | 45.377.929.216 | 48.543.752.192 |
| Containers | 10 | 9 |
| Imagens únicas / usadas | 12 / 10 | 9 / 9 |

**Economia líquida: 3.165.822.976 bytes (3,17 GB / 2,95 GiB).** A preparação da
nova imagem elevou temporariamente a raiz usada para 9.876.058.112 bytes. A etapa
final de limpeza liberou 3.350.167.552 bytes a partir desse pico; não apresentar
esse número como economia líquida desde a chegada. Tamanhos de imagens e caches
compartilham camadas, portanto não somar seus valores lógicos à diferença do `df`.

O containerd ficou em 1.707.606.016 bytes, as nove imagens ativas somam 1,692 GB
lógicos e o cache BuildKit ficou em zero. Os índices regeneráveis do APT liberaram
129.429.504 bytes alocados; não foram removidos pacotes instalados do Ubuntu.
O SO, o runner ativo e os arquivos operacionais continuam necessários.

Imagens removidas após conferir ausência de referências em todos os containers,
inclusive parados, sem força:

- Agent: `sha256:dbbe7121b8e30426dcafa35974eeb4c3e2af4d18a5774b4ae46d948cd7be18ef`.
- API anterior do Painel: `sha256:01646d1af0835e6eebf3e60e48028c2aaee7b26c990fa53315b2320cc720209d`.
- Executor anterior: `sha256:7b619789a67043f67e356149c202ef516e2e8614f511bec708f9da3ccf8f8267`.
- Gateway anterior do projeto: `sha256:f8fe0b9476597d37aa3dfe4e156c688b483f022159608cb6acaba9bded1447e9`.

Isso encerra a disponibilidade local das imagens antigas de reversão do Painel.
A recuperação de código é por reconstrução da revisão no GitHub; configurações,
contas, chaves e volumes não foram apagados. Não foi usado prune de imagens,
sistema ou volumes; somente cache de build ocioso foi limpo, com ausência de
builds/deploys verificada. Os temporários desta instalação foram removidos.

Validação real com Agent ausente: controle `start` do gateway aprovado, proxy
`/health` HTTP 200 com SHA correto, contrato v3 somente App e `reuse:agent` legado
sem exigir imagem. O deploy completo e a falha/reversão foram testados fora de
produção (11 testes de receptor); início/parada sem Agent em quatro testes Node,
além de sete testes de staging. O App atual não foi recriado para simular deploy.

Checksums instalados:

- Receptor: `1aa507868f294f06a71f3a84a970e3a884bae9177fe416115c73677831dcaa71`.
- Fonte do gateway: `3953713071ed94662ecbd0d9d469691392988b0bbade2176999cf1b0736c337c`.
