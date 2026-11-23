// The blog's settings. All public: the blog holds no secret and needs no .env. Each can be overridden by an
// environment variable (tests point ENGINE_URL at a fake engine).

const clean = (u) => String(u).trim().replace(/\/+$/, '')

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: Number.parseInt(env.PORT ?? '8080', 10) || 8080,
    host: env.HOST || '0.0.0.0',
    // Where the posts come from: the engine's public, read-only list of approved posts.
    engineUrl: clean(env.ENGINE_URL || 'https://m91-engine.embarko.app'),
    // This blog's own address (canonical links, the sitemap, RSS).
    siteUrl: clean(env.SITE_URL || 'https://m91-blog.embarko.app'),
    // The M91 site the header and footer link back to.
    m91Url: clean(env.M91_URL || 'https://m91.msg91.com'),
    // How long a copy of the posts is fresh; after that the next reader triggers a refresh (the old copy is
    // served while the engine is unreachable).
    freshMs: Number.parseInt(env.POSTS_FRESH_MS ?? '60000', 10) || 60000,
    timeoutMs: Number.parseInt(env.ENGINE_TIMEOUT_MS ?? '8000', 10) || 8000
  })
}
