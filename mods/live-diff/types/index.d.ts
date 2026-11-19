export type DiffLine = { kind: ' ' | '+' | '-' | '@'; text: string }
export type FileChange = {
  path: string
  added: number
  removed: number
  isRunning: boolean
  isNew: boolean
  edits: number
  updatedAt: number
  lines: DiffLine[]
}

declare module 'claude-code' {
  interface PluginState {
    'live-diff': {
      files: Shaped<FileChange[]>
      originals: Shaped<Record<string, string | null>>
      selected: string | null
      cwd: string
    }
  }
}
