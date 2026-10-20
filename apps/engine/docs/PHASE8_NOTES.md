# Phase 8: the Designer and interactive blocks

The Designer turns parts of an approved post into interactive blocks. It never writes text: it returns a
plan, and code builds every block from exact slices of the post's Markdown. An integrity check then proves
that the blocks hold exactly the post's text. If anything fails, the post is published as plain Markdown.
The Designer never blocks publishing.

## How it works

1. **Parts** (`src/designer/parts.js`): the body (without the H1 and the TL;DR) is split into numbered
   parts `N1…Nk`: headings, paragraphs, lists, code, tables, quotes. Each part keeps its exact source range
   and some flags (`is_question`, `starts_with_bold`, `looks_like_flow`, …).
2. **Plan** (`src/designer/prompts.js`, `schemas.js`): one AI call (`response_type: json_schema`, strict)
   sends previews of the parts, the brief's interactive ideas and the block catalog. The Designer answers
   with segments: a block type plus the part ids it covers. When the plan does not match the schema, it gets
   up to `DESIGNER_MAX_REPAIRS` repair calls.
3. **Build** (`src/designer/build.js`): each segment is checked against its block type's pattern (for
   example, a `faq_accordion` needs question headings, each followed by an answer). A segment that does not
   fit is dropped, with a reason. Everything not in a kept segment becomes `rich_text`. At most
   `DESIGNER_MAX_INTERACTIVE_BLOCKS` interactive blocks are kept.
4. **Integrity** (`src/designer/integrity.js`): checks that
   - the blocks cover every part, in order;
   - the source ranges rebuild the body exactly;
   - every string in a block is a slice of its range, in order (no new text);
   - whatever is left over is only Markdown markup (no dropped text).
5. **block_doc record:** the plan, the blocks, the kept and dropped segments, the integrity result, the
   parts (id, type and preview only), the model, the repairs and the time taken. Its status is `ok`, or
   `fallback` with an `error`. With no kept blocks the status is `ok` and `blocks` is null.
6. **Publish** (`src/publisher/blocks.js`): when the post is interactive, the Publisher reads the newest
   block_doc for that draft version and runs the integrity check again against the body it publishes. The
   post gets `blocks` only if the check passes; otherwise it is published as plain Markdown, with a note in
   the run.

**Interactive or not:** a draft's `metadata.interactive` (set from the dashboard) wins; otherwise
`INTERACTIVE_DEFAULT` decides. When a post is not interactive, the Designer step logs that it did not run.

## Block types

There are 16 block types in `@m91/content`. These 11 are built:
`rich_text`, `callout`, `steps_checklist`, `code_tabs`, `comparison_table`, `faq_accordion`,
`phone_ring_sim`, `escalation_timeline`, `agent_terminal_replay`, `choice_explorer`,
`troubleshooting_picker`.

The other 5 are reserved: they validate (they only need a `data` object), but the blog does not render them
yet, so a post that has one shows its whole Markdown instead.

## The blog (apps/blog)

- **Without JS, every block reads as plain content.** Controls that only work with JS (tabs, the phone, the
  progress line, "Watch again", choice buttons) are `.js-only`. A `js` class is set on `<html>` before
  paint, so nothing shifts when the controls appear.
- **One bundled script per block type**, served from `/_astro/` (no inline scripts, CSP unchanged), and only
  on pages that use that block.
- **Heading ids** are shared between the full Markdown and the blocks, so the contents links, FAQ questions
  and troubleshooting problems keep their anchors. A URL hash opens the matching FAQ item or problem.
