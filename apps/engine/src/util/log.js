// JSON-lines logger that masks secrets before anything is written.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
let threshold = LEVELS[process.env.LOG_LEVEL?.trim()] ?? LEVELS.info
const secretValues = new Set()
let sink = (level, line) => (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n')

export const maskValue = (value) => `${String(value).slice(0, 4)}…`

const SECRET_FIELD = /(key|token|secret|password|authorization|signature|webhook_?url)$/i
const PATTERNS = [
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWTs (embed tokens)
  /\b(?:Bearer|Token)\s+[\w.~+/=-]{8,}/gi, // auth header values
  /\bm0-[\w-]{8,}/g, // Mem0 API keys
  /\bsk-[\w-]{8,}/g, // provider keys
  /(?<=flow\.sokt\.io\/func\/)[\w-]+/g // webhook / run URLs: the script_id is a credential
]

/** Registers values (e.g. config secrets) that are masked wherever they appear. */
export function registerSecrets(values = []) {
  for (const v of values) if (typeof v === 'string' && v.length >= 4) secretValues.add(v)
}

export function maskString(text) {
  let out = String(text)
  for (const secret of [...secretValues].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(maskValue(secret))
  }
  for (const pattern of PATTERNS) out = out.replace(pattern, (m) => maskValue(m))
  return out
}

export function mask(value, depth = 0) {
  if (depth > 8) return '[deep]'
  if (typeof value === 'string') return maskString(value)
  if (value instanceof Error) {
    return { name: value.name, message: maskString(value.message), ...(value.kind && { kind: value.kind }), ...(value.status != null && { status: value.status }) }
  }
  if (Array.isArray(value)) return value.map((v) => mask(v, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_FIELD.test(k) && v != null && typeof v !== 'object' && typeof v !== 'boolean' ? maskValue(v) : mask(v, depth + 1)])
    )
  }
  return value
}

export function setLevel(level) {
  if (LEVELS[level] !== undefined) threshold = LEVELS[level]
}

/** Test hook: capture lines instead of writing them. Returns a restore function. */
export function setSink(fn) {
  const previous = sink
  sink = fn
  return () => { sink = previous }
}

// Listeners get every written line, already masked (events.js turns them into `log` events).
const listeners = new Set()
export function onLogLine(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function write(level, msg, fields) {
  if (LEVELS[level] < threshold) return
  const entry = { time: new Date().toISOString(), level, msg: maskString(msg), ...mask(fields ?? {}) }
  sink(level, JSON.stringify(entry))
  for (const fn of listeners) {
    try {
      fn(entry)
    } catch {}
  }
}

export const log = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields)
}
