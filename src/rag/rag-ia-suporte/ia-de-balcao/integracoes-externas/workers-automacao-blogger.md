---
id: blogger-workers-automacao
title: Worker genérico para automações no Blogger (entrega digital, banco de dados, webhooks)
category: blogger
tags:
  - blogger
  - cloudflare-workers
  - google-apps-script
  - automação
  - webhook
  - banco de dados
  - entrega digital
  - d1
  - kv
  - cron trigger
  - publicação automática
  - blogger api
  - oauth2
  - javascript
---

## Resumo

O mesmo padrão de arquitetura usado pelo [chatbot com Gemini](./chatbot-gemini-worker.md) — um Worker como intermediário entre o Blogger e serviços externos — serve de base para **qualquer** automação que o Blogger, sozinho, não consegue fazer com segurança: entrega automática de produtos digitais após pagamento, gravação em banco de dados, recebimento e envio de webhooks, e outras integrações.

O Blogger é uma plataforma estática: todo JavaScript roda no navegador do visitante, então nenhuma credencial (chave de API, segredo de webhook, token de banco de dados) pode viver no código do template. O Worker é o único lugar onde esses segredos ficam seguros, porque roda no servidor da Cloudflare (ou do Google, no caso de Apps Script), fora do alcance do navegador.

Esse documento parte de um Worker real, em produção, cedido pelo usuário, e mostra como adaptar o mesmo esqueleto pra outros tipos de automação.

## Esqueleto validado (Worker real em produção)

Este é o Worker de chatbot de suporte da TheTemplateShop, rodando em produção na Cloudflare. Serve como referência de **esqueleto correto** — CORS, tratamento de erro e formato de resposta — para qualquer novo Worker, independente do que ele automatiza.