- **Fallback:** if any block cannot render (a reserved type, bad data, ids that don't line up), the whole
  post's Markdown is shown and the build logs `[blocks] <slug>: … showing the post's Markdown instead`.
  Invalid block data is dropped when the post is loaded, with the same kind of warning.
- **Light only:** the blog has no dark mode, like the M91 site (https://m91.msg91.com). Its M91 links point
  there.
- **Dev sample:** `apps/blog/samples/sample-every-block.json` has all 21 blocks of the test fixture. It is
  generated with the engine's own parts, build and integrity code, so it matches what the Publisher sends.

## Commands (from `apps/engine`)

```bash
npm run designer -- --brief-id=261019-1622-Q8C4
```

This runs the Designer for the newest approved or published draft. Add `--version=<n>` for an older
version. It uses 1–2 AI calls and saves a block_doc. It does not publish: republish afterwards (0 AI calls)
to put the blocks on the live post.

## API additions

| Route | What it does |
| --- | --- |
| `POST /api/runs` with `mode: "designer"` | The Designer for `params.brief_id` (`params.version` optional). 409 `no_draft` when there is no approved or published draft. |
| `POST /api/drafts/:brief_id/interactive` | `{ "on": true \| false }` on the brief's newest draft (`metadata.interactive`). 400 `bad_params`, 404, or 409 `run_in_progress`. Returns `saved: false` in DRY_RUN. It starts no run. |
| `GET /api/approvals/:brief_id` | New `interactive`: `{ on, default, set, block_doc }`, where `block_doc` is the newest Designer result for this version: status, summary, block and dropped counts, and the integrity result. |
| `GET /api/posts` | New `blocks` field: the number of blocks in the published post (0 means plain Markdown). |
| `GET /api/settings` | New `designer` section: `{ max_interactive_blocks, max_repairs, interactive_default }`. `models.designer` lists the model. |

## Dashboard

- **Approval screen:** a new Interactive blocks card with:
  - the on/off switch, and whether the value was set for this post or comes from `INTERACTIVE_DEFAULT`;
  - the newest Designer result, with a link to its block_doc;
  - Re-run Designer (1–2 AI calls), for approved and published drafts;
  - for a published post, a hint that the live page changes only after Republish.

  Approve shows 2–4 expected AI calls when blocks are on: promo 1–2 plus Designer 1–2.
- **Posts:** each row shows its block count or "plain Markdown", and has a Re-run Designer button.
- **Records:** block_doc records get a view with the summary, the integrity result, the kept and dropped
  segments (with reasons), the blocks in order with their parts, and the parts' previews.
- **Live run:** the Designer step output shows its status, block count, dropped count, integrity and
  repairs.
- **Settings:** a new Interactive blocks card shows `INTERACTIVE_DEFAULT`, the Designer model and the
  limits.

## New settings

| Key | Default | Meaning |
| --- | --- | --- |
| `DESIGNER_AI_SERVICE`, `DESIGNER_AI_MODEL` | as in `env.example` | The Designer's model (checked against the model list). |
| `DESIGNER_DELIVERY` | `sync` | `sync` or `rtlayer`. |
| `DESIGNER_MAX_INTERACTIVE_BLOCKS` | `6` | Interactive blocks kept per post (`rich_text` doesn't count). |
| `DESIGNER_MAX_REPAIRS` | `1` | Repair calls when the plan does not match the schema. |
| `INTERACTIVE_DEFAULT` | `true` | Whether posts get blocks, unless the draft's switch says otherwise. |

## Local smoke (2026-10-20, every-block sample)

The sample was built with `astro build` and served with `astro preview` from `apps/blog/test/.tmp`. That
setup made no AI calls and no Mem0 calls.

- **Desktop, 1280 px:**
  - the checklist ticks, updates "1 of 3 done" and is remembered in localStorage;
  - code tabs switch panels;
  - a choice shows its outcome;
  - the terminal replays;
  - a URL hash opens the FAQ item;
  - picking a problem marks it;
  - no horizontal scroll.
- **Phone simulation:** scrolling down shows waiting, ringing, deciding (Approve chosen), then continuing.
  Scrolling back up reverses it. Two fixes came out of the smoke test:
  - the moment shown lagged one step behind (the observer only saw changed entries), so moments in the band
    are now tracked;
  - at phone width the mockup scrolled off screen, so it is now smaller and sticky under the header.
- **Phone, 375 px:** no horizontal scroll, and nothing in a block is wider than the screen.
- **Without JS** (the `js` class removed): every `.js-only` control is hidden and every `.no-js-only` label
  shows. Both code versions show with labels, every choice outcome and every problem is visible, and tables
  read as cards.
- **Reduced motion:** the browser pane cannot emulate this setting, so it was checked in code. With
  reduced motion:
  - the terminal shows every line at once;
  - the timeline doesn't animate;
  - the ringing animation is off (CSS).
- **Lighthouse 12.6.1** (headless Chrome, `npx`):

  | Form factor | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Mobile | 100 | 100 | 100 | 100 | 1.1 s | 0 | 0 ms |
  | Desktop | 100 | 100 | 100 | 100 | 0.3 s | 0 | 0 ms |

## Safety

- The Designer only returns part ids and block types. Code copies the text, and the integrity check proves
  nothing was added, changed or dropped.
- Raw HTML inside block Markdown is not rendered, same as in a plain post.
- No new secrets. The switch and the new settings expose yes/no values and limits only.

## Open issues

- The live post (brief 261019-1622-Q8C4, v3) was published before Phase 8. It gets blocks only after the
  Designer run and a republish (Task 8, each needs your OK).
- That draft's CTA link is `https://m91-site.embarko.app/` (checked on the live page). The Publisher
  publishes the stored Markdown, so the link changes only with a new draft version. If `M91_CTA_URL` now has
  a different value, a republish no longer recognises that link as the CTA, and lists it under the post's
  sources.
- The blog's header and footer now link to `https://m91.msg91.com/`, including `#how` and `#cases`. Both
  anchors exist on the live site (checked 2026-10-20).

## After Phase 8 (2026-10-20)

- **Old M91 site links:** at publish time, the Publisher replaces every link to the old site's home page
  (`https://m91-site.embarko.app`, with or without the trailing slash) with `M91_CTA_URL`. This applies to
  the body and the blocks. Sources skip these links, since they are now the CTA. The run's warnings say how
  many were replaced. Longer paths on the old site are left as they are.
- **M91 docs moved** to `https://m91-api.msg91.com`. The old address `https://m91.msg91.com/llms.txt` and every
  `/api/public/*.md` page there now return 404. The defaults are:

  ```
  M91_DOCS_URL=https://m91-api.msg91.com/llms.txt
  M91_DOCS_HOSTS=m91-api.msg91.com,m91.msg91.com
  ```

  These checks read the `M91_DOCS_HOSTS` list, so they accept both hosts:
  - the Scout's docs bundle;
  - the Writer's http → https fix and its cited-page fetch;
  - the Strategist's fix;
  - the tutorial link check.

  The Writer and the Reviewer allow whatever URLs the brief and the source pack contain, on either host.
- Published posts that cite `m91.msg91.com/api/public/…` or `m91.msg91.com/llms.txt` now point at dead
  pages. The Publisher does not rewrite those links.
