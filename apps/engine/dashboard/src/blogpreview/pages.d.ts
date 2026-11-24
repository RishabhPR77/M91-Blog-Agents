// Types for pages.js, a copy of apps/m91-blog/src/pages.js (see markdown.d.ts).
import type { Rendered } from './markdown.js'

export type BlogConfig = { siteUrl: string; m91Url: string }
export type BlogPost = {
  slug: string
  title: string
  description: string
  topic: string | null
  tags: string[]
  date: string | null
  updated_at: string | null
  reading_minutes: number
  cover: string | null
}
export declare const BLOG_TITLE: string
export declare function fmtDay(day: string | null): string
export declare function postPage(cfg: BlogConfig, args: { post: BlogPost; rendered: Rendered; more: BlogPost[]; assets: { css: string; js?: string } }): string
