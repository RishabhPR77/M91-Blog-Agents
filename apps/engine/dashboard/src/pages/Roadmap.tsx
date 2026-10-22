// /roadmap — the learning path (Phase 12): six stages, their slots with status, "Next up" highlighted. You approve
// the roadmap (runs need it), edit, move, skip or restore slots, accept or reject slots the Scout proposed, and
// generate or regenerate it (the Roadmap Planner: 1 AI call, +1 when there are no M91 facts yet).
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Pencil, Sparkles, X } from 'lucide-react'
import { api, errorMessage } from '../api/client'
import { roadmapKey, useRoadmap, nextUpText, type RoadmapSlot, type RoadmapStage } from '../api/roadmap'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, EmptyState, PageHeader } from '../components/Page'
import { StatusBadge } from '../components/StatusBadge'
import { TimelySection } from '../components/TimelySection'
import { useRuns, useSettings } from '../api/queries'
import { toast } from '../components/Toasts'
import { COSTS } from '../config/costs'
import { fmtDateTime } from '../format'

const SLOT_TONE: Record<string, string> = { planned: 'open', drafting: 'running', in_review: 'awaiting_human', approved: 'approved', skipped: 'skipped', proposed: 'changes_requested' }
const editable = (s: RoadmapSlot) => s.status === 'planned' || s.status === 'proposed'

