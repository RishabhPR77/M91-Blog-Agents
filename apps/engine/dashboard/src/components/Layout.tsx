// Every page: sidebar (with the approvals count), top bar (engine status, live indicator, dry-run default,
// theme), and the "engine offline" banner.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, BookOpen, FileDown, Gauge, History, Inbox, Lightbulb, LogOut, Map as MapIcon, Menu, Monitor, Moon, Newspaper, Pin, Settings as SettingsIcon, Sun, X } from 'lucide-react'
import { api } from '../api/client'
import { keys, useApprovals, useHealth, useRuns, useSettings } from '../api/queries'
import { openEventStream } from '../api/sse'
import { applyTheme, readThemePref, saveThemePref, watchSystemTheme, type ThemePref } from '../theme'
import { toast } from './Toasts'
import { IndexAge, IndexBanner } from './IndexStatus'
import { QuotaBanner, QuotaPill } from './QuotaStatus'
import { flagsOf } from '../config/flags'

type NavItem = { to: string; label: string; icon: ReactNode; badge?: number; end?: boolean }

function useGlobalLive(online: boolean) {
  const qc = useQueryClient()
  const [state, setState] = useState<'off' | 'live' | 'reconnecting'>('off')
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (!online) {
      setState('off')
      return
    }
    const close = openEventStream('/api/events', {
      onOpen: () => setState('live'),
      onError: (rs) => setState(rs === 2 ? 'off' : 'reconnecting'),
      onEvent: (e) => {
        setPulse(Date.now())
        if (e.type.startsWith('run.') || e.type.startsWith('approval.')) {
          qc.invalidateQueries({ queryKey: ['runs'] })
          qc.invalidateQueries({ queryKey: keys.approvals })
          qc.invalidateQueries({ queryKey: keys.health })
          qc.invalidateQueries({ queryKey: keys.posts })
          qc.invalidateQueries({ queryKey: ['roadmap'] })
          qc.invalidateQueries({ queryKey: ['timely'] })
        }
      }
    })
    return close
  }, [online, qc])
  return { state, pulse }
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
  const icon = pref === 'light' ? <Sun size={16} /> : pref === 'dark' ? <Moon size={16} /> : <Monitor size={16} />
  return (
    <button type="button" className="btn-ghost" onClick={() => setPref(next[pref])} title={`Theme: ${pref} (click to change)`} aria-label={`Theme: ${pref}`}>
      {icon}
    </button>
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
  const nav: NavItem[] = [
    { to: '/', label: 'Control', icon: <Gauge size={18} />, end: true },
    ...(activeRun ? [{ to: `/runs/${activeRun.run_id}`, label: 'Live run', icon: <Activity size={18} className="text-sky-500" /> }] : []),
    { to: '/approvals', label: 'Approvals', icon: <Inbox size={18} />, badge: waiting },
    // Phase 12: the learning path.
    ...(settings.data?.roadmap?.enabled ? [{ to: '/roadmap', label: 'Roadmap', icon: <MapIcon size={18} /> }] : []),
    { to: '/runs', label: 'Runs', icon: <History size={18} />, end: true },
    { to: '/content', label: 'Content', icon: <BookOpen size={18} /> },
    // Phase 11: the final Markdown exports; the blog's Posts page only while the blog is the publish target.
    { to: '/exports', label: 'Exports', icon: <FileDown size={18} /> },
    ...(flagsOf(settings.data).blogOn ? [{ to: '/posts', label: 'Posts', icon: <Newspaper size={18} /> }] : []),
    { to: '/pinned', label: 'Pinned topics', icon: <Pin size={18} /> },
    { to: '/lessons', label: 'Lessons', icon: <Lightbulb size={18} /> },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> }
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

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main">
      <div className="mb-4 px-2 pt-1">
        <div className="text-sm font-semibold tracking-tight">M91 Engine</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">Control room</div>
      </div>
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${isActive ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`
          }
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          {item.badge ? <span className="rounded-full bg-violet-600 px-1.5 text-xs font-semibold text-white" aria-label={`${item.badge} waiting`}>{item.badge}</span> : null}
        </NavLink>
      ))}
      <div className="mt-auto">
        {settings.data?.dashboard.auth && (
          <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <LogOut size={18} /> Log out
          </button>
        )}
      </div>
    </nav>
  )

  const liveDot = live.state === 'live' ? 'bg-emerald-500' : live.state === 'reconnecting' ? 'bg-amber-500' : 'bg-slate-400'
  const recentPulse = Date.now() - live.pulse < 1500

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">{sidebar}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl dark:bg-slate-900">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button type="button" className="btn-ghost md:hidden" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className={`pill ${online ? 'pill-green' : 'pill-red'}`} data-testid="engine-status">
            {online ? `Engine online · v${health.data?.version}` : health.isPending ? 'Checking engine…' : 'Engine offline'}
          </span>
          {online && health.data?.run_in_progress && (
            <NavLink to={activeRun ? `/runs/${activeRun.run_id}` : '/runs'} className="pill pill-blue">Run in progress</NavLink>
          )}
          <span className="pill pill-gray" title={`Live events: ${live.state}`} data-testid="live-indicator">
            <span className={`inline-block h-2 w-2 rounded-full ${liveDot} ${recentPulse ? 'animate-ping' : ''}`} />
            {live.state === 'live' ? 'Live' : live.state === 'reconnecting' ? 'Reconnecting' : 'Not live'}
          </span>
          {settings.data && (settings.data.runtime.dry_run
            ? <span className="pill pill-amber" data-testid="dry-run-default">DRY RUN default</span>
            : <span className="pill pill-gray" data-testid="dry-run-default">Live runs by default</span>)}
          {online && <IndexAge index={health.data?.index} />}
          {online && <QuotaPill usage={health.data?.mem0_usage} />}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        {!online && !health.isPending && (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            Engine is not running. Start it with <code className="rounded bg-red-100 px-1 dark:bg-red-900">npm run dev:engine</code>.
          </div>
        )}
        {online && <QuotaBanner usage={health.data?.mem0_usage} />}
        {online && <IndexBanner index={health.data?.index} running={Boolean(health.data?.run_in_progress)} />}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  )
}
