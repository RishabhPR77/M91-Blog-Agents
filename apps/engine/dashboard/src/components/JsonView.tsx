// Raw JSON of a record (as the API returned it) with a copy button.
import { Copy } from 'lucide-react'
import { toast } from './Toasts'

export async function copyText(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast('success', what)
  } catch {
    toast('error', 'Could not copy (the browser blocked the clipboard)')
  }
}

export function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2)
  return (
    <div className="relative">
      <button type="button" className="btn-secondary absolute top-2 right-2 py-1 text-xs" onClick={() => copyText(text, 'JSON copied')}><Copy size={12} /> Copy</button>
      <pre className="max-h-[36rem] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 pr-20 text-xs leading-5 dark:border-slate-800 dark:bg-slate-950" data-testid="json-view">{text}</pre>
    </div>
  )
}
