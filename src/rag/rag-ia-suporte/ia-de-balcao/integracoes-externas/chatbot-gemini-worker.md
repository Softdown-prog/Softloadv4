---
id: blogger-chatbot-gemini-worker
title: Chatbot com Gemini no Blogger usando Worker
category: blogger
tags:
  - blogger
  - gemini
  - chatbot
  - cloudflare-workers
  - google-apps-script
  - api
  - javascript
---

## Resumo

É possível criar um chatbot com IA dentro do Blogger, porém o Blogger não deve acessar diretamente a API do Gemini.

A arquitetura recomendada utiliza um Worker (Cloudflare Workers ou Google Apps Script) como intermediário entre o Blogger e a IA.

O Worker recebe a mensagem do usuário, consulta o Gemini e devolve a resposta ao chat do Blogger.

## Por que não usar a API diretamente no Blogger?

O Blogger é uma plataforma estática.

Todo JavaScript executa no navegador do visitante.

Se a chave da API do Gemini for colocada no JavaScript do Blogger, qualquer pessoa poderá visualizá-la usando as ferramentas do navegador.

Isso representa um risco de segurança e pode gerar uso indevido da API.

## Arquitetura recomendada

```
Blogger
    │
    ▼
JavaScript (Chat)
    │
    ▼
Worker
(Cloudflare Workers ou Google Apps Script)
    │
    ▼
Gemini API
    │
    ▼
Worker
    │
    ▼
Resposta para o Blogger
```

## Fluxo completo

1. O usuário envia uma mensagem pelo chat do Blogger.
2. O JavaScript faz um `fetch()` para um endpoint do Worker.
3. O Worker recebe a mensagem.
4. O Worker consulta a API do Gemini.
5. O Gemini gera a resposta.
6. O Worker devolve apenas o texto necessário.
7. O chat exibe a resposta ao usuário.

## Widget de chat pronto para colar

Gadget "HTML/JavaScript" completo (launcher flutuante + janela de chat) que
já fala com um Worker no formato descrito acima. Cole no painel de Layout do
Blogger, adicionando um gadget HTML/JavaScript.

IDs prefixados com `gemini-` (não `chat-launcher`/`chat-window` genéricos) —
evita colisão com outros gadgets/scripts na mesma página. Troque
`WORKER_URL` pela URL do seu próprio Worker antes de publicar.

```html
<div id='gemini-chat-container'>
  <button aria-label='Abrir suporte inteligente' id='gemini-chat-launcher' class='shadow-lg'>
    <svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'>
      <defs>
        <linearGradient id='gemini_gradient' x1='10%' x2='90%' y1='10%' y2='90%'>
          <stop offset='0%' style='stop-color:#1A73E8;stop-opacity:1'/>
          <stop offset='60%' style='stop-color:#9334E6;stop-opacity:1'/>
          <stop offset='100%' style='stop-color:#FF3D00;stop-opacity:1'/>
        </linearGradient>
      </defs>
      <path d='M 50 10 C 52 35, 65 48, 90 50 C 65 52, 52 65, 50 90 C 48 65, 35 52, 10 50 C 35 48, 48 35, 50 10 Z' fill='url(#gemini_gradient)'/>
      <circle cx='78' cy='22' fill='#FF3D00' opacity='0.8' r='7'/>
    </svg>
  </button>
  <div id='gemini-chat-window' class='chat-hidden shadow-2xl'>
    <div class='chat-header d-flex justify-content-between align-items-center'>
      <div class='d-flex align-items-center gap-2'>
        <div class='status-pulse'></div>
        <div>
          <div class='fw-bold text-white small text-uppercase ls-1'>Suporte IA</div>
          <div class='text-white-50' style='font-size: 0.65rem;'>Online agora</div>
        </div>
      </div>
      <button id='gemini-close-chat' class='btn-close btn-close-white shadow-none' style='font-size: 0.7rem;'></button>
    </div>
    <div id='gemini-chat-messages' class='p-3 flex-grow-1'>
      <div class='ai-msg'>Olá! Sou o assistente da loja. Como posso ajudar com os nossos templates hoje?</div>
    </div>
    <div id='gemini-typing-indicator' class='px-3 py-2 d-none'>
      <div class='typing-dot'></div>
      <div class='typing-dot'></div>
      <div class='typing-dot'></div>
    </div>
    <div class='chat-footer p-3'>
      <div class='input-group bg-light rounded-pill px-3 py-1 border'>
        <input type='text' id='gemini-user-input' class='form-control border-0 shadow-none bg-transparent' placeholder='Digite a sua dúvida...' style='font-size: 0.9rem;' maxlength='2000'/>
        <button class='btn p-0 text-primary d-flex align-items-center justify-content-center' id='gemini-send-btn' aria-label='Enviar mensagem'>
          <i class='bi bi-send-fill' style='font-size: 1.2rem;'/>
        </button>
      </div>
    </div>
  </div>
</div>
```

