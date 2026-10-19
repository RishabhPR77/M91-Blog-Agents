// Code snippets (Phase 5 brief, A1): the Writer never writes code. Code extracts every code block
// from the source text, the Writer places [[SNIPPET:Sn]] lines, and code swaps in the exact block.

const HEADER = /^=== SOURCE: (\S+) ===\s*$/
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/
const TOKEN_LINE = /^\s*\[\[SNIPPET:(S\d+)\]\]\s*$/
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

  const add = (code, tag) => {
    const norm = normaliseCode(code)
    if (!norm) return null
    if (byCode.has(norm)) return byCode.get(norm)
    const s = {
      id: `S${snippets.length + 1}`, language: snippetLanguage(tag, norm), code: norm, source_url: url,
      source_title: title, context: prose.slice(-2).join(' ').slice(0, 300)
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
        const s = add(lines.slice(i + 1, j).join('\n'), url.match(CODE_FILE)[1])
        if (s) out.push(`[[SNIPPET:${s.id}]]`)
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

/** The CODE SNIPPETS message section. */
export function snippetSection(snippets) {
  return snippets.map((s) => [
    `[${s.id}] language: ${s.language} · source: ${s.source_url ?? 'unknown'}`,
    `context: ${s.context || '(none)'}`,
    '```' + s.language,
    s.code,
    '```'
  ].join('\n')).join('\n\n')
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

const blockFor = (s) => ['```' + s.language, s.code, '```', '', `Source: [${sourceLabel(s)}](${s.source_url})`]

/**
 * Replaces each line holding only [[SNIPPET:Sn]] with the exact fenced block and its source line.
 * @returns {{ markdown, used: string[], errors: string[] }} errors: unknown ids and tokens not alone on a line.
 */
export function replaceSnippetTokens(markdown, snippets) {
  const byId = new Map(snippets.map((s) => [s.id, s]))
  const used = []
  const errors = []
  const out = []
  for (const line of String(markdown ?? '').split('\n')) {
    const m = line.match(TOKEN_LINE)
    if (m) {
      const s = byId.get(m[1])
      if (!s) {
        errors.push(`unknown snippet id ${m[1]} (CODE SNIPPETS has ${snippets.length ? snippets.map((x) => x.id).join(', ') : 'none'})`)
        out.push(line)
      } else {
        used.push(s.id)
        out.push(...blockFor(s))
      }
      continue
    }
    for (const t of line.matchAll(TOKEN_ANY)) errors.push(`[[SNIPPET:${t[1]}]] must be alone on its own line`)
    out.push(line)
  }
  return { markdown: out.join('\n'), used, errors }
}

/** The reverse, for a repair or revision: each inserted block (and its source line) becomes its token again. */
export function tokeniseSnippets(markdown, snippets) {
  let md = String(markdown ?? '')
  for (const s of snippets) md = md.split(blockFor(s).join('\n')).join(`[[SNIPPET:${s.id}]]`)
  return md
}
