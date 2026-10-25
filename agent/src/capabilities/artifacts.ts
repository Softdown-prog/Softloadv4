import type { PermissionGuard, CapabilityTask, CapabilityFetch } from "./capability-types.js";
/**
 * ArtifactsCapability: placeholder para build/publicação de
 * artefatos (ver TASK_MAP: "artifact.build", "artifact.push").
 *
 * Segue o mesmo padrão de stub das outras capabilities ainda não
 * implementadas: permissão é checada primeiro (por padrão negada,
 * ver Permissions), e só então (se fosse implementada) a lógica
 * real rodaria.
 */
export class ArtifactsCapability {
  constructor({ permissions }: { permissions: PermissionGuard }) {
    this.permissions = permissions;
  }

  declare permissions: PermissionGuard;

  async execute(task: CapabilityTask) {
    this.permissions.require(task.type);

    throw new Error(
      `Artifacts capability ainda não implementada: ${task.type}`,
    );
  }
}
