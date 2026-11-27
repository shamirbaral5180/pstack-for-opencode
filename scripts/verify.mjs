// Parity gate: the vendored snapshot, the generated data, and the registered
// paths must agree. Run after `npm run hash` and `npm run generate`.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import agents from "../src/data/agents.js"
import commands from "../src/data/commands.js"
import inventory from "../src/data/inventory.json" with { type: "json" }
import skills from "../src/data/skills.js"
import { vendorRoot } from "../src/paths.js"

const root = join(import.meta.dirname, "..")
const manifest = JSON.parse(readFileSync(join(root, "vendor", "MANIFEST.json"), "utf8"))
const failures = []

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const installed = process.argv.includes("--installed")
const renameGitIgnore = installed && !existsSync(join(vendorRoot, ".gitignore"))
const vendorPath = (file) => {
  const key = relative(vendorRoot, file).split(sep).join("/")
  // npm renames .gitignore on extraction. Still require its original bytes.
  return renameGitIgnore && key === ".npmignore" ? ".gitignore" : key
}
const actual = new Map(walk(vendorRoot).map((file) => [vendorPath(file), file]))
const listed = Object.keys(manifest.files)
const actualKeys = [...actual.keys()]

if (actual.size !== manifest.fileCount) failures.push(`file count ${actual.size} != manifest ${manifest.fileCount}`)
const missing = actualKeys.filter((key) => manifest.files[key] === undefined)
const extra = listed.filter((key) => !actual.has(key))
if (missing.length) failures.push(`files not in manifest: ${missing.slice(0, 5).join(", ")}`)
if (extra.length) failures.push(`manifest files missing on disk: ${extra.slice(0, 5).join(", ")}`)

const combined = createHash("sha256")
let bytes = 0
for (const key of listed) {
  const file = actual.get(key)
  if (!file) continue
  const data = readFileSync(file)
  const hash = createHash("sha256").update(data).digest("hex")
  if (manifest.files[key] !== hash) failures.push(`hash drift ${key}`)
  bytes += data.length
  combined.update(key).update("\0").update(hash).update("\n")
}

if (manifest.bytes !== bytes) failures.push(`byte total ${bytes} != manifest ${manifest.bytes}`)
if (combined.digest("hex") !== manifest.root) failures.push("manifest root hash differs")

if (inventory.skills !== skills.length) failures.push("inventory skill count differs")
if (inventory.commands !== commands.length) failures.push("inventory command count differs")
if (inventory.agents !== agents.length) failures.push("inventory agent count differs")

for (const skill of skills) {
  if (!existsSync(join(vendorRoot, skill.source))) failures.push(`missing skill source ${skill.source}`)
}
for (const agent of agents) {
  if (!existsSync(join(vendorRoot, agent.source))) failures.push(`missing agent source ${agent.source}`)
}

const ids = new Set(skills.map((skill) => skill.id))
const names = new Set()
for (const command of commands) {
  if (!ids.has(command.skillId)) failures.push(`command ${command.name} has no skill`)
  if (names.has(command.name)) failures.push(`duplicate command ${command.name}`)
  names.add(command.name)
}

if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log(
  `ok: ${manifest.fileCount} vendored files, ${skills.length} skills, ${commands.length} commands, ` +
    `${agents.length} agents, root ${manifest.root}`,
)
