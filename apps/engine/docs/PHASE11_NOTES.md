# Phase 11: the fallback plan (Markdown for Docstar)

The engine no longer publishes HTML. Its output is a clean Markdown file per approved post, which will later go
to Docstar. Until the Docstar keys exist, everything works up to "reviewed and approved, Markdown ready", and the
Docstar step is in place but answers "not configured".

Nothing was deleted. Phase 10 (the Experience Designer, guides, the blog) comes back with two settings.

## Settings

```
EXPERIENCE_ENABLED=false
PUBLISH_TARGET=none
EXPORT_DIR=
DOCSTAR_API_URL=
DOCSTAR_API_KEY=
DOCSTAR_COLLECTION_ID=
```

These are also the defaults when a line is missing. The unit tests pin the Phase 10 behaviour
(`EXPERIENCE_ENABLED=true`, `PUBLISH_TARGET=embarko`) and test the fallback explicitly.

- `PUBLISH_TARGET` was a Phase 3.5 key, removed then. It is reused with new values: `none`, `embarko` or
  `docstar`. An old value in `.env` stops the engine with "must be one of none | embarko | docstar".
- `DOCSTAR_API_KEY` is a secret: it is masked like the other keys, and never logged or returned.
- `PROMO_ENABLED` stays `false`.

## EXPERIENCE_ENABLED=false

- **Pipeline:** no Experience Designer step. The Reviewer reviews the post as written.
- **Counter prompts:** "Change the design" is hidden. The API answers 409 `experience_off` for
  `target: "design"`, and for the `designer` run mode.
- **Reviewer:** the pre-Phase-10 rules are back:
  - the 8 gates, without `no_new_facts_in_design`;
  - the 10 areas, without `experience`;
  - the weights (structure and originality 10 each);
  - `send_to`: writer, strategist and scout only.

  The prompt is the exact pre-Phase-10 text. The strict schema and the code decide with the same lists.
- **Dashboard:** the interactive guide card, the Experience Designer button and its pipeline step are hidden.

## The Markdown export (`src/export/`, 0 AI calls)

From a reviewed draft (it has a review, or you approved it), the file is built as:

1. **YAML front matter:** title, slug, description, keyword, tags, topic, topic_group, brief_id, version,
   brief_version, review_score, review_passed, date.
2. **The post:** `# Title`, the description, `## TL;DR` (the three takeaways), then the body.
   - The body is the post without its H1 and TL;DR block.
   - Links to the old M91 site point to `M91_CTA_URL`.
   - Raw HTML tags are removed. Code is left as it is.
3. **`## Sources`:** every outside link. Skipped if the body already has a Sources section.
4. **`## Try M91`:** the call to action. Skipped if the body already links `M91_CTA_URL`.

The format is plain CommonMark with GFM tables and fenced code. There is no HTML.

### When it is saved

- **Preview, nothing saved:** the Markdown export card on the approval page (`GET
  /api/approvals/<id>/markdown`, with `?format=md&download=1` for the file), or `npm run export --
  --brief-id=<id>`, which writes only the file.
- **Final export, on Approve:** a new `export` step saves one `markdown_export` record per brief in Mem0 (a
  new approval replaces it), and the file `apps/engine/exports/<slug>.md` (gitignored; `EXPORT_DIR` moves it).
  - A failure here is a warning: the approval stands.
  - `npm run export -- --brief-id=<id> --save`, or **Export Markdown** on Control, saves it again.
- **Dashboard:** the **Exports** page lists the saved files. Choose one to see it rendered, with **Copy
  Markdown** and **Download .md**. The Records page lists `markdown_export` records too.

## What Docstar documents (read 2026-10-21, no keys)

From docstar.io/help:

- **Pages:** pages live in collections.
- **Markdown:** pasted or imported Markdown becomes the editor's blocks. The documented syntax covers
  headings, lists, task lists, quotes, fenced code with a language, tables, links, images and dividers.
  There is no general HTML; only two Docstar tags exist, `<alert>` and `<card>`. Whole `.md` or `.mdx` files
  can be imported through a collection's settings.
- **Front matter:** not documented. So the Docstar adapter sends the file without its front matter, and the
  title and slug as fields.
- **API tokens:** they start with `hm_` and go in `Authorization: Bearer <token>`. Each token covers one
  workspace.
- **Page endpoints:** not in the public docs on 2026-10-21. Since then Docstar publishes its API reference at
  developers.docstar.io; the step below uses it (2026-10-23).

## The Docstar step (`src/publisher/docstar.js`)

- **Interface:** `createPage({ title, slug, markdown, … })`, `updatePage({ page_id, … })` and
  `unpublishPage({ page_id })`.
