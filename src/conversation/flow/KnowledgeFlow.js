/**
 * KnowledgeFlow - Multi-Agent PocketFlow Implementation
 *
 * Implements a sophisticated knowledge system using PocketFlow's shared knowledge concept
 * with multiple specialized agents for information gathering, confirmation, and code generation.
 *
 * Architecture:
 * - InfoGatheringAgent: Web search + MCP documentation fetch
 * - ConfirmationManager: Cross-validates information from multiple sources
 * - CodingAgent: Generates PocketFlow code (owner-only) or provides toned-down responses
 */

const { Node, Flow } = require('./PocketFlow');
const PersistentSharedStore = require('./PersistentSharedStore');
const { createLogger } = require('../../core/logger');
const { searchForFactCheck, formatSearchResults } = require('../../services/webSearch');
const { fetchDocumentation } = require('../../services/webFetch');
const config = require('../../core/configValidator');

const logger = createLogger('KnowledgeFlow');

class KnowledgeFlow {
  constructor(openaiClient, options = {}) {
    this.openaiClient = openaiClient;
    this.options = {
      maxSearchResults: 5,
      confidenceThreshold: 60,
      maxResponseTokens: 1500,
      ...options,
    };

    this.initializeFlow();
  }

  initializeFlow() {
    // Create persistent shared store for knowledge and agent communication
    this.store = new PersistentSharedStore();

    // Initialize with default values if not already loaded from disk
    if (!this.store.has('knowledgeCache')) {
      this.store.set('knowledgeCache', new Map()); // Cache verified information
    }
    if (!this.store.has('searchHistory')) {
      this.store.set('searchHistory', []); // Track search history
    }
    if (!this.store.has('confidenceScores')) {
      this.store.set('confidenceScores', new Map()); // Store confidence ratings
    }
    this.store.set('codeTemplates', this.getCodeTemplates()); // PocketFlow code templates (always refresh)

    // KISS Principle: Simplified 2-node PocketFlow architecture
    // Node 1: Process knowledge request (intent + info gathering + response generation)
    const knowledgeProcessorNode = new Node('knowledge_processor', async (store, data) => {
      return await this.processKnowledgeWithFallbacks(store, data);
    });

    // Node 2: Format for Discord limits
    const discordFormatterNode = new Node('discord_formatter', async (store, data) => {
      return await this.formatForDiscord(store, data);
    });

    // Simple linear connection - every request gets processed and formatted
    knowledgeProcessorNode.connect(discordFormatterNode, () => true);

    // Initialize flow with knowledge processor as start node
    this.flow = new Flow(knowledgeProcessorNode, this.store);
  }

  /**
   * Unified Knowledge Processor - Handles intent detection, information gathering, and response generation
   * Follows PocketFlow KISS principle with comprehensive fallbacks and progressive updates
   */
  async processKnowledgeWithFallbacks(store, data) {
    let progressMessage = null;

    try {
      logger.info(`Processing knowledge request: ${data.message.content.substring(0, 50)}...`);

      // Send initial progress message
      progressMessage = await data.message.channel.send('🔍 **Processing knowledge request...**');

      // Step 1: Detect intent
      await progressMessage.edit('🧠 **Analyzing your request...**');
      const intentResult = await this.detectIntent(store, data);
      if (!intentResult.success) {
        await progressMessage.delete();
        return this.generateFallbackResponse(store, data, 'intent_detection_failed');
      }

      // Step 2: Gather information if needed
      let informationResult = null;
      if (intentResult.needsInformation) {
        await progressMessage.edit('🌐 **Searching the web for information...**');
        informationResult = await this.gatherInformation(store, intentResult);

        // Update progress based on search results
        if (informationResult && informationResult.success) {
          await progressMessage.edit('✅ **Information found! Analyzing sources...**');
        } else {
          await progressMessage.edit('⚠️ **Web search completed, using fallback knowledge...**');
        }

        // Continue even if information gathering fails - we'll use fallbacks
      }

      // Step 3: Confirm information if we have sources
      let confirmationResult = null;
      if (informationResult && informationResult.success && informationResult.informationGathered) {
        await progressMessage.edit('🔍 **Validating information from multiple sources...**');
        confirmationResult = await this.confirmInformation(store, informationResult);
      }

      // Step 4: Generate response - this ALWAYS runs and ALWAYS produces output
      if (intentResult.needsCode && intentResult.isOwner) {
        await progressMessage.edit('💻 **Generating PocketFlow code...**');
      } else {
        await progressMessage.edit('📝 **Preparing response...**');
      }

      const responseResult = await this.generateResponse(store, {
        intent: intentResult,
        information: informationResult,
        confirmation: confirmationResult,
        originalData: data,
      });

      // Delete progress message before sending final response
      await progressMessage.delete();
      progressMessage = null;

      // Ensure we always have a response
      if (!responseResult.response || responseResult.response.trim() === '') {
        return this.generateFallbackResponse(store, data, 'empty_response');
      }

      logger.info(`Knowledge processing completed successfully`);
      return responseResult;
    } catch (error) {
      logger.error('Error in knowledge processing:', error);

      // Clean up progress message on error
      if (progressMessage) {
        try {
          await progressMessage.delete();
        } catch (deleteError) {
          logger.warn('Could not delete progress message:', deleteError.message);
        }
      }

      return this.generateFallbackResponse(store, data, 'processing_error', error);
    }
  }

