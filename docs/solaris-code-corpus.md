# Solaris Code: biblioteca de exemplos ORIGINAIS

> Esta é a **biblioteca de código do Solaris**, isolada do conhecimento técnico
> e dos arquivos do Especialista Blogger. Veja [Arquitetura dos três RAGs](rag-architecture.md).

Este projeto passa a escrever seus próprios exemplos; não coleta código externo
automaticamente. O coletor antigo permanece por compatibilidade/histórico, mas
foi retirado dos comandos npm e não alimenta mais a indexação padrão.

## Primeiro lote (8 receitas)

Fonte de verdade: src/solaris/code-examples/catalog.json e os arquivos
de código nas pastas javascript/ e python/. Cada entrada traz título,
linguagem, quando usar, restrições e um exemplo escrito no projeto.
Há testes dedicados, também versionados nessa pasta.

## Segundo lote (7 receitas; total 15)

Os novos arquivos em `examples/solaris-code/` são TypeScript, componentes
React/TSX e Node.js. Eles ficam fora do scanner de espelhos TypeScript
do núcleo de produção porque são exemplos autocontidos, não módulos
CommonJS usados pelo servidor. O catálogo versionado continua único
em `src/solaris/code-examples/catalog.json`.

- TypeScript: Result com validação, reducer que ignora respostas antigas,
  configuração de servidor.
- React: catálogo filtrado e estados de requisição renderizados em HTML.
- Node.js: health/readiness Express e fetch com cancelamento/timeout.

O script `rag:code-test` cobre Node.js, React via SSR, TypeScript com
compilação independente (tsconfig próprio) e os testes Python anteriores.
O indexador com `--apply` executa esses testes antes de gravar.

## Validação e indexação

npm run rag:code-test
npm run rag:code-index
npm run rag:code-index -- --limit=15 --apply

Sem --apply, apenas conta o corpus e os chunks; não escreve no banco.
Com --apply, executa testes Node e Python ANTES de tocar no Firestore.
Se falhar, não indexa. Se passar, persiste validated=true, junto do
código e da descrição. O modelo local converte os trechos em vetores
de 768 dimensões e o backend escreve em solaris_code_vectors.

A máquina de indexação precisa de Node.js 22+ e Python 3 (na VPS, a
imagem de indexação deve ter os dois, ou executar o CLI fora do container).
Antes de gravar, conferir projeto Firebase, credenciais e índice vetorial
publicado; nenhum upload para Firestore foi feito apenas por estes commits.
Não há atualização automática com deploy ou cron.

SOLARIS_CODE_SEARCH_ENABLED=true habilita a recuperação conjunta pelo
Solaris, apenas após o índice e os documentos realmente existirem. Sem
o flag, a busca antiga permanece.

## Evolução de qualidade

Não atingir a meta de mil exemplos criando variações artificiais.
Cada lote exige código, testes executáveis, documentação das decisões e
limitações, revisão e somente depois indexação. Testes de exemplo não
equivalem a validação de segurança para produção.
