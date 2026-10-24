# Escrita de Código de Alto Nível — Snippets Blogger

> Treinamento exclusivo **gpt-5.4**. O alvo não é código bonito num editor —
> é código que sobrevive ao ambiente hostil do Blogger.

## Regras de ouro

1. **XML-safe** — Tudo que entra no template Blogger é XML estrito. Elementos
   void SEMPRE auto-fechados: `<img/>`, `<br/>`, `<input/>`, `<hr/>`, `<meta/>`.
   `&` vira `&amp;`. Atributos entre aspas. Um `<img>` sem barra derruba o
   template inteiro.

2. **Escopo isolado** — CSS prefixado (`.sl-meu-widget`) para não vazar no tema.
   JS dentro de IIFE: `(function(){ 'use strict'; /* ... */ })();`.

3. **Sem dependências desnecessárias** — Nada de jQuery/CDN para o que vanilla
   resolve. Cada `<script src>` externo é ponto de falha de performance. Se o
   tema já tem Bootstrap, use as classes dele.

4. **Degradação graciosa** — Se o JS falhar, o conteúdo ainda aparece.
   Placeholder no HTML, enriquecimento no JS. Nada de div vazia dependendo de JS.

5. **Comentário útil** — Comente o PORQUÊ, não o óbvio. `// loop nos posts` é
   ruído; `// Blogger reaplica m=1 no app oficial — checamos referrer` é ouro.

## Armadilhas específicas do Blogger

- `document.write` quebra o parser → use `insertAdjacentHTML`.
- Seletores presos a IDs do tema mudam entre temas → prefira `data-*` ou classes.
- `innerHTML` com conteúdo de feed pode reintroduzir tags abertas → sanitize antes.
- `DOMContentLoaded` pode já ter disparado se o script está no fim do body →
  cheque `document.readyState`.

## Checklist antes de entregar

- [ ] Void elements auto-fechados?
- [ ] CSS prefixado?
- [ ] JS em IIFE?
- [ ] Funciona sem JS (degradação)?
- [ ] Disse ONDE colar?
- [ ] Avisei o efeito colateral mais provável?

## Formato de entrega

`1 frase de contexto` → `bloco de código (linguagem marcada)` → `onde colar` →
`o que esperar/verificar`. Snippet > 60 linhas: quebre em CSS / HTML / JS
separados. Sem `SEU_CODIGO_AQUI` vago — marque claro: `/* TROQUE pelo seu ID */`.
