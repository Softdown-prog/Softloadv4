# Arquitetura dos três RAGs da Softload

Este documento define o **contrato de separação** entre os três corpora.
A palavra "RAG" aqui significa *recuperação de conhecimento para auxiliar o modelo*.
Não são três modelos de IA, e este contrato não cria um quarto RAG.

## Donos, fontes e armazenamento

| Base | Responsável | Fonte editável | Consulta | Destino |
| --- | --- | --- | --- | --- |
| **Blogger** | Especialista Blogger | `src/rag/` (`rag-ia-suporte/`, `rag-ia-compiler/`, etc.) | Matcher + arquivos via `src/rag/ragLoader.js` e `chat/chatRag.js` | **Sem Firestore vetorial** |
| **Solaris técnico** | Solaris Code | `src/solaris/rag/*.json` | `ragSearchService` + `ragVectorStore` | `solaris_rag_vectors` |
| **Solaris Code (receitas)** | Solaris Code | `src/solaris/code-examples/` + `examples/solaris-code/` (catálogo `src/solaris/code-examples/catalog.json`) | `codeSearchService` + `codeVectorStore` | `solaris_code_vectors` |

**Registro de namespace:** `src/knowledge/ragNamespaces.js`.
O registro contém identificadores, responsáveis, coleções e diretórios.
Valida nomes duplicados e impede expor o Blogger como `corpus` do endpoint Solaris.

### O que pode ser compartilhado

- `src/rag/ragMatcher.js`: função utilitária *pura* de matching de palavras.
  Pode ser reutilizada pelo Solaris sem importar o conteúdo Blogger.
- `Embedings-python`: serviço único **stateless** de embeddings para os
  dois índices vetoriais do Solaris (mesmo modelo e 768 dimensões).
- Firestore como instância física, **não** a coleção lógica. Cada corpus
  tem seu índice separado em `firestore.indexes.json`.
- O provedor LLM/Gemini pode ser compartilhado como infraestrutura; os
  contextos enviados são montados por rotas independentes.

### O que é proibido

- A busca do Blogger ler `solaris_code_vectors` ou
  `solaris_rag_vectors`.
- O endpoint `/internal/solaris/rag/buscar` aceitar `corpus: blogger` ou
  carregar `src/rag/ragLoader.js`.
- Executar `ragEmbedIndex.js` sobre o índice `solaris_code_vectors`.
- Executar `ragCodeIndex.js` sobre `solaris_rag_vectors`.
- Incorporar instruções vindas das referências como system/developer
  instructions; os trechos recuperados são **dados não confiáveis**.

## Roteamento em execução

```text
Especialista Blogger /dashboard/chat
  -> src/routes/dashboard_routes/chat/chatGenerationFlow.js
  -> chatRag.js / ragLoader.js  -> arquivos src/rag/
  -> contexto próprio do Blogger (sem consulta aos vetores do Solaris)

Solaris Code /dashboard/solaris
  -> chat/orchestrator
  -> buscarConhecimentoMisto() -> [solaris_rag_vectors]
                              -> [solaris_code_vectors] (se habilitado
                                 e houver intenção explícita de código)
  -> deduplicação por entryId -> até 3 referências no chat
  -> prompt Solaris, nunca Blogger
```

**Importante:** a rota interna `POST /internal/solaris/rag/buscar`
é autenticada via `SOLARIS_RAG_SEARCH_SECRET`; é usada pelo Agent
Worker, não é um endpoint público. Aceita apenas:

- `catalogo` (padrão): só conhecimento técnico do Solaris;
- `codigo`: só receitas (requer `SOLARIS_CODE_SEARCH_ENABLED=true`);
- `ambos`: o misto com código condicionado ao feature flag e à
  intenção da consulta.

A busca mista faz chamadas **independentes** às coleções. Se uma falhar,
usa a outra; se ambas falharem, a chamada reporta erro e o chat mantém
seu fallback lexical preexistente. Busca mista prioriza até 2 receitas
(distintas por `entryId`), deixando espaço para a referência técnica.
Isso não garante relevância perfeita: avaliação semântica exige testes
empíricos sobre corpus real.

O Blogger mantém as próprias regras de seleção por tema e suporte dentro
de `src/rag/`, inclusive seus subíndices. O `ragAgent.js` do
Blogger é um mecanismo de ferramentas e não uma terceira coleção Firebase.

## Indexação, sem interferência entre bases

- Solaris técnico: `npm run rag:embed-index` (escreve somente
  `solaris_rag_vectors`). A limpeza de órfãos roda **somente** nesta coleção.
- Solaris receitas: `npm run rag:code-test` e
  `npm run rag:code-index -- --limit=15 --apply` (escreve somente
  `solaris_code_vectors` e requer pré-validação dos exemplos).
- Blogger: manter arquivos versionados e seus índices JSON;
  **não executar indexação vetorial** para as pastas do Blogger.
- Sem `--apply`, `rag:code-index` é simulação. Nenhuma destas etapas
  é ativada automaticamente por deploy.
- O deploy dos índices de vetor (`firebase deploy --only firestore:indexes`)
  é uma operação separada e deve apontar para o projeto Firebase correto.

## Testes e manutenção

Execute:

```bash
npm run rag:boundaries-test
npm run rag:code-test
npm run typecheck
```

`rag:boundaries-test` valida os três owners, o índice Firestore de 768
dimensões, buscas misturadas com fallback, deduplicação, intent gating e
regressões básicas do carregador Blogger.

Ao criar novos exemplos do Solaris, modifique o catálogo original, não
`src/rag/`. Se criar uma nova coleção RAG, altere explicitamente o
registro, os índices, os testes e esta documentação antes de habilitar.
