import type { PermissionGuard, WorkspaceRoot } from "./capability-types.js";

export interface FileTask {
  type: string;
  path: string;
  offset?: number;
  limit?: number;
  content?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  newContent?: string;
  patch?: Record<string, unknown>;
  pattern?: string;
}

interface FileWorkspace extends WorkspaceRoot {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<unknown>;
  writeAtomic(path: string, content: string): Promise<unknown>;
  resolve(path: string): Promise<string>;
  list(path: string): Promise<Array<{ name: string; isDirectory(): boolean }>>;
}

import fs from "node:fs/promises";
import { computeDiff, applyPatch } from "../utils/diff-patch-engine.js";

// Mesmo teto default do Read tool deste próprio Claude Code: sem
// offset/limit explícitos, um arquivo GIGANTE (ex: um bundle gerado,
// um dump de dados) nunca volta inteiro de uma vez só e estoura o
// contexto de quem consumir o resultado — lê as primeiras
// DEFAULT_READ_LIMIT_LINES linhas por padrão, sinalizando `truncated`
// pra quem chamou saber que precisa paginar com outro `offset` se
// quiser o resto.
const DEFAULT_READ_LIMIT_LINES = 2000;

/**
 * FileSystemCapability: expõe operações de arquivo (ler, escrever,
 * deletar, listar, buscar) ao agent, sempre dentro dos limites do
 * Workspace e respeitando as Permissions configuradas.
 */
export class FileSystemCapability {
  declare workspace: FileWorkspace;
  declare permissions: PermissionGuard;

