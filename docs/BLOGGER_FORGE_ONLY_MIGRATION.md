# Softload enxuta — Blogger + A7 Forge 2D

## Nova política de produto (29/10/2026)
- Experiência nova EJS e JavaScript; sem IA, sem React nem chats.
- Somente Blogger XML e A7 Forge procedural; preservar autenticação Firebase, Firestore e Mercado Pago.
- Grátis: 2 downloads XML por conta; armazenamento de 5 MiB.
- Essencial: R$5 por 30 dias completos, XML ilimitado com proteção antiabuso e armazenamento de 50 MiB.
- Downloads diretos de XML não ocupam armazenamento.
- Avisar cinco dias ANTES do vencimento. Ao vencer, bloquear novas gravações pagas.
- Permitir recuperar/baixar dados durante cinco dias APÓS o vencimento. Só então poderão ser removidos arquivos novos sob a política aceita.
- Arquivos históricos de outros planos, dados cadastrais, recibos e documentos obrigatórios não são elegíveis à limpeza automática.

## Segurança para exclusões futuras
1. Registrar aceite explícito com data e versão da política no checkout.
2. Objetos do novo armazenamento vão em users/<uid>/essential-v1/; não misturar arquivos legados.
3. Só considerar exclusão se essencial_storage_migrado=true após inventário, exportação e testes.
4. Job começa em dry-run, lista candidatos e objetos, verifica vencimento no Firestore no momento da ação, contempla renovação concorrente e bloqueios legais.
5. Antes de habilitar exclusões, validar notificações, exportação do usuário, renovação, reembolso e idempotência.
6. Não remover recibos, autenticação e logs necessários por lei; nem excluir buckets/volumes globais.
7. Mudança de contratos existentes requer aviso e revisão jurídica. Nenhuma limpeza real está habilitada por este arquivo.

## Redução de peso da VPS
O Dockerfile atual ainda compila React e o Agent; para reduzir disco, migrar para uma imagem App somente com compilador Blogger, A7 Forge 2D, Firestore Auth, Mercado Pago e páginas EJS.
- Retirar da imagem nova: Gemini/OpenAI, Solaris, chat, RAG, embeddings, Worker Agent, browser/sandbox, Playwright, Vite, React.
- Manter Python/Pillow e ffmpeg apenas para receitas Forge que usarem áudio.
- Atualizar CI, compose, receptor de deploy, healthcheck e rollback antes de parar a imagem Agent.
- Medir docker system df -v e liberar antigas imagens só após validar uma revisão recuperável; nunca usar prune global com volumes.

Este PR abre a migração de código e políticas, sem alterar dados reais de usuários.
