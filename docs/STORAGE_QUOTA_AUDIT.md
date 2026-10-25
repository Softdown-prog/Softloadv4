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
