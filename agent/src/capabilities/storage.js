/**
 * StorageCapability: placeholder para leitura/escrita em storage
 * externo (ex: Google Cloud Storage, S3 — ver TASK_MAP:
 * "storage.read", "storage.write").
 *
 * Diferente do FileSystemCapability, esta não recebe `workspace`,
 * já que presumivelmente vai operar sobre um bucket remoto, sem
 * relação com o diretório local do agent.
 */
export class StorageCapability {
  constructor({ permissions }) {
    this.permissions = permissions;
  }

  async execute(task) {
    this.permissions.require(task.type);

    throw new Error(
      `Storage capability ainda não implementada: ${task.type}`,
    );
  }
}
