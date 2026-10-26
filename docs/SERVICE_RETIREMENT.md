# Descontinuação de serviços: Embeddings e Sandbox (etapa 1)

Decisão: retirar os serviços **softload-embeddings** e **softload-sandbox** para reduzir a ocupação do SSD na VPS. O **softload-agent** e a aplicação principal devem continuar.

## Mudanças nesta etapa (branch de preparação)

- Fontes e Dockerfiles dos servidores `Embedings-python/` e `sandbox-efemoro/` removidos do projeto.
- Pipeline de GitHub Actions passa a criar somente as imagens `softload-app` e `softload-agent`.
- Workflow de integração específico da imagem Sandbox removido.
- Agent não registra nem anuncia `webSandbox` ou `archive`; suas implementações, testes e configuração foram retirados.
- A rota de busca do catálogo agora usa dados JSON e palavras-chave localmente; a busca vetorial de código devolve 503 explícito.

## Bloqueios antes de mesclar/publicar

**Não mesclar esta branch na main antes de atualizar o receptor SSH restrito e a definição de containers da VPS**. O receptor existente valida/carrega quatro serviços e o passo `deploy:<sha>` pode falhar ou manter containers obsoletos se apenas duas imagens forem transmitidas.

1. Confirmar a configuração real do receptor/Compose na VPS e adaptar contrato de ativação/rollback para apenas `app` e `agent`.
2. [Concluído na branch] O protocolo não anuncia operações `websandbox.run` e `archive.extract_zip`; requisições legadas são rejeitadas.
3. Verificar a busca local do RAG com o catálogo JSON existente e checar o impacto da retirada do índice vetorial de código.
4. Garantir testes de integração e de regressão, verificar que `agent` não perde GitHub/MCP/Asset Forge, e realizar deploy escalonado com backup e rollback.
5. Somente após a atualização validada, desativar os containers específicos. Remover imagens antigas **por identificador**, com conferência de referências e volumes, sem limpeza Docker generalizada.
6. Medir antes/depois com `docker system df -v` e `df -h`. **7,60 GB é a soma nominal das imagens**, não economia garantida: camadas compartilhadas e revisões anteriores alteram o saldo final.

Esta branch prepara a remoção **no código**, não garante economia imediata de disco na VPS e não executa nenhuma exclusão de volumes, imagens ou dados de produção.

## Fluxo de projetos pequenos no GitHub

No produto, o caminho preferencial é a integração `solarisGithubAgent` + `solarisGithubOperations`: ler arquivos do repositório autorizado, propor até três arquivos por interação (sem gravar), mostrar a proposta e, com aprovação explícita, abrir branch `solaris/*`, criar commits e PR. O MCP GitHub opcional é somente leitura nesse fluxo de proposta. As operações GitHub do Worker Agent continuam disponíveis, mas suas credenciais/permissões são distintas e não autorizam gravação automática em qualquer repositório.

Rodar builds/testes de sites em runners temporários do GitHub Actions **não exige** navegador residente na VPS. Ferramentas de testes com navegador podem existir no CI; nesta migração removemos apenas os serviços dedicados pesados e a capability remota de navegador do Agent.

## Contrato de compatibilidade do receptor (`contract:v2`)

O workflow verifica **antes do build/transferência** o comando SSH restrito **somente-leitura** `contract:v2`. O receptor migrado precisa imprimir **exatamente** uma linha com:

```
softload-deploy:v2:app,agent
```

Nenhuma chave, segredo, variável de ambiente ou recurso Docker deve ser exposto. O receptor anterior deve rejeitar o comando (falha segura). **Este repositório não contém o arquivo real do receptor/forced-command instalado na VPS**; não alterar a VPS apenas com suposições sobre onde ele mora. O operador deve inspecionar e fazer backup da instalação atual, implementar o contrato v2 em sua cópia autoritativa, garantir staging/rollback só para `app` e `agent` e testar comandos num ambiente controlado antes de liberar produção.

A resposta positiva **não substitui testes** de `finish`, `reuse`, `deploy`, rollback e saúde pública. Só depois disso pode ser mesclada a PR. O handshake evita upload a receptor antigo, não desliga containers ou remove imagens sozinho.

## Base enxuta do Agent

O Dockerfile do Agent muda `node:22-bookworm` para `node:22-bookworm-slim` e usa `apt-get --no-install-recommends`. GitHub/MCP, FFmpeg, runtimes Python/PHP, Git e o Asset Forge continuam presentes. A CI do Asset Forge executa renderizações reais e a construção da imagem. **A economia de disco da mudança ainda precisa ser medida**, sem prometer um valor fixo de GB.

## Verificação manual somente-leitura (sem deploy)

O workflow `.github/workflows/receiver-v2-readonly.yml` só possui `workflow_dispatch` e consulta o receptor SSH restrito com `contract:v2` e `current`, além do endpoint público HTTPS `/health`. Não envia `finish`/`reuse`/`deploy`, não toca no Docker e remove a chave temporária. Permite comprovar quando a instalação real do receptor já estiver migrada, sem publicar imagens.

**O workflow não instala o receptor.** Sua execução também exige a chave do Actions `SOFTLOAD_VPS_SSH_KEY` e que o fluxo esteja acessível no GitHub; os testes em PR verificam a definição sem entrar na VPS.

A sequência segura continua: inventário da versão real do receptor → backup → atualização e validação fora de produção → handshake v2 confirmado → checks da PR → implantação app/agent com rollback → validação externa → desativação e remoção seletiva das imagens antigas. O handshake é verificado uma vez antes do upload e novamente imediatamente antes da ativação.

**Importante:** como o workflow manual novo ainda só está nesta branch, a interface de `workflow_dispatch` pode não disponibilizá-lo até o arquivo existir na branch padrão. A validação **antes de mesclar** deve ser feita por um operador que já possua a chave SSH restrita, consultando `ssh ... 'contract:v2'` e `ssh ... 'current'`, sem executar `deploy`/`finish`/`reuse`. Após o merge, o workflow manual oferece uma segunda conferência independente. Não criar um commit isolado na `main` apenas para habilitar a UI, porque isso aciona o deploy automático existente.
