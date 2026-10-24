/** Contratos de fronteira para unificar usageMetadata e tokensRef.
 * Tipos APENAS: não ativam a nova carteira de créditos nem alteram
 * o comportamento do Gemini e do GPT em produção.
 */
export type AiProvider = 'openai' | 'gemini';

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface NormalizedAiUsage {
  provider: AiProvider;
  model: string;
  tokens: TokenUsage;
}

export type AiTask =
  | 'blogger-chat'
  | 'blogger-template'
  | 'workspace'
  | 'solaris-chat'
  | 'solaris-project';
