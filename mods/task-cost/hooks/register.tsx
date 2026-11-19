import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayTotal, TaskCost } from '../types'

const last = atom({ plugin: 'task-cost', key: 'last' } as const, null)
const today = atom({ plugin: 'task-cost', key: 'today' } as const, null)
const baseUsd = atom({ plugin: 'task-cost', key: 'baseUsd' } as const, null)
const isHidden = atom({ plugin: 'task-cost', key: 'isHidden' } as const, false)

export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function fmtUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

const totalOf = (t: TaskCost) => t.input + t.output + t.cacheRead + t.cacheWrite

/** The session's cost as /cost totals it (the engine's own API price table). */
async function sessionUsd($: EngineInterface): Promise<number | null> {
  try {
    return (await $.session.usage()).cost?.usd ?? null
  } catch {
    return null
  }
}

async function loadToday($: EngineInterface, now: number): Promise<DayTotal> {
  const day = dayKey(now)
  const stored = (await $.store.get(`day:${day}`)) as Partial<DayTotal> | undefined
  return {
    day,
    tokens: typeof stored?.tokens === 'number' ? stored.tokens : 0,
    usd: typeof stored?.usd === 'number' ? stored.usd : 0,
    tasks: typeof stored?.tasks === 'number' ? stored.tasks : 0,
  }
}

function showStatus($: EngineInterface, t: DayTotal) {
  $.ui.status(`Сегодня: ${fmtTokens(t.tokens)} токенов · ≈${fmtUsd(t.usd)} · задач: ${t.tasks}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const t = await loadToday($, await $.clock.now())
    await update($, today, () => t)
    showStatus($, t)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const usd = await sessionUsd($)
      await update($, baseUsd, () => usd)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const u = e.usage
    const endUsd = await sessionUsd($)
    const startUsd = await read($, baseUsd)
    const usd = endUsd !== null && startUsd !== null ? Math.max(0, endUsd - startUsd) : null
    await update($, baseUsd, () => endUsd)

    const task: TaskCost = {
      input: u?.input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
      cacheWrite: u?.cache_creation_input_tokens ?? 0,
      usd,
      model: u?.model ?? '',
      seconds: Math.round(e.durationMs / 1000),
    }
    if (totalOf(task) === 0 && !usd) return result

    const now = await $.clock.now()
    const prev = await loadToday($, now)
    const t: DayTotal = {
      ...prev,
      tokens: prev.tokens + totalOf(task),
      usd: prev.usd + (usd ?? 0),
      tasks: prev.tasks + 1,
    }
    await $.store.set(`day:${t.day}`, t)
    await update($, today, () => t)
    await update($, last, () => task)
    await update($, isHidden, () => false)
    showStatus($, t)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const task = await read($, last)
    if (e.props.hasSurvey || task === null || (await read($, isHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text>
          <Text bold>Задача: {fmtTokens(totalOf(task))} токенов</Text>
          <Text dimColor>
            {' '}(вход {fmtTokens(task.input)}, кэш {fmtTokens(task.cacheRead)}/{fmtTokens(task.cacheWrite)}, выход{' '}
            {fmtTokens(task.output)})
          </Text>
          {' · '}
          <Text color="success">{task.usd === null ? 'цена неизвестна' : `≈${fmtUsd(task.usd)}`}</Text>
          <Text dimColor> · {task.seconds}s</Text>
        </Text>
        <Button key="hide" label="Скрыть" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
