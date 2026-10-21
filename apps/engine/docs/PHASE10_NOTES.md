# Phase 10: interactive guides

Every post can now be an interactive guide: numbered chapters with designed components between the Writer's
text. Parts A and B (the blog's design system, home page, post shell, the `guide` post format and its
components) are in commits `0be0f56`, `fa7d76d` and `afcb380`. This file covers Parts C and D: the agents,
the page preview, the dashboard and the Publisher.

## The pipeline (C1)

Scout → Strategist → Writer → content checks → **Experience Designer** → Reviewer (reviews the whole guide)
→ routing loop → your approval (with a page preview) → Publisher.

- The Experience Designer runs after every draft version, so a revision gets a new guide.
- The promo pack no longer runs. Its code and tests stay, and `PROMO_ENABLED=true` turns it back on (it runs
  when you approve).
- Approving makes no AI call: the guide was built and reviewed before you see it.
- The Phase 8 layout-only Designer agent is removed. Its parts parser, build helpers and integrity check stay;
  the Experience Designer reuses them.

## The Experience Designer (C2, `src/experience/`)

- **Model:** `EXPERIENCE_AI_SERVICE` / `EXPERIENCE_AI_MODEL`, default `anthropic` / `claude-sonnet-4-6`,
  delivery `rtlayer`.
- **Calls:** one call per draft version, plus at most `EXPERIENCE_MAX_REPAIRS` (1) repairs. Each call uses a
  fresh thread.
- **Its answer is a plan, not text.** Components that show the post's text or code name the parts
  (`part_ids`) or a snippet (`snippet_id`), and code copies the exact text in (`build.js`). The Designer writes
  only short interface text: labels, scenario lines, step titles, "Stuck here?" hints and the hero scene.
- **Output:** a `guide_doc` record holding:
  - the plan and the guide;
  - `body_sha256`, the hash of the body the guide was built from;
  - the dropped components, with reasons;
  - the coverage result;
  - the checks (first answer, then final);
  - the model, repairs and time.
- **Status:** `ok` with a guide, or `fallback` with no guide. A fallback never fails a run: the post is
  reviewed and published as written.

## Guide checks (C3, `build.js` and `checks.js`)

- **Coverage:** every part of the Writer's post appears once, in order (the Phase 8 integrity rules).
- **No new facts:** every number, amount, percentage and duration in authored text must appear in one of:
  - the post;
  - the brief's facts, sources or tutorial steps;
  - the M91 facts;
  - the snippets.

  Example fields (the hero scene and `approve_demo`) may hold made-up example data, but never URLs. URLs and
  inline code must come from the same sources, and code blocks are whole snippets or exact line ranges.
- **Banned in authored text:** the `claims_to_avoid` words, the banned phrases, hard M91 claims and first
  person.
- **When a check fails:** one repair call. Whatever still fails is dropped (its parts become prose), and the
  guide still renders.
- **Schema and limits** apply per component, with at most `EXPERIENCE_MAX_COMPONENTS` designed components per
  guide.

## The Reviewer (C4)

- **Input:** a new GUIDE section after POST. It shows the Experience Designer's own text; the Writer's text
  is only pointed to.
- **New gate:** `no_new_facts_in_design`.
- **New area:** `experience`. The total is still 100:

  | Area | Before | Now |
  | --- | --- | --- |
  | answers_question, simplicity, accuracy | 15 each | 15 each |
  | seo, tone | 10 each | 10 each |
  | structure | 10 | **5** |
  | originality | 10 | **5** |
  | ai_answer_readiness, to_the_point, m91_fit_cta | 5 each | 5 each |
  | experience | – | **10** |

- **No guide:** code scores `experience` the same as `structure`, and passes the new gate, so a plain post is
  scored as before.
- **Feedback:** it may quote the guide, and may go to `send_to: "designer"`. If every must-fix item is about
  the design, the routing loop re-runs only the Experience Designer (`redesign`, up to
  `MAX_DESIGNER_REVISIONS`, 2). If there are text items too, the Writer revises with the text items only, and
  the design items go to the Experience Designer run that follows.

## Counter prompts (C5)

The Request changes box offers two choices:

