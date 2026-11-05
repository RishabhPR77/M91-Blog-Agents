// One light theme ("paper"). The dashboard used to follow the system's dark mode; the user chose a single,
// calm light look, so the page is always light and a choice saved by older versions is cleared.
const OLD_KEY = 'm91-dashboard-theme'

export function applyTheme() {
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = 'light'
  try {
    localStorage.removeItem(OLD_KEY)
  } catch {
    // Storage may be blocked: nothing to clear.
  }
}
