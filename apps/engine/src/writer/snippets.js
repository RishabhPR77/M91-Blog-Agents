// Code snippets (Phase 5 brief, A1): the Writer never writes code. Code extracts every code block
// from the source text, the Writer places [[SNIPPET:Sn]] lines, and code swaps in the exact block.

const HEADER = /^=== SOURCE: (\S+) ===\s*$/
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/
// [[SNIPPET:S3]] or [[SNIPPET:S3:L10-L25]] (an inclusive line range of S3)
const TOKEN_LINE = /^\s*\[\[SNIPPET:(S\d+)(?::L(\d+)-L(\d+))?\]\]\s*$/
const TOKEN_ANY = /\[\[SNIPPET:([^\]]*)\]\]/g
const CODE_FILE = /\.(sh|bash|zsh|js|mjs|cjs|ts|py|json|ya?ml|toml)$/i

const LANG_ALIASES = {
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash', curl: 'bash',
  json: 'json', jsonc: 'json',
  js: 'js', javascript: 'js', node: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js',
  py: 'python', python: 'python', python3: 'python',
  text: 'text', txt: 'text', plain: 'text', plaintext: 'text'
}

/** bash | json | js | python | text, from a fence tag or file extension, else guessed from the code. */
export function snippetLanguage(tag, code) {
  const t = String(tag ?? '').toLowerCase().replace(/^\./, '')
  if (LANG_ALIASES[t]) return LANG_ALIASES[t]
  if (/^ya?ml$|^toml$/.test(t)) return 'text'
  const s = String(code ?? '').trim()
  if (/^[[{]/.test(s)) {
    try {
      JSON.parse(s)
      return 'json'
    } catch {}
  }
  if (/^(#!\/bin\/|\$ |curl\b|npm\b|npx\b|node\b|export\b|\.\/|cd\b|git\b|pip\b|brew\b)/m.test(s)) return 'bash'
  if (/^\s*(import \w|from \w+ import|def \w+\(|print\()/m.test(s)) return 'python'
  if (/\b(const|let|function|await|require\()\b|=>/.test(s)) return 'js'
  return 'text'
}

/** Code as compared by the checks: CRLF → LF, no trailing spaces, no common indent, no blank edge lines. */
export function normaliseCode(code) {
  const lines = String(code ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''))
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  const indents = lines.filter(Boolean).map((l) => l.match(/^[ \t]*/)[0].length)
  const cut = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(cut)).join('\n')
}

/**
 * Every code block in the source text, numbered S1, S2, … (identical code kept once).
 * Fenced blocks, indented blocks (4+ spaces after a blank line, not inside a list), and whole
 * source files whose URL ends in a code extension (a script fetched from the skill repository).
 * @returns {{ snippets: {id, language, code, source_url, source_title, context}[], text: string }}
 *   text: the source with each block replaced by its [[SNIPPET:Sn]] line.
 */
export function extractSnippets(sourceText) {
  const lines = String(sourceText ?? '').replace(/\r\n?/g, '\n').split('\n')
  const snippets = []
  const byCode = new Map()
  const out = []
  let url = null
  let title = null
  let prose = []

  const add = (code, tag, { kind = 'block', context } = {}) => {
    const norm = normaliseCode(code)
    if (!norm) return null
    if (byCode.has(norm)) return byCode.get(norm)
    const s = {
      id: `S${snippets.length + 1}`, kind, language: snippetLanguage(tag, norm), code: norm, source_url: url,
      source_title: title, context: context ?? prose.slice(-2).join(' ').slice(0, 300)
    }
    snippets.push(s)
    byCode.set(norm, s)
    return s
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h = line.match(HEADER)
    if (h) {
      url = h[1]
      title = null
      prose = []
      out.push(line)
      // A source file in a code language is one snippet as a whole.
      if (CODE_FILE.test(url)) {
        let j = i + 1
        while (j < lines.length && !HEADER.test(lines[j])) j++
        const fileLines = lines.slice(i + 1, j)
        const ext = url.match(CODE_FILE)[1]
        const s = add(fileLines.join('\n'), ext, { kind: 'file' })
        if (s) out.push(`[[SNIPPET:${s.id}]]`)
        // Its usage / example lines from comments become snippets of their own (A1.2).
        const file = url.split('/').pop()
        for (const u of usageFromComments(fileLines, file)) add(u.code, ext, { kind: 'usage_from_comment', context: `usage from a comment in ${file} (line ${u.line})` })
        i = j - 1
      }
      continue
    }
    const f = line.match(FENCE_OPEN)
    if (f) {
      const close = new RegExp(`^\\s*${f[2][0] === '`' ? '`' : '~'}{${f[2].length},}\\s*$`)
      let j = i + 1
      while (j < lines.length && !close.test(lines[j])) j++
      const s = add(lines.slice(i + 1, j).join('\n'), f[3])
      if (s) out.push(`[[SNIPPET:${s.id}]]`)
      i = j
      continue
    }
    const prevBlank = i === 0 || lines[i - 1].trim() === '' || HEADER.test(lines[i - 1])
    const lastProse = prose[prose.length - 1] ?? ''
    if (/^( {4}|\t)\S/.test(line) && prevBlank && !/^\s*([-*+]|\d+[.)])\s/.test(lastProse)) {
      let j = i
      while (j < lines.length && (/^( {4}|\t)/.test(lines[j]) || (lines[j].trim() === '' && /^( {4}|\t)\S/.test(lines[j + 1] ?? '')))) j++
      const s = add(lines.slice(i, j).join('\n'), '')
      if (s) out.push(`[[SNIPPET:${s.id}]]`)
      i = j - 1
      continue
    }
    if (!title && /^#\s+\S/.test(line)) title = line.replace(/^#\s+/, '').trim()
    if (line.trim()) prose.push(line.trim())
    out.push(line)
  }
  return { snippets, text: out.join('\n') }
}

const COMMENT = /^(\s*)(#(?!!)|\/\/)\s?(.*)$/
const USAGE_MARKER = /^(usage|examples?)\s*:\s*(.*)$/i

/**
 * Usage / example lines from a script's comments (A1.2), comment marker removed, text otherwise exact.
 * A usage line is a comment line that calls the script (./x, x, or "$ …") or follows a "Usage:" /
 * "Example:" marker; the more-indented comment lines right after it continue it.
 * @returns {{ code: string, line: number }[]}  line: 1-based line in the file
 */
export function usageFromComments(fileLines, fileName = '') {
  const base = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const calls = new RegExp(`^(\\$\\s+)?(\\./\\S|${base ? `(\\S*/)?${base}\\b` : '(?!)'})`)
  const parsed = fileLines.map((l) => {
    const m = l.match(COMMENT)
    return m ? { text: m[3], indent: m[3].match(/^\s*/)[0].length } : null
  })
  const out = []
  let inMarker = false
  for (let i = 0; i < parsed.length; i++) {
    const c = parsed[i]
    if (!c || !c.text.trim()) {
      inMarker = false
      continue
    }
    const marker = c.text.trim().match(USAGE_MARKER)
    let first = c.text
    if (marker) {
      inMarker = true
      if (!marker[2]) continue
      first = marker[2]
    } else if (!inMarker && !calls.test(c.text.trim())) continue
    const group = [first.replace(/\s+$/, '')]
    let j = i + 1
    // A call outside a marker section may continue on more-indented comment lines (e.g. "[--custom-id x]").
    if (!inMarker) {
      while (j < parsed.length && parsed[j]?.text.trim() && parsed[j].indent > c.indent && !calls.test(parsed[j].text.trim())) {
        group.push(parsed[j].text.replace(/\s+$/, ''))
        j++
      }
    }
    out.push({ code: group.join('\n'), line: i + 1 })
    i = j - 1
  }
  return out
}

/** The CODE SNIPPETS message section: every snippet with line numbers, for whole or line-range use. */
export function snippetSection(snippets) {
  return snippets.map((s) => {
    const lines = s.code.split('\n')
    const w = String(lines.length).length
    return [
      `[${s.id}] kind: ${s.kind ?? 'block'} · language: ${s.language} · lines 1-${lines.length} · source: ${s.source_url ?? 'unknown'}`,
      `context: ${s.context || '(none)'}`,
      '```' + s.language,
      ...lines.map((l, i) => `${String(i + 1).padStart(w)}| ${l}`),
      '```'
    ].join('\n')
  }).join('\n\n')
}

/** Link label for a snippet's source line: the page title, else the host and path. */
export function sourceLabel(s) {
  if (s.source_title) return s.source_title.replace(/[[\]]/g, '')
  try {
    const u = new URL(s.source_url)
    const path = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).slice(-2).join('/')
    return path ? `${u.hostname}: ${path}` : u.hostname
  } catch {
    return 'the docs'
  }
}

/** The exact code a token inserts: the whole snippet, or lines from..to (1-based, inclusive), unchanged. */
export const insertedCode = (s, from, to) => (from ? s.code.split('\n').slice(from - 1, to).join('\n') : s.code)

const blockFor = (s, from, to) => ['```' + s.language, insertedCode(s, from, to), '```', '', `Source: [${sourceLabel(s)}](${s.source_url})`]
const tokenFor = (id, from, to) => (from ? `[[SNIPPET:${id}:L${from}-L${to}]]` : `[[SNIPPET:${id}]]`)

/**
 * Replaces each line holding only [[SNIPPET:Sn]] or [[SNIPPET:Sn:La-Lb]] with the exact fenced block
 * (the whole snippet, or lines a..b) and its source line.
 * @returns {{ markdown, used: string[], inserts: {id, from, to, code}[], errors: string[], rangeErrors: string[] }}
 *   errors: unknown ids and tokens not alone on a line; rangeErrors: invalid line ranges.
 */
export function replaceSnippetTokens(markdown, snippets) {
  const byId = new Map(snippets.map((s) => [s.id, s]))
  const used = []
  const inserts = []
  const errors = []
  const rangeErrors = []
  const out = []
  for (const line of String(markdown ?? '').split('\n')) {
    const m = line.match(TOKEN_LINE)
    if (m) {
      const s = byId.get(m[1])
      if (!s) {
        errors.push(`unknown snippet id ${m[1]} (CODE SNIPPETS has ${snippets.length ? snippets.map((x) => x.id).join(', ') : 'none'})`)
        out.push(line)
        continue
      }
      const from = m[2] ? Number(m[2]) : null
      const to = m[3] ? Number(m[3]) : null
      const length = s.code.split('\n').length
      if (from !== null && !(from >= 1 && to >= from && to <= length)) {
        rangeErrors.push(`${m[1]}:L${from}-L${to} is not a valid line range (${m[1]} has lines 1-${length}; the first line must be ≤ the last)`)
        out.push(line)
        continue
      }
      if (!used.includes(s.id)) used.push(s.id)
      inserts.push({ id: s.id, from, to, code: insertedCode(s, from, to) })
      out.push(...blockFor(s, from, to))
      continue
    }
    if (/^\s*\[\[SNIPPET:[^\]]*\]\]\s*$/.test(line)) errors.push(`${line.trim()} is not a valid token: use [[SNIPPET:Sn]] or [[SNIPPET:Sn:La-Lb]]`)
    else for (const t of line.matchAll(TOKEN_ANY)) errors.push(`[[SNIPPET:${t[1]}]] must be alone on its own line`)
    out.push(line)
  }
  return { markdown: out.join('\n'), used, inserts, errors, rangeErrors }
}

/**
 * The reverse, for a repair or revision: each inserted block (and its source line) becomes its token
 * again. inserts: the line ranges that were inserted ({ id, from, to }); whole snippets need none.
 */
export function tokeniseSnippets(markdown, snippets, inserts = []) {
  let md = String(markdown ?? '')
  const byId = new Map(snippets.map((s) => [s.id, s]))
  for (const ins of inserts.filter((x) => x.from)) {
    const s = byId.get(ins.id)
    if (s) md = md.split(blockFor(s, ins.from, ins.to).join('\n')).join(tokenFor(ins.id, ins.from, ins.to))
  }
  for (const s of snippets) md = md.split(blockFor(s).join('\n')).join(tokenFor(s.id))
  return md
}
