// A post body (no H1, no TL;DR) with one example of every block pattern, and a plan that uses them all.

export const EVERY_BLOCK_MD = `## Why approvals need one owner

An agent that deletes data needs a person to say yes first. This post shows how.

> Never auto-approve when the answer is missing.

## Set it up

1. Create a channel in M91.
   What you should see: a send link.
2. Add the link to your server.
3. Send a test alert.

## How the approval flows

1. The agent reaches a risky step and asks for approval.
2. M91 rings the on-call phone.
3. The person taps Approve.
4. The software continues with the step.

## Send the alert

\`\`\`bash
curl -sS -X POST "$M91_SEND_LINK" -d '{"title":"Deploy 4821"}'
\`\`\`

\`\`\`js
await fetch(process.env.M91_SEND_LINK, { method: 'POST', body: JSON.stringify({ title: 'Deploy 4821' }) })
\`\`\`

## Compare the options

| Option | Wakes a person | Records the answer |
|---|---|---|
| Slack message | No | No |
| M91 call | Yes | Yes |

## What happens if nobody answers

1. Minute 0: the phone rings.
2. Minute 5: the next person is called.
3. Minute 15: the team lead is called.

## A run, step by step

\`\`\`console
$ agent run deploy
waiting for approval…
approved by Aryan
deploy 4821 done
\`\`\`

## Pick a timeout

**Short timeout** and the agent gives up quickly: nothing changes.

**Long timeout** and the agent waits for a person.

That keeps risky steps safe.

## Questions

### Does M91 work in silent mode?

Yes. It rings through silent mode.

### Can two people approve?

Only the first answer counts.

## Troubleshooting

### The phone does not ring

Likely cause: the app has no permission to ring.

Fix: allow notifications for M91.

### The callback never arrives

Likely cause: the callback URL is not public.
Fix: use a public HTTPS URL.

## What to do next

[Try M91](https://m91-site.embarko.app/)
`

/** The id of the part whose source starts with `text`. */
export const idOf = (parts, text) => {
  const p = parts.find((x) => x.source.startsWith(text))
  if (!p) throw new Error(`no part starts with ${JSON.stringify(text)}`)
  return p.id
}

/** The ids from the part starting with `from` to the part starting with `to` (inclusive). */
export const range = (parts, from, to = from) => {
  const a = parts.findIndex((x) => x.source.startsWith(from))
  const b = parts.findIndex((x) => x.source.startsWith(to))
  return parts.slice(a, b + 1).map((p) => p.id)
}

export const seg = (block_type, part_ids, extra = {}) => ({ block_type, part_ids, callout_tone: 'none', moment_actors: [], why: `${block_type} helps`, ...extra })

/** A plan with one segment of every block type the Designer may choose, in post order. */
export function everyBlockPlan(parts) {
  return {
    segments: [
      seg('callout', range(parts, '> Never'), { callout_tone: 'warning' }),
      seg('steps_checklist', range(parts, '1. Create a channel')),
      seg('phone_ring_sim', range(parts, '1. The agent reaches'), { moment_actors: ['agent', 'm91', 'human', 'software'] }),
      seg('code_tabs', range(parts, '```bash', '```js')),
      seg('comparison_table', range(parts, '| Option')),
      seg('escalation_timeline', range(parts, '1. Minute 0')),
      seg('agent_terminal_replay', range(parts, '```console')),
      seg('choice_explorer', range(parts, '**Short timeout**', 'That keeps')),
      seg('faq_accordion', range(parts, '### Does M91', 'Only the first')),
      seg('troubleshooting_picker', range(parts, '### The phone does not ring', 'Likely cause: the callback'))
    ],
    notes: 'none'
  }
}
