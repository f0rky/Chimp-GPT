# Solvis weather provider and cache verification

Date: 2026-10-30. This change replaces the exhausted RapidAPI weather subscription
with Open-Meteo for current conditions and a real five-day forecast. Open-Meteo's
public endpoint requires no key and is intended for non-commercial use. A
commercial deployment needs an appropriate subscription or provider arrangement.

Provider references:

- <https://open-meteo.com/en/docs>
- <https://open-meteo.com/en/docs/geocoding-api>
- <https://open-meteo.com/en/pricing>

## Cause and resulting behavior

Previously, three weather implementations made their own upstream calls, without a
shared response cache. A wrapper/prefetch mismatch could cause the formatter to
request the same data again. Provider failures could return invented current
conditions or generated forecasts. The live RapidAPI probe returned HTTP 403 with
an exhausted monthly quota; this was independent of the chat model migration.

All production weather callers now use `src/services/weatherClient.js` through
`weatherLookup.js`. Formatting consumes prefetched data. A valid combined current
and five-day forecast response is cached for ten minutes; geocoding is cached for
24 hours. Location keys normalize case, whitespace, and comma spacing. Different
names resolving to the same coordinates share forecast data. Concurrent requests
join the same in-flight promise. Callers receive copies so they cannot mutate the
cached entry.

Only validated responses enter the successful-data caches. Checks cover coordinates,
known weather codes, temperature/humidity/wind ranges, units, timezone, valid times,
and five consecutive forecast dates with ordered temperature ranges. Invalid input
makes no HTTP request. Errors use a separate 30-second cooldown; HTTP 429 also
suppresses new upstream requests across locations for 60 seconds. Errors are never
represented as successful weather. Successful cached data remains available during
provider failure. Expired data is not served.

Each cache and the in-flight request map are bounded to 500 entries. Cache state is
in memory and shared within one Node process; a restart clears it. Separate bot
processes do not share the cache. There are no background refreshes or automatic
retries. The weather HTTP transport has an eight-second timeout and uses IPv4 only
for this provider because Solvis's geocoding IPv6 route timed out. Other services'
DNS behavior is unchanged.

Responses retain Open-Meteo and GeoNames attribution, including after chat model
rephrasing. Service failures produce an honest unavailable response.

## Measured verification

See `weather-cache-evaluation.json` for the live run from the exact staged PR
snapshot, using Solvis's configuration without posting Discord messages:

- 20 simultaneous cold lookups: one geocoding request and one forecast request;
  all returned real Auckland weather and five forecast days.
- 25 warm calls across current weather, extended forecast, prefetched formatting,
  direct formatting, and the plugin: zero additional upstream requests.
- One actual Luna weather response: zero additional weather requests, with
  attribution preserved.

Counts come from the shared HTTP request boundary, not packet capture. A source
inspection confirms the production weather paths no longer contain RapidAPI
endpoint calls. This does not claim an audit of unrelated processes on the host.

The isolated PR snapshot passed all nine default test suites and 37 regression
tests, including 15 weather tests. Weather tests cover expiry, concurrent requests,
cache mutation isolation, malformed responses, cooldowns, rate limits, bounded
entries, failed result storage, plugin reuse, and both function processors. Full
lint and formatting checks passed. The broader smoke rerun passed all eight checks
(live health/access controls, conversation, tool selection, weather, time, Quake,
and image-prompt enhancement); see `weather-solvis-smoke.json`. The prior successful
paid image generation is retained separately in that report because its code is
unchanged. Its non-PNG payload was checked for nonempty bytes, not pixel contents.

Reproduce the opt-in live weather smoke test:

```sh
node scripts/smokeWeatherCache.js
# Also issue one paid chat request through the weather conversation flow:
node scripts/smokeWeatherCache.js --include-chat
```

The script prints the report location in a generated temporary directory; command
line input cannot select a file to overwrite. The public weather checks need no credentials. The chat check uses the configured
Solvis model and credentials. The script does not send Discord messages.

These results validate the PR source snapshot. Deployment requires restarting
Solvis after merge; an existing process keeps its previously loaded code. Other
bot processes must remain untouched.
