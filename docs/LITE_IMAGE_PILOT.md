# Softload Blogger — imagem leve de produção (etapa App)

A migração do **App** passou do piloto Dockerfile.lite para `Dockerfile` de produção. O produto público usa apenas Node.js, Express, EJS, Bootstrap vendorizado e o compilador procedural Blogger. Não compila React, nem instala Python/Pillow/FFmpeg, nem copia Agent, scripts Forge ou o bundle Vite.

## Isolamento e compatibilidade
- A imagem do **App** usa `Dockerfile.dockerignore`: impede envio de segredos, `.git`, React, `agent/`, `public/dist`, views e rotas Forge. `COPY` seletivos evitam empacotar a árvore inteira do repositório.
- A imagem do **Agent** permanece separada, com seu Dockerfile e testes atuais. O receptor de produção continua `softload-deploy:v2:app,agent`; **não** remover o container Agent nesta etapa.
- Firestore, Firebase Auth, APIs de pagamento e webhook Mercado Pago, geração de XML, histórico/arquivos e variáveis de ambiente atuais permanecem. Não foi apagado nenhum dado de clientes.
- Código de funcionalidades Solaris legadas que só existe em `src/` continua copiado para compatibilidade de módulos; a remoção definitiva exigirá auditoria por contrato.

## Verificações antes de produção
O workflow `lite-image-ci.yml` constrói ambas as imagens (Lite e App real) sem ativar nenhuma e verifica presença de EJS, ausência de Forge/React e renderização da landing. Os gates TypeScript, Blogger, frontend legado, pagamentos e política de storage continuam rodando no GitHub.

O workflow de deploy mantém: handshake do receptor antes de construir e ativar, artefato criptografado, hash SHA, ambas imagens presentes, health do App+Agent, rollback e confirmação de revisão `/health`. A última verificação agora confirma `/` e `/criar` no domínio ao invés do bundle React aposentado.

## Ativação e reversão
Ao mesclar, o workflow da main tentará o deploy. **Só afirmar que o App está em produção depois de ativação e verificação HTTP bem-sucedidas**. Se falhar, preservar o commit anterior e checar os logs; não executar `docker system prune`, apagar volumes, trocar protocolo v2 nem editar .env de clientes.

## Próxima fase — desativar Agent
Exige inventário do `/opt/softload-infra/softload/compose.vps.yaml` instalado na VPS e do receptor `/root/.ssh/authorized_keys`, sem expor chaves nem env. Implementar protocolo App-only com rollback testado, depois parar o Agent e limpar apenas imagens órfãs validadas. Não é parte deste PR.
