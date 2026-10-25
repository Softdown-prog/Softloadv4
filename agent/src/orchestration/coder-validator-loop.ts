/** The validator may run only the shell action granted to its agent. */
export interface ValidationResult {
  ok: boolean;
  result?: {
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  };
  error?: { message?: string };
}
export interface ValidationFeedback {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
export interface ValidatorAgent {
  execute(task: { type: "shell.execute"; command: string; timeoutMs?: number }): Promise<ValidationResult>;
}
export interface CoderValidatorFailure {
  attempts: number;
  lastValidation: ValidationResult | null;
  lastFeedback: ValidationFeedback | null;
}
export interface CoderValidatorOptions {
  validatorAgent?: ValidatorAgent;
  testCommand?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  onFailure?: (context: CoderValidatorFailure) => void | Promise<void>;
}
export interface CoderStepContext {
  plan: unknown;
  attempt: number;
  previousFeedback: ValidationFeedback | null;
}
export interface CoderValidatorRunOptions {
  plan: unknown;
  onCoderStep?: (context: CoderStepContext) => Promise<unknown>;
}

import { createLogger } from "../utils/logger.js";

/**
 * Erro lançado quando o loop esgota as tentativas sem o Validador
 * aprovar. Carrega `attempts` (quantas rodadas de fato rodaram) e
 * `lastValidation` (o resultado da última validação, para quem
 * capturar o erro poder inspecionar a causa final da falha, ex:
 * mostrar pro usuário ou decidir se faz rollback).
 */
export class MaxAttemptsExceededError extends Error {
  declare code: string;
  declare attempts: number;
  declare lastValidation: ValidationResult | null;

  constructor(attempts: number, lastValidation: ValidationResult | null) {
    super(
      `Loop Programador/Validador excedeu o limite de ${attempts} tentativa(s) sem sucesso`,
    );

    this.name = "MaxAttemptsExceededError";
    this.code = "MAX_ATTEMPTS_EXCEEDED";
    this.attempts = attempts;
    this.lastValidation = lastValidation;
  }
}

/**
 * CoderValidatorLoop: coordena o ciclo Programador → Validador →
 * (se falhar) Programador de novo, com um limite máximo de
 * tentativas para evitar loop infinito em caso de bug persistente.
 *
 * Este módulo NÃO sabe como o "Programador" de fato decide o que
 * editar — isso envolve uma chamada de LLM, que fica fora do
 * escopo deste arquivo. Em vez disso, quem monta o loop passa uma
 * função `onCoderStep`, chamada a cada tentativa, responsável por
 * aplicar as edições de código (via o Agent do Programador,
 * chamando file.write/file.delete etc.) e retornar um resumo do que
 * foi feito.
 *
 * O Validador, por outro lado, É chamado diretamente por este
 * módulo, pois sua ação é sempre a mesma: rodar um comando de shell
 * (teste/lint/build) através do Agent do Validador e checar o exit
 * code — não precisa de um LLM no meio.
 */
export class CoderValidatorLoop {
  declare validatorAgent: ValidatorAgent;
  declare testCommand: string;
  declare maxAttempts: number;
  declare timeoutMs: number | undefined;
  declare onFailure: ((context: CoderValidatorFailure) => void | Promise<void>) | null;
  declare logger: ReturnType<typeof createLogger>;

  constructor({
    validatorAgent,
    testCommand,
    maxAttempts = 3,
    timeoutMs,
    onFailure,
  }: CoderValidatorOptions = {}) {
    if (!validatorAgent) {
      throw new Error(
        "CoderValidatorLoop exige um validatorAgent",
      );
    }

    if (!testCommand || typeof testCommand !== "string") {
      throw new Error(
        "CoderValidatorLoop exige testCommand (string, ex: 'npm test')",
      );
    }

    this.validatorAgent = validatorAgent;
    this.testCommand = testCommand;
    this.maxAttempts = maxAttempts;
    this.timeoutMs = timeoutMs;

    // Callback opcional, chamado quando o limite de tentativas é
    // esgotado, ANTES de lançar MaxAttemptsExceededError — dá a
    // chance de quem montou o loop plugar uma estratégia de
    // rollback (ex: `git checkout .` via o Agent do Empacotador),
    // sem acoplar essa decisão a este módulo.
    this.onFailure = onFailure || null;

    this.logger = createLogger("coder-validator-loop");
  }

