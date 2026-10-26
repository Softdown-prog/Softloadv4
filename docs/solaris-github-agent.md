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

A integração atual usa a API REST oficial do GitHub pelo gateway da Softload,
não implementa ainda a sessão MCP remota oficial por usuário. A autenticação
OAuth já existente usa tokens com expiração e pode pedir reconexão.
O editor GitHub não roda testes de CI na VPS; o PR rascunho deve ser revisado
antes de merge. Arquivos maiores, alterações de workflow e commits multi-arquivo
atômicos são propositalmente bloqueados nesta fase.

## Vinculação e autorização tipadas

`src/services/solarisGithubReadiness.ts` valida a sessão antes de cada operação. Uma conta conectada sem repositório vinculado, um vínculo divergente ou uma autorização expirada não fazem fallback silencioso para leitura pública. As mensagens no frontend acompanham esses estados.
