
solaris-urls-permitido.md

Domínios Permitidos para Acesso do Agente Solaris

Este documento define a lista de domínios que os agentes do ecossistema Solaris podem acessar para consultar documentação, obter metadados de pacotes e realizar verificações de segurança. O princípio de mínimo privilégio se aplica também ao acesso à rede: apenas domínios estritamente necessários para cada papel são liberados.

---

🏢 Plataformas e Serviços Core

Domínio Descrição Finalidade
laravel.com Laravel Framework Documentação oficial do Laravel
python.org Python Documentação oficial da linguagem Python
firebase.google.com Firebase Documentação e recursos do Firebase
cloud.google.com Google Cloud Platform Documentação GCP e serviços (incluindo Cloud Run)
cloudflare.com Cloudflare Documentação e recursos da Cloudflare
developers.cloudflare.com Cloudflare Developers Documentação técnica detalhada da Cloudflare
nodejs.org Node.js Documentação oficial do Node.js
github.com GitHub Repositórios, issues, pull requests
microsoft.com Microsoft Documentação da Microsoft (Azure, .NET, etc.)
ai.google.dev Google Gemini API Documentação da API Gemini

---

🌐 Web APIs e Padrões

Domínio Descrição Finalidade
developer.mozilla.org MDN Web Docs Documentação essencial para Web APIs, JavaScript, HTML, CSS
npmjs.com npm Registry Metadados de pacotes, documentação, versões
typescriptlang.org TypeScript Documentação oficial do TypeScript
react.dev React Documentação oficial do React
vuejs.org Vue.js Documentação oficial do Vue.js
nextjs.org Next.js Documentação oficial do Next.js
expressjs.com Express.js Documentação oficial do Express.js
vite.dev Vite Documentação do Vite (build tool)

---

🐳 Contêineres e Infraestrutura

Domínio Descrição Finalidade
docker.com Docker Documentação e recursos do Docker
docs.docker.com Docker Docs Documentação técnica detalhada do Docker
cloud.google.com/run Google Cloud Run Documentação específica do Cloud Run

---

🗄️ Bancos de Dados e Cache

Domínio Descrição Finalidade
postgresql.org PostgreSQL Documentação oficial do PostgreSQL
mysql.com MySQL Documentação oficial do MySQL
redis.io Redis Documentação oficial do Redis

---

📦 PHP Ecosystem

Domínio Descrição Finalidade
php.net PHP Documentação oficial do PHP
getcomposer.org Composer Documentação do Composer (PHP package manager)
symfony.com Symfony Documentação oficial do Symfony

---

🎨 Frontend e UI

Domínio Descrição Finalidade
tailwindcss.com Tailwind CSS Documentação oficial do Tailwind CSS
getbootstrap.com Bootstrap Documentação oficial do Bootstrap

---

🔒 Segurança

Domínio Descrição Finalidade
owasp.org OWASP Segurança de aplicações, vulnerabilidades, boas práticas

---

🤖 LLMs e IA

Domínio Descrição Finalidade
openai.com OpenAI Documentação da API OpenAI e recursos
anthropic.com Anthropic Documentação da API Anthropic e recursos

---

📋 Estrutura para Implementação no Código

solaris-config.js

```javascript
export const SOLARIS_ALLOWED_DOMAINS = [
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
  'anthropic.com'
];

// Versão com caminhos específicos (mais restrita)
export const SOLARIS_ALLOWED_URLS = [
  // URLs exatas para evitar acesso a subdomínios não autorizados
  'https://laravel.com/docs',
  'https://python.org/doc',
  'https://firebase.google.com/docs',
  'https://cloud.google.com/docs',
  'https://developers.cloudflare.com',
  'https://nodejs.org/docs',
  'https://github.com/*',  // Wildcard para docs/repos
  'https://developer.mozilla.org/*',
  'https://npmjs.com/package/*',
  'https://www.typescriptlang.org/docs',
  'https://react.dev/*',
  'https://vuejs.org/guide',
  'https://nextjs.org/docs',
  'https://expressjs.com/*',
  'https://vite.dev/guide',
  'https://docs.docker.com/*',
  'https://cloud.google.com/run/docs',
  'https://postgresql.org/docs',
  'https://dev.mysql.com/doc',
  'https://redis.io/documentation',
  'https://php.net/docs',
  'https://getcomposer.org/doc',
  'https://symfony.com/doc',
  'https://tailwindcss.com/docs',
  'https://getbootstrap.com/docs',
  'https://owasp.org/www-project-*/',
  'https://platform.openai.com/docs',
  'https://docs.anthropic.com/claude'
];
```

Uso no CommandPolicy ou WebAccessCapability

```javascript
import { SOLARIS_ALLOWED_DOMAINS } from '../config/solaris-config.js';

export class WebAccessCapability {
  constructor({ permissions, allowedDomains = SOLARIS_ALLOWED_DOMAINS }) {
    this.permissions = permissions;
    this.allowedDomains = new Set(allowedDomains);
  }
  
  async fetch(url) {
    const { hostname } = new URL(url);
    
    // Verifica permissão
    this.permissions.require('web.fetch');
    
    // Verifica domínio na allowlist
    if (!this.allowedDomains.has(hostname)) {
      throw new Error(`Domínio não permitido: ${hostname}`);
    }
    
    // Realiza fetch com timeout e validações adicionais
    return this.doFetch(url);
  }
}
```

---

🎯 Regras de Acesso por Papel (Role-based)

Papel Domínios Permitidos
Orquestrador Todos (coordenação)
Arquiteto Todos (pesquisa/planejamento)
Investigador Leitura: docs, npmjs, MDN, GitHub (público)
Programador Leitura: docs, npmjs, MDN, TypeScript, React, Vue, Next.js
Validador Leitura: OWASP, docs de segurança, documentação de testes
Empacotador Leitura: Docker, Cloud Run, Git
Operador Leitura/Escrita: Cloudflare, Firebase, GCP (com limites)

---

🛡️ Políticas de Segurança

1. HTTPS Obrigatório: Todo acesso deve usar HTTPS
2. Sem Execução Remota: Acesso apenas para leitura de documentação/metadados
3. Rate Limiting: Máximo de 100 requisições por minuto por agente
4. Timeout: 10 segundos para respostas
5. Cache: Documentação cacheada por 24h para reduzir requisições
6. Logging: Todo acesso é logado para auditoria
7. User-Agent: Identificar como SolarisAgent/<versão>

---

🔄 Manutenção da Lista

A lista deve ser revisada:

· Mensalmente: para remover domínios obsoletos
· Por demanda: quando novos frameworks/ferramentas são adotados
· Via PR: qualquer membro da equipe pode sugerir adições

---

Versão: 1.0.0
Última Atualização: 2026-08-09
Responsável: Equipe Solaris
