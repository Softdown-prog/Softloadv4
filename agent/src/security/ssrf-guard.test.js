import { test } from "node:test";
import assert from "node:assert/strict";

import { assertUrlIsFetchable } from "./ssrf-guard.js";

function resolver(map) {
  return async (hostname) => map[hostname] || [{ address: "93.184.216.34", family: 4 }];
}

test("aceita URL pública http/https com resolução pública", async () => {
  const url = await assertUrlIsFetchable("https://exemplo.com/pagina", {
    resolveHostname: resolver({}),
  });

  assert.equal(url.toString(), "https://exemplo.com/pagina");
});

test("usa o label informado no prefixo das mensagens de erro", async () => {
  await assert.rejects(
    () => assertUrlIsFetchable("ftp://exemplo.com", { label: "meu-consumidor" }),
    /^Error: meu-consumidor: só protocolos http\/https/,
  );
});

test("label default é 'ssrf-guard' quando não informado", async () => {
  await assert.rejects(
    () => assertUrlIsFetchable("ftp://exemplo.com"),
    /^Error: ssrf-guard: só protocolos http\/https/,
  );
});

test("rejeita protocolo diferente de http/https", async () => {
  await assert.rejects(
    () => assertUrlIsFetchable("file:///etc/passwd", { resolveHostname: resolver({}) }),
    /só protocolos http\/https/,
  );
});

test("rejeita URL malformada", async () => {
  await assert.rejects(
    () => assertUrlIsFetchable("não é uma url", { resolveHostname: resolver({}) }),
    /URL inválida/,
  );
});

test("rejeita hosts sempre bloqueados (metadata de nuvem) sem consultar resolveHostname", async () => {
  let called = false;

  await assert.rejects(
    () =>
      assertUrlIsFetchable("http://169.254.169.254/latest/meta-data", {
        resolveHostname: async () => {
          called = true;
          return [];
        },
      }),
    /host sempre bloqueado/,
  );

  assert.equal(called, false);
});

test("rejeita host que não resolve pra nenhum endereço", async () => {
  await assert.rejects(
    () =>
      assertUrlIsFetchable("http://nao-existe.exemplo.com", {
        resolveHostname: resolver({ "nao-existe.exemplo.com": [] }),
      }),
    /não foi possível resolver/,
  );
});

const IPV4_BLOCKED = [
  ["0.0.0.1", "0.0.0.0/8"],
  ["10.1.2.3", "10.0.0.0/8"],
  ["127.0.0.1", "127.0.0.0/8 loopback"],
  ["169.254.169.254", "169.254.0.0/16 link-local/metadata"],
  ["172.16.0.1", "172.16.0.0/12"],
  ["172.31.255.255", "172.16.0.0/12 (limite superior)"],
  ["192.168.1.1", "192.168.0.0/16"],
  ["100.64.0.1", "100.64.0.0/10 CGNAT"],
  ["198.18.0.1", "198.18.0.0/15 benchmarking"],
  ["224.0.0.1", "multicast/reservado"],
];

for (const [address, description] of IPV4_BLOCKED) {
  test(`bloqueia IPv4 privado/reservado: ${address} (${description})`, async () => {
    await assert.rejects(
      () =>
        assertUrlIsFetchable("http://alvo.exemplo.com", {
          resolveHostname: resolver({ "alvo.exemplo.com": [{ address, family: 4 }] }),
        }),
      /endereço privado\/reservado/,
    );
  });
}

test("permite IPv4 público comum", async () => {
  await assertUrlIsFetchable("http://alvo.exemplo.com", {
    resolveHostname: resolver({
      "alvo.exemplo.com": [{ address: "93.184.216.34", family: 4 }],
    }),
  });
});

const IPV6_BLOCKED = [
  ["::1", "loopback"],
  ["::", "unspecified"],
  ["fc00::1", "fc00::/7 unique local"],
  ["fd12:3456::1", "fc00::/7 unique local (fd)"],
  ["fe80::1", "fe80::/10 link-local"],
  ["::ffff:127.0.0.1", "IPv4-mapped IPv6 apontando pra loopback"],
  ["::ffff:10.0.0.1", "IPv4-mapped IPv6 apontando pra RFC 1918"],
];

for (const [address, description] of IPV6_BLOCKED) {
  test(`bloqueia IPv6 privado/reservado: ${address} (${description})`, async () => {
    await assert.rejects(
      () =>
        assertUrlIsFetchable("http://alvo.exemplo.com", {
          resolveHostname: resolver({ "alvo.exemplo.com": [{ address, family: 6 }] }),
        }),
      /endereço privado\/reservado/,
    );
  });
}

test("permite IPv6 público comum", async () => {
  await assertUrlIsFetchable("http://alvo.exemplo.com", {
    resolveHostname: resolver({
      "alvo.exemplo.com": [{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }],
    }),
  });
});

test("bloqueia se QUALQUER endereço resolvido for privado (não só o primeiro)", async () => {
  await assert.rejects(
    () =>
      assertUrlIsFetchable("http://alvo.exemplo.com", {
        resolveHostname: resolver({
          "alvo.exemplo.com": [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.1", family: 4 },
          ],
        }),
      }),
    /endereço privado\/reservado/,
  );
});

test("endereço IPv4 malformado é tratado como bloqueado (falha segura)", async () => {
  await assert.rejects(
    () =>
      assertUrlIsFetchable("http://alvo.exemplo.com", {
        resolveHostname: resolver({
          "alvo.exemplo.com": [{ address: "não.é.um.ip", family: 4 }],
        }),
      }),
    /endereço privado\/reservado/,
  );
});

test("bloqueia hostname de metadata sem sequer consultar DNS", async () => {
  let chamadas = 0;
  await assert.rejects(
    () => assertUrlIsFetchable("https://metadata.google.internal/computeMetadata/v1", {
      resolveHostname: async () => {
        chamadas++;
        return [{ address: "93.184.216.34", family: 4 }];
      },
    }),
    /host sempre bloqueado/,
  );
  assert.equal(chamadas, 0);
});