```css
#gemini-chat-container {
  position: fixed;
  bottom: 110px; /* suba este valor se já tiver um botão de WhatsApp no canto */
  right: 30px;
  z-index: 10000;
  font-family: var(--font-body, 'Roboto', sans-serif);
}

#gemini-chat-launcher {
  width: 65px;
  height: 65px;
  background: var(--surface, #ffffff);
  border: none;
  border-radius: 50%;
  padding: 12px;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  cursor: pointer;
}

#gemini-chat-launcher:hover { transform: scale(1.15) rotate(8deg); }

#gemini-chat-window {
  width: 360px;
  height: 550px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  position: absolute;
  bottom: 85px;
  right: 0;
  overflow: hidden;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-hidden {
  opacity: 0;
  visibility: hidden;
  transform: translateY(30px) scale(0.9);
}

.chat-header {
  background: linear-gradient(135deg, #1A73E8, #9334E6);
  padding: 20px;
}

.status-pulse {
  width: 10px;
  height: 10px;
  background: #10b981;
  border-radius: 50%;
  animation: pulse-green 2s infinite;
}

@keyframes pulse-green {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

#gemini-chat-messages {
  background: var(--bg-color, #f8fafc);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}

.ai-msg, .user-msg {
  padding: 12px 18px;
  border-radius: 18px;
  max-width: 85%;
  font-size: 0.9rem;
  line-height: 1.5;
}

.ai-msg {
  background: #ffffff;
  color: var(--text-main, #1e293b);
  align-self: flex-start;
  border-bottom-left-radius: 4px;
  border: 1px solid var(--border);
}

.user-msg {
  background: var(--primary, #2563eb);
  color: #ffffff;
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}

.typing-dot {
  width: 6px;
  height: 6px;
  background: #94a3b8;
  border-radius: 50%;
  display: inline-block;
  animation: typing 1.4s infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

.ls-1 { letter-spacing: 1px; }

@media (max-width: 480px) {
  #gemini-chat-window { width: 90vw; height: 75vh; right: -10px; }
}
```

```javascript
document.addEventListener('DOMContentLoaded', function() {
  const launcher = document.getElementById('gemini-chat-launcher');
  const chatWindow = document.getElementById('gemini-chat-window');
  const closeBtn = document.getElementById('gemini-close-chat');
  const sendBtn = document.getElementById('gemini-send-btn');
  const inputEl = document.getElementById('gemini-user-input');
  const messagesCont = document.getElementById('gemini-chat-messages');
  const typingInd = document.getElementById('gemini-typing-indicator');

  // Substitua pela URL do SEU Worker (Cloudflare Workers ou Google Apps
  // Script) — ver a arquitetura completa mais acima neste documento.
  // Nunca aponte para a API do Gemini diretamente a partir daqui.
  const WORKER_URL = 'https://SEU-WORKER.workers.dev/';

  if (launcher && chatWindow) {
    launcher.addEventListener('click', function() {
      chatWindow.classList.toggle('chat-hidden');
    });

    closeBtn.addEventListener('click', function() {
      chatWindow.classList.add('chat-hidden');
    });
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;

    addMsg(text, 'user-msg');
    inputEl.value = '';

    if (typingInd) typingInd.classList.remove('d-none');
    messagesCont.scrollTop = messagesCont.scrollHeight;

    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });

      const data = await response.json();
      if (typingInd) typingInd.classList.add('d-none');

      if (data.error) {
        addMsg('Erro no servidor: ' + data.error, 'ai-msg');
      } else {
        addMsg(data.response, 'ai-msg');
      }

    } catch (err) {
      if (typingInd) typingInd.classList.add('d-none');
      addMsg('Tive um problema na ligação com o servidor. Pode tentar de novo?', 'ai-msg');
      console.error('Erro no fetch:', err);
    }
  }

  // .innerText (não .innerHTML) — a resposta vem de uma IA e nunca deve ser
  // tratada como HTML confiável, mesmo vindo do seu próprio Worker.
  function addMsg(text, type) {
    const div = document.createElement('div');
    div.className = type;
    div.innerText = text;
    messagesCont.appendChild(div);
    messagesCont.scrollTop = messagesCont.scrollHeight;
  }

  if (sendBtn && inputEl) {
    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') handleSend();
    });
  }
});
```

