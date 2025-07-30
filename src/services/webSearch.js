/**
 * Web Search Service for ChimpGPT Knowledge System
 *
 * Provides web search capabilities using DuckDuckGo API for factual information gathering.
 * Follows the same patterns as other external API integrations with circuit breaker protection.
 */

const axios = require('axios');
const { createLogger } = require('../core/logger');
const retryWithBreaker = require('../utils/retryWithBreaker');
const { sanitizeQuery } = require('../utils/inputSanitizer');

const logger = createLogger('webSearch');

// Circuit breaker configuration for web search
const SEARCH_BREAKER_CONFIG = {
  timeout: 30000, // 30 seconds
  retryAttempts: 2,
  resetTimeout: 300000, // 5 minutes
  breakerName: 'webSearch',
};

/**
 * Search the web using DuckDuckGo API
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} options.maxResults - Maximum number of results (default: 5)
 * @param {string} options.region - Search region (default: 'us-en')
 * @param {boolean} options.safeSearch - Enable safe search (default: true)
 * @returns {Promise<Object>} Search results with metadata
 */
async function searchWeb(query, options = {}) {
  const { maxResults = 5, region: _region = 'us-en', safeSearch = true } = options;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('Search query is required and must be a non-empty string');
  }

  // Sanitize the query
  const sanitizedQuery = sanitizeQuery(query);

  logger.info(`Performing web search for: "${sanitizedQuery}"`);

  const searchFunction = async () => {
    try {
      // Using DuckDuckGo Instant Answer API (free, no API key required)
      const response = await axios.get('https://api.duckduckgo.com/', {
        params: {
          q: sanitizedQuery,
          format: 'json',
          no_html: '1',
          skip_disambig: '1',
          no_redirect: '1',
          safe_search: safeSearch ? 'strict' : 'off',
        },
        timeout: 25000,
        headers: {
          'User-Agent': 'ChimpGPT-Bot/2.0 (Educational/Research Purpose)',
        },
      });

      const data = response.data;

      // Process DuckDuckGo response
      const results = {
        query: sanitizedQuery,
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
          source: 'DuckDuckGo Instance Answer',
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

      logger.info(`Web search completed: ${results.results.length} results found`);

      return {
        success: true,
        data: results,
        metadata: {
          query: sanitizedQuery,
          resultCount: results.results.length,
          hasInstantAnswer: !!results.instantAnswer,
          hasAbstract: !!results.abstract,
          searchTime: Date.now(),
        },
      };
    } catch (error) {
      logger.error('Web search API error:', {
        error: error.message,
        query: sanitizedQuery,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });

      throw new Error(`Web search failed: ${error.message}`);
    }
  };

  // Execute with circuit breaker protection
  return await retryWithBreaker(searchFunction, SEARCH_BREAKER_CONFIG);
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
 * Format search results for Discord display
 * @param {Object} searchResult - Search result object
 * @param {boolean} includeLinks - Whether to include clickable links
 * @returns {string} Formatted message
 */
function formatSearchResults(searchResult, includeLinks = true) {
  if (!searchResult.success) {
    return '❌ **Search Failed**\nUnable to retrieve search results at this time.';
  }

  const { data, factCheck } = searchResult;
  let formatted = `🔍 **Search Results for:** "${data.query}"\n\n`;

  // Add instant answer if available
  if (data.instantAnswer) {
    formatted += `💡 **Quick Answer:**\n${data.instantAnswer.text}\n\n`;
  }

  // Add abstract if available
  if (data.abstract) {
    formatted += `📋 **Summary:**\n${data.abstract.text}\n`;
    if (data.abstract.source !== 'Unknown') {
      formatted += `*Source: ${data.abstract.source}*\n\n`;
    }
  }

  // Add fact-check confidence if available
  if (factCheck) {
    const confidenceEmoji =
      factCheck.confidenceScore >= 70 ? '✅' : factCheck.confidenceScore >= 40 ? '⚠️' : '❓';
    formatted += `${confidenceEmoji} **Confidence:** ${factCheck.confidenceScore}%\n\n`;
  }

  // Add top results or explain why none were found
  if (data.results.length > 0) {
    formatted += `📖 **Related Information:**\n`;
    data.results.slice(0, 3).forEach((result, index) => {
      formatted += `${index + 1}. ${result.title}\n`;
      if (result.snippet && result.snippet !== result.title) {
        formatted += `   ${result.snippet.substring(0, 100)}...\n`;
      }
      if (includeLinks && result.url) {
        formatted += `   🔗 ${result.url}\n`;
      }
      formatted += '\n';
    });
  } else {
    // Keep it simple - just indicate search was attempted
    formatted += `📝 **Web Search:** No instant answers found for this query.\n`;
  }

  // Skip metadata when no results - let the technical content speak for itself
  if (data.results.length > 0 || data.instantAnswer || data.abstract) {
    formatted += `\n*Search completed with ${data.results.length} direct results*`;
  }

  return formatted;
}

module.exports = {
  searchWeb,
  searchForFactCheck,
  formatSearchResults,
};
