/**
 * @typedef {Object} RateLimitResult
 * @property {boolean} limited - Whether the user is currently rate limited
 * @property {number} remainingPoints - Number of points remaining before hitting limit
 * @property {number} [msBeforeNext] - Milliseconds before next point is available
 * @property {number} [secondsBeforeNext] - Seconds before next point is available
 * @property {string} [message] - User-facing message if limited
 *
 * @typedef {Object} UserLimiterOptions
 * @property {number} [points] - Number of points allowed in the time period
 * @property {number} [duration] - Duration of the time period in seconds
 *
 * @typedef {Object} RateLimiterAPI
 * @property {function(string, number=, UserLimiterOptions=): import('rate-limiter-flexible').RateLimiterMemory} getUserLimiter
 * @property {function(string, number=, UserLimiterOptions=): Promise<RateLimitResult>} checkUserRateLimit
 * @property {function(UserLimiterOptions=): import('rate-limiter-flexible').RateLimiterMemory} createRateLimiter
 */
/**
 * Rate Limiter for ChimpGPT
 *
 * This module provides rate limiting functionality to prevent abuse and manage API usage.
 * It implements per-user rate limiting to ensure fair usage of the bot's resources.
 *
 * The system supports variable costs for different operations, allowing more expensive
 * operations (like API calls) to consume more points than simple operations.
 *
 * @module RateLimiter
 * @author Brett
 * @version 1.0.2
 */

const { RateLimiterMemory } = require('rate-limiter-flexible');
const { createLogger } = require('../core/logger');
const logger = createLogger('ratelimit');

/**
 * Default rate limit settings
 * @constant {number} DEFAULT_POINTS - Number of requests allowed in the time period
 * @constant {number} DEFAULT_DURATION - Time period in seconds
 * @constant {number} COOLDOWN_TIME - Cooldown time in seconds after hitting limit
 * @constant {number} IMAGE_GEN_POINTS - Number of image generations allowed per minute
 * @constant {number} IMAGE_GEN_DURATION - Time period for image generation limit in seconds
 */
const DEFAULT_POINTS = 300; // Number of requests allowed
const DEFAULT_DURATION = 30; // Time period in seconds (30 seconds)
const COOLDOWN_TIME = 1; // Cooldown time in seconds after hitting limit

// Specific rate limit for image generation
const IMAGE_GEN_POINTS = 3; // Allow 3 image generations
const IMAGE_GEN_DURATION = 60; // Per minute

/**
 * Map to store rate limiters for each user
 * @type {Map<string, import('rate-limiter-flexible').RateLimiterMemory>}
 */
const userLimiters = new Map();

/**
 * Get or create a rate limiter for a specific user.
 *
 * Retrieves an existing rate limiter for a user or creates a new one if one doesn't exist. Allows customizing the rate limit parameters per user.
 *
 * @param {string} userId - Discord user ID
 * @param {UserLimiterOptions} [options={}] - Custom options for the rate limiter
 * @returns {import('rate-limiter-flexible').RateLimiterMemory} Rate limiter instance for the user
 */
function getUserLimiter(userId, options = {}) {
  const points = options.points || DEFAULT_POINTS;
  const duration = options.duration || DEFAULT_DURATION;

  if (!userLimiters.has(userId)) {
    userLimiters.set(
      userId,
      new RateLimiterMemory({
        keyPrefix: `user-${userId}`,
        points,
        duration,
      })
    );
  }

  return userLimiters.get(userId);
}

/**
 * Check if a user has exceeded their rate limit.
 *
 * Consumes points from a user's rate limit allocation and determines if they have exceeded their limit. Returns detailed information about the user's current rate limit status, including remaining points and time until reset.
 *
 * @param {string} userId - Discord user ID
 * @param {number} [cost=1] - Cost of the current operation (higher for expensive operations)
 * @param {UserLimiterOptions} [options={}] - Custom options for the rate limiter
 * @returns {Promise<RateLimitResult>} Result object with rate limit information
 */
async function checkUserRateLimit(userId, cost = 1, options = {}) {
  try {
    const limiter = getUserLimiter(userId, options);
    const rateLimitInfo = await limiter.consume(userId, cost);

    logger.debug(
      {
        userId,
        remainingPoints: rateLimitInfo.remainingPoints,
        cost,
      },
      'User rate limit check passed'
    );

    return {
      limited: false,
      remainingPoints: rateLimitInfo.remainingPoints,
      msBeforeNext: rateLimitInfo.msBeforeNext,
    };
  } catch (rateLimitInfo) {
    // User has exceeded their rate limit
    const secondsBeforeNext = Math.ceil(rateLimitInfo.msBeforeNext / 1000) || COOLDOWN_TIME;

    logger.info(
      {
        userId,
        msBeforeNext: rateLimitInfo.msBeforeNext,
        cost,
      },
      'User rate limit exceeded'
    );

    return {
      limited: true,
      remainingPoints: 0,
      msBeforeNext: rateLimitInfo.msBeforeNext,
      secondsBeforeNext,
      message: `You've reached the rate limit. Please wait ${secondsBeforeNext} seconds before trying again.`,
    };
  }
}

/**
 * Create a rate limiter with custom settings.
 *
 * Creates a new rate limiter instance with custom settings. Useful for creating specialized rate limiters for different parts of the application.
 *
 * @param {UserLimiterOptions} [options={}] - Rate limiter options
 * @returns {import('rate-limiter-flexible').RateLimiterMemory} New rate limiter instance
 */
function createRateLimiter(options = {}) {
  const points = options.points || DEFAULT_POINTS;
  const duration = options.duration || DEFAULT_DURATION;

  return new RateLimiterMemory({
    points,
    duration,
  });
}

/**
 * Check if a user has exceeded their image generation rate limit.
 *
 * Specialized function for checking image generation rate limits (3 per minute).
 *
 * @param {string} userId - Discord user ID
 * @returns {Promise<RateLimitResult>} Result object with rate limit information
 */
async function checkImageGenerationRateLimit(userId) {
  return checkUserRateLimit(userId, 1, {
    points: IMAGE_GEN_POINTS,
    duration: IMAGE_GEN_DURATION,
  });
}

/**
 * Rate Limiter API exports.
 *
 * @type {RateLimiterAPI}
 */
module.exports = {
  checkUserRateLimit,
  checkImageGenerationRateLimit,
  createRateLimiter,
  getUserLimiter,
  // Export constants for use in other modules
  constants: {
    DEFAULT_POINTS,
    DEFAULT_DURATION,
    COOLDOWN_TIME,
    IMAGE_GEN_POINTS,
    IMAGE_GEN_DURATION,
  },
};
