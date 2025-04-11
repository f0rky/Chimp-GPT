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
 * @version 1.0.0
 */

const { RateLimiterMemory } = require('rate-limiter-flexible');
const { createLogger } = require('./logger');
const logger = createLogger('ratelimit');

/**
 * Default rate limit settings
 * @constant {number} DEFAULT_POINTS - Number of requests allowed in the time period
 * @constant {number} DEFAULT_DURATION - Time period in seconds
 * @constant {number} COOLDOWN_TIME - Cooldown time in seconds after hitting limit
 */
const DEFAULT_POINTS = 20;      // Number of requests allowed
const DEFAULT_DURATION = 60;   // Time period in seconds
const COOLDOWN_TIME = 15;      // Cooldown time in seconds after hitting limit

/**
 * Map to store rate limiters for each user
 * @type {Map<string, import('rate-limiter-flexible').RateLimiterMemory>}
 */
const userLimiters = new Map();

/**
 * Get or create a rate limiter for a specific user
 * 
 * This function retrieves an existing rate limiter for a user or creates a new one
 * if one doesn't exist. It allows customizing the rate limit parameters per user.
 * 
 * @param {string} userId - Discord user ID
 * @param {Object} options - Custom options for the rate limiter
 * @param {number} [options.points=DEFAULT_POINTS] - Number of points allowed in the time period
 * @param {number} [options.duration=DEFAULT_DURATION] - Duration of the time period in seconds
 * @returns {import('rate-limiter-flexible').RateLimiterMemory} - Rate limiter instance for the user
 */
function getUserLimiter(userId, options = {}) {
  const points = options.points || DEFAULT_POINTS;
  const duration = options.duration || DEFAULT_DURATION;
  
  if (!userLimiters.has(userId)) {
    userLimiters.set(userId, new RateLimiterMemory({
      keyPrefix: `user-${userId}`,
      points,
      duration,
    }));
  }
  
  return userLimiters.get(userId);
}

/**
 * Check if a user has exceeded their rate limit
 * 
 * This function consumes points from a user's rate limit allocation and determines
 * if they have exceeded their limit. It returns detailed information about the
 * user's current rate limit status, including remaining points and time until reset.
 * 
 * @param {string} userId - Discord user ID
 * @param {number} [cost=1] - Cost of the current operation (higher for expensive operations)
 * @param {Object} [options={}] - Custom options for the rate limiter
 * @param {number} [options.points] - Custom points limit for this check
 * @param {number} [options.duration] - Custom duration for this check
 * @returns {Promise<Object>} Result object with rate limit information
 * @returns {Promise<Object>} result
 * @returns {boolean} result.limited - Whether the user is currently rate limited
 * @returns {number} result.remainingPoints - Number of points remaining before hitting limit
 * @returns {number} [result.msBeforeNext] - Milliseconds before next point is available
 * @returns {number} [result.secondsBeforeNext] - Seconds before next point is available
 */
async function checkUserRateLimit(userId, cost = 1, options = {}) {
  try {
    const limiter = getUserLimiter(userId, options);
    const rateLimitInfo = await limiter.consume(userId, cost);
    
    logger.debug({
      userId,
      remainingPoints: rateLimitInfo.remainingPoints,
      cost
    }, 'User rate limit check passed');
    
    return {
      limited: false,
      remainingPoints: rateLimitInfo.remainingPoints,
      msBeforeNext: rateLimitInfo.msBeforeNext
    };
  } catch (rateLimitInfo) {
    // User has exceeded their rate limit
    const secondsBeforeNext = Math.ceil(rateLimitInfo.msBeforeNext / 1000) || COOLDOWN_TIME;
    
    logger.info({
      userId,
      msBeforeNext: rateLimitInfo.msBeforeNext,
      cost
    }, 'User rate limit exceeded');
    
    return {
      limited: true,
      remainingPoints: 0,
      msBeforeNext: rateLimitInfo.msBeforeNext,
      secondsBeforeNext,
      message: `You've reached the rate limit. Please wait ${secondsBeforeNext} seconds before trying again.`
    };
  }
}

/**
 * Create a rate limiter with custom settings
 * 
 * This function creates a new rate limiter instance with custom settings.
 * It's useful for creating specialized rate limiters for different parts of the application.
 * 
 * @param {Object} [options={}] - Rate limiter options
 * @param {string} [options.keyPrefix='global'] - Prefix for rate limiter keys
 * @param {number} [options.points=DEFAULT_POINTS] - Number of points allowed in the time period
 * @param {number} [options.duration=DEFAULT_DURATION] - Duration of the time period in seconds
 * @returns {import('rate-limiter-flexible').RateLimiterMemory} - New rate limiter instance
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
 * Rate limiter module exports
 * @exports RateLimiter
 */
module.exports = {
  checkUserRateLimit,
  createRateLimiter,
  getUserLimiter
};
