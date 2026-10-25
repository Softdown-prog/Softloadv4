import { resolveSandboxEndpoint } from "../config/sandbox-endpoints.js";

/**
 * WebSandboxCapability: fala com o serviço isolado sandbox-efemoro/
 * (Playwright rodando num container/credenciais separados do resto
 * do agent, ver sandbox-efemoro/README.md) via HTTP. Esta capability
 * NUNCA roda um navegador dentro do processo do agent — só repassa a
 * requisição pro serviço e devolve o resultado estruturado.
 *
 * Não recebe `workspace`: a URL auditada é sempre uma URL já ativa
 * (ex: um preview local servido por outra etapa do pipeline), nunca
 * um caminho de arquivo dentro do workspace do agent.
 */
export class WebSandboxCapability {
  constructor({ permissions, fetchImpl = fetch } = {}) {
    this.permissions = permissions;
    this.fetchImpl = fetchImpl;
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "websandbox.run":
        return this.run(task);

      default:
        throw new Error(
          `Operação web-sandbox desconhecida: ${task.type}`,
        );
    }
  }

  /**
   * Roda uma auditoria de navegador (screenshot, console, rede,
   * responsividade, acessibilidade) contra `task.url`, delegando ao
   * serviço sandbox-efemoro/ via `POST /run`.
   *
   * Por contrato do próprio serviço (ver sandbox-efemoro/README.md),
   * uma resposta HTTP não-ok representa falha de INFRAESTRUTURA
   * (corpo malformado, não autenticado, erro interno) — nunca a
   * falha da auditoria em si (página não carregou, etc.), que volta
   * como `{success:false, errors:[...]}` dentro de um 200 normal.
   * Só o primeiro caso vira exceção aqui; o segundo é devolvido como
   * está, para quem chamou decidir o que fazer.
   */
  async run(task) {
    if (typeof task.url !== "string" || task.url.trim() === "") {
      throw new Error("websandbox.run exige url (string)");
    }

    const { serviceUrl, secret } = resolveSandboxEndpoint("browser");

    if (!serviceUrl) {
      throw new Error(
        "SANDBOX_SERVICE_URL não configurada no ambiente — defina a URL do serviço Cloud Run sandbox-efemoro/.",
      );
    }

    const headers = { "Content-Type": "application/json" };
    if (secret) {
      headers["x-sandbox-secret"] = secret;
    }

    // Só repassa os campos que o serviço realmente aceita (ver
    // sandbox-efemoro/src/webSandbox/security.js) — e só os que
    // vieram definidos, deixando o serviço aplicar seus próprios
    // defaults para o resto (mesmo padrão de "não duplicar a
    // política de default em dois lugares").
    const body = {
      url: task.url,
      browser: task.browser,
      device: task.device,
      viewport: task.viewport,
      screenshot: task.screenshot,
      // A API continua compatível com `path`, mas o Agent roda em OUTRO
      // container; por isso solicita bytes reais em vez de /tmp local.
      screenshotDelivery: task.screenshot === false ? undefined : "inline",
      accessibility: task.accessibility,
      allowedHosts: task.allowedHosts,
      timeout: task.timeout,
    };

    for (const key of Object.keys(body)) {
      if (body[key] === undefined) {
        delete body[key];
      }
    }

    const response = await this.fetchImpl(
      `${serviceUrl}/run`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));

      throw new Error(
        `sandbox-efemoro respondeu ${response.status}: ${errorBody.error || "erro desconhecido"}`,
      );
    }

    const result = await response.json();
    const image = result?.screenshot;
    if (image != null) {
      // Fronteira de confiança: impede imagem adulterada ou payload gigante.
      const encoded = image.dataBase64;
      const declaredBytes = image.bytes;
      const actualBytes = typeof encoded === "string"
        ? Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0)
        : -1;
      if (
        image.mimeType !== "image/png" ||
        typeof encoded !== "string" ||
        !encoded.startsWith("iVBORw0KGgo") ||
        encoded.length > 5592408 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
        typeof declaredBytes !== "number" ||
        !Number.isSafeInteger(declaredBytes) ||
        declaredBytes !== actualBytes ||
        declaredBytes > 4 * 1024 * 1024 ||
        typeof image.fullPage !== "boolean"
      ) {
        throw new Error("sandbox-efemoro retornou PNG inline inválido ou grande demais");
      }
    }
    return result;
  }
}