  constructor({ workspace, permissions }: { workspace: FileWorkspace; permissions: PermissionGuard }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  /**
   * Ponto de entrada único, chamado pelo TaskRunner.
   * Verifica permissão ANTES de despachar para o método específico —
   * assim nenhuma operação (mesmo as adicionadas no futuro) escapa
   * do controle de Permissions, desde que passe por este switch.
   */
  async execute(task: FileTask) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "file.read":
        return this.read(task);

      case "file.write":
        return this.write(task);

      case "file.edit":
        return this.edit(task);

      case "file.diff":
        return this.diff(task);

      case "file.patch":
        return this.patch(task);

      case "file.delete":
        return this.delete(task);

      case "file.list":
        return this.list(task);

      case "file.search":
        return this.search(task);

      default:
        // Não deveria acontecer na prática, já que o TaskRouter só
        // encaminha tipos presentes no TASK_MAP — mas serve como
        // proteção extra caso essa capability seja chamada de outro
        // jeito no futuro.
        throw new Error(
          `Operação filesystem desconhecida: ${task.type}`,
        );
    }
  }

  /**
   * Lê o conteúdo de um arquivo (via Workspace, que já valida que
   * `task.path` fica dentro do diretório permitido).
   *
   * Paginado por LINHA, sempre — mesmo sem `offset`/`limit`
   * explícitos, nunca devolve mais que `DEFAULT_READ_LIMIT_LINES` de
   * uma vez (ver constante no topo do arquivo). `offset` é 1-indexado
   * (linha 1 é a primeira), igual ao Read tool deste próprio Claude
   * Code — quem quiser o restante de um arquivo grande pagina com
   * `offset: totalLines_ja_lidas + 1`.
   *
   * `content` continua no mesmo formato de sempre (string) — quem já
   * chamava `file.read` sem passar offset/limit e nunca teve arquivo
   * maior que o limite não percebe nenhuma mudança de comportamento.
   */
  async read(task: FileTask) {
    if (
      task.offset !== undefined &&
      (!Number.isInteger(task.offset) || task.offset! < 1)
    ) {
      throw new Error(
        "file.read: offset deve ser um inteiro >= 1 (linhas são 1-indexadas)",
      );
    }

    if (
      task.limit !== undefined &&
      (!Number.isInteger(task.limit) || task.limit! < 1)
    ) {
      throw new Error(
        "file.read: limit deve ser um inteiro positivo",
      );
    }

    const content = await this.workspace.read(
      task.path,
    );

    const lines = content.split("\n");
    const totalLines = lines.length;
    const offset = task.offset ?? 1;
    const limit = task.limit ?? DEFAULT_READ_LIMIT_LINES;

    const startIndex = offset - 1;
    const selectedLines = lines.slice(
      startIndex,
      startIndex + limit,
    );

    return {
      path: task.path,
      content: selectedLines.join("\n"),
      totalLines,
      offset,
      truncated: startIndex + selectedLines.length < totalLines,
    };
  }

  /**
   * Escreve conteúdo em um arquivo. Valida que `content` é string
   * antes de delegar ao Workspace (que cria diretórios intermediários
   * se necessário).
   */
  async write(task: FileTask) {
    if (typeof task.content !== "string") {
      throw new Error(
        "file.write exige content string",
      );
    }

    await this.workspace.write(
      task.path,
      task.content,
    );

    return {
      path: task.path,
      written: true,
    };
  }

  /**
   * Edita um arquivo por substituição de string EXATA
   * (`oldString` -> `newString`), em vez de reescrever o arquivo
   * inteiro como `file.write` exige. Contrato (mesmo do Edit tool
   * usado por este próprio Claude Code, propositalmente copiado por
   * ser previsível e seguro):
   *
   *  - `oldString` precisa existir no conteúdo atual do arquivo;
   *  - por padrão precisa aparecer EXATAMENTE UMA VEZ — mais de uma
   *    ocorrência é ambíguo (qual delas trocar?) e lança erro em vez
   *    de adivinhar; `replaceAll: true` troca todas de propósito;
   *  - `oldString` e `newString` não podem ser iguais (edição vazia
   *    não faz sentido, quase sempre sinal de bug em quem chamou).
   *
   * Só lê e grava via `workspace.read`/`workspace.write` — nenhuma
   * lógica de path/traversal nova aqui, reaproveita a mesma proteção
   * que `read()`/`write()` já têm através de `Workspace`.
   */
  async edit(task: FileTask) {
    if (
      typeof task.oldString !== "string" ||
      task.oldString.length === 0
    ) {
      throw new Error(
        "file.edit exige oldString (string não vazia)",
      );
    }

    if (typeof task.newString !== "string") {
      throw new Error(
        "file.edit exige newString (string)",
      );
    }

    if (task.oldString === task.newString) {
      throw new Error(
        "file.edit: oldString e newString são idênticos — nada para editar",
      );
    }

    const current = await this.workspace.read(
      task.path,
    );

    // split/join em vez de matchAll: evita lidar com caracteres
    // especiais de regex em oldString (é sempre string literal, não
    // padrão) e já dá a contagem de ocorrências de graça.
    const pieces = current.split(task.oldString);
    const occurrences = pieces.length - 1;

    if (occurrences === 0) {
      throw new Error(
        `file.edit: oldString não encontrado em ${task.path}`,
      );
    }

    if (occurrences > 1 && !task.replaceAll) {
      throw new Error(
        `file.edit: oldString aparece ${occurrences} vezes em ${task.path} — ambíguo. ` +
          "Use replaceAll:true para trocar todas as ocorrências, ou forneça um oldString " +
          "com mais contexto ao redor para identificar uma ocorrência só.",
      );
    }

    // Se chegou aqui sem replaceAll, occurrences já foi confirmado
    // === 1 acima (0 e >1 lançam antes) — String.replace troca só a
    // primeira ocorrência, que é a única que existe nesse caso.
    const updated = task.replaceAll
      ? pieces.join(task.newString)
      : current.replace(task.oldString, task.newString);

    await this.workspace.write(
      task.path,
      updated,
    );

    return {
      path: task.path,
      edited: true,
      occurrences,
    };
  }

  /**
   * Calcula (mas NÃO aplica) o patch estrutural que transforma o
   * conteúdo ATUAL de `task.path` em `task.newContent`, delegando o
   * cálculo pro motor determinístico `diff_patch_engine` (ver
   * utils/diff-patch-engine.js e Power-up/diff_patch_engine.cpp) — a
   * mesma classe de "IA decide O QUE mudar, motor determinístico
   * calcula COMO" já usada no resto do projeto (ver CLAUDE.md
   * princípio #5).
   *
   * Existe como operação separada de `patch()` de propósito: permite
   * pré-visualizar uma mudança (ex: pra um humano revisar via
   * escalation.request, ou pra registrar num log/plano) ANTES de
   * decidir aplicá-la — diferente de `file.write` (sobrescreve sem
   * dar chance de revisão) e `file.edit` (já aplica a troca de uma
   * vez, sem etapa de preview). O objeto `patch` devolvido aqui é
   * exatamente o que `patch()` espera receber de volta.
   */
  async diff(task: FileTask) {
    if (typeof task.newContent !== "string") {
      throw new Error(
        "file.diff exige newContent (string) — o conteúdo completo para o qual o arquivo mudaria",
      );
    }

    const current = await this.workspace.read(
      task.path,
    );

    const patch = await computeDiff(current, task.newContent);

    // Resumo em CARACTERES (não em operações) — mais útil pra decidir
    // rapidamente "essa mudança é grande ou pequena" do que a
    // contagem bruta de blocos equal/delete/insert, que pode ser
    // enganosa (uma única substituição gigante é 1 delete + 1 insert,
    // mas pode reescrever o arquivo inteiro).
    const summary = patch.ops.reduce(
      (acc, op) => {
        if (op.op === "insert") acc.insertedChars += op.text.length;
        else if (op.op === "delete") acc.deletedChars += op.text.length;
        return acc;
      },
      { insertedChars: 0, deletedChars: 0 },
    );

    return {
      path: task.path,
      patch,
      summary,
    };
  }

  /**
   * Aplica um `task.patch` (objeto devolvido por `diff()`, tipicamente
   * depois de revisado) contra o conteúdo ATUAL de `task.path`, e
   * grava o resultado ATOMICAMENTE (`Workspace.writeAtomic()` —
   * arquivo temporário + rename, nunca uma escrita parcial visível).
   *
   * Rejeita (deixa o erro de utils/diff-patch-engine.js propagar, com
   * `exitCode` preservado) se o arquivo mudou desde que o patch foi
   * calculado (hash de origem não confere — `exitCode === 30`) ou se
   * o patch não corresponde ao conteúdo atual por qualquer outro
   * motivo (`exitCode === 40`/`20`) — nunca tenta aplicar "do jeito
   * que dá", mesma regra de ouro do próprio motor (ver
   * Power-up/Observações.md seção 21).
   */
  async patch(task: FileTask) {
    if (
      !task.patch ||
      typeof task.patch !== "object" ||
      Array.isArray(task.patch)
    ) {
      throw new Error(
        "file.patch exige patch (objeto gerado por file.diff)",
      );
    }

    const current = await this.workspace.read(
      task.path,
    );

    const updated = await applyPatch(current, task.patch);

    await this.workspace.writeAtomic(
      task.path,
      updated,
    );

    return {
      path: task.path,
      patched: true,
    };
  }

  /**
   * Remove um arquivo ou diretório (recursivamente, se for
   * diretório). `force: false` significa que tentar deletar um
   * caminho inexistente lança erro, em vez de ser ignorado
   * silenciosamente.
   */
  async delete(task: FileTask) {
    const target = await this.workspace.resolve(
      task.path,
    );

    await fs.rm(target, {
      recursive: true,
      force: false,
    });

    return {
      path: task.path,
      deleted: true,
    };
  }

  /**
   * Lista o conteúdo de um diretório (não-recursivo), mapeando cada
   * entrada para um formato simplificado { name, type }.
   */
  async list(task: FileTask) {
    const entries = await this.workspace.list(
      task.path || ".",
    );

    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? "directory"
        : "file",
    }));
  }

  /**
   * Busca recursiva por arquivos cujo nome contenha `task.pattern`
   * (substring simples, não regex/glob). Se `task.pattern` não for
   * informado, retorna todos os arquivos da árvore.
   *
   * Nota: percorre diretórios recursivamente usando fs.readdir
   * diretamente (não via workspace.list), mas parte de um `root` já
   * validado por workspace.resolve(), então a busca continua restrita
   * ao workspace. Diretórios são visitados sequencialmente (um de
   * cada vez), o que é simples e seguro, mas pode ser lento em
   * árvores muito grandes.
   */
  async search(task: FileTask) {
    const root = await this.workspace.resolve(
      task.path || ".",
    );

    const results: string[] = [];

    async function walk(directory: string): Promise<void> {
      const entries = await fs.readdir(
        directory,
        {
          withFileTypes: true,
        },
      );

      for (const entry of entries) {
        const fullPath = `${directory}/${entry.name}`;

        if (entry.isDirectory()) {
          // Recursão: desce para subdiretórios antes de continuar
          // no nível atual.
          await walk(fullPath);
          continue;
        }

        // Inclui o arquivo se não houver filtro de pattern, ou se
        // o nome do arquivo contiver o pattern como substring.
        if (
          !task.pattern ||
          entry.name.includes(task.pattern)
        ) {
          results.push(
            fullPath,
          );
        }
      }
    }

    await walk(root);

    return results;
  }
}
