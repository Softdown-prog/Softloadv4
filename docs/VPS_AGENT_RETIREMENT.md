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
