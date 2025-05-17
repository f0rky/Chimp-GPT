const moment = require('moment-timezone');
const { time: timeLogger } = require('./logger');
const functionResults = require('./functionResults');
const { sanitizeLocation } = require('./utils/inputSanitizer');

/**
 * Convert a user-friendly location to a timezone string
 * @param {string} location - User-friendly location name
 * @returns {string} - Best matching timezone or null if no match
 */
function getTimezoneFromLocation(location) {
  // Common location to timezone mappings
  const locationMap = {
    // North America
    'new york': 'America/New_York',
    'los angeles': 'America/Los_Angeles',
    chicago: 'America/Chicago',
    washington: 'America/New_York',
    'washington dc': 'America/New_York',
    'washington d.c.': 'America/New_York',
    dc: 'America/New_York',
    boston: 'America/New_York',
    atlanta: 'America/New_York',
    miami: 'America/New_York',
    philadelphia: 'America/New_York',
    houston: 'America/Chicago',
    dallas: 'America/Chicago',
    denver: 'America/Denver',
    phoenix: 'America/Phoenix',
    seattle: 'America/Los_Angeles',
    'san francisco': 'America/Los_Angeles',
    'san diego': 'America/Los_Angeles',
    'las vegas': 'America/Los_Angeles',
    portland: 'America/Los_Angeles',
    honolulu: 'Pacific/Honolulu',
    hawaii: 'Pacific/Honolulu',
    alaska: 'America/Anchorage',
    anchorage: 'America/Anchorage',

    // Europe
    london: 'Europe/London',
    paris: 'Europe/Paris',
    berlin: 'Europe/Berlin',
    moscow: 'Europe/Moscow',
    uk: 'Europe/London',
    england: 'Europe/London',
    france: 'Europe/Paris',
    germany: 'Europe/Berlin',
    italy: 'Europe/Rome',
    spain: 'Europe/Madrid',
    amsterdam: 'Europe/Amsterdam',
    netherlands: 'Europe/Amsterdam',
    brussels: 'Europe/Brussels',
    belgium: 'Europe/Brussels',
    zurich: 'Europe/Zurich',
    switzerland: 'Europe/Zurich',
    vienna: 'Europe/Vienna',
    austria: 'Europe/Vienna',
    dublin: 'Europe/Dublin',
    ireland: 'Europe/Dublin',
    stockholm: 'Europe/Stockholm',
    sweden: 'Europe/Stockholm',
    oslo: 'Europe/Oslo',
    norway: 'Europe/Oslo',
    copenhagen: 'Europe/Copenhagen',
    denmark: 'Europe/Copenhagen',
    helsinki: 'Europe/Helsinki',
    finland: 'Europe/Helsinki',
    athens: 'Europe/Athens',
    greece: 'Europe/Athens',
    ukraine: 'Europe/Kiev',
    kyiv: 'Europe/Kiev',
    kiev: 'Europe/Kiev',

    // Asia & Pacific
    tokyo: 'Asia/Tokyo',
    sydney: 'Australia/Sydney',
    beijing: 'Asia/Shanghai',
    shanghai: 'Asia/Shanghai',
    'hong kong': 'Asia/Hong_Kong',
    singapore: 'Asia/Singapore',
    dubai: 'Asia/Dubai',
    auckland: 'Pacific/Auckland',
    wellington: 'Pacific/Auckland',
    india: 'Asia/Kolkata',
    mumbai: 'Asia/Kolkata',
    delhi: 'Asia/Kolkata',
    australia: 'Australia/Sydney',
    melbourne: 'Australia/Melbourne',
    brisbane: 'Australia/Brisbane',
    perth: 'Australia/Perth',
    adelaide: 'Australia/Adelaide',
    china: 'Asia/Shanghai',
    japan: 'Asia/Tokyo',
    seoul: 'Asia/Seoul',
    korea: 'Asia/Seoul',
    'south korea': 'Asia/Seoul',
    bangkok: 'Asia/Bangkok',
    thailand: 'Asia/Bangkok',
    jakarta: 'Asia/Jakarta',
    indonesia: 'Asia/Jakarta',
    'kuala lumpur': 'Asia/Kuala_Lumpur',
    malaysia: 'Asia/Kuala_Lumpur',
    manila: 'Asia/Manila',
    philippines: 'Asia/Manila',

    // Americas
    canada: 'America/Toronto',
    toronto: 'America/Toronto',
    vancouver: 'America/Vancouver',
    montreal: 'America/Montreal',
    ottawa: 'America/Toronto',
    calgary: 'America/Edmonton',
    edmonton: 'America/Edmonton',
    brazil: 'America/Sao_Paulo',
    mexico: 'America/Mexico_City',
    argentina: 'America/Argentina/Buenos_Aires',
    'buenos aires': 'America/Argentina/Buenos_Aires',
    chile: 'America/Santiago',
    santiago: 'America/Santiago',
    colombia: 'America/Bogota',
    bogota: 'America/Bogota',
    peru: 'America/Lima',
    lima: 'America/Lima',

    // Country codes and common names
    usa: 'America/New_York',
    us: 'America/New_York',
    'united states': 'America/New_York',
    america: 'America/New_York',
    nz: 'Pacific/Auckland',
    'new zealand': 'Pacific/Auckland',
  };

  // Try to match the location to a known timezone
  const normalizedLocation = location.toLowerCase().trim();
  return locationMap[normalizedLocation] || null;
}

