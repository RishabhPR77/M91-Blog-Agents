# Setting up the two viaSocket webhook flows

The engine never talks to Slack or M91 directly. It POSTs JSON to two viaSocket **webhook flows**
that you build once in the viaSocket UI. Both flows check a shared key first, so a leaked URL alone
cannot post anything.

| Flow | Engine env key holding its URL | Body the engine sends |
| --- | --- | --- |
| `blog-slack-post` | `SLACK_POST_WEBHOOK_URL` | `{ "key": "<shared key>", "text": "…" }` |
| `blog-m91-alert` | `M91_ALERT_WEBHOOK_URL` | `{ "key": "<shared key>", "title": "…", "description": "…", "severity": "LOW" }` |

The shared key is `WEBHOOK_SHARED_KEY` in your `.env`. You paste the same value into each flow
yourself; it never goes into this repo.

**Why an IF block, not a "stop" step:** in viaSocket, a step that throws or returns early does
**not** stop the run; the next step still runs (automations.md, read 2026-10-17). So the key check
is an **IF** block: the send step sits *inside* the IF, and the ELSE branch is **Break**.

**What the engine reads back:** the webhook caller gets the last step's return value with HTTP 200,
even when a step failed. The engine treats a body containing `error` or `ok: false` as a failure.

Severity used by the engine: **LOW** = a post failed all its retries; **MEDIUM** = the pipeline
crashed. (`HIGH` and `CRITICAL` are allowed but not used yet.)

---

## Flow 1: `blog-slack-post`

1. **Create the flow.** viaSocket → your project → **New flow** → name it `blog-slack-post`.
2. **Trigger: Webhook.** Copy the webhook URL it shows (`https://flow.sokt.io/func/…`) into `.env`
   as `SLACK_POST_WEBHOOK_URL`. Treat this URL like a password.
3. **IF block.** Add an **IF** (condition) step:
   - condition: the trigger's `body.key` **equals** your shared key (paste the key as the comparison
     value; the same value as `WEBHOOK_SHARED_KEY` in `.env`).
   - **Inside the IF** (true branch): Slack → **Send Message**
     - channel: `#m91-blog` (pick it from the channel dropdown)
     - text: the trigger's `body.text`
   - **ELSE**: **Break** (ends the run; nothing is sent).
4. **Save.** Saving the trigger and steps publishes the flow.

**If the IF block can't compare against the key** (for example, it only takes fixed dropdown values),
use one JavaScript step instead, with Slack **Send Message** registered as an action the step may
call (connect your Slack account when asked):

```js
const SHARED_KEY = "PASTE_YOUR_WEBHOOK_SHARED_KEY_HERE" // same value as WEBHOOK_SHARED_KEY in .env
const body = context?.req?.body || {}
if (body.key !== SHARED_KEY) return { ok: false, reason: "bad key" }
if (typeof body.text !== "string" || !body.text.trim()) return { ok: false, reason: "no text" }
// Use the field keys exactly as the Send Message form shows them; these names are placeholders.
await sendMessage({ inputData: { channel: "<#m91-blog channel id from the dropdown>", text: body.text } })
return { ok: true }
```

## Flow 2: `blog-m91-alert`

1. **New flow** → `blog-m91-alert` → **Webhook** trigger → copy its URL into `.env` as
   `M91_ALERT_WEBHOOK_URL`.
2. **IF block**, condition: `body.key` **equals** the shared key.
   - **Inside the IF:** M91 → **Send Channel Alert**
     - title: `body.title`
     - description: `body.description`
     - severity: `body.severity` (the engine always sends one of `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
   - **ELSE:** **Break**.
3. **Save.**

**If the severity field is a fixed dropdown** that won't take `body.severity`, tell me. You can fix it
to one value in the flow (e.g. LOW), and I'll note that the engine's MEDIUM alerts then arrive as LOW.

The JavaScript fallback works the same way as in Flow 1: check `body.key`, then call the registered
**Send Channel Alert** action with `title`, `description` and `severity`, and return `{ ok: true }`.

## After building both

Put both URLs in `.env` and tell me. Smoke test **S5** then sends one Slack message and one **LOW**
M91 alert, but only after your "ok".

Checking the key rejection yourself, from a shell (your own terminal; the URL comes from your env):

```bash
curl -s -X POST "$SLACK_POST_WEBHOOK_URL" -H "content-type: application/json" -d '{"key":"wrong","text":"should be rejected"}'
```

Expected: HTTP 200 and no Slack message (the ELSE branch breaks the run).
