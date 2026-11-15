# dsh-auto-model · 切模插件

[English](README.md) | [中文](README.zh.md)

Virtual models for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). A virtual model is not a real model — it is a named route that forwards every request to a real provider/model chosen by ordered **switching rules**. Selectors list it under the provider **切模插件** (`auto-model`).

```
conversation → auto-model / auto → rule matched → deepseek / deepseek-v4-pro
                                 ↘ no match    → fallback: kimi / kimi-k2
```

## Why

- **Peak / off-peak pricing.** Providers discount different hours. A daily time-range rule routes work to the cheap provider during its window and back to the strong model afterwards, with no change to the model selected in the conversation.
- **Quota exhaustion.** A recent-failure rule on `QUOTA` / `ACCOUNT_QUOTA` moves traffic to a second provider once the first runs dry, so a turn finishes instead of failing.
- **Provider instability.** When a provider keeps timing out or rate-limiting *after its own automatic retries*, the router switches to the backup route instead of failing the turn.
- **Task-shaped routing.** Route by keyword (`debug`, `设计`, `长文`) in the first or the most recent user messages, or send image work to a vision model automatically.
- **External state.** A command rule can read anything a shell command prints (`git branch --show-current`, a flag file, a proxy status) and choose a model from it, with a cache TTL so the probe is cheap.

## Features

- Several virtual models, each with its own ordered rule list and required fallback model.
- Seven rule kinds: daily time range, date-and-time range, first-message keyword, recent-message keyword, image attempt, command value, recent failure.
- Drag-and-drop priority; the first matching rule wins.
- Transparent recovery: a failed target is retried by **the real model's own retry policy**, then switched. The agent turn sees one answer, or the final failure.
- Requests are forwarded at the LLM stream boundary, so the real route keeps its adapter, replay state, image handling and tool projections.
- A user-only hint in the session list's hover card names the real model currently answering. It is never model-visible.
- Configuration page inside **Plugins**, with model pickers fed by the live model catalog and a manual provider/model escape hatch.

## Install

The plugin is a DSH bundle. Install the directory:

```sh
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-auto-model
```

Or use **Plugins → Add plugin → local directory**.
Install straight from GitHub instead of a local checkout:

```sh
dsh plugin --profile <your-profile> add github:universe-st/dsh-auto-model
```

Restart DSH when the bundle list changes, then enable **切模插件** in **Plugins**.

Requirements: DSH `0.2.x` with the `llm` and `sessionProjections` services (both are part of the standard deployment).

## Configure

1. **Plugins → 切模插件 → the `auto-model` row → Configure**.
2. **Add virtual model**: choose a model id (shown as `auto-model/<id>`), a display name, and a fallback real model.
3. Add rules; each rule picks the real model to use when it matches.
4. Save. The model appears in the composer's model selector under **切模插件**.

The optional **capability reference** model supplies the advertised context window, output cap, reasoning levels and image support (defaults to the fallback model). Point it at a model whose protocol matches your main target when mixing provider families.

### Rules

| Rule | Matches when |
|---|---|
| Daily time range | The request clock is inside `from`–`to`; overnight ranges wrap; optional weekdays and IANA time zone. |
| Date and time range | The request time lies between two exact date-times. |
| First user message contains keyword | The conversation's first user message contains any keyword. |
| Recent user messages contain keyword | Any of the last N user messages contains any keyword. |
| Image attempt | The request carries an image, or the history calls an image-viewing tool (`read_image`, `screenshot`, …; configurable). |
| Command returns a value | A configured shell command's output matches the configured value (`equals`, `contains`, regex, `not-equals`) with a cache TTL. |
| Recent failure | The model currently in use failed within the last N hours with one of the configured codes (empty = any), after automatic retries. |

Place a **recent failure** rule above time or keyword rules. Selection stops at the first match, so an always-matching time rule above it would keep choosing the failed model; the configured fallback would then be the only remaining failover.

## Retry and failover semantics

- The plugin performs retries inside the request using the real provider's own resolved retry policy and backoff, including provider `Retry-After` hints.
- Nothing reaches the agent turn until the attempt produces visible content, so retries and switches are invisible.
- After a target's retries are exhausted, rule selection runs again with the failure recorded — a **recent failure** rule can now take over. The configured fallback is the last resort.
- A failure that happens after visible content cannot be retried without duplicating output; it is reported as the stream's failure.
- `retryBudgetMs` (default 90 s) bounds one target's retries; `0` removes the time bound. `maxSwitches` bounds switches per request.

## Session list hint

The hover card of a session row shows a small line with the real model currently answering a virtual model. It comes from plugin memory mirrored into a Session projection; it is user-visible only and never written to the model-visible log. It clears when the conversation switches to a real model directly.

## Security

Command rules run shell commands on the Host with your user's permissions. Only configure commands you would run yourself. They require a POSIX shell (`/bin/sh`), so they do not run on Windows.

## Development

```sh
node --test "test/*.test.js"
```

The rule engine, request router and configuration normalization are plain modules with no DSH dependency, so they run under plain Node; the bundle itself is loaded by DSH.

## License

[MIT](LICENSE)
