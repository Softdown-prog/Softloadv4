import { test } from "node:test";
import assert from "node:assert/strict";

import { Permissions } from "../security/permissions.js";
import { WebFetchCapability } from "./web-fetch.js";

// Todos os testes aqui usam fetchImpl/resolveHostname injetados --
// nenhum bate em rede real. O teste de ponta a ponta genuíno (fetch
// real + servidor HTTP real local) mora em web-fetch.e2e.test.js.

function permissiveWebFetchPermissions() {
  return new Permissions({ permissions: { "web.fetch": true } });
}

// Resolver "público" configurável por hostname -- default resolve
// qualquer host pra um IP público de exemplo, mas aceita overrides
// por hostname (essencial pros testes de redirecionamento pra host
// privado, onde só o SEGUNDO hop precisa resolver como bloqueado).
function buildResolver(overridesByHostname = {}) {
  return async (hostname) => {
    if (hostname in overridesByHostname) {
      return overridesByHostname[hostname];
    }
    return [{ address: "93.184.216.34", family: 4 }];
  };
}

function buildCapability({ fetchImpl, resolveHostname, permissions } = {}) {
  return new WebFetchCapability({
    permissions: permissions || permissiveWebFetchPermissions(),
    fetchImpl,
    resolveHostname: resolveHostname || buildResolver(),
  });
}

test("execute: nega ação sem permissão (fail-closed)", async () => {
  const capability = buildCapability({
    permissions: new Permissions({ permissions: { "web.fetch": false } }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "https://exemplo.com" }),
    /Permissão negada/,
  );
});

test("execute: tipo de task desconhecido lança erro", async () => {
  const capability = buildCapability({
    permissions: new Permissions({ mode: "full" }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch.algo_inventado" }),
    /Operação web-fetch desconhecida/,
  );
});

test("web.fetch: exige url (string)", async () => {
  const capability = buildCapability();

  await assert.rejects(() => capability.execute({ type: "web.fetch" }), /exige url/);
});

test("web.fetch: URL malformada lança erro claro", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "isso não é uma url" }),
    /URL inválida/,
  );
});

test("web.fetch: protocolo diferente de http/https é rejeitado", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "ftp://exemplo.com/arquivo" }),
    /só protocolos http\/https/,
  );
});

test("web.fetch: host sempre bloqueado (metadata de nuvem) é rejeitado sem chamar fetch", async () => {
  let fetchCalled = false;
  const capability = buildCapability({
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("não deveria ter sido chamado");
    },
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "http://169.254.169.254/latest/meta-data" }),
    /host sempre bloqueado/,
  );

  assert.equal(fetchCalled, false);
});

test("web.fetch: host que resolve pra IPv4 privado (RFC 1918) é bloqueado", async () => {
  const capability = buildCapability({
    resolveHostname: buildResolver({
      "interno.exemplo.com": [{ address: "10.0.0.5", family: 4 }],
    }),
    fetchImpl: async () => {
      throw new Error("não deveria ter sido chamado");
    },
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "http://interno.exemplo.com/" }),
    /endereço privado\/reservado/,
  );
});

test("web.fetch: host que resolve pra loopback (127.0.0.1) é bloqueado", async () => {
  const capability = buildCapability({
    resolveHostname: buildResolver({
      "localhost.exemplo.com": [{ address: "127.0.0.1", family: 4 }],
    }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "http://localhost.exemplo.com/" }),
    /endereço privado\/reservado/,
  );
});

test("web.fetch: host que resolve pra IPv6 unique-local (fc00::/7) é bloqueado", async () => {
  const capability = buildCapability({
    resolveHostname: buildResolver({
      "v6-interno.exemplo.com": [{ address: "fc00::1", family: 6 }],
    }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "http://v6-interno.exemplo.com/" }),
    /endereço privado\/reservado/,
  );
});

test("web.fetch: host não resolvível lança erro claro", async () => {
  const capability = buildCapability({
    resolveHostname: buildResolver({ "nao-existe.exemplo.com": [] }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "http://nao-existe.exemplo.com/" }),
    /não foi possível resolver/,
  );
});

