// The preview: the blog page in a frame, drawn at a desktop or phone width and scaled to fit. While you type only
// the page's body is replaced, so the frame keeps its scroll position (a new srcdoc would jump to the top).
// The frame runs no script (sandbox without allow-scripts) and its outside links are inert.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const bodyOf = (html: string) => html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? ''
const titleOf = (html: string) => html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''

export function PreviewFrame({ html, device, className = '' }: { html: string; device: 'desktop' | 'phone'; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // The first page becomes the frame's document; later pages only swap its body.
  const [first] = useState(html)
  const width = device === 'phone' ? 390 : 1280

  useLayoutEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const doc = frame.current?.contentDocument
    if (!doc?.body || html === first) return
    doc.body.innerHTML = bodyOf(html)
    doc.title = titleOf(html)
  }, [html, first])

  const scale = size.w ? Math.min(1, size.w / width) : 1
  const left = Math.max(0, (size.w - width * scale) / 2)
  return (
    <div ref={box} className={`relative overflow-hidden bg-white ${className}`} data-testid="write-preview">
      <iframe
        ref={frame}
        title="Preview: the post as it will look on the blog"
        sandbox="allow-same-origin"
        srcDoc={first}
        onLoad={() => {
          // The page may have changed while the frame was loading.
          const doc = frame.current?.contentDocument
          if (doc?.body && html !== first) doc.body.innerHTML = bodyOf(html)
        }}
        style={{ position: 'absolute', top: 0, left, width, height: size.h ? size.h / scale : '100%', transform: `scale(${scale})`, transformOrigin: '0 0', border: 0 }}
      />
    </div>
  )
}
