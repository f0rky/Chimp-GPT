/**
 * Enhanced Web Search Service for ChimpGPT Knowledge System
 *
 * Provides multi-engine web search capabilities with fallback support:
 * 1. SerpApi (Google Search) - Primary for real-time/current data
 * 2. Brave Search API - Secondary for general queries
 * 3. DuckDuckGo API - Fallback for instant answers
 *
 * Follows PocketFlow patterns with circuit breaker protection.
 */

const axios = require('axios');
const { createLogger } = require('../core/logger');
const retryWithBreaker = require('../utils/retryWithBreaker');
const { sanitizeQuery } = require('../utils/inputSanitizer');
const searchCache = require('../utils/searchCache');

const logger = createLogger('webSearch');

// Search engine configurations
const SEARCH_ENGINES = {
  SERPAPI: 'serpapi',
  BRAVE: 'brave',
  DUCKDUCKGO: 'duckduckgo',
};

// API Keys from environment
const SERPAPI_KEY = process.env.SERPAPI_API_KEY;
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;

// Circuit breaker configuration for web search
const SEARCH_BREAKER_CONFIG = {
  timeout: 30000, // 30 seconds
  retryAttempts: 2,
  resetTimeout: 300000, // 5 minutes
  breakerName: 'webSearch',
};

/**
 * Search using SerpApi (Google Search) - Best for current/real-time data
 */
async function searchWithSerpApi(query, options = {}) {
  if (!SERPAPI_KEY) {
    throw new Error('SerpApi key not configured');
  }

  const { maxResults = 5 } = options;

  logger.info(`Performing SerpApi search for: "${query}"`);

  const response = await axios.get('https://serpapi.com/search', {
    params: {
      q: query,
      api_key: SERPAPI_KEY,
      engine: 'google',
      num: Math.min(maxResults, 10), // SerpApi max 10 results
      hl: 'en',
      gl: 'us',
    },
    timeout: 25000,
    headers: {
      'User-Agent': 'ChimpGPT-Bot/2.1 (Educational/Research Purpose)',
    },
  });

  const data = response.data;

  // Process SerpApi response
  const results = {
    query,
    timestamp: new Date().toISOString(),
    source: 'Google (SerpApi)',
    results: [],
    instantAnswer: null,
    abstract: null,
    infobox: null,
  };

  // Extract answer box/featured snippet (instant answer)
  if (data.answer_box) {
    const answerBox = data.answer_box;
    results.instantAnswer = {
      text: answerBox.answer || answerBox.snippet || answerBox.result,
      type: answerBox.type || 'featured_snippet',
      source: answerBox.displayed_link || 'Google Answer Box',
      title: answerBox.title,
    };
  }

  // Extract knowledge graph (abstract/infobox)
  if (data.knowledge_graph) {
    const kg = data.knowledge_graph;
    results.abstract = {
      text: kg.description || kg.description_text,
      source: kg.source?.name || kg.title || 'Google Knowledge Graph',
      url: kg.website || kg.source?.link,
    };

    if (kg.attributes) {
      results.infobox = {
        content: Object.entries(kg.attributes)
          .slice(0, 5)
          .map(([key, value]) => ({
            label: key,
            value: value,
          })),
        meta: { title: kg.title, type: kg.type },
      };
    }
  }

  // Extract organic search results
  if (data.organic_results && Array.isArray(data.organic_results)) {
    results.results = data.organic_results.slice(0, maxResults).map(result => ({
      title: result.title,
      snippet: result.snippet,
      url: result.link,
      source: result.displayed_link || result.link,
      position: result.position,
    }));
  }

  logger.info(`SerpApi search completed: ${results.results.length} results found`);

  return {
    success: true,
    data: results,
    metadata: {
      query,
      resultCount: results.results.length,
      hasInstantAnswer: !!results.instantAnswer,
      hasAbstract: !!results.abstract,
      searchTime: Date.now(),
      engine: 'serpapi',
    },
  };
}

/**
 * Search using Brave Search API - Good for general queries
 */
