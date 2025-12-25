/**
 * User Location Manager
 *
 * Manages user location preferences and automatic location detection
 * based on their time and weather queries.
 *
 * @module UserLocationManager
 * @version 1.0.0
 */

const { createLogger } = require('../core/logger');
const logger = createLogger('userLocationManager');

/**
 * Store or update a user's location preference
 * @param {Object} store - ConversationStore instance
 * @param {string} userId - Discord user ID
 * @param {string} location - Location string (e.g., "Auckland", "Sydney")
 * @param {string} [timezone] - Optional timezone string
 */
function storeUserLocation(store, userId, location, timezone = null) {
  if (!userId || !location) {
    logger.warn('Cannot store user location: missing userId or location');
    return;
  }

  try {
    const userContext = store.getUserContext(userId);

    // Initialize preferences if they don't exist
    if (!userContext.preferences) {
      userContext.preferences = {};
    }

    // Update location and timezone
    userContext.preferences.location = location;
    if (timezone) {
      userContext.preferences.timezone = timezone;
    }

    // Track when location was last updated
    userContext.preferences.locationUpdatedAt = Date.now();

    // Save the updated context
    store.updateUserContext(userId, userContext);

    logger.info(
      {
        userId,
        location,
        timezone,
      },
      'User location preference stored'
    );
  } catch (error) {
    logger.error({ error, userId, location }, 'Failed to store user location');
  }
}

/**
 * Get a user's stored location preference
 * @param {Object} store - ConversationStore instance
 * @param {string} userId - Discord user ID
 * @returns {Object|null} Object with {location, timezone} or null if not found
 */
function getUserLocation(store, userId) {
  if (!userId) {
    return null;
  }

  try {
    const userContext = store.getUserContext(userId);

    if (userContext && userContext.preferences && userContext.preferences.location) {
      return {
        location: userContext.preferences.location,
        timezone: userContext.preferences.timezone || null,
        updatedAt: userContext.preferences.locationUpdatedAt || null,
      };
    }

    return null;
  } catch (error) {
    logger.error({ error, userId }, 'Failed to get user location');
    return null;
  }
}

/**
 * Extract and normalize location from function call parameters
 * @param {string} locationString - Raw location string from function call
 * @returns {string} Normalized location string
 */
function normalizeLocation(locationString) {
  if (!locationString) return null;

  // Remove common prefixes and clean up
  const cleaned = locationString
    .trim()
    .replace(/^(in |at |for )/i, '')
    .replace(/,\s*[A-Z]{2}$/, ''); // Remove state/country codes like ", NY"

  // Capitalize first letter of each word
  return cleaned.replace(/\b\w/g, char => char.toUpperCase());
}

module.exports = {
  storeUserLocation,
  getUserLocation,
  normalizeLocation,
};
