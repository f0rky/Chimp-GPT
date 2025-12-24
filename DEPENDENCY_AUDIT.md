# Dependency Audit Report

**Project**: Chimp-GPT Discord Bot
**Date**: 2025-12-24
**Audited Version**: 2.1.0

---

## Executive Summary

| Category | Count | Severity |
|----------|-------|----------|
| Security Vulnerabilities | 3 | 1 High, 2 Moderate |
| Outdated Packages | 14 | Various |
| Unused Dependencies | 3 | Bloat |
| Heavy Dependencies | 2 | Performance concern |

---

## 1. Security Vulnerabilities (CRITICAL)

### High Severity

| Package | Vulnerability | Description | Fix |
|---------|--------------|-------------|-----|
| `glob` | [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) | Command injection via -c/--cmd executes matches with shell:true | Update transitive dependency |

### Moderate Severity

| Package | Vulnerability | Description | Fix |
|---------|--------------|-------------|-----|
| `body-parser` | [GHSA-wqch-xfxh-vrr4](https://github.com/advisories/GHSA-wqch-xfxh-vrr4) | DoS when URL encoding is used (CVE score: 5.3) | Update express (transitive dep) |
| `js-yaml` | [GHSA-mh29-5h37-fv8m](https://github.com/advisories/GHSA-mh29-5h37-fv8m) | Prototype pollution in merge | Update transitive dependency |

**Recommended Action**: Run `npm audit fix` to resolve these vulnerabilities.

---

## 2. Outdated Packages

### Major Version Updates Available (Breaking Changes Likely)

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| `openai` | ^4.100.0 | 6.15.0 | **Major upgrade** - API changes expected. v5+ introduced streaming changes. Review migration guide. |
| `dotenv` | ^16.5.0 | 17.2.3 | Major version - likely minimal breaking changes |
| `uuid` | ^11.1.0 | 13.0.0 | Major version - ESM-only in v12+ |
| `rate-limiter-flexible` | ^7.1.0 | 9.0.1 | Major version - API changes possible |
| `pino` | ^9.6.0 | 10.1.0 | Major version - check breaking changes |

### Minor/Patch Updates (Safe to Update)

| Package | Current Pinned | Wanted | Latest |
|---------|----------------|--------|--------|
| `axios` | ^1.9.0 | 1.13.2 | 1.13.2 |
| `discord.js` | ^14.19.3 | 14.25.1 | 14.25.1 |
| `express` | ^5.1.0 | 5.2.1 | 5.2.1 |
| `pino-pretty` | ^13.0.0 | 13.1.3 | 13.1.3 |
| `playwright` | ^1.53.2 | 1.57.0 | 1.57.0 |
| `undici` | ^7.13.0 | 7.16.0 | 7.16.0 |

---

## 3. Unused/Unnecessary Dependencies (BLOAT)

### Production Dependencies to Remove

| Package | Reason | Size Impact |
|---------|--------|-------------|
| `completions` | **Not imported anywhere** in src/. The `openai` package provides all needed functionality. | ~50KB |
| `cors` | **Not imported anywhere** in src/. Only `express` is used in `statusServer.js` without CORS middleware. | ~10KB |
| `undici` | **Not directly imported**. Only used as an override for transitive deps. Consider removing from dependencies and keeping only in overrides. | ~500KB |

### Dev Dependencies Review

| Package | Status | Notes |
|---------|--------|-------|
| `canvas` | Only used in test fixtures | Consider making optional or removing if tests don't require it |
| `@eslint/migrate-config` | One-time migration tool | Safe to remove after ESLint 9 migration is complete |

---

## 4. Heavy Dependencies (Performance Concern)

### Playwright (~200MB installed)

**Usage**: `src/services/qlSyncoreScraper.js` - Used for scraping ql.syncore.org

**Alternatives**:
1. **Keep as-is** if scraping requires JavaScript rendering
2. Consider `puppeteer-core` + local Chrome for smaller footprint
3. If the site has an API, switch to direct HTTP requests with `axios`

### moment-timezone (~4MB)

**Usage**: `src/services/timeLookup.js` - Time zone conversions

**Alternatives**:
1. `date-fns-tz` (~40KB) - Modern, tree-shakeable
2. `luxon` (~70KB) - Lighter than moment
3. Native `Intl.DateTimeFormat` - Zero dependency (limited features)

---

## 5. Recommendations

### Immediate Actions (Priority: High)

```bash
# 1. Fix security vulnerabilities
npm audit fix

# 2. Remove unused dependencies
npm uninstall completions cors

# 3. Update safe minor/patch versions
npm update axios discord.js express pino-pretty playwright undici
```

### Short-term Actions (Priority: Medium)

1. **Move `undici` from dependencies to overrides only**:
   ```json
   {
     "dependencies": {
       // Remove "undici": "^7.13.0"
     },
     "overrides": {
       "undici": "^7.16.0"
     }
   }
   ```

2. **Update dotenv to v17** (test for breaking changes):
   ```bash
   npm install dotenv@17
   ```

3. **Remove migration tooling**:
   ```bash
   npm uninstall @eslint/migrate-config --save-dev
   ```

### Long-term Actions (Priority: Low)

1. **Evaluate openai v6 migration**:
   - Review [OpenAI SDK changelog](https://github.com/openai/openai-node/releases)
   - v5 introduced significant streaming API changes
   - v6 may have additional breaking changes
   - Plan dedicated migration effort

2. **Consider moment-timezone replacement**:
   - `date-fns-tz` offers 90%+ size reduction
   - Would require refactoring `timeLookup.js`

3. **Evaluate playwright alternatives**:
   - Only if scraping requirements are stable
   - Check if target site supports direct API access

---

## 6. Updated package.json (Recommended)

After applying immediate actions:

```json
{
  "dependencies": {
    "axios": "^1.13.2",
    "discord.js": "^14.25.1",
    "dotenv": "^16.6.1",
    "express": "^5.2.1",
    "moment-timezone": "^0.5.48",
    "openai": "^4.104.0",
    "pino": "^9.14.0",
    "pino-pretty": "^13.1.3",
    "playwright": "^1.57.0",
    "playwright-extra": "^4.3.6",
    "playwright-extra-plugin-stealth": "^0.0.1",
    "rate-limiter-flexible": "^7.4.0",
    "uuid": "^11.1.0"
  },
  "overrides": {
    "undici": "^7.16.0"
  }
}
```

**Removed**:
- `completions` (unused)
- `cors` (unused)
- `undici` from dependencies (kept in overrides)

---

## 7. Dependency Count Summary

| Category | Before | After (Recommended) |
|----------|--------|---------------------|
| Production deps | 17 | 14 |
| Dev deps | 16 | 15 |
| Total packages (installed) | 426 | ~400 (estimated) |

---

## Notes

- All security vulnerabilities are in transitive dependencies
- The `undici` override exists to pin a secure version used by `openai` and `discord.js`
- `husky` version 8 is pinned; v9 available but requires configuration migration
