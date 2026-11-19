export type TaskCost = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number | null
  model: string
  seconds: number
}
export type DayTotal = { day: string; tokens: number; usd: number; tasks: number }

declare module 'claude-code' {
  interface PluginState {
    'task-cost': {
      last: TaskCost | null
      today: DayTotal | null
      baseUsd: number | null
      isHidden: boolean
    }
  }
}