## Opção 1 — Cloudflare Workers

Recomendado para produção.

Vantagens:

- Baixa latência.
- Plano gratuito.
- Escalabilidade automática.
- API Keys armazenadas em variáveis seguras.
- Fácil integração com Blogger.

Fluxo:

```
Blogger
    │
fetch()
    │
Cloudflare Worker
    │
Gemini API
    │
Worker
    │
JSON
    │
Chat Blogger
```

## Opção 2 — Google Apps Script

Também funciona muito bem para projetos menores.

O Apps Script pode ser publicado como um Web App.

Fluxo:

```
Blogger
    │
fetch()
    │
Google Apps Script
    │
Gemini API
    │
Apps Script
    │
JSON
    │
Chat Blogger
```

## Código do Worker — Cloudflare Workers

```javascript
export default {
  async fetch(request, env) {
    const CORS_HEADERS = {
      'Access-Control-Allow-Origin': '*', // restrinja ao domínio do seu blog em produção
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Método não permitido' }, 405, CORS_HEADERS);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400, CORS_HEADERS);
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return json({ error: 'Mensagem vazia' }, 400, CORS_HEADERS);
    if (message.length > 2000) return json({ error: 'Mensagem muito longa' }, 400, CORS_HEADERS);

    // GEMINI_API_KEY vem de uma secret do Worker (wrangler secret put),
    // nunca do código-fonte nem do wrangler.toml.
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return json({ error: 'Worker mal configurado' }, 500, CORS_HEADERS);

    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
        }),
      });

      if (!geminiRes.ok) {
        return json({ error: 'Falha ao consultar o Gemini' }, 502, CORS_HEADERS);
      }

      const data = await geminiRes.json();
      const texto = data && data.candidates && data.candidates[0]
        && data.candidates[0].content && data.candidates[0].content.parts
        && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

      if (!texto) return json({ error: 'Resposta vazia da IA' }, 502, CORS_HEADERS);

      return json({ response: texto }, 200, CORS_HEADERS);
    } catch (err) {
      return json({ error: 'Erro interno' }, 500, CORS_HEADERS);
    }
  },
};

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
```

`wrangler.toml`:

```toml
name = "meu-chatbot-worker"
main = "worker.js"
compatibility_date = "2024-09-23"
```

Deploy:

1. `npm install -g wrangler`
2. `wrangler login`
3. Criar `worker.js` com o código acima e o `wrangler.toml` ao lado.
4. `wrangler secret put GEMINI_API_KEY` — cola a chave quando pedido. A chave nunca entra em nenhum arquivo versionado.
5. `wrangler deploy`
6. Copiar a URL `https://SEU-WORKER.workers.dev` retornada pro `WORKER_URL` do widget (seção acima).

## Código do Worker — Google Apps Script