- **Settings:** `DOCSTAR_API_URL=https://api.docstar.io`, `DOCSTAR_API_KEY` (`hm_…`, a secret),
  `DOCSTAR_COLLECTION_ID` and `DOCSTAR_ORG_ID` (the workspace id; `POST /proxy/decode-token` answers it). Without
  all four, every call answers `{ ok: false, status: "not_configured" }` and nothing is sent.
- **Docstar's API** (developers.docstar.io, read 2026-10-23), `Authorization: Bearer hm_…`:

  | Step | Request |
  | --- | --- |
  | the collection's top page | `GET /orgs/:orgId/collections/:collectionId` → `pages.rootParentId` |
  | create (a draft) | `POST /orgs/:orgId/pages/:rootParentId` `{ name, urlName, state: 1 }` |
  | the body | `POST /orgs/:orgId/pages/:pageId/ydoc` `{ content }` (Markdown); if Docstar says the page has no editor document yet, `PUT /orgs/:orgId/pages/:pageId` `{ contents }` |
  | SEO | `PATCH /orgs/:orgId/pages/:pageId/meta` `{ data: { title, description, tags } }` |
  | publish / unpublish | `PATCH /orgs/:orgId/pages/:pageId/state` `{ state: 2 }` (answers `publicUrl`) / `{ state: 1 }` (back to draft) |
  | rename (update) | `PUT /orgs/:orgId/pages/:pageId` `{ name }` (the slug stays, so links keep working) |

- **Create:** 5 requests (top page, create, body, SEO, publish). **Update:** 4 (rename, body, SEO, publish; any
  edit moves a Docstar page back to draft, so it is published again). **Unpublish:** 1; nothing is deleted.
- **Body:** the export without its front matter and without the first `# Title` (Docstar shows the page name).
- **Draft only:** `npm run publish -- --brief-id=<id> --draft` (or `params.draft: true`) creates or updates the
  page without publishing it, e.g. to check a first post in Docstar.
- **Page id:** saved on the `markdown_export` record (`docstar_page_id`, `docstar_url`, `docstar_state`), so the
  next send updates the page. If a step fails after the page was made, the id is still saved: the next try
  updates that page instead of making a duplicate.
- **Errors:** the key is masked (`hm_s…`) and the org id left out of every message.

## PUBLISH_TARGET

| Target | Publish modes | Page preview | On Approve |
| --- | --- | --- | --- |
| `none` | refused (409 `publishing_off`) | refused (409 `preview_off`) | export saved; "Publishing is off" |
| `docstar` | publish and unpublish (to Docstar); the others 409 `not_supported`; publish needs the saved export (409 `no_export`) | refused | export saved; sent to Docstar only with `AUTO_PUBLISH=true` |
| `embarko` | as in Phase 7 | as in Phase 10 | export saved; the blog with `AUTO_PUBLISH=true` |

The dashboard follows the same rules. With `none`, it hides Publish, Rebuild blog, the page preview and the
Posts page. With `docstar`, Publish becomes **Send to Docstar**.

## API additions

| Route | What it does |
| --- | --- |
| `GET /api/approvals/<id>/markdown[?version=n][&format=md[&download=1]]` | The export of a reviewed draft, built now. Answers 404 `unknown_brief` or 409 `not_reviewed`. |
| `GET /api/exports` | The saved exports (no file text). |
| `GET /api/exports/<id>` / `…/download` | One saved export, as JSON or as the file. |
| `POST /api/runs` with `mode: "export"` | `params.brief_id`, plus optional `version` and `save` (true: the final export). |
| `GET /api/settings` | New: `publish: { target, docstar_configured, auto_publish }` and `designer.enabled`. |

## Costs

| Action | AI calls | Mem0 requests |
| --- | --- | --- |
| Approve | 0 | ≈12 (was 9: the export record and the reads that build it; measured with fakes) |
| Export preview | 0 | ≈0–4 (a running engine serves the reads from its index) |
| Export `--save` | 0 | ≈4–6 |
| Full run, Experience Designer off | 15–26 | ≈28–45 |
| Change the writing, Experience Designer off | 2–4 | ≈17 |

The "off" rows are estimates: the Phase 10 numbers minus the Experience Designer's 1–2 calls and one write
per draft version.

## Tests (fakes only)

- **Engine:** `test/export/phase11.test.js` covers:
  - the file;
  - which draft is exported;
  - the final export and its replacement;
  - approve with `none`;
  - `PUBLISH_TARGET` rules;
  - export mode;
  - Docstar (not configured, a fake transport that never leaks the token; the real requests in `test/export/docstar.test.js`);
  - the designer off;
  - the API.

  The Reviewer tests cover both modes. `test/fullrun-mem0.test.js` covers approve at 12.
- **Dashboard:** `test/exports.test.tsx` covers:
  - the switches;
  - the export card with Copy and Download;
  - the Exports page.
