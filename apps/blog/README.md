# M91 blog (`@m91/blog`)

A static Astro site that shows the published M91 posts, with the look of the M91 site. It is its own
npm project (not a workspace): `npm run install:blog` from the repo root installs it.

- **Input:** `src/content/posts/*.json`, written by the engine's Publisher from Mem0 (gitignored; Mem0
  is the source of truth). Every file must be a valid post (format v1, `@m91/content`), or the build
  stops with a clear message.
- **No `.env`:** the blog reads no environment value and no secret. Public constants live in
  `src/config/site.ts`; its `SITE_URL` must equal the engine's `BLOG_BASE_URL` (the Publisher checks).
- **Samples:** `npm run dev` with no posts shows `samples/` with a "Sample content" badge. A build never
  includes them.
- **Noindex posts** (`noindex: true`) get `<meta name="robots" content="noindex, nofollow">` and are
  left out of the home page, topic pages, RSS, the sitemap and `llms.txt`; their page works by link.
- **No outside requests:** system fonts (as on the M91 site), no analytics, no third-party scripts.
  OG images are drawn at build time with Inter (SIL OFL 1.1, `src/og/fonts/OFL.txt`).
- **Safety:** a CSP meta tag on every page; raw HTML in post Markdown is dropped, never rendered.
  Embarko's static hosting sets no custom response headers, so `X-Content-Type-Options` can't be set;
  `Referrer-Policy` is a meta tag.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:4321 |
| `npm run build` | Production build into `dist/` (Astro telemetry off) |
| `npm run preview` | Serves `dist/` on http://localhost:4321 |
| `npm test` | Builds fixture posts into `test/.tmp` and checks the output (no network) |
| `npm run check` | `astro check` (types), then the tests |
