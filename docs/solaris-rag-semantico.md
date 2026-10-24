# Busca semântica do Solaris Code

> Este é o **RAG técnico** do Solaris, não o RAG de exemplos de código nem
> o do Especialista Blogger. Veja [Arquitetura dos três RAGs](rag-architecture.md).

O catálogo JSON em `src/solaris/rag/` continua sendo a fonte editável.
`Embedings-python` gera embeddings locais. O backend Node indexa e consulta
os vetores na coleção Firestore `solaris_rag_vectors`.

## Integração

- O chat consulta RAG semântico para pedidos técnicos, não cumprimentos.
- `gerarManifesto` consulta o catálogo; `gerarProjeto` faz somente uma
  busca e reutiliza os trechos curtos no manifesto e nos arquivos.
- As referências são rotuladas como dados não confiáveis; instruções
  encontradas nelas não podem substituir o pedido ou a validação.
- O RAG léxico permanece. Se embeddings falhar ou não estiver configurado,
  chat e geração continuam funcionando.

## Configuração

O backend usa `EMBEDDINGS_SERVICE_URL`, `EMBEDDINGS_SHARED_SECRET` e
as credenciais Firestore já existentes. No serviço Python hospedado na
rede interna Docker, `EMBEDDINGS_IAM_AUTH` deve ficar desativado; no
Cloud Run privado, configurar a autenticação por identidade.

O Agent Worker chama o endpoint autenticado da aplicação principal
com `SOLARIS_RAG_SEARCH_URL` e `SOLARIS_RAG_SEARCH_SECRET`.

`npm run rag:embed-index` reindexa os JSONs no Firestore, com dimensão
vetorial 768. A indexação não acontece automaticamente ao subir o
container e escreve no banco configurado: confira o ambiente antes de
executar. O pipeline `cloudbuild-rag-index.yaml` antigo ainda aponta
para Cloud Run e precisa de adaptação caso migre a indexação para a VPS.

O catálogo não garante conhecimento atualizado: mantenha fontes,
versões e datas verificadas e continue validando o código nos Workers.
