// Light / dark theme: follows the system setting unless the user picks one (remembered in this browser only).
export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'm91-dashboard-theme'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // Storage may be blocked; the theme still applies for this page view.
  }
}

const systemDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && systemDark())
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** Re-applies the theme when the system setting changes (only matters for 'system'). */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq) return () => {}
  const onChange = () => applyTheme(getPref())
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
