import type { PermissionGuard } from "./capability-types.js";

export interface GithubTask {
  type: string;
  owner?: string;
  repository?: string;
  title?: string;
  body?: string;
  head?: string;
  base?: string;
  issueNumber?: number;
  pullNumber?: number;
}

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  user?: { login: string } | null;
}

interface GithubPullRequest extends GithubIssue {
  merged?: boolean | null;
  mergeable?: boolean | null;
  head?: { ref: string } | null;
  base?: { ref: string } | null;
}

interface GithubRepository {
  full_name: string;
  description: string | null;
  default_branch: string;
  private: boolean;
  html_url: string;
  language: string | null;
  open_issues_count: number;
}

export interface GithubClient {
  rest: {
    issues: {
      create(options: { owner: string; repo: string; title: string; body?: string }): Promise<{ data: GithubIssue }>;
      get(options: { owner: string; repo: string; issue_number: number }): Promise<{ data: GithubIssue }>;
    };
    pulls: {
      create(options: { owner: string; repo: string; title: string; body?: string; head: string; base: string }): Promise<{ data: GithubPullRequest }>;
      get(options: { owner: string; repo: string; pull_number: number }): Promise<{ data: GithubPullRequest }>;
    };
    repos: {
      get(options: { owner: string; repo: string }): Promise<{ data: GithubRepository }>;
    };
  };
}

import { Octokit } from "@octokit/rest";

/**
 * GithubCapability: opera na API do GitHub via Octokit
 * (`@octokit/rest`, já era dependência declarada mas nunca usada em
 * lugar nenhum — este é o primeiro consumidor real).
 *
 * `octokit` é injetável no construtor (mesmo padrão de `fetchImpl` em
 * web-sandbox.js/knowledge-search.js) — testes nunca precisam de um
 * `GITHUB_TOKEN` real nem batem na API de verdade.
 */
export class GithubCapability {
  declare permissions: PermissionGuard | undefined;
  declare _octokit: GithubClient | null;

  constructor({ permissions, octokit }: { permissions?: PermissionGuard; octokit?: GithubClient | null } = {}) {
    this.permissions = permissions;
    this._octokit = octokit || null;
  }

  _client() {
    if (this._octokit) {
      return this._octokit;
    }

    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error(
        "GITHUB_TOKEN não configurado no ambiente — necessário para operações GitHub reais.",
      );
    }

    this._octokit = new Octokit({ auth: token });

    return this._octokit;
  }

  async execute(task: GithubTask) {
    this.permissions!.require(task.type);

    switch (task.type) {
      case "github.issue_create":
        return this.issueCreate(task);

      case "github.issue_get":
        return this.issueGet(task);

      case "github.pull_request_create":
        return this.pullRequestCreate(task);

      case "github.pull_request_get":
        return this.pullRequestGet(task);

      case "github.repository_get":
        return this.repositoryGet(task);

      default:
        throw new Error(
          `Operação GitHub desconhecida: ${task.type}`,
        );
    }
  }

  _requireOwnerRepo(task: GithubTask): asserts task is GithubTask & { owner: string; repository: string } {
    if (typeof task.owner !== "string" || task.owner.trim() === "") {
      throw new Error(`${task.type} exige owner (string)`);
    }

    if (
      typeof task.repository !== "string" ||
      task.repository.trim() === ""
    ) {
      throw new Error(`${task.type} exige repository (string)`);
    }
  }

  async issueCreate(task: GithubTask) {
    this._requireOwnerRepo(task);

    if (typeof task.title !== "string" || task.title.trim() === "") {
      throw new Error("github.issue_create exige title (string)");
    }

    const { data } = await this._client().rest.issues.create({
      owner: task.owner,
      repo: task.repository,
      title: task.title,
      body: task.body,
    });

    return this._formatIssue(data);
  }

  async issueGet(task: GithubTask) {
    this._requireOwnerRepo(task);

    if (!Number.isInteger(task.issueNumber) || task.issueNumber! <= 0) {
      throw new Error(
        "github.issue_get exige issueNumber (inteiro positivo)",
      );
    }

    const { data } = await this._client().rest.issues.get({
      owner: task.owner,
      repo: task.repository,
      issue_number: task.issueNumber!,
    });

    return this._formatIssue(data);
  }

  async pullRequestCreate(task: GithubTask) {
    this._requireOwnerRepo(task);

    if (typeof task.title !== "string" || task.title.trim() === "") {
      throw new Error("github.pull_request_create exige title (string)");
    }

    if (typeof task.head !== "string" || task.head.trim() === "") {
      throw new Error(
        "github.pull_request_create exige head (branch de origem)",
      );
    }

    if (typeof task.base !== "string" || task.base.trim() === "") {
      throw new Error(
        "github.pull_request_create exige base (branch de destino)",
      );
    }

    const { data } = await this._client().rest.pulls.create({
      owner: task.owner,
      repo: task.repository,
      title: task.title,
      body: task.body,
      head: task.head,
      base: task.base,
    });

    return this._formatPullRequest(data);
  }

  async pullRequestGet(task: GithubTask) {
    this._requireOwnerRepo(task);

    if (!Number.isInteger(task.pullNumber) || task.pullNumber! <= 0) {
      throw new Error(
        "github.pull_request_get exige pullNumber (inteiro positivo)",
      );
    }

    const { data } = await this._client().rest.pulls.get({
      owner: task.owner,
      repo: task.repository,
      pull_number: task.pullNumber!,
    });

    return this._formatPullRequest(data);
  }

  async repositoryGet(task: GithubTask) {
    this._requireOwnerRepo(task);

    const { data } = await this._client().rest.repos.get({
      owner: task.owner,
      repo: task.repository,
    });

    return {
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      private: data.private,
      htmlUrl: data.html_url,
      language: data.language,
      openIssuesCount: data.open_issues_count,
    };
  }

  // Formato reduzido de propósito -- nunca repassa o objeto bruto do
  // Octokit (que carrega dezenas de campos, incluindo URLs internas
  // de API pouco úteis pra quem consome o resultado da task).
  _formatIssue(data: GithubIssue) {
    return {
      number: data.number,
      title: data.title,
      state: data.state,
      htmlUrl: data.html_url,
      body: data.body,
      user: data.user?.login ?? null,
    };
  }

  _formatPullRequest(data: GithubPullRequest) {
    return {
      number: data.number,
      title: data.title,
      state: data.state,
      htmlUrl: data.html_url,
      body: data.body,
      user: data.user?.login ?? null,
      merged: data.merged ?? null,
      mergeable: data.mergeable ?? null,
      head: data.head?.ref ?? null,
      base: data.base?.ref ?? null,
    };
  }
}
