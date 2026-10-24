"""
server.py -- Serviço HTTP de geração de embeddings via modelo LOCAL
(ONNX Runtime, `fastembed`), sem chamar nenhuma API paga.

Responsabilidade única: converter texto em vetor de embedding. Este
serviço não conhece Firestore, não conhece "chunk" nem RAG -- quem
decide COMO fatiar o texto e ONDE salvar o vetor é o chamador (ver
src/solaris/rag/ no repositório Node principal). Mantém a superfície
mínima de propósito: trocar o modelo de embedding no futuro não deve
exigir tocar em nada fora deste arquivo.

Migrado da API Gemini pra um modelo local porque a conexão com a API
Gemini foi perdida (custo/disponibilidade) -- ver Dockerfile pra como
os pesos do modelo são baixados e cacheados NO BUILD da imagem, nunca
em runtime, então este serviço não depende de acesso de rede nenhum
pra gerar embeddings, nem de credencial de API externa nenhuma
(diferença real em relação à versão anterior: não existe mais
GEMINI_API_KEY, nem custo por chamada, nem risco de a API externa
cair).

Isolamento: roda como serviço Cloud Run separado do resto da aplicação
-- mesmo princípio já usado em sandbox-efemoro/ (ver README de lá).

Endpoints:
    GET  /health
    POST /embed
        Header: x-embeddings-secret: <EMBEDDINGS_SHARED_SECRET>
        Body: {"texts": ["...", "..."], "taskType": "RETRIEVAL_DOCUMENT"}
        Retorna: {"embeddings": [[...], [...]], "model": "...", "dimension": 768}
"""
from __future__ import annotations

import logging
import os
import sys
from typing import List

from flask import Flask, request, jsonify

try:
    from fastembed import TextEmbedding
except ImportError:
    print(
        "Falta a dependência 'fastembed'. Instale com:\n"
        "    pip install -r requirements.txt\n",
        file=sys.stderr,
    )
    raise

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("embeddings-service")

# paraphrase-multilingual-mpnet-base-v2: 768 dimensões -- MESMA dimensão
# já configurada no índice vetorial do Firestore (ver firestore.indexes.json,
# raiz do repo, fieldOverrides -> solaris_rag_vectors.embedding ->
# vectorConfig.dimension), escolhida de propósito pra não exigir
# reimplantar o índice. Multilíngue (inclui PT-BR, ~50 idiomas), licença
# Apache 2.0, ~1GB -- pesos baixados e cacheados NA IMAGEM Docker no
# build (ver Dockerfile), nunca em runtime. Mudar isso aqui exige mudar
# o mesmo valor no Dockerfile (a etapa de pré-download usa esta mesma
# env var) -- ver comentário lá.
EMBEDDING_MODEL = os.environ.get(
    "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
)
EMBEDDING_DIMENSION = int(os.environ.get("EMBEDDING_DIMENSION", "768"))
# 250 palavras: mesmo teto acordado para o tamanho de chunk no pipeline
# Node (src/solaris/rag/ragChunker.js) -- validado aqui de novo porque
# esta é a fronteira real da API (defesa em profundidade: nunca confiar
# só na validação do chamador).
MAX_WORDS_PER_TEXT = int(os.environ.get("EMBEDDINGS_MAX_WORDS_PER_TEXT", "250"))
MAX_TEXTS_PER_REQUEST = int(os.environ.get("EMBEDDINGS_MAX_TEXTS_PER_REQUEST", "20"))
VALID_TASK_TYPES = {"RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"}

app = Flask(__name__)

_model: "TextEmbedding | None" = None


def get_model() -> "TextEmbedding":
    """Carrega o modelo uma única vez (processo, não por requisição) --
    em produção, os pesos já estão cacheados na imagem (ver Dockerfile),
    então isto só lê do disco local, nunca baixa nada da rede aqui."""
    global _model
    if _model is not None:
        return _model
    logger.info("Carregando modelo de embedding local: %s", EMBEDDING_MODEL)
    _model = TextEmbedding(model_name=EMBEDDING_MODEL)
    return _model


