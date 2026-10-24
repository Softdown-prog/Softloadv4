import { execa } from "execa";
import { parseCommand } from "../utils/parse-command.js";
import { runCommand } from "../utils/run-command.js";
import { SOLARIS_ALLOWED_DOMAINS_SET as ALLOWED_DOMAINS } from "../config/solaris-allowed-domains.js";

// Limites de segurança
const MAX_QUERY_LENGTH = 1000;
const MAX_RESULTS_DEFAULT = 10;
const MAX_RESULTS_HARD_CAP = 20;
const MAX_SEARCHES_PER_TASK = 5;
const SEARCH_TIMEOUT_MS = 30000;
const MAX_ANSWER_LENGTH = 30000;
const MAX_CITATIONS = 20;

/**
 * WebSearchCapability: realiza pesquisas na web usando a Gemini API
 * com Google Search Grounding.
 * 
 * Diferente das outras capabilities, esta NÃO executa comandos shell
 * ou acessa diretamente URLs arbitrárias. Em vez disso, utiliza a
 * API Gemini com o recurso de Google Search Grounding para obter
 * informações atualizadas, sempre filtrando os resultados pela
 * whitelist de domínios configurada.
 */
export class WebSearchCapability {
  constructor({ permissions }) {
    this.permissions = permissions;
    
    // Lê a API key do ambiente (nunca exposta)
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      // Não lança erro no construtor para permitir que o Agent
      // seja instanciado mesmo sem a key, mas falhará na execução
      console.warn('WebSearchCapability: GEMINI_API_KEY não configurada');
    }
    