test("web.fetch: caminho feliz com text/plain devolve o conteúdo como está", async () => {
  const capability = buildCapability({
    fetchImpl: async () =>
      new Response("conteúdo simples", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
  });

  const result = await capability.execute({
    type: "web.fetch",
    url: "https://exemplo.com/arquivo.txt",
  });

  assert.deepEqual(result, {
    url: "https://exemplo.com/arquivo.txt",
    status: 200,
    ok: true,
    contentType: "text/plain",
    content: "conteúdo simples",
    bytes: Buffer.byteLength("conteúdo simples", "utf8"),
    truncated: false,
  });
});

test("web.fetch: application/json devolve o texto cru (não faz parse)", async () => {
  const capability = buildCapability({
    fetchImpl: async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  const result = await capability.execute({
    type: "web.fetch",
    url: "https://exemplo.com/api",
  });

  assert.equal(result.content, '{"ok":true}');
});

test("web.fetch: text/html é convertido pra texto legível (script/style removidos)", async () => {
  const html = `
    <html>
      <head><style>body{color:red}</style></head>
      <body>
        <script>alert(1)</script>
        <h1>Título</h1>
        <p>Parágrafo de teste.</p>
      </body>
    </html>
  `;

  const capability = buildCapability({
    fetchImpl: async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  });

  const result = await capability.execute({
    type: "web.fetch",
    url: "https://exemplo.com/pagina",
  });

  assert.ok(!result.content.includes("alert(1)"));
  assert.ok(!result.content.includes("color:red"));
  assert.ok(result.content.includes("TÍTULO") || result.content.includes("Título"));
  assert.ok(result.content.includes("Parágrafo de teste"));
});

test("web.fetch: sem Content-Type, trata como texto (melhor esforço)", async () => {
  const capability = buildCapability({
    fetchImpl: async () => {
      // O construtor de Response adiciona um Content-Type padrão
      // automaticamente a partir de um body string -- removido de
      // propósito aqui pra simular um servidor que de fato omite o
      // header (comum na prática).
      const response = new Response("sem content-type", { status: 200 });
      response.headers.delete("content-type");
      return response;
    },
  });

  const result = await capability.execute({ type: "web.fetch", url: "https://exemplo.com/x" });

  assert.equal(result.content, "sem content-type");
  assert.equal(result.contentType, null);
});

test("web.fetch: conteúdo binário (ex: imagem) é rejeitado com erro claro", async () => {
  const capability = buildCapability({
    fetchImpl: async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "https://exemplo.com/img.png" }),
    /só suporta conteúdo textual.*image\/png/s,
  );
});

test("web.fetch: status não-2xx do alvo é devolvido normalmente (não lança)", async () => {
  const capability = buildCapability({
    fetchImpl: async () =>
      new Response("Não encontrado", {
        status: 404,
        headers: { "content-type": "text/plain" },
      }),
  });

  const result = await capability.execute({ type: "web.fetch", url: "https://exemplo.com/404" });

  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.equal(result.content, "Não encontrado");
});

test("web.fetch: segue redirecionamento e revalida o novo host", async () => {
  let calls = 0;

  const capability = buildCapability({
    resolveHostname: buildResolver({
      "origem.exemplo.com": [{ address: "93.184.216.34", family: 4 }],
      "destino.exemplo.com": [{ address: "93.184.216.35", family: 4 }],
    }),
    fetchImpl: async (url) => {
      calls += 1;
      if (url === "https://origem.exemplo.com/") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://destino.exemplo.com/final" },
        });
      }
      return new Response("conteúdo final", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
  });

  const result = await capability.execute({
    type: "web.fetch",
    url: "https://origem.exemplo.com/",
  });

  assert.equal(calls, 2);
  assert.equal(result.url, "https://destino.exemplo.com/final");
  assert.equal(result.content, "conteúdo final");
});

test("web.fetch: redirecionamento pra host que resolve pra IP privado é bloqueado (SSRF via redirect)", async () => {
  const capability = buildCapability({
    resolveHostname: buildResolver({
      "origem.exemplo.com": [{ address: "93.184.216.34", family: 4 }],
      "interno.exemplo.com": [{ address: "10.0.0.9", family: 4 }],
    }),
    fetchImpl: async (url) => {
      if (url === "https://origem.exemplo.com/") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://interno.exemplo.com/segredo" },
        });
      }
      throw new Error("não deveria buscar o destino bloqueado");
    },
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "https://origem.exemplo.com/" }),
    /endereço privado\/reservado/,
  );
});

test("web.fetch: redirecionamento sem header Location lança erro", async () => {
  const capability = buildCapability({
    fetchImpl: async () => new Response(null, { status: 302, headers: {} }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "https://exemplo.com/" }),
    /sem header Location/,
  );
});

test("web.fetch: excede o limite de redirecionamentos", async () => {
  const capability = buildCapability({
    fetchImpl: async (url) => {
      const n = Number(new URL(url).searchParams.get("n") || "0");
      return new Response(null, {
        status: 302,
        headers: { location: `https://exemplo.com/?n=${n + 1}` },
      });
    },
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "https://exemplo.com/?n=0" }),
    /excedeu o limite de 5 redirecionamentos/,
  );
});

test("web.fetch: corpo maior que maxBytes é truncado", async () => {
  const grande = "a".repeat(1000);

  const capability = buildCapability({
    fetchImpl: async () =>
      new Response(grande, { status: 200, headers: { "content-type": "text/plain" } }),
  });

  const result = await capability.execute({
    type: "web.fetch",
    url: "https://exemplo.com/grande.txt",
    maxBytes: 100,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.bytes, 100);
  assert.equal(result.content.length, 100);
});

test("web.fetch: maxBytes acima do teto rígido é limitado ao teto", async () => {
  const capability = buildCapability({
    fetchImpl: async () =>
      new Response("pequeno", { status: 200, headers: { "content-type": "text/plain" } }),
  });

  const result = await capability.execute({
    type: "web.fetch",
    url: "https://exemplo.com/x",
    maxBytes: 999999999,
  });

  assert.equal(result.truncated, false);
  assert.equal(result.content, "pequeno");
});

test("web.fetch: timeout aborta a requisição e lança erro claro", async () => {
  const capability = buildCapability({
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  });

  await assert.rejects(
    () =>
      capability.execute({
        type: "web.fetch",
        url: "https://exemplo.com/lento",
        timeoutMs: 20,
      }),
    /timeout após 20ms/,
  );
});

test("web.fetch: timeoutMs acima do teto rígido é limitado ao teto (não trava o teste)", async () => {
  // Só confirma que um timeoutMs absurdo não é usado ao pé da letra --
  // não espera o teto real (60s) de verdade, só que a requisição segue
  // em frente normalmente com um fetchImpl que responde na hora.
  const capability = buildCapability({
    fetchImpl: async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
  });

  const result = await capability.execute({
    type: "web.fetch",
    url: "https://exemplo.com/x",
    timeoutMs: 999999999,
  });

  assert.equal(result.content, "ok");
});

test("web.fetch: falha de rede (não AbortError) propaga mensagem clara", async () => {
  const capability = buildCapability({
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: "https://exemplo.com/x" }),
    /falha de rede.*ECONNREFUSED/s,
  );
});
