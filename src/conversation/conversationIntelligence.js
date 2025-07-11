/**
 * Conversation Intelligence Module
 *
 * This module provides intelligent conversation analysis including relevance scoring,
 * temporal decay, bot-directed message detection, and semantic similarity analysis.
 * It transforms naive message chronology into smart contextual understanding.
 *
 * @module ConversationIntelligence
 * @author Brett
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('conversationIntelligence');

/**
 * Configuration for conversation intelligence
 * @constant {Object}
 */
const CONFIG = {
  // Temporal decay settings
  MEMORY_MINUTES: parseInt(process.env.CONVERSATION_MEMORY_MINUTES, 10) || 5,
  DECAY_RATE: parseFloat(process.env.TEMPORAL_DECAY_RATE) || 0.1,

  // Relevance thresholds
  MIN_RELEVANCE_THRESHOLD: parseFloat(process.env.MIN_RELEVANCE_THRESHOLD) || 0.3,
  BOT_DIRECTED_BOOST: parseFloat(process.env.BOT_DIRECTED_BOOST) || 0.4,
  REPLY_CHAIN_BOOST: parseFloat(process.env.REPLY_CHAIN_BOOST) || 0.3,

  // Context limits
  MAX_WEIGHTED_CONTEXT_TOKENS: parseInt(process.env.MAX_WEIGHTED_CONTEXT_TOKENS, 10) || 2000,
  AMBIENT_CONTEXT_RATIO: parseFloat(process.env.AMBIENT_CONTEXT_RATIO) || 0.2,
};

/**
 * Bot name patterns for detection (configurable)
 * @constant {Array<string>}
 */
const BOT_NAMES = ['chimp', 'chimpgpt', 'bot', process.env.BOT_NAME?.toLowerCase() || 'chimp'];

/**
 * Patterns that indicate a message is directed at the bot
 * @constant {Array<RegExp>}
 */
