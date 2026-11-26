# Pagamentos

A oferta atual é Essencial: R$ 5 por 30 dias, sem renovação automática. Checkout Pro e Bricks exigem sessão, UID correspondente à conta e aceite da política de armazenamento. Novas compras usam intenções imutáveis, independentes por tentativa, com preço definido no servidor.

O webhook `/webhook/mercado-pago` exige assinatura HMAC, consulta o pagamento no Mercado Pago e confirma BRL, valor e vínculo. Recibo e ativação são transacionados no Firestore; notificações repetidas não duplicam dias. Renovação Essencial soma 30 dias ao vencimento válido.

Compras de planos anteriores já iniciadas continuam conciliáveis por `plano_pendente`, sem venda de novas cotas de IA nem alteração de seus campos históricos. Recibos, intenções e registros financeiros não são apagados. Estornos, mediação e chargebacks são registrados para conciliação manual, sem ativação automática.

O flag `BLOGGER_ESSENCIAL_CHECKOUT_ENABLED` preserva o gate de liberação existente. Os testes usam SDK e banco simulados; não emitem cobranças reais.

## Recuperação de pagamento em /eu

O superadministrador pode informar o e-mail da conta e o ID de um pagamento
aprovado no Mercado Pago. A API consulta o pagamento no provedor e confere a
intenção do Essencial, o valor, a moeda e a conta antes de liberar o acesso.
Recuperação e webhook compartilham o recibo no Firestore, então outro envio
do mesmo pagamento informa que ele já foi processado. A recuperação gravada
aparece no log administrativo com o operador, a conta e o vencimento.

A ação **Conceder Essencial** em Usuários continua disponível para conceder
acesso por 30 dias sem vincular uma compra. Para resolver uma compra confirmada,
use **Recuperar pagamento**.
