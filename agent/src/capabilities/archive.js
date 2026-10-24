/**
 * ArchiveCapability: extração seguindo de arquivos compactados
 * (ZIP nesta primeira etapa; RAR/7z/TAR ficam pra depois). Assim como
 * WebSandboxCapability, esta capability NUNCA descompacta nada dentro
 * do processo do agent -- só repassa os bytes pro serviço isolado
 * sandbox-efemoro/ (mesmo container/credenciais separados do resto
 * do agent, ver sandbox-efemoro/src/archive/) via HTTP, e devolve o
 * resultado estruturado.
 *
 * Por quê o ZIP nunca viaja pelo protocolo externo do agent (POST
 * /run): esse protocolo é JSON com corpo limitado a 1MB (ver
 * server.js) -- um zip de poucos MB já estouraria isso, e base64
 * ainda infla ~33% em cima. Em vez disso, o zip precisa já estar no
 * Workspace do agent (ex: escrito via file.write, ou baixado por
 * outra capability) -- `zipPath`/`destPath` são caminhos relativos ao
 * workspace, mesmo padrão de FileSystemCapability.
 */
export class ArchiveCapability {
  constructor({ workspace, permissions, fetchImpl = fetch } = {}) {
    this.workspace = workspace;
    this.permissions = permissions;
    this.fetchImpl = fetchImpl;
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "archive.extract_zip":
        return this.extractZip(task);

      default:
        throw new Error(
          `Operação archive desconhecida: ${task.type}`,
        );
    }
  }

  /**
   * Extrai `task.zipPath` (já presente no workspace) para dentro de
   * `task.destPath` (também relativo ao workspace), delegando toda a
   * validação de segurança (zip-slip, zip bomb, symlink, profundidade,
   * timeout, disco) ao serviço isolado -- ver
   * sandbox-efemoro/src/archive/extractZip.js.
   *
   * Por contrato do próprio serviço (mesmo critério documentado em
   * WebSandboxCapability.run()), uma resposta HTTP não-ok representa
   * falha de INFRAESTRUTURA (corpo malformado, não autenticado, erro
   * interno) -- vira exceção aqui. Diferente de websandbox.run, uma
   * extração RECUSADA (`success:false` dentro de um 200 normal --
   * zip malicioso, corrompido, acima dos limites) também vira exceção:
   * não existe resultado parcial útil pra devolver (nada é gravado no
   * workspace quando a extração falha), então não há motivo pra exigir
   * do chamador um `if (!result.success)` extra -- um único formato de
   * falha (exceção) é mais simples de tratar.
   */
  async extractZip(task) {
    if (typeof task.zipPath !== "string" || task.zipPath.trim() === "") {
      throw new Error(
        "archive.extract_zip exige zipPath (string, caminho do .zip já presente no workspace)",
      );
    }

    if (typeof task.destPath !== "string" || task.destPath.trim() === "") {
      throw new Error(
        "archive.extract_zip exige destPath (string, diretório de destino relativo ao workspace)",
      );
    }

    const serviceUrl = process.env.SANDBOX_SERVICE_URL;

    if (!serviceUrl) {
      throw new Error(
        "SANDBOX_SERVICE_URL não configurada no ambiente — defina a URL do serviço Cloud Run sandbox-efemoro/.",
      );
    }

    // `null` força Buffer (não string utf8) -- ver Workspace.read();
    // o zip é binário, decodificar como texto corromperia os bytes.
    const zipBuffer = await this.workspace.read(task.zipPath, null);

    const headers = { "Content-Type": "application/octet-stream" };
    const secret = process.env.SANDBOX_SHARED_SECRET;

    if (secret) {
      headers["x-sandbox-secret"] = secret;
    }

    // Só repassa os limites que vieram definidos, deixando o serviço
    // aplicar seus próprios defaults pro resto (mesmo padrão de
    // "não duplicar a política de default em dois lugares" já usado
    // em WebSandboxCapability.run()).
    const params = new URLSearchParams();
    const limitFields = [
      "maxFiles",
      "maxFileBytes",
      "maxTotalBytes",
      "maxCompressedBytes",
      "maxDepth",
      "timeoutMs",
    ];

    for (const field of limitFields) {
      if (task[field] !== undefined) {
        params.set(field, String(task[field]));
      }
    }

    const query = params.toString();
    const url = `${serviceUrl.replace(/\/+$/, "")}/extract-zip${query ? `?${query}` : ""}`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: zipBuffer,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));

      throw new Error(
        `sandbox-efemoro respondeu ${response.status}: ${errorBody.error || errorBody.message || "erro desconhecido"}`,
      );
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(
        `archive.extract_zip: extração recusada — ${result.errors?.[0]?.message || "motivo desconhecido"}`,
      );
    }

    // Grava de volta no workspace só os arquivos de TEXTO -- a
    // heurística de binário (byte nulo) já rodou do lado do serviço
    // isolado. Arquivo binário fica de fora do workspace nesta
    // primeira etapa (escopo: projetos de texto, mesmo critério já
    // documentado em extractZip.js) -- listado em `ignorados` pra
    // quem chamou saber que existia e não foi perdido silenciosamente.
    const destBase = task.destPath.replace(/\/+$/, "");
    const escritos = [];
    const ignorados = [];

    for (const arquivo of result.arquivos) {
      if (arquivo.binario) {
        ignorados.push(arquivo.caminho);
        continue;
      }

      const destinoRelativo = `${destBase}/${arquivo.caminho}`;
      await this.workspace.write(destinoRelativo, arquivo.conteudo);
      escritos.push(destinoRelativo);
    }

    return {
      zipPath: task.zipPath,
      destPath: task.destPath,
      arquivos: escritos,
      ignorados,
      totalArquivos: result.totalArquivos,
    };
  }
}
