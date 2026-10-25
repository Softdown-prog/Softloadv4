import type { CoderStepContext, ValidatorAgent } from "./coder-validator-loop.js";
import type { AgentDispatchHandler } from "../agent-dispatch-capability.js";
import type { DispatchHandler, DispatchContext } from "../capabilities/agent-parallel-dispatch.js";

export interface ExampleCodeEdit {
  path: string;
  content: string;
}
export interface EcosystemExampleOptions {
  callLlmForPlan(input: { request: unknown; investigationReport: unknown }): Promise<unknown>;
  callLlmForCodeEdits(context: CoderStepContext): Promise<ExampleCodeEdit[]>;
}
/** The sample dispatch payloads are intentionally extensible by role. */
type RolePayload = Record<string, any>;
declare const process: { env: Record<string, string | undefined> };

import { Agent } from "../agent.js";
import { Workspace } from "../core/workspace.js";
import { AgentDispatchCapability } from "../agent-dispatch-capability.js";
import { AgentParallelDispatchCapability } from "../capabilities/agent-parallel-dispatch.js";
import { PlanTrackerCapability } from "../capabilities/plan-tracker.js";
import {
  createExplorerPermissions,
  createCoderPermissions,
  createValidatorPermissions,
  createPackagerPermissions,
  createOrchestratorPermissions,
} from "../security/role-permissions.js";
import { CoderValidatorLoop, MaxAttemptsExceededError } from "./coder-validator-loop.js";

/**
 * Monta o ecossistema completo de sub-agentes e devolve o
 * Orquestrador já pronto para receber pedidos do usuário via
 * `orchestratorAgent.execute({ type: "agent.dispatch", targetRole, payload })`.
 *
 * `callLlmForPlan`, `callLlmForCodeEdits`: funções fornecidas por
 * quem integra este módulo, responsáveis pelas chamadas de LLM reais
 * do Arquiteto e do Programador — ficam fora do escopo deste
 * arquivo, que só cuida da orquestração/permissões.
 */
