# RAG Loader — Guia de Integração

> **Escopo:** este guia é exclusivo do **Especialista Blogger**.
> O RAG técnico e a biblioteca de códigos do Solaris possuem índices separados.
> Consulte [Arquitetura dos três RAGs](../../docs/rag-architecture.md) para
> rotas, coleções, isolamento, feature flags e comandos de teste.
> Os exemplos de endpoint neste arquivo são históricos; a integração
> atualmente usada no chat Blogger está em
> `src/routes/dashboard_routes/chat/chatGenerationFlow.js`.

## O que é

O `ragLoader.js` é um motor que detecta automaticamente o tipo de pergunta do utilizador e carrega apenas os ficheiros RAG relevantes para injetar no system prompt do Gemini.

## Capacidades

```
Roteamento automático:
  • Suporte → 2-4 ficheiros (5-10 KB)
  • Geração → 8-12 ficheiros (50-100 KB)

Seleção por relevância:
  • Palavras-chave (suporte)
  • Regex patterns (criação)
  • Tema específico (engenharia + referência)

Zero overhead:
  • Carrega apenas o essencial
  • Vs. carregar todos os 60 ficheiros RAG
```

## Uso

### Em rotas Express

```javascript
const ragLoader = require('../rag/ragLoader');

// POST /api/blogger-ai/plan — primeira fase (captura intenção)
app.post('/api/blogger-ai/plan', async (req, res) => {
  const { pergunta } = req.body;

  // Passo 1: Carregar contexto RAG
  const rag = ragLoader.loadForGeminiSync(pergunta);
  if (!rag.sucesso) {
    return res.status(500).json({ erro: 'Falha ao carregar RAG' });
  }

  // Passo 2: Injetar no system prompt
  const systemPrompt = `
    Você é o Softload AI — Gerador de Templates Blogger.
    
    [Contexto RAG — ${rag.rota} — ${rag.tamanhoTotalKB} KB]
    ${rag.contextoStr}
    
    [Fim do contexto RAG]
    
    Baseado no contexto acima, responda à pergunta do utilizador...
  `;

  // Passo 3: Chamar Gemini
  const gemini = require('../services/geminiService');
  const resposta = await gemini.gerarChat(pergunta, systemPrompt);

  res.json({
    resposta,
    ragMetadata: {
      rota: rag.rota,
      ficheirosCarregados: rag.ficheirosCarregados,
      tamanhoKB: rag.tamanhoTotalKB,
    },
  });
});
```

### Exemplo: Chat de Suporte

Pergunta: `"Como configurar HTTPS no meu domínio personalizado?"`

Roteamento automático:
```
✓ Rota detectada: suporte
✓ Ficheiros carregados: 2
  • suporte/ia-balcao-topicos-suporte-blogger.json    (1.2 KB)
  • suporte/ia-balcao-suporte-dominio-https.json      (4.1 KB)
✓ Total: 5.3 KB
```

System prompt para Gemini:
```
[Contexto RAG — suporte — 5.3 KB]
<!-- RAG: suporte/ia-balcao-topicos-suporte-blogger.json -->
{ "tópicos": { "domínio": "...", "mobile": "..." } }

<!-- RAG: suporte/ia-balcao-suporte-dominio-https.json -->
{ "passo": 1, "instrução": "Vá ao Google Domains..." }
...
[Fim do contexto RAG]
```

### Exemplo: Geração de Template

Pergunta: `"Quero um template moderno para blog de tecnologia com slider e imagens responsivas"`

Roteamento automático:
```
✓ Rota detectada: pipeline
✓ Ficheiros carregados: 3
  • pipeline/instrucoes/ia-balcao-personas-arquiteturais.json
  • pipeline/instrucoes/ia-balcao-sistema-anti-alucinacao.json
  • pipeline/instrucoes/ia-balcao-modo-engenharia.json
  • ... (8 total na Fase 1)
  • pipeline/engenharia/ia-balcao-blindagem-anti-injecao-blogger.json
  • pipeline/engenharia/ia-balcao-imagens-responsivas-blogger.json
  • pipeline/temas/tema-tecnologia-mag-tech.json
✓ Total: 56.2 KB
```

## API

### `loadForGeminiSync(pergunta: string)`

Versão síncrona (recomendada para rotas Express).

