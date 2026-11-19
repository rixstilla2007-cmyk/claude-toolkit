import { expect, test } from 'claude-code/testing'
import { diffLines } from '../hooks/register'

const PANE = {
  plugin: 'live-diff', component: 'Pane', requestId: 'live-diff',
  props: { title: 'Изменения файлов', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('diff counts', () => {
  const d = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')
  expect(d.added).toBe(2)
  expect(d.removed).toBe(1)
})

test('an Edit shows in the pane and a click opens its diff', async ($, on) => {
  let content = 'one\ntwo\nthree\n'
  on('command.register', () => ({ value: { command: 'live-diff' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', () => ({ value: content }))
  on('tool.call', () => { content = 'one\nTWO\nthree\nfour\n'; return { result: {} } })

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.txt', old_string: 'two', new_string: 'TWO' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ key: 'f:/proj/src/a.txt' })
    if (!row) console.log(JSON.stringify(await ui.drawn()).slice(0, 1500))
    expect(row?.text).toContain('src/a.txt')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'f:/proj/src/a.txt' })
  expect((await ui.find({ type: 'Text', text: /^\+ four/ }))?.text).toBe('+ four')
  expect((await ui.find({ type: 'Text', text: /^- two/ }))?.text).toBe('- two')
  await ui.unmount()
})
