import type { CoderStepContext, ValidatorAgent } from "./coder-validator-loop.js";

export interface CodeEdit {
  path: string;
  content: string;
}
export interface CoderValidatorExampleOptions {
  plan: unknown;
  callLlmForCodeEdits(context: CoderStepContext): Promise<CodeEdit[]>;
}
declare const process: { env: Record<string, string | undefined> };

import { Agent } from "../agent.js";
import { Workspace } from "../core/workspace.js";
import {
  createCoderPermissions,
  createValidatorPermissions,
  createPackagerPermissions,
} from "../security/role-permissions.js";
import {
  CoderValidatorLoop,
  MaxAttemptsExceededError,
} from "./coder-validator-loop.js";

/**
 * Exemplo de como amarrar o loop Programador/Validador usando as
 * permissões por papel. Não é chamado automaticamente em lugar
 * nenhum — serve de referência para integrar no seu Orquestrador
 * real.
 */
export async function runCoderValidatorExample({ plan, callLlmForCodeEdits }: CoderValidatorExampleOptions) {
  // Workspace único, compartilhado entre Programador e Validador —
  // ambos precisam enxergar exatamente o mesmo checkout de código.
  const workspace = new Workspace({
    root: process.env.WORKSPACE_ROOT || "/workspace",
  });

  await workspace.initialize();

  const coderPreset = createCoderPermissions();
  const validatorPreset = createValidatorPermissions();
  const packagerPreset = createPackagerPermissions();

  const coderAgent = new Agent({
    role: "coder",
    workspace,
    permissions: coderPreset.permissions,
    commandPolicy: coderPreset.commandPolicy,
  });

  const validatorAgent = new Agent({
    role: "validator",
    workspace,
    permissions: validatorPreset.permissions,
    commandPolicy: validatorPreset.commandPolicy,
  });

  const packagerAgent = new Agent({
    role: "packager",
    workspace,
    permissions: packagerPreset.permissions,
    commandPolicy: packagerPreset.commandPolicy,
  });

  await Promise.all([
    coderAgent.start(),
    validatorAgent.start(),
    packagerAgent.start(),
  ]);

  const loop = new CoderValidatorLoop({
    validatorAgent: validatorAgent as unknown as ValidatorAgent,
    testCommand: "npm test",
    maxAttempts: 3,
    timeoutMs: 120000,

    // Se esgotar as tentativas, reverte qualquer mudança feita pelo
    // Programador no workspace antes de propagar o erro — evita
    // deixar o projeto num estado quebrado no meio do caminho.
    onFailure: async ({ attempts, lastValidation }) => {
      await packagerAgent.execute({
        type: "shell.execute",
        // "git checkout -- ." reverte arquivos rastreados; se o
        // Programador também criou arquivos novos (não rastreados),
        // pode ser necessário "git clean -fd" também, dependendo do
        // quanto de rollback automático faz sentido no seu caso.
        command: "git checkout -- .",
      });
    },
  });

  try {
    const result = await loop.run({
      plan,

      // onCoderStep é onde a chamada de LLM de verdade acontece:
      // recebe o plano do Arquiteto e (a partir da 2ª tentativa) o
      // feedback real do teste que falhou, decide quais arquivos
      // editar, e aplica via coderAgent.execute({ type: "file.write", ... }).
      onCoderStep: async ({ plan: currentPlan, attempt, previousFeedback }) => {
        const edits = await callLlmForCodeEdits({
          plan: currentPlan,
          attempt,
          previousFeedback,
        });

        for (const edit of edits) {
          await coderAgent.execute({
            type: "file.write",
            path: edit.path,
            content: edit.content,
          });
        }

        return { editedFiles: edits.map((edit) => edit.path) };
      },
    });

    return result;
  } catch (error) {
    if (error instanceof MaxAttemptsExceededError) {
      // Já revertido pelo onFailure acima — aqui só decide como
      // comunicar a falha pro Orquestrador/usuário.
      return {
        success: false,
        attempts: error.attempts,
        lastValidation: error.lastValidation,
      };
    }

    throw error;
  } finally {
    await Promise.all([
      coderAgent.stop(),
      validatorAgent.stop(),
      packagerAgent.stop(),
    ]);
  }
}
