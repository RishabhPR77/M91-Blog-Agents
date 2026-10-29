// /week — This week: what the next run writes about (a pinned topic, the news you chose with Write now, or the weekly
// editor's choice at run time), the editor's latest decisions with why (and runners-up you can pin for next week),
// this week's news cards and the guides already live on msg91.com/guide.
import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { useRuns, useSettings } from '../api/queries'
import { nextRunText, useWeekly } from '../api/weekly'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { PickCard } from '../components/PickCard'
import { TimelySection } from '../components/TimelySection'
import { GuidesSection } from '../components/GuidesSection'

export default function Week() {
  const weekly = useWeekly()
  const settings = useSettings()
  const runs = useRuns(5)
  const runBusy = Boolean(runs.data?.some((r) => r.status === 'running'))
  const picks = weekly.data?.picks ?? []
  const waiting = weekly.data?.next.timely_waiting
  return (
    <>
      <PageHeader title="This week" subtitle="One post a week, so each run decides what is most useful now: real questions people asked, this week's news, and what M91 can newly do. Never a repeat of a live guide." />
      <Card className="mb-4" title={<span className="flex items-center gap-1.5"><CalendarDays size={15} /> The next run writes about</span>}>
        <p className="text-[15px]" data-testid="week-next">{weekly.isPending ? 'Loading…' : nextRunText(weekly.data?.next, weekly.data?.model)}</p>
        {waiting && <p className="mt-2 text-sm text-amber-800 dark:text-amber-200" data-testid="week-waiting">“{waiting.title}” (Write now) waits: {waiting.reason}.</p>}
        <p className="mt-2 text-xs text-slate-500">Pinned topics that are due go first, then a news card you chose with Write now. <Link className="underline" to="/pinned">Pinned topics</Link></p>
      </Card>
      <Card className="mb-4" title="The editor's latest decisions">
        {weekly.isPending ? <p className="text-sm text-slate-500">Loading…</p> : !picks.length ? (
          <EmptyState>No decisions yet. The next full run makes the first one.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="week-picks">
            {picks.map((p) => <li key={p.pick_id} className="py-4 first:pt-0 last:pb-0"><PickCard pick={p} showPost /></li>)}
          </ul>
        )}
      </Card>
      {settings.data?.timely?.enabled && <TimelySection runBusy={runBusy} />}
      <GuidesSection runBusy={runBusy} />
    </>
  )
}
