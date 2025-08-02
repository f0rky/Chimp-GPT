/**
 * Enhanced Message Deletion Management System Tests
 *
 * Comprehensive test suite for the enhanced message deletion system including
 * context extraction, intelligent response strategies, and bot message management.
 */

const {
  enhancedMessageManager,
  ENHANCED_CONFIG,
  ENHANCED_TEMPLATES,
} = require('../src/utils/enhancedMessageManager');
const { contextExtractionService } = require('../src/utils/contextExtractionService');
const maliciousUserManager = require('../src/utils/maliciousUserManager');

// Mock Discord message objects
const createMockMessage = (content, authorId = 'user123', messageId = 'msg123') => ({
  id: messageId,
  content,
  author: {
    id: authorId,
    username: 'testuser',
    displayName: 'Test User',
    bot: false,
  },
  channel: {
    id: 'channel123',
    name: 'test-channel',
    isDMBased: () => false,
  },
  channelId: 'channel123',
  createdAt: new Date(),
  attachments: new Map(),
  embeds: [],
  guildId: 'guild123',
});

const createMockBotMessage = (content, messageId = 'bot123') => ({
  id: messageId,
  content,
  channelId: 'channel123',
  edit: jest.fn().mockResolvedValue(),
  delete: jest.fn().mockResolvedValue(),
  channel: {
    send: jest.fn().mockResolvedValue({ id: 'summary123' }),
  },
});

