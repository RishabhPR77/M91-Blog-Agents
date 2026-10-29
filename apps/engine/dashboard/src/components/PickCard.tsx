// One weekly editor decision: the post it chose and why (the signals it cited, the news hook), and the runners-up.
// A runner-up can be pinned for next week (a pinned topic goes before the editor).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Lightbulb, MessageCircleQuestion, Newspaper, Pin, Sparkles } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { CHOSEN_LABEL, FORMAT_LABEL, weeklyKey, type Evidence, type WeeklyPick } from '../api/weekly'
import { fmtDateTime } from '../format'
import { toast } from './Toasts'

const KIND_ICON: Record<string, JSX.Element> = {
  question: <MessageCircleQuestion size={13} />, news: <Newspaper size={13} />, m91_change: <Sparkles size={13} />, m91_integration: <Sparkles size={13} />, pinned_idea: <Pin size={13} />
}
const KIND_LABEL: Record<string, string> = { question: 'People asked', news: 'This week’s news', m91_change: 'New in M91', m91_integration: 'M91 integration', pinned_idea: 'Your pinned idea' }

/** The date a week from today (YYYY-MM-DD), for "Pin for next week". */
const nextWeek = (now = Date.now()) => new Date(now + 7 * 86400000).toISOString().slice(0, 10)

function EvidenceRow({ e }: { e: Evidence }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-slate-400">{KIND_ICON[e.kind] ?? <Lightbulb size={13} />}</span>
      <span className="min-w-0">
        <span className="text-xs font-medium text-slate-500">{KIND_LABEL[e.kind] ?? e.kind}{e.where ? ` · ${e.where}` : ''}{e.demand ? ` · ${e.demand}` : ''}</span>
        <span className="block">{e.url ? <a className="text-sky-700 underline underline-offset-2 dark:text-sky-300" href={e.url} target="_blank" rel="noopener noreferrer">{e.text}</a> : e.text}</span>
      </span>
    </li>
  )
}

export function PickCard({ pick, showPost = false, canPin = true }: { pick: WeeklyPick; showPost?: boolean; canPin?: boolean }) {
  const qc = useQueryClient()
  const [pinned, setPinned] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const p = pick.pick

  async function pin(topic: string) {
    setBusy(true)
    try {
      await api('/api/pinned', { method: 'POST', body: { topic, date: nextWeek(), notes: 'A runner-up of the weekly editor' } })
      setPinned((x) => [...x, topic])
      void qc.invalidateQueries({ queryKey: ['pinned'] })
      void qc.invalidateQueries({ queryKey: weeklyKey })
      toast('success', `Pinned for next week: ${topic}`)
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid={`pick-${pick.pick_id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="pill pill-blue">{FORMAT_LABEL[p.format] ?? p.format}</span>
        <span>{CHOSEN_LABEL[pick.chosen_by] ?? pick.chosen_by}</span>
        <span>· {fmtDateTime(pick.chosen_at)}</span>
        {pick.model && <span className="font-mono">· {pick.model}</span>}
      </div>
      <h3 className="mt-2 text-base font-semibold">
        {showPost && pick.brief_id ? <Link to={`/approvals/${pick.brief_id}`} className="hover:underline">{p.title}</Link> : p.title}
      </h3>
      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">Answers: “{p.question}”</p>
      <p className="mt-2 text-[15px]" data-testid="pick-reason"><span className="font-medium">Why this week: </span>{pick.reason}</p>
      {p.hook && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-400/10" data-testid="pick-hook">
          <Newspaper size={14} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>Opens with this week’s news: <a className="underline underline-offset-2" href={p.hook.source_url} target="_blank" rel="noopener noreferrer">{p.hook.title}</a>{p.hook.outlet ? ` (${p.hook.outlet}${p.hook.published_date ? `, ${p.hook.published_date}` : ''})` : ''}</span>
        </p>
      )}
      {p.evidence?.length ? (
        <details className="mt-3" open>
          <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-500 uppercase">The signals it used ({p.evidence.length})</summary>
          <ul className="mt-2 space-y-2" data-testid="pick-evidence">{p.evidence.map((e) => <EvidenceRow key={e.id} e={e} />)}</ul>
        </details>
      ) : null}
      {pick.runners_up?.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-500 uppercase">Runners-up ({pick.runners_up.length})</summary>
          <ul className="mt-2 space-y-2" data-testid="pick-runners-up">
            {pick.runners_up.map((r) => (
              <li key={r.title} className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <span className="pill pill-gray">{FORMAT_LABEL[r.format] ?? r.format}</span>
                  {canPin && !r.left_out && (
                    <button type="button" className="btn-secondary ml-auto px-2 py-1 text-xs" disabled={busy || pinned.includes(r.question)} onClick={() => void pin(r.question)}>
                      <Pin size={12} /> {pinned.includes(r.question) ? 'Pinned' : 'Pin for next week'}
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{r.left_out ? `Left out: ${r.left_out}` : r.why_now}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
