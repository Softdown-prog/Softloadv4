/** Traduz falhas das rotas de chat sem assumir que HTTP 404 veio do Gemini. */
interface ChatErrorBody { error?: unknown; erro?: unknown; codigo?: unknown; message?: unknown }

function safeMessage(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 300
    ? value.trim()
    : null;
}
export function mensagemErroChat(status: number, payload?: ChatErrorBody | null): string {
  const body: ChatErrorBody = payload && typeof payload === 'object' ? payload : {};
  const explicacao = safeMessage(body.error) || safeMessage(body.erro);
  if (status === 401) return 'Sua sessão expirou. Entre novamente e reenvie a mensagem.';
  if (status === 402) return explicacao || 'Seus créditos de IA não são suficientes para esta operação.';
  if (status === 403) return explicacao || 'Esta operação não está autorizada para sua conta.';
  if (status === 404) return 'Não foi possível encontrar o serviço de chat nesta versão do site. Recarregue a página; se continuar, avise o suporte. Nenhuma nova tentativa foi enviada automaticamente.';
  if (status === 408 || status === 504) return 'A conexão com o chat demorou demais. Confira a rede antes de tentar novamente.';
  if (status === 409) return explicacao || 'Esta mensagem já está sendo processada. Confira o histórico antes de reenviar.';
  if (status === 429) return 'O serviço de IA atingiu o limite de solicitações. Aguarde e tente novamente mais tarde. Não enviamos tentativas automáticas.';
  if (status === 500 || status === 502 || status === 503) return 'O serviço de chat está temporariamente indisponível. Confira o histórico antes de tentar novamente.';
  return explicacao || 'Não foi possível enviar a mensagem. Confira sua conexão ou entre em contato com o suporte.';
}

export async function extrairErroRespostaChat(response: Response): Promise<string> {
  // Resposta HTML de 404/502 (proxy/deploy) não deve virar erro JSON no chat.
  const tipo = response.headers.get('content-type') || '';
  let payload: ChatErrorBody | null = null;
  if (tipo.includes('application/json')) {
    try { payload = (await response.json()) as ChatErrorBody; } catch { /* inválido: usar status */ }
  }
  return mensagemErroChat(response.status, payload);
}