```javascript
const rag = ragLoader.loadForGeminiSync(pergunta);

// Retorna:
{
  rota: 'suporte' | 'pipeline',
  ficheirosCarregados: ['suporte/...', 'pipeline/...'],
  tamanhoTotalKB: '5.31',
  contextoStr: '<!-- RAG: ... -->\n{ ... }',
  sucesso: true
}
```

### `loadForGemini(pergunta: string)` — async

Versão async para casos avançados.

```javascript
const rag = await ragLoader.loadForGemini(pergunta);
```

### `rotearPergunta(pergunta: string)`

Apenas retorna a rota sem carregar ficheiros.

```javascript
const rota = ragLoader.rotearPergunta('Como...?'); // 'suporte' | 'pipeline'
```

## Padrões de Roteamento

### Suporte

Ativa se pergunta contém:
- `dominio` ou `domínio`
- `https` ou `ssl`
- `dns` ou `cloudflare`
- `mobile` ou `celular`
- `problema` ou `erro`

**Não ativa se contém:**
- `template`, `tema`, `design` (word boundaries)
- `criar`, `gerar`, `quero um`

### Pipeline (Geração)

Ativa se pergunta contém:
- `template` ou `tema` (word boundaries)
- `design`
- `criar um` ou `gerar um`
- `moderno`, `profissional`, `luxo`, `minimalista`
- `receita`, `culinária`, `roxo`, `rosa`

**Prioridade:** Suporte > Geração (se ambas, vai para suporte)

## Performance

```
Cenário Suporte:
  • Tempo de carregamento: ~5ms (2 ficheiros, 5 KB)
  • Tempo total com Gemini: ~2-3 segundos

Cenário Geração (Fase 1):
  • Tempo de carregamento: ~15ms (10+ ficheiros, 56 KB)
  • Tempo total com Gemini: ~2-3 segundos

Vs. carregar todos os 60 ficheiros RAG:
  • Tamanho total: 500+ KB
  • Tempo: +100-200ms de apenas I/O de ficheiros
  • Gastos contexto Gemini: desnecessário
```

## Estrutura de Ficheiros

```
src/rag/
├── suporte/
│   ├── index.json                              ← mapa de roteamento
│   ├── ia-balcao-topicos-suporte-blogger.json  ← router principal
│   ├── ia-balcao-suporte-dominio-https.json
│   ├── ia-balcao-suporte-fantasma-mobile.json
│   └── ia-balcao-heuristicas-nicho.json
│
├── pipeline/
│   ├── index.json
│   ├── instrucoes/                             ← Fase 1: system prompt
│   │   ├── index.json
│   │   ├── ia-balcao-personas-arquiteturais.json
│   │   └── ... (8 ficheiros)
│   │
│   ├── engenharia/                             ← Fase 2: técnico
│   │   ├── index.json
│   │   └── ... (8 ficheiros)
│   │
│   ├── temas/                                  ← Fase 2: referência
│   │   ├── index.json
│   │   └── ... (14 ficheiros)
│   │
│   └── widgets/                                ← Fase 2: componentes
│       ├── index.json
│       └── ... (13 ficheiros)
│
└── ragLoader.js                                ← este módulo
```

## Próximos Passos

1. **Integrar em `src/routes/bloggerAiRoutes.js`**
   ```javascript
   const ragLoader = require('../rag/ragLoader');
   ```

2. **Usar em `POST /api/blogger-ai/plan` e `POST /api/blogger-ai/generate`**
   ```javascript
   const rag = ragLoader.loadForGeminiSync(req.body.pergunta);
   ```

3. **Injetar no system prompt de ambos os modelos:**
   - Gemini 2.5 Flash (captura intenção) — Fase 1
   - Gemini 3.1 Flash Lite (montagem) — Fase 2

## Troubleshooting

**Q: "Falha ao ler ficheiro..."**
A: Verifique se `index.json` aponta para ficheiros que existem. Use `ls -la src/rag/`.

**Q: "RAG muito grande (100+ KB)?"**
A: O roteamento pode estar fraco. Verifique `rotearPergunta()` — deve rejeitar gerações falsas.

**Q: "Contexto não está sendo lido pelo Gemini?"**
A: Confirme que `contextoStr` está sendo injetado no `systemPrompt`. Use `console.log(rag.contextoStr.substring(0, 200))`.