async function searchWithBrave(query, options = {}) {
  if (!BRAVE_KEY) {
    throw new Error('Brave Search API key not configured');
  }

  const { maxResults = 5 } = options;

  logger.info(`Performing Brave search for: "${query}"`);

  const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    params: {
      q: query,
      count: Math.min(maxResults, 20), // Brave max 20 results
      country: 'US',
      search_lang: 'en',
      ui_lang: 'en-US',
    },
    timeout: 25000,
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_KEY,
      'User-Agent': 'ChimpGPT-Bot/2.1 (Educational/Research Purpose)',
    },
  });

  const data = response.data;

  // Process Brave response
  const results = {
    query,
    timestamp: new Date().toISOString(),
    source: 'Brave Search',
    results: [],
    instantAnswer: null,
    abstract: null,
    infobox: null,
  };

  // Extract featured snippet/instant answer
  if (data.mixed?.main && data.mixed.main.length > 0) {
    const featured = data.mixed.main.find(item => item.type === 'web' && item.featured);
    if (featured) {
      results.instantAnswer = {
        text: featured.description,
        type: 'featured_snippet',
        source: featured.url,
        title: featured.title,
      };
    }
  }

  // Extract web results
  if (data.web?.results && Array.isArray(data.web.results)) {
    results.results = data.web.results.slice(0, maxResults).map((result, index) => ({
      title: result.title,
      snippet: result.description,
      url: result.url,
      source: result.url,
      position: index + 1,
    }));
  }

  logger.info(`Brave search completed: ${results.results.length} results found`);

  return {
    success: true,
    data: results,
    metadata: {
      query,
      resultCount: results.results.length,
      hasInstantAnswer: !!results.instantAnswer,
      hasAbstract: !!results.abstract,
      searchTime: Date.now(),
      engine: 'brave',
    },
  };
}

/**
 * Intelligent search engine selection based on query type
 */
function selectSearchEngine(query) {
  const lowerQuery = query.toLowerCase();

  // Financial/real-time data queries - prefer SerpApi
  if (
    lowerQuery.includes('price') ||
    lowerQuery.includes('bitcoin') ||
    lowerQuery.includes('stock') ||
    lowerQuery.includes('current') ||
    lowerQuery.includes('latest') ||
    lowerQuery.includes('today') ||
    lowerQuery.includes('cryptocurrency') ||
    lowerQuery.includes('market') ||
    lowerQuery.includes('usd')
  ) {
    return SEARCH_ENGINES.SERPAPI;
  }

  // News/trending topics - prefer SerpApi
  if (
    lowerQuery.includes('news') ||
    lowerQuery.includes('breaking') ||
    lowerQuery.includes('recent') ||
    lowerQuery.includes('2025') ||
    lowerQuery.includes('2024') ||
    lowerQuery.includes('happening')
  ) {
    return SEARCH_ENGINES.SERPAPI;
  }

  // Technical/programming queries - prefer Brave (good for developer content)
  if (
    lowerQuery.includes('programming') ||
    lowerQuery.includes('code') ||
    lowerQuery.includes('javascript') ||
    lowerQuery.includes('python') ||
    lowerQuery.includes('react') ||
    lowerQuery.includes('node') ||
    lowerQuery.includes('api') ||
    lowerQuery.includes('documentation') ||
    lowerQuery.includes('tutorial')
  ) {
    return SEARCH_ENGINES.BRAVE;
  }

  // General factual queries - DuckDuckGo instant answers
  if (
    lowerQuery.includes('what is') ||
    lowerQuery.includes('who is') ||
    lowerQuery.includes('definition') ||
    lowerQuery.includes('meaning') ||
    lowerQuery.includes('explain')
  ) {
    return SEARCH_ENGINES.DUCKDUCKGO;
  }

  // Default: Try SerpApi first, then fallback
  return SEARCH_ENGINES.SERPAPI;
}

/**
 * Enhanced web search with multi-engine support and intelligent fallbacks
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} options.maxResults - Maximum number of results (default: 5)
 * @param {string} options.preferredEngine - Force specific engine
 * @param {boolean} options.enableFallback - Enable fallback to other engines (default: true)
 * @returns {Promise<Object>} Search results with metadata
 */
