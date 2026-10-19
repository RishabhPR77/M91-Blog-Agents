import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, setUnauthorizedHandler } from '../src/api/client'
import { mockFetch } from './helpers'

describe('api client', () => {
  it('returns JSON on success and sends JSON bodies', async () => {
    const calls = mockFetch({ 'POST /api/runs': { status: 202, body: { run_id: 'R-261019-1200-ABCD' } } })
    expect(await api('/api/runs', { method: 'POST', body: { mode: 'scout' } })).toEqual({ run_id: 'R-261019-1200-ABCD' })
    expect(calls[0]).toEqual({ method: 'POST', path: '/api/runs', body: { mode: 'scout' } })
  })

  it.each([
    [409, 'run_in_progress', 'run R-261019-1100-AAAA is in progress'],
    [400, 'quote_not_found', 'quote(s) not found in the draft: "x"'],
    [404, 'not_found', 'no run R-1']
  ])('turns %i { error: { code, message } } into an ApiError', async (status, code, message) => {
    mockFetch({ 'GET /api/x': { status, body: { error: { code, message } } } })
    const err = (await api('/api/x').catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect([err.status, err.code, err.message]).toEqual([status, code, message])
  })

  it('401 calls the unauthorized handler (but not for /api/login itself)', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    mockFetch({
      'GET /api/runs': { status: 401, body: { error: { code: 'unauthorized', message: 'log in first' } } },
      'POST /api/login': { status: 401, body: { error: { code: 'bad_password', message: 'wrong password' } } }
    })
    await expect(api('/api/runs')).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    await expect(api('/api/login', { method: 'POST', body: { password: 'x' } })).rejects.toMatchObject({ code: 'bad_password' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    setUnauthorizedHandler(null)
  })

  it('network failures become ApiError status 0 "network"; odd error bodies still give a message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(api('/api/health')).rejects.toMatchObject({ status: 0, code: 'network' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500, statusText: 'Internal Server Error' })))
    await expect(api('/api/runs')).rejects.toMatchObject({ status: 500, code: 'http_500', message: 'Internal Server Error' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'a run is already in progress' }), { status: 409 })))
    await expect(api('/api/runs')).rejects.toMatchObject({ status: 409, message: 'a run is already in progress' })
  })

  it('only same-origin /api/* paths are allowed', async () => {
    await expect(api('https://example.com/api/x')).rejects.toMatchObject({ code: 'bad_path' })
    await expect(api('/health')).rejects.toMatchObject({ code: 'bad_path' })
  })
})
