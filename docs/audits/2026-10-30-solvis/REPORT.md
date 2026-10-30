# Solvis audit fixes and latency evaluation

Date: October 30, 2026 (Pacific/Auckland). Host: `salt`, eight logical CPUs.
Deployment: PM2 `chimpGPT-Solvis`, working directory `/home/brett/Chimp-GPT-FES`, port 3007.

## Changes

- Slash commands now enforce `requiresApproval`, acknowledge the interaction before waiting, and execute only after approval. The image toggle accepts an already deferred interaction.
- Slash commands and image buttons check blocked users, allowed guild channels, and user rate limits before execution. Image commands and buttons share a separate three-per-minute image bucket so ordinary traffic cannot override that quota.
- Compose specifies `deploy/Dockerfile`. Runtime status diagnostics now live in `src/utils/statusDiagnostics.js`, removing the status server's dependency on the excluded `tests/` directory. Diagnostic requests have bounded waits. Docker context also excludes deployment backups and environment variants.
- `npm test` discovers the separate regression tests through a bounded runner with dummy credentials and a temporary working directory. The greeting assertion follows the package version. Search-cache housekeeping no longer keeps an idle test process alive. Profile rotation tests use a PNG fixture without requiring native canvas rendering.
- Slash commands and image interactions record aggregate operation timings in the existing performance monitor.

Existing uncommitted work was retained. Only Solvis was restarted; PurgeryPete and Bender retained their original processes. Changes remain uncommitted.

## Validation

- Default test suites: 9/9 pass.
- Discovered regression tests: 39/39 pass, including approval denial/approval, blocked users, channel denial, and shared image quota checks.
- Comprehensive unit suites: 12/12 pass.
- ESLint, formatting checks for changed files, and `git diff --check`: pass.
- Docker image builds. With networking disabled and dummy credentials, the image starts the status server, returns HTTP 200 for health, and denies settings access with HTTP 403. The tests directory is excluded from that image.

## Before and after

The HTTP benchmark uses keep-alive, ten warmup requests, then 100 measured requests for each endpoint/concurrency pair, with 50 ms between batches. Each deployment received 400 measured requests. All returned HTTP 200. Requests originate on the same host; these results exclude a user's network and Discord transport latency.

| HTTP p95, milliseconds | Before | After |
| --- | ---: | ---: |
| `/health`, concurrency 1 | 11.72 | 11.24 |
| `/health`, concurrency 5 | 25.38 | 23.41 |
| `/api`, concurrency 1 | 3.66 | 3.77 |
| `/api`, concurrency 5 | 9.94 | 6.08 |

These are single benchmark runs on a shared live host, separated by a process restart. Some tail latencies decreased, but the experiment does not establish that the code changes caused an improvement. Single-request medians were similar. Process RSS was 156 MB before and 151 MB after; restart and garbage-collection effects prevent attributing that difference to the fixes. One-minute host load was 0.36 before and 0.29 after on eight logical CPUs.

The upstream evaluation sends three identical short chat requests and performs three public Quake server lookups, each immediately repeated against its local cache. It posts no Discord messages and does not generate images. The chat probes use the active conversation model, `gpt-4o-mini`, and return exactly `OK` with 16 total tokens each.

| Upstream median, milliseconds | Before | After |
| --- | ---: | ---: |
| Chat response, 3 samples | 945.40 | 1334.63 |
| Quake lookup, cold cache, 3 samples | 159.91 | 158.73 |
| Quake lookup, warm cache, 3 samples | 0.08 | 0.08 |

All six active-model chat responses were correct. All Quake lookups succeeded. Three samples are too few to infer a stable upstream performance change. Chat calls were slower in the after sample; there is no demonstrated chat speedup.

The existing live message-processing metric contained four completed requests before restart: 1.862, 5.547, 3.547, and 7.123 seconds (average 4.520 seconds). These were uncontrolled, different tasks. The post-restart monitor had no comparable completed-message samples when measured, so an end-to-end Discord task improvement cannot be established. Image generation latency was not evaluated.

## Model issue found and resolved after evaluation

An initial probe of `gpt-4.1-nano`, referenced by the reported-model helper and other legacy paths, returned `model_not_found` on all three requests using the deployment's current key. Solvis's active `SimpleChimpGPTFlow` conversation path uses `gpt-4o-mini` and succeeded. The credentials in the file were confirmed to match PM2 without printing them.

The follow-up fix centralizes the working `gpt-4o-mini` default in `src/services/chatModel.js`. Legacy response generation, function execution, image-prompt enhancement, Quake summaries, conversation flows, diagnostics, and status reporting use that shared default. Explicit function-executor model overrides remain supported. Five offline regressions verify actual request payloads and reporting consistency. A live text completion and forced function call also passed using the shared model; sanitized results are in `model-fix-validation.json`.

The first live text probe returned successfully but missed an exact `OK` assertion at the default temperature. A temperature-zero rerun returned exactly `OK`. Both outcomes are retained in the validation artifact; neither request returned `model_not_found`.

The PR excludes the Quake and greeting feature changes that were already uncommitted before the audit. The latency results and original validation counts describe the running deployment's full working tree at measurement time, including that existing work. The greeting version assertion was corrected locally with that feature's tests; the PR's generic regression discovery will run those tests when the feature is committed.

The isolated PR snapshot separately passed nine default suites, 12 discovered regression tests, 12 comprehensive unit suites, full lint and formatting checks, and the Docker build plus health/auth smoke test.

## Reproduce

```sh
node scripts/benchmarkHost.js 3007 > /tmp/solvis-host.json
npm test
```

The upstream probe ran from the existing deployment checkout with its uncommitted Slipgate service. That deployment-specific script is excluded from this PR. It read the local `.env`, made three small paid chat requests, and fetched public Quake data. Reports contain timings and correctness results, not credentials or conversation content. Raw before/after JSON files accompany this report. The earlier aborted mock-image benchmark was excluded because it did not provide a valid isolated measurement.
