import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DiffLine, FileChange } from '../types'

const PANE = 'live-diff'
const TITLE = 'Изменения файлов'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
const MAX_ORIGINAL = 512 * 1024
const MAX_DIFF_LINES = 2000
const CONTEXT = 3

const files = atom({ plugin: 'live-diff', key: 'files' } as const, [], {
  shape: 'files-1',
})
const originals = atom({ plugin: 'live-diff', key: 'originals' } as const, {}, {
  shape: 'originals-1',
})
const selected = atom({ plugin: 'live-diff', key: 'selected' } as const, null)
const cwd = atom({ plugin: 'live-diff', key: 'cwd' } as const, '')

// ---------- diff ----------

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Line diff: common prefix/suffix trimmed, LCS on the middle. */
export function diffLines(before: string, after: string): {
  added: number
  removed: number
  lines: DiffLine[]
} {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const ops: { kind: ' ' | '+' | '-'; text: string }[] = []
  for (let i = 0; i < start; i++) ops.push({ kind: ' ', text: a[i] ?? '' })

  const n = midA.length
  const m = midB.length
  if (n * m <= 4_000_000 && n > 0 && m > 0) {
    const w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          midA[i] === midB[j]
            ? (dp[(i + 1) * w + j + 1] ?? 0) + 1
            : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ kind: ' ', text: midA[i] ?? '' })
        i++
        j++
      } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0)) {
        ops.push({ kind: '-', text: midA[i++] ?? '' })
      } else {
        ops.push({ kind: '+', text: midB[j++] ?? '' })
      }
    }
    while (i < n) ops.push({ kind: '-', text: midA[i++] ?? '' })
    while (j < m) ops.push({ kind: '+', text: midB[j++] ?? '' })
  } else {
    for (const t of midA) ops.push({ kind: '-', text: t })
    for (const t of midB) ops.push({ kind: '+', text: t })
  }
  for (let i = endA; i < a.length; i++) ops.push({ kind: ' ', text: a[i] ?? '' })

  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.kind === '+') added++
    else if (op.kind === '-') removed++
  }

  // Hunks with context, unified-diff style.
  const keep = new Uint8Array(ops.length)
  ops.forEach((op, k) => {
    if (op.kind === ' ') return
    for (let c = Math.max(0, k - CONTEXT); c <= Math.min(ops.length - 1, k + CONTEXT); c++) keep[c] = 1
  })
  const lines: DiffLine[] = []
  let lineA = 0
  let lineB = 0
  let inHunk = false
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!
    if (keep[k]) {
      if (!inHunk) {
        lines.push({ kind: '@', text: `@@ −${lineA + 1} +${lineB + 1} @@` })
        inHunk = true
      }
      lines.push(op)
    } else {
      inHunk = false
    }
    if (op.kind !== '+') lineA++
    if (op.kind !== '-') lineB++
  }
  if (lines.length > MAX_DIFF_LINES) {
    const cut = lines.length - MAX_DIFF_LINES
    lines.length = MAX_DIFF_LINES
    lines.push({ kind: '@', text: `… ещё ${cut} строк diff не показано` })
  }
  return { added, removed, lines }
}

// ---------- helpers ----------

function shortPath(path: string, base: string): string {
  if (base && path.startsWith(base.endsWith('/') ? base : base + '/')) {
    return path.slice(base.length + (base.endsWith('/') ? 0 : 1))
  }
  return path
}

