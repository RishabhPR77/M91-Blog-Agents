// The interactive guide on an approval (Phase 10): the on/off switch for this post, the newest Experience
// Designer result for this version, and Re-run Experience Designer (1–2 AI calls, for approved or published
// drafts; a waiting draft uses "Change the design"). The switch is saved on the draft and takes effect at the next
// Experience Designer run or publish; a published post shows a new guide only after Republish.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from '../api/client'
import { useSettings } from '../api/queries'
import { usePublishRun } from '../api/publishRun'
import { COSTS } from '../config/costs'
import { fmtDateTime } from '../format'
import { ConfirmDialog } from './ConfirmDialog'
import { Card } from './Page'
import { toast } from './Toasts'

export type GuideDocInfo = {
  record_id: string
  status: string | null
  summary: string
  chapters: number
  components: number
  dropped: number
  coverage_passed: boolean | null
  created_at: string | null
}

export type InteractiveInfo = { on: boolean; default: boolean; set: boolean; guide_doc: GuideDocInfo | null }

export function InteractiveCard({ briefId, status, version, info }: { briefId: string; status: string; version: number; info: InteractiveInfo | null | undefined }) {
  const qc = useQueryClient()
  const settings = useSettings()
  const run = usePublishRun()
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  if (!info) return null
  const s = settings.data
  const dry = s?.runtime.dry_run ?? true
  const canDesign = (status === 'approved' || status === 'published') && Boolean(s?.built_modes?.includes('designer'))
  const doc = info.guide_doc

  async function toggle(on: boolean) {
    setSaving(true)
    try {
      const r = await api<{ on: boolean; saved: boolean }>(`/api/drafts/${briefId}/interactive`, { method: 'POST', body: { on } })
      toast(r.saved ? 'success' : 'info', r.saved ? `Interactive guide ${on ? 'on' : 'off'} for this post` : 'Dry run: the switch was not saved')
      await qc.invalidateQueries({ queryKey: ['approval', briefId] })
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Interactive guide" actions={<span className={`pill ${info.on ? 'pill-green' : 'pill-gray'}`} data-testid="interactive-state">{info.on ? 'on' : 'off'}</span>}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={info.on} disabled={saving} onChange={(e) => void toggle(e.target.checked)} aria-label="Interactive guide for this post" />
        <span>
          Turn this post into an interactive guide (numbered chapters, a demo you can tap, steps to tick…). The Writer's text never changes.
          <span className="block text-xs text-slate-500" data-testid="interactive-source">{info.set ? 'Set for this post.' : `From INTERACTIVE_DEFAULT (${info.default ? 'on' : 'off'}).`}</span>
        </span>
      </label>
      <div className="mt-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-800" data-testid="designer-result">
        {doc ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Experience Designer, v{version}</span>
              <span className={`pill ${doc.status === 'ok' ? 'pill-green' : 'pill-amber'}`}>{doc.status === 'ok' ? 'guide' : 'no guide'}</span>
              {doc.coverage_passed !== null && <span className={`pill ${doc.coverage_passed ? 'pill-green' : 'pill-red'}`}>coverage {doc.coverage_passed ? 'passed' : 'failed'}</span>}
            </div>
            <p className="mt-1">{doc.summary || `${doc.chapters} chapters · ${doc.components} components`}</p>
            <p className="mt-1 text-xs text-slate-500">{doc.created_at ? `${fmtDateTime(doc.created_at)} · ` : ''}<Link className="text-sky-700 underline dark:text-sky-300" to={`/records/${doc.record_id}`}>the guide, what was dropped and the checks</Link></p>
          </>
        ) : (
          <p className="text-slate-500">{info.on ? 'No guide for this version yet: the Experience Designer runs after each draft, before the Reviewer.' : 'No guide for this version.'}</p>
        )}
      </div>
      {canDesign && (
        <>
          {run.error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{run.error}</p>}
          <button type="button" className="btn-secondary mt-3 w-full" disabled={run.busy || !info.on} title={!info.on ? 'Turn the interactive guide on first' : undefined} onClick={() => { run.clearError(); setOpen(true) }}>
            Re-run Experience Designer · expected AI calls {COSTS.designer.normal}
          </button>
          {status === 'published' && <p className="mt-1 text-xs text-slate-500" data-testid="republish-hint">The live post changes only after Republish (Publishing card or Posts).</p>}
        </>
      )}
      <ConfirmDialog open={open} title={`Re-run the Experience Designer for v${version}?`} expectedCalls={COSTS.designer.normal} expectedMem0={COSTS.designer.mem0} confirmLabel="Run the Experience Designer" busy={run.busy}
        onConfirm={async () => { if (!(await run.start('designer', { brief_id: briefId }, dry))) setOpen(false) }} onCancel={() => setOpen(false)}>
        <p>The Experience Designer turns this version into a guide (one AI call, plus one repair if its answer breaks a rule). Code places the Writer's exact text and checks that the design adds no new facts. The Reviewer does not run.</p>
        <p>{dry ? 'The engine default is a dry run: the guide is made, but nothing is saved.' : 'The result is saved as a new guide_doc. Nothing is published.'}</p>
      </ConfirmDialog>
    </Card>
  )
}
