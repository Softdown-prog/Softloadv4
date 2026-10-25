# Solaris Code — auditoria visual com Gemini Flash

## Já integrado

O chat do Solaris apresenta **Auditar visualmente um site** para fazer uma captura de uma prévia pública no sandbox Chromium, em desktop ou Android. O screenshot segue do **backend** ao Gemini Flash como `inlineData` PNG e só o diagnóstico textual é devolvido ao chat. O usuário não recebe nem opera um navegador remoto; o agente usa o navegador isolado.

A análise **só roda após um clique explícito** em "Auditar agora (usa créditos)"; nunca em todo deploy, chamada de chat ou screenshot de rotina.

## Ativação

A operação agora se **habilita automaticamente se**:
- `GEMINI_API_KEY` está no container do app;
- `SANDBOX_SERVICE_URL` e `SANDBOX_SHARED_SECRET` estão definidos no app (ou os respectivos pares `SANDBOX_BROWSER_SERVICE_URL` e `SANDBOX_BROWSER_SHARED_SECRET`).

O endpoint `GET /dashboard/solaris/visual-review/status` (sessão autenticada) informa disponibilidade e origens liberadas **sem revelar segredos**. Ele consulta o `/health` do sandbox, que identifica se a imagem em execução realmente possui a capacidade de navegação Chromium. Se o serviço estiver offline, for um sandbox antigo ou `archive-only`, a interface mostra a auditoria como **indisponível** e não oferece o botão pago. A verificação não abre páginas nem utiliza tokens de IA.

A flag `SOLARIS_VISUAL_REVIEW_ENABLED=false` **desliga** a operação a qualquer momento. Em ausência de configuração de origens, apenas `https://softload.analysepro.com` é liberado por padrão. Para habilitar outros previews públicos legítimos, o operador configura `SOLARIS_VISUAL_PREVIEW_ORIGINS=https://softload.analysepro.com,https://preview.exemplo.com`. Correspondência é exata de protocolo, hostname e porta, sem wildcards; query strings e fragmentos de URL são recusados.

**Não é necessário ativar `SOLARIS_AI_BUDGET_ENFORCE` para a auditoria visual.** Ela sempre utiliza `criarClienteGeminiComOrcamento` antes de enviar o PNG ao Gemini. A flag global continua controlando apenas as outras operações. O saldo/orçamento por ciclo deve existir no Firestore; caso contrário, a análise falha fechada com erro 402.

## Segurança e custos

- Requer sessão autenticada e saldo de créditos; limite de 3 pedidos a cada 10 minutos por conta.
- O sandbox só pode navegar na URL autorizada (no host/porta alvo), bloqueia demais requisições; os limites de isolamento do container seguem fundamentais, inclusive porque WebSockets não são cobertos pela interceptação Playwright.
- O modo visual pede screenshot do **viewport**, enquanto os clientes antigos do sandbox continuam em modo de página inteira. Teto de 512 KiB do PNG para a análise; qualquer PNG acima do limite é rejeitado sem chamar Gemini.
- O custo estimado da reserva trata o PNG como **imagem**, substituindo Base64 por uma margem conservadora de entrada para calcular orçamento. A reserva precede a chamada. A liquidação considera `usageMetadata` real do provedor, com reserva integral mantida se a confirmação de custo falhar.
- Gemini Flash usa `maxOutputTokens:1024`. A operação debita também créditos legados pela contagem de tokens retornada, preservando a contabilização anterior do produto.
- Não há navegação autenticada em sites de terceiros, nem provisionamento automático de ambientes de preview nesta etapa.
- O screenshot nunca é exposto ao frontend, histórico ou log pela rota; o relatório textual aparece na conversa local da aba para o usuário solicitar alterações em seguida. **O relatório visual não é salvo automaticamente no histórico persistente do chat.**

## Uso

No chat Solaris, abrir **Auditar visualmente um site**, informar uma URL de uma das origens autorizadas, escolher Desktop ou Android e clicar em **Auditar agora (usa créditos)**. O backend chama `POST /dashboard/solaris/visual-review` e retorna `{ ok:true, analise, device, screenshot:{fullPage:false, bytes}, tokens }`.

## Limitações verificáveis

O navegador é usado pelo **serviço de IA**, não pelo usuário. Ainda assim, um único screenshot não substitui testes de interação, login, cliques, navegação por várias rotas ou verificação humana da aparência. A confirmação de ativação **na VPS** depende do deploy ter passado e das variáveis necessárias já estarem instaladas: editar código no GitHub não cria segredos de ambiente. O status autenticado revela se o backend está pronto; o primeiro teste real requer uma conta válida e orçamento disponível.
