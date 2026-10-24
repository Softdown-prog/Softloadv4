import forge from '../../forge/index.cjs';

/** Procedural assets use the same deterministic bundle as Solaris web. */
export class AssetForgeCapability {
  constructor({ workspace, permissions }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  async execute(task) {
    this.permissions.require(task.type);
    if (task.type === 'forge.catalog') return forge.catalog();
    if (task.type === 'forge.recipe') return forge.readRecipe(task.recipeId);
    if (task.type !== 'forge.render') throw new Error('Unknown Forge operation');
    // Resolve through Workspace first (including its realpath/symlink guard).
    const baseDir = await this.workspace.resolve(task.outputPath || '.');
    return forge.render(task, { baseDir });
  }
}