/**
 * Find a timezone by partial match in the timezone name
 * @param {string} query - The search query
 * @returns {string|null} - Best matching timezone or null if no match
 */
function findTimezoneByPartialMatch(query) {
  const normalizedQuery = query.toLowerCase().trim();
  const allTimezones = moment.tz.names();

  // Handle multi-word queries (e.g., "Washington DC")
  const words = normalizedQuery.split(/\s+/);

  // Try to find a direct match in the timezone name
  for (const timezone of allTimezones) {
    if (timezone.toLowerCase().includes(normalizedQuery)) {
      return timezone;
    }
  }

  // Try to match by city or region name
  for (const timezone of allTimezones) {
    const parts = timezone.split('/');
    const city = parts[parts.length - 1].replace(/_/g, ' ').toLowerCase();

    // Check if all words in the query are in the city name
    if (words.every(word => city.includes(word))) {
      return timezone;
    }

    // Check if the city contains the query
    if (city.includes(normalizedQuery)) {
      return timezone;
    }
  }

  // If still no match, try matching with just the last word (often the city name)
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    for (const timezone of allTimezones) {
      const parts = timezone.split('/');
      const city = parts[parts.length - 1].replace(/_/g, ' ').toLowerCase();
      if (city.includes(lastWord)) {
        return timezone;
      }
    }
  }

  return null;
}

/**
 * Look up the current time for a location
 * @param {string} location - The location to look up time for
 * @returns {string} - Formatted response with the current time
 */
async function lookupTime(location) {
  // Sanitize the location input
  const sanitizedLocation = sanitizeLocation(location);

  // Log if the location was modified during sanitization
  if (sanitizedLocation !== location) {
    timeLogger.warn(
      { original: location, sanitized: sanitizedLocation },
      'Location was sanitized before time lookup'
    );
  }

  timeLogger.debug({ location: sanitizedLocation }, 'Looking up time for location');
  try {
    // Try to get timezone from our mapping first
    let timezone = getTimezoneFromLocation(sanitizedLocation);

    // If not found in our mapping, try to find a partial match in moment timezones
    if (!timezone) {
      timezone = findTimezoneByPartialMatch(sanitizedLocation);
    }

    // If we still don't have a timezone, return an error
    if (!timezone) {
      timeLogger.warn({ location: sanitizedLocation }, 'Could not find timezone for location');

      // Store the error result for debugging
      const errorMessage = `No matching timezone found for ${sanitizedLocation}`;

      await functionResults.storeResult(
        'time',
        { location },
        {
          error: true,
          errorMessage,
          location,
          formatted: errorMessage,
        }
      );

      return `Sorry, I couldn't find a timezone for "${location}". Please try a more specific location like "New York" or "Tokyo".`;
    }

    // Get the current time in the timezone using moment-timezone
    const now = moment().tz(timezone);
    const formattedTime = now.format('h:mmA');
    const formattedDate = now.format('dddd, MMMM D, YYYY');

    // Format the response
    const response = `The current time in ${sanitizedLocation} (${timezone}) is ${formattedTime} on ${formattedDate}.`;

    // Store the result for debugging
    await functionResults.storeResult(
      'time',
      { location: sanitizedLocation },
      {
        location: sanitizedLocation,
        timezone,
        time: formattedTime,
        date: formattedDate,
        timestamp: now.toISOString(),
        formatted: response,
      }
    );

    timeLogger.info(
      { location, timezone, formattedTime, formattedDate },
      'Time retrieved successfully'
    );
    return response;
  } catch (error) {
    timeLogger.error({ error, location }, 'Error processing time data');

    // Store the error result for debugging
    const errorMessage = error.message || 'Unknown error';
    const formattedError = `Error processing time data for ${location}: ${errorMessage}`;

    await functionResults.storeResult(
      'time',
      { location },
      {
        error: true,
        errorMessage,
        location,
        formatted: formattedError,
      }
    );

    return `Sorry, I encountered an error getting the time for "${location}". Please try a different location.`;
  }
}

module.exports = lookupTime;
