const { Flow } = require('../PocketFlow');
const ConversationStore = require('../ConversationStore');
const IntentDetectionNode = require('../nodes/IntentDetectionNode');
const ContextManagerNode = require('../nodes/ContextManagerNode');
const ResponseRouterNode = require('../nodes/ResponseRouterNode');
const FunctionExecutorNode = require('../nodes/FunctionExecutorNode');

class IndividualConversationFlow {
  constructor(openaiClient, functionCallProcessor, options = {}) {
    this.store = new ConversationStore();
    this.options = options;

    this.initializeNodes(openaiClient, functionCallProcessor);
    this.buildFlow();
  }

  initializeNodes(openaiClient, functionCallProcessor) {
    this.intentNode = new IntentDetectionNode(this.options.intent);
    this.contextNode = new ContextManagerNode(this.options.context);
    this.routerNode = new ResponseRouterNode(this.options.router);
    this.functionNode = new FunctionExecutorNode(
      openaiClient,
      functionCallProcessor,
      this.options.function
    );

    this.setupConnections();
  }

  setupConnections() {
    this.intentNode
      .onSuccess(this.contextNode)
      .onError(this.createErrorHandler('intent_detection_failed'));

    this.contextNode
      .onSuccess(this.routerNode)
      .onError(this.createErrorHandler('context_management_failed'));

    this.routerNode
      .onCondition(result => result.success && result.routedData, this.functionNode)
      .onError(this.createErrorHandler('routing_failed'));

    this.functionNode
      .onSuccess(this.createSuccessHandler())
      .onError(this.createErrorHandler('function_execution_failed'));
  }

  buildFlow() {
    this.flow = new Flow(this.intentNode, this.store);
  }

  async processMessage(messageData) {
    try {
      const startTime = Date.now();

      const flowData = {
        message: messageData.message,
        context: messageData.context || {},
        flowType: 'individual',
        startTime: startTime,
      };

      this.store.setActiveFlow(messageData.message.author?.id, 'individual', flowData);

      const result = await this.flow.run(flowData);

      this.store.clearActiveFlow(messageData.message.author?.id);

      return {
        success: true,
        result: result,
        flowType: 'individual',
        executionTime: Date.now() - startTime,
        store: this.store.getAll(),
      };
    } catch (error) {
      this.store.clearActiveFlow(messageData.message.author?.id);
      throw error;
    }
  }

  createSuccessHandler() {
    const BaseConversationNode = require('../nodes/BaseNode');

    return new BaseConversationNode('success_handler', async (store, data) => {
      const userId = data.message?.author?.id;
      if (userId) {
        const conversation = store.getConversation(userId);

        if (data.response) {
          conversation.messages.push({
            role: 'assistant',
            content: data.response,
            timestamp: Date.now(),
            functionCall:
              data.type === 'function_call'
                ? {
                    name: data.functionName,
                    result: data.functionResult,
                  }
                : null,
          });
        }

        conversation.lastActivity = Date.now();
        store.updateConversation(userId, conversation);
      }

      return {
        success: true,
        response: data.response || 'I processed your message successfully.',
        type: data.type || 'direct_response',
        functionCall: data.functionCall,
        executionTime: data.executionTime,
      };
    });
  }

  createErrorHandler(errorType) {
    const BaseConversationNode = require('../nodes/BaseNode');

    return new BaseConversationNode(`error_handler_${errorType}`, async (store, data) => {
      const error = data.error || 'Unknown error occurred';

      return {
        success: false,
        error: error,
        errorType: errorType,
        response: this.getErrorResponse(errorType, error),
        timestamp: Date.now(),
      };
    });
  }

  getErrorResponse(errorType, _error) {
    const errorResponses = {
      intent_detection_failed:
        'I had trouble understanding your message. Could you try rephrasing it?',
      context_management_failed:
        'I encountered an issue managing our conversation context. Please try again.',
      routing_failed: 'I had trouble determining how to respond to your message.',
      function_execution_failed:
        'I encountered an error while trying to help you. Please try again.',
    };

    return errorResponses[errorType] || 'I encountered an unexpected error. Please try again.';
  }

  getStore() {
    return this.store;
  }

  getFlowStats() {
    const allConversations = this.store.get('conversations');
    const totalConversations = allConversations ? allConversations.size : 0;

    let totalMessages = 0;
    let activeConversations = 0;
    const now = Date.now();
    const activeThreshold = 5 * 60 * 1000; // 5 minutes

    if (allConversations) {
      for (const [_userId, conversation] of allConversations) {
        totalMessages += conversation.messages.length;
        if (now - conversation.lastActivity < activeThreshold) {
          activeConversations++;
        }
      }
    }

    return {
      totalConversations,
      activeConversations,
      totalMessages,
      avgMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
      storeSize: this.store.data.size,
    };
  }

  cleanup() {
    this.store.cleanup();
  }
}

module.exports = IndividualConversationFlow;