async function searchWeb(query, options = {}) {
  const { maxResults = 5, preferredEngine, enableFallback = true } = options;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('Search query is required and must be a non-empty string');
  }

  // Sanitize the query
  const sanitizedQuery = sanitizeQuery(query);

  // Check cache first to avoid redundant API calls
  const cacheKey = `${sanitizedQuery}:${maxResults}:${preferredEngine || 'auto'}`;
  const cachedResult = searchCache.get(cacheKey);

  if (cachedResult) {
    logger.info(`Cache hit for search query: "${sanitizedQuery}"`, {
      cacheStats: searchCache.getStats(),
    });
    return cachedResult;
  }

  // Determine which search engine to use
  const selectedEngine = preferredEngine || selectSearchEngine(sanitizedQuery);

  logger.info(`Performing enhanced web search for: "${sanitizedQuery}" using ${selectedEngine}`);

  const searchFunction = async () => {
    const searchEngines = [selectedEngine];

    // Add fallback engines if enabled
    if (enableFallback) {
      if (selectedEngine !== SEARCH_ENGINES.SERPAPI && SERPAPI_KEY) {
        searchEngines.push(SEARCH_ENGINES.SERPAPI);
      }
      if (selectedEngine !== SEARCH_ENGINES.BRAVE && BRAVE_KEY) {
        searchEngines.push(SEARCH_ENGINES.BRAVE);
      }
      if (selectedEngine !== SEARCH_ENGINES.DUCKDUCKGO) {
        searchEngines.push(SEARCH_ENGINES.DUCKDUCKGO);
      }
    }

    let lastError = null;

    // Try each search engine in order
    for (const engine of searchEngines) {
      try {
        let result;

        switch (engine) {
          case SEARCH_ENGINES.SERPAPI:
            if (!SERPAPI_KEY) {
              logger.warn('SerpApi key not configured, skipping');
              continue;
            }
            result = await searchWithSerpApi(sanitizedQuery, { maxResults });
            break;

          case SEARCH_ENGINES.BRAVE:
            if (!BRAVE_KEY) {
              logger.warn('Brave Search API key not configured, skipping');
              continue;
            }
            result = await searchWithBrave(sanitizedQuery, { maxResults });
            break;

          case SEARCH_ENGINES.DUCKDUCKGO:
            result = await searchWithDuckDuckGo(sanitizedQuery, { maxResults });
            break;

          default:
            logger.warn(`Unknown search engine: ${engine}`);
            continue;
        }

        // If we got results, cache and return them
        if (result && result.success) {
          logger.info(`Search successful with ${engine}: ${result.data.results.length} results`);

          // Cache the successful result
          searchCache.set(cacheKey, result);

          return result;
        }
      } catch (error) {
        logger.warn(`Search failed with ${engine}:`, error.message);
        lastError = error;
        continue;
      }
    }

    // If all engines failed, throw the last error
    throw lastError || new Error('All search engines failed');
  };

  // Execute with circuit breaker protection
  return await retryWithBreaker(searchFunction, SEARCH_BREAKER_CONFIG);
}

/**
 * Search using DuckDuckGo API - Free fallback option
 */
async function searchWithDuckDuckGo(query, options = {}) {
  const { maxResults = 5 } = options;

  logger.info(`Performing DuckDuckGo search for: "${query}"`);

  const response = await axios.get('https://api.duckduckgo.com/', {
    params: {
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
      no_redirect: '1',
      safe_search: 'strict',
    },
    timeout: 25000,
    headers: {
      'User-Agent': 'ChimpGPT-Bot/2.1 (Educational/Research Purpose)',
    },
  });

  const data = response.data;

  // Process DuckDuckGo response
  const results = {
    query,
    timestamp: new Date().toISOString(),
    source: 'DuckDuckGo',
    results: [],
    instantAnswer: null,
    abstract: null,
    infobox: null,
  };

  // Extract instant answer if available
  if (data.Answer) {
    results.instantAnswer = {
      text: data.Answer,
      type: data.AnswerType || 'instant',
      source: 'DuckDuckGo Instant Answer',
    };
  }

  // Extract abstract information
  if (data.Abstract) {
    results.abstract = {
      text: data.Abstract,
      source: data.AbstractSource || 'Unknown',
      url: data.AbstractURL || null,
    };
  }

  // Extract related topics/results
  if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
    results.results = data.RelatedTopics.slice(0, maxResults)
      .filter(topic => topic.Text && topic.FirstURL)
      .map(topic => ({
        title: topic.Text.split(' - ')[0] || topic.Text,
        snippet: topic.Text,
        url: topic.FirstURL,
        source: 'DuckDuckGo Related Topics',
      }));
  }

  // If we have infobox data, include it
  if (data.Infobox && data.Infobox.content) {
    results.infobox = {
      content: data.Infobox.content.slice(0, 3), // First 3 infobox items
      meta: data.Infobox.meta || null,
    };
  }

  logger.info(`DuckDuckGo search completed: ${results.results.length} results found`);

  return {
    success: true,
    data: results,
    metadata: {
      query,
      resultCount: results.results.length,
      hasInstantAnswer: !!results.instantAnswer,
      hasAbstract: !!results.abstract,
      searchTime: Date.now(),
      engine: 'duckduckgo',
    },
  };
}

/**
 * Search for specific information with focused query enhancement
 * @param {string} statement - Statement to verify or search for
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Enhanced search results with confidence scoring
 */
