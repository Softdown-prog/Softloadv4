# sol-model — base de conhecimento de manutenção da Softload

Pasta nova, em construção. Diferente de `rag-sol-conhecimento/` (que é
material técnico EXTERNO — Node/Express/EJS etc, nunca conhecimento
sobre o código da própria Softload, já que o Sol lê o código-fonte
direto via `ler_arquivo_codigo`/`buscar_no_codigo`), esta pasta é
conhecimento OPERACIONAL: como manter, migrar e operar a Softload —
coisas que não estão escritas em nenhum arquivo de código específico,
só na cabeça de quem trabalhou nisso.

## Status atual

Todo conteúdo aqui está no formato `{id}.json` (kebab-case, `{id,
categoria, palavras_chave, titulo, conteudo, origem, geradoEm}`),
indexado em `index.json`. Os `.md` avulsos que existiam numa fase manual
anterior foram convertidos pro mesmo formato e removidos (histórico
disponível no git).

O worker de conversão automática via IA (`scripts/ragInboxWorker.js` +
`.github/workflows/rag-inbox-worker.yml`) foi removido — instável em
produção (falhas recorrentes de permissão/infraestrutura do GitHub
Actions antes de sequer chamar a IA). `_inbox/` continua existindo como
área de rascunho pra texto livre que ainda precisa virar `{id}.json` —
a conversão pro formato final agora é manual.
