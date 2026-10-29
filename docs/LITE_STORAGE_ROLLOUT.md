# Softload Lite — arquivos pessoais (piloto 5/50 MB)

## Estado
A rota foi implementada em PR #93, mas **`SOFTLOAD_LITE_FILES_ENABLED` vem desativada**.
Não há job de exclusão automática, e nenhum volume, arquivo histórico ou conta é removido.
Este documento é um checklist de liberação, não uma autorização para ativar em produção.

## Contrato do usuário
- Gratuito: até **5 MiB** na mesma cota de `storage_usado_mb` de uploads anteriores.
- Essencial pago e ativo com aceite registrado: até **50 MiB**. Arquivos novos do plano são identificados como `essential-v1`.
- Por upload: até **5 MiB** nesta primeira versão, mesmo para quem tem cota total de 50 MiB. Isso preserva RAM da VPS.
- O download do arquivo pago continua disponível durante o pagamento e até **5 dias depois** do vencimento para recuperação. Se houver renovação, acesso restaurado.
- Após o prazo de recuperação, os arquivos novos ficam inacessíveis até que um processo de eliminação auditado seja habilitado. **Este PR não os apaga**.
- Objetos antigos fora de `users/{uid}/lite-v1/` não são afetados.

## Dados e processamento
- Login e sessão Firebase; CSRF por sessão, checagem de origem e limite de requisições.
- Arquivos permitidos: XML, PNG, JPG/JPEG, WebP, GIF, JSON e ZIP, sempre baixados como anexo binário, sem renderização HTML.
- Objetos GCS com nome aleatório `users/{uid}/lite-v1/{UUID}`; nome escolhido pelo usuário existe apenas no manifesto Firestore, não no caminho físico.
- Manifesto `clientes_premium/{email}/lite_files/{UUID}` com estados `uploading`, `ready` e `deleting`.
- Reserva transacional de `lite_storage_pendente_bytes`; após upload real, saldar `storage_usado_mb` e liberar reserva em uma transação.
- Em falha, o sistema tenta liberar a reserva e remover o objeto. Erros ambíguos de GCS/Firestore devem ser auditados antes de qualquer limpeza automática.
- Exclusão manual remove apenas objeto com UUID e UID do usuário, nunca `users/{uid}/` inteiro.

## Antes de ativar a flag
1. Confirmar que o **bucket GCS não é público** (IAM/ACL, uniform bucket-level access e Public Access Prevention). O código não cria políticas IAM.
2. Confirmar credenciais do App e o bucket real, quotas operacionais e observabilidade de cobranças GCS/Firestore.
3. Homologar em conta gratuita com 4,9 MiB e rejeição acima de 5 MiB; Essencial ativo com 49–50 MiB; plano vencido; recontratação; dois uploads concorrentes; interrupção GCS; exclusão repetida; origem/CSRF inválidos.
4. Criar ferramenta **somente leitura** de reconciliação de `lite_files`, objetos `lite-v1`, reservas `lite_storage_pendente_bytes` e `storage_usado_mb`. Não ajustar contadores automaticamente com base em listagens sem conciliação.
5. Criar aviso com pelo menos 5 dias de antecedência, possibilidade de exportação e job de expiração com `dry-run`, validação de retenção legal e escopo exclusivo de novos arquivos `essential-v1`. Não apagar registros fiscais, contas, pagamentos ou arquivos legados.
6. Rever termos de uso e política de privacidade; conferir backups, logs e reversão do deploy.
7. Ativar a flag em homologação; somente depois, avaliar produção.

## Reversão imediata
Desativar `SOFTLOAD_LITE_FILES_ENABLED` e publicar a configuração. Isso bloqueia novas gravações, mas **não remove objetos existentes**. Retomar após investigar, sem executar `docker system prune`, limpar buckets ou zerar coleções.