- **Change the writing:** the Writer, then the Experience Designer.
- **Change the design:** the Experience Designer only, on the same version, with your feedback. Your quotes
  may come from the guide. Without a guide this choice is refused (409 `no_guide`).

Both choices count towards `MAX_HUMAN_REVISIONS`. The API takes `target: "writing" | "design"`.

## Page preview (D1)

`POST /api/approvals/<brief_id>/preview` builds the blog with only this draft and its guide (built the same
way as a publish, including the link fixes) into `apps/engine/data/previews/<brief_id>/`. The engine serves
it at `http://127.0.0.1:8080/preview/<brief_id>/`:

- `noindex` meta on every page, a "Preview · not published" badge, and no sitemap;
- `X-Robots-Tag: noindex`, `frame-ancestors 'self'`, `no-store`;
- with `DASHBOARD_AUTH=true`, the dashboard login is required.

It needs 0 AI calls, makes no Mem0 writes and deploys nothing. On the approval screen, **Preview the page**
builds it and embeds it, with a phone-width switch and a link to open it in a new tab. Only one preview builds
at a time, and never during a run.

On the blog side, setting `BLOG_PREVIEW_BASE=/preview/<brief_id>/` switches on preview mode.

## Dashboard (D2)

- **Live run:** the Experience Designer step comes before the Reviewer. It shows:
  - guide or no guide, and the chapters;
  - the components chosen, and what was dropped (with reasons);
  - coverage, the checks (first → final) and repairs.
- **Promo:** the step is hidden while the promo pack is off.
- **Record detail:** a guide view for `guide_doc` (chapters and components, dropped, coverage, checks, the
  hero scene, the feedback it worked from). A draft also shows your design requests.
- **Interactive guide card** on the approval screen: the on/off switch, the newest guide, and Re-run
  Experience Designer (1–2 AI calls, for approved or published drafts).
- **Control:** an Experience Designer card. The promo card is hidden while `PROMO_ENABLED=false`.
- **Content:** a Guides tab.
- **Settings:** the Experience Designer model, its limits, and the promo pack switch.
- **Estimates:**

  | Action | AI calls | Mem0 requests |
  | --- | --- | --- |
  | Full run | 16–29 | ≈30–48 |
  | Approve | 0 (1–2 with the promo pack on) | ≈9 |
  | Change the writing | 3–6 | ≈18 |
  | Change the design | 2–4 | — |
  | Re-run Experience Designer | 1–2 | ≈7 |

## Publisher (D3)

The Publisher publishes `guide` when the newest `guide_doc` of the version was built from exactly the body
being published. Otherwise it uses the Phase 8 blocks (older posts) or plain Markdown. Old posts keep working.
See [PUBLISHING.md](PUBLISHING.md).

## Settings (D4)

New in `env.example`:

```
PROMO_ENABLED=false
EXPERIENCE_AI_SERVICE=anthropic
EXPERIENCE_AI_MODEL=claude-sonnet-4-6
EXPERIENCE_DELIVERY=rtlayer
EXPERIENCE_MAX_REPAIRS=1
EXPERIENCE_MAX_COMPONENTS=10
MAX_DESIGNER_REVISIONS=2
```

`INTERACTIVE_DEFAULT` stays. `DESIGNER_AI_SERVICE`, `DESIGNER_AI_MODEL`, `DESIGNER_DELIVERY`,
`DESIGNER_MAX_INTERACTIVE_BLOCKS` and `DESIGNER_MAX_REPAIRS` are no longer read and can be removed from
`.env`.

## Measured with fakes (no AI, no Mem0 service)

`test/fullrun-mem0.test.js` measures the Mem0 requests:

- **Full run:** 30 (was 28). The difference is one `guide_doc` write per draft version (2 in the test). The
  Experience Designer reads nothing from Mem0: it gets its inputs from the run.
- **Decision runs:**

  | Run | Mem0 requests | Before Phase 10 |
  | --- | --- | --- |
  | human_revise | 18 | 17 |
  | approve | 9 | 11 |
  | designer | 7 | 6 |
  | publish | 12 | 13 |
  | unpublish | 10 | 10 |

## Not done yet

- The smoke tests with real AI calls: the sample guide screenshots, the Experience Designer on post
  261021-0937-JHTR, its review and preview, and Lighthouse on the live guide. Each one waits for your OK and
  the expected AI calls.
