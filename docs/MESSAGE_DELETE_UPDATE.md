# Message Delete and Update Handling

This document describes the message delete and update functionality implemented for ChimpGPT's conversation management system.

## Overview

ChimpGPT now automatically handles Discord message deletions and edits by synchronizing the conversation history stored in memory with the actual state of messages in Discord channels.

## Features

### Message Deletion Handling
- Automatically removes deleted messages from conversation history
- Works in both individual and blended conversation modes
- Supports both channel and direct message conversations
- Preserves conversation flow and context integrity

### Message Update Handling
- Automatically updates edited messages in conversation history
- Maintains conversation context with updated content
- Marks messages as edited with timestamps
- Preserves original message metadata

## Technical Implementation

### Event Handlers
The bot listens for two Discord.js events:

1. **`messageDelete`** - Triggered when a message is deleted
2. **`messageUpdate`** - Triggered when a message is edited

### Conversation Manager Support
Both conversation management modes support message tracking:

#### Blended Conversation Mode
- Messages are stored with Discord message IDs for tracking
- Removal searches across all users in a channel
- Updates preserve username formatting for context

#### Individual Conversation Mode
- Messages are stored per-user with Discord message IDs
- Direct lookup by user ID and message ID
- Updates maintain message structure and metadata

### Message ID Tracking
All new messages are now stored with their Discord message IDs:

```javascript
const messageWithMeta = {
  role: 'user',
  content: 'Hello world',
  userId: '123456789',
  timestamp: Date.now(),
  username: 'TestUser',
  messageId: 'discord-message-id-here'  // New field
};
```

## API Functions

### removeMessageById(channelId, messageId, isDM)
Removes a message from conversation history by Discord message ID.

**Parameters:**
- `channelId` (string) - Channel ID or user ID for DMs
- `messageId` (string) - Discord message ID to remove
- `isDM` (boolean) - Whether this is a direct message

**Returns:** `boolean` - True if message was found and removed

### updateMessageById(channelId, messageId, newContent, isDM)
Updates a message in conversation history by Discord message ID.

**Parameters:**
- `channelId` (string) - Channel ID or user ID for DMs
- `messageId` (string) - Discord message ID to update
- `newContent` (string) - New message content
- `isDM` (boolean) - Whether this is a direct message

**Returns:** `boolean` - True if message was found and updated

## Configuration

No additional configuration is required. The message delete/update handling is automatically enabled when the bot starts.

### Channel Restrictions
- Only processes messages from allowed channels (configured in `CHANNEL_ID`)
- Respects existing channel permissions and restrictions
- Maintains security boundaries

## Benefits

1. **Conversation Accuracy** - Conversation history reflects actual Discord state
2. **Context Preservation** - Edited messages maintain conversation flow
3. **Privacy Compliance** - Deleted messages are removed from bot memory
4. **Seamless Operation** - Works transparently without user intervention

## Testing

Comprehensive tests are included in `tests/messageDeleteTest.js` covering:
- Blended conversation message deletion
- Blended conversation message updates
- Individual conversation message deletion
- Individual conversation message updates

Run tests with:
```bash
node tests/messageDeleteTest.js
```

## Error Handling

The implementation includes robust error handling:
- Graceful degradation on API failures
- Comprehensive logging for debugging
- Safe fallbacks for missing message IDs
- Protection against race conditions

## Performance Considerations

- Message tracking adds minimal overhead
- Efficient lookup algorithms for large conversations
- Automatic conversation storage after changes
- Memory-efficient message ID storage

## Future Enhancements

Potential future improvements could include:
- Bulk message deletion handling
- Message history audit trails
- Advanced edit tracking and versioning
- Integration with Discord's message history API