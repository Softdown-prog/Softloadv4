"""
gemini_embeddings_store.py

Serviço/CLI Python que gera embeddings via API Gemini e mantém um índice
vetorial LOCAL (arquivo JSON) para busca por similaridade -- útil como
"memória" de código/documentos para o agente, sem precisar de um vector DB
externo.

Roda em um Job separado do agente (sem integração direta, conforme pedido) --
comunicação futura, se quiser, seria via HTTP simples ou arquivo compartilhado.

Dependências:
    pip install google-genai numpy

Variável de ambiente necessária:
    GEMINI_API_KEY=<sua chave>

Uso via CLI:
    # indexar um arquivo ou diretório (recursivo, arquivos de texto)
    python gemini_embeddings_store.py index ./meu_projeto --store index.json

    # buscar os N trechos mais similares a uma query
    python gemini_embeddings_store.py search "como funciona a autenticação" \
        --store index.json --top-k 5

    # subir um servidor HTTP simples (opcional) para outro Job consultar
    python gemini_embeddings_store.py serve --store index.json --port 8080
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import http.server
import socketserver
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional

import numpy as np

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    print(
        "Falta a dependência 'google-genai'. Instale com:\n"
        "    pip install google-genai\n",
        file=sys.stderr,
    )
    raise

# --------------------------------------------------------------------------
# Configuração
# --------------------------------------------------------------------------

EMBEDDING_MODEL = "gemini-embedding-001"  # modelo de embeddings da API Gemini
EMBEDDING_DIM = 768  # dimensão de saída solicitada (o modelo suporta variação)
CHUNK_SIZE_CHARS = 1500  # tamanho aproximado de cada pedaço de texto indexado
CHUNK_OVERLAP = 200
TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".md", ".txt", ".json",
    ".yaml", ".yml", ".html", ".css", ".java", ".go", ".rs", ".c", ".cpp", ".h",
}


def get_client() -> "genai.Client":
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERRO: defina a variável de ambiente GEMINI_API_KEY.", file=sys.stderr)
        sys.exit(1)
    return genai.Client(api_key=api_key)


# --------------------------------------------------------------------------
# Estrutura do índice
# --------------------------------------------------------------------------

@dataclass
class Chunk:
    id: str
    source: str       # caminho do arquivo de origem
    text: str          # conteúdo do trecho
    embedding: List[float]


class VectorStore:
    """Índice vetorial simples em memória, persistido como JSON."""

    def __init__(self):
        self.chunks: List[Chunk] = []

    def add(self, chunk: Chunk) -> None:
        self.chunks.append(chunk)

    def save(self, path: str) -> None:
        data = [asdict(c) for c in self.chunks]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        print(f"Índice salvo em {path} ({len(self.chunks)} trechos).")

    @classmethod
    def load(cls, path: str) -> "VectorStore":
        store = cls()
        if not os.path.exists(path):
            return store
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        store.chunks = [Chunk(**c) for c in data]
        return store

    def search(self, query_embedding: List[float], top_k: int = 5):
        if not self.chunks:
            return []
        matrix = np.array([c.embedding for c in self.chunks], dtype=np.float32)
        q = np.array(query_embedding, dtype=np.float32)

        # similaridade de cosseno vetorizada
        matrix_norms = np.linalg.norm(matrix, axis=1)
        q_norm = np.linalg.norm(q)
        denom = matrix_norms * q_norm
        denom[denom == 0] = 1e-10
        sims = (matrix @ q) / denom

        top_idx = np.argsort(-sims)[:top_k]
        return [(self.chunks[i], float(sims[i])) for i in top_idx]


# --------------------------------------------------------------------------
# Chamada à API Gemini para embeddings
# --------------------------------------------------------------------------

def embed_texts(
    client: "genai.Client",
    texts: List[str],
    task_type: str = "RETRIEVAL_DOCUMENT",
    max_retries: int = 3,
) -> List[List[float]]:
    """
    Gera embeddings para uma lista de textos.
    task_type: "RETRIEVAL_DOCUMENT" ao indexar, "RETRIEVAL_QUERY" ao buscar.
    """
    embeddings: List[List[float]] = []

    # A API aceita lotes; mantemos lotes pequenos para não estourar limites.
    batch_size = 20
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        for attempt in range(max_retries):
            try:
                result = client.models.embed_content(
                    model=EMBEDDING_MODEL,
                    contents=batch,
                    config=genai_types.EmbedContentConfig(
                        task_type=task_type,
                        output_dimensionality=EMBEDDING_DIM,
                    ),
                )
                embeddings.extend([e.values for e in result.embeddings])
                break
            except Exception as exc:  # noqa: BLE001 - queremos logar e tentar de novo
                wait = 2 ** attempt
                print(
                    f"Aviso: falha ao gerar embeddings (tentativa {attempt + 1}/"
                    f"{max_retries}): {exc}. Retentando em {wait}s...",
                    file=sys.stderr,
                )
                time.sleep(wait)
        else:
            raise RuntimeError("Falha ao gerar embeddings após múltiplas tentativas.")

    return embeddings


# --------------------------------------------------------------------------
# Chunking de arquivos
# --------------------------------------------------------------------------

def chunk_text(text: str, size: int = CHUNK_SIZE_CHARS, overlap: int = CHUNK_OVERLAP):
    if len(text) <= size:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - overlap
    return chunks


def iter_source_files(path: Path):
    if path.is_file():
        if path.suffix in TEXT_EXTENSIONS:
            yield path
        return
    for p in path.rglob("*"):
        if p.is_file() and p.suffix in TEXT_EXTENSIONS:
            # ignora pastas pesadas comuns
            if any(part in {"node_modules", ".git", "venv", "__pycache__"} for part in p.parts):
                continue
            yield p


# --------------------------------------------------------------------------
# Comandos de CLI
# --------------------------------------------------------------------------

def cmd_index(args: argparse.Namespace) -> None:
    client = get_client()
    store = VectorStore.load(args.store)

    root = Path(args.path)
    files = list(iter_source_files(root))
    if not files:
        print("Nenhum arquivo de texto encontrado para indexar.")
        return

    all_chunks_text: List[str] = []
    all_chunks_meta: List[tuple] = []  # (source, chunk_index)

    for f in files:
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:  # noqa: BLE001
            print(f"Pulando {f} ({exc})", file=sys.stderr)
            continue
        pieces = chunk_text(content)
        for idx, piece in enumerate(pieces):
            all_chunks_text.append(piece)
            all_chunks_meta.append((str(f), idx))

    print(f"Gerando embeddings para {len(all_chunks_text)} trechos de {len(files)} arquivo(s)...")
    embeddings = embed_texts(client, all_chunks_text, task_type="RETRIEVAL_DOCUMENT")

    for (source, idx), text, emb in zip(all_chunks_meta, all_chunks_text, embeddings):
        chunk_id = f"{source}::chunk{idx}"
        store.add(Chunk(id=chunk_id, source=source, text=text, embedding=emb))

    store.save(args.store)


def cmd_search(args: argparse.Namespace) -> None:
    client = get_client()
    store = VectorStore.load(args.store)
    if not store.chunks:
        print("Índice vazio -- rode o comando 'index' primeiro.")
        return

    query_embedding = embed_texts(client, [args.query], task_type="RETRIEVAL_QUERY")[0]
    results = store.search(query_embedding, top_k=args.top_k)

    for rank, (chunk, score) in enumerate(results, start=1):
        preview = chunk.text.strip().replace("\n", " ")[:160]
        print(f"\n#{rank}  score={score:.4f}  fonte={chunk.source}")
        print(f"    {preview}...")


def cmd_serve(args: argparse.Namespace) -> None:
    """
    Servidor HTTP minimalista (stdlib apenas) para outro Job consultar o
    índice via GET /search?q=...&top_k=5 -- útil se depois você quiser ligar
    isso ao Job do agente sem reescrever a lógica de embeddings em outra
    linguagem.
    """
    client = get_client()
    store = VectorStore.load(args.store)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - assinatura exigida pela stdlib
            if not self.path.startswith("/search"):
                self.send_response(404)
                self.end_headers()
                return

            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            query = qs.get("q", [""])[0]
            top_k = int(qs.get("top_k", ["5"])[0])

            if not query:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error": "parametro q ausente"}')
                return

            query_embedding = embed_texts(client, [query], task_type="RETRIEVAL_QUERY")[0]
            results = store.search(query_embedding, top_k=top_k)
            payload = json.dumps(
                [{"source": c.source, "text": c.text, "score": s} for c, s in results]
            ).encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *fmt_args):  # silencia log padrão verboso
            pass

    with socketserver.TCPServer(("0.0.0.0", args.port), Handler) as httpd:
        print(f"Servindo busca de embeddings em http://0.0.0.0:{args.port}/search?q=...")
        httpd.serve_forever()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Índice vetorial local via API Gemini")
    sub = parser.add_subparsers(dest="command", required=True)

    p_index = sub.add_parser("index", help="Indexar arquivo(s)/diretório")
    p_index.add_argument("path", help="Caminho de arquivo ou diretório")
    p_index.add_argument("--store", default="index.json", help="Arquivo do índice")
    p_index.set_defaults(func=cmd_index)

    p_search = sub.add_parser("search", help="Buscar no índice")
    p_search.add_argument("query", help="Texto da busca")
    p_search.add_argument("--store", default="index.json", help="Arquivo do índice")
    p_search.add_argument("--top-k", type=int, default=5)
    p_search.set_defaults(func=cmd_search)

    p_serve = sub.add_parser("serve", help="Subir servidor HTTP de busca")
    p_serve.add_argument("--store", default="index.json", help="Arquivo do índice")
    p_serve.add_argument("--port", type=int, default=8080)
    p_serve.set_defaults(func=cmd_serve)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
