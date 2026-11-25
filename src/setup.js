import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { modelsPath } from "./paths.js"

// A safe starting point for OpenCode: every role inherits the chat model.
// /setup-pstack can refine it with real provider/model IDs.
export const DEFAULT_SHEET = `# pstack model configuration for OpenCode. One line per role. Delete a line to fall back to the skill default.
# \`inherit-parent\` or \`auto\`: the role runs on the parent chat model.
# defaults: 3
# budget: large (xhigh)
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
arena runners: inherit-parent
arena cross-judge pool: inherit-parent
swarm workers: inherit-parent
interrogate reviewers: inherit-parent
`

export function ensureModelSheet(target = modelsPath) {
  if (existsSync(target)) return { created: false, path: target }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, DEFAULT_SHEET)
  return { created: true, path: target }
}
