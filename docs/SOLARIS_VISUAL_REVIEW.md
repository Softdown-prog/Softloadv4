# Solaris Code — auditoria visual de screenshots (Flash)

A nova rota **somente sob demanda** `POST /dashboard/solaris/visual-review` captura uma página numa instância isolada de Chromium Headless Shell, envia o PNG via bloco de imagem multimodal ao Gemini Flash e devolve **somente a análise textual** de hierarquia, contraste, legibilidade, espaçamento e responsividade.

## Portas de segurança (desligado por padrão)

Para habilitar **depois de validar a VPS**, configurar no container **app**:

- `SOLARIS_VISUAL_REVIEW_ENABLED=true`
- `SOLARIS_AI_BUDGET_ENFORCE=true` (**obrigatório**): reserva a chamada Flash no livro razão antes de chamar o Gemini; sem orçamento, não chama a API.
- `SOLARIS_VISUAL_PREVIEW_ORIGINS=https://preview.seu-dominio.tld` (uma ou mais origens exatas, separadas por vírgula; sem wildcard). URL do usuário só pode apontar para essas origens — não permite credenciais, parâmetros de query ou hash.
- `SANDBOX_BROWSER_SERVICE_URL` e `SANDBOX_BROWSER_SHARED_SECRET`, ou as variáveis legadas `SANDBOX_SERVICE_URL`/`SANDBOX_SHARED_SECRET`.
- `GEMINI_API_KEY` configurada no app, já usada pelo Solaris.

O código não habilita nenhuma dessas flags sozinho. **Não dê à API do sandbox acesso direto à Internet ou à VPS fora do isolamento existente**. Mantenha o segredo no backend, nunca no navegador do usuário. O modelo receberá a imagem de uma página web: certifique-se de que o usuário está autorizado a enviar essa imagem ao provedor e de que páginas de prévia não mostram dados sensíveis.

## Exemplo de chamada (sessão autenticada do dashboard)

```http
POST /dashboard/solaris/visual-review
Content-Type: application/json

{"url":"https://preview.seu-dominio.tld/index.html","device":"android-mobile"}
```

Resposta:

```json
{
  "ok": true,
  "analise": "Há pouco contraste na navegação e o texto de apoio fica pequeno...",
  "device": "android-mobile",
  "screenshot": { "fullPage": false, "bytes": 45817 },
  "tokens": { "input": 1100, "output": 205 }
}
```

Nenhum byte de PNG/Base64 é enviado ao frontend ou salvo no histórico pelo handler de auditoria. O texto de análise não altera arquivos automaticamente, não faz commits e não certifica visualmente tudo que não está presente no screenshot.

## Limites e preço

- 3 avaliações a cada 10 minutos por usuário autenticado.
- Screenshot PNG até 512 KiB; o sandbox mantém seu teto original de 4 MiB e faz fallback para viewport em páginas grandes. Se o PNG ainda exceder o limite menor desta operação, a análise retorna erro sem chamada ao modelo.
- Gemini Flash com `maxOutputTokens:1024`. Usamos `criarClienteGeminiComOrcamento` protegido para **Flash** apenas nesta operação; as chamadas normais de chat mantêm o roteamento e o controle de custo anteriores. O livro razão usa `usageMetadata` para liquidação, com fallback conservador da reserva quando o provedor não informa uso.
- Débito de créditos legado continua separado do orçamento em reais. Falhas de débito retornam erro, não uma resposta falsa de sucesso.
- Não há auditoria automática a cada print, deploy ou alteração; o endpoint é explícito.

## Estado da entrega

Há implementação do backend e testes sem chamada paga, **mas a UI do chat ainda não exibe um botão dedicado**. A ativação na VPS requer configurar as flags, autorizar origens de prévia e verificar conectividade de app → sandbox. Não confundir a passagem de PNG ao Gemini com um sistema de visão autônomo ou aprovação automática de layouts.
