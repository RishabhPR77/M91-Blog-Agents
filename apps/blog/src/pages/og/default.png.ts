// The fallback OG image for the home, topic and other pages.
import { ogPng } from '../../lib/og'
import { SITE } from '../../config/site'

export async function GET() {
  const png = await ogPng({ title: 'Getting a human decision when software needs one', kicker: SITE.name })
  return new Response(png, { headers: { 'Content-Type': 'image/png' } })
}
