# Solaris Worker — evidências e limites (issue #65)

Base auditada: `9ac2424` da main, 28/10/2026. Esta etapa não instala nada na VPS.

## Matriz viva

Todos os caminhos abaixo passam pelo protocolo HTTP e por Permissions; `full`
ignora o mapa granular. A coluna chat descreve o fluxo realmente conectado.

| Capability | Implementação e perfil | Chat real / frontend | Dependência e custo |
| --- | --- | --- | --- |
| filesystem | real; leitura/escrita restritas ao root; delete negado | editor do App usa suas próprias funções, não este Worker | disco; symlinks verificados; um root por Agent, sem tenant HTTP |
| shell | real, negada no perfil restrito | sem ligação | processos locais; allowlist não isola código de build |
| git | real; commit negado por padrão | sem ligação | Git local; alterações exigem confirmação |
| github | real, escritas negadas por padrão | chat usa integração GitHub própria | Octokit/credencial do serviço; não reutilizar para clientes |
| storage / artifacts | placeholders, retirados do Agent e da oferta HTTP | nenhuma | não prometer armazenamento/publicação |
| build / test | detect reais; execução negada por padrão | sem ligação ao Worker | processos, npm/PHP/Python; requer isolamento antes de código não confiável |
| package | real, negada por padrão | nenhuma | rede/disco e scripts de pacotes |
| process | real; iniciar/matar negados | nenhuma | processos, timeout, webhooks com SSRF guard |
| code-analysis / code-search / project-inspector | reais e permitidas | inspeção/edição do App usa implementação própria | CPU/disco; limites de arquivos e bytes nas capabilities |
| forge | catálogo/receita reais e permitidos; render negado por padrão | modo Assets consulta `forge.catalog` pelo Worker; render/ZIP continuam no orquestrador existente | catálogo determinístico, zero chamadas IA; render Python/FFmpeg |
| web-search | real, usa Gemini diretamente | sem ligação nova | paga; contador por task não equivale a ledger por usuário/ciclo |
| web-fetch | real, SSRF guard | sem ligação nova | rede; validar DNS/redirects e limites antes de expor |
| knowledge-search | adaptador HTTP para RAG | sem ligação nova | serviço RAG/segredo; embeddings não comprovados nesta etapa |
| mcp | adaptador real; allowlist de tools opcional | GitHub chat tem caminho próprio | rede e possíveis efeitos/custos externos; exigir allowlist |
| escalation | real; request/respond negados por padrão | sem UI humana integrada | memória e webhook; rota de resposta agora exige autenticação |
| dispatch/parallel/plan | implementações extras, exemplos do orquestrador | não instanciadas no processo padrão | não oferecer subagentes como ativos |
| web-sandbox/archive | retiradas do Agent | upload depende de serviço externo isolado | não mover execução de conteúdo não confiável para o Worker |

## Entrega P0 desta etapa

- `/health` permanece público. `/run`, `/capabilities` e resposta de escalonamento
  falham com 503 sem segredo; segredo inválido retorna 401. Comparação em tempo
  constante. Bypass só com `WORKER_ALLOW_UNAUTHENTICATED=true` E `NODE_ENV`
  igual a `test` ou `development`; nunca em produção/ambiente omitido.
- Assets selecionado no chat consulta receitas reais via RemoteAgent, protocolo,
  autorização e capability Forge; modelo recebe contexto limitado a 16 mil
  caracteres. Não alega render/arquivo a partir dessa consulta. Worker ausente
  gera erro no chat antes de chamar o modelo. Ponte tem timeout de 15 segundos.
- Teste atravessa handler SSE, ponte HTTP e Agent real; só modelo, histórico e
  cobrança são simulados. Nenhuma credencial externa/IA paga é usada no teste.
- Storage/Artifacts não são instanciados nem anunciados; o HTTP rejeita batches
  contendo esses placeholders antes de qualquer execução.

## Bloqueios reais antes de habilitar outras ações a clientes

1. O contrato HTTP não transporta identidade autenticada de usuário/projeto.
   O processo padrão tem `/workspace` compartilhado. Não ligar file/shell/git
   do chat a esse root. É necessária uma identidade delegada pelo App e
   sandbox por projeto antes de executar código de cliente.
2. `web-search` chama Gemini diretamente sem reserva no ledger do App. O HTTP
   agora a bloqueia com 503 antes de executar qualquer action do lote e não
   a anuncia em capabilities; o código interno permanece para futura integração. O
   `_taskId` é controlável e não representa orçamento de usuário/ciclo.
   Não disponibilizar pesquisa paga pelo Worker até integrar reserva/settlement.
3. O ledger existente protege Flash apenas quando flags V2 estão ativas. O
   legado debita depois da resposta; falha de débito não recolhe o gasto já
   ocorrido. Não declarar teto financeiro garantido no legado. Flags/contas de
   produção não foram consultadas nem alteradas.
4. OAuth/instalação GitHub e GCS/Firebase precisam de smoke com credenciais de
   teste para comprovar os cinco fluxos; não expor token global do Worker.
5. Nenhuma imagem Docker foi construída/medida nesta etapa. PHP, Python,
   FFmpeg, Git e Forge preservados. A imagem já usa estágio C++ separado e
   remove caches apt/pip/npm; não alegar redução de tamanho sem medição.

## Validação local inicial

49 testes focados passaram (HTTP, autenticação, ponte e chat). TypeScript raiz
e Agent passaram; espelhos raiz verificados. Suíte completa Agent executada:
318 testes, 292 passaram e 26 falharam no Windows (Power-up C++ não compilado,
shell/quoting Unix e privilégios de symlink); CI Ubuntu é o gate de publicação.
Logs locais fora do repositório em `../backups/issue65-*-tests.log`.
Nenhum merge/deploy automático autorizado nesta etapa; revisão e CI exigidos.
