// The Write page (2026-11-24): the text helpers, the list, importing a .md file, saving and publishing, and images.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Write from '../src/pages/Write'
import WriteEditor from '../src/pages/WriteEditor'
import { Toasts } from '../src/components/Toasts'
import { altFromFile, emptyFields, importMarkdown, insertBlock, link, parseFrontMatter, prefixLines, previewHtml, wrap } from '../src/write/edit'
import { mockFetch, renderApp } from './helpers'

const IMG = '/images/0123456789abcdef0123.png'
const FILE_MD = '---\ntitle: "Who answers at 2 AM?"\ndescription: Night alerts that get answered.\ntags: [on-call, approvals]\ntopic: On-call\n---\n# Who answers at 2 AM?\n\nA phone that rings until someone answers.\n'
const LIST = {
  posts: [
    { id: 'p-1', status: 'published', title: 'Written by me', slug: 'written-by-me', description: '', topic: 'On-call', tags: [], cover: null, created_at: '2026-11-24T10:00:00+05:30', updated_at: '2026-11-24T10:00:00+05:30', published_at: '2026-11-24T10:00:00+05:30' },
    { id: 'p-2', status: 'draft', title: 'Half done', slug: 'half-done', description: '', topic: null, tags: [], cover: null, created_at: null, updated_at: '2026-11-24T09:00:00+05:30', published_at: null }
  ],
  engine_posts: [{ slug: 'from-the-engine', title: 'From the engine', date: '2026-11-14', topic: 'AI agents', reading_minutes: 11 }],
  topics: ['AI agents', 'On-call'],
  blog_url: 'https://m91-blog.embarko.app'
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

const page = (route: string) => renderApp(<><Toasts /><Routes><Route path="/write" element={<Write />} /><Route path="/write/:id" element={<WriteEditor />} /></Routes></>, { route })
const textarea = () => screen.getByLabelText('The post, in Markdown') as HTMLTextAreaElement

describe('the text helpers', () => {
  it('front matter: key: value, [lists] and - items; the text after it', () => {
    const { meta, body } = parseFrontMatter('---\ntitle: "A"\ntags:\n  - x\n  - "y"\nkeywords: [a, b]\n---\n\n# A\n')
    expect(meta).toEqual({ title: 'A', tags: ['x', 'y'], keywords: ['a', 'b'] })
    expect(body).toBe('# A\n')
    expect(parseFrontMatter('# No front matter').body).toBe('# No front matter')
  })

  it('a .md file fills the empty details and keeps the ones already typed', () => {
    const f = importMarkdown(FILE_MD, { ...emptyFields(), topic: 'Mine' })
    expect([f.title, f.description, f.tags, f.topic]).toEqual(['Who answers at 2 AM?', 'Night alerts that get answered.', 'on-call, approvals', 'Mine'])
    expect(f.markdown).toBe('# Who answers at 2 AM?\n\nA phone that rings until someone answers.\n')
    expect(importMarkdown('# Only a heading\n\nText', emptyFields()).title).toBe('Only a heading')
  })

  it('formatting: bold wraps and unwraps, lists number their lines, a link selects its address, blocks get blank lines', () => {
    expect(wrap('make this bold', 5, 9, '**', 'x')).toEqual({ value: 'make **this** bold', start: 7, end: 11 })
    expect(wrap('make **this** bold', 7, 11, '**', 'x')).toEqual({ value: 'make this bold', start: 5, end: 9 })
    expect(wrap('', 0, 0, '_', 'italic text').value).toBe('_italic text_')
    expect(prefixLines('one\ntwo\nthree', 0, 9, 'number').value).toBe('1. one\n2. two\n3. three')
    expect(prefixLines('## Title', 3, 3, 'h2').value).toBe('Title')
    expect(prefixLines('- a\n- b', 0, 7, 'quote').value).toBe('> a\n> b')
    const l = link('see docs', 4, 8)
    expect(l.value).toBe('see [docs](https://)')
    expect(l.value.slice(l.start, l.end)).toBe('https://')
    expect(insertBlock('para', 4, 4, `![a](${IMG})`).value).toBe(`para\n\n![a](${IMG})\n`)
    expect(insertBlock('', 0, 0, '---').value).toBe('---\n')
    expect(altFromFile('lock_screen-alert.PNG')).toBe('lock screen alert')
  })

  it('the preview is the blog page: its stylesheet inline, uploaded images from the engine, outside links inert', () => {
    const html = previewHtml({ ...emptyFields(), title: 'My <post>', description: 'About it.', cover: IMG, markdown: `# My post\n\nIntro.\n\n![Phone](${IMG} "A caption")\n\n## TL;DR\n\n- One\n` }, { blogUrl: 'https://m91-blog.embarko.app', css: '.x{color:red}', date: '2026-11-24' })
    expect(html).toMatch(/<h1 class="h1">My &lt;post&gt;<\/h1>/)
    expect(html).toContain('<style>.x{color:red}')
    expect(html).not.toMatch(/<link rel="stylesheet"/)
    expect(html).toContain('src="/api/public/images/0123456789abcdef0123.png"')
    expect(html).not.toContain('src="/images/')
    expect(html).toContain('<span class="caption">A caption</span>')
    expect(html).toContain('<aside class="tldr"')
    expect(html).toContain('<figure class="cover shell">')
    expect(html).toContain('a:not([href^="#"]){pointer-events:none}')
    expect(html).not.toMatch(/<script src=/)
    expect(html).toContain('<div class="share" aria-label="Share this post">') // the blog's current template
  })
})

describe('the Write page', () => {
  it('lists your posts with their status and the engine’s posts already on the blog', async () => {
    mockFetch({ 'GET /api/blog/posts': { body: LIST } })
    page('/write')
    const list = await screen.findByTestId('write-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('On the blog')).toBeInTheDocument()
    expect(within(list).getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Written by me on the blog' })).toHaveAttribute('href', 'https://m91-blog.embarko.app/posts/written-by-me')
    expect(screen.getByText('From the engine')).toBeInTheDocument()
  })

  it('a .md file dropped on the page opens a new post with its details filled', async () => {
    mockFetch({ 'GET /api/blog/posts': { body: LIST } })
    page('/write')
    const drop = await screen.findByTestId('write-drop')
    fireEvent.drop(drop, { dataTransfer: { files: [new File([FILE_MD], 'night.md', { type: 'text/markdown' })], types: ['Files'] } })
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Who answers at 2 AM?'))
    expect(screen.getByLabelText('Description')).toHaveValue('Night alerts that get answered.')
    expect(textarea().value).toMatch(/^# Who answers at 2 AM\?/)
    expect(screen.getByTestId('write-state')).toHaveTextContent('Unsaved changes')
  })
})

describe('the editor', () => {
  it('a new post: type, save a draft (it becomes /write/<id>), then publish after the confirm', async () => {
    const calls = mockFetch({
      'GET /api/blog/posts': { body: LIST },
      'POST /api/blog/posts': (init) => {
        const b = JSON.parse(String(init?.body))
        return { status: 201, body: { post: { id: 'p-9', status: b.publish ? 'published' : 'draft', title: b.title || 'Night alerts', slug: b.slug ?? 'night-alerts', description: b.description, topic: b.topic || null, tags: [], cover: null, created_at: null, updated_at: null, published_at: null, markdown: b.markdown } } }
      },
      'POST /api/blog/posts/p-9/publish': { body: { post: { id: 'p-9', status: 'published', title: 'Night alerts', slug: 'night-alerts', description: '', topic: null, tags: [], cover: null, created_at: null, updated_at: null, published_at: null, markdown: '# Night alerts' } } },
      'PUT /api/blog/posts/p-9': (init) => {
        const b = JSON.parse(String(init?.body))
        return { body: { post: { id: 'p-9', status: b.publish ? 'published' : 'draft', title: b.title, slug: 'night-alerts', description: b.description, topic: null, tags: [], cover: null, created_at: null, updated_at: null, published_at: null, markdown: b.markdown } } }
      }
    })
    page('/write/new')
    await userEvent.type(textarea(), '# Night alerts{enter}{enter}They ring until answered.')
    expect(screen.queryByTestId('write-preview')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Side by side' }))
    const frame = screen.getByTestId('write-preview').querySelector('iframe')
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(frame?.getAttribute('srcdoc')).toContain('Night alerts')
    const box = textarea()
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(screen.getByTestId('write-state')).toHaveTextContent('All changes saved'))
    expect(textarea()).toBe(box) // the first save gives the post its address without starting the editor over
    expect(textarea().value).toBe('# Night alerts\n\nThey ring until answered.')
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/blog/posts')
    expect(post?.body).toMatchObject({ title: '', markdown: '# Night alerts\n\nThey ring until answered.', publish: false })
    expect(screen.getByLabelText('Title')).toHaveValue('Night alerts')
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('m91-blog.embarko.app/posts/night-alerts')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    // Nothing changed since the save: only the status changes.
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/blog/posts/p-9/publish')).toBe(true))
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(await screen.findByText('On the blog')).toBeInTheDocument()
  })

  it('an existing post loads; Update is off until something changes', async () => {
    mockFetch({
      'GET /api/blog/posts': { body: LIST },
      'GET /api/blog/posts/p-1': { body: { post: { ...LIST.posts[0], markdown: '# Written by me\n\nHello.\n' } } }
    })
    page('/write/p-1')
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Written by me'))
    const update = screen.getByRole('button', { name: 'Update' })
    expect(update).toBeDisabled()
    await userEvent.type(textarea(), ' More.')
    expect(update).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument()
  })

  it('a pasted or dropped image uploads and lands in the text as Markdown', async () => {
    mockFetch({ 'GET /api/blog/posts': { body: LIST } })
    const upload = vi.fn(async () => new Response(JSON.stringify({ image: { url: IMG, name: IMG.slice(8), bytes: 50, type: 'image/png' } }), { status: 201 }))
    const original = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (url === '/api/blog/images' ? upload() : original(url, init))))
    page('/write/new')
    await userEvent.type(textarea(), 'Intro.')
    fireEvent.paste(textarea(), { clipboardData: { files: [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'Lock screen.png', { type: 'image/png' })], getData: () => '' } })
    await waitFor(() => expect(textarea().value).toContain(`![Lock screen](${IMG})`))
    expect(upload).toHaveBeenCalledTimes(1)
    fireEvent.drop(textarea(), { dataTransfer: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })], types: ['Files'] } })
    expect(await screen.findByText(/notes\.pdf: only PNG, JPEG, GIF and WebP/)).toBeInTheDocument()
    expect(upload).toHaveBeenCalledTimes(1)
  })
})
