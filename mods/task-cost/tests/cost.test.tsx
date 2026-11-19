import { expect, test } from 'claude-code/testing'

test('a finished task fills the band and the day total grows', async ($, on) => {
  let usd = 1.0
  const store: Record<string, unknown> = {}
  const statuses: (string | undefined)[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd } } }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 17, 12) }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const round of [1, 2]) {
    await $.turn.start({ text: 'hi', turnId: `t${round}` })
    usd += 0.25
    await $.turn.complete({
      answer: 'ok',
      durationMs: 4000,
      isAborted: false,
      turnId: `t${round}`,
      reason: 'answer',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 500,
        model: 'm',
      },
    })
  }
  expect(statuses.at(-1)).toBe('Сегодня: 20k токенов · ≈$0.500 · задач: 2')

  const ui = await $.ui.mount({
    plugin: 'task-cost',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /Задача: 10k/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /≈\$0\.250/ })) !== undefined).toBe(true)
  await ui.unmount()
})
