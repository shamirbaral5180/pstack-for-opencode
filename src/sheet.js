import { readFileSync } from "node:fs"
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
const ALIASES = new Set(["inherit-parent", "auto"])

export function parseSheet(text) {
  const sheet = { budget: "large", hook: true, roles: {}, generated: false }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^session hook:\s*off$/i.test(trimmed.replace(/^#\s*/, ""))) sheet.hook = false
    if (/Generated from the models configured/i.test(trimmed)) sheet.generated = true
    const budget = /^#\s*budget:\s*([a-z]+)/i.exec(trimmed)
    if (budget) sheet.budget = budget[1].toLowerCase()
    if (trimmed.startsWith("#")) continue
    const pair = /^([a-z][a-z, -]+):\s*(.+)$/.exec(trimmed)
    if (pair) sheet.roles[pair[1].trim()] = pair[2].trim()
  }
  if (!BUDGETS[sheet.budget]) sheet.budget = "large"
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

function normalizeRefValue(value, catalog, target) {
  const slash = value.indexOf("/")
  if (slash <= 0) return undefined
  const hash = value.indexOf("#", slash + 1)
  const base = hash === -1 ? value : value.slice(0, hash)
  const explicit = hash === -1 ? undefined : value.slice(hash + 1)
  const entry = catalog.find((item) => item.ref === base)
  if (!entry) return undefined
  const variant = explicit && entry.variants.includes(explicit) ? explicit : chooseVariant(entry, target)
  return variant ? `${base}#${variant}` : base
}

function normalizeEntry(value, kind, fallback, catalog, target) {
  if (ALIASES.has(value)) return value
  return normalizeRefValue(value, catalog, target) ?? normalizeRefValue(fallback, catalog, target) ?? fallback
}
function normalizeRole(value, kind, fallback, catalog, target) {
  const entries = value.split(",").map((item) => item.trim()).filter(Boolean)
  if (!entries.length) return fallback
  const fallbackEntries = fallback.split(",").map((item) => item.trim()).filter(Boolean)
  return entries
    .map((entry, index) => normalizeEntry(entry, kind, fallbackEntries[index] ?? fallbackEntries[0], catalog, target))
    .join(", ")
}

export function normalizeSheet(text, catalog, currentRef) {
  const parsed = parseSheet(text ?? "")
  const fallback = fallbacks(catalog, currentRef)
  const budget = BUDGETS[parsed.budget]
  const lines = [
    "# pstack model configuration for OpenCode. Generated from the models configured on this machine.",
    "# Rerun /setup-pstack to choose different models.",
    "# One line per role. Delete a line to fall back to the skill default.",
    "# `inherit-parent` or `auto`: the role runs on the parent chat model.",
    "# defaults: 3",
    `# budget: ${parsed.budget} (${budget.code})`,
  ]
  if (!parsed.hook) lines.push("# session hook: off")
  for (const role of ROLES) {
    let raw = parsed.roles[role.key]
    if (parsed.generated && raw && ALIASES.has(raw.split(",")[0].trim())) raw = undefined
    const source = raw ?? fallback?.[role.kind]
    const value = source && catalog.length ? normalizeRole(source, role.kind, fallback[role.kind], catalog, budget[role.kind]) : source
    lines.push(`${role.key}: ${value ?? "inherit-parent"}`)
  }
  return lines.join("\n") + "\n"
}

export function recommendedSheet(catalog, currentRef) {
  return normalizeSheet("", catalog, currentRef)
}

export function roleModel(text, role, catalog) {
  const parsed = parseSheet(text)
  const value = parsed.roles[role]
  if (!value || ALIASES.has(value.split(",")[0].trim())) return undefined
  const ref = value.split(",")[0].trim()
  const slash = ref.indexOf("/")
  if (slash <= 0) return undefined
  const hash = ref.indexOf("#", slash + 1)
  const providerID = ref.slice(0, slash)
  const id = ref.slice(slash + 1, hash === -1 ? undefined : hash)
  const variant = hash === -1 ? undefined : ref.slice(hash + 1)
  if (!catalog.some((entry) => entry.ref === (variant ? `${providerID}/${id}` : ref))) return undefined
  return { providerID, id, ...(variant ? { variant } : {}) }
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