async function readOrNull($: Parameters<Parameters<Parameters<Register>[0]>[2]>[0], path: string) {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, cwd, () => e.cwd)
    await $.command.register({
      name: 'live-diff',
      description: 'Открыть панель с изменениями файлов',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'live-diff' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Панель «Изменения файлов» открыта.' }
  })

  on('tool.call', async ($, e, next) => {
    if (!EDIT_TOOLS.has(e.tool)) return next(e)
    const path = (e as unknown as { file_path?: unknown }).file_path
    if (typeof path !== 'string' || path === '') return next(e)

    const before = await readOrNull($, path)
    const known = await read($, originals)
    if (!(path in known)) {
      const keepBefore = before !== null && before.length > MAX_ORIGINAL ? before.slice(0, MAX_ORIGINAL) : before
      await update($, originals, o => (path in o ? o : { ...o, [path]: keepBefore }))
    }
    await update($, files, list => {
      const found = list.find(f => f.path === path)
      if (found) return list.map(f => (f.path === path ? { ...f, isRunning: true, updatedAt: Date.now() } : f))
      return [
        ...list,
        { path, added: 0, removed: 0, isRunning: true, isNew: before === null, edits: 0, updatedAt: Date.now(), lines: [] },
      ]
    })

    let result
    try {
      result = await next(e)
    } finally {
      const after = (await readOrNull($, path)) ?? ''
      const origin = (await read($, originals))[path] ?? null
      const { added, removed, lines } = diffLines(origin ?? '', after)
      await update($, files, list =>
        list
          .map((f): FileChange =>
            f.path === path
              ? { ...f, added, removed, lines, isRunning: false, edits: f.edits + 1, updatedAt: Date.now() }
              : f,
          )
          // An edit that changed nothing (or failed on a file it never touched) leaves no row.
          .filter(f => f.path !== path || f.isRunning || f.added + f.removed > 0),
      )
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const pick = await read($, selected)
    const base = await read($, cwd)
    const totalAdded = list.reduce((s, f) => s + f.added, 0)
    const totalRemoved = list.reduce((s, f) => s + f.removed, 0)
    const running = list.filter(f => f.isRunning).length

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text bold>{list.length} файл(ов)</Text>
          <Text>
            <Text color="diffAdded">+{totalAdded}</Text> <Text color="diffRemoved">−{totalRemoved}</Text>
            {running > 0 ? ' · правлю…' : ''}
          </Text>
        </Box>
      )
    }

    const current = pick ? list.find(f => f.path === pick) : undefined
    if (current) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" onPress={() => update($, selected, () => null)}>
              ← Назад
            </Button>
          </Box>
          <Text bold wrap="truncate-start">
            {shortPath(current.path, base)}
          </Text>
          <Text>
            <Text color="diffAdded">+{current.added}</Text> <Text color="diffRemoved">−{current.removed}</Text>
            <Text dimColor>
              {' '}
              · {current.isNew ? 'новый файл' : 'с начала сессии'} · правок: {current.edits}
              {current.isRunning ? ' · правлю…' : ''}
            </Text>
          </Text>
          <Text> </Text>
          {current.lines.length === 0 && <Text dimColor>Отличий нет.</Text>}
          {current.lines.map(line =>
            line.kind === '@' ? (
              <Text color="suggestion" dimColor>
                {line.text}
              </Text>
            ) : line.kind === '+' ? (
              <Text color="diffAdded" wrap="wrap">
                + {line.text}
              </Text>
            ) : line.kind === '-' ? (
              <Text color="diffRemoved" wrap="wrap">
                - {line.text}
              </Text>
            ) : (
              <Text dimColor wrap="wrap">
                {'  '}
                {line.text}
              </Text>
            ),
          )}
        </Box>
      )
    }

    const sorted = [...list].sort((x, y) => y.updatedAt - x.updatedAt)
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{list.length} файл(ов)</Text>
          {'  '}
          <Text color="diffAdded">+{totalAdded}</Text> <Text color="diffRemoved">−{totalRemoved}</Text>
        </Text>
        {list.length === 0 && <Text dimColor>Пока ни один файл не изменён. Здесь появятся правки Edit/Write.</Text>}
        {sorted.map(f => (
          <Button key={`f:${f.path}`} onPress={() => update($, selected, () => f.path)}>
            <Text color={f.isRunning ? 'warning' : 'success'}>{f.isRunning ? '●' : '✓'}</Text>{' '}
            <Text color="diffAdded">+{f.added}</Text> <Text color="diffRemoved">−{f.removed}</Text>{' '}
            {shortPath(f.path, base)}
            {f.isNew ? <Text dimColor> (новый)</Text> : ''}
          </Button>
        ))}
        {list.length > 0 && <Text dimColor>Нажмите на файл, чтобы увидеть изменения.</Text>}
      </Box>
    )
  })
}
