# Auditoria Softload Blogger: Mercado Pago e resíduos legados (29/10/2026)

## Produto atual
A oferta pública é **compilador procedural de temas XML para Blogger**, cadastro opcional para experimentar, conta para gestão de limites e pagamento avulso **Essencial, R$ 5 por 30 dias**, liberado apenas com `BLOGGER_ESSENCIAL_CHECKOUT_ENABLED=true`. Sem oferta de novos planos de IA.

## Confirmado na revisão de código
- `src/routes/apiRoutes.ts/.js` contém Checkout Pro (preferências), Bricks, webhook e validação HMAC. O webhook consulta o pagamento no SDK e usa recibos Firestore em transação para evitar dupla ativação.
- A tabela histórica `mpPlanRules` reconhece valores dos planos antigos, para conciliar pagamentos feitos antes da mudança. A presença desses valores **não** autoriza novas vendas.
- A regra de storage Essencial mantém 50 MB pagos e 5 MB gratuitos; apagamento automático de arquivos do novo escopo só pode ser executado após consentimento/migração (não foi executado nesta auditoria).
- `views/pages/plano-essencial.ejs` é a página utilizada pelo dashboard. `views/pages/upgrade.ejs` é uma view antiga de IA, mas não é mais a view das rotas `/dashboard/upgrade` e `/dashboard/plano-essencial`.

## Riscos encontrados e mitigação deste PR
1. **Venda antiga ainda possível:** dois endpoints aceitavam novas cobranças Starter/Pro/Studio apesar do produto descontinuado. Ambos agora retornam 410; o webhook mantém compatibilidade de recebimentos históricos.
2. **Conta fantasma / cobrança antes de persistir:** Checkout Pro criava `clientes_premium/{email}` via upsert mesmo que a conta real estivesse em documento de UID; Bricks ignorava erro do Firestore. Agora ambos localizam e confirmam a conta/UID e falham antes de criar preferência ou pagamento.
3. **Assinatura de webhook insuficiente no staging e divergência de ID:** staging aceitava falta de segredo, e havia risco de validar ID da query e consultar ID diferente do body. Agora exige segredo/HMAC em todos os ambientes e consulta somente o ID assinado (com verificação query/body).
4. **Renovação cortava dias já pagos:** nova aprovação sobrescrevia o vencimento com hoje+30. Para uma conta Essencial vigente, agora soma 30 dias ao vencimento atual dentro da transação.
5. **Aprovação sem cadastro era confirmada sem concessão:** sem usuário, o webhook dava HTTP 200. Agora devolve 503 para preservar o retry, exigindo investigação de conta.
6. **Interface induzia clique durante homologação:** agora botão só aparece quando a flag de checkout estiver ativa, e a tela informa quando a compra não está liberada.
7. **Erro do SDK exposto ao comprador:** mensagem retornada agora é genérica, mantendo o motivo técnico apenas no log do servidor.

## Resíduos de escopo antigo ainda presentes no repositório (não vendáveis após este PR)
- `frontend/` mantém React, páginas antigas de chat, Solaris e planos por compatibilidade de CI/migração, mas **não faz parte do Dockerfile de App Blogger**.
- `views/pages/upgrade.ejs` e `views/pages/react-landing.ejs` preservam páginas antigas não usadas pelo fluxo EJS principal; precisam de exclusão controlada, após auditoria de referências e testes.
- `src/routes/apiRoutes.*` ainda registra APIs internas do Solaris/RAG e métricas do painel React antigo. Elas devem ser isoladas e desativadas em fase dedicada; remover agora sem inventário do Agent pode quebrar o protocolo atual `app,agent`.
- `agent/` e `agent/Dockerfile` ainda fazem parte do receptor de deploy da VPS, embora não existam no contêiner App de produção. A exclusão exige migração coordenada do receiver/Compose, com rollback.
- Tabelas `PLAN_CREDITS` e preços anteriores continuam apenas para reconhecer/preservar recibos e clientes legados. Não destruir registros anteriores.

## Pendências de homologação — não declarar cobrança real validada
- Não foi possível conferir as credenciais, status da aplicação MP, configuração de assinatura no painel do Mercado Pago, `notification_url` registrada, nem executar compra Pix/Checkout Pro ponta a ponta com credenciais de teste. Esses pontos exigem teste no ambiente externo e conta de comerciante.
- **Correção proposta no PR #102:** novas tentativas usam `softload_mp_intents/<UUID>` e `external_reference=slb:<UUID>`, vinculados ao UID, plano, preço e aceite de armazenamento. A aprovação e o recibo são transacionais; duas compras distintas podem somar 30 dias cada sem sobrescrever o estado uma da outra. Pagamentos legados que referenciam email continuam usando `plano_pendente` para compatibilidade e conciliação.
- O pós-pagamento precisa de homologação end-to-end: simular retry e duplicata do webhook, falha de banco, reconciliação manual, estorno/chargeback, e checar conta com ID histórico (UID).
- Não editar dados dos clientes, não iniciar cobrança real, não habilitar checkout automaticamente, não executar deleção de arquivos e não remover volumes nesta etapa.

### Plano recomendado
Aprovar testes de intents independentes no GitHub, homologar MP em ambiente de teste e verificar a conciliação; só depois habilitar o Essencial manualmente, monitorar os primeiros pedidos e só então retirar módulos antigos do Agent e APIs Solaris em PR próprio.

### Endurecimento posterior ao PR #102 — Bricks
- Cada chamada Bricks usa o UUID da intenção já persistida como `requestOptions.idempotencyKey` ao enviar `Payment.create` ao SDK Mercado Pago. Assim, repetições **da mesma operação no SDK** usam a chave vinculada à intenção, sem depender da geração automática.
- **Limite atual:** um novo POST ao checkout cria uma nova intenção e nova chave. Não afirmar deduplicação de solicitações HTTP distintas; isso exigirá fluxo de reuso controlado da intenção sem reutilizar cartão/token ou liberar cobranças indevidas.
- A alteração é apenas de código/testes; a flag `BLOGGER_ESSENCIAL_CHECKOUT_ENABLED` permanece desligada até a homologação externa.

### Próxima etapa — registro de estornos e contestações (PR posterior ao #103)
- O webhook valida HMAC e consulta `Payment.get` antes de tratar `refunded`, `charged_back`, `in_mediation` ou `approved/partially_refunded`.
- O estado é registrado de forma idempotente em `softload_mp_reconciliations/<paymentId>`, com `status`, `status_detail`, presença de recibo, timestamps e marcador de revisão manual. Quando o status muda, o mesmo registro é atualizado; notificações idênticas não reescrevem o registro.
- O registro **não** aciona reembolso, **não** modifica assinatura, créditos, sessões nem arquivos do usuário. Desfazer automaticamente 30 dias é inseguro quando existem múltiplas compras. A conciliação e eventual ajuste de dias continuam como procedimento manual a definir.
- Falha de persistência retorna HTTP 500 para possibilitar retry. Testes usam SDK e Firestore simulados, sem credenciais nem cobranças.
- Ainda falta homologação com pagamentos MP de teste, visualização administrativa de casos, reconciliação de reembolsos parciais e procedimento de encerramento da revisão.
