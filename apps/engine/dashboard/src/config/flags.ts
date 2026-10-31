// Phase 11: the two switches the dashboard follows. EXPERIENCE_ENABLED=false hides the Experience Designer
// (its card, "Change the design", its run button); PUBLISH_TARGET decides which publish actions exist
// (none: no Publish, Rebuild blog or page preview; docstar: Publish goes to Docstar). Older engines don't
// send these: they behave as Phase 10 (designer on, the blog). While the settings load, nothing blog-related
// shows (Embarko is no longer used: with PUBLISH_TARGET=none no blog item may appear, not even for a moment).
import type { Settings } from '../api/types'

export type PublishTarget = 'none' | 'embarko' | 'docstar' | 'slack'
export type Flags = { experienceOn: boolean; target: PublishTarget; blogOn: boolean; docstarConfigured: boolean }

export function flagsOf(s: Settings | undefined): Flags {
  const target: PublishTarget = !s ? 'none' : s.publish?.target ?? 'embarko'
  return { experienceOn: s?.designer?.enabled !== false, target, blogOn: target === 'embarko', docstarConfigured: Boolean(s?.publish?.docstar_configured) }
}
