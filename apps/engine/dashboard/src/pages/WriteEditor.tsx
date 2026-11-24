// /write/:id (id "new" for a new post) — the editor (2026-11-24). Paste or upload Markdown (a .md file's front matter
// fills the details), format it with the toolbar or the usual shortcuts, drop or paste images anywhere (they upload and
// land at the cursor), add a cover, and see the blog page as it will look, beside the text or full width, at desktop or
// phone width. Save as a draft, publish to the blog, update, unpublish or delete. 0 AI calls.
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bold, Code, Columns2, Eye, ExternalLink, FileUp, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Monitor, PenLine, Quote, Smartphone, Trash2, X } from 'lucide-react'
import { api, errorMessage, uploadImage } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, PageSkeleton } from '../components/Page'
import { toast } from '../components/Toasts'
import blogCss from '../blogpreview/blog.css?raw'
import { PreviewFrame } from '../write/PreviewFrame'
import { altFromFile, emptyFields, firstHeading, importMarkdown, insertBlock, isImageFile, isMarkdownFile, link, prefixLines, previewHtml, readingMinutes, replaceSelection, slugify, wordCount, wrap, type Edit, type Fields } from '../write/edit'
import { StatusPill, useBlogPosts, type BlogPostSummary } from './Write'

type FullPost = BlogPostSummary & { markdown: string }
type View = 'write' | 'split' | 'preview'
const MAX_IMAGE = 5 * 1024 * 1024
const BLOG_URL = 'https://m91-blog.embarko.app'

const fromPost = (p: FullPost): Fields => ({ title: p.title, slug: p.slug, description: p.description, topic: p.topic ?? '', tags: p.tags.join(', '), cover: p.cover, markdown: p.markdown })
const same = (a: Fields | null, b: Fields) => Boolean(a) && JSON.stringify(a) === JSON.stringify(b)
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

