// The roadmap slot of a post (Phase 12), on the approval screen: its stage and level, the reader's question, what
// it teaches, the earlier posts it builds on, and the Strategist's "why today" (how it builds on them).
import { Link } from 'react-router-dom'
import { Card } from './Page'
import { StatusBadge } from './StatusBadge'

export type SlotInfo = {
  slot_id: string
  title_idea: string
  question: string
  teaches: string[]
  status: string
  stage: { number: number; name: string; level: string }
  builds_on: { slot_id: string; title: string; status: string; brief_id: string | null }[]
  why_today: string | null
  terms_to_define: string[]
}

export function SlotCard({ slot }: { slot: SlotInfo | null | undefined }) {
  if (!slot) return null
  return (
    <Card title="Roadmap" actions={<Link className="text-xs text-sky-700 underline dark:text-sky-300" to="/roadmap">open the roadmap</Link>}>
      <div className="text-sm" data-testid="slot-card">
        <p><span className="font-medium">Stage {slot.stage.number} · {slot.stage.name}</span> <span className="text-xs text-slate-500">({slot.stage.level})</span> · <span className="font-mono text-xs">{slot.slot_id}</span> {slot.title_idea}</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">{slot.question}</p>
        <p className="mt-1 text-xs text-slate-500">Teaches: {slot.teaches.join(', ') || '—'}{slot.terms_to_define.length ? ` · explains: ${slot.terms_to_define.join(', ')}` : ''}</p>
        <div className="mt-2" data-testid="builds-on">
          <span className="text-xs font-semibold text-slate-500 uppercase">Builds on</span>
          {slot.builds_on.length ? (
            <ul className="mt-1 space-y-1">
              {slot.builds_on.map((b) => (
                <li key={b.slot_id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{b.slot_id}</span>
                  {b.brief_id ? <Link className="text-sky-700 underline dark:text-sky-300" to={`/approvals/${b.brief_id}`}>{b.title}</Link> : <span>{b.title}</span>}
                  <StatusBadge status={b.status === 'in_review' ? 'awaiting_human' : b.status} label={b.status.replace('_', ' ')} />
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-slate-500">Nothing: this post is a starting point.</p>}
        </div>
        {slot.why_today && <p className="mt-2 text-sm"><span className="text-slate-500">How it builds on them: </span>{slot.why_today}</p>}
      </div>
    </Card>
  )
}
