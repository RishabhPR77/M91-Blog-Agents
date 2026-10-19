// Open Graph images (1200×630), drawn at build time with Satori and turned into PNG with resvg.
// Font: Inter (SIL Open Font License 1.1), bundled in src/og/fonts with its licence (OFL.txt).
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const font = (weight: 400 | 700) => readFileSync(resolve(process.cwd(), `src/og/fonts/inter-latin-${weight}-normal.woff`))
const fonts = [
  { name: 'Inter', data: font(400), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: font(700), weight: 700 as const, style: 'normal' as const }
]

/** The M91 logo (corner brackets + red square) as SVG. */
export function logoSvg({ size = 120, stroke = '#EDF0F3', background }: { size?: number; stroke?: string; background?: string } = {}) {
  const line = (points: string) => `<polyline points="${points}" stroke="${stroke}" stroke-width="13" stroke-linecap="square" fill="none"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">${background ? `<rect width="120" height="120" fill="${background}"/>` : ''}${line('20,20 44,20 20,20 20,44')}${line('76,20 100,20 100,20 100,44')}${line('20,76 20,100 20,100 44,100')}${line('100,76 100,100 100,100 76,100')}<rect x="45" y="45" width="30" height="30" fill="#FF5257"/></svg>`
}

type El = { type: string; props: Record<string, unknown> }
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({ type, props: { style, children, ...extra } })

export async function ogPng({ title, kicker }: { title: string; kicker: string }): Promise<Uint8Array<ArrayBuffer>> {
  const logo = `data:image/svg+xml;base64,${Buffer.from(logoSvg({ size: 72 })).toString('base64')}`
  const tree = el('div', { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', background: '#0B1119', color: '#EDF0F3', fontFamily: 'Inter' }, [
    el('div', { display: 'flex', alignItems: 'center', gap: '20px' }, [
      el('img', { width: 72, height: 72 }, undefined, { src: logo, width: 72, height: 72 }),
      el('div', { fontSize: 40, fontWeight: 700 }, 'M91 Blog')
    ]),
    el('div', { display: 'flex', fontSize: title.length > 70 ? 56 : 66, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em', maxHeight: 320, overflow: 'hidden' }, title),
    el('div', { display: 'flex', alignItems: 'center' }, [
      el('div', { display: 'flex', background: '#DFF56B', color: '#0B0E12', borderRadius: 999, padding: '10px 26px', fontSize: 28, fontWeight: 700 }, kicker)
    ])
  ])
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts })
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng())
}

export function logoPng(size = 512): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new Resvg(logoSvg({ size, stroke: '#0B0E12', background: '#FFFFFF' })).render().asPng())
}
