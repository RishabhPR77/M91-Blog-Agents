// Every page: a slim top bar (the main places, a "More" menu, the live run, one engine status button with the
// details behind it, the theme and settings), the warning banners, and the page itself, which fades in.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, LogOut, Menu, Monitor, Moon, Settings as SettingsIcon, Sun, X } from 'lucide-react'
import { api } from '../api/client'
import { keys, useApprovals, useHealth, useRuns, useSettings } from '../api/queries'
import type { IndexStatus, Mem0Usage } from '../api/types'
import { openEventStream } from '../api/sse'
import { applyTheme, readThemePref, saveThemePref, watchSystemTheme, type ThemePref } from '../theme'
import { toast } from './Toasts'
import { IndexAge, IndexBanner } from './IndexStatus'
import { QuotaBanner, QuotaPill } from './QuotaStatus'
import { flagsOf } from '../config/flags'

type NavItem = { to: string; label: string; hint?: string; badge?: number; end?: boolean }
type LiveState = 'off' | 'live' | 'reconnecting'

function useGlobalLive(online: boolean) {
  const qc = useQueryClient()
  const [state, setState] = useState<LiveState>('off')
  useEffect(() => {
    if (!online) {
      setState('off')
      return
    }
    const close = openEventStream('/api/events', {
      onOpen: () => setState('live'),
      onError: (rs) => setState(rs === 2 ? 'off' : 'reconnecting'),
      onEvent: (e) => {
        if (e.type.startsWith('run.') || e.type.startsWith('approval.')) {
          qc.invalidateQueries({ queryKey: ['runs'] })
          qc.invalidateQueries({ queryKey: keys.approvals })
          qc.invalidateQueries({ queryKey: keys.health })
          qc.invalidateQueries({ queryKey: keys.posts })
          qc.invalidateQueries({ queryKey: ['weekly'] })
          qc.invalidateQueries({ queryKey: ['guides'] })
          qc.invalidateQueries({ queryKey: ['timely'] })
          // The post pages: their journey bars move on as the steps finish.
          qc.invalidateQueries({ queryKey: ['post-journey'] })
          qc.invalidateQueries({ queryKey: ['post-journeys'] })
        }
      }
    })
    return close
  }, [online, qc])
  return state
}

/** Closes a popover on a click outside it or on Escape. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [ref, open, close])
}

/** The thin line on top of the page while a page's first data loads (refetches in the background do not count). */
function TopLoader() {
  const loading = useIsFetching({ predicate: (q) => q.state.status === 'pending' }) > 0
  return <div className="top-loader" data-on={loading} aria-hidden />
}

function Logo() {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[10px] font-bold tracking-tight text-primary-fg">
      M91
      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-signal ring-2 ring-bg" />
    </span>
  )
}

function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(readThemePref)
  const ref = useRef(pref)
  ref.current = pref
  useEffect(() => {
    applyTheme(pref)
    saveThemePref(pref)
  }, [pref])
  useEffect(() => watchSystemTheme(() => ref.current), [])
  const next: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
  const icon = pref === 'light' ? <Sun size={17} /> : pref === 'dark' ? <Moon size={17} /> : <Monitor size={17} />
  return (
    <button type="button" className="btn-ghost" onClick={() => setPref(next[pref])} title={`Theme: ${pref} (click to change)`} aria-label={`Theme: ${pref}`}>
      {icon}
    </button>
  )
}

