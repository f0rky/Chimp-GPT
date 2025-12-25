# Performance Audit Report - Chimp-GPT

**Date:** 2025-12-25
**Analyzed Version:** 2.1.0
**Audit Type:** Comprehensive Performance Anti-Pattern Analysis

---

## Executive Summary

This audit identified **23 performance anti-patterns** across the codebase, categorized into:
- **Critical (5):** Memory leaks that will cause issues in long-running sessions
- **High (7):** Blocking operations and inefficient algorithms
- **Medium (8):** Suboptimal patterns that affect responsiveness
- **Low (3):** Minor optimizations

---

## Critical Issues

### 1. Unbounded Cache Growth - Memory Leak

**Files Affected:**
- `src/conversation/messageReferenceResolver.js:34`
- `src/middleware/rateLimiter.js:56`
- `src/middleware/performanceMonitor.js:12-13`
- `src/services/qlstatsScraper.js:20`
- `src/services/qlSyncoreScraper.js:20`

**Issue:** Multiple `Map` objects grow indefinitely without size limits or TTL-based cleanup.

```javascript
// messageReferenceResolver.js:34
const referenceCache = new Map();  // Never cleaned!

// rateLimiter.js:56
const userLimiters = new Map();    // Creates new limiter per user, never removed!

// performanceMonitor.js:12
const timings = {};                // Array per operation grows forever
```

**Impact:**
- Memory usage increases over time
- Eventually leads to OOM crashes in long-running sessions
- Performance degradation as Maps grow

**Recommendation:**
```javascript
// Implement LRU cache with max size
const LRU = require('lru-cache');
const referenceCache = new LRU({ max: 1000, ttl: 1000 * 60 * 30 }); // 30 min TTL

// Or add periodic cleanup
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > maxAge) cache.delete(key);
  }
}, 60 * 60 * 1000);
```

---

### 2. Per-User Rate Limiter Memory Leak

**File:** `src/middleware/rateLimiter.js:67-83`

**Issue:** A new `RateLimiterMemory` instance is created for each unique user and never removed:

```javascript
function getUserLimiter(userId, options = {}) {
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
```

**Impact:** Each user who interacts with the bot creates a permanent memory allocation.

**Recommendation:** Add cleanup for inactive users:
```javascript
// Track last activity
const userLastActivity = new Map();

function getUserLimiter(userId, options = {}) {
  userLastActivity.set(userId, Date.now());
  // ... existing code
}

// Cleanup inactive users every hour
setInterval(() => {
  const inactiveThreshold = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  for (const [userId, lastActive] of userLastActivity.entries()) {
    if (now - lastActive > inactiveThreshold) {
      userLimiters.delete(userId);
      userLastActivity.delete(userId);
    }
  }
}, 60 * 60 * 1000);
```

---

### 3. Performance Monitor Timing Data Accumulation

**File:** `src/middleware/performanceMonitor.js:12-13, 65-75`

**Issue:** Timing data accumulates indefinitely:

```javascript
const timings = {};           // Never pruned
const pendingTimers = {};     // Could leak if stopTimer isn't called

// Line 75: Data pushed forever
timings[operationId].push(timingData);
```

**Impact:**
- Memory grows proportionally to operations performed
- `recentTimings` in stats always includes all data since startup

**Recommendation:**
```javascript
const MAX_TIMINGS_PER_OPERATION = 1000;

// In stopTimer():
if (timings[operationId].length > MAX_TIMINGS_PER_OPERATION) {
  timings[operationId] = timings[operationId].slice(-MAX_TIMINGS_PER_OPERATION);
}
```

---

### 4. Enhanced Message Manager Unbounded Maps

**File:** `src/utils/enhancedMessageManager.js:82-85`

**Issue:** Multiple tracking Maps grow without bounds:

```javascript
this.relationships = new Map();      // messageId -> relationship
this.userDeletionWindows = new Map(); // userId -> deletion timestamps
this.bulkOperationQueue = [];         // Never bounded
```

**Impact:** Long-running bots accumulate relationship data indefinitely.

**Recommendation:** The `cleanupOldRelationships()` method exists but should be called more aggressively and `userDeletionWindows` should also be cleaned.

