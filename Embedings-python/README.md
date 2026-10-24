# Embedings-python — serviço de geração de embeddings (modelo local)

Serviço HTTP isolado, em Python, com uma responsabilidade única:
**converter texto em vetor de embedding**. Não conhece Firestore, não
conhece "chunk"/RAG, não guarda estado entre requisições. Quem decide
COMO fatiar o texto e ONDE salvar o vetor é o pipeline Node em
`src/solaris/rag/` (ver "Pipeline completo" abaixo).

`Observações.md` e `prototipo_local.py`, nesta mesma pasta, são o
protótipo original (índice em arquivo JSON local) e a revisão técnica
que motivou a primeira reescrita -- mantidos como registro histórico,
não como referência de implementação.

**Migrado da API Gemini para um modelo LOCAL** (conexão com a API
Gemini foi perdida -- custo/disponibilidade). Modelo:
[`sentence-transformers/paraphrase-multilingual-mpnet-base-v2`](https://huggingface.co/sentence-transformers/paraphrase-multilingual-mpnet-base-v2)
via [`fastembed`](https://github.com/qdrant/fastembed) (ONNX Runtime,
sem PyTorch) -- gratuito, licença Apache 2.0, multilíngue (inclui
PT-BR), 768 dimensões (mesma dimensão já configurada no índice
vetorial do Firestore -- ver `firestore.indexes.json` na raiz do repo
-- escolhido de propósito pra não exigir reimplantar o índice).
Escolhido entre os modelos multilíngues disponíveis no catálogo do
`fastembed` no momento desta troca (avaliação real, não teórica --
`TextEmbedding.list_supported_models()`), comparando dimensão/tamanho/
licença dos 3 candidatos multilíngues existentes.

**Sem NENHUMA credencial de API externa** -- diferença real em relação
à versão com Gemini: os pesos do modelo são baixados e cacheados NA
IMAGEM Docker durante o build (ver `Dockerfile`), nunca em runtime, e
a geração de embedding roda 100% localmente (ONNX Runtime). Não existe
mais `GEMINI_API_KEY`, nem custo por chamada à API, nem risco de a API
externa cair ou mudar de preço.

## Por que um serviço/container separado, e não uma capability do `agent/` ou do app principal

Mesma decisão de arquitetura já usada em `sandbox-efemoro/`: isolar o
componente que gera embeddings do resto da aplicação, num container
próprio. Antes (com Gemini) o motivo era isolar a credencial de API;
agora o motivo principal passa a ser isolar a dependência pesada (ONNX
Runtime + pesos do modelo, ~1GB) do resto do app -- trocar o modelo de
embedding no futuro (ex: por um modelo próprio em treinamento, quando
ficar pronto, ou por um multilíngue maior se a qualidade não for
suficiente) significa mexer só neste serviço, sem tocar no pipeline
Node que consome os vetores.

## API

```
GET  /health          -> 200 {"status": "ok"}
POST /embed
  Header: x-embeddings-secret: <EMBEDDINGS_SHARED_SECRET>
  Body: {
    "texts": ["chunk 1...", "chunk 2..."],   // até 20 por requisição, até 250 palavras cada
    "taskType": "RETRIEVAL_DOCUMENT"          // ou "RETRIEVAL_QUERY" ao buscar
  }
  Retorna: {"embeddings": [[...], [...]], "model": "sentence-transformers/paraphrase-multilingual-mpnet-base-v2", "dimension": 768}
```

Validação de fronteira (defesa em profundidade -- o chamador Node já
valida isso também, mas este serviço nunca confia cegamente): rejeita
lote vazio, mais de 20 textos por requisição, texto não-string/vazio,
texto com mais de 250 palavras, e `taskType` fora de
`RETRIEVAL_DOCUMENT`/`RETRIEVAL_QUERY`.

## Variáveis de ambiente

- `EMBEDDINGS_SHARED_SECRET` -- segredo exigido no header
  `x-embeddings-secret`. Sem isso configurado, o serviço sobe com
  aviso e aceita qualquer chamador -- defesa em profundidade mínima,
  não a única camada (o ideal em produção é também restringir por
  IAM/rede do Cloud Run, mesmo padrão já documentado em
  `sandbox-efemoro/README.md`).
- `EMBEDDING_MODEL` -- default
  `sentence-transformers/paraphrase-multilingual-mpnet-base-v2`. Se
  mudar, precisa mudar TAMBÉM no `Dockerfile` (a etapa de pré-download
  dos pesos usa a mesma env var) -- um valor aqui e outro no build
  faria o container tentar baixar o modelo em runtime, reabrindo o
  problema que o pré-baking evita (ver "Rodando localmente"/`Dockerfile`).
- `EMBEDDING_DIMENSION` -- default `768`. Precisa bater com a dimensão
  configurada no índice vetorial do Firestore (ver
  `firestore.indexes.json` na raiz do repo, `fieldOverrides` ->
  `solaris_rag_vectors.embedding` -> `vectorConfig.dimension`) -- mudar
  um sem o outro quebra a busca vetorial silenciosamente (Firestore
  simplesmente ignora documentos cuja dimensão do vetor não bate com a
  do índice). Só precisa mudar se você trocar de modelo por um de
  dimensão diferente -- o modelo default já é 768, igual ao índice.
- `EMBEDDINGS_MAX_WORDS_PER_TEXT` -- default `250`.
- `EMBEDDINGS_MAX_TEXTS_PER_REQUEST` -- default `20`.
- `PORT` -- porta do servidor HTTP (Cloud Run injeta automaticamente).

## Rodando localmente

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
EMBEDDINGS_SHARED_SECRET=<algo> .venv/bin/python server.py
```

Sem `GEMINI_API_KEY` nenhuma pra configurar -- o modelo é local. Na
PRIMEIRA execução local (fora do Docker), `fastembed` baixa os pesos
do Hugging Face Hub pra `/tmp/fastembed_cache` (ou o caminho de
`FASTEMBED_CACHE_PATH`, se definida) -- precisa de acesso de rede uma
vez; execuções seguintes reusam o cache local. Em produção (imagem
Docker), os pesos já vêm cacheados na imagem -- ver `Dockerfile` --
nunca baixa nada em runtime.

## Testes

```bash
.venv/bin/python -m pytest test_server.py -v
```

Nunca carrega o modelo de verdade -- `embed_texts` é sempre
substituído por um fake nos testes, então rodam rápido, sem baixar/
rodar o modelo ONNX e sem custo de CPU.

## Pipeline completo (onde este serviço se encaixa)

```
src/solaris/rag/*.json (catálogo)
  -> ragEntryText.montarTextoEmbedavel()      [Node, determinístico]
  -> ragChunker.chunkarTexto() (<=250 palavras) [Node, determinístico]
  -> ragEmbeddingsClient.gerarEmbeddings()     [Node -> HTTP -> ESTE SERVIÇO -> modelo local]
  -> ragVectorStore.substituirVetoresDaEntrada() [Node -> Firestore, índice vetorial nativo]
```

Orquestrado por `npm run rag:embed-index` (raiz do repo) -- ver
`src/solaris/README.md`, seção "Pipeline de embeddings vetoriais",
para a explicação completa de cada estágio, o que já está automatizado
e o que ainda depende de configuração manual (deploy deste serviço no
Cloud Run, `firebase deploy --only firestore:indexes` -- não depende
mais de Secret Manager pra este serviço específico, já que não há mais
`GEMINI_API_KEY`).

## Deploy -- memória do Cloud Run

O modelo (~1GB de pesos, carregado uma vez por processo -- ver
`Dockerfile`, `--workers 1` de propósito, pra não multiplicar isso por
processo) precisa de mais memória que o default do Cloud Run. Ao
implantar, aloque pelo menos `--memory=2Gi`:

```bash
gcloud run deploy embeddings-service \
  --source . \
  --memory=2Gi \
  --no-allow-unauthenticated \
  --set-env-vars=EMBEDDINGS_SHARED_SECRET=<gere-um-segredo-forte>
```

Sem `GEMINI_API_KEY`/Secret Manager nenhum pra configurar -- o modelo
é local, pré-baixado na imagem no build (ver `Dockerfile`). O container
nunca precisa de acesso de rede em runtime pra gerar embeddings.

## O que este serviço explicitamente NÃO faz

- Não guarda estado (sem índice local, sem cache entre requisições).
- Não fala com Firestore.
- Não decide chunking -- rejeita (400) qualquer texto acima do limite
  de palavras em vez de fatiar sozinho.
- Não é chamado diretamente pelo futuro Solaris agent (Gemini 2.5) --
  isso é fluxo futuro documentado como gap em aberto, ver
  `src/solaris/README.md`.