/** One button for the engine's state ("● Live"); its details (version, data age, memory use, dry run) open below it. */
function StatusMenu({ online, pending, version, live, dryRun, index, usage }: { online: boolean; pending: boolean; version?: string; live: LiveState; dryRun?: boolean; index?: IndexStatus; usage?: Mem0Usage }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))
  const dot = !online ? (pending ? 'bg-slate-400' : 'bg-red-500') : live === 'live' ? 'bg-emerald-500 text-emerald-500 animate-signal' : live === 'reconnecting' ? 'bg-amber-500' : 'bg-slate-400'
  const word = !online ? (pending ? 'Checking…' : 'Offline') : live === 'live' ? 'Live' : live === 'reconnecting' ? 'Reconnecting' : 'Not live'
  const row = 'flex items-center justify-between gap-3 py-1.5'
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="engine-status-panel" title="Engine status"
        className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
        <span className={`size-2 rounded-full ${dot}`} />
        <span data-testid="live-indicator">{word}</span>
      </button>
      <div id="engine-status-panel" hidden={!open} className="absolute right-0 z-40 mt-2 w-72 animate-pop rounded-xl border border-line bg-surface p-3 text-sm shadow-(--shadow-float)">
        <p className="eyebrow px-1 pb-1">Engine</p>
        <div className="divide-y divide-line px-1">
          <div className={row}><span className="text-ink-2">Status</span><span data-testid="engine-status" className="font-medium">{online ? `Engine online · v${version}` : pending ? 'Checking engine…' : 'Engine offline'}</span></div>
          <div className={row}><span className="text-ink-2">Live updates</span><span className="font-medium">{live === 'live' ? 'on' : live === 'reconnecting' ? 'reconnecting' : 'off'}</span></div>
          {dryRun === false && <div className={row}><span className="text-ink-2">Runs</span><span data-testid="dry-run-default" className="font-medium">Live runs by default</span></div>}
          {index?.loaded_at && <div className={row}><span className="text-ink-2">Data</span><IndexAge index={index} /></div>}
          {usage && <div className={row}><span className="text-ink-2">Memory</span><QuotaPill usage={usage} /></div>}
        </div>
      </div>
    </div>
  )
}

function NavTab({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end}
      className={({ isActive }) => `relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${isActive ? 'bg-ink/[0.06] font-medium text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'}`}>
      {item.label}
      {item.badge ? <span className="min-w-5 rounded-full bg-hl px-1.5 text-center text-[11px] leading-5 font-semibold text-[#0b0e12] tabular-nums" aria-label={`${item.badge} waiting`}>{item.badge}</span> : null}
    </NavLink>
  )
}

function MoreMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  useDismiss(ref, open, () => setOpen(false))
  useEffect(() => setOpen(false), [location.pathname])
  const active = items.some((i) => location.pathname.startsWith(i.to))
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="more-menu"
        className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${active ? 'bg-ink/[0.06] font-medium text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'}`}>
        More <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Always in the page (hidden with CSS while closed), so it can animate both ways and its links stay findable. */}
      <div id="more-menu" className={`absolute left-0 z-40 mt-2 w-64 origin-top-left rounded-xl border border-line bg-surface p-1.5 shadow-(--shadow-float) transition-[opacity,transform,visibility] duration-200 ease-out ${open ? 'visible translate-y-0 scale-100 opacity-100' : 'invisible -translate-y-1 scale-[0.98] opacity-0'}`}>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} tabIndex={open ? 0 : -1} className={({ isActive }) => `block rounded-lg px-3 py-2 transition-colors ${isActive ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.04]'}`}>
            <span className="block text-sm font-medium text-ink">{item.label}</span>
            {item.hint && <span className="block text-xs text-ink-3">{item.hint}</span>}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const health = useHealth()
  const online = health.isSuccess && !health.isError
  const settings = useSettings(online)
  const approvals = useApprovals(online)
  const runs = useRuns(5, online)
  const live = useGlobalLive(online)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => setMenuOpen(false), [location.pathname])

  const activeRun = runs.data?.find((r) => r.status === 'running')
  const waiting = approvals.data?.length ?? 0
  const primary: NavItem[] = [
    { to: '/', label: 'Home', end: true },
    { to: '/approvals', label: 'Review', badge: waiting },
    // The weekly editor: what the next run writes, its decisions, this week's news and the live guides.
    { to: '/week', label: 'This week' },
    { to: '/runs', label: 'Posts & runs', end: true }
  ]
  const more: NavItem[] = [
    { to: '/content', label: 'Content', hint: 'Guides, drafts and briefs' },
    // Phase 11: the final Markdown exports; the blog's own page only while the blog is the publish target.
    { to: '/exports', label: 'Exports', hint: 'The final Markdown files' },
    ...(flagsOf(settings.data).blogOn ? [{ to: '/posts', label: 'Blog', hint: 'Posts on the blog' }] : []),
    { to: '/pinned', label: 'Pinned topics', hint: 'What the editor writes next' },
    { to: '/lessons', label: 'Lessons', hint: 'What the agents learned' },
    // What the memory holds, why a record may not be useful, and clean-up.
    { to: '/memory', label: 'Memory', hint: 'What the engine remembers' }
  ]

  async function logout() {
    try {
      await api('/api/logout', { method: 'POST' })
    } catch {
      // Logging out never fails visibly.
    }
    toast('info', 'Logged out')
    navigate('/login')
  }

  const auth = settings.data?.dashboard.auth
  const dryRun = settings.data?.runtime.dry_run

  return (
    <div className="flex min-h-full flex-col">
      <TopLoader />
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <button type="button" className="btn-ghost -ml-2 md:hidden" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <NavLink to="/" className="mr-3 flex items-center gap-2.5" aria-label="Blog Engine home">
            <Logo />
            <span className="hidden text-sm font-semibold tracking-[-0.01em] sm:inline">Blog Engine</span>
          </NavLink>
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
            {primary.map((item) => <NavTab key={item.to} item={item} />)}
            <MoreMenu items={more} />
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {activeRun && (
              <NavLink to={`/runs/${activeRun.run_id}`} className="flex items-center gap-2 rounded-full bg-red-500/10 py-1 pr-3 pl-2.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-500/15 dark:text-red-300">
                <span className="size-2 animate-signal rounded-full bg-signal text-signal" /> Live run
              </NavLink>
            )}
            {dryRun && <span className="pill pill-amber hidden sm:inline-flex" data-testid="dry-run-default">Dry run <span className="sr-only">by default</span></span>}
            <StatusMenu online={online} pending={health.isPending} version={health.data?.version} live={live} dryRun={dryRun} index={online ? health.data?.index : undefined} usage={online ? health.data?.mem0_usage : undefined} />
            <ThemeToggle />
            <NavLink to="/settings" className={({ isActive }) => `btn-ghost ${isActive ? 'bg-ink/[0.06] text-ink' : ''}`} aria-label="Settings" title="Settings"><SettingsIcon size={17} /></NavLink>
            {auth && <button type="button" onClick={logout} className="btn-ghost" aria-label="Log out" title="Log out"><LogOut size={17} /></button>}
          </div>
        </div>
      </header>
      {menuOpen && (
        <div className="fixed inset-x-0 top-14 bottom-0 z-40 animate-fade bg-bg/95 backdrop-blur-xl md:hidden">
          <nav className="stagger mx-auto flex max-w-md flex-col gap-1 p-4" aria-label="Menu">
            {[...primary, ...more].map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => `flex items-center justify-between rounded-xl px-4 py-3 text-base transition-colors ${isActive ? 'bg-ink/[0.06] font-medium text-ink' : 'text-ink-2 hover:bg-ink/[0.04]'}`}>
                <span>{item.label}{item.hint && <span className="block text-xs text-ink-3">{item.hint}</span>}</span>
                {item.badge ? <span className="rounded-full bg-hl px-2 text-xs leading-5 font-semibold text-[#0b0e12]">{item.badge}</span> : null}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
      {!online && !health.isPending && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-200">
          Engine is not running. Start it with <code className="rounded bg-red-100 px-1 font-mono dark:bg-red-500/20">npm run dev:engine</code>.
        </div>
      )}
      {online && <QuotaBanner usage={health.data?.mem0_usage} />}
      {online && <IndexBanner index={health.data?.index} running={Boolean(health.data?.run_in_progress)} />}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-20 sm:px-6 sm:pt-10">
        <div key={location.pathname} className="animate-enter">{children}</div>
      </main>
    </div>
  )
}