    // Contador de pesquisas por task para rate limiting
    this.searchCounter = new Map();
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "web.search":
        return this.search(task);
      default:
        throw new Error(`Operação web-search desconhecida: ${task.type}`);
    }
  }

  /**
   * Realiza uma pesquisa com Google Search Grounding via Gemini API
   */
  async search(task) {
    // 1. Validação da query
    if (!task.query || typeof task.query !== 'string') {
      throw new Error('web.search exige "query" (string)');
    }

    const query = task.query.trim();
    if (query.length === 0) {
      throw new Error('web.search: query não pode ser vazia');
    }
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(`web.search: query excede ${MAX_QUERY_LENGTH} caracteres`);
    }

    // 2. Verifica API Key
    if (!this.apiKey) {
      const error = new Error('GEMINI_API_KEY não configurada no ambiente');
      error.code = 'API_KEY_MISSING';
      throw error;
    }

    // 3. Rate limiting por task (evita abuso)
    const taskId = task._taskId || 'default';
    const searchCount = this.searchCounter.get(taskId) || 0;
    if (searchCount >= MAX_SEARCHES_PER_TASK) {
      const error = new Error(`Limite de ${MAX_SEARCHES_PER_TASK} pesquisas por task excedido`);
      error.code = 'SEARCH_LIMIT_EXCEEDED';
      throw error;
    }
    this.searchCounter.set(taskId, searchCount + 1);

    // 4. Limpeza da contagem após a task terminar (será chamado pelo TaskRunner)
    // Como não temos hook, fazemos cleanup após um tempo. `.unref()`: é só
    // faxina interna de estado — não deveria segurar o processo vivo
    // esperando disparar (achado real: sem isso, `node --test` demorava
    // 60s pra sair mesmo depois de todos os testes já terem passado).
    setTimeout(() => {
      this.searchCounter.delete(taskId);
    }, 60000).unref(); // 1 minuto

    // 5. Configuração da pesquisa
    const maxResults = Math.min(
      task.maxResults || MAX_RESULTS_DEFAULT,
      MAX_RESULTS_HARD_CAP
    );
    const language = task.language || 'pt-BR';
    const context = task.context || null;

    // 6. Executa a pesquisa via Gemini API
    const result = await this.performGeminiSearch({
      query,
      maxResults,
      language,
      context,
      allowedDomains: task.allowedDomains ? new Set(task.allowedDomains) : null
    });

    // 7. Registra métricas para o futuro Model Router
    return {
      success: true,
      query,
      answer: result.answer,
      sources: result.sources,
      citations: result.citations,
      searchQueries: result.searchQueries || [],
      metadata: {
        tool: 'gemini-search-grounding',
        sourcesCount: result.sources.length,
        citationsCount: result.citations.length,
        durationMs: result.durationMs,
        truncated: result.truncated || false,
        // Achado real: filterByDomains() já calculava isso, mas o
        // valor nunca saía daqui — descartado silenciosamente.
        filteredCount: result.filteredCount || 0
      }
    };
  }

  /**
   * Realiza a chamada à API Gemini com Google Search Grounding
   */
  async performGeminiSearch({ query, maxResults, language, context, allowedDomains }) {
    const startTime = Date.now();

    try {
      // Achado real: este código importava @google/genai (SDK unificado,
      // atual) mas chamava a API do SDK antigo/descontinuado
      // @google/generative-ai (genAI.getGenerativeModel(...).generateContent(...)
      // com generationConfig). No SDK unificado não existe
      // getGenerativeModel() — o modelo é só um parâmetro de
      // genAI.models.generateContent(), e a config de tools/temperatura
      // vai dentro de `config`, não `generationConfig`. Mesmo padrão já
      // usado (e funcionando) em src/services/geminiService.js
      // (getClient().models.generateContent({model, contents, config})).
      const { GoogleGenAI } = await import('@google/genai');
      const genAI = new GoogleGenAI({ apiKey: this.apiKey });

      // Monta o prompt
      const prompt = this.buildPrompt(query, context, maxResults, language);

      // Executa a requisição com timeout. `.unref()`: quando searchPromise
      // vence a corrida primeiro, este timer não é cancelado (não há
      // clearTimeout aqui) — sem unref() ele ficaria segurando o processo
      // vivo por até SEARCH_TIMEOUT_MS mesmo depois da resposta real já
      // ter chegado.
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('Timeout na pesquisa Gemini');
          error.code = 'TIMEOUT';
          reject(error);
        }, SEARCH_TIMEOUT_MS).unref();
      });

      const searchPromise = genAI.models.generateContent({
        model: process.env.GEMINI_SEARCH_MODEL || 'gemini-2.5-flash',
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          // Google Search Grounding — habilita o modelo a buscar na web
          // e citar fontes via response.candidates[0].groundingMetadata.
          tools: [{ googleSearch: {} }],
        },
      });

      const response = await Promise.race([searchPromise, timeoutPromise]);

      // Extrai resultados
      const result = await this.extractSearchResults(response, query, maxResults);

      // Filtra domínios
      const filteredResult = this.filterByDomains(result, allowedDomains);

      // Trunca resposta se necessário
      if (filteredResult.answer.length > MAX_ANSWER_LENGTH) {
        filteredResult.answer = filteredResult.answer.slice(0, MAX_ANSWER_LENGTH) + '... [truncado]';
        filteredResult.truncated = true;
      }

      filteredResult.durationMs = Date.now() - startTime;
      
      return filteredResult;

    } catch (error) {
      // Tratamento de erros específicos
      if (error.code === 'TIMEOUT') throw error;
      
      if (error.message?.includes('quota') || error.message?.includes('exceeded')) {
        const quotaError = new Error('Quota da API Gemini excedida');
        quotaError.code = 'QUOTA_EXCEEDED';
        throw quotaError;
      }
      
      if (error.message?.includes('API key')) {
        const keyError = new Error('Chave de API Gemini inválida');
        keyError.code = 'INVALID_API_KEY';
        throw keyError;
      }
      
      // Erro genérico
      const genericError = new Error(`Erro na pesquisa Gemini: ${error.message}`);
      genericError.code = 'GEMINI_API_ERROR';
      genericError.originalError = error;
      throw genericError;
    }
  }

  /**
   * Constrói o prompt para a Gemini
   */
  buildPrompt(query, context, maxResults, language) {
    let prompt = `Pesquise informações atuais sobre: "${query}"\n\n`;
    
    if (context) {
      if (typeof context === 'string') {
        prompt += `Contexto adicional: ${context}\n\n`;
      } else {
        prompt += `Contexto adicional: ${JSON.stringify(context, null, 2)}\n\n`;
      }
    }
    
    prompt += `Instruções importantes:
1. Use Google Search Grounding para obter informações atualizadas
2. Limite a aproximadamente ${maxResults} fontes principais
3. Responda em ${language === 'pt-BR' ? 'português do Brasil' : language}
4. Cite explicitamente as fontes usadas (URL, título, site)
5. Se não encontrar informações suficientes, indique claramente
6. Seja objetivo e direto na resposta

Resposta baseada em fontes confiáveis:`;

    return prompt;
  }

  /**
   * Extrai resultados estruturados da resposta Gemini
   */
  async extractSearchResults(response, query, maxResults) {
    const sources = [];
    const citations = [];
    let answer = '';
    let searchQueries = [];

    try {
      // SDK unificado @google/genai: generateContent() já retorna o
      // objeto de resposta diretamente (sem o nível extra
      // "response.response" do SDK antigo), e `.text` é uma
      // PROPRIEDADE, não um método — ver mesmo padrão em
      // src/services/geminiService.js (`response.text`).
      answer = response.text || '';

      // Extrai citações (sources) - formato pode variar com a versão da API
      // O grounding é retornado em response.candidates[0].groundingMetadata
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];

        // Grounding metadata (existe quando há grounding)
        if (candidate.groundingMetadata) {
          const metadata = candidate.groundingMetadata;

          // Search queries usadas — o campo real do SDK é
          // `webSearchQueries` (não `searchQueries`, que não existe no
          // tipo GroundingMetadata do @google/genai).
          if (metadata.webSearchQueries) {
            searchQueries = metadata.webSearchQueries;
          }

          // Grounding chunks com fontes
          if (metadata.groundingChunks) {
            for (const chunk of metadata.groundingChunks) {
              if (chunk.web?.uri) {
                citations.push({
                  url: chunk.web.uri,
                  title: chunk.web.title || chunk.web.uri,
                  source: new URL(chunk.web.uri).hostname
                });
              }
            }
          }
        }
        
        // Fallback: busca por referências no texto
        if (citations.length === 0) {
          const urlRegex = /https?:\/\/[^\s<]+[^\s.,;:!?)]/g;
          const matches = answer.match(urlRegex) || [];
          for (const url of matches) {
            try {
              const parsed = new URL(url);
              citations.push({
                url: url,
                title: url,
                source: parsed.hostname
              });
            } catch (e) {
              // URL inválida, ignora
            }
          }
        }
      }

      // Limita citações
      if (citations.length > MAX_CITATIONS) {
        citations.length = MAX_CITATIONS;
      }

      // Gera fontes únicas a partir das citações
      const seenUrls = new Set();
      for (const citation of citations) {
        if (!seenUrls.has(citation.url)) {
          seenUrls.add(citation.url);
          sources.push({
            url: citation.url,
            title: citation.title || citation.url,
            source: citation.source || new URL(citation.url).hostname
          });
        }
      }

    } catch (error) {
      // Log do erro sem expor segredos
      console.error('Erro ao extrair resultados Gemini:', {
        message: error.message,
        hasResponse: !!response
      });
      
      // Se falhou, retorna o mínimo
      if (!answer) {
        answer = `Erro ao processar resposta da pesquisa: ${error.message}`;
      }
    }

    return {
      answer: answer || `Não foi possível obter informações sobre "${query}"`,
      sources: sources.slice(0, maxResults),
      citations: citations.slice(0, maxResults),
      searchQueries,
      truncated: false
    };
  }

  /**
   * Filtra fontes pela whitelist de domínios
   */
  filterByDomains(result, customDomains) {
    const domains = customDomains || ALLOWED_DOMAINS;
    
    const filteredSources = result.sources.filter(source => {
      try {
        const hostname = new URL(source.url).hostname.toLowerCase();
        // Remove subdomínios para validação mais flexível
        // (ex: docs.laravel.com é considerado laravel.com)
        const parts = hostname.split('.');
        const mainDomain = parts.length > 2 
          ? parts.slice(-2).join('.') 
          : hostname;
        
        return domains.has(hostname) || domains.has(mainDomain);
      } catch (e) {
        return false;
      }
    });

    const filteredCitations = result.citations.filter(citation => {
      try {
        const hostname = new URL(citation.url).hostname.toLowerCase();
        const parts = hostname.split('.');
        const mainDomain = parts.length > 2 
          ? parts.slice(-2).join('.') 
          : hostname;
        
        return domains.has(hostname) || domains.has(mainDomain);
      } catch (e) {
        return false;
      }
    });

    return {
      ...result,
      sources: filteredSources,
      citations: filteredCitations,
      filteredCount: result.sources.length - filteredSources.length,
      searchQueries: result.searchQueries || []
    };
  }
}