---

### 5. Malicious User Manager Unbounded Storage

**File:** `src/utils/maliciousUserManager.js:68-71`

**Issue:** In-memory Maps for tracking grow indefinitely:

```javascript
let deletionHistory = new Map();    // userId -> array of deletion timestamps
let rapidDeletions = new Map();     // userId -> array of rapid deletion events
let deletedMessages = new Map();    // messageId -> full deletion record
```

**Impact:** Memory grows proportionally to deleted messages.

---

## High Priority Issues

### 6. Synchronous File Operations (Blocking I/O)

**Files Affected:**
- `src/core/statsStorage.js:709-712` (in `repairStatsFile`)
- `src/core/healthCheck.js:428-429`
- `src/plugins/pluginManager.js:280-281, 298`
- `src/commands/commandHandler.js:118`
- `src/plugins/version/index.js:17`
- `src/core/getBotVersion.js:25, 44`
- `src/commands/modules/toggleImageGen.js:35-55`

**Issue:** Synchronous file operations block the event loop:

```javascript
// statsStorage.js:709
fs.mkdirSync(dataDir, { recursive: true, mode: 0o777 });

// healthCheck.js:428-429
if (fs.existsSync(logFilePath)) {
  const data = fs.readFileSync(logFilePath, 'utf8');
}
```

**Impact:**
- Event loop blocked during file I/O
- Bot becomes unresponsive during file operations
- Increased latency for all concurrent operations

**Recommendation:** Use async alternatives:
```javascript
// Instead of fs.existsSync + fs.readFileSync
const data = await fs.promises.readFile(logFilePath, 'utf8').catch(() => null);

// Instead of fs.mkdirSync
await fs.promises.mkdir(dataDir, { recursive: true });
```

---

### 7. N+1 Query Pattern - Reference Chain Resolution

**File:** `src/conversation/messageReferenceResolver.js:125-148`

**Issue:** Sequential Discord API calls for each message in the reply chain:

```javascript
async function resolveReferenceChain(message, maxDepth = MAX_REFERENCE_DEPTH) {
  while (currentMessage?.reference && depth < maxDepth) {
    const referencedMessage = await resolveReference(currentMessage); // API call
    // ...
    depth++;
  }
}
```

**Impact:**
- O(n) API calls where n = reply chain depth
- Serialized requests increase latency significantly
- Rate limit risk with Discord API

