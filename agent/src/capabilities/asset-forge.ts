import type { PermissionGuard } from "./capability-types.js";

export interface ForgeTask {
  type: string;
  recipeId?: string;
  outputPath?: string;
  id?: string;
  command?: string;
  recipe?: unknown;
  receitaJson?: string;
}

interface ForgeWorkspace {
  resolve(relativePath: string): Promise<string>;
}

import forge from '../../forge/index.cjs';

/** Procedural assets use the same deterministic bundle as Solaris web. */
export class AssetForgeCapability {
  declare workspace: ForgeWorkspace;
  declare permissions: PermissionGuard;

  constructor({ workspace, permissions }: { workspace: ForgeWorkspace; permissions: PermissionGuard }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  async execute(task: ForgeTask) {
    this.permissions.require(task.type);
    if (task.type === 'forge.catalog') return forge.catalog();
    if (task.type === 'forge.recipe') return forge.readRecipe(task.recipeId);
    if (task.type !== 'forge.render') throw new Error('Unknown Forge operation');
    // Resolve through Workspace first (including its realpath/symlink guard).
    const baseDir = await this.workspace.resolve(task.outputPath || '.');
    return forge.render(task, { baseDir });
  }
}
