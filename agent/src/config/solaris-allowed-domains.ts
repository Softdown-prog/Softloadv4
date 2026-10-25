// Fonte única de verdade para a allowlist de domínios do Solaris,
// documentada em `agent/solaris-urls-permitido.md`. Consumida por
// qualquer capability que precise decidir se uma URL de
// documentação/metadados é alcançável (hoje: WebSearchCapability,
// ver `web-search.js`) -- NÃO usada pela política de rede do
// sandbox-efemoro, que é um problema diferente (bloqueio de SSRF a
// partir de uma página não confiável sob teste, não filtro de fontes
// de documentação).
//
// Alterar aqui exige atualizar `agent/solaris-urls-permitido.md` em
// conjunto -- os dois devem sempre listar os mesmos domínios.

const SOLARIS_ALLOWED_DOMAINS: string[] = [
  // Core
  'laravel.com',
  'python.org',
  'firebase.google.com',
  'cloud.google.com',
  'cloudflare.com',
  'developers.cloudflare.com',
  'nodejs.org',
  'github.com',
  'microsoft.com',
  'ai.google.dev',

  // Web APIs
  'developer.mozilla.org',
  'npmjs.com',
  'typescriptlang.org',
  'react.dev',
  'vuejs.org',
  'nextjs.org',
  'expressjs.com',
  'vite.dev',

  // Containers & Infra
  'docker.com',
  'docs.docker.com',

  // Databases
  'postgresql.org',
  'mysql.com',
  'redis.io',

  // PHP
  'php.net',
  'getcomposer.org',
  'symfony.com',

  // Frontend
  'tailwindcss.com',
  'getbootstrap.com',

  // Security
  'owasp.org',

  // LLMs
  'openai.com',
  'anthropic.com',
];

const SOLARIS_ALLOWED_DOMAINS_SET = new Set(SOLARIS_ALLOWED_DOMAINS);

export { SOLARIS_ALLOWED_DOMAINS, SOLARIS_ALLOWED_DOMAINS_SET };
