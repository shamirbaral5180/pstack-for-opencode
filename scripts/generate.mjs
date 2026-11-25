// Builds the OpenCode registration data from the vendored pstack snapshot.
// Content is copied verbatim; only frontmatter is parsed for metadata.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { parseFrontmatter } from "./frontmatter.mjs"

const root = join(import.meta.dirname, "..")
const vendor = join(root, "vendor", "pstack")
const data = join(root, "src", "data")

function readSkills() {
  const skills = []
  for (const entry of readdirSync(join(vendor, "skills"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(vendor, "skills", entry.name, "SKILL.md")
    const { data: fields, body } = parseFrontmatter(readFileSync(path, "utf8"), path)
    const skill = {
      id: `pstack-${entry.name}`,
      name: String(fields.name ?? entry.name),
      description: String(fields.description ?? `${entry.name} skill`),
      source: `skills/${entry.name}/SKILL.md`,
      content: body,
    }
    if (fields["disable-model-invocation"] === true) skill.autoinvoke = false
    skills.push(skill)
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

function readAgents() {
  const agents = []
  for (const entry of readdirSync(join(vendor, "agents"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const path = join(vendor, "agents", entry.name)
    const { data: fields, body } = parseFrontmatter(readFileSync(path, "utf8"), path)
    const name = String(fields.name ?? entry.name.replace(/\.md$/, ""))
    agents.push({
      id: `pstack:${name}`,
      name,
      description: String(fields.description ?? `${name} subagent`),
      source: `agents/${entry.name}`,
      system: body,
    })
  }
  return agents.sort((a, b) => a.id.localeCompare(b.id))
}

function write(name, value) {
  const module = name.endsWith(".json") ? JSON.stringify(value, null, 2) : `export default ${JSON.stringify(value, null, 2)}`
  writeFileSync(join(data, name), module + "\n")
}

mkdirSync(data, { recursive: true })

const skills = readSkills()
const agents = readAgents()
const commands = skills.map((skill) => ({
  name: skill.id.replace(/^pstack-/, ""),
  description: skill.description,
  skillId: skill.id,
}))

write("skills.js", skills)
write("commands.js", commands)
write("agents.js", agents)

const inventory = {
  skills: skills.length,
  commands: commands.length,
  agents: agents.length,
  principles: skills.filter((skill) => skill.id.startsWith("pstack-principle-")).length,
  playbooks: readdirSync(join(vendor, "skills", "poteto-mode", "playbooks")).filter((f) => f.endsWith(".md")).length,
  markdownFiles: countMarkdown(join(vendor, "skills")),
  markdownBytes: markdownBytes(join(vendor, "skills")),
}
write("inventory.json", inventory)

function countMarkdown(directory) {
  let count = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) count += countMarkdown(path)
    else if (entry.isFile() && entry.name.endsWith(".md")) count += 1
  }
  return count
}

function markdownBytes(directory) {
  let bytes = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) bytes += markdownBytes(path)
    else if (entry.isFile() && entry.name.endsWith(".md")) bytes += statSync(path).size
  }
  return bytes
}

console.log(
  `generated ${inventory.skills} skills, ${inventory.commands} commands, ${inventory.agents} agents, ` +
    `${inventory.playbooks} playbooks, ${inventory.principles} principles`,
)
