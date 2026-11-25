// Fails when translated content still contains Cursor-only paths, model slugs,
// or subagent fields. Covers both the registered skill bodies and the cached
// playbooks and references the model reads at runtime.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import agents from "../src/data/agents.js"
import skills from "../src/data/skills.js"
import { ensureTranslated, translateText } from "../src/translate.js"

const forbidden = [
  ".cursor",
  "claude-",
  "gemini-",
  'environment: "cloud"',
  "subagent_type",
  "/loop",
  "background: true",
  "readonly: true",
  "agent-transcripts",
  "the pstack root",
  "~/.config/opencode/projects",
]

// Cursor-only concepts. Comparison docs and the guide may name Cursor on purpose,
// so these are checked in registered bodies and in the skills the model reads.
const cursorOnly = [
  "Cursor cloud agent",
  "Cursor's built-in",
  "Cursor's docs",
  "Cursor's Plan Mode",
  "Cursor's `/loop`",
  "built for Cursor",
  "cursor-team-kit",
  "cursor.com/docs",
  "create-skill",
  "Bugbot",
  "Custom Modes",
]

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const failures = []

function report(label, text, needles, withContext) {
  for (const needle of needles) {
    const index = text.indexOf(needle)
    if (index === -1) continue
    const detail = withContext
      ? `: ${text.slice(Math.max(0, index - 60), index + 90).replace(/\n/g, " ")}`
      : ""
    failures.push(`${label} still has ${JSON.stringify(needle)}${detail}`)
  }
}

for (const item of [...skills, ...agents]) {
  const text = translateText(item.content ?? item.system, "ROOT")
  report(item.id, text, forbidden, true)
  report(item.id, text, cursorOnly, true)
}

const { root } = ensureTranslated()
const skillRoots = [join(root, "skills"), join(root, "adapter")]
for (const file of walk(root)) {
  if (!file.endsWith(".md")) continue
  const text = readFileSync(file, "utf8")
  report(file, text, forbidden, false)
  if (skillRoots.some((directory) => file.startsWith(directory))) report(file, text, cursorOnly, false)
}

if (failures.length) {
  console.error(failures.slice(0, 40).join("\n"))
  console.error(`\n${failures.length} translations still contain Cursor-only text`)
  process.exit(1)
}

console.log(`translation audit ok: registered bodies and ${walk(root).filter((file) => file.endsWith(".md")).length} cached files clean`)
