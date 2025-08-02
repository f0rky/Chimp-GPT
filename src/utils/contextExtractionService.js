/**
 * Context Extraction Service
 *
 * Provides intelligent analysis of message content to extract context,
 * themes, and intent for enhanced deletion response generation.
 *
 * @module ContextExtractionService
 */

const { createLogger } = require('../core/logger');

const logger = createLogger('contextExtractionService');

// Context analysis patterns
const ANALYSIS_PATTERNS = {
  // Question patterns
  questions: [
    /\b(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did)\b.*\?/i,
    /\b(help|explain|tell me|show me|guide|tutorial)\b/i,
    /\b(i need|i want|i'm looking for)\b/i,
  ],

  // Image generation patterns
  imageGeneration: [
    /\b(draw|generate|create|make|show|design)\b.*\b(image|picture|photo|art|artwork|illustration)\b/i,
    /\b(paint|sketch|render|visualize)\b/i,
    /\b(logo|banner|icon|avatar|wallpaper)\b/i,
  ],

  // Function call patterns
  functionCalls: [
    /\b(weather|forecast|temperature)\b/i,
    /\b(time|date|clock|timezone)\b/i,
    /\b(calculate|math|compute)\b/i,
    /\b(search|find|lookup|query)\b/i,
    /\b(translate|convert|transform)\b/i,
  ],

  // Conversation themes
  themes: {
    technical: [
      /\b(code|programming|software|development|bug|error|debug|api|database)\b/i,
      /\b(javascript|python|node|react|html|css|sql|json)\b/i,
    ],
    creative: [
      /\b(art|creative|design|music|story|write|poem|creative)\b/i,
      /\b(inspiration|idea|brainstorm|imagine)\b/i,
    ],
    help: [
      /\b(help|support|assist|guide|tutorial|how-to)\b/i,
      /\b(problem|issue|trouble|stuck|confused)\b/i,
    ],
    casual: [
      /\b(hello|hi|hey|good morning|good evening|thanks|thank you)\b/i,
      /\b(chat|talk|conversation|discuss)\b/i,
    ],
    business: [
      /\b(business|work|job|career|professional|company|project)\b/i,
      /\b(meeting|deadline|task|schedule|plan)\b/i,
    ],
  },
};

// Function type detection patterns
const FUNCTION_TYPES = {
  weather: /\b(weather|forecast|temperature|rain|snow|sunny|cloudy)\b/i,
  time: /\b(time|date|clock|timezone|now|today|tomorrow)\b/i,
  calculation: /\b(calculate|math|compute|sum|add|subtract|multiply|divide)\b/i,
  search: /\b(search|find|lookup|query|google|wiki)\b/i,
  translation: /\b(translate|convert|language|spanish|french|german)\b/i,
  image: /\b(draw|generate|create|make|image|picture|photo|art)\b/i,
};

/**
 * Context Extraction Service
 * Analyzes message content to extract meaningful context for deletion responses
 */
class ContextExtractionService {
  constructor() {
    this.cache = new Map(); // Cache for recently analyzed content
    this.cacheMaxSize = 1000;
    this.cacheMaxAge = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Extract comprehensive context from message content and metadata
   * @param {string} content - Message content
   * @param {Object} metadata - Additional message metadata
   * @returns {Object} Extracted context
   */
  extractContext(content, metadata = {}) {
    if (!content || typeof content !== 'string') {
      return this.getDefaultContext();
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(content, metadata);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const context = {
        content,
        summary: this.generateSummary(content),
        type: this.detectMessageType(content),
        theme: this.detectTheme(content),
        intent: this.detectIntent(content),
        functionType: this.detectFunctionType(content),
        imageContext: this.extractImageContext(content),
        conversationTheme: this.detectConversationTheme(content),
        complexity: this.assessComplexity(content),
        sentiment: this.detectSentiment(content),
        entities: this.extractEntities(content),
        keywords: this.extractKeywords(content),
        timestamp: Date.now(),
        ...metadata,
      };

      // Cache the result
      this.addToCache(cacheKey, context);

      logger.debug(
        {
          type: context.type,
          theme: context.theme,
          intent: context.intent,
          complexity: context.complexity,
        },
        'Extracted message context'
      );

      return context;
    } catch (error) {
      logger.error({ error, content: content.substring(0, 100) }, 'Error extracting context');
      return this.getDefaultContext(content);
    }
  }

  /**
   * Generate a concise summary of message content
   * @param {string} content - Message content
   * @returns {string} Summary
   */
  generateSummary(content) {
    if (!content) return 'Empty message';

    // Clean content
    const cleaned = content
      .replace(/[<@#&!>]/g, '') // Remove Discord mentions/formatting
      .replace(/https?:\/\/\S+/g, '[link]') // Replace URLs
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    if (cleaned.length <= 50) {
      return cleaned || 'No content';
    }

    // Try to find a meaningful sentence
    const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 0 && sentences[0].trim().length <= 50) {
      return sentences[0].trim();
    }

    // Truncate at word boundary
    const words = cleaned.split(' ');
    let summary = '';
    for (const word of words) {
      if ((summary + ' ' + word).length > 47) break;
      summary += (summary ? ' ' : '') + word;
    }

    return summary + '...';
  }

  /**
   * Detect the primary type of message
   * @param {string} content - Message content
   * @returns {string} Message type
   */
  detectMessageType(content) {
    if (this.matchesPatterns(content, ANALYSIS_PATTERNS.questions)) {
      return 'question';
    }

    if (this.matchesPatterns(content, ANALYSIS_PATTERNS.imageGeneration)) {
      return 'image_request';
    }

    if (this.matchesPatterns(content, ANALYSIS_PATTERNS.functionCalls)) {
      return 'function_call';
    }

    // Check for commands
    if (content.trim().startsWith('/') || content.trim().startsWith('!')) {
      return 'command';
    }

    return 'conversation';
  }

  /**
   * Detect conversation theme
   * @param {string} content - Message content
   * @returns {string} Detected theme
   */
  detectTheme(content) {
    for (const [theme, patterns] of Object.entries(ANALYSIS_PATTERNS.themes)) {
      if (this.matchesPatterns(content, patterns)) {
        return theme;
      }
    }
    return 'general';
  }

  /**
   * Detect user intent
   * @param {string} content - Message content
   * @returns {string} Detected intent
   */
  detectIntent(content) {
    if (this.matchesPatterns(content, ANALYSIS_PATTERNS.questions)) {
      return 'seeking_information';
    }

    if (this.matchesPatterns(content, ANALYSIS_PATTERNS.imageGeneration)) {
      return 'requesting_creation';
    }

    if (content.includes('help') || content.includes('assist')) {
      return 'requesting_help';
    }

    if (content.includes('thank') || content.includes('thanks')) {
      return 'expressing_gratitude';
    }

    if (/\b(hello|hi|hey|good morning|good evening)\b/i.test(content)) {
      return 'greeting';
    }

    return 'general_conversation';
  }

  /**
   * Detect specific function type being requested
   * @param {string} content - Message content
   * @returns {string|null} Function type or null
   */
  detectFunctionType(content) {
    for (const [type, pattern] of Object.entries(FUNCTION_TYPES)) {
      if (pattern.test(content)) {
        return type;
      }
    }
    return null;
  }

  /**
   * Extract image generation context
   * @param {string} content - Message content
   * @returns {string|null} Image context or null
   */
  extractImageContext(content) {
    if (!this.matchesPatterns(content, ANALYSIS_PATTERNS.imageGeneration)) {
      return null;
    }

    // Extract the subject/theme of the image request
    const imageKeywords = [
      'draw',
      'generate',
      'create',
      'make',
      'show',
      'design',
      'paint',
      'sketch',
      'render',
      'visualize',
    ];

    const words = content.toLowerCase().split(/\s+/);
    let contextStart = -1;

    for (let i = 0; i < words.length; i++) {
      if (imageKeywords.some(keyword => words[i].includes(keyword))) {
        contextStart = i + 1;
        break;
      }
    }

    if (contextStart > -1 && contextStart < words.length) {
      const contextWords = words.slice(contextStart, Math.min(contextStart + 5, words.length));
      return (
        contextWords
          .join(' ')
          .replace(/[^\w\s]/g, '')
          .trim() || 'image'
      );
    }

    return 'image';
  }

  /**
   * Detect overall conversation theme
   * @param {string} content - Message content
   * @returns {string} Conversation theme
   */
  detectConversationTheme(content) {
    const theme = this.detectTheme(content);
    const intent = this.detectIntent(content);

    if (intent === 'seeking_information' && theme === 'technical') {
      return 'technical support';
    }

    if (intent === 'requesting_creation') {
      return 'creative request';
    }

    if (intent === 'requesting_help') {
      return 'help session';
    }

    return `${theme} ${intent}`.replace('_', ' ');
  }

  /**
   * Assess content complexity
   * @param {string} content - Message content
   * @returns {number} Complexity score (0-1)
   */
  assessComplexity(content) {
    let score = 0;

    // Length factor
    if (content.length > 100) score += 0.2;
    if (content.length > 300) score += 0.2;

    // Technical terms
    const technicalTerms =
      /\b(algorithm|database|api|framework|architecture|implementation|optimization)\b/gi;
    const techMatches = content.match(technicalTerms) || [];
    score += Math.min(techMatches.length * 0.1, 0.3);

    // Question complexity
    if (content.includes('?')) {
      const questionWords = content.match(/\b(how|why|what|when|where|which)\b/gi) || [];
      score += Math.min(questionWords.length * 0.05, 0.2);
    }

    // Multiple topics
    const topics = Object.values(ANALYSIS_PATTERNS.themes).filter(patterns =>
      this.matchesPatterns(content, patterns)
    );
    if (topics.length > 1) score += 0.1;

    return Math.min(score, 1);
  }

  /**
   * Detect basic sentiment
   * @param {string} content - Message content
   * @returns {string} Sentiment (positive, negative, neutral)
   */
  detectSentiment(content) {
    const positiveWords =
      /\b(good|great|awesome|excellent|perfect|love|like|happy|thanks|thank you)\b/gi;
    const negativeWords =
      /\b(bad|terrible|awful|hate|dislike|angry|frustrated|problem|issue|error|broken)\b/gi;

    const positiveMatches = content.match(positiveWords) || [];
    const negativeMatches = content.match(negativeWords) || [];

    if (positiveMatches.length > negativeMatches.length) return 'positive';
    if (negativeMatches.length > positiveMatches.length) return 'negative';
    return 'neutral';
  }

  /**
   * Extract key entities from content
   * @param {string} content - Message content
   * @returns {Array} Array of entities
   */
  extractEntities(content) {
    const entities = [];

    // Extract mentions
    const mentions = content.match(/<@!?\d+>/g) || [];
    entities.push(...mentions.map(m => ({ type: 'mention', value: m })));

    // Extract channels
    const channels = content.match(/<#\d+>/g) || [];
    entities.push(...channels.map(c => ({ type: 'channel', value: c })));

    // Extract URLs
    const urls = content.match(/https?:\/\/\S+/g) || [];
    entities.push(...urls.map(u => ({ type: 'url', value: u })));

    // Extract numbers
    const numbers = content.match(/\b\d+(\.\d+)?\b/g) || [];
    entities.push(...numbers.map(n => ({ type: 'number', value: n })));

    return entities;
  }

  /**
   * Extract keywords from content
   * @param {string} content - Message content
   * @returns {Array} Array of keywords
   */
  extractKeywords(content) {
    // Simple keyword extraction - remove common words
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'can',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
    ]);

    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Count frequency and return top keywords
    const frequency = {};
    words.forEach(word => {
      frequency[word] = (frequency[word] || 0) + 1;
    });

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Helper method to check if content matches any of the given patterns
   * @param {string} content - Content to check
   * @param {Array} patterns - Array of regex patterns
   * @returns {boolean} True if any pattern matches
   */
  matchesPatterns(content, patterns) {
    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * Generate cache key for content and metadata
   * @param {string} content - Message content
   * @param {Object} metadata - Message metadata
   * @returns {string} Cache key
   */
  generateCacheKey(content, metadata) {
    const metaKey = JSON.stringify(metadata);
    return `${content.substring(0, 50)}_${metaKey}`.replace(/\s+/g, '_');
  }

  /**
   * Get context from cache
   * @param {string} cacheKey - Cache key
   * @returns {Object|null} Cached context or null
   */
  getFromCache(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.context;
    }
    return null;
  }

  /**
   * Add context to cache
   * @param {string} cacheKey - Cache key
   * @param {Object} context - Context to cache
   */
  addToCache(cacheKey, context) {
    // Clean cache if it's getting too large
    if (this.cache.size >= this.cacheMaxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(cacheKey, {
      context,
      timestamp: Date.now(),
    });
  }

  /**
   * Get default context for fallback scenarios
   * @param {string} content - Original content (optional)
   * @returns {Object} Default context
   */
  getDefaultContext(content = '') {
    return {
      content,
      summary: content ? this.generateSummary(content) : 'No content',
      type: 'unknown',
      theme: 'general',
      intent: 'unknown',
      functionType: null,
      imageContext: null,
      conversationTheme: 'general conversation',
      complexity: 0,
      sentiment: 'neutral',
      entities: [],
      keywords: [],
      timestamp: Date.now(),
    };
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
    logger.debug('Context extraction cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.cacheMaxSize,
      maxAge: this.cacheMaxAge,
    };
  }
}

// Export singleton instance
const contextExtractionService = new ContextExtractionService();

module.exports = {
  contextExtractionService,
  ANALYSIS_PATTERNS,
  FUNCTION_TYPES,
};
