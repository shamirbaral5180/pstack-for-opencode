import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import plugin from "../src/index.js"
import agents from "../src/data/agents.js"
import commands from "../src/data/commands.js"
import skills from "../src/data/skills.js"
import { MANDATE, MAPPING, SETUP_OVERRIDE } from "../src/overlay.js"
import { portable, vendorRoot } from "../src/paths.js"
import { ensureModelSheet, recommendSheet } from "../src/setup.js"

function bodyOf(path) {
  const text = readFileSync(path, "utf8")
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  assert.ok(match, `frontmatter missing in ${path}`)
  return text.slice(match[0].length)
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex")
}

const CATALOG = [
  { ref: "alpha/one", name: "One", providerID: "alpha", id: "one", variants: ["low", "high", "xhigh"] },
  { ref: "beta/two", name: "Two", providerID: "beta", id: "two", variants: ["high"] },
  { ref: "gamma/three", name: "Three", providerID: "gamma", id: "three", variants: [] },
]

function mockContext(options = {}) {
  const registered = {
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    prompts: [],
    session: { parentID: undefined },
    models: CATALOG,
  }

  const ctx = {
    options,
    model: {
      list: async () => ({ location: { directory: process.cwd() }, data: registered.models }),
    },
    skill: {
      transform: async (fn) =>
        fn({
          get: (id) => registered.skills.find((skill) => skill.id === id),
          add: (skill) => registered.skills.push(skill),
        }),
    },
    command: {
      transform: async (fn) => fn({ add: (command) => registered.commands.push(command) }),
    },
    agent: {
      transform: async (fn) =>
        fn({
          get: (id) => registered.agents.find((agent) => agent.id === id),
          update: (id, apply) => {
            if (registered.agents.some((agent) => agent.id === id)) return
            const entry = { id, permissions: [] }
            registered.agents.push(entry)
            apply(entry)
          },
        }),
    },
    session: {
      hook: async (name, callback) => registered.hooks.push({ name, callback }),
      get: async () => ({ data: registered.session }),
      prompt: async (input) => registered.prompts.push(input),
    },
  }

  return { ctx, registered }
}

test("registers every skill, command, and agent", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  assert.equal(registered.skills.length, 59)
  assert.equal(registered.commands.length, 59)
  assert.equal(registered.agents.length, 3)
  assert.equal(registered.hooks.length, 1)
  assert.equal(registered.hooks[0].name, "context")
})

test("registered skill content is byte-identical to the vendored original", () => {
  for (const skill of skills) {
    const source = join(vendorRoot, skill.source)
    assert.equal(sha(skill.content), sha(bodyOf(source)), `content drift in ${skill.source}`)
  }
})

test("registered agent system prompts are byte-identical to the vendored original", () => {
  for (const agent of agents) {
    const source = join(vendorRoot, agent.source)
    assert.equal(sha(agent.system), sha(bodyOf(source)), `content drift in ${agent.source}`)
  }
})

test("every command maps to a registered skill and has a unique name", () => {
  const ids = new Set(skills.map((skill) => skill.id))
  const names = new Set()
  for (const command of commands) {
    assert.ok(ids.has(command.skillId), `unknown skill ${command.skillId}`)
    assert.ok(!names.has(command.name), `duplicate command ${command.name}`)
    names.add(command.name)
  }
})

test("running a command attaches its skill and keeps the user text", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  const command = registered.commands.find((item) => item.name === "poteto-mode")
  await command.execute({ sessionID: "s1", prompt: { text: "fix the login bug" }, delivery: "steer" })

  const prompt = registered.prompts.at(-1)
  assert.equal(prompt.skills[0].id, "pstack-poteto-mode")
  assert.equal(prompt.text, "fix the login bug")
  assert.equal(prompt.sessionID, "s1")
})

test("setup writes real model refs and puts distinct providers in panels", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-setup-"))
  const target = join(directory, "pstack-models.md")
  try {
    const { ctx, registered } = mockContext({ modelsPath: target })
    registered.session = { model: { providerID: "alpha", id: "one" } }
    await plugin.setup(ctx)

    const command = registered.commands.find((item) => item.name === "setup-pstack")
    await command.execute({ sessionID: "s1", prompt: { text: "" }, delivery: "steer" })

    const prompt = registered.prompts.at(-1)
    assert.equal(prompt.skills[0].id, "pstack-setup-pstack")
    assert.ok(prompt.text.includes(SETUP_OVERRIDE))
    assert.ok(prompt.text.includes("<pstack_model_catalog>"))
    assert.ok(prompt.text.includes("alpha/one"))

    assert.ok(existsSync(target))
    const sheet = readFileSync(target, "utf8")
    assert.match(sheet, /feature, refactoring: alpha\/one/)
    assert.match(sheet, /judgment and prose: beta\/two/)
    assert.match(sheet, /arena runners: alpha\/one, beta\/two, gamma\/three/)
    assert.match(sheet, /arena cross-judge pool: beta\/two, gamma\/three/)
    assert.match(sheet, /swarm workers: alpha\/one#low/)
    assert.ok(!sheet.includes("inherit-parent"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("recommended sheet uses real refs and never writes inherit-parent", () => {
  const sheet = recommendSheet(CATALOG, "alpha/one#high")
  assert.ok(sheet.includes("alpha/one"))
  assert.ok(!sheet.includes("inherit-parent"))
})

test("ensureModelSheet keeps an existing sheet", () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-sheet-"))
  const target = join(directory, "pstack-models.md")
  try {
    writeFileSync(target, "custom\n")
    const result = ensureModelSheet(target, CATALOG, "alpha/one")
    assert.equal(result.created, false)
    assert.equal(readFileSync(target, "utf8"), "custom\n")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("mapping covers subagent fields and Cursor paths", () => {
  for (const needle of [
    "generalPurpose",
    "pstack:readonly",
    "sessionID",
    "background: true",
    ".opencode/skills/",
    "opencode session export",
    "~/.cursor/projects",
  ]) {
    assert.ok(MAPPING.includes(needle), `mapping is missing ${needle}`)
  }
})

test("root sessions receive mapping, routing, and the model sheet", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)
  const { callback } = registered.hooks[0]

  const event = { sessionID: "root", system: [] }
  await callback(event)

  const text = event.system.map((part) => part.text).join("\n")
  assert.ok(text.includes(MAPPING))
  assert.ok(text.includes(MANDATE))
})

test("child sessions receive mapping but not routing", async () => {
  const { ctx, registered } = mockContext()
  registered.session = { parentID: "root" }
  await plugin.setup(ctx)

  const event = { sessionID: "child", system: [] }
  await registered.hooks[0].callback(event)

  const text = event.system.map((part) => part.text).join("\n")
  assert.ok(text.includes(MAPPING))
  assert.ok(!text.includes(MANDATE))
})

test("agents are subagents and the readonly agent denies writes", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  for (const agent of registered.agents) {
    assert.equal(agent.mode, "subagent")
  }

  const readonly = registered.agents.find((agent) => agent.id === "pstack:readonly")
  assert.ok(readonly)
  for (const action of ["edit", "write", "shell"]) {
    assert.ok(
      readonly.permissions.some((rule) => rule.action === action && rule.effect === "deny"),
      `readonly must deny ${action}`,
    )
  }
})
