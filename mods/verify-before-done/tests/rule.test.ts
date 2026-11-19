import { expect, test } from 'claude-code/testing'
import { RULE } from '../hooks/register'

test('the rule rides along with every typed prompt', async ($, on) => {
  let seen: readonly string[] | undefined
  on('prompt.submit', (_, e) => {
    seen = e.context
    return { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: 'сделай функцию', wait: false, origin: { kind: 'composer' } })
  expect(seen?.length).toBe(1)
  expect(seen?.[0]).toBe(RULE)
})
