// Interactive blocks on an approval (Phase 8): the on/off switch for this post, the newest Designer result
// for this version, and Re-run Designer (1–2 AI calls). The switch is saved on the draft and takes effect at
// the next Designer run or publish; a published post shows new blocks only after Republish.
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

export type InteractiveInfo = {
  on: boolean
  default: boolean
  set: boolean
  block_doc: { record_id: string; status: string | null; summary: string; blocks: number; dropped: number; integrity_passed: boolean | null; created_at: string | null } | null
}

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
  const doc = info.block_doc

  async function toggle(on: boolean) {
    setSaving(true)
    try {
      const r = await api<{ on: boolean; saved: boolean }>(`/api/drafts/${briefId}/interactive`, { method: 'POST', body: { on } })
      toast(r.saved ? 'success' : 'info', r.saved ? `Interactive blocks ${on ? 'on' : 'off'} for this post` : 'Dry run: the switch was not saved')
      await qc.invalidateQueries({ queryKey: ['approval', briefId] })
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Interactive blocks" actions={<span className={`pill ${info.on ? 'pill-green' : 'pill-gray'}`} data-testid="interactive-state">{info.on ? 'on' : 'off'}</span>}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={info.on} disabled={saving} onChange={(e) => void toggle(e.target.checked)} aria-label="Interactive blocks for this post" />
        <span>
          Make parts of this post interactive (steps to tick, a phone that rings, tabs for code…). The text never changes.
          <span className="block text-xs text-slate-500" data-testid="interactive-source">{info.set ? 'Set for this post.' : `From INTERACTIVE_DEFAULT (${info.default ? 'on' : 'off'}).`}</span>
        </span>
      </label>
      <div className="mt-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-800" data-testid="designer-result">
        {doc ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Designer, v{version}</span>
              <span className={`pill ${doc.status === 'ok' ? 'pill-green' : 'pill-amber'}`}>{doc.status ?? 'unknown'}</span>
              {doc.integrity_passed !== null && <span className={`pill ${doc.integrity_passed ? 'pill-green' : 'pill-red'}`}>integrity {doc.integrity_passed ? 'passed' : 'failed'}</span>}
            </div>
            <p className="mt-1">{doc.summary || `${doc.blocks} blocks`}</p>
            <p className="mt-1 text-xs text-slate-500">{doc.created_at ? `${fmtDateTime(doc.created_at)} · ` : ''}<Link className="text-sky-700 underline dark:text-sky-300" to={`/records/${doc.record_id}`}>plan, blocks and integrity</Link></p>
          </>
        ) : (
          <p className="text-slate-500">{info.on ? 'The Designer has not run for this version yet. It runs when the post is approved.' : 'No Designer result for this version.'}</p>
        )}
      </div>
      {canDesign && (
        <>
          {run.error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{run.error}</p>}
          <button type="button" className="btn-secondary mt-3 w-full" disabled={run.busy || !info.on} title={!info.on ? 'Turn interactive blocks on first' : undefined} onClick={() => { run.clearError(); setOpen(true) }}>
            Re-run Designer · expected AI calls {COSTS.designer.normal}
          </button>
          {status === 'published' && <p className="mt-1 text-xs text-slate-500" data-testid="republish-hint">The live post changes only after Republish (Publishing card or Posts).</p>}
        </>
      )}
      <ConfirmDialog open={open} title={`Re-run the Designer for v${version}?`} expectedCalls={COSTS.designer.normal} confirmLabel="Run the Designer" busy={run.busy}
        onConfirm={async () => { if (!(await run.start('designer', { brief_id: briefId }, dry))) setOpen(false) }} onCancel={() => setOpen(false)}>
        <p>The Designer picks the parts of this post that become interactive blocks (one AI call, plus one repair if its plan is not valid). Code builds the blocks from the exact text and checks that nothing changed.</p>
        <p>{dry ? 'The engine default is a dry run: the plan is made, but nothing is saved.' : 'The result is saved as a new block_doc. Nothing is published.'}</p>
      </ConfirmDialog>
    </Card>
  )
}
