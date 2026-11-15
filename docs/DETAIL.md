# Auto model (切模插件)

Virtual models for DeepSeek Harness. A virtual model is not a real model: every
request sent to it is forwarded to a real provider/model chosen by ordered
switching rules. Model selectors show it under the provider **切模插件**.

## Use cases

- **Peak/off-peak pricing.** Providers price some hours differently. A daily
  time-range rule sends your work to the cheap provider during its discount
  window and back to the stronger model afterwards, without changing the model
  selected in the conversation.
- **Quota exhaustion fallback.** A recent-failure rule on `QUOTA` /
  `ACCOUNT_QUOTA` moves traffic to a second provider after the first one runs
  dry; the fallback model keeps the conversation alive.
- **Provider instability.** When a provider times out or rate-limits even after
  its own automatic retries, the router switches to the backup route instead of
  failing the turn.
- **Task-shaped routing.** Start a conversation with a keyword (`debug`,
  `设计`, `长文`) and the first-message rule chooses a different model for it.
  Image work can be routed to a vision model with the image-attempt rule.
- **External state.** A command rule can read anything a shell command prints
  (`git branch --show-current`, a local flag file, a proxy status endpoint) and
  pick a model from it, with a cache so the probe is cheap on every request.

## How a request is routed

1. The request selects an enabled rule from the top of the list. The first
   match wins; later rules are not evaluated.
2. No match uses the model's **fallback** model, which is required.
3. The router forwards the request with the real route's own adapter, so
   provider replay state, image handling and tool projections behave exactly as
   if the real model had been selected directly.
4. If the real model fails before it emits any content, the router retries it
   according to that provider's own retry policy. Only after those retries are
   exhausted does it re-run rule selection — now with the failure recorded, so a
   "recent failure" rule can take over — and switch. Retries and switches are
   invisible to the agent turn: it sees one answer, or the final failure.
5. A failure that happens *after* content has been shown cannot be retried
   transparently; that failure is reported upward.

## Rules

| Rule | Matches when |
|---|---|
| Daily time range | The request clock is inside the half-open range `[from, to)`; overnight ranges wrap, `from = to` means all day; optionally limited to weekdays and an IANA time zone. |
| Date and time range | The request time is between two exact date-times. |
| First user message contains keyword | The conversation's first user message contains any keyword. |
| Recent user messages contain keyword | Any of the last N user messages contains any keyword. |
| Image attempt | The request carries an image, or the history calls an image-viewing tool (`read_image`, `screenshot`, …; configurable). |
| Command returns a value | A configured shell command's output matches the configured value (`equals`, `contains`, regex, `not-equals`), with a cache TTL. |
| Recent failure | The model currently in use failed within the last N hours with one of the configured failure codes (empty means any), after automatic retries. |

Rules are reordered by dragging them in the configuration page. An incomplete
rule or model is refused by the page instead of being written and silently
dropped. Put a recent-failure rule above always-matching time or keyword rules:
selection stops at the first match, and the failover re-selection uses that same
order.

## Configuration

1. Open **Plugins** → **切模插件** → the `auto-model` row → **Configure**.
2. Add a virtual model: model id (shown as `auto-model/<id>`), display name,
   and a fallback real model.
3. Add rules and pick a real model for each.
4. Save. The model appears in the model selector under **切模插件**.

The **capability reference** model supplies the advertised context window,
output cap, reasoning levels and image support; it defaults to the fallback
model. Point it at a model whose protocol matches your main target when you mix
families.

## Session list hint

When a virtual model answers a conversation, its row's hover card shows a small
line naming the real model currently in use (`切模插件 · Auto → DeepSeek ...`).
It is derived from plugin memory and a Session projection: it is shown only to
the user and never enters the model-visible log. The line clears when the
conversation switches to a real model directly.

## Security

Command rules execute shell commands on the Host with your user's permissions
through `/bin/sh`; they do not run on Windows. Only add commands you would run
yourself.

## Behaviour notes

- The plugin owns retry and switching, so the harness retry policy for its route
  is zero attempts to avoid double retrying.
- A `retryBudgetMs` safety stop (default 90 s) bounds one target's retries; set
  it to `0` to follow the provider policy without a time limit, including
  always-retry providers. A `Retry-After` hint longer than the local ceiling is
  honored when the budget can pay for it, and otherwise the target is abandoned
  without sleeping.
- Routing memory (current target and failure ledger) is per process, so a
  restart empties it: a **recent failure** rule keeps using the fallback until a
  new failure is recorded, and the session-list hint returns on the next request.
- A command probe runs in its own process group, so a timeout or an oversized
  output kills the command and everything it started.
- Subagents and auxiliary model calls that select a virtual model route through
  the same rules.
