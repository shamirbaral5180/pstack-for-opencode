import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { modelsPath } from "./paths.js"

// A safe starting point when no models can be detected.
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

function withVariant(catalog, ref, variant) {
  const base = ref.split("#")[0]
  const entry = catalog.find((item) => item.ref === base)
  return entry?.variants.includes(variant) ? `${base}#${variant}` : ref
}

function rank(catalog) {
  const ranked = []
  for (const entry of catalog) {
    if (!ranked.some((item) => item.providerID === entry.providerID)) ranked.push(entry)
  }
  for (const entry of catalog) if (!ranked.includes(entry)) ranked.push(entry)
  return ranked
}

export function recommendSheet(catalog, currentRef) {
  if (!catalog.length) return DEFAULT_SHEET
  const ranked = rank(catalog)
  const current = catalog.find((entry) => entry.ref === currentRef || entry.ref === currentRef?.split("#")[0])
  const primary = current?.ref ?? ranked[0].ref
  const primaryProvider = catalog.find((entry) => entry.ref === primary.split("#")[0])?.providerID
  const secondary = ranked.find((entry) => entry.providerID !== primaryProvider)?.ref ?? primary
  const panel = ranked.slice(0, 3).map((entry) => entry.ref)
  const crossJudge = ranked
    .filter((entry) => entry.providerID !== primaryProvider)
    .slice(0, 2)
    .map((entry) => entry.ref)
  const judges = crossJudge.length ? crossJudge : panel.slice(0, 2)
  const swarm = withVariant(catalog, primary, "low")
  return `# pstack model configuration for OpenCode. Generated from the models configured on this machine.
# Rerun /setup-pstack to choose different models.
# defaults: 3
# budget: large (xhigh)
feature, refactoring: ${primary}
bug-fix: ${primary}
perf-issue: ${primary}
hillclimb: ${primary}
judgment and prose: ${secondary}
arena runners: ${panel.join(", ")}
arena cross-judge pool: ${judges.join(", ")}
swarm workers: ${swarm}
interrogate reviewers: ${panel.join(", ")}
`
}

export function ensureModelSheet(target = modelsPath, catalog = [], currentRef) {
  if (existsSync(target)) return { created: false, path: target }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, recommendSheet(catalog, currentRef))
  return { created: true, path: target }
}
