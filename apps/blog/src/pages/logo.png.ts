// The M91 logo as PNG, for JSON-LD (publisher logo).
import { logoPng } from '../lib/og'

export function GET() {
  return new Response(logoPng(512), { headers: { 'Content-Type': 'image/png' } })
}
