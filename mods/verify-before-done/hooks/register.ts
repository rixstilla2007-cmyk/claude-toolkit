import type { Register } from 'claude-code'

export const RULE = [
  'Правило пользователя (мод verify-before-done): прежде чем сказать, что задача готова,',
  'проверь результат на деле — запусти код, тесты или открой страницу.',
  'В конце ответа одной строкой напиши, как проверил, в виде «Проверка: …».',
  'Если проверить нельзя, так и скажи: «Проверка: не проверено — <почему>».',
].join(' ')

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    // Slash commands and hidden meta prompts are left as they are.
    if (e.command || e.isMeta) return next(e)
    if (e.context?.includes(RULE)) return next(e)
    return next({ ...e, context: [...(e.context ?? []), RULE] })
  })
}
