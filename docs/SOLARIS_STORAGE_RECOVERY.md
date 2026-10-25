# Solaris — recuperação de falhas parciais no armazenamento (Etapa 72)

## Objetivo
Evitar excluir a geração ativa no GCS quando uma requisição perdeu o ACK
de publicação do manifesto. A gravação GCS e o rastreamento/cota Firestore
não são uma transação distribuída.

## Publicação do manifesto
Após tentar salvar o manifesto, uma falha é tratada como resultado incerto.
Antes do rollback, a rotina relê o manifesto: se ele aponta para a versão
recém-escrita, considera a publicação confirmada e mantém os dados e a
cota, prosseguindo com a limpeza da geração anterior.

Se a leitura falhar por indisponibilidade, não apaga arquivos staged nem
libera a cota: preservar uma versão possivelmente publicada é prioritário.
A operação reporta o erro original e registra aviso para reconciliação
administrativa. Se o manifesto ainda aponta para a versão anterior, aplica
o rollback da geração nova e restabelece o rastreamento quando possível.

## Firestore e exclusão
Se o set() de rastreamento tiver gravado antes de perder o ACK, a
restauração do tracking anterior é tentada mesmo assim. Se essa
restauração falhar, a rotina mantém arquivos e cota para inspeção, em
vez de promover mais mudanças destrutivas.

A exclusão de projeto não silencia mais erros ao remover o documento de
rastreamento: em caso de falha, não libera a cota. Uma repetição segura
pode excluir o documento e, então, creditar o armazenamento liberado.

## Testes isolados
Simular:
- upload com manifesto gravado e ACK perdido
- set() do Firestore gravado e ACK perdido
- indisponibilidade na leitura de verificação do GCS
- delete() do Firestore falhando antes de remover o tracking

Todos os testes usam dublês de GCS e Firestore. Nenhum deles acessa
recursos reais.

## Limitações e operação
Persistência, cota e limpeza continuam sujeitas a falhas entre serviços
e encerramentos abruptos de processo. Reconciliação manual pode ser
necessária, especialmente se a operação for interrompida após
confirmarUso(), se liberarCota() perder o ACK, ou se exclusões parciais
de blobs ocorrerem. Não executar scripts de correção de cotas sem
verificar o manifesto atual, os rastreamentos e a existência dos blobs.

## Etapa 73 — recibos idempotentes e transações de cota

O `storageService` mantém compatibilidade com chamadas antigas sem chave,
mas passou a aceitar um `operacaoId` opcional na reserva/confirmacao e
liberacao de cota. Cada operacao com ID grava recibo em
`storage_cota_operacoes` e altera `clientes_premium.storage_usado_mb`
**na mesma transacao Firestore**. Na repeticao, a operacao nao repete
o incremento/decremento. Recibo repetido com valor diferente falha.
O debito revalida os limites do plano dentro da transacao.

No Solaris, cada nova geracao versionada recebe ID de debito proprio.
Estornos de rollback, substituicoes e exclusoes usam IDs distintos
e estaveis. A exclusao agora credita e remove o rastreamento numa unica
transacao; a substituicao credita a geracao anterior e ajusta o
rastreamento na mesma transacao. Erros de ACK podem ser repetidos sem
creditar a mesma operacao duas vezes.

IMPORTANTE: nao aplicar TTL aos recibos sem uma politica comprovadamente
segura; apagar o recibo permite reaplicar operacoes antigas. O historico
de saldos deve ser auditado e eventualmente reconciliado pela contagem
dos objetos reais do GCS. Reservas/compensacoes que falham entre servicos
ainda podem exigir reparacao — recibos idempotentes nao transformam GCS
+ Firestore numa transacao distribuida.

Testes simulam ACK perdido, repeated debit/credit, alteracao de tracking
na mesma transacao, limite do plano e reuso indevido de ID. Testes nao
acessam Firestore de producao.