def _shared_secret_configurado() -> str | None:
    return os.environ.get("EMBEDDINGS_SHARED_SECRET")


def _autenticado(req) -> bool:
    segredo = _shared_secret_configurado()
    if not segredo:
        # Mesma postura de defesa em profundidade mínima do
        # sandbox-efemoro: sem segredo configurado, o serviço sobe com
        # aviso e aceita qualquer chamador. O ideal em produção é
        # também restringir por IAM/rede do Cloud Run.
        return True
    return req.headers.get("x-embeddings-secret") == segredo


def embed_texts(texts: List[str], task_type: str) -> List[List[float]]:
    """Gera embeddings com o modelo local (ONNX Runtime via fastembed).

    `query_embed()`/`passage_embed()` aplicam internamente o prefixo
    esperado pelo modelo quando ele precisa de um (ex: família E5) --
    mesma distinção RETRIEVAL_QUERY/RETRIEVAL_DOCUMENT que já existia
    com a API Gemini (`task_type`), agora resolvida localmente em vez
    de mandada pra API externa. Sem retry/backoff: diferente de uma API
    remota com rate limit, inferência local não tem essa classe de
    falha transitória -- uma falha aqui é real (modelo corrompido,
    memória insuficiente) e repetir não ajuda.
    """
    model = get_model()
    vectors = model.query_embed(texts) if task_type == "RETRIEVAL_QUERY" else model.passage_embed(texts)
    return [v.tolist() for v in vectors]


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/embed")
def embed():
    if not _autenticado(request):
        return jsonify({"error": "não autenticado"}), 401

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "corpo da requisição deve ser um objeto JSON"}), 400

    texts = body.get("texts")
    if not isinstance(texts, list) or len(texts) == 0:
        return jsonify({"error": '"texts" é obrigatório e deve ser uma lista não vazia'}), 400
    if len(texts) > MAX_TEXTS_PER_REQUEST:
        return jsonify({
            "error": f'"texts" excede o máximo de {MAX_TEXTS_PER_REQUEST} por requisição',
        }), 400
    if not all(isinstance(t, str) and t.strip() for t in texts):
        return jsonify({"error": 'cada entrada de "texts" deve ser uma string não vazia'}), 400

    for idx, t in enumerate(texts):
        n_palavras = len(t.split())
        if n_palavras > MAX_WORDS_PER_TEXT:
            return jsonify({
                "error": (
                    f"texts[{idx}] excede o limite de {MAX_WORDS_PER_TEXT} palavras "
                    f"({n_palavras} palavras) -- o chamador deve fatiar o texto em "
                    "chunks menores antes de enviar"
                ),
            }), 400

    task_type = body.get("taskType", "RETRIEVAL_DOCUMENT")
    if task_type not in VALID_TASK_TYPES:
        return jsonify({"error": f'"taskType" deve ser um de {sorted(VALID_TASK_TYPES)}'}), 400

    try:
        embeddings = embed_texts(texts, task_type)
    except Exception as exc:  # noqa: BLE001 - falha real de inferência local
        logger.error("Falha ao gerar embeddings: %s", exc)
        return jsonify({"error": "falha ao gerar embeddings", "detail": str(exc)}), 500

    return jsonify({
        "embeddings": embeddings,
        "model": EMBEDDING_MODEL,
        "dimension": EMBEDDING_DIMENSION,
    })


if __name__ == "__main__":
    if not _shared_secret_configurado():
        logger.warning(
            "EMBEDDINGS_SHARED_SECRET não configurado -- o serviço aceita "
            "qualquer chamador. Configure em produção (defesa em profundidade "
            "mínima; o ideal é também restringir por IAM/rede do Cloud Run)."
        )
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