```js
export default {
  async fetch(request, env) {
    // 1. CORS aberto para aceitar o www.analysepro.com ou testes dentro do Blogger
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { message } = await request.json();

      if (!env.API_KEY) {
        return new Response(JSON.stringify({ error: "Erro: API_KEY não configurada na Cloudflare." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const systemInstruction = `Você é o suporte técnico da TheTemplateShop.
      Regras:
      - Seja educado, rápido e direto.
      - Você é especialista em Blogger e Bootstrap 5.3 nativo.
      - Se perguntarem como instalar um template, diga para ir a 'Tema > Editar HTML' e substituir o código.
      - Responda APENAS a dúvidas sobre templates e criação de sites.
      - Se não souber algo, peça para entrarem em contacto através do formulário do site.`;

      // Usando exatamente o modelo que o Google liberou para você
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${env.API_KEY}`;

      const apiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\nPergunta do cliente: " + message }] }]
        })
      });

      const rawText = await apiResponse.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch(e) {
         return new Response(JSON.stringify({ error: "O Google não devolveu um formato válido." }), {
           headers: { ...corsHeaders, "Content-Type": "application/json" }
         });
      }

      if (data.error) {
        return new Response(JSON.stringify({ error: "Erro do Google: " + data.error.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 4. Sucesso!
      if (data.candidates && data.candidates[0].content.parts[0].text) {
        const aiText = data.candidates[0].content.parts[0].text;
        return new Response(JSON.stringify({ response: aiText }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } else {
        return new Response(JSON.stringify({ error: "A IA processou, mas a resposta veio vazia." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

    } catch (error) {
      // Se houver qualquer falha interna, devolvemos como JSON para o seu chat mostrar na tela
      return new Response(JSON.stringify({ error: "Erro de processamento na Cloudflare: " + error.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
```

### Anatomia do esqueleto — o que copiar em toda automação nova

- **`corsHeaders` aplicado em toda resposta, inclusive erro.** O navegador bloqueia a resposta inteira (nem o corpo JSON chega ao `fetch()` do Blogger) se o header CORS estiver ausente — mesmo numa resposta de erro.
- **`OPTIONS` respondido antes de qualquer lógica.** O navegador manda esse preflight automaticamente antes de um `POST` com `Content-Type: application/json`; sem essa resposta o preflight falha e o `POST` real nunca é enviado.
- **Segredos validados antes de usar** (`if (!env.API_KEY)`). Falha rápido com uma mensagem clara em vez de deixar a chamada externa estourar um erro genérico.
- **`try/catch` externo cobrindo tudo.** Qualquer exceção não prevista ainda vira uma resposta JSON válida — essencial porque o frontend faz `JSON.parse()` da resposta; um erro nativo (HTML de página de erro, ou conexão cortada) quebraria esse parse.
- **`status: 200` mesmo no erro do `catch` final.** Escolha deliberada: `fetch()` no navegador só lança exceção em erro de rede, não em status HTTP não-2xx — mas manter `200` mesmo em falha simplifica o código do frontend (não precisa checar `response.ok` antes de ler o JSON). **Trade-off a saber**: isso também significa que ferramentas de observabilidade da própria Cloudflare (analytics, alertas por taxa de erro) não vão contar essas falhas como erro, já que do ponto de vista HTTP a resposta "deu certo". Se for importante monitorar falhas de verdade, considere logar o erro internamente (`console.error`, visível nos logs do `wrangler tail`) antes de devolver a resposta 200.

Segredos (`API_KEY`, `WEBHOOK_SECRET`, etc.) nunca vão no código — são configurados como *secret* da Cloudflare:

```
npx wrangler secret put API_KEY
```

## Adaptação 1 — Entrega automática de item digital + webhook de pagamento

Cenário comum: o cliente compra um produto digital (e-book, template, licença) num gateway de pagamento externo (Stripe, Mercado Pago, Hotmart etc.), e o Blogger precisa entregar o link de download automaticamente, sem intervenção manual.

O mesmo Worker atende duas rotas:

1. **`/webhook/pagamento`** — chamada pelo *servidor* do gateway de pagamento (não pelo navegador do comprador) quando o pagamento é aprovado. Grava o pedido numa KV (banco chave-valor da Cloudflare).
2. **`/entrega`** — chamada pelo navegador do comprador (um botão "Baixar" na página de obrigado do Blogger) para consultar se o pedido está confirmado e obter o link.

```js
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      // Rota 1: webhook do gateway de pagamento (server-to-server — quem
      // chama é o servidor do gateway, não o navegador; por isso valida por
      // um segredo compartilhado em vez de depender de CORS)
      if (url.pathname === "/webhook/pagamento" && request.method === "POST") {
        const segredoRecebido = request.headers.get("X-Webhook-Secret");
        if (segredoRecebido !== env.WEBHOOK_SECRET) {
          return new Response(JSON.stringify({ error: "Assinatura inválida" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { orderId, email, produtoUrl } = await request.json();

        if (!orderId || !produtoUrl) {
          return new Response(JSON.stringify({ error: "Payload incompleto" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // KV: chave = orderId, valor = dados da entrega, expira em 7 dias
        await env.PEDIDOS.put(orderId, JSON.stringify({ email, produtoUrl, criadoEm: Date.now() }), {
          expirationTtl: 604800,
        });

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Rota 2: chamada do próprio Blogger (navegador do comprador) pedindo
      // o link de entrega na página de obrigado
      if (url.pathname === "/entrega" && request.method === "POST") {
        const { orderId } = await request.json();
        const registro = await env.PEDIDOS.get(orderId);

        if (!registro) {
          return new Response(JSON.stringify({ error: "Pedido não encontrado ou ainda não confirmado" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { produtoUrl } = JSON.parse(registro);
        return new Response(JSON.stringify({ downloadUrl: produtoUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Rota não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: "Erro de processamento: " + error.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
};
```

Vinculação da KV no `wrangler.toml`:

```toml
name = "worker-entrega-digital"
main = "worker.js"
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "PEDIDOS", id = "SEU_KV_NAMESPACE_ID" }
]
```

```
npx wrangler kv namespace create PEDIDOS
npx wrangler secret put WEBHOOK_SECRET
npx wrangler deploy
```

O `X-Webhook-Secret` é configurado no painel do gateway de pagamento como um header customizado enviado em toda chamada de webhook — cada gateway tem seu próprio nome/mecanismo pra isso (alguns usam assinatura HMAC do corpo em vez de um header fixo; ajuste a validação conforme a documentação do gateway usado).

## Adaptação 2 — Banco de dados com Cloudflare D1

Cenário: gravar leads de um formulário do Blogger (newsletter, contato, lista de espera) direto num banco de dados, sem depender de um serviço terceiro de formulários.

D1 é o banco SQL (SQLite) nativo da Cloudflare, acessível pelo Worker via *binding* — sem string de conexão, sem credencial exposta.

```js
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { nome, email } = await request.json();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: "E-mail inválido" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await env.DB.prepare(
        "INSERT INTO leads (nome, email, criado_em) VALUES (?, ?, ?)"
      ).bind(nome || null, email, Date.now()).run();

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: "Erro de processamento: " + error.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
};
```

Criação do banco e da tabela:

```
npx wrangler d1 create leads-db
npx wrangler d1 execute leads-db --command "CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, email TEXT NOT NULL, criado_em INTEGER)"
```

Vinculação no `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "leads-db"
database_id = "SEU_DATABASE_ID"
```

Consulta (`SELECT`) segue o mesmo padrão com `.all()` no lugar de `.run()`:

```js
const { results } = await env.DB.prepare("SELECT * FROM leads WHERE email = ?").bind(email).all();
```

Sempre usar `.bind()` para os valores da query — nunca concatenar a string SQL diretamente (`"... WHERE email = '" + email + "'"`), isso abre brecha de SQL injection.

## Adaptação 3 — Encaminhar eventos para outro serviço (webhook de saída)

O mesmo padrão de `fetch()` usado para chamar a API do Gemini serve para notificar qualquer outro serviço quando algo acontece no Blogger — por exemplo, avisar um canal do Discord/Slack a cada novo lead capturado pela Adaptação 2, ou dar um `wake up` num serviço tipo Zapier/Make/n8n.

```js
// Dentro de uma rota já validada, depois de gravar o lead:
await fetch(env.DISCORD_WEBHOOK_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: `Novo lead: ${email}` }),
});
```

Esse `fetch()` de saída não precisa de `corsHeaders` — CORS só entra em jogo quando quem chama é um navegador; aqui é o próprio Worker chamando outro servidor.

## Adaptação 4 — Publicação automática agendada (Cron Trigger + API do Blogger)

Cenário diferente dos anteriores: em vez de responder a uma chamada (do navegador ou de um webhook), o Worker roda sozinho, num horário agendado, e publica um post novo direto no Blogger via API — sem passar pelo editor manual. Não precisa de `corsHeaders` porque nada no navegador chama essa rota.

Exemplo real em produção (site de reviews de jogos): todo dia, o Worker escolhe um jogo de uma lista rotativa, pede pro Gemini escrever um artigo sobre ele, e publica direto no Blogger com status `live` — incluindo um link de afiliado.

```js
export default {
  async fetch(request, env) {
    try {
      const result = await runAutoPost(env);
      return new Response(`🚀 SUCESSO: "${result.gameName}" publicado usando Gemini 2.5 Flash!`, { status: 200 });
    } catch (err) {
      return new Response("❌ DETALHE DO ERRO: " + err.message, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoPost(env));
  }
};

async function runAutoPost(env) {
  // Lista com itens rotativos — troque pelo catálogo do seu nicho
  const games = [
    { name: "Diablo + Hellfire", url: "https://www.gog.com/game/diablo" },
    { name: "Fallout", url: "https://www.gog.com/game/fallout" },
    // ...demais itens
  ];

  const dayIndex = new Date().getDate() % games.length;
  const game = games[dayIndex];
  const affiliateLink = `${env.ADMITAD_BASE}?ulp=${encodeURIComponent(game.url)}`;

  // 1. IA gera o post
  const postData = await generatePostWithGemini(game.name, affiliateLink, env.GEMINI_API_KEY);

  // 2. Pega token de acesso via OAuth2 (refresh token)
  const accessToken = await getAccessToken(env);

  // 3. Publicação direta (status: live)
  await publishToBlogger(env.BLOG_ID, accessToken, postData);

  return { gameName: game.name, tags: postData.labels.join(", ") };
}

async function generatePostWithGemini(gameName, link, apiKey) {
  const prompt = `Aja como um redator especialista em SEO para o site Startpcgame.com. Escreva um artigo técnico e nostálgico em HTML sobre o jogo "${gameName}".
  FORMATO EXATO OBRIGATÓRIO:
  TAGS: [RPG, PC Gaming, Clássico]
  TITULO: [O Guia Definitivo de ${gameName}: Vale a Pena Jogar Hoje?]
  CONTEUDO: <img class="img-fluid rounded mb-4" src="https://placehold.co/800x450?text=${gameName.replace(/\s+/g, '+')}" alt="${gameName}"> <p>Introdução envolvente sobre o jogo...</p> <h2>História e Gameplay</h2> <p>...</p> <h2>Requisitos de Sistema</h2> <table class="table table-bordered text-start">...</table> <div class="text-center my-4"><a href="${link}" class="btn btn-success btn-lg px-5 shadow-sm" target="_blank" rel="nofollow">Garantir minha cópia na GOG (Oferta)</a></div>`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Google IA diz: ${data.error.message} (Código: ${data.error.code})`);
  }

  if (!data.candidates || data.candidates.length === 0) {
    if (data.promptFeedback) {
      throw new Error(`O Gemini bloqueou o conteúdo por segurança: ${JSON.stringify(data.promptFeedback)}`);
    }
    throw new Error("O Gemini retornou uma resposta vazia. Verifique se sua API Key está ativa.");
  }

  const rawText = data.candidates[0].content.parts[0].text;

  const labels = rawText.includes("TAGS:") ? rawText.split("TAGS:")[1].split("\n")[0].replace(/[\[\]]/g, "").split(",") : ["GOG", "Jogos Clássicos"];
  const title = rawText.includes("TITULO:") ? rawText.split("TITULO:")[1].split("\n")[0].replace(/[\[\]]/g, "") : `${gameName}: Clássico Imperdível`;
  const content = rawText.includes("CONTEUDO:") ? rawText.split("CONTEUDO:")[1] : rawText;

  return {
    labels: labels.map(t => t.trim()),
    title: title.trim(),
    content: content.trim()
  };
}

async function getAccessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      refresh_token: env.REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`Google Auth falhou. Motivo: "${data.error}" - Descrição: ${data.error_description || "Nenhuma descrição fornecida pelo Google"}. Verifique as variáveis CLIENT_ID, CLIENT_SECRET e REFRESH_TOKEN na Cloudflare.`);
  }
  return data.access_token;
}

async function publishToBlogger(blogId, token, post) {
  const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: post.title,
      content: post.content,
      labels: post.labels,
      status: "live"
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Erro no Blogger: ${err.error.message}`);
  }
}
```

### O que tem de novo aqui em relação aos exemplos anteriores

- **`scheduled(event, env, ctx)` + `ctx.waitUntil(...)`** — o handler que a Cloudflare chama no horário do Cron Trigger, não numa requisição HTTP. `ctx.waitUntil()` é obrigatório: sem ele, a Cloudflare pode encerrar o Worker assim que `scheduled()` retorna, matando a `Promise` de `runAutoPost()` no meio do caminho.
- **`fetch()` reaproveitado pra teste manual.** O mesmo `runAutoPost()` roda também quando alguém acessa a URL do Worker no navegador — útil pra testar antes de confiar no agendamento. **Mas isso é uma porta sem tranca**: qualquer pessoa que descubra a URL do Worker pode disparar uma publicação a qualquer momento, quantas vezes quiser. Pra produção, vale aplicar o mesmo padrão de segredo compartilhado da Adaptação 1 (checar um header ou `?secret=` antes de chamar `runAutoPost`) ou remover o handler `fetch()` inteiramente se o disparo manual não for necessário.
- **OAuth2 com refresh token**, diferente da API key simples usada pro Gemini. A API do Blogger publica em nome de uma conta Google, então precisa de autorização OAuth2 — `CLIENT_ID`/`CLIENT_SECRET`/`REFRESH_TOKEN` são gerados uma única vez (Google Cloud Console → credenciais OAuth do tipo "Aplicativo instalado" ou "Web", autorizando o escopo `https://www.googleapis.com/auth/blogger`; o [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) do Google é o caminho mais rápido pra gerar o `refresh_token` manualmente uma vez) e depois ficam salvos como *secret* da Cloudflare — o Worker troca o refresh token por um access token novo a cada execução, sem precisar de intervenção humana depois da configuração inicial.
- **Extração de campos por marcador de texto** (`split("TAGS:")`, `split("TITULO:")`, `split("CONTEUDO:")`) em vez de pedir JSON estruturado pro Gemini. Funciona bem quando o prompt reforça um formato fixo (como faz aqui, com "FORMATO EXATO OBRIGATÓRIO"), mas é mais frágil que usar `responseSchema` (mesmo mecanismo mostrado no [chatbot com Gemini](./chatbot-gemini-worker.md) — na prática, o Google costuma reservar `responseSchema` pros modelos `-pro`, então pra um modelo `-flash` como este, o formato por marcador de texto costuma ser a alternativa mais simples). Se o Gemini não seguir o formato à risca, os `.includes()` caem no valor padrão (`["GOG", "Jogos Clássicos"]`, etc.) em vez de quebrar — vale revisar os primeiros posts publicados pra confirmar que o formato está sendo seguido.
- **`status: "live"` publica direto, sem revisão humana.** Pra um pipeline 100% automático isso é o ponto, mas também é o maior risco de qualidade (a IA pode errar informações, ou o Blogger pode marcar como spam um volume alto de posts automáticos). Trocar por `status: "draft"` publica como rascunho — o post fica pronto no painel do Blogger esperando alguém revisar e publicar manualmente, trocando automação total por uma camada de controle de qualidade.

`wrangler.toml` com o agendamento (todo dia às 12h UTC) e os secrets necessários:

```toml
name = "worker-autopost-blogger"
main = "worker.js"
compatibility_date = "2024-01-01"

[triggers]
crons = ["0 12 * * *"]
```

```
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CLIENT_ID
npx wrangler secret put CLIENT_SECRET
npx wrangler secret put REFRESH_TOKEN
npx wrangler secret put BLOG_ID
npx wrangler secret put ADMITAD_BASE
npx wrangler deploy
```

## Frontend — chamando essas rotas do Blogger

Esta seção se aplica às Adaptações 1-3, que respondem a uma chamada feita pelo navegador. A Adaptação 4 roda sozinha via Cron Trigger e não depende de nenhum código no template do Blogger.

O JavaScript do widget do Blogger é idêntico independente da automação por trás — só muda a URL do Worker e o corpo do `fetch()`:

```html
<script>
async function chamarWorker(payload) {
  const resposta = await fetch('https://SEU-WORKER.workers.dev/entrega', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const dados = await resposta.json();
  if (dados.error) {
    console.error(dados.error);
    return;
  }
  // usar dados.downloadUrl, dados.response, etc. conforme a rota
}
</script>
```

## Segurança — checklist antes de publicar

- Segredo (API key, `WEBHOOK_SECRET`) sempre via `wrangler secret put`, nunca escrito no código do Worker nem no template Blogger.
- Toda rota que grava dado (webhook, formulário) valida o payload antes de usar — nunca confiar cegamente no que chegou.
- Rota de webhook recebido valida a origem (segredo compartilhado ou assinatura HMAC, conforme o serviço que chama) — sem isso, qualquer um na internet pode forjar uma chamada pra `/webhook/pagamento` e liberar entregas falsas.
- TTL (`expirationTtl`) em dados temporários na KV evita acúmulo indefinido de registros que não são mais necessários.
- Consultas em D1 sempre via `.bind()`, nunca concatenação de string.

## Cloudflare Workers vs Google Apps Script pra automação

KV e D1 são recursos exclusivos da Cloudflare — não têm equivalente direto no Apps Script. Para quem já está no ecossistema Google e prefere não sair dele:

- **Planilha Google como "banco de dados"** — `SpreadsheetApp.openById(id).getSheetByName('leads').appendRow([nome, email, new Date()])` substitui o `INSERT` em D1 pra casos simples de baixo volume.
- **`PropertiesService`** substitui a KV pra guardar pares chave-valor pequenos (ex: um contador, um último ID processado).
- Para volume maior ou consultas mais elaboradas (filtro, agregação), D1/Cloudflare é a escolha mais robusta — Planilhas Google não foram desenhadas como banco de dados transacional.

Ver [chatbot com Gemini](./chatbot-gemini-worker.md) para o código completo do lado Apps Script (`doPost`, `PropertiesService`, `ContentService`) e a ressalva de CORS/preflight específica dessa plataforma.

## Conclusão

Um único esqueleto de Worker — CORS explícito, validação de segredo, `try/catch` sempre devolvendo JSON — serve de base para qualquer automação que o Blogger não consegue fazer sozinho com segurança: chatbot de IA, entrega digital, gravação em banco de dados, repasse de eventos via webhook, ou até publicação automática agendada via Cron Trigger. A diferença entre uma automação e outra está só na lógica de dentro da rota (ou do `scheduled()`), não na estrutura em volta dela.