type Tool = { label: string; icon: ReactNode; keys?: string; run: (v: string, s: number, e: number) => Edit } | 'sep'
const TOOLS: Tool[] = [
  { label: 'Heading', icon: <Heading2 size={16} />, run: (v, s, e) => prefixLines(v, s, e, 'h2') },
  { label: 'Subheading', icon: <Heading3 size={16} />, run: (v, s, e) => prefixLines(v, s, e, 'h3') },
  'sep',
  { label: 'Bold', icon: <Bold size={16} />, keys: 'Ctrl+B', run: (v, s, e) => wrap(v, s, e, '**', 'bold text') },
  { label: 'Italic', icon: <Italic size={16} />, keys: 'Ctrl+I', run: (v, s, e) => wrap(v, s, e, '_', 'italic text') },
  { label: 'Link', icon: <Link2 size={16} />, keys: 'Ctrl+K', run: (v, s, e) => link(v, s, e) },
  { label: 'Code', icon: <Code size={16} />, run: (v, s, e) => (v.slice(s, e).includes('\n') ? replaceSelection(v, s, e, `\`\`\`\n${v.slice(s, e)}\n\`\`\``) : wrap(v, s, e, '`', 'code')) },
  'sep',
  { label: 'Quote', icon: <Quote size={16} />, run: (v, s, e) => prefixLines(v, s, e, 'quote') },
  { label: 'Bulleted list', icon: <List size={16} />, run: (v, s, e) => prefixLines(v, s, e, 'bullet') },
  { label: 'Numbered list', icon: <ListOrdered size={16} />, run: (v, s, e) => prefixLines(v, s, e, 'number') },
  { label: 'Divider', icon: <Minus size={16} />, run: (v, s, e) => insertBlock(v, s, e, '---') }
]

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; icon: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={value === o.id} title={o.label}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${value === o.id ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}>
          {o.icon}<span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export default function WriteEditor() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const list = useBlogPosts()
  const loaded = useQuery({ queryKey: ['blog-post', id], queryFn: () => api<{ post: FullPost }>(`/api/blog/posts/${id}`), enabled: !isNew, staleTime: Infinity })

  const [f, setF] = useState<Fields>(emptyFields)
  const [saved, setSaved] = useState<Fields | null>(isNew ? emptyFields() : null)
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [postId, setPostId] = useState<string | null>(isNew ? null : id)
  const [ready, setReady] = useState(isNew)
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth >= 1100 ? 'split' : 'write'))
  const [device, setDevice] = useState<'desktop' | 'phone'>('phone')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | 'publish' | 'unpublish' | 'delete' | { name: string; text: string }>(null)
  const [dropping, setDropping] = useState(false)
  const [uploads, setUploads] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const mdInput = useRef<HTMLInputElement>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const pendingSel = useRef<[number, number] | null>(null)
  const nextUpload = useRef(0)

  // Another post opened in the same editor (the address changed, and not by this post's first save): start over.
  const shownId = useRef(id)
  const savedAs = useRef<string | null>(null)
  useEffect(() => {
    if (shownId.current === id) return
    shownId.current = id
    if (id === savedAs.current) return
    setPostId(isNew ? null : id)
    setReady(isNew)
    setSaved(isNew ? emptyFields() : null)
    setF(emptyFields())
    setStatus('draft')
  }, [id, isNew])

  // An existing post, once loaded.
  useEffect(() => {
    if (ready || !loaded.data) return
    const p = loaded.data.post
    setF(fromPost(p))
    setSaved(fromPost(p))
    setStatus(p.status)
    setReady(true)
  }, [loaded.data, ready])

  // A .md file opened from the Write page.
  const imported = useRef(false)
  useEffect(() => {
    const st = location.state as { import?: { name: string; text: string } } | null
    if (!isNew || imported.current || !st?.import) return
    imported.current = true
    setF(importMarkdown(st.import.text, emptyFields()))
    toast('info', `${st.import.name} is in the editor. Check the details, then save.`)
    navigate(location.pathname, { replace: true, state: null })
  }, [isNew, location.state, location.pathname, navigate])

  const dirty = !same(saved, f)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useLayoutEffect(() => {
    const sel = pendingSel.current
    if (!sel || !ta.current) return
    pendingSel.current = null
    ta.current.focus()
    ta.current.setSelectionRange(sel[0], sel[1])
  }, [f.markdown])

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((cur) => ({ ...cur, [k]: v }))
  const apply = (edit: Edit) => {
    pendingSel.current = [edit.start, edit.end]
    set('markdown', edit.value)
  }
  const run = (fn: (v: string, s: number, e: number) => Edit) => {
    const el = ta.current
    const s = el?.selectionStart ?? f.markdown.length
    const e = el?.selectionEnd ?? s
    apply(fn(f.markdown, s, e))
  }

  async function addImages(files: File[]) {
    for (const file of files) {
      if (!isImageFile(file)) { toast('error', `${file.name}: only PNG, JPEG, GIF and WebP images can be added`); continue }
      if (file.size > MAX_IMAGE) { toast('error', `${file.name} is larger than 5 MB`); continue }
      const alt = altFromFile(file.name)
      const token = `![Uploading ${alt}…](uploading-${++nextUpload.current})`
      const el = ta.current
      const s = el?.selectionStart ?? f.markdown.length
      const e = el?.selectionEnd ?? s
      setF((cur) => ({ ...cur, markdown: insertBlock(cur.markdown, Math.min(s, cur.markdown.length), Math.min(e, cur.markdown.length), token).value }))
      setUploads((n) => n + 1)
      try {
        const img = await uploadImage(file)
        setF((cur) => ({ ...cur, markdown: cur.markdown.replace(token, `![${alt}](${img.url})`) }))
      } catch (err) {
        setF((cur) => ({ ...cur, markdown: cur.markdown.replace(`${token}\n`, '').replace(token, '') }))
        toast('error', `${file.name}: ${errorMessage(err)}`)
      } finally {
        setUploads((n) => n - 1)
      }
    }
  }

  async function setCover(file: File | undefined) {
    if (!file) return
    if (!isImageFile(file) || file.size > MAX_IMAGE) return toast('error', 'The cover must be a PNG, JPEG, GIF or WebP image of up to 5 MB')
    setUploads((n) => n + 1)
    try {
      set('cover', (await uploadImage(file)).url)
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setUploads((n) => n - 1)
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    if (!isMarkdownFile(file)) return toast('error', `${file.name} is not a Markdown file (.md)`)
    const text = await file.text()
    if (f.markdown.trim()) setConfirm({ name: file.name, text })
    else setF((cur) => importMarkdown(text, cur))
  }

  const onDrop = (e: DragEvent) => {
    const files = [...e.dataTransfer.files]
    if (!files.length) return
    e.preventDefault()
    setDropping(false)
    const md = files.find(isMarkdownFile)
    if (md) return void importFile(md)
    void addImages(files)
  }
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.files].filter(isImageFile)
    if (images.length) {
      e.preventDefault()
      return void addImages(images)
    }
    const text = e.clipboardData.getData('text/plain')
    // A whole file pasted into an empty editor: its front matter fills the details.
    if (!f.markdown.trim() && /^﻿?---\r?\n/.test(text)) {
      e.preventDefault()
      setF((cur) => importMarkdown(text, cur))
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    const tool = k === 'b' ? TOOLS[3] : k === 'i' ? TOOLS[4] : k === 'k' ? TOOLS[5] : null
    if (tool && tool !== 'sep') {
      e.preventDefault()
      run(tool.run)
    }
  }

  async function save(publish?: boolean) {
    if (!f.markdown.trim()) return toast('error', 'The post has no text yet')
    if (!f.title.trim() && !firstHeading(f.markdown)) return toast('error', 'Give the post a title (or start the text with "# Title")')
    setBusy(true)
    const sent = f
    const body = { title: f.title, slug: f.slug || undefined, description: f.description, topic: f.topic, tags: f.tags, cover: f.cover, markdown: f.markdown, ...(publish !== undefined && { publish }) }
    try {
      const { post } = postId
        ? await api<{ post: FullPost }>(`/api/blog/posts/${postId}`, { method: 'PUT', body })
        : await api<{ post: FullPost }>('/api/blog/posts', { method: 'POST', body })
      const filled = { ...sent, title: sent.title || post.title, slug: sent.slug || post.slug }
      setSaved(filled)
      setF((cur) => ({ ...cur, title: cur.title || post.title, slug: cur.slug || post.slug }))
      setStatus(post.status)
      qc.setQueryData(['blog-post', post.id], { post })
      void qc.invalidateQueries({ queryKey: ['blog-posts'] })
      if (!postId) {
        savedAs.current = post.id
        setPostId(post.id)
        navigate(`/write/${post.id}`, { replace: true })
      }
      toast('success', publish === true ? 'Published. It is on the blog within a minute.' : post.status === 'published' ? 'Updated on the blog (within a minute).' : 'Draft saved.')
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function toggle(publish: boolean) {
    if (!postId) return
    if (dirty) return save(publish)
    setBusy(true)
    try {
      const { post } = await api<{ post: FullPost }>(`/api/blog/posts/${postId}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' })
      setStatus(post.status)
      void qc.invalidateQueries({ queryKey: ['blog-posts'] })
      toast('success', publish ? 'Published. It is on the blog within a minute.' : 'Taken off the blog. It is a draft again.')
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function remove() {
    if (!postId) return
    setBusy(true)
    try {
      await api(`/api/blog/posts/${postId}`, { method: 'DELETE' })
      setSaved(f)
      void qc.invalidateQueries({ queryKey: ['blog-posts'] })
      toast('success', 'Post deleted.')
      navigate('/write')
    } catch (err) {
      toast('error', errorMessage(err))
      setBusy(false)
      setConfirm(null)
    }
  }

  // Ctrl+S saves (a draft stays a draft, a published post is updated).
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const blogUrl = list.data?.blog_url ?? BLOG_URL
  const deferred = useDeferredValue(f)
  const html = useMemo(() => previewHtml(deferred, { blogUrl, css: blogCss, date: today() }), [deferred, blogUrl])
  const slug = f.slug || slugify(f.title || firstHeading(f.markdown))
  const words = wordCount(f.markdown)

  if (!isNew && loaded.isError) return <EmptyState>This post could not be loaded. <Link className="underline" to="/write">Back to your posts</Link>.</EmptyState>
  if (!ready) return <PageSkeleton />

  const showEditor = view !== 'preview'
  const showPreview = view !== 'write'
  return (
    <div className="relative left-1/2 w-[min(calc(100vw-2.5rem),1560px)] -translate-x-1/2" data-testid="write-editor">
      {/* The bar: back, what this is, how to look at it, and what to do with it. */}
      <div className="sticky top-16 z-20 -mx-1 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-bg/90 px-1 py-3 backdrop-blur">
        <Link to="/write" className="btn-ghost -ml-2" aria-label="All your posts"><ArrowLeft size={16} /><span className="hidden sm:inline">Posts</span></Link>
        <StatusPill status={status} />
        <span className="text-xs text-ink-3" data-testid="write-state">{uploads ? `Uploading ${uploads} image${uploads > 1 ? 's' : ''}…` : busy ? 'Saving…' : dirty ? 'Unsaved changes' : postId ? 'All changes saved' : 'Not saved yet'}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented label="View" value={view} onChange={(v) => { setView(v); setDevice(v === 'preview' ? 'desktop' : 'phone') }} options={[{ id: 'write', label: 'Write', icon: <PenLine size={14} /> }, { id: 'split', label: 'Side by side', icon: <Columns2 size={14} /> }, { id: 'preview', label: 'Preview', icon: <Eye size={14} /> }]} />
          {showPreview && <Segmented label="Preview width" value={device} onChange={setDevice} options={[{ id: 'desktop', label: 'Desktop', icon: <Monitor size={14} /> }, { id: 'phone', label: 'Phone', icon: <Smartphone size={14} /> }]} />}
          {status === 'published' ? (
            <>
              <a className="btn-ghost" href={`${blogUrl}/posts/${saved?.slug || slug}`} target="_blank" rel="noopener noreferrer" title="Open on the blog"><ExternalLink size={15} /></a>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirm('unpublish')}>Unpublish</button>
              <button type="button" className="btn-primary" disabled={busy || uploads > 0 || !dirty} onClick={() => void save()}>Update</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" disabled={busy || uploads > 0} onClick={() => void save(false)}>Save draft</button>
              <button type="button" className="btn-primary" disabled={busy || uploads > 0} onClick={() => setConfirm('publish')}>Publish</button>
            </>
          )}
          {postId && <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm('delete')} aria-label="Delete this post" title="Delete"><Trash2 size={15} /></button>}
        </div>
      </div>

      <div className={`grid items-start gap-8 ${view === 'split' ? 'lg:grid-cols-2' : ''}`}>
        {showEditor && (
          <div className="min-w-0 space-y-5">
            {/* The cover (optional) */}
            {f.cover ? (
              <div className="group relative overflow-hidden rounded-2xl border border-line">
                <img src={f.cover.startsWith('/images/') ? `/api/public${f.cover}` : f.cover} alt="The cover" className="max-h-64 w-full object-cover" />
                <button type="button" className="btn-secondary absolute top-3 right-3 bg-surface/90" onClick={() => set('cover', null)}><X size={14} /> Remove cover</button>
              </div>
            ) : (
              <button type="button" onClick={() => coverInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void setCover(e.dataTransfer.files[0]) }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 py-4 text-sm text-ink-3 transition-colors hover:border-ink/40 hover:text-ink">
                <ImagePlus size={16} /> Add a cover image (optional): drop it here or choose one
              </button>
            )}
            <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" aria-label="Choose a cover image" onChange={(e) => { void setCover(e.target.files?.[0]); e.target.value = '' }} />

            <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={firstHeading(f.markdown) || 'Title'} aria-label="Title"
              className="w-full border-0 bg-transparent font-serif text-[34px] leading-tight font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-ink-3/70" />
            <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="A short description: shown on the post’s card and to search engines" aria-label="Description"
              className="w-full resize-none border-0 bg-transparent text-[16px] leading-relaxed text-ink-2 outline-none placeholder:text-ink-3/70" />
            <p className={`-mt-3 text-right text-[11px] ${f.description.length > 160 ? 'text-amber-700' : 'text-ink-3'}`}>{f.description.length}/160</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs text-ink-3">Topic
                <input className="input mt-1" list="write-topics" value={f.topic} onChange={(e) => set('topic', e.target.value)} placeholder="AI agents, On-call…" />
                <datalist id="write-topics">{(list.data?.topics ?? []).map((t) => <option key={t} value={t} />)}</datalist>
              </label>
              <label className="block text-xs text-ink-3">Tags (comma separated)
                <input className="input mt-1" value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="approvals, on-call" />
              </label>
              <label className="block text-xs text-ink-3 sm:col-span-2">Web address
                <span className="mt-1 flex items-center rounded-xl border border-line-strong bg-surface pl-3.5 text-sm text-ink-3 focus-within:border-ink/50">
                  <span className="max-w-[55%] min-w-0 shrink truncate">{blogUrl.replace('https://', '')}/posts/</span>
                  <input className="min-w-0 flex-1 bg-transparent py-2.5 pr-3.5 text-ink outline-none" value={f.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder={slug || 'your-post'} aria-label="Web address" />
                </span>
                {status === 'published' && saved?.slug && f.slug && f.slug !== saved.slug && <span className="mt-1 block text-amber-700">Changing the address breaks links to the old one.</span>}
              </label>
            </div>

            {/* The text */}
            <div className={`rounded-2xl border bg-surface transition-colors ${dropping ? 'border-lime-500 ring-4 ring-lime-300/40' : 'border-line'}`}>
              <div className="sticky top-[8.5rem] z-10 flex flex-wrap items-center gap-0.5 rounded-t-2xl border-b border-line bg-surface/95 px-2 py-1.5 backdrop-blur" role="toolbar" aria-label="Formatting">
                {TOOLS.map((t, i) => t === 'sep'
                  ? <span key={i} className="mx-1 h-5 w-px bg-line" aria-hidden />
                  : <button key={t.label} type="button" className="rounded-lg p-2 text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink" title={t.keys ? `${t.label} (${t.keys})` : t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => run(t.run)}>{t.icon}</button>)}
                <span className="mx-1 h-5 w-px bg-line" aria-hidden />
                <button type="button" className="rounded-lg p-2 text-ink-2 hover:bg-ink/[0.06] hover:text-ink" title="Add images" aria-label="Add images" onMouseDown={(e) => e.preventDefault()} onClick={() => imgInput.current?.click()}><ImagePlus size={16} /></button>
                <button type="button" className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-ink/[0.06] hover:text-ink" onClick={() => mdInput.current?.click()}><FileUp size={14} /> Upload .md</button>
              </div>
              <textarea
                ref={ta}
                value={f.markdown}
                onChange={(e) => set('markdown', e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
                onDragLeave={() => setDropping(false)}
                onDrop={onDrop}
                spellCheck
                aria-label="The post, in Markdown"
                placeholder={'Paste your Markdown here, or drop a .md file.\n\n# Title\n\nThe first paragraph…\n\n## A question your reader asks\n\nDrop or paste an image to add it at the cursor.'}
                className="block min-h-[65vh] w-full resize-y rounded-b-2xl bg-transparent px-5 py-4 font-mono text-[14px] leading-7 text-ink outline-none placeholder:text-ink-3/70"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
                <span>{words.toLocaleString('en-US')} words · {readingMinutes(f.markdown)} min read</span>
                <span>Drop or paste images: they go in at the cursor · Ctrl+S saves</span>
              </div>
            </div>
            <input ref={imgInput} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" aria-label="Choose images" onChange={(e) => { void addImages([...(e.target.files ?? [])]); e.target.value = '' }} />
            <input ref={mdInput} type="file" accept=".md,.markdown,.mdx,.txt,text/markdown" className="hidden" aria-label="Choose a Markdown file" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        )}

        {showPreview && (
          <div className={`min-w-0 ${view === 'split' ? 'lg:sticky lg:top-[8.5rem]' : ''}`}>
            <p className="eyebrow mb-2">Preview · how it will look on the blog</p>
            <PreviewFrame html={html} device={device} className={`rounded-2xl border border-line ${view === 'split' ? 'h-[70vh] lg:h-[calc(100vh-11rem)]' : 'h-[calc(100vh-12rem)] min-h-[520px]'}`} />
          </div>
        )}
      </div>

      <ConfirmDialog open={confirm === 'publish'} title="Publish this post?" expectedCalls="0" confirmLabel="Publish" busy={busy} onConfirm={() => (postId && !dirty ? toggle(true) : save(true))} onCancel={() => setConfirm(null)}>
        <p>It will be public at <strong>{blogUrl.replace('https://', '')}/posts/{slug}</strong> within about a minute, next to the engine’s posts.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'unpublish'} title="Take this post off the blog?" expectedCalls="0" confirmLabel="Unpublish" busy={busy} onConfirm={() => toggle(false)} onCancel={() => setConfirm(null)}>
        <p>It goes back to being a draft. Links to it stop working until you publish it again.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'delete'} title="Delete this post?" expectedCalls="0" confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setConfirm(null)}>
        <p>{status === 'published' ? 'It comes off the blog and ' : ''}its text is deleted for good. Uploaded images stay (other posts may use them).</p>
      </ConfirmDialog>
      <ConfirmDialog open={typeof confirm === 'object' && confirm !== null} title="Replace the text?" expectedCalls="0" confirmLabel="Replace" busy={busy}
        onConfirm={() => { if (confirm && typeof confirm === 'object') setF((cur) => importMarkdown(confirm.text, { ...cur, markdown: '' })); setConfirm(null) }} onCancel={() => setConfirm(null)}>
        <p>{confirm && typeof confirm === 'object' ? confirm.name : 'The file'} replaces the text in the editor. Details you already filled in stay.</p>
      </ConfirmDialog>
    </div>
  )
}
