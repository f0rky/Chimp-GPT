# PocketFlow Conversation System

A modern, graph-based conversation management system built on the PocketFlow architecture that replaces the complex legacy conversation logic with a clean, modular approach.

## Overview

The PocketFlow conversation system provides:

- **Graph-based Architecture**: Clear node connections with explicit data flow
- **Shared Store Pattern**: Centralized state management across conversation components  
- **Modular Design**: Each node handles a specific task with clean interfaces
- **Multiple Flow Types**: Individual, blended, and command flows
- **Parallel Testing**: Side-by-side comparison with legacy system

## Architecture

```
Message Input
    ↓
Intent Detection Node
    ↓
Context Manager Node  
    ↓
Response Router Node
    ↓
Function Executor Node
    ↓
Response Output
```

## Key Components

### Core Framework

- **PocketFlow.js**: Base Node, SharedStore, and Flow classes
- **ConversationStore.js**: Extended shared store for conversation state
- **BaseNode.js**: Base class for all conversation nodes with error handling

### Nodes

- **IntentDetectionNode**: Analyzes messages to determine bot intent
- **ContextManagerNode**: Manages conversation history and optimization  
- **ResponseRouterNode**: Routes between individual vs blended conversation modes
- **FunctionExecutorNode**: Handles OpenAI function calling workflow

### Flows

- **IndividualConversationFlow**: One-on-one user conversations
- **BlendedConversationFlow**: Multi-user channel conversations
- **CommandFlow**: Direct command execution (!help, !stats, etc.)

### Management

- **PocketFlowConversationManager**: Main orchestrator for all flows
- **ParallelConversationTester**: A/B testing against legacy system

## Usage Example

```javascript
const { PocketFlowConversationManager } = require('./flow/PocketFlowConversationManager');

// Initialize the manager
const conversationManager = new PocketFlowConversationManager(
  openaiClient,
  functionCallProcessor, 
  commandHandler,
  {
    enableParallelTesting: true,
    flows: {
      individual: { timeout: 15000 },
      blended: { confidenceThreshold: 0.3 },
      command: { enableBuiltins: true }
    }
  }
);

// Process a message
const result = await conversationManager.processMessage(discordMessage, context);

if (result.success) {
  await message.reply(result.result.response);
} else {
  console.error('Conversation processing failed:', result.error);
}
```

## Configuration Options

### PocketFlowConversationManager Options

```javascript
{
  enableParallelTesting: false,    // Enable A/B testing with legacy
  cleanupInterval: 300000,         // Cleanup interval (5 minutes)
  maxConcurrentFlows: 10,          // Max simultaneous conversations
  flows: {
    individual: {
      timeout: 15000,
      config: {
        charsPerToken: 4,
        defaultMaxTokens: 2000,
        maxConversationLength: 20
      }
    },
    blended: {
      confidenceThreshold: 0.3,
      config: {
        blendedChannelThreshold: 3,
        blendedModeTimeout: 300000
      }
    },
    command: {
      enableBuiltins: true
    }
  }
}
```

### Environment Variables for Testing

```bash
ENABLE_PARALLEL_TESTING=true
PARALLEL_TEST_PERCENTAGE=10
LOG_PARALLEL_COMPARISONS=true
PARALLEL_TEST_USERS=user1,user2,user3
```

## Flow Types

### Individual Conversation Flow

Best for:
- Direct messages
- High-confidence bot-directed messages  
- Commands and explicit requests
- One-on-one interactions

Features:
- Per-user conversation history
- Context optimization based on relevance
- Function calling support
- Smart intent detection

### Blended Conversation Flow  

Best for:
- Active channel conversations (3+ users)
- High message velocity channels
- Multi-user discussions
- Ambient conversation participation

Features:
- Channel-wide context awareness
- Activity-based routing decisions
- Multi-user message attribution
- Conversation velocity tracking

### Command Flow