  /**
   * Generate a comprehensive fallback response that always provides value
   */
  async generateFallbackResponse(store, data, reason, error = null) {
    const userId = data.message.author?.id;
    const isOwner = userId === config.OWNER_ID;
    const query = data.message.content.toLowerCase();

    logger.info(`Generating fallback response for reason: ${reason}`);

    let response = '';

    // Provide helpful fallback based on the query content
    if (query.includes('pocketflow')) {
      response += `🔍 **PocketFlow Search Attempted**\n\n`;
      response += `I attempted to search for current PocketFlow information but encountered issues. Here's basic info:\n\n`;
      response += `🎯 **Framework**: 100-line Python framework emphasizing "Keep it Simple, Stupid"\n`;
      response += `🔧 **Architecture**: Node + SharedStore + Flow pattern\n\n`;
      response += `💡 **Suggestion**: Try a more specific query or check the official PocketFlow documentation directly.\n\n`;

      if (query.includes('code') && isOwner) {
        const codeExample = this.generatePocketFlowCode('basic example', null);
        response += `💻 **PocketFlow Code Example:**\n\`\`\`javascript\n${codeExample}\n\`\`\`\n\n`;
      } else if (query.includes('code') && !isOwner) {
        response += `🤖 **Code Generation**: Available to bot owner only. Ask them to run this request!\n\n`;
      }
    } else if (query.includes('documentation') || query.includes('docs')) {
      response += `📚 **Documentation Search**\n\n`;
      response += `I attempted to search for documentation but encountered an issue. Here's what I can help with:\n\n`;
      response += `🔍 **Available Resources:**\n`;
      response += `• PocketFlow framework information\n`;
      response += `• Code examples and implementations\n`;
      response += `• General programming concepts\n\n`;
      response += `💡 **Try asking**: "What is PocketFlow?" or "Give me PocketFlow code" (owner only)\n\n`;
    } else {
      response += `🤖 **Knowledge Request Processed**\n\n`;
      response += `I processed your request but encountered an issue during ${reason.replace('_', ' ')}. `;
      response += `However, I can still help with:\n\n`;
      response += `🔧 **Available Functions:**\n`;
      response += `• PocketFlow information and examples\n`;
      response += `• Documentation searches\n`;
      response += `• Code generation (owner only)\n\n`;
      response += `💡 **Tip**: Try rephrasing your query or ask "what is pocketflow"\n\n`;
    }

    // Add debug info for troubleshooting
    if (error) {
      response += `🔧 **Debug Info**: ${reason} - ${error.message.substring(0, 100)}\n`;
    }

    return {
      success: true, // Always successful fallback
      response: response.trim(),
      type: 'knowledge_fallback',
      confidence: 50,
      isFallback: true,
      fallbackReason: reason,
    };
  }

