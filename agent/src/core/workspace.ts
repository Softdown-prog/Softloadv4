import fs from "node:fs/promises";
import path from "node:path";

/**
 * Workspace: abstrai um diretório raiz isolado onde o agent pode ler,
 * escrever e listar arquivos. Toda operação passa por `resolve()`,
 * que impede que caminhos relativos "escapem" do diretório raiz
 * (proteção contra path traversal, ex: "../../etc/passwd").
 */
export class Workspace {
  declare root: string;

  constructor({ root }: { root: string }) {
    // Normaliza e resolve o root para um caminho absoluto, garantindo
    // uma base consistente para todas as comparações feitas depois.
    this.root = path.resolve(root);
  }

  /**
   * Cria o diretório raiz do workspace caso ainda não exista
   * (incluindo diretórios intermediários, graças a `recursive: true`).
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.root, {
      recursive: true,
    });
  }

  /**
   * Resolve um caminho relativo para um caminho absoluto DENTRO do
   * workspace, lançando erro se o resultado ficar fora dele.
   *
   * Estratégia (duas fases):
   * 1. TEXTUAL: resolve `relativePath` em relação a `this.root` e
   *    calcula o caminho relativo entre `root` e o `target`. Se esse
   *    caminho relativo começar com ".." (subiu um nível acima do
   *    root) ou for absoluto (caso de path.relative não encontrar
   *    prefixo comum, ex: em outro drive no Windows), bloqueia. Isso
   *    também cobre `relativePath` já vir como caminho absoluto (ex:
   *    "/etc/passwd"): path.resolve ignora o root nesse caso, mas o
   *    path.relative resultante começa com ".." e cai no bloqueio
   *    mesmo assim.
   * 2. REAL (achado real, corrigido aqui — antes só existia a fase
   *    textual, documentada como limitação conhecida): segue
   *    symlinks de verdade via fs.realpath() e confirma que o
   *    caminho REAL (não só o textual) continua dentro do root REAL.
   *    Sem isso, um symlink criado DENTRO do workspace apontando pra
   *    fora (ex: por um `npm install` malicioso via build.js/
   *    package.js, já que ambos ficaram ligados nesta rodada) faria
   *    o `target` passar pela fase 1 (textualmente dentro do
   *    workspace) mas o SO seguiria o symlink e leria/escreveria
   *    fora dele de verdade.
   */
  async resolve(relativePath: string = "."): Promise<string> {
    const target = path.resolve(
      this.root,
      relativePath,
    );

    const relative = path.relative(
      this.root,
      target,
    );

    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Caminho fora do workspace: ${relativePath}`,
      );
    }

    const realRoot = await fs.realpath(this.root);
    const realTarget = await this._realpathTolerant(target);

    const realRelative = path.relative(realRoot, realTarget);

    if (
      realRelative.startsWith("..") ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error(
        `Caminho fora do workspace (symlink escapa do root): ${relativePath}`,
      );
    }

    return target;
  }

  /**
   * fs.realpath() exige que o caminho exista — mas write() (e o
   * próprio resolve() acima, chamado antes de criar um arquivo novo)
   * frequentemente recebe um caminho que AINDA NÃO existe no disco.
   * Sobe a árvore de diretórios até achar o ancestral mais profundo
   * que já existe, resolve os symlinks REAIS só dele, e recoloca por
   * cima os segmentos finais que ainda não existem — esses não podem
   * ser symlink (não existem), então são seguros de anexar como
   * texto puro.
   */
  async _realpathTolerant(target: string): Promise<string> {
    const segments: string[] = [];
    let current = target;

    while (true) {
      try {
        const real = await fs.realpath(current);
        return segments.length > 0
          ? path.join(real, ...segments)
          : real;
      } catch (err) {
        if ((err as { code?: string }).code !== "ENOENT" && (err as { code?: string }).code !== "ENOTDIR") {
          throw err;
        }

        const parent = path.dirname(current);

        if (parent === current) {
          // Chegou na raiz do sistema de arquivos sem achar nada que
          // exista — não deveria acontecer na prática (o root do
          // workspace sempre existe depois de initialize()), mas
          // devolve o target sem seguir symlink nenhum; a checagem
          // de prefixo em resolve() decide o resto.
          return target;
        }

        segments.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  /**
   * Verifica se um caminho existe dentro do workspace.
   * Retorna false tanto se o arquivo não existir quanto se o
   * caminho for inválido/fora do workspace (resolve() lançaria erro,
   * capturado pelo catch).
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(
        await this.resolve(relativePath),
      );

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lê o conteúdo de um arquivo dentro do workspace.
   * `encoding` default "utf8" retorna string; passar `null`
   * retornaria um Buffer, se necessário no futuro.
   */
  read(relativePath: string): Promise<string>;
  read(relativePath: string, encoding: "utf8"): Promise<string>;
  read(relativePath: string, encoding: null): Promise<Uint8Array>;
  async read(relativePath: string, encoding: "utf8" | null = "utf8"): Promise<string | Uint8Array> {
    return fs.readFile(
      await this.resolve(relativePath),
      encoding,
    );
  }

  /**
   * Escreve conteúdo em um arquivo dentro do workspace, criando
   * automaticamente os diretórios intermediários necessários.
   * Sempre grava como utf8.
   */
  async write(relativePath: string, content: string): Promise<{ path: string }> {
    const target = await this.resolve(relativePath);

    await fs.mkdir(
      path.dirname(target),
      {
        recursive: true,
      },
    );

    await fs.writeFile(
      target,
      content,
      "utf8",
    );

    return {
      path: target,
    };
  }

  /**
   * Escreve conteúdo em um arquivo dentro do workspace de forma
   * ATÔMICA: grava num arquivo temporário no MESMO diretório do
   * destino (garante que `fs.rename` fica na mesma partição/
   * filesystem, requisito pra rename ser atômico de verdade — mover
   * entre filesystems diferentes vira copy+delete por baixo, perdendo
   * a garantia) e só então substitui o destino com `fs.rename`.
   *
   * Usado por FileSystemCapability.patch() (ver capabilities/
   * filesystem.js) — o resultado de aplicar um patch só deve
   * aparecer no arquivo real de uma vez, nunca parcialmente escrito
   * (ex: se o processo morrer no meio da escrita). `write()` comum
   * (acima) não tem essa garantia — grava direto no destino.
   *
   * Mesmo padrão de nome de arquivo temporário do resto do projeto
   * (prefixo com timestamp+random pra nunca colidir com uma escrita
   * concorrente do mesmo path).
   */
  async writeAtomic(relativePath: string, content: string): Promise<{ path: string }> {
    const target = await this.resolve(relativePath);
    const dir = path.dirname(target);

    await fs.mkdir(dir, {
      recursive: true,
    });

    const tmpPath = path.join(
      dir,
      `.${path.basename(target)}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    await fs.writeFile(
      tmpPath,
      content,
      "utf8",
    );

    try {
      await fs.rename(tmpPath, target);
    } catch (err) {
      // Nunca deixa o arquivo temporário pra trás se o rename falhar
      // (ex: permissão, disco cheio) — melhor limpar e propagar o
      // erro original do que acumular lixo no workspace.
      await fs.rm(tmpPath, { force: true });
      throw err;
    }

    return {
      path: target,
    };
  }

  /**
   * Lista o conteúdo de um diretório dentro do workspace.
   * `withFileTypes: true` retorna objetos Dirent (permite checar
   * facilmente se cada entrada é arquivo, diretório, symlink, etc.
   * via `.isFile()` / `.isDirectory()`).
   */
  async list(relativePath: string = ".") {
    return fs.readdir(
      await this.resolve(relativePath),
      {
        withFileTypes: true,
      },
    );
  }
}