Best for:
- Explicit commands (!help, !stats, etc.)
- Administrative functions
- Quick utility responses
- System information requests

Features:
- Direct command parsing
- Built-in command handlers
- Custom command support
- Error handling and help

## Migration Guide

### Phase 1: Parallel Testing

1. Enable parallel testing in development:
```javascript
const tester = new ParallelConversationTester(
  legacyManager,
  openaiClient, 
  functionCallProcessor,
  commandHandler,
  { enableTesting: true, testPercentage: 10 }
);
```

2. Monitor comparison stats:
```javascript
const stats = tester.getTestStats();
console.log('Performance:', stats.performance);
console.log('Functionality:', stats.functionality);
```

### Phase 2: Gradual Migration

1. Start with command processing:
```javascript
if (isCommand(message.content)) {
  return await pocketFlowManager.processMessage(message, context);
} else {
  return await legacyManager.processMessage(message, context);
}
```

2. Migrate individual conversations:
```javascript
if (message.channel.type === 'DM') {
  return await pocketFlowManager.processMessage(message, context);
}
```

3. Finally migrate blended conversations

### Phase 3: Full Replacement

Replace the legacy conversation manager entirely with PocketFlowConversationManager.

## Performance Benefits

Expected improvements over legacy system:

- **60% reduction** in conversation logic complexity
- **Better debugging** and flow visualization  
- **Easier addition** of new conversation patterns
- **More maintainable** and testable codebase
- **Improved response times** through optimized context management

## Monitoring and Stats

### Real-time Stats

```javascript
const stats = conversationManager.getStats();
console.log('Total processed:', stats.manager.totalProcessed);
console.log('Success rate:', stats.manager.successfulResponses / stats.manager.totalProcessed);
console.log('Avg response time:', stats.manager.avgResponseTime);
```

### Detailed Performance Analysis

```javascript
const detailedStats = conversationManager.getDetailedStats();
console.log('Memory usage:', detailedStats.memory);
console.log('Flow performance:', detailedStats.performance);  
console.log('Store contents:', detailedStats.stores);
```

### Active Flow Monitoring

```javascript
const activeFlows = conversationManager.getActiveFlows();
activeFlows.forEach(flow => {
  console.log(`Flow ${flow.messageId}: ${flow.type} (${flow.duration}ms)`);
});
```

## Error Handling

The system includes comprehensive error handling:

- **Node-level timeouts** with configurable limits
- **Retry logic** for transient failures  
- **Circuit breaker patterns** for external services
- **Graceful degradation** when components fail
- **Detailed error logging** for debugging

## Cleanup and Memory Management

- **Automatic cleanup** every 5 minutes
- **Conversation expiration** based on activity
- **Memory usage monitoring** 
- **Stale flow detection** and removal
- **Configurable retention policies**

## Contributing

When adding new nodes or flows:

1. Extend `BaseConversationNode` for new nodes
2. Follow the connection pattern: `.onSuccess()`, `.onError()`, `.onCondition()`
3. Update the flow definitions to include new nodes
4. Add comprehensive error handling
5. Include performance monitoring
6. Write tests for the new functionality

## Troubleshooting

### Common Issues

**High memory usage**: Check conversation retention settings and cleanup intervals

**Slow response times**: Review context optimization settings and token limits

**Flow failures**: Check node timeouts and error handling configuration

**Testing discrepancies**: Verify parallel testing configuration and user filtering

### Debug Mode

Enable debug logging:
```javascript
const manager = new PocketFlowConversationManager(client, processor, handler, {
  flows: {
    individual: { logLevel: 'debug' },
    blended: { logLevel: 'debug' }
  }
});
```

### Performance Monitoring

Use the built-in performance tracking:
```javascript
setInterval(() => {
  const stats = manager.getStats();
  if (stats.manager.avgResponseTime > 5000) {
    console.warn('High response times detected:', stats.manager.avgResponseTime);
  }
}, 60000);
```