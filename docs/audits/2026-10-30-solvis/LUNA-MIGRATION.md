# Solvis Luna migration and evaluation

Date: October 30, 2026 (Pacific/Auckland). Host: `salt`.

The shared chat default changes from `gpt-4o-mini` to `gpt-6-luna`. All application chat callers, diagnostics, and status reporting use the shared configuration. The request builder explicitly disables reasoning for Luna and translates existing `max_tokens` limits into `max_completion_tokens`; temperature, tool schemas, conversation history, and output budgets are preserved. Explicit function-executor model overrides retain their existing parameters. Image generation itself keeps its existing image model.

Official documentation was fetched before implementation:

- [Luna model requirements and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-6 migration requirements](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart)
- [4o-mini baseline pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini)

Luna supports function calling through Chat Completions with `reasoning_effort: "none"`. That mode also permits the temperature setting used by the application. No SDK upgrade or endpoint migration was necessary. Both a short text request and a forced `lookupTime` function call succeeded with Solvis's key before migration.

## Live comparison

`scripts/evaluateChatModels.js` made 48 measured requests: eight synthetic task categories, three repetitions, and two models. It alternated model order within sequential request pairs, rotated category order between rounds, disabled SDK retries, and used a 20-second timeout. One short warmup request per model was excluded. Both models used temperature 0.7 and matching task-specific output limits; Luna additionally used reasoning effort `none`.

Categories covered conversation context, automatic time-tool selection, automatic image-tool selection, weather rephrasing, time rephrasing, Quake summaries, image-prompt enhancement, and synthesis from supplied search snippets. Tools were selected but never executed. The evaluation sent no Discord messages, generated no images, and used no real conversations. It used the host's existing dedicated OpenAI transport and local key without recording credentials.

| Measured result | GPT-4o mini | GPT-6 Luna |
| --- | ---: | ---: |
| Successful API responses | 24/24 | 24/24 |
| Automated contract checks | 23/24 | 24/24 |
| Median completion latency | 1,027.55 ms | 1,344.52 ms |
| p95 completion latency, nearest rank | 1,630.47 ms | 2,402.09 ms |
| Input tokens | 1,965 | 2,712 |
| Output tokens | 1,309 | 973 |
| Reasoning tokens | 0 | 0 |
| Estimated measured text cost, USD | $0.00108015 | $0.00075770 |

For these requests, Luna's estimated text cost was **29.85% lower**, while median completion time was **30.85% higher** and p95 was **47.33% higher**. This sample supports lower cost, not a latency improvement. The small absolute costs reflect short synthetic requests, not a monthly spending forecast. Tokenization and response lengths differed even though the tasks were matched.

Cost estimates use actual reported token usage and published Standard rates in USD per million tokens: 4o-mini input $0.15, cached input $0.075, output $0.60; Luna input $0.10, cached input $0.01, cache writes $0.125, output $0.50. No cached input, cache writes, or reasoning tokens were reported in the measured requests. The figures exclude warmups, initial access probes, and any downstream tool costs.

The baseline's one automated miss was a literal-word check: its image prompt used “moonlight” and “nocturnal” rather than the required word “night”. Manual review found that it preserved the nighttime setting. The original failed assertion is retained; it does not establish a quality advantage for Luna. The checks cover selected facts, parseable expected tool arguments, nonempty output, finish reason, and prompt length. They do not score conversational style, all instructions, adversarial inputs, or full real-world quality. For example, Luna's Quake summaries preserved the checked facts but used two sentences despite the request for three to four.

These measurements isolate API completion time. They do not include Discord transport, actual tool execution, image generation, or full application routing. With only three samples per category and a shared live host, the p95 and relative latency are descriptive, not stable service-level estimates. They should not be compared directly with the earlier single-word probes in `REPORT.md`.

## Verification and rollout

Eight targeted regressions check the Luna payloads, legacy reporting consistency, tool availability, output budgets for chat/weather/time, image-prompt enhancement, function-result responses, and explicit model overrides. The complete staged PR snapshot was checked separately from the existing uncommitted Quake and greeting changes: all nine default test suites and 22 regression tests passed, along with full lint, formatting, and diff checks.

The migration is delivered through PR #30. PM2 has not been restarted for this migration, and the other bot processes are untouched. This report does not claim that the running Discord bot has already switched models.

Reproduce the opt-in paid comparison:

```sh
node scripts/evaluateChatModels.js /tmp/solvis-luna-evaluation.json 3
```

The adjacent `luna-evaluation.json` retains synthetic outputs, usage, correctness results, and timings for inspection. The earlier benchmark artifacts remain unchanged.