  /**
   * Executa o loop completo.
   *
   * @param {object} params
   * @param {unknown} params.plan - o plano técnico vindo do
   *   Arquiteto, repassado ao onCoderStep em cada tentativa.
   * @param {(context: {
   *     plan: unknown,
   *     attempt: number,
   *     previousFeedback: { exitCode: number|null, stdout: string, stderr: string } | null,
   *   }) => Promise<unknown>} params.onCoderStep - função que aplica
   *   as edições de código para esta tentativa e retorna um resumo
   *   qualquer (formato livre, é só repassado pra frente no
   *   resultado final).
   *
   * @returns {Promise<{
   *   success: true,
   *   attempts: number,
   *   coderResult: unknown,
   *   validationResult: object,
   * }>}
   *
   * @throws {MaxAttemptsExceededError} se todas as tentativas
   *   falharem na validação.
   */
  async run({ plan, onCoderStep }: CoderValidatorRunOptions): Promise<{
    success: true;
    attempts: number;
    coderResult: unknown;
    validationResult: ValidationResult;
  }> {
    if (typeof onCoderStep !== "function") {
      throw new Error(
        "CoderValidatorLoop.run exige onCoderStep (function)",
      );
    }

    let attempt = 0;
    let lastValidation: ValidationResult | null = null;
    let feedback: ValidationFeedback | null = null;

    while (attempt < this.maxAttempts) {
      attempt++;

      this.logger.info("Iniciando tentativa", {
        attempt,
        maxAttempts: this.maxAttempts,
      });

      // 1) Etapa do Programador: aplica (ou corrige) as mudanças de
      // código para esta tentativa. Na 1ª tentativa, `feedback` é
      // null (implementação inicial); da 2ª em diante, `feedback`
      // carrega a saída real do teste que falhou, para o Programador
      // poder corrigir com base no erro de verdade — não numa
      // reinterpretação.
      const coderResult = await onCoderStep({
        plan,
        attempt,
        previousFeedback: feedback,
      });

      // 2) Etapa do Validador: roda o comando de teste/build real
      // através do Agent do Validador (que já deve ter sido
      // construído com createValidatorPermissions(), restringindo
      // shell.execute a comandos de teste).
      const validationResult = await this.validatorAgent.execute({
        type: "shell.execute",
        command: this.testCommand,
        timeoutMs: this.timeoutMs,
      });

      lastValidation = validationResult;

      // `validationResult.ok` vem do TaskRunner (true se a
      // capability não lançou erro); dentro de `result`, o exit
      // code real do processo de teste.
      const exitCode = validationResult.result?.exitCode;
      const passed = validationResult.ok && exitCode === 0;

      if (passed) {
        this.logger.info("Validação passou", { attempt });

        return {
          success: true,
          attempts: attempt,
          coderResult,
          validationResult,
        };
      }

      this.logger.warn("Validação falhou", {
        attempt,
        exitCode: exitCode ?? null,
        ok: validationResult.ok,
      });

      // Monta o feedback para a próxima tentativa (se ainda houver
      // uma) com a saída real do comando — o Programador recebe o
      // erro de teste de verdade, não um resumo interpretado.
      feedback = {
        exitCode: exitCode ?? null,
        stdout: validationResult.result?.stdout ?? "",
        stderr:
          validationResult.result?.stderr ??
          validationResult.error?.message ??
          "",
      };
    }

    // Esgotou as tentativas sem sucesso.
    this.logger.error("Limite de tentativas esgotado", {
      attempts: attempt,
      maxAttempts: this.maxAttempts,
    });

    if (this.onFailure) {
      await this.onFailure({
        attempts: attempt,
        lastValidation,
        lastFeedback: feedback,
      });
    }

    throw new MaxAttemptsExceededError(attempt, lastValidation);
  }
}
