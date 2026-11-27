import { readFileSync } from "node:fs"
import { parseRef } from "./models.js"
import { modelsPath } from "./paths.js"

export const ROLES = [
  { key: "feature, refactoring", kind: "code" },
  { key: "bug-fix", kind: "code" },
  { key: "perf-issue", kind: "code" },
  { key: "hillclimb", kind: "code" },
  { key: "judgment and prose", kind: "judgment" },
  { key: "arena runners", kind: "panel" },
  { key: "arena cross-judge pool", kind: "judge" },
  { key: "swarm workers", kind: "swarm" },
  { key: "interrogate reviewers", kind: "panel" },
]

const BUDGETS = {
  large: { code: "xhigh", judgment: "xhigh", panel: "high", judge: "high", swarm: "high" },
  medium: { code: "high", judgment: "high", panel: "medium", judge: "medium", swarm: "medium" },
  small: { code: "medium", judgment: "medium", panel: "low", judge: "low", swarm: "low" },
}

const LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
export const isModelAlias = (value) => value === "inherit-parent" || value === "auto"
const roleLine = /^([a-z][a-z, -]+):[ \t]*(.*)$/
const budgetLine = /^#\s*budget:\s*(\S+)/i

export function parseSheet(text) {
  const sheet = { budget: "large", hook: true, roles: {} }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^session hook:\s*off$/i.test(trimmed.replace(/^#\s*/, ""))) sheet.hook = false
    const budget = budgetLine.exec(trimmed)
    if (budget) sheet.budget = budget[1].toLowerCase()
    if (trimmed.startsWith("#")) continue
    const pair = roleLine.exec(trimmed)
    if (pair) sheet.roles[pair[1].trim()] = pair[2].trim()
  }
  if (!Object.hasOwn(BUDGETS, sheet.budget)) sheet.budget = "large"
  return sheet
}

function rank(catalog) {
  const ranked = []
  for (const entry of catalog) {
    if (!ranked.some((item) => item.providerID === entry.providerID)) ranked.push(entry)
  }
  for (const entry of catalog) if (!ranked.includes(entry)) ranked.push(entry)
  return ranked
}

function fallbacks(catalog, currentRef) {
  if (!catalog.length) return undefined
  const ranked = rank(catalog)
  const base = currentRef?.split("#")[0]
  const current = catalog.find((entry) => entry.ref === base)
  const primary = current?.ref ?? ranked[0].ref
  const primaryProvider = catalog.find((entry) => entry.ref === primary.split("#")[0])?.providerID
  const secondary = ranked.find((entry) => entry.providerID !== primaryProvider)?.ref ?? primary
  const panel = ranked.slice(0, 3).map((entry) => entry.ref)
  const judge = ranked
    .filter((entry) => entry.providerID !== primaryProvider)
    .slice(0, 2)
    .map((entry) => entry.ref)
  return {
    code: primary,
    judgment: secondary,
    panel: panel.join(", "),
    judge: (judge.length ? judge : panel.slice(0, 2)).join(", "),
    swarm: primary,
  }
}

function chooseVariant(entry, target) {
  if (!entry || !target) return undefined
  if (entry.variants.includes(target)) return target
  const targetIndex = LADDER.indexOf(target)
  if (targetIndex === -1) return undefined
  for (let index = targetIndex; index >= 0; index -= 1) {
    if (entry.variants.includes(LADDER[index])) return LADDER[index]
  }
  return undefined
}

export function availableRef(value, catalog) {
  const model = parseRef(value)
  return !!model && catalog.some((entry) =>
    entry.ref === `${model.providerID}/${model.id}` && (!model.variant || entry.variants.includes(model.variant)),
  )
}

function budgetLabel(budget) {
  return `# budget: ${budget} (${BUDGETS[budget].code})`
}

export function recommendedSheet(catalog, currentRef, budget = "large") {
  const fallback = fallbacks(catalog, currentRef)
  const lines = [
    "# pstack model configuration for OpenCode. Generated from the models configured on this machine.",
    "# Rerun /setup-pstack to choose different models.",
    "# One line per role. Delete a line to fall back to the skill default.",
    "# `inherit-parent` or `auto`: the role runs on the parent chat model.",
    "# defaults: 3",
    budgetLabel(budget),
  ]
  for (const role of ROLES) {
    const refs = fallback?.[role.kind].split(", ").map((ref) => {
      const variant = chooseVariant(catalog.find((entry) => entry.ref === ref), BUDGETS[budget][role.kind])
      return variant ? `${ref}#${variant}` : ref
    })
    lines.push(`${role.key}: ${refs?.join(", ") ?? "inherit-parent"}`)
  }
  return lines.join("\n") + "\n"
}

export function proposeSheet(saved, catalog, currentRef, { budget, roles = {} }) {
  if (budget !== undefined && !Object.hasOwn(BUDGETS, budget)) throw new Error("Choose a large, medium, or small budget.")
  const existing = parseSheet(saved ?? "")
  const edits = new Map()
  for (const [key, value] of Object.entries(roles)) {
    const role = ROLES.find((item) => item.key === key)
    if (!role) throw new Error(`Unknown model role: ${key}`)
    if (typeof value !== "string" || /[\r\n]/.test(value)) throw new Error(`Enter one line for ${key}.`)
    if (value === existing.roles[key]) continue
    const refs = value.split(",").map((item) => item.trim())
    if (!["panel", "judge"].includes(role.kind) && refs.length > 1) throw new Error(`Choose one model for ${key}.`)
    const retained = existing.roles[key]?.split(",").map((item) => item.trim()) ?? []
    for (const ref of refs) {
      if (isModelAlias(ref) || availableRef(ref, catalog)) continue
      const index = retained.indexOf(ref)
      if (index < 0) throw new Error(`${ref || "(empty)"} is not an available choice for ${key}.`)
      retained.splice(index, 1)
    }
    edits.set(key, refs.join(", "))
  }

  const original = saved ?? recommendedSheet(catalog, currentRef, budget)
  const changeBudget = saved !== undefined && budget !== undefined && budget !== existing.budget
  if (!changeBudget && !edits.size) return original
  const eol = original.includes("\r\n") ? "\r\n" : "\n"
  const lines = original ? original.split(/\r?\n/) : []
  const additions = []
  const replaceLast = (match, line) => {
    const index = lines.findLastIndex((item) => match(item.trim()))
    if (index < 0) additions.push(line)
    else lines[index] = line
  }
  if (changeBudget) replaceLast((line) => budgetLine.test(line), budgetLabel(budget))
  for (const [key, value] of edits) {
    replaceLast((line) => roleLine.exec(line)?.[1].trim() === key, `${key}: ${value}`)
  }
  if (additions.length) lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, ...additions)
  return lines.join(eol)
}

export function hookEnabled(text) {
  return parseSheet(text ?? "").hook
}

export function readSheet(target = modelsPath) {
  try {
    return readFileSync(target, "utf8")
  } catch {
    return ""
  }
}
