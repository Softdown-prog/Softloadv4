> ⚠️ NOTA (revisão posterior): as observações abaixo motivaram a
> implementação real em `server.py` (mesma pasta) -- serviço HTTP de
> produção que roda isolado em Cloud Run, gera embeddings via API
> Gemini e não guarda estado local (quem escreve os vetores no
> Firestore é o pipeline Node em `src/solaris/rag/` e
> `scripts/ragEmbedIndex.js`, não este serviço). `prototipo_local.py`
> (a versão anterior a esta revisão, com o índice em JSON local) foi
> mantido só como registro histórico. Ver `README.md` desta pasta para
> a arquitetura de fato implementada.

solaris.md — Observações de Código: gemini_embeddings_store.py
Este documento contém a análise técnica, os pontos fortes, os bugs críticos identificados e as recomendações de refatoração para o serviço/CLI em Python de geração e busca de embeddings usando a API oficial do Gemini.
1. Visão Geral e Pontos Fortes
O script gemini_embeddings_store.py apresenta uma arquitetura limpa, moderna e bem alinhada com as boas práticas de desenvolvimento em Python e integração com LLMs.
 * SDK Oficial e Atualizada: Uso da biblioteca oficial e recente google-genai (genai.Client), dispensando dependências legadas (google-generativeai).
 * Diferenciação de task_type: Uso correto de RETRIEVAL_DOCUMENT na etapa de indexação e RETRIEVAL_QUERY no momento da busca, o que otimiza drasticamente a precisão da recuperação vetorial na API do Gemini.
 * Busca Vetorizada Eficiente: Implementação da similaridade de cosseno via produto escalar com numpy (matrix @ q), garantindo altíssima velocidade em buscas locais.
 * Resiliência e Retentativa: Mecanismo de exponential backoff (wait = 2 ** attempt) no loteamento de embeddings, prevenindo falhas por limites de taxa (rate limits) ou instabilidades temporárias de rede.
 * Autonomia e Portabilidade: Inclusão de um servidor HTTP minimalista nativo (http.server) e CLI estruturada com argparse, permitindo fácil integração com outros serviços ou contêineres sem depender de frameworks pesados.
2. Correções Críticas (Bugs Identificados)
🔴 2.1. Modelo de Embedding Desatualizado
 * Localização: Variável global EMBEDDING_MODEL.
 * Problema: O código utiliza "gemini-embedding-001". Este nome de modelo está descontinuado na API e pode retornar erros de modelo não encontrado (404 Not Found).
 * Solução: Atualizar para o modelo padrão de produção da Google, text-embedding-004.
# Incorreto:
EMBEDDING_MODEL = "gemini-embedding-001"

# Correto:
EMBEDDING_MODEL = "text-embedding-004"

🔴 2.2. Duplicação de Chunks no Re-indexamento
 * Localização: Função cmd_index.
 * Problema: A função carrega o banco existente com VectorStore.load(args.store) e adiciona os novos chunks no mesmo vetor com store.add(...). Caso o comando de indexação seja executado mais de uma vez na mesma pasta, os trechos e vetores serão duplicados indefinidamente no arquivo JSON, aumentando o tempo de busca e corrompendo os resultados.
 * Solução: Instanciar um VectorStore() limpo no comando de indexação para substituir o índice antigo, ou adicionar verificação por ID para atualizar/ignorar chunks já existentes.
# Ajuste simples para re-indexação limpa:
def cmd_index(args: argparse.Namespace) -> None:
    client = get_client()
    store = VectorStore()  # Cria um novo índice limpo para a pasta

3. Melhorias Recomendadas
🟡 3.1. Chunking com Preservação de Linhas
 * Problema: A função chunk_text atual realiza cortes rígidos por contagem de caracteres (text[start:end]), o que pode fatiar palavras, identificadores de código ou funções no meio.
 * Solução: Ajustar a lógica para realizar o corte preferencialmente na última quebra de linha (\n) dentro da Janela do Chunk.
def chunk_text(text: str, size: int = CHUNK_SIZE_CHARS, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if len(text) <= size:
        return [text]
    
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        if end >= len(text):
            chunks.append(text[start:].strip())
            break
        
        # Procura a última quebra de linha no bloco para não cortar código no meio
        break_pos = text.rfind("\n", start, end)
        if break_pos != -1 and break_pos > start:
            end = break_pos
            
        chunks.append(text[start:end].strip())
        start = max(end - overlap, start + 1)
        
    return [c for c in chunks if c]

4. Código Refatorado com Correções
Abaixo está a versão consolidada da aplicação Python incorporando as correções do modelo text-embedding-004, limpeza no re-indexamento e chunking inteligente por linha:
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

EMBEDDING_MODEL = "text-embedding-004"  # Modelo de embeddings de produção do Gemini
EMBEDDING_DIM = 768
CHUNK_SIZE_CHARS = 1500
CHUNK_OVERLAP = 200
TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".md", ".txt", ".json",
    ".yaml", ".yml", ".html", ".css", ".java", ".go", ".rs", ".c", ".cpp", ".h",
}


def get_client() -> genai.Client:
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
    source: str
    text: str
    embedding: List[float]


class VectorStore:
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
    def load(cls, path: str) -> VectorStore:
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
    client: genai.Client,
    texts: List[str],
    task_type: str = "RETRIEVAL_DOCUMENT",
    max_retries: int = 3,
) -> List[List[float]]:
    embeddings: List[List[float]] = []
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
            except Exception as exc:
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

def chunk_text(text: str, size: int = CHUNK_SIZE_CHARS, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if len(text) <= size:
        return [text]
    
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        if end >= len(text):
            chunks.append(text[start:].strip())
            break
        
        break_pos = text.rfind("\n", start, end)
        if break_pos != -1 and break_pos > start:
            end = break_pos
            
        chunks.append(text[start:end].strip())
        start = max(end - overlap, start + 1)
        
    return [c for c in chunks if c]


def iter_source_files(path: Path):
    if path.is_file():
        if path.suffix in TEXT_EXTENSIONS:
            yield path
        return
    for p in path.rglob("*"):
        if p.is_file() and p.suffix in TEXT_EXTENSIONS:
            if any(part in {"node_modules", ".git", "venv", "__pycache__"} for part in p.parts):
                continue
            yield p


# --------------------------------------------------------------------------
# Comandos de CLI
# --------------------------------------------------------------------------

def cmd_index(args: argparse.Namespace) -> None:
    client = get_client()
    store = VectorStore()  # Índice limpo para prevenir duplicações

    root = Path(args.path)
    files = list(iter_source_files(root))
    if not files:
        print("Nenhum arquivo de texto encontrado para indexar.")
        return

    all_chunks_text: List[str] = []
    all_chunks_meta: List[tuple] = []

    for f in files:
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:
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
    client = get_client()
    store = VectorStore.load(args.store)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
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

        def log_message(self, format, *fmt_args):
            pass

    with socketserver.TCPServer(("0.0.0.0", args.port), Handler) as httpd:
        print(f"Servindo busca de embeddings em http://0.0.0.0:{args.port}/search?q=...")
        httpd.serve_forever()


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

