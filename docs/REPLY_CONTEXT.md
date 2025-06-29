# Reply Context Enhancement

## Overview

This document describes the reply context enhancement feature implemented in ChimpGPT, which allows the bot to utilize message replies to provide context for ongoing conversations.

## Purpose

Discord conversations often involve replying to previous messages, creating threads of discussion. Before this enhancement, ChimpGPT would only consider a linear history of messages from a user, losing context when users replied to specific parts of a conversation. This feature aims to:

1. Make conversations more natural by maintaining context from reply chains
2. Allow the bot to understand references to previous discussions
3. Improve the overall conversational experience by making the bot more context-aware

## Implementation

### Components

The implementation consists of three main components:

1. **Message Reference Resolver** (`utils/messageReferenceResolver.js`)

   - Resolves message references in the Discord API
   - Builds context from reply chains
   - Manages caching to avoid redundant API calls
   - Transforms message data into conversation-compatible format

2. **Conversation Manager Enhancement** (`conversationManager.js`)

   - Integrates with the message reference resolver
   - Adds reference context to user conversations
   - Ensures proper ordering of messages with references
   - Manages pruning while preserving important context

3. **Main Bot Integration** (`chimpGPT.js`)
   - Passes Discord message objects to the conversation manager
   - Enables asynchronous conversation management
   - Adds logging for reference handling

### Configuration

The feature is configurable through the following environment variables:

```
ENABLE_REPLY_CONTEXT="true"  # Enable/disable the feature
MAX_REFERENCE_DEPTH="5"      # Maximum depth of reply chains to follow
MAX_REFERENCE_CONTEXT="5"    # Maximum number of referenced messages to include
```

These can be set in the `.env` file to customize the behavior of the reply context feature.

## Technical Details

### Reference Resolution Process

1. When a user sends a message that is a reply to another message:

   - The bot identifies the message as a reply via `message.reference`
   - It resolves the referenced message using Discord's API
   - If the referenced message is itself a reply, it follows the chain up to `MAX_REFERENCE_DEPTH`
   - Messages are cached to avoid redundant API calls

2. Building conversation context:

   - Referenced messages are transformed into conversation format (role, content)
   - User messages get role="user", bot messages get role="assistant"
   - The messages are ordered chronologically to maintain conversation flow
   - Only up to `MAX_REFERENCE_CONTEXT` messages are included to prevent context bloat

3. Integration with existing conversation:
   - Reference context is added to the user's conversation
   - The original system message is preserved
   - If the conversation exceeds `MAX_CONVERSATION_LENGTH`, older messages are pruned
   - Referenced messages are given priority over older non-referenced messages

### Example Flow

1. User A: "What's the weather like today?"
2. Bot: "The weather in New York is sunny with a high of 75°F."
3. User A: "What about tomorrow?" (replying to the bot's message)
4. Bot processing:
   - Identifies message #3 as a reply to message #2
   - Resolves message #2, seeing it's a reply to message #1
   - Builds context: [message #1, message #2]
   - Adds this context to the conversation
   - Generates response with full context of the weather discussion

## Testing

A test script is provided at `src/tools/testReplyContext.js` that simulates various message reference scenarios and verifies that the reference resolver and conversation manager handle them correctly.

## Limitations and Future Improvements

- Discord API rate limits may affect how many referenced messages can be resolved
- Very deep reply chains may be truncated
- Cross-channel replies are supported but may have limited context
- Future enhancements could include:
  - Smarter prioritization of which referenced messages to include
  - Summarization of long reference chains
  - User-specific reference depth preferences

## Conclusion

The reply context enhancement makes ChimpGPT more conversationally aware and capable of maintaining context in complex discussions. This results in a more natural and engaging user experience.
