import { test } from "node:test";
import assert from "node:assert/strict";
import { Permissions } from "../security/permissions.js";
import { GithubCapability } from "./github.js";

function fakeOctokit(overrides = {}) {
  return {
    rest: {
      issues: {
        create: async () => ({
          data: {
            number: 42,
            title: "Bug real encontrado",
            state: "open",
            html_url: "https://github.com/o/r/issues/42",
            body: "descrição",
            user: { login: "sol-bot" },
          },
        }),
        get: async () => ({
          data: {
            number: 42,
            title: "Bug real encontrado",
            state: "closed",
            html_url: "https://github.com/o/r/issues/42",
            body: "descrição",
            user: { login: "sol-bot" },
          },
        }),
        ...(overrides.issues || {}),
      },
      pulls: {
        create: async () => ({
          data: {
            number: 7,
            title: "feat: nova capability",
            state: "open",
            html_url: "https://github.com/o/r/pull/7",
            body: null,
            user: { login: "sol-bot" },
            merged: false,
            mergeable: true,
            head: { ref: "feature-branch" },
            base: { ref: "main" },
          },
        }),
        get: async () => ({
          data: {
            number: 7,
            title: "feat: nova capability",
            state: "closed",
            html_url: "https://github.com/o/r/pull/7",
            body: null,
            user: { login: "sol-bot" },
            merged: true,
            mergeable: null,
            head: { ref: "feature-branch" },
            base: { ref: "main" },
          },
        }),
        ...(overrides.pulls || {}),
      },
      repos: {
        get: async () => ({
          data: {
            full_name: "o/r",
            description: "Repositório de teste",
            default_branch: "main",
            private: true,
            html_url: "https://github.com/o/r",
            language: "JavaScript",
            open_issues_count: 3,
          },
        }),
        ...(overrides.repos || {}),
      },
    },
  };
}

function makeCapability(octokit, permissionsOverride) {
  const permissions = new Permissions({
    mode: "full",
    ...(permissionsOverride || {}),
  });
  return new GithubCapability({ permissions, octokit });
}

test("github.issue_create cria a issue e devolve o formato reduzido", async () => {
  const chamadas = [];
  const octokit = fakeOctokit({
    issues: {
      create: async (params) => {
        chamadas.push(params);
        return {
          data: {
            number: 42,
            title: params.title,
            state: "open",
            html_url: "https://github.com/o/r/issues/42",
            body: params.body,
            user: { login: "sol-bot" },
          },
        };
      },
    },
  });
  const capability = makeCapability(octokit);

  const result = await capability.execute({
    type: "github.issue_create",
    owner: "softdown-prog",
    repository: "softload-engine-v3",
    title: "Bug real encontrado",
    body: "descrição",
  });

  assert.deepEqual(result, {
    number: 42,
    title: "Bug real encontrado",
    state: "open",
    htmlUrl: "https://github.com/o/r/issues/42",
    body: "descrição",
    user: "sol-bot",
  });
  assert.deepEqual(chamadas[0], {
    owner: "softdown-prog",
    repo: "softload-engine-v3",
    title: "Bug real encontrado",
    body: "descrição",
  });
});

test("github.issue_create exige title", async () => {
  const capability = makeCapability(fakeOctokit());

  await assert.rejects(
    () =>
      capability.execute({
        type: "github.issue_create",
        owner: "o",
        repository: "r",
      }),
    /exige title/,
  );
});

test("github.issue_get busca a issue pelo número e devolve o formato reduzido", async () => {
  const capability = makeCapability(fakeOctokit());

  const result = await capability.execute({
    type: "github.issue_get",
    owner: "o",
    repository: "r",
    issueNumber: 42,
  });

  assert.equal(result.number, 42);
  assert.equal(result.state, "closed");
});

test("github.issue_get exige issueNumber inteiro positivo", async () => {
  const capability = makeCapability(fakeOctokit());

  await assert.rejects(
    () => capability.execute({ type: "github.issue_get", owner: "o", repository: "r" }),
    /issueNumber/,
  );
  await assert.rejects(
    () =>
      capability.execute({
        type: "github.issue_get",
        owner: "o",
        repository: "r",
        issueNumber: -1,
      }),
    /issueNumber/,
  );
});