```javascript
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    return respond({ error: 'Script mal configurado' });
  }

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ error: 'JSON inválido' });
  }

  const message = (body.message || '').toString().trim();
  if (!message) return respond({ error: 'Mensagem vazia' });
  if (message.length > 2000) return respond({ error: 'Mensagem muito longa' });

  const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
    }),
    muteHttpExceptions: true,
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(res.getContentText());
    const texto = data && data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    if (!texto) return respond({ error: 'Resposta vazia da IA' });
    return respond({ response: texto });
  } catch (err) {
    return respond({ error: 'Erro interno' });
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Deploy:

1. No Google Drive: Novo → Mais → Apps Script (ou dentro de uma planilha: Extensões → Apps Script).
2. Colar o código acima em `Code.gs`.
3. `Configurações do projeto` (ícone de engrenagem) → `Propriedades do script` → adicionar `GEMINI_API_KEY` com o valor da chave. Nunca escrever a chave dentro do `.gs` — `PropertiesService` é o equivalente da secret do Cloudflare aqui.
4. `Implantar` → `Nova implantação` → tipo `App da Web`.
5. `Executar como`: Eu. `Quem tem acesso`: Qualquer pessoa — sem isso, toda requisição do Blogger cai numa tela de login do Google em vez de chegar no `doPost`.
6. Copiar a URL `https://script.google.com/macros/s/.../exec` retornada pro `WORKER_URL` do widget.

### Diferença importante entre as duas opções no lado do widget

O `fetch()` do widget (seção "Widget de chat pronto para colar") envia
`Content-Type: application/json`. Isso funciona direto com o Worker do
Cloudflare acima, porque ele responde explicitamente ao preflight
`OPTIONS` com os headers de CORS certos.

O Apps Script Web App **não responde a preflight `OPTIONS`** — não há
`doOptions` equivalente que resolva isso, nem forma de definir os
headers de CORS que o preflight exige. Um `fetch()` com
`Content-Type: application/json` contra uma URL de Apps Script falha
silenciosamente no navegador (erro de CORS no console, sem chegar a
tocar no `doPost`).

Solução padrão: se for usar Apps Script em vez de Cloudflare, troque o
`Content-Type` do `fetch()` do widget para `'text/plain;charset=utf-8'`.
`text/plain` é uma "simple request" pela spec do Fetch — o navegador não
dispara preflight. O corpo continua sendo o mesmo JSON válido; só a
declaração de tipo muda (o `doPost` acima já faz `JSON.parse` no corpo
independente do `Content-Type` declarado, então nada mais precisa
mudar do lado do Worker).

## Segurança

Nunca colocar:

- API Key do Gemini
- Token
- Credenciais

dentro do Blogger.

Sempre armazenar essas informações no Worker.

## O que o Worker pode fazer

Além de consultar o Gemini, ele pode:

- validar requisições;
- limitar número de mensagens;
- bloquear spam;
- registrar logs;
- aplicar cache;
- consultar banco de dados;
- consultar um RAG;
- escolher qual IA utilizar;
- autenticar usuários;
- executar Workers internos da aplicação.

## Evolução para Softload

Arquitetura inicial:

```
Blogger
↓
Worker
↓
Gemini
```

Arquitetura futura:

```
Blogger
↓
Softload Worker
├── RAG
├── XML Validator
├── SEO Worker
├── Compiler
├── Repair Engine
├── Modelo Local
├── Gemini
└── GPT
↓
Resposta
```

Nesta arquitetura o Blogger continua sendo apenas a interface.

Toda a inteligência fica concentrada no backend da Softload.

## Boas práticas

- Nunca expor API Keys.
- Utilizar HTTPS.
- Trabalhar apenas com JSON.
- Implementar timeout.
- Limitar tamanho das mensagens.
- Registrar erros.
- Implementar rate limit.
- Validar entrada antes de consultar a IA.
- Utilizar cache sempre que possível.

## Quando utilizar Cloudflare Workers

Ideal para:

- Chatbots.
- APIs.
- RAG.
- Proxy para IA.
- Autenticação.
- Cache.
- Workers rápidos.

## Quando utilizar Google Apps Script

Ideal para:

- Protótipos.
- Projetos pequenos.
- Integração com Google Workspace.
- Automações simples.

## Conclusão

O Blogger não conversa diretamente com modelos de IA.

A arquitetura correta consiste em utilizar um Worker como intermediário.

O Worker protege as credenciais, consulta a IA, pode integrar outros serviços (RAG, banco de dados, modelos locais e Workers internos) e devolve apenas a resposta necessária ao navegador.

Essa arquitetura é segura, escalável e recomendada para aplicações modernas baseadas em Blogger.
