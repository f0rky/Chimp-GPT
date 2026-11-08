# Personal conversation behavior

This page describes the Option A personal-chat implementation. It does **not** add shared group memory, durable transcripts, or automatic reply-chain fetching.

## Scope and eligibility

History belongs to one bot process, guild, channel/thread, and user. Different users in the same channel do not share transcripts. Your history in one channel/thread is not reused in another; a thread does not inherit parent-channel history.

Natural-language DMs remain ignored. Existing bot-author, channel allowlist, ignore-prefix, malicious-user and rate-limit checks still apply. A thread must independently satisfy the channel eligibility rules. Slash commands use a separate interaction route.

Replying to a Discord message does not automatically fetch its target or older reply chain. A recent target may already occur in your personal history, but reply-chain retrieval is not promised.

## Continuity and bounds

Successful normal chat and specialist results (time, weather, Quake, knowledge/search when enabled, and image work) are recorded through the same scoped transcript commit. Time/weather model formatting and knowledge processing receive preceding scoped context. Deterministic service lookups still use their own argument parsers; this change does not guarantee that every ambiguous location/tool follow-up is inferred correctly.

Only completed successful user/assistant pairs are saved. Failed requests do not append partial turns. The default history limit is **10 records: five complete user/assistant pairs**. An odd configured record limit rounds down to a complete pair, with at least one pair retained. Each saved record is capped at 4,000 characters. These are storage bounds, not a model input-token guarantee; response token settings control output generation separately.

Specialist responses are retained as bounded text excerpts, not full external payload objects. Images retain only a short prompt-based outcome summary: generated image buffers, attachment metadata, and image result URLs are not replayed as context. Saved history must never automatically repeat or retry a billable operation. It does not imply pixel-level understanding of a previous image.

Processing and reset operations are ordered per personal scope inside the flow. While a channel has a turn in flight, an ordinary message is **queued in arrival order** instead of being dropped. The queue is per channel, holds at most **3 waiting messages**, and is never shared with a DM. A queued message gets a ⏳ reaction; when the queue is full the sender gets a reply saying the message was not queued. Each queued message is dispatched once, in order, and re-runs the malicious-user, rate-limit and owner checks at dispatch time. A failed turn releases the channel and the queue continues. Bot, DM and ignore-prefix messages are not queued. The queue is in memory only and is not persisted across restarts.

This is not shared multi-person memory: queued messages are answered with the same per-person scope as before. Queueing does not fetch reply chains or retain transcripts beyond the existing bounded history.

## Reset

`!clear` and its `!reset` alias clear only **your history in the current channel/thread**, in the active chat flow. They do not clear another person's history or your other channels. The command distinguishes a removed transcript, no existing transcript, and a reset failure.

If a request is already being processed in your scope, reset waits behind it and then clears it. Later admitted requests start after that reset. Any of your own messages still waiting in the channel queue when you run `!clear` are discarded rather than answered after the reset; other people's queued messages are kept. The legacy `--force` argument does not reload files or expand the reset scope.

The `/clear` interaction adapter uses the same operation and acknowledges before waiting. It becomes visible only after the project's slash-command registration has been refreshed for the intended bot; do not assume that deploying source alone registers it. Use `!clear` for the initial Solvis test unless `/clear` is already available.

## Lifetime

History is **process-memory-only**. Restarting the bot starts empty; durable storage and restoration are out of scope. The flow has an explicit cleanup method, but this change does not claim a scheduled 24-hour retention guarantee.

## Safe Solvis test

1. In an allowed channel, tell Solvis a distinctive harmless fact, then ask it to repeat the fact.
2. Request the time in a named city, wait for the answer, then ask what city/time you just discussed.
3. Run `!clear`, then ask about the harmless fact. It should not recall it from saved personal history.
4. If another allowed channel is available, verify it does not inherit the first channel's fact.
5. Another person should have separate personal history. Shared group memory is not part of Option A.

No image generation is needed to validate this repair. Report exact message sequence and whether Solvis had finished responding; do not share tokens, `.env`, or private conversation logs.
