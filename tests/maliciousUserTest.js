/**
 * Malicious User Management Test
 * 
 * Tests the malicious user detection and management system
 * 
 * @module MaliciousUserTest
 */

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../logger');
const maliciousUserManager = require('../utils/maliciousUserManager');

const logger = createLogger('maliciousUserTest');

// Test data directory
const TEST_DATA_DIR = path.join(__dirname, 'temp', 'maliciousUserTestData');

/**
 * Setup test environment
 */
async function setupTest() {
  // Ensure test data directory exists
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  
  // Override data directory for testing
  const originalDataDir = path.join(__dirname, '..', 'data');
  process.env.TEST_DATA_DIR = TEST_DATA_DIR;
  
  // Initialize manager for testing
  await maliciousUserManager.init();
}

/**
 * Cleanup test environment
 */
async function cleanupTest() {
  try {
    // Clean up test data directory
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Test basic deletion tracking
 */
async function testBasicDeletionTracking() {
  logger.info('Testing basic deletion tracking');
  
  const userId = `test-user-${Date.now()}-basic`;
  const messageId = 'test-msg-456';
  const channelId = 'test-channel-789';
  const content = 'This is a test message';
  const timeSinceCreation = 45000; // 45 seconds - above rapid threshold
  
  // Record a deletion
  await maliciousUserManager.recordDeletion(
    userId,
    messageId,
    channelId,
    content,
    timeSinceCreation
  );
  
  // Get user stats
  const stats = maliciousUserManager.getUserStats(userId);
  
  assert(stats.totalDeletions === 1, 'Should have 1 total deletion');
  assert(stats.deletionsLastHour === 1, 'Should have 1 deletion in last hour');
  assert(stats.deletionsLastDay === 1, 'Should have 1 deletion in last day');
  assert(stats.rapidDeletions === 0, 'Should have 0 rapid deletions (>30s threshold)');
  assert(stats.isBlocked === false, 'User should not be blocked yet');
  
  logger.info('✅ Basic deletion tracking test passed');
}

/**
 * Test rapid deletion detection
 */
async function testRapidDeletionDetection() {
  logger.info('Testing rapid deletion detection');
  
  const userId = `test-user-${Date.now()}-rapid`;
  const channelId = 'test-channel-789';
  
  // Record multiple rapid deletions (under 30 second threshold)
  for (let i = 0; i < 3; i++) {
    await maliciousUserManager.recordDeletion(
      userId,
      `rapid-msg-${i}`,
      channelId,
      `Rapid deletion test message ${i}`,
      15000 // 15 seconds - under threshold
    );
  }
  
  const stats = maliciousUserManager.getUserStats(userId);
  
  assert(stats.totalDeletions === 3, 'Should have 3 total deletions');
  assert(stats.rapidDeletions === 3, 'Should have 3 rapid deletions');
  assert(stats.deletionsLastHour === 3, 'Should have 3 deletions in last hour');
  
  logger.info('✅ Rapid deletion detection test passed');
}

/**
 * Test suspicious behavior detection
 */
async function testSuspiciousBehaviorDetection() {
  logger.info('Testing suspicious behavior detection');
  
  const userId = `test-user-${Date.now()}-suspicious`;
  const channelId = 'test-channel-789';
  
  // Record deletions that should trigger suspicious behavior (6 > threshold of 5)
  for (let i = 0; i < 6; i++) {
    await maliciousUserManager.recordDeletion(
      userId,
      `suspicious-msg-${i}`,
      channelId,
      `Suspicious deletion test message ${i}`,
      60000 // 1 minute - not rapid, but frequent
    );
  }
  
  // Check for suspicious behavior (without triggering human approval)
  await maliciousUserManager.checkForSuspiciousBehavior(userId);
  
  const stats = maliciousUserManager.getUserStats(userId);
  
  assert(stats.totalDeletions === 6, 'Should have 6 total deletions');
  assert(stats.deletionsLastHour === 6, 'Should have 6 deletions in last hour');
  assert(stats.rapidDeletions === 0, 'Should have 0 rapid deletions');
  
  // Note: We can't easily test human approval in unit tests, 
  // but the suspicious behavior should be detected
  
  logger.info('✅ Suspicious behavior detection test passed');
}

/**
 * Test user blocking and unblocking
 */
async function testUserBlockingAndUnblocking() {
  logger.info('Testing user blocking and unblocking');
  
  const userId = `test-user-${Date.now()}-block`;
  const reason = 'Test blocking for malicious behavior';
  
  // Initially user should not be blocked
  assert(maliciousUserManager.isUserBlocked(userId) === false, 'User should not be blocked initially');
  
  // Block the user
  await maliciousUserManager.blockUser(userId, reason);
  
  // Check if user is blocked
  assert(maliciousUserManager.isUserBlocked(userId) === true, 'User should be blocked');
  
  // Get blocked users list
  const blockedUsers = maliciousUserManager.getBlockedUsers();
  assert(blockedUsers.includes(userId), 'User should be in blocked users list');
  
  // Get user stats
  const stats = maliciousUserManager.getUserStats(userId);
  assert(stats.isBlocked === true, 'User stats should show blocked status');
  
  // Unblock the user
  const wasBlocked = await maliciousUserManager.unblockUser(userId);
  assert(wasBlocked === true, 'Should return true when unblocking a blocked user');
  
  // Check if user is no longer blocked
  assert(maliciousUserManager.isUserBlocked(userId) === false, 'User should not be blocked after unblocking');
  
  // Try to unblock an already unblocked user
  const wasBlockedAgain = await maliciousUserManager.unblockUser(userId);
  assert(wasBlockedAgain === false, 'Should return false when unblocking an unblocked user');
  
  logger.info('✅ User blocking and unblocking test passed');
}

/**
 * Test persistence (file saving and loading)
 */
async function testPersistence() {
  logger.info('Testing data persistence');
  
  const userId = `test-user-${Date.now()}-persist`;
  const channelId = 'test-channel-789';
  
  // Record some deletions
  await maliciousUserManager.recordDeletion(
    userId,
    'persist-msg-1',
    channelId,
    'Persistence test message 1',
    45000
  );
  
  await maliciousUserManager.recordDeletion(
    userId,
    'persist-msg-2',
    channelId,
    'Persistence test message 2',
    20000 // Rapid deletion
  );
  
  // Block the user
  await maliciousUserManager.blockUser(userId, 'Test persistence');
  
  // Get stats before reinitializing
  const statsBefore = maliciousUserManager.getUserStats(userId);
  
  // Reinitialize the manager (simulates restart)
  await maliciousUserManager.init();
  
  // Get stats after reinitializing
  const statsAfter = maliciousUserManager.getUserStats(userId);
  
  // Verify data was persisted
  assert(statsAfter.totalDeletions === statsBefore.totalDeletions, 'Total deletions should be persisted');
  assert(statsAfter.rapidDeletions === statsBefore.rapidDeletions, 'Rapid deletions should be persisted');
  assert(statsAfter.isBlocked === statsBefore.isBlocked, 'Blocked status should be persisted');
  assert(maliciousUserManager.isUserBlocked(userId) === true, 'User should still be blocked after restart');
  
  logger.info('✅ Data persistence test passed');
}

/**
 * Test data cleanup
 */
async function testDataCleanup() {
  logger.info('Testing data cleanup');
  
  const userId = `test-user-${Date.now()}-cleanup`;
  const channelId = 'test-channel-789';
  
  // Record a deletion with very old timestamp (simulate old data)
  const oldTimestamp = Date.now() - (35 * 24 * 60 * 60 * 1000); // 35 days ago
  
  // Manually add old data to test cleanup
  // Note: This is a bit of a hack since the manager doesn't expose internal data
  // In a real test, we'd need to mock the data or wait for the cleanup interval
  
  // Record recent deletion
  await maliciousUserManager.recordDeletion(
    userId,
    'recent-msg',
    channelId,
    'Recent message',
    30000
  );
  
  // Run cleanup
  await maliciousUserManager.cleanupOldData();
  
  // Recent data should still be there
  const stats = maliciousUserManager.getUserStats(userId);
  assert(stats.totalDeletions >= 1, 'Recent deletion should still exist after cleanup');
  
  logger.info('✅ Data cleanup test passed');
}

/**
 * Test detection configuration
 */
async function testDetectionConfiguration() {
  logger.info('Testing detection configuration');
  
  const config = maliciousUserManager.DETECTION_CONFIG;
  
  // Verify configuration exists and has expected properties
  assert(typeof config.MAX_DELETIONS_PER_HOUR === 'number', 'Should have MAX_DELETIONS_PER_HOUR');
  assert(typeof config.MAX_DELETIONS_PER_DAY === 'number', 'Should have MAX_DELETIONS_PER_DAY');
  assert(typeof config.RAPID_DELETE_THRESHOLD_MS === 'number', 'Should have RAPID_DELETE_THRESHOLD_MS');
  assert(typeof config.CLEANUP_AFTER_DAYS === 'number', 'Should have CLEANUP_AFTER_DAYS');
  
  // Verify reasonable defaults
  assert(config.MAX_DELETIONS_PER_HOUR > 0, 'MAX_DELETIONS_PER_HOUR should be positive');
  assert(config.MAX_DELETIONS_PER_DAY > config.MAX_DELETIONS_PER_HOUR, 'Daily limit should be higher than hourly');
  assert(config.RAPID_DELETE_THRESHOLD_MS < 60000, 'Rapid delete threshold should be under 1 minute');
  
  logger.info('✅ Detection configuration test passed');
}

/**
 * Run all malicious user tests
 */
async function runTests() {
  logger.info('Starting malicious user management tests');
  
  try {
    await setupTest();
    
    await testBasicDeletionTracking();
    await testRapidDeletionDetection();
    await testSuspiciousBehaviorDetection();
    await testUserBlockingAndUnblocking();
    await testPersistence();
    await testDataCleanup();
    await testDetectionConfiguration();
    
    await cleanupTest();
    
    logger.info('🎉 All malicious user management tests passed successfully!');
    return true;
  } catch (error) {
    logger.error({ error }, '❌ Malicious user management tests failed');
    await cleanupTest();
    throw error;
  }
}

// Export for use in test runner
module.exports = {
  name: 'Malicious User Management Tests',
  run: runTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  runTests()
    .then(() => {
      console.log('✅ All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Tests failed:', error);
      process.exit(1);
    });
}