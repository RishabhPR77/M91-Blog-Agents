import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { Layout } from '../src/components/Layout'
import { safeNext } from '../src/pages/Login'
import { FakeEventSource, mockFetch, renderApp, SETTINGS } from './helpers'

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

describe('Layout', () => {
  it('shows engine status, the approvals badge, the DRY RUN default pill and the live indicator', async () => {
    mockFetch({
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } },
      'GET /api/settings': { body: SETTINGS },
      'GET /api/approvals': { body: { approvals: [{ brief_id: 'B', version: 3, brief_version: 1, title: 'T', total: null, waiting_since: null, record_id: 'm' }] } },
      'GET /api/runs?limit=5': { body: { runs: [] } }
    })
    renderApp(<Layout><p>page</p></Layout>)
    expect(await screen.findByText('Engine online · v0.2.0')).toBeInTheDocument()
    expect(await screen.findByLabelText('1 waiting')).toBeInTheDocument()
    expect(await screen.findByTestId('dry-run-default')).toHaveTextContent('Dry run by default')
    await waitFor(() => expect(FakeEventSource.instances.map((e) => e.url)).toContain('/api/events'))
    FakeEventSource.instances[0].open()
    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect(screen.queryByText(/Engine is not running/)).not.toBeInTheDocument()
  })

  it('engine offline → full-width banner, no event stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    renderApp(<Layout><p>page</p></Layout>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Engine is not running. Start it with npm run dev:engine.')
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Engine offline')
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('a running run adds the "Live run" link', async () => {
    mockFetch({
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: true } },
      'GET /api/settings': { body: { ...SETTINGS, runtime: { ...SETTINGS.runtime, dry_run: false } } },
      'GET /api/approvals': { body: { approvals: [] } },
      'GET /api/runs?limit=5': { body: { runs: [{ run_id: 'R-261019-1200-ABCD', status: 'running', mode: 'scout', steps: [] }] } }
    })
    renderApp(<Layout><p>page</p></Layout>)
    expect(await screen.findByRole('link', { name: /Live run/ })).toHaveAttribute('href', '/runs/R-261019-1200-ABCD')
    expect(await screen.findByTestId('dry-run-default')).toHaveTextContent('Live runs by default')
  })
})

describe('login redirect target', () => {
  it('only follows same-app paths', () => {
    expect(safeNext('/approvals/261019-1055-BZ89')).toBe('/approvals/261019-1055-BZ89')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('/login')).toBe('/')
    expect(safeNext(null)).toBe('/')
  })
})

describe('The sliding pill in the top tabs', () => {
  // jsdom has no layout: each tab gets a fixed box by its text, the bar starts at x = 100.
  const BOX: Record<string, [number, number]> = { Home: [104, 80], Review: [184, 90], 'Posts & runs': [274, 120], Memory: [394, 100], More: [494, 90] }
  const pillOf = () => document.querySelector('nav[aria-label="Main"] > span[aria-hidden]') as HTMLElement

  it.each([['/', 4, 80], ['/memory', 294, 100], ['/week', 394, 90]])('on %s it sits on the active tab (a page under More: on More, not on Home)', async (route, left, width) => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('nav[aria-label="Main"]')) return { left: 100, top: 0, width: 600, height: 40, right: 700, bottom: 40, x: 100, y: 0, toJSON() {} } as DOMRect
      const key = Object.keys(BOX).find((k) => this.textContent?.trim().startsWith(k))
      const [l, w] = key ? BOX[key] : [0, 0]
      return { left: l, top: 0, width: w, height: 32, right: l + w, bottom: 32, x: l, y: 0, toJSON() {} } as DOMRect
    })
    mockFetch({
      'GET /api/health': { body: { ok: true, version: '0.2.0', run_in_progress: false } },
      'GET /api/settings': { body: SETTINGS },
      'GET /api/approvals': { body: { approvals: [] } },
      'GET /api/runs?limit=5': { body: { runs: [] } }
    })
    try {
      renderApp(<Layout><p>page</p></Layout>, { route })
      await waitFor(() => expect(pillOf().style.transform).toBe(`translateX(${left}px)`))
      expect(pillOf().style.width).toBe(`${width}px`)
    } finally {
      spy.mockRestore()
    }
  })
})
