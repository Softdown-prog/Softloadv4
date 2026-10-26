# Descontinuação de serviços: Embeddings e Sandbox (etapa 1)

Decisão: retirar os serviços **softload-embeddings** e **softload-sandbox** para reduzir a ocupação do SSD na VPS. O **softload-agent** e a aplicação principal devem continuar.

## Mudanças nesta etapa (branch de preparação)

- Fontes e Dockerfiles dos servidores `Embedings-python/` e `sandbox-efemoro/` removidos do projeto.
- Pipeline de GitHub Actions passa a criar somente as imagens `softload-app` e `softload-agent`.
- Workflow de integração específico da imagem Sandbox removido.
- Agent não registra mais as capabilities webSandbox e archive; clientes legados permanecem no repositório para testes/migração, sem exposição no worker padrão.
- A rota de busca do catálogo agora usa dados JSON e palavras-chave localmente; a busca vetorial de código devolve 503 explícito.

## Bloqueios antes de mesclar/publicar

**Não mesclar esta branch na main antes de atualizar o receptor SSH restrito e a definição de containers da VPS**. O receptor existente valida/carrega quatro serviços e o passo `deploy:<sha>` pode falhar ou manter containers obsoletos se apenas duas imagens forem transmitidas.

1. Confirmar a configuração real do receptor/Compose na VPS e adaptar contrato de ativação/rollback para apenas `app` e `agent`.
2. Revisar os esquemas/declarações do protocolo para não anunciar as operações legadas `websandbox.run` e `archive.extract_zip`. O Agent padrão já não as instancia e responde falha segura.
3. Verificar a busca local do RAG com o catálogo JSON existente e checar o impacto da retirada do índice vetorial de código.
4. Garantir testes de integração e de regressão, verificar que `agent` não perde GitHub/MCP/Asset Forge, e realizar deploy escalonado com backup e rollback.
5. Somente após a atualização validada, desativar os containers específicos. Remover imagens antigas **por identificador**, com conferência de referências e volumes, sem limpeza Docker generalizada.
6. Medir antes/depois com `docker system df -v` e `df -h`. **7,60 GB é a soma nominal das imagens**, não economia garantida: camadas compartilhadas e revisões anteriores alteram o saldo final.

Esta branch prepara a remoção **no código**, não garante economia imediata de disco na VPS e não executa nenhuma exclusão de volumes, imagens ou dados de produção.