describe('Enhanced Message Deletion Management System', () => {
  beforeEach(() => {
    // Clear any existing relationships and state
    enhancedMessageManager.relationships?.clear?.();
    enhancedMessageManager.userDeletionWindows?.clear?.();
    jest.clearAllMocks();
  });

  describe('Context Extraction Service', () => {
    test('should extract context from question messages', () => {
      const content = 'How do I implement authentication in Node.js?';
      const context = contextExtractionService.extractContext(content);

      expect(context.type).toBe('question');
      expect(context.theme).toBe('technical');
      expect(context.intent).toBe('seeking_information');
      expect(context.summary).toContain('authentication');
      expect(context.complexity).toBeGreaterThan(0);
    });

    test('should extract context from image generation requests', () => {
      const content = 'Draw me a beautiful sunset over mountains';
      const context = contextExtractionService.extractContext(content);

      expect(context.type).toBe('image_request');
      expect(context.intent).toBe('requesting_creation');
      expect(context.imageContext).toContain('beautiful sunset over mountains');
      expect(context.conversationTheme).toContain('creative');
    });

    test('should extract context from function calls', () => {
      const content = "What's the weather like in New York?";
      const context = contextExtractionService.extractContext(content);

      expect(context.type).toBe('function_call');
      expect(context.functionType).toBe('weather');
      expect(context.keywords).toContain('weather');
    });

    test('should handle empty or invalid content gracefully', () => {
      const context = contextExtractionService.extractContext('');

      expect(context.type).toBe('unknown');
      expect(context.summary).toBe('Empty message');
      expect(context.complexity).toBe(0);
    });

    test('should cache extraction results', () => {
      const content = 'Test message for caching';
      const context1 = contextExtractionService.extractContext(content);
      const context2 = contextExtractionService.extractContext(content);

      expect(context1).toEqual(context2);
      expect(contextExtractionService.getCacheStats().size).toBeGreaterThan(0);
    });
  });

  describe('Enhanced Message Relationship Manager', () => {
    test('should store message relationships with enhanced context', () => {
      const userMessage = createMockMessage('How do I use React hooks?');
      const botMessage = createMockBotMessage('React hooks are functions that...');
      const userInfo = { id: 'user123', username: 'testuser' };

      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
        type: 'question',
      });

      const relationship = enhancedMessageManager.getRelationship(userMessage.id);
      expect(relationship).toBeDefined();
      expect(relationship.userMessageId).toBe(userMessage.id);
      expect(relationship.botMessageId).toBe(botMessage.id);
      expect(relationship.context.type).toBe('question');
    });

    test('should generate appropriate context summaries', () => {
      const longContent =
        'This is a very long message that should be truncated when generating a summary for the deletion context because it exceeds the maximum length';
      const summary = enhancedMessageManager.generateContextSummary(longContent);

      expect(summary.length).toBeLessThanOrEqual(53); // 50 chars + "..."
      expect(summary).toContain('...');
    });

    test('should clean up old relationships', () => {
      const userMessage = createMockMessage('Test message');
      const botMessage = createMockBotMessage('Test response');
      const userInfo = { id: 'user123', username: 'testuser' };

      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
      });

      // Mock old timestamp
      const relationship = enhancedMessageManager.getRelationship(userMessage.id);
      relationship.createdAt = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago

      enhancedMessageManager.cleanupOldRelationships(24 * 60 * 60 * 1000); // 24 hour threshold

      expect(enhancedMessageManager.getRelationship(userMessage.id)).toBeNull();
    });
  });

  describe('Deletion Response Strategies', () => {
    test('should determine UPDATE strategy for single deletion', () => {
      const deletionContext = {
        userId: 'user123',
        isOwner: false,
        isRapidDeletion: false,
        isBulkDeletion: false,
        isFrequentDeleter: false,
        totalDeletions: 1,
        recentDeletionCount: 1,
      };

      const strategy = enhancedMessageManager.determineResponseStrategy(deletionContext);

      expect(strategy.action).toBe(ENHANCED_CONFIG.STRATEGIES.UPDATE);
      expect(strategy.template).toBe('contextual_single');
      expect(strategy.reason).toBe('single_deletion_with_context');
    });

    test('should determine DELETE strategy for rapid deletion', () => {
      const deletionContext = {
        userId: 'user123',
        isOwner: false,
        isRapidDeletion: true,
        isBulkDeletion: false,
        isFrequentDeleter: false,
        totalDeletions: 1,
        recentDeletionCount: 1,
      };

      const strategy = enhancedMessageManager.determineResponseStrategy(deletionContext);

      expect(strategy.action).toBe(ENHANCED_CONFIG.STRATEGIES.DELETE);
      expect(strategy.template).toBe('rapid_deletion');
      expect(strategy.reason).toBe('rapid_deletion_cleanup');
    });

    test('should determine DELETE strategy for bulk deletion', () => {
      const deletionContext = {
        userId: 'user123',
        isOwner: false,
        isRapidDeletion: false,
        isBulkDeletion: true,
        isFrequentDeleter: false,
        totalDeletions: 3,
        recentDeletionCount: 3,
      };

      const strategy = enhancedMessageManager.determineResponseStrategy(deletionContext);

      expect(strategy.action).toBe(ENHANCED_CONFIG.STRATEGIES.DELETE);
      expect(strategy.template).toBe('multiple_cleanup');
      expect(strategy.createSummary).toBe(true);
      expect(strategy.reason).toBe('bulk_deletion_cleanup');
    });

    test('should determine ESCALATE strategy for frequent deleter', () => {
      const deletionContext = {
        userId: 'user123',
        isOwner: false,
        isRapidDeletion: false,
        isBulkDeletion: false,
        isFrequentDeleter: true,
        totalDeletions: 6,
        recentDeletionCount: 1,
      };

      const strategy = enhancedMessageManager.determineResponseStrategy(deletionContext);

      expect(strategy.action).toBe(ENHANCED_CONFIG.STRATEGIES.ESCALATE);
      expect(strategy.template).toBe('frequent_deleter');
      expect(strategy.reason).toBe('frequent_deletion_pattern');
    });

    test('should determine UPDATE strategy for owner deletion', () => {
      const deletionContext = {
        userId: 'owner123',
        isOwner: true,
        isRapidDeletion: false,
        isBulkDeletion: false,
        isFrequentDeleter: false,
        totalDeletions: 10,
        recentDeletionCount: 1,
      };

      const strategy = enhancedMessageManager.determineResponseStrategy(deletionContext);

      expect(strategy.action).toBe(ENHANCED_CONFIG.STRATEGIES.UPDATE);
      expect(strategy.template).toBe('owner_privilege');
      expect(strategy.reason).toBe('owner_deletion');
    });
  });

  describe('Template Formatting', () => {
    test('should format contextual single template correctly', () => {
      const template = ENHANCED_TEMPLATES.contextual_single.answer;
      const relationship = {
        userInfo: { username: 'testuser' },
        context: { summary: 'authentication question' },
      };
      const deletionContext = { totalDeletions: 2 };

      const formatted = enhancedMessageManager.formatTemplate(
        template,
        relationship,
        deletionContext
      );

      expect(formatted).toContain('testuser');
      expect(formatted).toContain('authentication question');
    });

    test('should format multiple cleanup template correctly', () => {
      const template = ENHANCED_TEMPLATES.multiple_cleanup.notification;
      const relationship = {
        userInfo: { username: 'testuser' },
        context: { summary: 'last topic discussed' },
      };
      const deletionContext = { totalDeletions: 3, lastContext: 'React hooks' };

      const formatted = enhancedMessageManager.formatTemplate(
        template,
        relationship,
        deletionContext
      );

      expect(formatted).toContain('testuser');
      expect(formatted).toContain('3');
      expect(formatted).toContain('React hooks');
    });

    test('should get appropriate template for response type', () => {
      const template = enhancedMessageManager.getTemplate('contextual_single', 'image');
      expect(template).toBe(ENHANCED_TEMPLATES.contextual_single.image);

      const fallbackTemplate = enhancedMessageManager.getTemplate('contextual_single', 'unknown');
      expect(fallbackTemplate).toBe(ENHANCED_TEMPLATES.contextual_single.default);
    });
  });

  describe('Strategy Execution', () => {
    test('should execute UPDATE strategy successfully', async () => {
      const userMessage = createMockMessage('Test question');
      const botMessage = createMockBotMessage('Test response');
      const userInfo = { id: 'user123', username: 'testuser' };

      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
        type: 'question',
      });

      const strategy = { action: 'update_with_context', template: 'contextual_single' };
      const relationship = enhancedMessageManager.getRelationship(userMessage.id);
      const deletionContext = { totalDeletions: 1 };

      // Mock maliciousUserManager functions
      maliciousUserManager.linkDeletedMessageToBotResponse = jest.fn().mockResolvedValue();

      const result = await enhancedMessageManager.updateBotMessage(
        strategy,
        relationship,
        deletionContext
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('updated');
      expect(botMessage.edit).toHaveBeenCalled();
    });

    test('should execute DELETE strategy successfully', async () => {
      const userMessage = createMockMessage('Test question');
      const botMessage = createMockBotMessage('Test response');
      const userInfo = { id: 'user123', username: 'testuser' };

      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
        type: 'question',
      });

      const strategy = { action: 'cleanup_all_related', createSummary: true };
      const relationship = enhancedMessageManager.getRelationship(userMessage.id);
      const deletionContext = { totalDeletions: 3 };

      const result = await enhancedMessageManager.deleteBotMessage(
        strategy,
        relationship,
        deletionContext
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('deleted');
      expect(result.summaryCreated).toBe(true);
      expect(botMessage.delete).toHaveBeenCalled();
      expect(botMessage.channel.send).toHaveBeenCalled();
    });

    test('should execute ESCALATE strategy successfully', async () => {
      const userMessage = createMockMessage('Test question');
      const botMessage = createMockBotMessage('Test response');
      const userInfo = { id: 'user123', username: 'testuser' };

      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
        type: 'question',
      });

      const strategy = { action: 'log_and_cleanup' };
      const relationship = enhancedMessageManager.getRelationship(userMessage.id);
      const deletionContext = { totalDeletions: 5, userId: 'user123' };

      const result = await enhancedMessageManager.escalateAndCleanup(
        strategy,
        relationship,
        deletionContext
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('escalated_and_cleaned');
      expect(botMessage.delete).toHaveBeenCalled();
    });

    test('should handle execution errors gracefully', async () => {
      const userMessage = createMockMessage('Test question');
      const botMessage = createMockBotMessage('Test response');
      const userInfo = { id: 'user123', username: 'testuser' };

      // Make bot message edit fail
      botMessage.edit = jest.fn().mockRejectedValue(new Error('Discord API error'));

      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
        type: 'question',
      });

      const strategy = { action: 'update_with_context', template: 'contextual_single' };
      const relationship = enhancedMessageManager.getRelationship(userMessage.id);
      const deletionContext = { totalDeletions: 1 };

      const result = await enhancedMessageManager.updateBotMessage(
        strategy,
        relationship,
        deletionContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Discord API error');
    });
  });

  describe('Deletion Context Analysis', () => {
    test('should analyze rapid deletion correctly', async () => {
      const recentMessage = createMockMessage('Test message');
      recentMessage.createdAt = new Date(Date.now() - 15000); // 15 seconds ago

      const relationship = {
        deletionHistory: [{ timeSinceCreation: 15000 }],
        userInfo: { username: 'testuser' },
        context: { summary: 'test context' },
      };

      // Mock getUserStats
      maliciousUserManager.getUserStats = jest.fn().mockReturnValue({ totalDeletions: 1 });
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);

      const context = await enhancedMessageManager.analyzeDeletionContext(
        recentMessage,
        relationship
      );

      expect(context.isRapidDeletion).toBe(true);
      expect(context.isBulkDeletion).toBe(false);
      expect(context.isFrequentDeleter).toBe(false);
    });

    test('should analyze bulk deletion correctly', async () => {
      const message = createMockMessage('Test message');
      const relationship = {
        deletionHistory: [{ timeSinceCreation: 60000 }],
        userInfo: { username: 'testuser' },
        context: { summary: 'test context' },
      };

      // Simulate multiple recent deletions
      enhancedMessageManager.userDeletionWindows.set('user123', [
        Date.now() - 30000,
        Date.now() - 60000,
        Date.now(),
      ]);

      maliciousUserManager.getUserStats = jest.fn().mockReturnValue({ totalDeletions: 3 });
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);

      const context = await enhancedMessageManager.analyzeDeletionContext(message, relationship);

      expect(context.isBulkDeletion).toBe(true);
      expect(context.recentDeletionCount).toBeGreaterThanOrEqual(2);
    });

    test('should analyze frequent deleter correctly', async () => {
      const message = createMockMessage('Test message');
      const relationship = {
        deletionHistory: [{ timeSinceCreation: 60000 }],
        userInfo: { username: 'testuser' },
        context: { summary: 'test context' },
      };

      maliciousUserManager.getUserStats = jest.fn().mockReturnValue({ totalDeletions: 6 });
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);

      const context = await enhancedMessageManager.analyzeDeletionContext(message, relationship);

      expect(context.isFrequentDeleter).toBe(true);
      expect(context.totalDeletions).toBe(6);
    });
  });

  describe('Integration Tests', () => {
    test('should process complete deletion workflow for single deletion', async () => {
      const userMessage = createMockMessage('How do I use async/await in Node.js?');
      const botMessage = createMockBotMessage('Async/await is a way to handle...');
      const userInfo = { id: 'user123', username: 'testuser' };

      // Store relationship
      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
        type: 'question',
      });

      // Mock dependencies
      maliciousUserManager.getUserStats = jest.fn().mockReturnValue({ totalDeletions: 1 });
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);
      maliciousUserManager.linkDeletedMessageToBotResponse = jest.fn().mockResolvedValue();

      // Process deletion
      const result = await enhancedMessageManager.processDeletion(userMessage);

      expect(result.success).toBe(true);
      expect(result.action).toBe('updated');
      expect(botMessage.edit).toHaveBeenCalled();

      // Verify message was updated with context
      const editCall = botMessage.edit.mock.calls[0][0];
      expect(editCall).toContain('testuser');
      expect(editCall).toContain('async/await');
    });

    test('should process complete deletion workflow for bulk deletion', async () => {
      const userMessage = createMockMessage('Test message');
      const botMessage = createMockBotMessage('Test response');
      const userInfo = { id: 'user123', username: 'testuser' };

      // Store relationship
      enhancedMessageManager.storeRelationship(userMessage.id, botMessage, userInfo, {
        content: userMessage.content,
        type: 'conversation',
      });

      // Simulate bulk deletion
      enhancedMessageManager.userDeletionWindows.set('user123', [
        Date.now() - 30000,
        Date.now() - 60000,
        Date.now(),
      ]);

      // Mock dependencies
      maliciousUserManager.getUserStats = jest.fn().mockReturnValue({ totalDeletions: 3 });
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);

      // Process deletion
      const result = await enhancedMessageManager.processDeletion(userMessage);

      expect(result.success).toBe(true);
      expect(result.action).toBe('deleted');
      expect(result.summaryCreated).toBe(true);
      expect(botMessage.delete).toHaveBeenCalled();
      expect(botMessage.channel.send).toHaveBeenCalled();
    });
  });

  describe('Performance and Statistics', () => {
    test('should provide accurate statistics', () => {
      const userMessage1 = createMockMessage('Message 1', 'user1', 'msg1');
      const userMessage2 = createMockMessage('Message 2', 'user2', 'msg2');
      const botMessage1 = createMockBotMessage('Response 1', 'bot1');
      const botMessage2 = createMockBotMessage('Response 2', 'bot2');

      enhancedMessageManager.storeRelationship(
        'msg1',
        botMessage1,
        { id: 'user1', username: 'user1' },
        { content: 'Message 1' }
      );
      enhancedMessageManager.storeRelationship(
        'msg2',
        botMessage2,
        { id: 'user2', username: 'user2' },
        { content: 'Message 2' }
      );

      const stats = enhancedMessageManager.getStatistics();

      expect(stats.totalRelationships).toBe(2);
      expect(stats).toHaveProperty('userDeletionWindows');
      expect(stats).toHaveProperty('bulkOperationQueueSize');
    });

    test('should handle high volume of relationships efficiently', () => {
      const startTime = Date.now();

      // Create many relationships
      for (let i = 0; i < 1000; i++) {
        const userMessage = createMockMessage(`Message ${i}`, `user${i}`, `msg${i}`);
        const botMessage = createMockBotMessage(`Response ${i}`, `bot${i}`);

        enhancedMessageManager.storeRelationship(
          `msg${i}`,
          botMessage,
          { id: `user${i}`, username: `user${i}` },
          { content: `Message ${i}` }
        );
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (less than 1 second)
      expect(duration).toBeLessThan(1000);
      expect(enhancedMessageManager.getStatistics().totalRelationships).toBe(1000);
    });
  });

  describe('Review Action Outcomes', () => {
    test('should apply approved action correctly', async () => {
      const mockMessage = { messageId: 'test123', userId: 'user123', botResponseId: 'bot456' };
      const result = await maliciousUserManager.applyReviewAction(
        mockMessage,
        'approved',
        'owner123'
      );

      expect(result.action).toBe('approved');
      expect(result.outcome).toBe('Update bot response with deletion context');
      expect(result.userAction).toBe('update_response_with_context');
    });

    test('should apply flagged action correctly', async () => {
      const mockMessage = { messageId: 'test123', userId: 'user123' };
      const result = await maliciousUserManager.applyReviewAction(
        mockMessage,
        'flagged',
        'owner123'
      );

      expect(result.action).toBe('flagged');
      expect(result.outcome).toBe('Warning issued, bot response preserved');
      expect(result.userAction).toBe('warning_issued_with_response');
    });

    test('should apply ignored action correctly', async () => {
      const mockMessage = { messageId: 'test123', userId: 'user123', botResponseId: 'bot456' };
      const result = await maliciousUserManager.applyReviewAction(
        mockMessage,
        'ignored',
        'owner123'
      );

      expect(result.action).toBe('ignored');
      expect(result.outcome).toBe('Delete bot original response - treat as normal deletion');
      expect(result.userAction).toBe('delete_bot_response');
    });

    test('should apply banned action and block user', async () => {
      const mockMessage = { messageId: 'test123', userId: 'user_to_ban' };

      // Mock blockUser to avoid actual blocking in tests
      const originalBlockUser = maliciousUserManager.blockUser;
      maliciousUserManager.blockUser = jest.fn().mockResolvedValue();

      const result = await maliciousUserManager.applyReviewAction(
        mockMessage,
        'banned',
        'owner123'
      );

      expect(result.action).toBe('banned');
      expect(result.outcome).toBe('User blocked from bot access');
      expect(result.userAction).toBe('user_blocked');
      expect(maliciousUserManager.blockUser).toHaveBeenCalledWith(
        'user_to_ban',
        'Manual ban from review of message test123'
      );

      // Restore original function
      maliciousUserManager.blockUser = originalBlockUser;
    });

    test('should get correct review action outcomes', () => {
      expect(maliciousUserManager.getReviewActionOutcome('approved')).toBe(
        'Legitimate deletion - update response with context'
      );
      expect(maliciousUserManager.getReviewActionOutcome('flagged')).toBe(
        'Suspicious, needs attention - warning issued with bot response'
      );
      expect(maliciousUserManager.getReviewActionOutcome('ignored')).toBe(
        'Treat as normal deletion - delete bot original response'
      );
      expect(maliciousUserManager.getReviewActionOutcome('banned')).toBe(
        'Results in user ban - user blocked from bot'
      );
      expect(maliciousUserManager.getReviewActionOutcome('pending_review')).toBe(
        'Awaiting manual review'
      );
      expect(maliciousUserManager.getReviewActionOutcome('unknown')).toBe('Unknown action');
    });
  });

  describe('Message Reprocessing', () => {
    beforeEach(() => {
      // Mock isOwner to return true for test user
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(true);
    });

    test('should reprocess message successfully', async () => {
      // Create a mock message in deletedMessages
      const mockDeletedMessage = {
        messageId: 'reprocess_test_123',
        userId: 'user123',
        username: 'testuser',
        fullContent: 'Test message for reprocessing',
        messageCreatedAt: Date.now() - 60000,
        channelId: 'channel123',
        canReprocess: true,
        reprocessCount: 0,
        reviewHistory: [],
      };

      // Add to maliciousUserManager's deletedMessages
      const deletedMessages = new Map();
      deletedMessages.set('reprocess_test_123', mockDeletedMessage);

      // Mock the internal deletedMessages map
      const originalGetDeletedMessages = maliciousUserManager.getDeletedMessagesForWebUI;
      maliciousUserManager.getDeletedMessagesForWebUI = jest
        .fn()
        .mockReturnValue([mockDeletedMessage]);

      // Mock enhancedMessageManager processDeletion
      enhancedMessageManager.processDeletion = jest.fn().mockResolvedValue({
        success: true,
        action: 'updated',
        reason: 'single_deletion_with_context',
      });

      const result = await maliciousUserManager.reprocessDeletedMessage(
        'owner123',
        'reprocess_test_123',
        { forceRapidDeletion: true }
      );

      expect(result.success).toBe(true);
      expect(result.reprocessingResult.success).toBe(true);
      expect(result.reprocessingResult.action).toBe('updated');
      expect(result.testingOptions.forceRapidDeletion).toBe(true);

      // Restore original function
      maliciousUserManager.getDeletedMessagesForWebUI = originalGetDeletedMessages;
    });

    test('should prevent unauthorized reprocessing', async () => {
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);

      await expect(
        maliciousUserManager.reprocessDeletedMessage('unauthorized_user', 'msg123')
      ).rejects.toThrow('Access denied: Owner privileges required');
    });

    test('should handle bulk reprocessing', async () => {
      const mockMessages = [
        { messageId: 'bulk1', canReprocess: true, userId: 'user1', fullContent: 'Message 1' },
        { messageId: 'bulk2', canReprocess: true, userId: 'user2', fullContent: 'Message 2' },
      ];

      maliciousUserManager.getDeletedMessagesForWebUI = jest.fn().mockReturnValue(mockMessages);
      maliciousUserManager.reprocessDeletedMessage = jest
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      const result = await maliciousUserManager.bulkReprocessMessages(
        'owner123',
        { status: 'pending_review' },
        { maxCount: 2 }
      );

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
    });

    test('should get reprocessing statistics', () => {
      const mockMessages = [
        { canReprocess: true, reprocessCount: 2, status: 'approved' },
        { canReprocess: true, reprocessCount: 0, status: 'pending_review' },
        { canReprocess: false, reprocessCount: 1, status: 'flagged' },
      ];

      // Mock Array.from to return our test data
      const originalFrom = Array.from;
      Array.from = jest.fn().mockReturnValue(mockMessages);

      const stats = maliciousUserManager.getReprocessingStats('owner123');

      expect(stats.totalMessages).toBe(3);
      expect(stats.reprocessableMessages).toBe(2);
      expect(stats.alreadyReprocessed).toBe(2);
      expect(stats.statusBreakdown).toEqual({
        approved: 1,
        pending_review: 1,
        flagged: 1,
      });

      // Restore original function
      Array.from = originalFrom;
    });
  });

  describe('Administrative Testing Interface', () => {
    const { deletionTestingInterface } = require('../src/utils/deletionTestingInterface');

    beforeEach(() => {
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(true);
    });

    test('should process help command', async () => {
      const result = await deletionTestingInterface.processCommand('owner123', 'help', []);

      expect(result.success).toBe(true);
      expect(result.result.title).toBe('Deletion Testing Administrative Interface');
      expect(result.result.commands).toBeInstanceOf(Array);
      expect(result.result.commands.length).toBeGreaterThan(0);
    });

    test('should process stats command', async () => {
      maliciousUserManager.getReprocessingStats = jest.fn().mockReturnValue({
        totalMessages: 10,
        reprocessableMessages: 8,
        alreadyReprocessed: 3,
      });

      enhancedMessageManager.getStatistics = jest.fn().mockReturnValue({
        totalRelationships: 5,
        userDeletionWindows: 3,
        bulkOperationQueueSize: 0,
      });

      maliciousUserManager.getDeletedMessagesForWebUI = jest.fn().mockReturnValue([
        { status: 'pending_review', channelName: 'general', isRapidDeletion: true },
        { status: 'approved', channelName: 'test', isRapidDeletion: false },
      ]);

      const result = await deletionTestingInterface.processCommand('owner123', 'stats', []);

      expect(result.success).toBe(true);
      expect(result.result.reprocessingStats.totalMessages).toBe(10);
      expect(result.result.enhancedStats.totalRelationships).toBe(5);
      expect(result.result.messageStats.total).toBe(2);
    });

    test('should prevent unauthorized access', async () => {
      maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);

      const result = await deletionTestingInterface.processCommand('unauthorized', 'help', []);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied: Owner privileges required');
      expect(result.isError).toBe(true);
    });

    test('should handle unknown commands', async () => {
      const result = await deletionTestingInterface.processCommand(
        'owner123',
        'unknown_command',
        []
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown command: unknown_command');
      expect(result.isError).toBe(true);
    });
  });
});

// Mock maliciousUserManager if not available in test environment
if (!maliciousUserManager.getUserStats) {
  maliciousUserManager.getUserStats = jest.fn().mockReturnValue({ totalDeletions: 0 });
  maliciousUserManager.isOwner = jest.fn().mockReturnValue(false);
  maliciousUserManager.linkDeletedMessageToBotResponse = jest.fn().mockResolvedValue();
  maliciousUserManager.DETECTION_CONFIG = {
    ENHANCED_MESSAGE_MANAGEMENT: true,
    USE_CONTEXT_EXTRACTION: true,
    RAPID_DELETE_THRESHOLD_MS: 30000,
  };
}