export default function RoadmapPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useRoadmap()
  // The timely lane's cards (with RAPID_RESPONSE_ENABLED and the roadmap on).
  const settings = useSettings()
  const timelyOn = settings.data?.timely?.enabled === true
  const runBusy = Boolean(useRuns(5).data?.some((r) => r.status === 'running'))
  const [busy, setBusy] = useState(false)
  const [generate, setGenerate] = useState(false)
  const [approve, setApprove] = useState(false)
  const [editing, setEditing] = useState<RoadmapSlot | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(path: string, body: unknown, ok: string) {
    setBusy(true)
    setError(null)
    try {
      const r = await api(path, { method: 'POST', body })
      qc.setQueryData(roadmapKey, (old: unknown) => ({ ...(old as object), ...(r as object) }))
      void qc.invalidateQueries({ queryKey: roadmapKey })
      toast('success', ok)
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function startGenerate() {
    setBusy(true)
    setError(null)
    try {
      const { run_id } = await api<{ run_id: string }>('/api/runs', { method: 'POST', body: { mode: 'roadmap', dry_run: false, params: {} } })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      toast('success', 'Roadmap Planner started')
      navigate(`/runs/${run_id}`)
    } catch (e) {
      setError(errorMessage(e))
      setGenerate(false)
    } finally {
      setBusy(false)
    }
  }

  if (q.isPending) return <p className="text-sm text-slate-500">Loading…</p>
  const data = q.data
  const rm = data?.roadmap ?? null
  const next = data?.next
  const nextId = next?.kind === 'slot' ? next.slot_id : null
  const problems = data?.problems ?? []
  return (
    <>
      <PageHeader
        title="Roadmap"
        subtitle={<>The learning path: each post builds on the ones before it. Runs write the next slot of the approved roadmap (pinned topics first).</>}
        actions={
          <>
            {rm && <span data-testid="roadmap-status"><StatusBadge status={rm.status === 'approved' ? 'approved' : 'changes_requested'} label={rm.status} /></span>}
            {rm && rm.status !== 'approved' && <button type="button" className="btn-primary" disabled={busy || problems.length > 0} onClick={() => setApprove(true)}><Check size={14} /> Approve roadmap</button>}
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setGenerate(true)}><Sparkles size={14} /> {rm ? 'Regenerate' : 'Generate'} · {COSTS.roadmap.normal} AI calls</button>
          </>
        }
      />
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {problems.length > 0 && <div role="alert" data-testid="roadmap-problems" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">The roadmap has problems to fix before it can be approved: {problems.slice(0, 3).join('; ')}</div>}
      {!rm ? (
        <EmptyState>No roadmap yet. <strong>Generate</strong> plans the six stages from the M91 docs ({COSTS.roadmap.normal} AI calls). You review it here and approve it before the first run.</EmptyState>
      ) : (
        <>
          <Card className="mb-4">
            <p className="text-sm" data-testid="next-up"><span className="font-semibold">Next up:</span> {nextUpText(next)}</p>
            {next?.timely_waiting && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="next-up-timely-waiting">Timely card waiting: {next.timely_waiting.title} — {next.timely_waiting.reason}</p>}
            <p className="mt-1 text-xs text-slate-500">{rm.generated_at ? `Generated ${fmtDateTime(rm.generated_at)}` : ''}{rm.model_used ? ` · ${rm.model_used}` : ''}{rm.approved_at ? ` · approved ${fmtDateTime(rm.approved_at)}` : ''}{rm.notes && rm.notes !== 'none' ? ` · Planner notes: ${rm.notes}` : ''}</p>
          </Card>
          {timelyOn && <TimelySection runBusy={runBusy} />}
          <div className="space-y-4">
            {rm.stages.map((st) => <StageCard key={st.number} stage={st} nextId={nextId} busy={busy} onAct={act} onEdit={setEditing} />)}
          </div>
        </>
      )}
      <ConfirmDialog open={generate} title={rm ? 'Regenerate the roadmap?' : 'Generate the roadmap?'} expectedCalls={COSTS.roadmap.normal} expectedMem0={COSTS.roadmap.mem0} confirmLabel={rm ? 'Regenerate' : 'Generate'} busy={busy} onConfirm={startGenerate} onCancel={() => setGenerate(false)}>
        <p>The Roadmap Planner plans the stages from the M91 facts: 1 AI call, plus 1 when there are no M91 facts yet (the Scout reads the docs first).</p>
        {rm && <p>Slots that are drafting, in review, approved or skipped stay exactly as they are. The roadmap goes back to <strong>draft</strong>: approve it again before the next run.</p>}
      </ConfirmDialog>
      <ConfirmDialog open={approve} title="Approve the roadmap?" expectedCalls="0" expectedMem0="≈2" confirmLabel="Approve" busy={busy} onConfirm={async () => { if (await act('/api/roadmap/approve', {}, 'Roadmap approved')) setApprove(false) }} onCancel={() => setApprove(false)}>
        <p>Runs then write its slots in order, starting with {nextId ?? 'the first planned slot'}.</p>
      </ConfirmDialog>
      {editing && <EditDialog slot={editing} busy={busy} onCancel={() => setEditing(null)} onSave={async (changes) => { if (await act(`/api/roadmap/slots/${editing.slot_id}`, changes, `Slot ${editing.slot_id} saved`)) setEditing(null) }} />}
    </>
  )
}

function StageCard({ stage, nextId, busy, onAct, onEdit }: { stage: RoadmapStage; nextId: string | null; busy: boolean; onAct: (path: string, body: unknown, ok: string) => Promise<boolean>; onEdit: (s: RoadmapSlot) => void }) {
  return (
    <Card title={<>Stage {stage.number} · {stage.name} <span className="ml-1 text-xs font-normal text-slate-500">{stage.level}</span></>}>
      <p className="mb-3 text-xs text-slate-500">{stage.goal}</p>
      <ol className="space-y-2" aria-label={`Stage ${stage.number} slots`}>
        {stage.slots.map((s, i) => {
          const isNext = s.slot_id === nextId
          return (
            <li key={s.slot_id} data-testid={`slot-${s.slot_id}`} className={`rounded-lg border p-3 text-sm ${isNext ? 'border-sky-400 bg-sky-50 dark:border-sky-600 dark:bg-sky-950' : 'border-slate-200 dark:border-slate-800'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{s.slot_id}</span>
                <span className="font-medium">{s.title_idea}</span>
                <StatusBadge status={SLOT_TONE[s.status]} label={s.status.replace('_', ' ')} />
                {isNext && <span className="pill pill-green" data-testid="next-up-badge">Next up</span>}
                {s.brief_id && <Link className="text-xs text-sky-700 underline dark:text-sky-300" to={`/approvals/${s.brief_id}`}>{s.brief_id}</Link>}
              </div>
              <p className="mt-1 text-slate-600 dark:text-slate-300">{s.question}</p>
              <p className="mt-1 text-xs text-slate-500">Teaches: {s.teaches.join(', ')}{s.needs.length ? ` · needs ${s.needs.join(', ')}` : ''}{s.demand_evidence ? ` · demand: ${s.demand_evidence}` : ''}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {editable(s) && <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => onEdit(s)}><Pencil size={12} /> Edit</button>}
                {s.status === 'planned' && i > 0 && <button type="button" className="btn-secondary px-2 py-1 text-xs" aria-label={`Move ${s.slot_id} up`} disabled={busy} onClick={() => void onAct(`/api/roadmap/slots/${s.slot_id}/move`, { direction: 'up' }, `${s.slot_id} moved up`)}><ArrowUp size={12} /></button>}
                {s.status === 'planned' && i < stage.slots.length - 1 && <button type="button" className="btn-secondary px-2 py-1 text-xs" aria-label={`Move ${s.slot_id} down`} disabled={busy} onClick={() => void onAct(`/api/roadmap/slots/${s.slot_id}/move`, { direction: 'down' }, `${s.slot_id} moved down`)}><ArrowDown size={12} /></button>}
                {s.status === 'planned' && <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => void onAct(`/api/roadmap/slots/${s.slot_id}/skip`, { skipped: true }, `${s.slot_id} skipped`)}>Skip</button>}
                {s.status === 'skipped' && <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => void onAct(`/api/roadmap/slots/${s.slot_id}/skip`, { skipped: false }, `${s.slot_id} restored`)}>Restore</button>}
                {s.status === 'proposed' && <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => void onAct(`/api/roadmap/slots/${s.slot_id}/accept`, {}, `${s.slot_id} accepted`)}><Check size={12} /> Accept</button>}
                {s.status === 'proposed' && <button type="button" className="btn-danger px-2 py-1 text-xs" disabled={busy} onClick={() => void onAct(`/api/roadmap/slots/${s.slot_id}/reject`, {}, `${s.slot_id} rejected`)}><X size={12} /> Reject</button>}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

function EditDialog({ slot, busy, onSave, onCancel }: { slot: RoadmapSlot; busy: boolean; onSave: (c: Partial<RoadmapSlot>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(slot.title_idea)
  const [question, setQuestion] = useState(slot.question)
  const [teaches, setTeaches] = useState(slot.teaches.join(', '))
  const [needs, setNeeds] = useState(slot.needs.join(', '))
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  return (
    <ConfirmDialog open title={`Edit ${slot.slot_id}`} expectedCalls="0" expectedMem0="≈2" confirmLabel="Save" busy={busy} onConfirm={() => onSave({ title_idea: title, question, teaches: list(teaches), needs: list(needs) })} onCancel={onCancel}>
      <label className="label" htmlFor="slot-title">Title idea</label>
      <input id="slot-title" className="input" value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} />
      <label className="label mt-2" htmlFor="slot-question">The reader's question</label>
      <input id="slot-question" className="input" value={question} maxLength={160} onChange={(e) => setQuestion(e.target.value)} />
      <label className="label mt-2" htmlFor="slot-teaches">Teaches (comma-separated)</label>
      <input id="slot-teaches" className="input" value={teaches} onChange={(e) => setTeaches(e.target.value)} />
      <label className="label mt-2" htmlFor="slot-needs">Needs (slot ids, comma-separated)</label>
      <input id="slot-needs" className="input" value={needs} onChange={(e) => setNeeds(e.target.value)} />
      <p className="mt-2 text-xs text-slate-500">The engine checks the roadmap rules (questions end with "?", needs only earlier slots, comparisons only in stage 5).</p>
    </ConfirmDialog>
  )
}
