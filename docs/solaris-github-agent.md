# Fluxo GitHub agêntico do Solaris

O Solaris usa o GitHub App configurado por usuário, e o loop **Gemini Pro
executarTarefaComFerramentas** já existente. Ferramentas do modelo:
`consultarRepositorio`, `lerArquivoGithub` e `proporArquivoGithub`.
Nenhuma delas grava no GitHub. Leitura de privados exige conta conectada
e repositório selecionado.

## Proposta / aprovação

Uma proposta por usuário é persistida na coleção Firestore
`solaris_github_proposals`, com validade de 20 minutos e até três arquivos,
no máximo 28 KiB por arquivo. O usuário revisa o conteúdo no painel do Solaris.
Só o endpoint HTTP separado, autenticado, com verificação de `Origin`,
executa `approve`; não há tool do modelo para aprovar.

Após aprovação, o backend cria uma branch `solaris/<id>`, atualiza arquivos
validando SHA, abre um PR **draft** e retorna sua URL. O estado transacional
impede aprovação duplicada. Se uma gravação falhar após a branch, o estado vira
`failed`, sem tentativa automática potencialmente destrutiva. Inspecione a
branch de trabalho manualmente nesse caso.

Rotas:
- `GET /dashboard/solaris/github/pending` (sessão).
- `POST /dashboard/solaris/github/approve` (sessão + Origin).
- `DELETE /dashboard/solaris/github/pending` (sessão + Origin).

Operações de escrita do antigo `POST /dashboard/solaris/github/action`
foram bloqueadas na rota pública; somente leituras continuam liberadas.
O fluxo GitHub do chat aplica o gate de créditos normal e o router de modelo
protegido por orçamento quando `SOLARIS_AI_BUDGET_ENFORCE=true`.

## Limites / pendências

A API REST continua sendo usada para propostas e escrita após aprovação.
O cliente TypeScript `solarisGithubMcp.ts` implementa a negociação MCP
Streamable HTTP com o GitHub MCP remoto no endpoint fixo
`https://api.githubcopilot.com/mcp/readonly`, no toolset `repos`.
Configure `SOLARIS_GITHUB_MCP_ENABLED=true` na aplicação para habilitar
`consultarMcpGithub` no agente Gemini. A ferramenta só pode executar
`get_file_contents` no repositório vinculado ao usuário; o modelo não
recebe token e o MCP não recebe permissão de escrita. Nenhum commit ou PR
é executado pelo MCP; a aprovação REST humana continua obrigatória.
A autorização OAuth pode precisar de escopos/permissões adicionais para o
servidor MCP remoto; testes locais usam mocks e não garantem acesso real.
O transporte nativo implementa um subconjunto de MCP e ainda não depende do
SDK TypeScript completo, nem oferece todas as ferramentas do GitHub.
O editor GitHub não roda testes de CI na VPS; o PR rascunho deve ser revisado
antes de merge. Arquivos maiores, alterações de workflow e commits multi-arquivo
atômicos são propositalmente bloqueados nesta fase.

## Vinculação e autorização tipadas

`src/services/solarisGithubReadiness.ts` valida a sessão antes de cada operação. Uma conta conectada sem repositório vinculado, um vínculo divergente ou uma autorização expirada não fazem fallback silencioso para leitura pública. As mensagens no frontend acompanham esses estados.