  /**
   * Intent Detection - Determines what kind of knowledge request this is
   */
  async detectIntent(store, data) {
    try {
      const { message } = data;
      const content = message.content.toLowerCase();
      const userId = message.author?.id;

      // Validate user context
      if (!userId) {
        logger.warn('No user ID found in message object');
        return {
          success: false,
          error: 'Missing user context',
          needsInformation: false,
          needsCode: false,
        };
      }

      logger.debug(`Detecting intent for knowledge request from user ${userId}`);

      // Check for code generation patterns
      const codePatterns = [
        /give\s+me\s+(?:the\s+)?(?:pocketflow\s+)?code/i,
        /show\s+me\s+(?:the\s+)?code/i,
        /how\s+to\s+(?:implement|code|build)/i,
        /pocketflow\s+(?:implementation|example|code)/i,
        /write\s+(?:the\s+)?code/i,
      ];

      const needsCode = codePatterns.some(pattern => pattern.test(content));

      // Check for search/confirmation patterns - Enable web search for more queries
      const searchPatterns = [
        /(?:search|look\s+up|lookup|find|confirm|verify|check)/i,
        /is\s+(?:it\s+)?true\s+that/i,
        /can\s+you\s+(?:confirm|verify|search|tell\s+me)/i,
        /what\s+(?:is|are|does|was|were)/i,
        /(?:what's|whats)/i,
        /documentation|docs/i, // Documentation requests trigger web search
        /tell\s+me\s+about/i,
        /explain/i,
        /information\s+about/i,
        /details\s+on/i,
        /summary\s+of/i,
        /(?:give\s+me|show\s+me)/i,
        /how\s+(?:does|do|can|to|is|are)/i,
        /why\s+(?:is|are|does|do|did|was|were)/i,
        /where\s+(?:is|are|can|to|was|were)/i,
        /when\s+(?:is|are|was|were|did|do|does)/i,
        /who\s+(?:is|are|was|were)/i,
        /which\s+(?:is|are|was|were)/i,
        /do\s+you\s+know/i,
        /have\s+you\s+heard/i,
        /(?:top|best|latest|current|new|recent)/i,
        /(?:tutorial|guide|example)/i,
        /(?:price|cost|value)/i,
        /(?:javascript|python|react|node|programming|coding|development|tech|technology)/i,
      ];

      // Enable information gathering for most queries - be more inclusive
      const needsInformation =
        searchPatterns.some(pattern => pattern.test(content)) ||
        content.length > 15 || // Lower threshold for triggering search
        content.includes('?'); // Questions should trigger search

      // Extract the actual query/statement to work with
      let query = content;

      // Clean up the query by removing command words
      query = query
        .replace(/^(?:search|look\s+up|find|confirm|verify|check)\s+/i, '')
        .replace(/^(?:is\s+(?:it\s+)?true\s+that)\s+/i, '')
        .replace(/^(?:can\s+you\s+(?:confirm|verify|search))\s+/i, '')
        .replace(/^(?:what\s+(?:is|are|does))\s+/i, '')
        .replace(/,?\s*(?:and\s+)?(?:give|show)\s+me\s+(?:the\s+)?code.*$/i, '') // Remove trailing code request
        .trim();

      // Store intent information in shared store
      const intentData = {
        originalMessage: content,
        query,
        needsCode,
        needsInformation,
        userId,
        isOwner: userId === config.OWNER_ID,
        timestamp: Date.now(),
      };

      store.set('currentIntent', intentData);

      // Log which patterns matched for debugging
      const matchedSearchPatterns = searchPatterns.filter(pattern => pattern.test(content));
      if (matchedSearchPatterns.length > 0) {
        logger.debug(
          `Search patterns matched: ${matchedSearchPatterns.map(p => p.source).join(', ')}`
        );
      }

      logger.info(
        `Intent detected: ${needsInformation ? 'information gathering' : 'direct'} ${needsCode ? '+ code generation' : ''} - matched ${matchedSearchPatterns.length} search patterns`
      );

      // Store intent data for other methods
      store.set('currentIntent', intentData);

      return {
        success: true,
        needsInformation,
        needsCode,
        query,
        intent: intentData,
        message: data.message, // Pass message through for subsequent processing
      };
    } catch (error) {
      logger.error('Error in intent detection:', error);
      return {
        success: false,
        error: error.message,
        needsInformation: false,
        needsCode: false,
      };
    }
  }

  /**
   * Information Gathering Agent - Web search + MCP documentation fetch with caching
   */
  async gatherInformation(store, _data) {
    try {
      const intent = store.get('currentIntent');
      const { query } = intent;

      logger.info(`Gathering information for query: "${query}"`);

      // Check for cached knowledge first with intelligent TTL
      const cached = store.getCachedResult(query);
      if (cached) {
        // Determine cache TTL based on query type
        const isTimeSensitive = this.isTimeSensitiveQuery(query);
        const isFinancial = this.isFinancialQuery(query);
        const isLowConfidence = cached.confidence < 50;

        let cacheTTL;
        if (isFinancial || isTimeSensitive) {
          cacheTTL = 60 * 60 * 1000; // 1 hour for financial/time-sensitive
        } else if (isLowConfidence) {
          cacheTTL = 30 * 60 * 1000; // 30 minutes for low confidence results
        } else {
          cacheTTL = 24 * 60 * 60 * 1000; // 24 hours for general knowledge
        }

        if (Date.now() - cached.timestamp < cacheTTL) {
          logger.info(
            `Using cached knowledge for: "${query}" (confidence: ${cached.confidence}%, TTL: ${Math.round(cacheTTL / 60000)}min)`
          );

          return {
            success: true,
            informationGathered: true,
            sources: [{ type: 'knowledge_cache', result: cached.result }],
            informationData: {
              query,
              sources: [{ type: 'knowledge_cache', result: cached.result }],
              gatheringTime: Date.now(),
              hasErrors: false,
              sourceCount: 1,
              fromCache: true,
            },
          };
        }
        logger.info(
          `Cache expired for: "${query}" (${isFinancial ? 'financial' : isTimeSensitive ? 'time-sensitive' : 'low-confidence'} query)`
        );
      }

      // Parallel information gathering
      const gatheringPromises = [];

      // Web search for general information
      gatheringPromises.push(
        searchForFactCheck(query, { maxResults: this.options.maxSearchResults })
          .then(result => ({ type: 'web_search', result }))
          .catch(error => ({ type: 'web_search', error: error.message }))
      );

      // Documentation search if query seems technical (now includes PocketFlow)
      if (this.isCodeRelated(query)) {
        const docSites = ['github', 'stackoverflow', 'mdn'];
        logger.info(
          `Query "${query}" detected as code-related, fetching from ${docSites.length} documentation sites`
        );
        docSites.forEach(site => {
          gatheringPromises.push(
            fetchDocumentation(query, site)
              .then(result => ({ type: `documentation_${site}`, result }))
              .catch(error => ({ type: `documentation_${site}`, error: error.message }))
          );
        });
      } else {
        logger.info(`Query "${query}" not detected as code-related, skipping documentation fetch`);
      }

      // Wait for all information gathering to complete
      const gatheringResults = await Promise.allSettled(gatheringPromises);

      // Process results
      const informationSources = [];
      let hasErrors = false;

      gatheringResults.forEach((promiseResult, index) => {
        if (promiseResult.status === 'fulfilled') {
          informationSources.push(promiseResult.value);
          // Log successful attempts even if result is empty
          if (!promiseResult.value.result) {
            logger.info(`Source ${promiseResult.value.type} attempted but returned no results`);
          }
        } else {
          hasErrors = true;
          logger.warn(
            `Information gathering failed for source ${index}:`,
            promiseResult.reason || promiseResult.value?.error
          );
          // Still count failed attempts as sources for transparency
          if (promiseResult.reason) {
            informationSources.push({
              type: `failed_source_${index}`,
              error: promiseResult.reason.message || 'Unknown error',
            });
          }
        }
      });

      // Store gathered information in shared store
      const informationData = {
        query,
        sources: informationSources,
        gatheringTime: Date.now(),
        hasErrors,
        sourceCount: informationSources.length,
      };

      store.set('gatheredInformation', informationData);

      // Cache successful web search results
      const webSearchSource = informationSources.find(
        s => s.type === 'web_search' && s.result?.success
      );
      if (webSearchSource) {
        const confidence = webSearchSource.result.factCheck?.confidenceScore || 0;
        store.cacheSearchResult(query, webSearchSource.result, confidence);
        logger.info(`Cached search result for: "${query}" with ${confidence}% confidence`);
      }

      logger.info(`Information gathering completed: ${informationSources.length} sources found`);

      return {
        success: true,
        informationGathered: informationSources.length > 0,
        sources: informationSources,
        informationData,
      };
    } catch (error) {
      logger.error('Error in information gathering:', error);
      return {
        success: false,
        error: error.message,
        informationGathered: false,
      };
    }
  }

  /**
   * Confirmation Manager Agent - Cross-validates information from multiple sources
   */
  async confirmInformation(store, _data) {
    try {
      const intent = store.get('currentIntent');
      const informationData = store.get('gatheredInformation');

      logger.info(`Confirming information from ${informationData.sourceCount} sources`);

      // Analyze information for consistency and reliability
      let overallConfidence = 0;
      let consistentSources = 0;
      const confirmationSummary = [];

      // Process web search results
      const webSearchSource = informationData.sources.find(s => s.type === 'web_search');
      if (webSearchSource) {
        if (
          webSearchSource.result &&
          webSearchSource.result.success &&
          webSearchSource.result.factCheck
        ) {
          const factCheck = webSearchSource.result.factCheck;
          const searchConfidence = factCheck.confidenceScore || 0;
          overallConfidence += searchConfidence * 0.4; // Weight web search at 40%
          confirmationSummary.push({
            type: 'web_search',
            confidence: searchConfidence,
            verification: factCheck.verification || 'Search completed',
            sources: factCheck.sources || 0,
          });
          consistentSources++;
        } else if (webSearchSource.error) {
          // Even failed searches provide some info
          overallConfidence += 10; // Small confidence for attempted search
          confirmationSummary.push({
            type: 'web_search',
            confidence: 10,
            verification: 'Search attempted but encountered issues',
            sources: 0,
            error: webSearchSource.error,
          });
          consistentSources++;
        }
      }

      // Process documentation sources
      const docSources = informationData.sources.filter(s => s.type.startsWith('documentation_'));
      if (docSources.length > 0) {
        const docConfidence = Math.min(docSources.length * 20, 60); // Up to 60% for documentation
        overallConfidence += docConfidence;
        confirmationSummary.push({
          type: 'documentation',
          confidence: docConfidence,
          sources: docSources.length,
          sites: docSources.map(s => s.type.replace('documentation_', '')),
        });
        consistentSources++;
      }

      // Normalize confidence score
      if (consistentSources > 0) {
        overallConfidence = Math.min(overallConfidence, 100);
      }

      // Store confirmation results
      const confirmationData = {
        query: intent.query,
        overallConfidence,
        consistentSources,
        summary: confirmationSummary,
        meetsThreshold: overallConfidence >= this.options.confidenceThreshold,
        timestamp: Date.now(),
      };

      store.set('confirmedInformation', confirmationData);
      store.get('confidenceScores').set(intent.query, overallConfidence);

      logger.info(`Information confirmation completed: ${overallConfidence}% confidence`);

      return {
        success: true,
        confidence: overallConfidence,
        meetsThreshold: confirmationData.meetsThreshold,
        confirmationData,
      };
    } catch (error) {
      logger.error('Error in information confirmation:', error);
      return {
        success: false,
        error: error.message,
        confidence: 0,
        meetsThreshold: false,
      };
    }
  }

  /**
   * Response Generator - Always generates a meaningful response
   */
  async generateResponse(store, data) {
    try {
      // Extract data from the unified processing structure
      // Handle both new structure (data.intent.intent) and fallback to store
      const intent = (data.intent && data.intent.intent) || store.get('currentIntent');
      const informationData =
        (data.information && data.information.informationData) || store.get('gatheredInformation');
      const confirmationData =
        (data.confirmation && data.confirmation.confirmationData) ||
        store.get('confirmedInformation');
      const _originalMessage = data.originalData ? data.originalData.message : data.message;

      if (!intent) {
        throw new Error('No intent data available for response generation');
      }

      logger.info(`Generating response for user ${intent.userId} (owner: ${intent.isOwner})`);

      let response = '';
      const attachments = [];

      // Enhanced information processing with detailed technical content
      if (informationData && informationData.sources.length > 0) {
        const webSearchSource = informationData.sources.find(s => s.type === 'web_search');
        if (webSearchSource && webSearchSource.result.success) {
          response += formatSearchResults(webSearchSource.result, true) + '\n\n';
        }

        // Add comprehensive technical knowledge when web search is limited
        // But prioritize actual web search results over static content for PocketFlow
        const hasLimitedWebResults =
          !webSearchSource ||
          !webSearchSource.result.success ||
          (webSearchSource.result.factCheck && webSearchSource.result.factCheck.sources === 0);

        if (hasLimitedWebResults && !intent.query.toLowerCase().includes('pocketflow')) {
          // For non-PocketFlow queries, provide technical content when web search fails
          const technicalContent = this.generateTechnicalContent(
            intent.query,
            informationData.sources
          );
          if (technicalContent) {
            response += technicalContent + '\n\n';
          }
        } else if (hasLimitedWebResults && intent.query.toLowerCase().includes('pocketflow')) {
          // For PocketFlow queries with limited web results, show what we found + note about web search
          response += `🌐 **Web Search Status**: Limited results found for PocketFlow query.\n\n`;
        }

        // Add documentation links if available with enhanced descriptions
        const docSources = informationData.sources.filter(s => s.type.startsWith('documentation_'));
        if (docSources.length > 0) {
          response += `📚 **Documentation Sources Found:**\n`;
          docSources.forEach(docSource => {
            if (docSource.result.success && docSource.result.documentation) {
              const doc = docSource.result.documentation;
              response += `• ${doc.site}: ${doc.title || 'Documentation'}\n`;
            }
          });
          response += '\n';
        }
      }

      // Add concise confidence information at the end
      if (confirmationData && typeof confirmationData.overallConfidence === 'number') {
        const confidenceEmoji =
          confirmationData.overallConfidence >= 70
            ? '✅'
            : confirmationData.overallConfidence >= 40
              ? '⚠️'
              : '❓';
        response += `${confidenceEmoji} **Analysis Confidence:** ${Math.round(confirmationData.overallConfidence)}%\n`;
      }

      // Detect if user wants natural conversation (default for most queries)
      // Only use structured response for specific technical cases
      const needsStructuredResponse =
        intent.originalMessage.includes('pocketflow') ||
        intent.originalMessage.includes('documentation') ||
        intent.originalMessage.includes('docs') ||
        intent.originalMessage.includes('structured') ||
        intent.originalMessage.includes('format') ||
        intent.needsCode ||
        intent.originalMessage.includes('api');

      // Default to natural response unless specifically requesting structured output
      if (!needsStructuredResponse) {
        // Route to natural conversation about the topic
        return await this.generateNaturalResponse(store, data);
      }

      // Handle code generation requests
      if (intent.needsCode) {
        if (intent.isOwner) {
          // Generate actual PocketFlow code for owner
          const codeExample = this.generatePocketFlowCode(intent.query, informationData);
          response += `💻 **PocketFlow Implementation:**\n\`\`\`javascript\n${codeExample}\n\`\`\`\n\n`;
          response += `📋 **Implementation Notes:**\n`;
          response += `• This code follows PocketFlow's "Keep it Simple, Stupid" philosophy\n`;
          response += `• Uses Node/SharedStore architecture for shared knowledge\n`;
          response += `• Includes error handling and logging\n`;
          response += `• Ready for integration into your existing flow\n\n`;
        } else {
          // Provide toned-down response for non-owners
          response += `🤖 **Code Generation Request**\n`;
          response += `I can see you're interested in the implementation! However, code generation is restricted to the bot owner for security reasons.\n\n`;
          response += `🔧 **What I can tell you:**\n`;
          response += `• This would involve PocketFlow's Node and SharedStore architecture\n`;
          response += `• The implementation would use async/await patterns\n`;
          response += `• It would follow the existing circuit breaker and error handling patterns\n\n`;
          response += `💡 **Suggestion:** Ask the bot owner to run this request for the full code implementation!\n\n`;
        }
      }

      // Enhanced fallback knowledge - only when both web search and tech content fail
      if (!response || response.trim().length < 100) {
        const enhancedFallback = this.generateEnhancedFallback(intent.query);
        if (enhancedFallback) {
          response += enhancedFallback + '\n\n';
        }
      }

      // Add helpful emoji responses for fun
      if (!intent.needsCode || !intent.isOwner) {
        const emojiResponse = this.generateEmojiResponse(
          intent.query,
          confirmationData?.overallConfidence || 0
        );
        response += `🎭 **Quick Take:** ${emojiResponse}\n\n`;
      }

      // Final safety check - ensure we ALWAYS have a response
      if (!response || response.trim() === '') {
        logger.warn('Empty response detected, generating emergency fallback');
        // Emergency fallback based on query content
        if (intent.query.includes('pocketflow')) {
          response = `📚 **PocketFlow Framework**\n\nPocketFlow is a 100-line Python framework emphasizing "Keep it Simple, Stupid" philosophy.\n\n🔧 **Core Components**: Node, SharedStore, Flow\n💡 **Philosophy**: Simple, reliable, composable workflows\n\n`;
          if (intent.needsCode && intent.isOwner) {
            response += `💻 **Code Available**: Ask for "pocketflow code" to see examples.`;
          } else if (intent.needsCode) {
            response += `🔒 **Code Generation**: Owner-only feature.`;
          }
        } else {
          response = `🤖 **Knowledge System Active**\n\nI processed your request successfully. Try asking about:\n• PocketFlow framework\n• Documentation searches\n• Code examples (owner only)\n\n💡 **Tip**: Be specific in your queries for better results.`;
        }
      }

      const finalResponse = {
        success: true,
        response: response.trim(),
        type: 'knowledge',
        confidence: confirmationData?.overallConfidence || 0,
        hasCode: intent.needsCode && intent.isOwner,
        attachments,
      };

      // Validate final response
      if (!finalResponse.response || finalResponse.response.trim() === '') {
        logger.error('CRITICAL: Final response is still empty, this should never happen');
        finalResponse.response =
          '🤖 **System Error**: Unable to generate response. Please try again.';
      }

      return finalResponse;
    } catch (error) {
      logger.error('Error in response generation:', error);
      return {
        success: false,
        error: error.message,
        response: 'I encountered an error while generating the response. Please try again.',
      };
    }
  }

  /**
   * Process a knowledge request through the multi-agent flow
   */
  async processKnowledgeRequest(discordMessage) {
    const startTime = Date.now();

    try {
      logger.info(`Starting knowledge processing for message ${discordMessage.id}`, {
        userId: discordMessage.author?.id,
        content: discordMessage.content.substring(0, 50) + '...',
        messageId: discordMessage.id,
      });

      const result = await this.flow.run({ message: discordMessage });
      const duration = Date.now() - startTime;

      logger.info(`Knowledge flow completed for message ${discordMessage.id}:`, {
        success: result.success,
        hasResponse: !!result.response,
        confidence: result.confidence,
        hasCode: result.hasCode,
        duration: duration + 'ms',
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error in KnowledgeFlow:', {
        error: error.message,
        stack: error.stack,
        messageId: discordMessage.id,
        messageContent: discordMessage.content,
        userId: discordMessage.author?.id,
        duration: duration + 'ms',
      });

      return {
        success: false,
        error: error.message,
        response: 'I encountered an error while processing your knowledge request.',
      };
    }
  }

  /**
   * Discord Formatter Agent - Ensures responses fit within Discord's 2000 character limit
   */
  async formatForDiscord(store, data) {
    try {
      const _DISCORD_LIMIT = 2000;
      const SAFE_LIMIT = 1950; // Leave some buffer

      if (!data.response) {
        return data;
      }

      const originalLength = data.response.length;

      if (originalLength <= SAFE_LIMIT) {
        return data;
      }

      logger.info(`Response too long (${originalLength} chars), formatting for Discord`);

      // Smart truncation strategy
      let formattedResponse = data.response;

      // Priority order for content preservation
      const _sections = [
        { name: 'code', pattern: /```[\s\S]*?```/g, priority: 1 },
        {
          name: 'pocketflow_info',
          pattern: /📚 \*\*PocketFlow Information:\*\*[\s\S]*?(?=🎭|$)/g,
          priority: 2,
        },
        {
          name: 'search_results',
          pattern: /🔍 \*\*Search Results[\s\S]*?(?=📚|💻|🎭|$)/g,
          priority: 3,
        },
        {
          name: 'confidence',
          pattern:
            /(?:✅|⚠️|❓) \*\*Information Confidence[\s\S]*?(?=\ud83d\udcda|\ud83d\udcbb|\ud83c\udfad|$)/g,
          priority: 4,
        },
        { name: 'emoji_response', pattern: /🎭 \*\*Quick Take:[\s\S]*$/g, priority: 5 },
      ];

      // If we have code (highest priority), try to preserve it
      const codeMatches = formattedResponse.match(/```[\s\S]*?```/g);
      if (codeMatches && data.hasCode) {
        // Keep code block + essential info
        let essentialResponse = '';

        // Add a brief header
        essentialResponse += `💻 **PocketFlow Code** (truncated for Discord limits):\n\n`;

        // Add the code block
        essentialResponse += codeMatches[0] + '\n\n';

        // Add brief PocketFlow info if space allows
        const remainingSpace = SAFE_LIMIT - essentialResponse.length;
        if (remainingSpace > 200) {
          essentialResponse += `📚 **PocketFlow**: Lightweight, 100-line Python framework with "Keep it Simple, Stupid" philosophy.\n`;
          essentialResponse += `🔧 Uses Node/SharedStore architecture for shared knowledge.\n\n`;
        }

        // Add truncation notice
        if (remainingSpace > 100) {
          essentialResponse += `📝 *Response truncated to fit Discord limits. Original: ${originalLength} chars*`;
        }

        formattedResponse = essentialResponse;
      } else {
        // No code block, prioritize other content
        // Start with essential PocketFlow information
        let truncatedResponse = '';

        // Extract and preserve PocketFlow information (most important)
        const pocketflowMatch = formattedResponse.match(
          /📚 \*\*PocketFlow Information:\*\*[\s\S]*?(?=🎭|$)/
        );
        if (pocketflowMatch) {
          truncatedResponse += pocketflowMatch[0] + '\n\n';
        }

        // Add search confidence if space allows
        const confidenceMatch = formattedResponse.match(
          /(?:✅|⚠️|❓) \*\*Information Confidence:.*?\n.*?\n/
        );
        if (
          confidenceMatch &&
          truncatedResponse.length + confidenceMatch[0].length < SAFE_LIMIT - 200
        ) {
          truncatedResponse += confidenceMatch[0] + '\n';
        }

        // Fill remaining space with search results summary
        const remainingSpace = SAFE_LIMIT - truncatedResponse.length - 100; // Reserve space for truncation notice
        const searchMatch = formattedResponse.match(/🔍 \*\*Search Results[\s\S]*?(?=📚|💻|🎭|$)/);
        if (searchMatch && remainingSpace > 100) {
          let searchContent = searchMatch[0];
          if (searchContent.length > remainingSpace) {
            searchContent = searchContent.substring(0, remainingSpace - 50) + '...\n\n';
          }
          truncatedResponse = searchContent + '\n' + truncatedResponse;
        }

        // Add truncation notice
        truncatedResponse += `📝 *Response truncated to fit Discord limits. Original: ${originalLength} chars*`;

        formattedResponse = truncatedResponse;
      }

      // Final safety check
      if (formattedResponse.length > SAFE_LIMIT) {
        formattedResponse =
          formattedResponse.substring(0, SAFE_LIMIT - 50) + '...\n\n📝 *Truncated*';
      }

      logger.info(`Response formatted: ${originalLength} → ${formattedResponse.length} chars`);

      return {
        ...data,
        response: formattedResponse,
        originalLength,
        truncated: true,
      };
    } catch (error) {
      logger.error('Error in Discord formatting:', error);
      return data; // Return original data if formatting fails
    }
  }

  /**
   * Check if a query is financial/price related (requires frequent updates)
   */
  isFinancialQuery(query) {
    const financialKeywords = [
      'price',
      'cost',
      'value',
      'worth',
      'bitcoin',
      'crypto',
      'stock',
      'market',
      'currency',
      'exchange',
      'trading',
      'investment',
      'ethereum',
      'usd',
      'dollar',
      'euro',
      'yen',
      'rates',
      'inflation',
      'economy',
      'financial',
      'money',
    ];
    return financialKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  /**
   * Check if a query is time-sensitive (requires current information)
   */
  isTimeSensitiveQuery(query) {
    const timeSensitiveKeywords = [
      'current',
      'latest',
      'now',
      'today',
      'recent',
      'new',
      'breaking',
      'live',
      'real-time',
      'updated',
      '2025',
      'this year',
      'happening',
      'trending',
    ];
    return timeSensitiveKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  /**
   * Check if a query is code/technical related
   */
  isCodeRelated(query) {
    const codeKeywords = [
      'function',
      'class',
      'method',
      'api',
      'library',
      'framework',
      'javascript',
      'python',
      'node',
      'react',
      'vue',
      'angular',
      'database',
      'sql',
      'mongodb',
      'programming',
      'code',
      'implementation',
      'algorithm',
      'data structure',
      'design pattern',
      'architecture',
      'pocketflow',
      'workflow',
      'automation',
      'pipeline', // Added PocketFlow and related terms
    ];

    return codeKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  /**
   * Generate PocketFlow code examples
   */
  generatePocketFlowCode(query, _informationData) {
    const templates = this.store.get('codeTemplates');

    // Select appropriate template based on query
    if (query.includes('search') || query.includes('fetch')) {
      return templates.searchFlow;
    } else if (query.includes('validation') || query.includes('confirm')) {
      return templates.validationFlow;
    }
    return templates.basicFlow;
  }

  /**
   * Generate comprehensive technical content when web search is limited
   */
  generateTechnicalContent(query, _sources) {
    const lowerQuery = query.toLowerCase();

    // Python vs JavaScript performance comparison
    if (
      lowerQuery.includes('python') &&
      lowerQuery.includes('javascript') &&
      (lowerQuery.includes('faster') ||
        lowerQuery.includes('performance') ||
        lowerQuery.includes('speed'))
    ) {
      return (
        `🔍 **Python vs JavaScript Performance Analysis:**\n\n` +
        `🐍 **Python Strengths:**\n` +
        `• **Scientific Computing**: NumPy, Pandas optimized with C libraries\n` +
        `• **Data Processing**: Excellent for large datasets and ML workloads\n` +
        `• **Development Speed**: Faster to write and maintain\n` +
        `• **Libraries**: Extensive ecosystem for specialized tasks\n\n` +
        `⚡ **JavaScript Strengths:**\n` +
        `• **V8 Engine**: Highly optimized JIT compilation\n` +
        `• **Async Operations**: Non-blocking I/O and event-driven\n` +
        `• **Frontend Performance**: Native browser execution\n` +
        `• **Real-time Applications**: WebSockets, live updates\n\n` +
        `🎯 **Verdict**: Context-dependent - JS for web/real-time, Python for data/AI`
      );
    }

    // Design patterns queries
    if (lowerQuery.includes('design pattern') || lowerQuery.includes('design patterns')) {
      return (
        `🛠️ **Software Design Patterns Overview:**\n\n` +
        `🏗️ **Creational Patterns:**\n` +
        `• **Singleton**: Ensures single instance (database connections)\n` +
        `• **Factory**: Creates objects without specifying exact classes\n` +
        `• **Builder**: Constructs complex objects step by step\n\n` +
        `🔄 **Behavioral Patterns:**\n` +
        `• **Observer**: Notifies multiple objects about state changes\n` +
        `• **Strategy**: Defines family of algorithms, makes them interchangeable\n` +
        `• **Command**: Encapsulates requests as objects\n\n` +
        `🏗️ **Structural Patterns:**\n` +
        `• **Adapter**: Makes incompatible interfaces work together\n` +
        `• **Decorator**: Adds behavior to objects dynamically\n` +
        `• **Facade**: Provides simplified interface to complex subsystem`
      );
    }

    // Machine learning queries
    if (lowerQuery.includes('machine learning') || lowerQuery.includes('neural network')) {
      return (
        `🧠 **Machine Learning & Neural Networks:**\n\n` +
        `📊 **Core Concepts:**\n` +
        `• **Supervised Learning**: Training with labeled data (classification, regression)\n` +
        `• **Unsupervised Learning**: Finding patterns in unlabeled data\n` +
        `• **Deep Learning**: Multi-layer neural networks for complex patterns\n\n` +
        `⚡ **Neural Network Components:**\n` +
        `• **Neurons**: Basic processing units that apply weights and activation\n` +
        `• **Layers**: Input, hidden, and output layers processing data\n` +
        `• **Backpropagation**: Learning algorithm that adjusts weights\n\n` +
        `🚀 **Applications**: Image recognition, NLP, recommendation systems`
      );
    }

    return null;
  }

  /**
   * Generate enhanced fallback responses for various topics
   */
  generateEnhancedFallback(query) {
    const lowerQuery = query.toLowerCase();

    // Only provide PocketFlow fallback when web search completely fails
    // This ensures web search is attempted first for PocketFlow queries
    if (lowerQuery.includes('pocketflow')) {
      return (
        `📚 **PocketFlow Framework (Fallback Info):**\n\n` +
        `🎯 **Philosophy**: "Keep it Simple, Stupid" - 100-line Python framework\n\n` +
        `🔧 **Core Architecture:**\n` +
        `• **Node**: Individual processing units with async functions\n` +
        `• **SharedStore**: Shared knowledge/state between nodes\n` +
        `• **Flow**: Connects nodes in processing pipelines\n` +
        `• **Actions**: Labeled transitions between nodes\n\n` +
        `⚡ **Key Features:**\n` +
        `• **Composable**: Flows can act as nodes in other flows\n` +
        `• **Retry Logic**: Built-in error handling and fallbacks\n` +
        `• **Async Support**: Handles concurrent operations\n\n` +
        `💡 **Note**: This is fallback information. Web search may provide more current details.`
      );
    }

    // API/Documentation queries
    if (
      lowerQuery.includes('api') ||
      lowerQuery.includes('documentation') ||
      lowerQuery.includes('docs')
    ) {
      return (
        `📚 **API Documentation Best Practices:**\n\n` +
        `🛠️ **Essential Components:**\n` +
        `• **Clear Endpoints**: RESTful naming conventions\n` +
        `• **Request/Response Examples**: Show actual usage\n` +
        `• **Error Codes**: Comprehensive error handling guide\n` +
        `• **Authentication**: Security implementation details\n\n` +
        `💡 **Documentation Tools:**\n` +
        `• **OpenAPI/Swagger**: Interactive API documentation\n` +
        `• **Postman**: Collection sharing and testing\n` +
        `• **GitBook**: Comprehensive documentation platform`
      );
    }

    // Programming concepts
    if (
      lowerQuery.includes('async') ||
      lowerQuery.includes('await') ||
      lowerQuery.includes('promise')
    ) {
      return (
        `⚡ **Asynchronous JavaScript Patterns:**\n\n` +
        `🔄 **Evolution:**\n` +
        `• **Callbacks**: Original async pattern (callback hell)\n` +
        `• **Promises**: Chainable, better error handling\n` +
        `• **Async/Await**: Synchronous-looking asynchronous code\n\n` +
        `🎯 **Best Practices:**\n` +
        `• **Error Handling**: Try/catch with async/await\n` +
        `• **Promise.all()**: Concurrent execution of multiple promises\n` +
        `• **Avoid Blocking**: Never use sync methods in async functions`
      );
    }

    return null;
  }

  /**
   * Generate emoji responses
   */
  generateEmojiResponse(query, confidence) {
    const responses = {
      cat: ['🐱', '😸', '🙀', '😺', '😻'],
      particle: ['⚛️', '🔬', '⚡', '💫', '🌟'],
      accelerator: ['🚀', '💨', '⚡', '🔥', '💥'],
      pyramid: ['🔺', '🏗️', '🏛️', '📐', '⛰️'],
      high_confidence: ['✅', '👍', '💯', '🎯', '🔥'],
      low_confidence: ['❓', '🤔', '😅', '🙃', '🤷'],
    };

    let emojiSet = [];

    // Add relevant emojis based on query content
    Object.keys(responses).forEach(key => {
      if (
        key !== 'high_confidence' &&
        key !== 'low_confidence' &&
        query.toLowerCase().includes(key)
      ) {
        emojiSet.push(...responses[key]);
      }
    });

    // Add confidence-based emojis
    if (confidence >= 60) {
      emojiSet.push(...responses.high_confidence);
    } else {
      emojiSet.push(...responses.low_confidence);
    }

    // Return random selection
    if (emojiSet.length === 0) {
      emojiSet = ['🤖', '💭', '🔍', '📚', '💡'];
    }

    const selectedEmojis = [...new Set(emojiSet)].slice(0, 3);
    return selectedEmojis.join(' ');
  }

  /**
   * Generate natural conversational response using OpenAI with search context
   */
  async generateNaturalResponse(store, data) {
    try {
      const intent = (data.intent && data.intent.intent) || store.get('currentIntent');
      const informationData =
        (data.information && data.information.informationData) || store.get('gatheredInformation');

      if (!intent) {
        throw new Error('No intent data available for natural response generation');
      }

      logger.info(`Generating natural response for user ${intent.userId} about: ${intent.query}`);

      // Build context from web search results
      let searchContext = '';
      if (informationData && informationData.sources.length > 0) {
        const webSearchSource = informationData.sources.find(s => s.type === 'web_search');
        if (webSearchSource && webSearchSource.result && webSearchSource.result.success) {
          const searchData = webSearchSource.result.data;

          // Add instant answer if available
          if (searchData.instantAnswer) {
            searchContext += `Quick Answer: ${searchData.instantAnswer.text}\n\n`;
          }

          // Add abstract if available
          if (searchData.abstract) {
            searchContext += `Information: ${searchData.abstract.text}\n`;
            if (searchData.abstract.source && searchData.abstract.source !== 'Unknown') {
              searchContext += `Source: ${searchData.abstract.source}\n`;
            }
            searchContext += '\n';
          }

          // Add related topics
          if (searchData.results && searchData.results.length > 0) {
            searchContext += 'Related Information:\n';
            searchData.results.slice(0, 3).forEach((result, index) => {
              searchContext += `${index + 1}. ${result.title}\n`;
              if (result.snippet && result.snippet !== result.title) {
                searchContext += `   ${result.snippet.substring(0, 150)}...\n`;
              }
            });
            searchContext += '\n';
          }
        }
      }

      // Create a conversational prompt that incorporates search results
      let conversationalPrompt;
      if (searchContext.trim()) {
        conversationalPrompt = `The user asked: "${intent.originalMessage}"

I found this information from web search:
${searchContext}

Please provide a natural, friendly, conversational response based on this information. Be helpful and informative but speak naturally like you're having a chat with a friend. Incorporate the search findings naturally into your response.`;
      } else {
        conversationalPrompt = `The user asked about "${intent.originalMessage}". Please provide a natural, friendly, conversational response about this topic. Be helpful and informative but speak naturally like you're chatting with a friend.`;
      }

      // Use OpenAI for natural conversation
      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              "You are ChimpGPT, a friendly AI assistant. Respond naturally and conversationally. Be helpful but casual and engaging, like you're having a chat with a friend. When you have search results, incorporate them naturally into your response rather than just listing them.",
          },
          {
            role: 'user',
            content: conversationalPrompt,
          },
        ],
        max_tokens: 1500,
        temperature: 0.7,
      });

      const naturalResponse = completion.choices[0].message.content;

      logger.info(
        `Generated natural response (${naturalResponse.length} chars) for user ${intent.userId}`
      );

      return {
        success: true,
        response: naturalResponse,
        type: 'natural_conversation',
        confidence: 95,
        isNatural: true,
      };
    } catch (error) {
      logger.error('Error generating natural response:', error);
      return {
        success: false,
        error: error.message,
        response:
          "I'm having trouble generating a natural response right now. Let me try the regular approach instead.",
      };
    }
  }

