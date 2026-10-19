// /og/<slug>.png for every post (noindex posts too: their pages still work by direct link).
import type { APIContext } from 'astro'
import { getPosts, topicOf, type Post } from '../../lib/posts'
import { ogPng } from '../../lib/og'

export function getStaticPaths() {
  return getPosts().posts.map((post) => ({ params: { slug: post.slug }, props: { post } }))
}

export async function GET({ props }: APIContext) {
  const post = props.post as Post
  const png = await ogPng({ title: post.title, kicker: topicOf(post).name })
  return new Response(png, { headers: { 'Content-Type': 'image/png' } })
}