**Recommendation:**
- Cache is already implemented but unbounded (see issue #1)
- Consider batch fetching if Discord API supports it
- Implement request deduplication

---

### 8. Duplicate Weather API Calls

**File:** `src/core/processors/functionCallProcessor.js:174-230`

**Issue:** Weather data is fetched twice - once for raw data, once for formatted response:

```javascript
// Line 177 - First call
const weatherData = await lookupWeather(gptResponse.parameters.location);

// Line 212-216 - Second call (inside getWeatherResponse)
const response = await simplifiedWeather.getWeatherResponse(
  gptResponse.parameters.location,
  userQuestion,
  weatherData // Data passed but may be refetched internally
);
```

**Impact:** Unnecessary API calls, increased latency.

**Recommendation:** Ensure `getWeatherResponse` uses the passed `weatherData` without refetching.

---

### 9. Inefficient Pattern Matching in SimpleChimpGPTFlow

**File:** `src/conversation/flow/SimpleChimpGPTFlow.js:76-133`

**Issue:** 30+ regex patterns tested individually in sequence:

```javascript
const knowledgePatterns = [
  /(?:search|lookup|look\s+up|find)\s+(?:for\s+)?/i,
  /(?:search|lookup|look\s+up|find)\s+(?:for\s+)?/i,
  // ... 25+ more patterns
];

const matchedPattern = knowledgePatterns.find(pattern => pattern.test(content));
```

**Impact:**
- Each message tests up to 30+ regex patterns
- O(patterns * message_length) complexity per message

**Recommendation:** Combine patterns using alternation or use a trie-based matcher:
```javascript
// Combine common patterns
const combinedPattern = /(?:search|lookup|look\s+up|find|give\s+me|show\s+me)/i;
if (combinedPattern.test(content)) {
  // Then check specific sub-patterns
}
```

---

### 10. setInterval Without Cleanup Reference

**Files Affected:**
- `src/core/eventHandlers/clientEventHandler.js:139`
- `src/web/statusServer.js:105`
- `src/core/healthCheck.js:180`
- `src/utils/enhancedDeletionMetrics.js:437`
- `src/web/performanceHistory.js:52`

**Issue:** Many `setInterval` calls don't store the return value, making cleanup impossible:

```javascript
// clientEventHandler.js:139
setInterval(this.updateDiscordStats.bind(this), 30000);  // No reference stored!

// statusServer.js:105
setInterval(() => { /* ... */ });  // No reference stored!
```

**Impact:**
- Intervals continue running even if modules are "unloaded"
- Memory leaks from closures held by timers
- Potential for duplicate intervals

**Recommendation:**
```javascript
class ClientEventHandler {
  constructor() {
    this.intervals = [];
  }

  setupIntervals() {
    this.intervals.push(
      setInterval(this.updateDiscordStats.bind(this), 30000)
    );
  }

  cleanup() {
    this.intervals.forEach(clearInterval);
  }
}
```

---

### 11. Weather Lookup Blocking in Extended Forecast

**File:** `src/services/weatherLookup.js:271-312`

**Issue:** Mock data generation for multiple forecast days uses synchronous loop:

```javascript
for (let i = 1; i < sanitizedDays; i++) {
  const date = new Date();
  date.setDate(date.getDate() + i);
  // ... object creation
  mockData.forecast.forecastday.push({...});
}
```

**Impact:** Minor, but creates unnecessary objects synchronously.

---

### 12. Stats Update Triggers Full Load/Save Cycle

**File:** `src/core/statsStorage.js:547-606`

**Issue:** Every `updateStat()` call loads entire stats file, modifies, then saves:

```javascript
async function updateStat(key, value, increment = false) {
  const stats = await loadStats();  // Full file read
  // ... modify one value
  return await saveStats(stats);    // Full file write
}
```

**Impact:**
- High I/O for frequent stat updates
- Potential race conditions with concurrent updates

**Recommendation:** Implement debounced/batched updates:
```javascript
let pendingUpdates = {};
let saveTimeout = null;

async function updateStat(key, value, increment = false) {
  pendingUpdates[key] = { value, increment };

  if (!saveTimeout) {
    saveTimeout = setTimeout(async () => {
      const stats = await loadStats();
      // Apply all pending updates
      for (const [k, v] of Object.entries(pendingUpdates)) {
        applyUpdate(stats, k, v);
      }
      await saveStats(stats);
      pendingUpdates = {};
      saveTimeout = null;
    }, 1000); // Debounce 1 second
  }
}
```

---

## Medium Priority Issues

### 13. Inefficient Array Operations

**File:** `src/conversation/flow/SimpleChimpGPTFlow.js:726-728`

**Issue:** Slicing array to maintain max length on every message:

```javascript
if (conversation.messages.length > this.options.maxConversationLength) {
  conversation.messages = conversation.messages.slice(-this.options.maxConversationLength);
}
```

**Recommendation:** Use a circular buffer or linked list for O(1) operations.

---

### 14. Repeated Config Imports

**File:** `src/conversation/flow/SimpleChimpGPTFlow.js:223-225`

**Issue:** Config is imported inside function calls:

```javascript
async handleImageGeneration(store, data) {
  const configFile = require('../../core/configValidator');
  const { OpenAI } = require('openai');
  const openaiClient = new OpenAI({ apiKey: configFile.OPENAI_API_KEY });
```

**Impact:** Module resolution on every image generation request.

**Recommendation:** Move imports to module level.

---

### 15. Logging Objects Could Cause OOM

**Files Affected:** Multiple files with verbose logging

**Issue:** Logging large objects without truncation:

```javascript
// Various files
discordLogger.debug({ weatherData, ... }, 'Weather data fetched');
```

**Impact:** Large objects (like full API responses) in logs consume memory.

**Recommendation:** Truncate logged data:
```javascript
const truncate = (obj, maxLen = 500) => {
  const str = JSON.stringify(obj);
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
};
```

---

### 16. Missing Error Boundary in Plugin Execution

**File:** `src/core/eventHandlers/messageEventHandler.js:271-300`

**Issue:** Plugin errors are caught but processing continues without timeout protection.

---

### 17. Context Extraction Cache Without Size Limit

**File:** `src/utils/contextExtractionService.js:80, 526`

```javascript
this.cache = new Map();  // Unbounded
this.cache.set(cacheKey, { timestamp, result });  // Grows forever
```

---

### 18. API Key Manager Without Cleanup

**File:** `src/utils/apiKeyManager.js:45`

```javascript
const keyUsageData = new Map();  // Never cleaned
```

---

### 19. Circuit Breaker Pending Approvals Never Cleaned

**File:** `src/middleware/circuitBreaker.js:5`

```javascript
const pendingApprovals = new Map();  // No TTL or cleanup
```

---

### 20. Message Relationships Map Never Cleaned

**File:** `src/handlers/messageRelationships.js:5`

```javascript
const messageRelationships = new Map();  // Grows indefinitely
```

---

## Low Priority Issues

### 21. String Concatenation in Loops

**Various files:** Using `+=` for string building instead of array join.

### 22. Repeated Regex Compilation

**File:** `src/conversation/flow/SimpleChimpGPTFlow.js`

**Issue:** Regex patterns are defined inside the function, recompiled on each call.

**Recommendation:** Move to module scope as constants.

### 23. Unnecessary Object Spread Operations

**Various files:** Excessive use of `{ ...object }` where direct modification is safe.

---

## Summary Table

| Issue | Severity | File(s) | Type |
|-------|----------|---------|------|
| Unbounded referenceCache | Critical | messageReferenceResolver.js | Memory Leak |
| Per-user rate limiter leak | Critical | rateLimiter.js | Memory Leak |
| Performance monitor accumulation | Critical | performanceMonitor.js | Memory Leak |
| Enhanced message manager Maps | Critical | enhancedMessageManager.js | Memory Leak |
| Malicious user storage | Critical | maliciousUserManager.js | Memory Leak |
| Sync file operations | High | Multiple | Blocking I/O |
| N+1 Discord API calls | High | messageReferenceResolver.js | Algorithm |
| Duplicate weather calls | High | functionCallProcessor.js | Redundant API |
| Inefficient pattern matching | High | SimpleChimpGPTFlow.js | Algorithm |
| setInterval without cleanup | High | Multiple | Resource Leak |
| Stats load/save cycle | High | statsStorage.js | I/O |
| Blocking mock data generation | High | weatherLookup.js | Algorithm |
| Array slice on every message | Medium | SimpleChimpGPTFlow.js | Algorithm |
| Repeated config imports | Medium | SimpleChimpGPTFlow.js | Module Loading |
| Large object logging | Medium | Multiple | Memory |
| Plugin execution timeout | Medium | messageEventHandler.js | Reliability |
| Context cache unbounded | Medium | contextExtractionService.js | Memory |
| API key manager cache | Medium | apiKeyManager.js | Memory |
| Circuit breaker approvals | Medium | circuitBreaker.js | Memory |
| Message relationships Map | Medium | messageRelationships.js | Memory |
| String concatenation | Low | Various | Minor |
| Repeated regex compilation | Low | SimpleChimpGPTFlow.js | Minor |
| Object spread operations | Low | Various | Minor |

---

## Recommended Priority Actions

1. **Immediate (Memory Leaks):**
   - Add LRU caching with TTL to `referenceCache`
   - Implement cleanup for `userLimiters` Map
   - Add max size limits to `timings` storage
   - Clean up `userDeletionWindows` in enhanced message manager

2. **Short-term (Blocking Operations):**
   - Replace all sync file operations with async versions
   - Add proper interval cleanup on shutdown

3. **Medium-term (Algorithm Improvements):**
   - Implement debounced stats updates
   - Combine regex patterns for intent detection
   - Cache weather data properly

4. **Long-term (Architecture):**
   - Consider Redis or similar for shared caching
   - Implement proper resource lifecycle management
   - Add memory usage monitoring and alerts

---

*This audit was generated by Claude Code on 2025-12-25*
