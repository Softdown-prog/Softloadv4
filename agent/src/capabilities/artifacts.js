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
  constructor({ permissions }) {
    this.permissions = permissions;
  }

  async execute(task) {
    this.permissions.require(task.type);

    throw new Error(
      `Artifacts capability ainda não implementada: ${task.type}`,
    );
  }
}