test("github.pull_request_create exige head e base além de title", async () => {
  const capability = makeCapability(fakeOctokit());

  await assert.rejects(
    () =>
      capability.execute({
        type: "github.pull_request_create",
        owner: "o",
        repository: "r",
        title: "x",
        base: "main",
      }),
    /exige head/,
  );

  await assert.rejects(
    () =>
      capability.execute({
        type: "github.pull_request_create",
        owner: "o",
        repository: "r",
        title: "x",
        head: "feature",
      }),
    /exige base/,
  );
});

test("github.pull_request_create cria o PR com head/base corretos", async () => {
  const chamadas = [];
  const octokit = fakeOctokit({
    pulls: {
      create: async (params) => {
        chamadas.push(params);
        return {
          data: {
            number: 7,
            title: params.title,
            state: "open",
            html_url: "https://github.com/o/r/pull/7",
            body: params.body,
            user: { login: "sol-bot" },
            merged: false,
            mergeable: null,
            head: { ref: params.head },
            base: { ref: params.base },
          },
        };
      },
    },
  });
  const capability = makeCapability(octokit);

  const result = await capability.execute({
    type: "github.pull_request_create",
    owner: "o",
    repository: "r",
    title: "feat: nova capability",
    head: "feature-branch",
    base: "main",
  });

  assert.equal(result.head, "feature-branch");
  assert.equal(result.base, "main");
  assert.equal(chamadas[0].head, "feature-branch");
  assert.equal(chamadas[0].base, "main");
});

test("github.pull_request_get busca o PR pelo número", async () => {
  const capability = makeCapability(fakeOctokit());

  const result = await capability.execute({
    type: "github.pull_request_get",
    owner: "o",
    repository: "r",
    pullNumber: 7,
  });

  assert.equal(result.number, 7);
  assert.equal(result.merged, true);
});

test("github.repository_get devolve os campos reduzidos do repositório", async () => {
  const capability = makeCapability(fakeOctokit());

  const result = await capability.execute({
    type: "github.repository_get",
    owner: "o",
    repository: "r",
  });

  assert.deepEqual(result, {
    fullName: "o/r",
    description: "Repositório de teste",
    defaultBranch: "main",
    private: true,
    htmlUrl: "https://github.com/o/r",
    language: "JavaScript",
    openIssuesCount: 3,
  });
});

test("todas as operações exigem owner/repository", async () => {
  const capability = makeCapability(fakeOctokit());

  await assert.rejects(
    () => capability.execute({ type: "github.repository_get", repository: "r" }),
    /exige owner/,
  );
  await assert.rejects(
    () => capability.execute({ type: "github.repository_get", owner: "o" }),
    /exige repository/,
  );
});

test("sem octokit injetado, lança erro claro quando GITHUB_TOKEN não está configurado", async () => {
  const envOriginal = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;

  try {
    const permissions = new Permissions({ mode: "full" });
    const capability = new GithubCapability({ permissions });

    await assert.rejects(
      () =>
        capability.execute({
          type: "github.repository_get",
          owner: "o",
          repository: "r",
        }),
      /GITHUB_TOKEN não configurado/,
    );
  } finally {
    if (envOriginal !== undefined) process.env.GITHUB_TOKEN = envOriginal;
  }
});

test("respeita Permissions -- github.issue_create negado por padrão (preset restricted)", async () => {
  const capability = makeCapability(fakeOctokit(), { mode: "restricted" });

  await assert.rejects(
    () =>
      capability.execute({
        type: "github.issue_create",
        owner: "o",
        repository: "r",
        title: "x",
      }),
    /Permissão negada/,
  );
});

test("github.repository_get É liberado por padrão (preset restricted, default true)", async () => {
  const capability = makeCapability(fakeOctokit(), { mode: "restricted" });

  const result = await capability.execute({
    type: "github.repository_get",
    owner: "o",
    repository: "r",
  });

  assert.equal(result.fullName, "o/r");
});
