// Types for markdown.js, a copy of apps/m91-blog/src/markdown.js (the blog's own renderer, so the Write page's preview is
// the blog page itself). Do not edit the .js here: change the blog's and run `npm run sync:blog-preview` in apps/engine.
export declare const escapeHtml: (s: unknown) => string
export declare function safeHref(href: unknown): string | null
export declare const IMAGE_PATH_RE: RegExp
export declare function safeImage(src: unknown): string | null
export declare const slugify: (text: unknown) => string
export type TocItem = { id: string; text: string }
export type Rendered = { title: string; html: string; toc: TocItem[] }
export declare function renderPost(markdown: string, options?: { siteUrl?: string }): Rendered