export async function buildAgentEcosystem({
  callLlmForPlan,
  callLlmForCodeEdits,
}: EcosystemExampleOptions) {
  // Workspace compartilhado entre os sub-agentes que operam sobre
  // código (Investigador, Programador, Validador, Empacotador).
  const workspace = new Workspace({
    root: process.env.WORKSPACE_ROOT || "/workspace",
  });

  await workspace.initialize();

  const explorerPreset = createExplorerPermissions();
  const coderPreset = createCoderPermissions();
  const validatorPreset = createValidatorPermissions();
  const packagerPreset = createPackagerPermissions();
  const orchestratorPreset = createOrchestratorPermissions();

  const explorerAgent = new Agent({
    role: "explorer",
    workspace,
    permissions: explorerPreset.permissions,
    commandPolicy: explorerPreset.commandPolicy,
  });

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
    explorerAgent.start(),
    coderAgent.start(),
    validatorAgent.start(),
    packagerAgent.start(),
  ]);

  // Loop Programador/Validador, reaproveitando o que já foi
  // construído em coder-validator-loop.js. `onFailure` reverte
  // qualquer mudança do Programador via o Empacotador, caso o
  // limite de tentativas seja esgotado.
  const coderValidatorLoop = new CoderValidatorLoop({
    validatorAgent: validatorAgent as unknown as ValidatorAgent,
    testCommand: "npm test",
    maxAttempts: 3,
    timeoutMs: 120000,
    onFailure: async () => {
      await packagerAgent.execute({
        type: "shell.execute",
        command: "git checkout -- .",
      });
    },
  });

  // dispatchTargets: o "cardápio" de roles que o Orquestrador pode
  // chamar via agent.dispatch. Cada entrada é uma função async
  // (payload) => result — o formato do payload/result é livre por
  // role, definido aqui.
  const dispatchTargets = {
    /**
     * payload esperado: { path?: string, pattern?: string }
     * Ex: investigar a estrutura de um diretório específico, ou
     * buscar por um padrão de nome de arquivo em todo o workspace.
     */
    explorer: async (payload: RolePayload) => {
      const [listing, matches] = await Promise.all([
        explorerAgent.execute({
          type: "file.list",
          path: payload.path || ".",
        }),
        payload.pattern
          ? explorerAgent.execute({
              type: "file.search",
              path: payload.path || ".",
              pattern: payload.pattern,
            })
          : Promise.resolve(null),
      ]);

      return { listing, matches };
    },

    /**
     * payload esperado: { investigationReport: unknown, request: string }
     * O Arquiteto não usa Agent.execute() — é uma chamada de LLM
     * pura, sem nenhuma capability de sistema.
     */
    architect: async (payload: RolePayload) => {
      return callLlmForPlan({
        request: payload.request,
        investigationReport: payload.investigationReport,
      });
    },

    /**
     * payload esperado: { plan: unknown }
     * Roda o ciclo completo Programador -> Validador (com retries),
     * usando o loop já construído.
     */
    coder_validator: async (payload: RolePayload) => {
      try {
        const result = await coderValidatorLoop.run({
          plan: payload.plan,
          onCoderStep: async ({ plan, attempt, previousFeedback }) => {
            const edits = await callLlmForCodeEdits({
              plan,
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

        return { success: true, ...result };
      } catch (error) {
        if (error instanceof MaxAttemptsExceededError) {
          return {
            success: false,
            attempts: error.attempts,
            lastValidation: error.lastValidation,
          };
        }

        throw error;
      }
    },

    /**
     * payload esperado: { commitMessage: string, files?: string[], addAll?: boolean }
     * Empacota e envia: git add/commit/push. Não roda testes (isso
     * já rodou dentro de coder_validator) nem edita arquivos.
     */
    packager: async (payload: RolePayload) => {
      // git.commit já cobre "add" antes do commit (via task.files ou
      // task.addAll), usando execa com array de argumentos — não
      // monta um comando de shell, então nomes de arquivo com espaço
      // (ou começando com "-") não quebram nem viram injeção.
      const commitResult = await packagerAgent.execute({
        type: "git.commit",
        message: payload.commitMessage,
        files: payload.files,
        addAll: payload.addAll,
      });

      const pushResult = await packagerAgent.execute({
        type: "shell.execute",
        command: "git push",
      });

      return { commitResult, pushResult };
    },

    /**
     * payload esperado: { plan: unknown, edits: [{path, content}] }
     * Exemplo de handler CIENTE de isolamento -- diferente de
     * "coder_validator" acima (que usa o `coderAgent` fixo, capturado
     * por closure, sempre apontando pro workspace COMPARTILHADO),
     * este monta um `Agent` novo, na hora, escopado ao workspace
     * ISOLADO recebido via `context` -- só assim o worktree separado
     * de cada dispatch paralelo tem efeito de verdade. É o padrão que
     * qualquer handler destinado a rodar via `agent.dispatch_parallel`
     * (fan-out real, ver AgentParallelDispatchCapability) precisa
     * seguir: nunca reusar um Agent pré-vinculado ao workspace
     * compartilhado.
     */
    coder_isolated: async (payload: RolePayload, context: DispatchContext) => {
      const isolatedCoderAgent = new Agent({
        role: "coder",
        workspace: context.workspace as unknown as Workspace,
        permissions: coderPreset.permissions,
        commandPolicy: coderPreset.commandPolicy,
      });

      await isolatedCoderAgent.start();

      for (const edit of payload.edits || []) {
        await isolatedCoderAgent.execute({
          type: "file.write",
          path: edit.path,
          content: edit.content,
        });
      }

      await isolatedCoderAgent.stop();

      return {
        workspaceRoot: context.workspaceRoot,
        editedFiles: (payload.edits || []).map((edit) => edit.path),
      };
    },
  };

  const orchestratorAgent = new Agent({
    role: "orchestrator",
    workspace,
    permissions: orchestratorPreset.permissions,
    commandPolicy: orchestratorPreset.commandPolicy,
    extraCapabilities: {
      dispatch: new AgentDispatchCapability({
        permissions: orchestratorPreset.permissions,
        dispatchTargets: dispatchTargets as unknown as Record<string, AgentDispatchHandler>,
      }),

      // Fan-out de agent.dispatch: roda vários dispatches em
      // paralelo, cada um isolado em seu próprio git worktree por
      // padrão (worktreesRoot configurável via env, default irmão do
      // workspace compartilhado -- ver agent-parallel-dispatch.js).
      dispatchParallel: new AgentParallelDispatchCapability({
        permissions: orchestratorPreset.permissions,
        dispatchTargets: dispatchTargets as unknown as Record<string, DispatchHandler>,
        workspace,
        worktreesRoot: process.env.WORKTREES_ROOT,
      }),

      // Registro EM MEMÓRIA de progresso -- vive só durante a vida
      // desta instância do Orquestrador (ver plan-tracker.js pro
      // porquê dessa escolha de armazenamento).
      planTracker: new PlanTrackerCapability({
        permissions: orchestratorPreset.permissions,
      }),
    },
  });

  await orchestratorAgent.start();

  return {
    orchestratorAgent,
    // Expostos também individualmente, útil para logging/testes ou
    // para desligar tudo de forma coordenada (ver stopAll abaixo).
    subAgents: { explorerAgent, coderAgent, validatorAgent, packagerAgent },

    async stopAll() {
      await Promise.all([
        orchestratorAgent.stop(),
        explorerAgent.stop(),
        coderAgent.stop(),
        validatorAgent.stop(),
        packagerAgent.stop(),
      ]);
    },
  };
}

/**
 * Exemplo de uso ponta a ponta.
 */
async function example() {
  const { orchestratorAgent, stopAll } = await buildAgentEcosystem({
    callLlmForPlan: async ({ request, investigationReport }) => {
      // chamada real ao LLM do Arquiteto aqui
      return { steps: ["editar src/index.js"] };
    },
    callLlmForCodeEdits: async ({ plan, attempt, previousFeedback }) => {
      // chamada real ao LLM do Programador aqui
      return [{ path: "src/index.js", content: "// código gerado" }];
    },
  });

  // Plano de progresso desta orquestração -- registro EM MEMÓRIA
  // (some quando o processo terminar), útil pra quem estiver
  // acompanhando de fora rodar "plan.get" e ver o que já foi feito.
  const plan = (await orchestratorAgent.execute({
    type: "plan.create",
    title: "Adiciona validação de input",
    items: [
      { description: "Investigar código existente" },
      { description: "Planejar mudança" },
      { description: "Codificar + validar" },
      { description: "Empacotar (commit + push)" },
    ],
  })) as { result: { items: Array<{ id: string }>; id: string } };
  const [investigarItem, planejarItem, codificarItem, empacotarItem] = plan.result.items;

  async function marcarItem(itemId: string, status: string, note?: string) {
    await orchestratorAgent.execute({
      type: "plan.update_item",
      planId: plan.result.id,
      itemId,
      status,
      note,
    });
  }

  try {
    // 1. Investigar
    await marcarItem(investigarItem.id, "in_progress");
    const investigation = (await orchestratorAgent.execute({
      type: "agent.dispatch",
      targetRole: "explorer",
      payload: { path: "src", pattern: "index" },
    })) as { result: unknown };
    await marcarItem(investigarItem.id, "completed");

    // 2. Planejar
    await marcarItem(planejarItem.id, "in_progress");
    const planning = (await orchestratorAgent.execute({
      type: "agent.dispatch",
      targetRole: "architect",
      payload: {
        request: "adicionar validação de input",
        investigationReport: investigation.result,
      },
    })) as { result: unknown };
    await marcarItem(planejarItem.id, "completed");

    // 3. Codificar + validar (com retry automático)
    await marcarItem(codificarItem.id, "in_progress");
    const coding = (await orchestratorAgent.execute({
      type: "agent.dispatch",
      targetRole: "coder_validator",
      payload: { plan: planning.result },
    })) as { result: { success: boolean } };
    await marcarItem(
      codificarItem.id,
      coding.result.success ? "completed" : "pending",
      coding.result.success ? undefined : "validação falhou, revisar antes de tentar de novo",
    );

    // 4. Empacotar (só se a validação passou)
    if (coding.result.success) {
      await marcarItem(empacotarItem.id, "in_progress");
      await orchestratorAgent.execute({
        type: "agent.dispatch",
        targetRole: "packager",
        payload: {
          commitMessage: "feat: adiciona validação de input",
          addAll: true,
        },
      });
      await marcarItem(empacotarItem.id, "completed");
    }

    // 5. Exemplo de fan-out: duas variações de código exploradas em
    // PARALELO, cada uma isolada em seu próprio git worktree (sem
    // isso, as duas escreveriam nos MESMOS arquivos do workspace
    // compartilhado ao mesmo tempo). Útil pra comparar abordagens
    // antes de escolher uma pra de fato prosseguir pro Empacotador.
    const exploracaoParalela = await orchestratorAgent.execute({
      type: "agent.dispatch_parallel",
      dispatches: [
        {
          targetRole: "coder_isolated",
          payload: { edits: [{ path: "src/index.js", content: "// variação A" }] },
        },
        {
          targetRole: "coder_isolated",
          payload: { edits: [{ path: "src/index.js", content: "// variação B" }] },
        },
      ],
      concurrency: 2,
    });

    // exploracaoParalela.result.results: um item por dispatch, cada
    // um com { ok, workspaceRoot, result|error } -- o worktree de cada
    // variação já foi removido quando a chamada acima retorna (ver
    // AgentParallelDispatchCapability._runOne), então qualquer decisão
    // sobre qual variação seguir precisa ter sido tomada a partir do
    // `result` devolvido, não relendo o disco depois.
  } finally {
    await stopAll();
  }
}
