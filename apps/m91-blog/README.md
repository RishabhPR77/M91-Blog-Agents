# M91 blog (`apps/m91-blog`)

The M91 blog at **https://m91-blog.embarko.app**: every approved post from the M91 Blog Engine, in the look of
m91.msg91.com (its colours, system fonts, the M91 mark, the lime blog cards on ruled paper). Only the blog section, so
the M91 site can link to it ("Read all posts") or show its latest posts.

It is its own npm project and its own Embarko app, separate from the engine (`m91-engine`) and deployed with its own token.

## How posts get here

1. A post is approved in the engine (automatically or by you). Approval saves its final Markdown export.
2. The engine lists every approved post at `GET https://m91-engine.embarko.app/api/public/posts` (no login, read-only:
   title, description, topic, tags, date, reading time and the Markdown; never a draft, a review or a score).
3. The blog reads that list and keeps it for a minute, so a new post shows within about two minutes. No redeploy.
   When the engine can't be reached, the blog keeps showing its last copy.

The engine's Markdown is shown as written: the `# Title` becomes the page title, the intro the lead, `## TL;DR` a
lime box, `## Sources` a quiet list and `## Try M91` the closing panel. Raw HTML in a post is never rendered, and only
http(s), mailto and in-site links are kept.

## Pages

| Path | What it is |
| --- | --- |
| `/` | Every post, newest first (`/?topic=on-call` for one topic) |
| `/posts/<slug>` | One post, with "On this page" on wide screens and three more posts |
| `/posts.json` | The list as JSON for the M91 site's blog cards (`slug`, `title`, `description`, `topic`, `date`, `reading_minutes`, `url`); any site may read it |
| `/rss.xml`, `/sitemap.xml`, `/robots.txt` | Feed and search engines |

No cookies, forms or scripts. A strict Content-Security-Policy; the pages can be framed only by m91.msg91.com
(and other msg91.com sites).

## Settings

None are needed. All public, each with a default, each overridable by an environment variable:
`ENGINE_URL` (https://m91-engine.embarko.app), `SITE_URL` (https://m91-blog.embarko.app), `M91_URL`
(https://m91.msg91.com), `POSTS_FRESH_MS` (60000), `ENGINE_TIMEOUT_MS` (8000). Embarko sets `PORT`.

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Installs (one dependency: `marked`) |
| `npm start` | The server on `PORT` (8080 by default) |
| `npm run dev` | The same, restarting on changes. Point it at a local engine with `ENGINE_URL` |
| `npm test` | Markdown, pages, the engine copy and the deploy helpers, against a fake engine (no network) |
| `npm run deploy -- --yes` | Uploads this folder to Embarko as `m91-blog` (the embarko-deploy skill's `deploy.sh`) |

The deploy token is the blog's own, never the engine's: `EMBARKO_BLOG_DEPLOY_TOKEN` (or `DEPLOY_TOKEN`) in the
environment, else the file `~/.embarko/m91-blog.token` outside the repo. It is never printed, and nothing is uploaded
without it.
