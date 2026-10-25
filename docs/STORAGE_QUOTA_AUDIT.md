# Auditoria de cota de armazenamento — Etapa 74

Revisão de chamadas de `reservarCota`, `confirmarUso` e `liberarCota` na Softload V4.

## Resultados e decisões

| Fluxo | Estado encontrado | Ação |
| --- | --- | --- |
| Solaris Code — projetos GCS | Débito e créditos já utilizam recibos Firestore por operação e `versao` | Preservado e testado na etapa 73 |
| Pipeline Blogger — compilação ZIP/manifesto | Reservava antecipadamente, mas confirmava sem chave estável, permitindo incremento duplicado numa repetição da confirmação | **Corrigido na etapa 74** com `blogger-compilation:{idDoDocumento}` |
| Histórico de chat — `saveSession` | Regrava o mesmo JSON de sessão mais `latest.json` e `_index.json`, porém soma o tamanho completo a cada atualização | **Pendente**: contabilizar saldo líquido com tracking do tamanho antigo e serializar gravações concorrentes |
| Memória de chat — `saveMemory` | Regrava `context.json` inteiro e debita o tamanho total repetidamente | **Pendente**: calcular e transacionar diferença do tamanho armazenado |
| Exclusão de sessão — `deleteSession` | Apaga arquivos e altera índice, mas não libera a cota relacionada | **Pendente**: combinar rastreamento, exclusão GCS e crédito idempotente |
| Exclusão global — `deletarTodosArquivos` | Exclui `users/{uid}/` sem reconciliar o saldo armazenado | **Pendente**: processo separado, inclusive para dados legados |

## Correção de baixo risco feita na etapa 74

A reserva inicial das compilações Blogger mantém a checagem antecipada
dos limites atuais (`free`, `starter`, `pro` etc.).
Quando `salvarCompilacao` termina e o documento de histórico já foi criado,
`finalizarCompilacao` passa a chave estável
`blogger-compilation:{docRef.id}` para `confirmarUso`.

O serviço `storageService` aceita agora uma chave *opcional* na confirmação,
além da chave já aceita na reserva. Se houver chave, usa o recibo e
`runTransaction` da etapa 73. Se não houver chave, preserva
o comportamento legado dos outros chamadores.

A mesma confirmação repetida para o mesmo documento não cobra duas vezes,
inclusive quando o commit ocorreu, mas o ACK foi perdido. Compilações
efetivamente distintas criam documentos de histórico distintos e continuam
gerando seus próprios débitos. A chave **não** torna a operação completa de
criação de ZIP/documento idempotente: repetir toda a requisição pode criar
novos artefatos e uma nova cobrança de armazenamento.

## Próximo endurecimento, sem ajustes destrutivos nesta etapa

A contagem correta para chats deve refletir o delta entre o tamanho anterior
e o novo conteúdo realmente persistido, com exclusão mútua distribuída por
usuário/prefixo, transações idempotentes e tratamento de falha após escrita.
Não descontar bytes sem confirmação de que o objeto anterior foi removido,
nem usar a simples diferença do arquivo lido sem proteção contra gravações
concorrentes. Testar perda de ACK, atualização concorrente, apagamento e
migração de contagens legadas antes de alterar cota de usuários existentes.

Nenhum teste desta auditoria acessa GCS ou Firestore reais.


## Etapa 75 — cobrança incremental de sessões e memória de chat

Os fluxos `saveSession` e `saveMemory` passam a cobrar **somente a variação de
bytes** em cada arquivo sobrescrito no GCS. Para cada objeto, uma entrada em
`storage_cota_arquivos` registra o último tamanho contabilizado. A transação
Firestore atualiza o registro e `clientes_premium.storage_usado_mb` na mesma
operação. Uma resposta de commit perdida seguida de repetição com os mesmos
arquivos não aplica a diferença uma segunda vez.

A primeira regravação de arquivo legado sem entrada no registro toma o tamanho
anterior efetivamente lido do GCS como referência. **Não recalcula nem corrige
automaticamente o saldo histórico** (que pode conter excesso devido a versões
anteriores); uma reconciliação global exigiria auditoria de todos os objetos.

