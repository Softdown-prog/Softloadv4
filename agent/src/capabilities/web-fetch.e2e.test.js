import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { Permissions } from "../security/permissions.js";
import { WebFetchCapability } from "./web-fetch.js";

/**
 * Teste de ponta a ponta GENUÍNO: `fetchImpl` NÃO é substituído (usa o
 * `fetch` global real do Node, valor padrão do construtor) e conversa
 * via HTTP de verdade com um servidor Node real, rodando localmente
 * (diferente de web-fetch.test.js, que injeta `fetchImpl` com
 * respostas fabricadas).
 *
 * Só `resolveHostname` é injetado -- e mesmo assim, não desliga a
 * proteção contra SSRF: ela continua rodando de verdade, só que a
 * RESPOSTA da resolução é fabricada pra devolver um IP "público" de
 * exemplo quando o host pesquisado é "127.0.0.1" (o servidor de teste
 * real desta suíte). Isso não abre brecha nenhuma em produção -- lá,
 * `defaultResolveHostname` (não usado aqui) sempre faz a resolução DNS
 * real, e endereços de loopback continuam sendo bloqueados. A conexão
 * TCP de fato, feita pelo `fetch` real, continua indo pro endereço
 * literal da URL (127.0.0.1) -- só a checagem de SSRF é que "acredita"
 * nesse host sendo público, pra permitir testar contra um servidor
 * real sem reabrir loopback em produção.
 */
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/pagina") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <head><style>body{color:red}</style></head>
          <body>
            <script>alert('nunca deveria aparecer no resultado')</script>
            <h1>Documentação de teste</h1>
            <p>Conteúdo real, servido por um servidor HTTP real.</p>
          </body>
        </html>
      `);
      return;
    }

    if (req.url === "/redireciona") {
      res.writeHead(302, { location: "/pagina" });
      res.end();
      return;
    }

    if (req.url === "/grande") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(50000));
      return;
    }

    if (req.url === "/binario") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.from([0, 1, 2, 3]));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("não encontrado");
  });

  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function buildRealCapability() {
  return new WebFetchCapability({
    permissions: new Permissions({ mode: "full" }),
    // fetchImpl NÃO é passado -- usa o fetch global real.
    resolveHostname: async (hostname) => {
      if (hostname === "127.0.0.1") {
        // Fabricado só pra este teste -- ver comentário do arquivo.
        return [{ address: "93.184.216.34", family: 4 }];
      }
      return [];
    },
  });
}

test("e2e: busca uma página HTML real e converte pra texto legível", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "web.fetch",
    url: `${baseUrl}/pagina`,
  });

  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.ok(!result.content.includes("alert("));
  assert.ok(!result.content.includes("color:red"));
  assert.ok(result.content.toLowerCase().includes("documentação de teste"));
  assert.ok(result.content.includes("Conteúdo real, servido por um servidor HTTP real."));
});

test("e2e: segue um redirecionamento real (302) até o destino final", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "web.fetch",
    url: `${baseUrl}/redireciona`,
  });

  assert.equal(result.url, `${baseUrl}/pagina`);
  assert.equal(result.status, 200);
  assert.ok(result.content.includes("Conteúdo real"));
});

test("e2e: corpo grande de verdade é truncado no maxBytes configurado", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "web.fetch",
    url: `${baseUrl}/grande`,
    maxBytes: 1000,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.bytes, 1000);
  assert.equal(result.content.length, 1000);
});

test("e2e: 404 real do servidor é devolvido normalmente, sem lançar", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "web.fetch",
    url: `${baseUrl}/nao-existe`,
  });

  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.equal(result.content, "não encontrado");
});

test("e2e: conteúdo binário real é rejeitado", async () => {
  const capability = buildRealCapability();

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: `${baseUrl}/binario` }),
    /só suporta conteúdo textual/,
  );
});

test("e2e: sem resolveHostname injetado (comportamento real de produção), loopback é bloqueado", async () => {
  // Prova que a proteção contra SSRF de verdade (dns.lookup real, sem
  // nenhum fake) bloqueia o próprio servidor de teste -- é exatamente
  // esse bloqueio que o resolveHostname fabricado acima contorna só
  // pros outros testes desta suíte.
  const capability = new WebFetchCapability({
    permissions: new Permissions({ mode: "full" }),
  });

  await assert.rejects(
    () => capability.execute({ type: "web.fetch", url: `${baseUrl}/pagina` }),
    /endereço privado\/reservado/,
  );
});
