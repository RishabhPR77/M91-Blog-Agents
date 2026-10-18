// IST (Asia/Kolkata) date/time helpers. IST has no DST: always UTC+05:30.

export const IST = 'Asia/Kolkata'
const IST_OFFSET_MS = 330 * 60 * 1000

/** Calendar parts of `date` as seen in IST. */
export function istParts(date = new Date()) {
  const d = new Date(date.getTime() + IST_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds()
  }
}

const pad = (n, w = 2) => String(n).padStart(w, '0')

/** "2026-10-17" in IST. */
export function istDate(date = new Date()) {
  const p = istParts(date)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** "2026-10-17T14:05:09+05:30". */
export function istIso(date = new Date()) {
  const p = istParts(date)
  return `${istDate(date)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+05:30`
}

/** "17 Oct 2026, 14:05 IST" for humans (Slack, alerts). */
export function istHuman(date = new Date()) {
  const p = istParts(date)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p.month - 1]
  return `${p.day} ${month} ${p.year}, ${pad(p.hour)}:${pad(p.minute)} IST`
}