const BOT_DIRECTED_PATTERNS = [
  // Direct mentions and names
  new RegExp(`\\b(?:${BOT_NAMES.join('|')})\\b`, 'i'),
  /@\w+/, // @mentions

  // Question patterns directed at bot
  /^(?:hey|hi|hello|yo)\s+(?:bot|chimp)/i,
  /can you\s+/i,
  /please\s+/i,
  /could you\s+/i,
  /would you\s+/i,

  // Command patterns
  /^[!/]/, // Commands starting with ! or /

  // Direct questions
  /\?$/, // Ends with question mark
  /^(?:what|where|when|how|why|who)(?:\s|'s\s)/i, // Questions starting with wh-words
];

/**
 * Patterns that indicate continuation of previous conversation
 * @constant {Array<RegExp>}
 */
const CONTINUATION_PATTERNS = [
  /^(?:and|also|but|however|though|still|yet)\s/i,
  /^(?:no|yes|yeah|nah|yep|sure|ok|okay)\s?$/i,
  /^(?:thanks|thank you|thx)\s?/i,
];

/**
 * Patterns that indicate general chat (lower relevance)
 * @constant {Array<RegExp>}
 */
const GENERAL_CHAT_PATTERNS = [
  /^(?:lol|haha|lmao|rofl)\s?$/i,
  /^(?:nice|cool|wow|awesome)\s?$/i,
  /<a?:.+?:\d+>/g, // Discord emojis
  /\ud83c[\udf00-\udfff]|\ud83d[\udc00-\ude4f\ude80-\udeff]|\ud83e[\udd00-\uddff]/g, // Unicode emojis
];

/**
 * Calculate temporal decay factor based on message age
 * @param {number} messageTimestamp - When the message was sent
 * @param {number} currentTimestamp - Current time
 * @returns {number} Decay factor between 0 and 1
 */
function calculateTemporalDecay(messageTimestamp, currentTimestamp = Date.now()) {
  const ageMinutes = (currentTimestamp - messageTimestamp) / (1000 * 60);
  const memoryWindow = CONFIG.MEMORY_MINUTES;

  if (ageMinutes <= 0) return 1.0; // Future messages (shouldn't happen)
  if (ageMinutes >= memoryWindow * 3) return 0.1; // Very old messages get minimal weight

  // Exponential decay function: weight = e^(-age * decay_rate)
  const decayFactor = Math.exp(-ageMinutes * CONFIG.DECAY_RATE);

  // Ensure minimum threshold
  return Math.max(decayFactor, 0.1);
}

/**
 * Detect if a message is directed at the bot
 * @param {string} content - Message content to analyze
 * @param {Object} context - Additional context (reply chains, etc.)
 * @returns {Object} Detection result with confidence and patterns matched
 */
function detectBotIntent(content, context = {}) {
  if (!content || typeof content !== 'string') {
    return { isBotDirected: false, confidence: 0, patterns: [] };
  }

  const normalizedContent = content.toLowerCase().trim();
  const matchedPatterns = [];
  let confidence = 0;

  // Special handling for explicit bot interactions (highest confidence)

  // Discord @mentions should get maximum confidence
  if (/<@\d+>/.test(content)) {
    confidence = 1.0; // Maximum confidence for direct Discord mentions
    matchedPatterns.push('discord_mention');
  }

  // Commands should also get very high confidence
  else if (/^[!/]/.test(normalizedContent)) {
    confidence = 0.8; // Very high confidence for explicit commands
    matchedPatterns.push('command');
  }

  // If not a mention or command, check other bot-directed patterns
  else {
    for (const pattern of BOT_DIRECTED_PATTERNS) {
      if (pattern.test(normalizedContent)) {
        matchedPatterns.push(pattern.source);

        // Give questions higher confidence since they're interactive
        if (pattern.source.includes('?') || pattern.source.includes('what|where|when')) {
          confidence += 0.5; // Higher confidence for questions
        } else {
          confidence += 0.3; // Standard confidence for other patterns
        }
      }
    }
  }

  // Check for continuation patterns (moderate confidence)
  for (const pattern of CONTINUATION_PATTERNS) {
    if (pattern.test(normalizedContent)) {
      matchedPatterns.push(`continuation:${pattern.source}`);
      confidence += 0.2;
    }
  }

  // Reduce confidence for general chat patterns
  for (const pattern of GENERAL_CHAT_PATTERNS) {
    if (pattern.test(normalizedContent)) {
      confidence *= 0.5; // Reduce by half
      matchedPatterns.push(`general:${pattern.source}`);
    }
  }

  // Reply chain context boost
  if (context.isReply && context.replyToBotMessage) {
    confidence += CONFIG.REPLY_CHAIN_BOOST;
    matchedPatterns.push('reply_to_bot');
  }

  // Very short messages are likely reactions/general chat
  if (normalizedContent.length < 3) {
    confidence *= 0.3;
  }

  // Cap confidence at 1.0
  confidence = Math.min(confidence, 1.0);

  const isBotDirected = confidence > 0.4;

  if (isBotDirected) {
    logger.debug(
      {
        content: content.substring(0, 50),
        confidence,
        patterns: matchedPatterns,
      },
      'Detected bot-directed message'
    );
  }

  return {
    isBotDirected,
    confidence,
    patterns: matchedPatterns,
  };
}

/**
 * Calculate semantic similarity between two messages using simple keyword matching
 * Note: This is a basic implementation. For production, consider using embeddings or NLP models.
 * @param {string} message1 - First message content
 * @param {string} message2 - Second message content
 * @returns {number} Similarity score between 0 and 1
 */
function calculateSemanticSimilarity(message1, message2) {
  if (!message1 || !message2) return 0;

  // Simple keyword-based similarity
  const normalize = text =>
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out very short words

  const words1 = new Set(normalize(message1));
  const words2 = new Set(normalize(message2));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Calculate Jaccard similarity
  const intersection = new Set([...words1].filter(word => words2.has(word)));
  const union = new Set([...words1, ...words2]);

  const similarity = intersection.size / union.size;

  // Boost for common question words, topics
  const topicWords = ['weather', 'time', 'quake', 'server', 'stats', 'image', 'generate', 'help'];
  const topicBoost = topicWords.some(topic => words1.has(topic) && words2.has(topic)) ? 0.2 : 0;

  return Math.min(similarity + topicBoost, 1.0);
}

/**
 * Calculate overall relevance score for a message
 * @param {Object} message - Message object with content and metadata
 * @param {Object} context - Conversation context
 * @param {number} currentTimestamp - Current time for temporal calculations
 * @returns {Object} Relevance analysis with score and components
 */
function calculateRelevanceScore(message, context = {}, currentTimestamp = Date.now()) {
  if (!message || !message.content) {
    return {
      totalScore: 0,
      components: {
        temporal: 0,
        botDirected: 0,
        semantic: 0,
        reply: 0,
        user: 0,
      },
    };
  }

  const components = {};

  // 1. Temporal decay factor
  components.temporal = calculateTemporalDecay(message.timestamp, currentTimestamp);

  // 2. Bot-directed detection
  const botIntent = detectBotIntent(message.content, {
    isReply: context.isReply || false,
    replyToBotMessage: context.replyToBotMessage || false,
  });
  components.botDirected = botIntent.isBotDirected ? CONFIG.BOT_DIRECTED_BOOST : 0;

  // 3. Semantic similarity to recent context
  components.semantic = 0;
  if (context.recentMessages && context.recentMessages.length > 0) {
    const similarities = context.recentMessages.map(recentMsg =>
      calculateSemanticSimilarity(message.content, recentMsg.content)
    );
    components.semantic = Math.max(...similarities) * 0.3; // Max similarity with 30% weight
  }

  // 4. Reply chain bonus
  components.reply = (message.replyChainDepth || 0) > 0 ? CONFIG.REPLY_CHAIN_BOOST : 0;

  // 5. User activity pattern (users who engage more get slight boost)
  const userMessageCount = context.userMessageCount || 1;
  components.user = Math.min(userMessageCount / 10, 0.1); // Small boost for active users

  // Calculate total score with weights
  const totalScore = Math.min(
    components.temporal *
      (0.3 + components.botDirected + components.semantic + components.reply + components.user),
    1.0
  );

  logger.debug(
    {
      messagePreview: message.content.substring(0, 30),
      totalScore: totalScore.toFixed(3),
      components: Object.fromEntries(
        Object.entries(components).map(([key, value]) => [key, value.toFixed(3)])
      ),
    },
    'Calculated message relevance'
  );

  return {
    totalScore,
    components,
    metadata: {
      botIntent: botIntent.isBotDirected,
      patterns: botIntent.patterns,
    },
  };
}

/**
 * Build weighted context from messages based on relevance scores
 * @param {Array<Object>} messages - All available messages
 * @param {Object} options - Options for context building
 * @returns {Array<Object>} Sorted and filtered messages with relevance scores
 */
function buildWeightedContext(messages, options = {}) {
  const {
    maxTokens = CONFIG.MAX_WEIGHTED_CONTEXT_TOKENS,
    minRelevance = CONFIG.MIN_RELEVANCE_THRESHOLD,
    ambientRatio = CONFIG.AMBIENT_CONTEXT_RATIO,
    currentTimestamp = Date.now(),
    recentBotMessages = [],
  } = options;

  if (!messages || messages.length === 0) return [];

  // Calculate relevance scores for all messages
  const scoredMessages = messages.map((message, index) => {
    const context = {
      recentMessages: recentBotMessages.slice(0, 3), // Last 3 bot messages for semantic analysis
      userMessageCount: messages.filter(m => m.userId === message.userId).length,
      isReply: message.isReply || false,
      replyToBotMessage: message.replyToBotMessage || false,
    };

    const relevance = calculateRelevanceScore(message, context, currentTimestamp);

    return {
      ...message,
      relevanceScore: relevance.totalScore,
      relevanceComponents: relevance.components,
      relevanceMetadata: relevance.metadata,
      originalIndex: index,
    };
  });

  // Sort by relevance score (highest first)
  scoredMessages.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Filter out messages below minimum relevance threshold
  const relevantMessages = scoredMessages.filter(msg => msg.relevanceScore >= minRelevance);

  // Separate high-relevance (bot-directed) and ambient (general chat) messages
  const highRelevanceMessages = relevantMessages.filter(
    msg => msg.relevanceMetadata?.botIntent || msg.relevanceScore > 0.6
  );

  const ambientMessages = relevantMessages.filter(
    msg => !msg.relevanceMetadata?.botIntent && msg.relevanceScore <= 0.6
  );

  // Calculate token budget (rough estimate: ~4 chars per token)
  let tokenCount = 0;
  const selectedMessages = [];
  const maxAmbientMessages = Math.floor(ambientMessages.length * ambientRatio);

  // Add high-relevance messages first
  for (const message of highRelevanceMessages) {
    const estimatedTokens = Math.ceil(message.content.length / 4);
    if (tokenCount + estimatedTokens <= maxTokens) {
      selectedMessages.push(message);
      tokenCount += estimatedTokens;
    }
  }

  // Add some ambient messages for context
  let ambientAdded = 0;
  for (const message of ambientMessages) {
    if (ambientAdded >= maxAmbientMessages) break;

    const estimatedTokens = Math.ceil(message.content.length / 4);
    if (tokenCount + estimatedTokens <= maxTokens) {
      selectedMessages.push(message);
      tokenCount += estimatedTokens;
      ambientAdded++;
    }
  }

  // Sort selected messages by timestamp for proper conversation flow
  selectedMessages.sort((a, b) => a.timestamp - b.timestamp);

  logger.info(
    {
      totalMessages: messages.length,
      scoredMessages: scoredMessages.length,
      relevantMessages: relevantMessages.length,
      selectedMessages: selectedMessages.length,
      highRelevance: highRelevanceMessages.length,
      ambient: ambientAdded,
      estimatedTokens: tokenCount,
    },
    'Built weighted conversation context'
  );

  return selectedMessages;
}

/**
 * Analyze conversation thread patterns to identify related messages
 * @param {Array<Object>} messages - Messages to analyze
 * @returns {Object} Thread analysis with grouped messages
 */
function analyzeConversationThreads(messages) {
  if (!messages || messages.length === 0) return { threads: [], orphans: [] };

  const threads = [];
  const processed = new Set();

  // Group messages by reply chains and temporal proximity
  for (let i = 0; i < messages.length; i++) {
    if (processed.has(i)) continue;

    const message = messages[i];
    const thread = {
      id: `thread_${Date.now()}_${i}`,
      messages: [{ ...message, index: i }],
      startTime: message.timestamp,
      endTime: message.timestamp,
      avgRelevance: message.relevanceScore || 0,
    };

    processed.add(i);

    // Look for related messages (replies, temporal proximity, semantic similarity)
    for (let j = i + 1; j < messages.length; j++) {
      if (processed.has(j)) continue;

      const candidate = messages[j];
      const timeDiff = Math.abs(candidate.timestamp - message.timestamp) / (1000 * 60); // minutes

      // Group if: within 2 minutes, same user, or high semantic similarity
      const isRelated =
        timeDiff <= 2 ||
        candidate.userId === message.userId ||
        calculateSemanticSimilarity(message.content, candidate.content) > 0.6;

      if (isRelated) {
        thread.messages.push({ ...candidate, index: j });
        thread.endTime = Math.max(thread.endTime, candidate.timestamp);
        thread.avgRelevance = (thread.avgRelevance + (candidate.relevanceScore || 0)) / 2;
        processed.add(j);
      }
    }

    threads.push(thread);
  }

  // Sort threads by average relevance
  threads.sort((a, b) => b.avgRelevance - a.avgRelevance);

  const orphans = messages.filter((_, index) => !processed.has(index));

  logger.debug(
    {
      totalMessages: messages.length,
      threadsFound: threads.length,
      orphanMessages: orphans.length,
    },
    'Analyzed conversation threads'
  );

  return { threads, orphans };
}

module.exports = {
  calculateTemporalDecay,
  detectBotIntent,
  calculateSemanticSimilarity,
  calculateRelevanceScore,
  buildWeightedContext,
  analyzeConversationThreads,
  CONFIG,
  BOT_NAMES,
  BOT_DIRECTED_PATTERNS,
  CONTINUATION_PATTERNS,
  GENERAL_CHAT_PATTERNS,
};