O registro das sessões é serializado pela chave `uid + tipoDeChat` na
coleção `chat_storage_bloqueios`. O da memória usa `uid + memory`.
`DocumentReference.create()` impede escritores paralelos mesmo entre VPSs.
O bloqueio é liberado com precondição de versão e dono; bloqueios órfãos não
são removidos automaticamente. Operações que encontram um lock ativo tentam
brevemente novamente e depois retornam `CHAT_STORAGE_BUSY`.

As operações de GCS são verificadas por leitura exata quando a confirmação de
escrita é perdida; para as três peças da sessão, todas as gravações terminam
antes de liberar o lock. A operação de cota faz pré-verificação e conferência
transacional posterior. `updateMemoryFromSession` passou a calcular contadores
dentro do lock para não perder a atualização de duas sessões simultâneas.

### Pendências deliberadas

- `deleteSession` ainda não aceita cota e não credita arquivos excluídos.
- Entradas e saldos legados anteriormente inflados requerem relatório de
  reconciliação antes de qualquer correção retroativa.
- Falhas definitivas entre upload de GCS e transação Firestore podem deixar
  diferenças pendentes. Não há transação distribuída entre GCS e Firestore.
- Chamadas legadas sem `cota` preservam comportamento anterior e não participam
  do bloqueio/contabilização.
- Rotinas de operação precisam monitorar `chat_storage_bloqueios` órfãos;
  não habilitar TTL automático para essa coleção sem fencing de escritores.

Os testes simulam regravações, variação negativa de tamanho, sessões distintas,
atualizações paralelas de memória, perda de ACK e falha do GCS. Nenhum teste toca
armazenamento ou Firestore reais.


## Etapa 76 — exclusão de sessões e devolução de cota

A exclusão de sessões dos endpoints `DELETE /api/chat/sessions/:sessionId`
e `DELETE /eu/api/sol/sessions/:sessionId` agora recebe o mesmo contexto
`{email, plano}` utilizado no salvamento.

Para chamadas com cota, `deleteSession` obtém o lock
`chat_storage_bloqueios` do tipo de sessão, observa os bytes de três
objetos (sessão, `_index.json`, `latest.json`), exclui a sessão, regrava
o índice somente quando ele realmente mudou e remove `latest.json` apenas
se a referência apontava para a sessão excluída.

A devolução de espaço **não é presumida**: as operações de GCS são
aguardadas com `Promise.allSettled` e os bytes atuais são relidos antes
da transação de cota. O mesmo registro `storage_cota_arquivos` da etapa
75 é atualizado atomicamente com `storage_usado_mb`. Se uma operação
falhar depois de excluir parte dos objetos, a devolução só abrange o que
foi realmente removido e o erro original continua visível para permitir
repetir a exclusão restante.

Ao solicitar `apenasCreditosRastreados`, arquivos legados que não tinham
registro em `storage_cota_arquivos` não geram créditos negativos com base
apenas no tamanho antigo. Essa proteção evita reduzir indevidamente um
saldo que pode ter sido inflado antes da etapa 75. Uma regravação que
aumentar um arquivo não rastreado ainda pode debitar apenas o acréscimo,
seguindo a política de compatibilidade da etapa 75.

Se um delete() concluir mas perder o ACK, uma leitura 404 confirma que o
objeto já desapareceu. Exclusões repetidas devolvem **zero bytes adicionais**
porque a transação já registrou o novo tamanho. A variante sem `cota`
permanece disponível para chamadores legados, mas não realiza devolução.

### Limites

- Arquivos legados sem tracker exigem reconciliação auditada para corrigir
  saldos antigos; nunca calcular créditos retroativos apenas por exclusões.
- A primeira falha de leitura GCS depois de uma exclusão pode impedir a
  reconciliação imediata. Repetir a operação com GCS disponível a completa.
- GCS e Firestore não oferecem transação distribuída. Nunca remover a
  coleção de rastreamento, ou aplicar TTL automático, sem política de
  reconciliação e idempotência.
- O histórico dos projetos Solaris anexados é removido por rotina
  independente (`apagarProjeto`), já protegida por recibos de cota.

Os testes usam GCS/Firestore simulados e cobrem latest/índice, sessões
antigas, exclusão repetida, erro parcial, ACK perdido, saldo legado e
compatibilidade sem cota.
