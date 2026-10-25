import type { PermissionGuard, CapabilityFetch } from "./capability-types.js";

declare const process: { env: Record<string, string | undefined> };

export interface KnowledgeSearchTask {
  type: string;
  query?: string;
  topK?: number;
  corpus?: string;
}

/**
 * KnowledgeSearchCapability: fala com o endpoint interno do app
 * principal (`POST /internal/solaris/rag/buscar`,
 * src/routes/apiRoutes.js) via HTTP, que por sua vez usa o pipeline
 * de embeddings já existente (src/solaris/rag/ragEmbeddingsClient.js +
 * ragVectorStore.js) para busca SEMÂNTICA no catálogo RAG do Solaris —
 * diferente de `code.search` (grep local) e `web.search` (Gemini +
 * Google Search Grounding, conteúdo externo).
 *
 * Esta capability não fala com Firestore nem com a API Gemini
 * diretamente — só repassa a requisição pro app principal, que já tem
 * as credenciais de Firestore (o agent/ continua sem nenhuma).
 */
export class KnowledgeSearchCapability {
  declare permissions: PermissionGuard | undefined;
  declare fetchImpl: CapabilityFetch;

  constructor({ permissions, fetchImpl = fetch }: { permissions?: PermissionGuard; fetchImpl?: CapabilityFetch } = {}) {
    this.permissions = permissions;
    this.fetchImpl = fetchImpl;
  }

  async execute(task: KnowledgeSearchTask) {
    this.permissions!.require(task.type);

    switch (task.type) {
      case "knowledge.search":
        return this.search(task);

      default:
        throw new Error(
          `Operação knowledge-search desconhecida: ${task.type}`,
        );
    }
  }

  async search(task: KnowledgeSearchTask) {
    if (typeof task.query !== "string" || task.query.trim() === "") {
      throw new Error("knowledge.search exige query (string não vazia)");
    }

    const serviceUrl = process.env.SOLARIS_RAG_SEARCH_URL;

    if (!serviceUrl) {
      throw new Error(
        "SOLARIS_RAG_SEARCH_URL não configurada no ambiente — defina a URL do app principal (endpoint POST /internal/solaris/rag/buscar).",
      );
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = process.env.SOLARIS_RAG_SEARCH_SECRET;

    if (secret) {
      headers["x-solaris-rag-search-secret"] = secret;
    }

    const body = { query: task.query, topK: task.topK, corpus: task.corpus };

    for (const key of Object.keys(body)) {
      if (body[key as keyof typeof body] === undefined) {
        delete (body as Record<string, unknown>)[key];
      }
    }

    const response = await this.fetchImpl(
      `${serviceUrl.replace(/\/+$/, "")}/internal/solaris/rag/buscar`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));

      throw new Error(
        `busca no catálogo RAG respondeu ${response.status}: ${errorBody.erro || "erro desconhecido"}`,
      );
    }

    return response.json();
  }
}