async function searchForFactCheck(statement, options = {}) {
  const enhancedQuery = `${statement} facts verification`;

  logger.info(`Performing fact-check search for: "${statement}"`);

  const searchResult = await searchWeb(enhancedQuery, {
    ...options,
    maxResults: 8, // More results for fact-checking
  });

  if (!searchResult.success) {
    return searchResult;
  }

  // Add confidence scoring based on search results
  const results = searchResult.data;
  let confidenceScore = 20; // Base confidence for successful API call
  let verification = 'Search completed but no specific verification found';

  // Increase confidence if we have instant answer
  if (results.instantAnswer) {
    confidenceScore += 40;
    verification = results.instantAnswer.text;
  }

  // Increase confidence if we have abstract with source
  if (results.abstract && results.abstract.source !== 'Unknown') {
    confidenceScore += 30;
    verification = results.abstract.text;
  }

  // Increase confidence based on number of related results
  if (results.results && results.results.length > 0) {
    confidenceScore += Math.min(results.results.length * 5, 30);
  }

  // If we have infobox data, that's also valuable
  if (results.infobox && results.infobox.content) {
    confidenceScore += 20;
    if (!results.instantAnswer && !results.abstract) {
      verification = 'Information found in knowledge base';
    }
  }

  // DuckDuckGo search successful but may not have detailed results
  // This is normal behavior for DuckDuckGo's Instant Answer API - it doesn't provide general search results
  if (
    !results.instantAnswer &&
    !results.abstract &&
    (!results.results || results.results.length === 0)
  ) {
    confidenceScore = 40; // Higher confidence - API worked, just no instant answers available
    verification = `DuckDuckGo search completed. This API specializes in instant answers for factual queries, but your query may require general search results not provided by this service.`;
  }

  return {
    ...searchResult,
    factCheck: {
      statement,
      confidenceScore: Math.min(confidenceScore, 100),
      verification,
      sources: results.results ? results.results.length : 0,
      hasInstantAnswer: !!results.instantAnswer,
      hasAbstract: !!results.abstract,
      hasInfobox: !!(results.infobox && results.infobox.content),
    },
  };
}

/**
 * Format enhanced search results for Discord display
 * @param {Object} searchResult - Search result object
 * @param {boolean} includeLinks - Whether to include clickable links
 * @returns {string} Formatted message
 */
function formatSearchResults(searchResult, includeLinks = true) {
  if (!searchResult.success) {
    return '❌ **Search Failed**\nUnable to retrieve search results at this time.';
  }

  const { data, factCheck, metadata } = searchResult;
  const searchEngine = metadata?.engine || 'unknown';
  const engineEmoji =
    {
      serpapi: '🌐',
      brave: '🦁',
      duckduckgo: '🦆',
    }[searchEngine] || '🔍';

  let formatted = `${engineEmoji} **Search Results from ${data.source}:** "${data.query}"\n\n`;

  // Add instant answer if available (prioritize this for financial/current data)
  if (data.instantAnswer) {
    formatted += `💡 **${data.instantAnswer.title ? data.instantAnswer.title : 'Quick Answer'}:**\n`;
    formatted += `${data.instantAnswer.text}\n`;
    if (data.instantAnswer.source && data.instantAnswer.source !== data.source) {
      formatted += `*Source: ${data.instantAnswer.source}*\n`;
    }
    formatted += '\n';
  }

  // Add abstract/knowledge graph info if available
  if (data.abstract && data.abstract.text) {
    formatted += `📋 **Summary:**\n${data.abstract.text}\n`;
    if (data.abstract.source && data.abstract.source !== 'Unknown') {
      formatted += `*Source: ${data.abstract.source}*\n`;
    }
    formatted += '\n';
  }

  // Add infobox data for structured information
  if (data.infobox && data.infobox.content && data.infobox.content.length > 0) {
    formatted += `📊 **Key Information:**\n`;
    data.infobox.content.slice(0, 3).forEach(item => {
      if (item.label && item.value) {
        formatted += `• **${item.label}**: ${item.value}\n`;
      }
    });
    formatted += '\n';
  }

  // Add fact-check confidence if available
  if (factCheck) {
    const confidenceEmoji =
      factCheck.confidenceScore >= 70 ? '✅' : factCheck.confidenceScore >= 40 ? '⚠️' : '❓';
    formatted += `${confidenceEmoji} **Confidence:** ${factCheck.confidenceScore}%\n\n`;
  }

  // Add top search results
  if (data.results.length > 0) {
    formatted += `📖 **Related Information:**\n`;
    data.results.slice(0, 3).forEach((result, index) => {
      formatted += `${index + 1}. **${result.title}**\n`;
      if (result.snippet && result.snippet !== result.title) {
        // Truncate long snippets more intelligently
        const snippet =
          result.snippet.length > 120 ? result.snippet.substring(0, 120) + '...' : result.snippet;
        formatted += `   ${snippet}\n`;
      }
      if (includeLinks && result.url) {
        formatted += `   🔗 ${result.url}\n`;
      }
      formatted += '\n';
    });
  } else if (!data.instantAnswer && !data.abstract) {
    // Only show this if we have no other content
    formatted += `📝 **Note:** No direct results found, but search was completed using ${data.source}.\n\n`;
  }

  // Add search metadata with engine info
  if (data.results.length > 0 || data.instantAnswer || data.abstract) {
    formatted += `\n*Searched via ${data.source} • ${data.results.length} results*`;
  }

  return formatted;
}

module.exports = {
  searchWeb,
  searchForFactCheck,
  formatSearchResults,
};