  /**
   * Get PocketFlow code templates
   */
  getCodeTemplates() {
    return {
      basicFlow: `// Basic PocketFlow Knowledge Implementation
const { Node, Flow } = require('./PocketFlow');

const knowledgeNode = new Node('knowledge_processor', async (store, data) => {
  const { query } = data;
  
  // Store knowledge in shared store
  const knowledge = store.get('knowledgeCache') || new Map();
  knowledge.set(query, { 
    processed: true, 
    timestamp: Date.now() 
  });
  store.set('knowledgeCache', knowledge);
  
  return {
    success: true,
    response: \`Knowledge processed: \${query}\`,
    confidence: 85
  };
});

const flow = new Flow(knowledgeNode, new SharedStore());
const result = await flow.run({ query: 'your query here' });`,

      searchFlow: `// PocketFlow Search Implementation
const { Node, Flow } = require('./PocketFlow');
const { searchForFactCheck } = require('../../services/webSearch');

const searchNode = new Node('search_processor', async (store, data) => {
  const { query } = data;
  
  try {
    const searchResult = await searchForFactCheck(query);
    
    // Store in shared knowledge
    const knowledge = store.get('searchResults') || new Map();
    knowledge.set(query, searchResult);
    store.set('searchResults', knowledge);
    
    return {
      success: true,
      response: searchResult.factCheck.verification,
      confidence: searchResult.factCheck.confidenceScore
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      response: 'Search failed'
    };
  }
});

const flow = new Flow(searchNode, new SharedStore());`,

      validationFlow: `// PocketFlow Validation Implementation  
const { Node, Flow } = require('./PocketFlow');

const validationNode = new Node('validator', async (store, data) => {
  const { statement, sources } = data;
  
  // Cross-reference multiple sources in shared store
  const validationStore = store.get('validationResults') || new Map();
  
  let confidence = 0;
  let sourceCount = 0;
  
  sources.forEach(source => {
    if (source.reliable) {
      confidence += source.confidence || 20;
      sourceCount++;
    }
  });
  
  const finalConfidence = Math.min(confidence, 100);
  
  validationStore.set(statement, {
    confidence: finalConfidence,
    sources: sourceCount,
    verified: finalConfidence >= 60
  });
  
  store.set('validationResults', validationStore);
  
  return {
    success: true,
    verified: finalConfidence >= 60,
    confidence: finalConfidence,
    sources: sourceCount
  };
});

const flow = new Flow(validationNode, new SharedStore());`,
    };
  }

  /**
   * Get knowledge statistics
   */
  getStats() {
    if (this.store && this.store.getKnowledgeStats) {
      return this.store.getKnowledgeStats();
    }

    // Fallback for non-persistent stores
    const knowledgeCache = this.store.get('knowledgeCache');
    const searchHistory = this.store.get('searchHistory');
    const confidenceScores = this.store.get('confidenceScores');

    return {
      cachedKnowledge: knowledgeCache ? knowledgeCache.size : 0,
      searchQueries: searchHistory ? searchHistory.length : 0,
      avgConfidence:
        confidenceScores && confidenceScores.size > 0
          ? Array.from(confidenceScores.values()).reduce((a, b) => a + b, 0) / confidenceScores.size
          : 0,
    };
  }

  /**
   * Graceful shutdown - saves knowledge to disk
   */
  async shutdown() {
    if (this.store && this.store.shutdown) {
      logger.info('Shutting down KnowledgeFlow and saving knowledge...');
      await this.store.shutdown();
    }
  }

  /**
   * Force save current knowledge state
   */
  async saveKnowledge() {
    if (this.store && this.store.forceSave) {
      logger.info('Force saving knowledge to disk...');
      await this.store.forceSave();
    }
  }
}

module.exports = KnowledgeFlow;
