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
import { formatCatalog, modelCatalog } from "../src/models.js"
import { MANDATE, SETUP_OVERRIDE, mapping } from "../src/overlay.js"
import { portable, vendorRoot } from "../src/paths.js"
import { ensureModelSheet } from "../src/setup.js"
import { hookEnabled, normalizeSheet, recommendedSheet } from "../src/sheet.js"
import { translateText } from "../src/translate.js"

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
  {
    ref: "alpha/one",
    name: "One",
    providerID: "alpha",
    id: "one",
    family: "alpha",
    status: "active",
    context: 1000000,
    cost: { input: 1, output: 2 },
    variants: ["low", "medium", "high", "xhigh"],
  },
  {
    ref: "beta/two",
    name: "Two",
    providerID: "beta",
    id: "two",
    family: "beta",
    status: "beta",
    context: 200000,
    cost: { input: 0, output: 0 },
    variants: ["high"],
  },
  {
    ref: "gamma/three",
    name: "Three",
    providerID: "gamma",
    id: "three",
    family: "gamma",
    status: "active",
    context: 32000,
    cost: { input: 0, output: 0 },
    variants: [],
  },
]

const MAPPING = mapping("ROOT")

function mockContext(options = {}) {
  const registered = {
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    prompts: [],
    session: { parentID: undefined },
    sessions: {},
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
            const existing = registered.agents.find((agent) => agent.id === id)
            if (existing) {
              apply(existing)
              return
            }
            const entry = { id, permissions: [] }
            registered.agents.push(entry)
            apply(entry)
          },
        }),
    },
    session: {
      hook: async (name, callback) => registered.hooks.push({ name, callback }),
      get: async (input) => ({ data: registered.sessions[input?.sessionID] ?? registered.session }),
      prompt: async (input) => registered.prompts.push(input),
    },
  }

  return { ctx, registered }
}

test("registers every skill, command, and agent", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  assert.equal(registered.skills.length, 60)
  assert.equal(registered.commands.length, 60)
  assert.equal(registered.agents.length, 3)
  assert.equal(registered.hooks.length, 2)
  assert.deepEqual(registered.hooks.map((hook) => hook.name).sort(), ["context", "experimental.model.resolve"])
})

test("registered skills use the translated cache and contain no Cursor-only text", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  const forbidden = [
    ".cursor",
    "claude-",
    "gemini-",
    "subagent_type",
    "/loop",
    'environment: "cloud"',
    "create-skill",
    "Cursor cloud agent",
    "Bugbot",
  ]
  for (const skill of registered.skills) {
    assert.ok(skill.path.includes("pstack-translated"), `${skill.id} path is not translated`)
    for (const needle of forbidden) {
      assert.ok(!skill.content.includes(needle), `${skill.id} still has ${needle}`)
    }
  }

  const agent = registered.agents.find((item) => item.id === "pstack:poteto-agent")
  for (const needle of forbidden) assert.ok(!agent.system.includes(needle), `pstack:poteto-agent still has ${needle}`)
})

test("how spawns one read-only subagent, not two", () => {
  const how = skills.find((skill) => skill.id === "pstack-how")
  const text = translateText(how.content, "ROOT")
  assert.ok(text.includes('Spawn one `subagent` with `agent: "pstack:readonly"`'))
  assert.ok(!text.includes('agent: "general"'))
})

test("transcript paths become OpenCode session exports", () => {
  for (const id of [
    "pstack-recall",
    "pstack-show-me-your-work",
    "pstack-eval",
    "pstack-session-pickup",
    "pstack-automate-me",
  ]) {
    const skill = skills.find((item) => item.id === id)
    if (!skill) continue
    const text = translateText(skill.content, "ROOT")
    assert.ok(!/agent-transcripts|\/projects\/<slug>/.test(text), `${id} still has a Cursor transcript path`)
  }
})

test("agent fallback uses the translated root path", () => {
  const agent = agents.find((item) => item.id === "pstack:poteto-agent")
  const text = translateText(agent.system, "ROOT")
  assert.ok(text.includes("ROOT/"))
  assert.ok(!text.includes("the pstack root"))
})

test("explicit variants survive the budget", () => {
  const text = normalizeSheet("# budget: large (xhigh)\nbug-fix: alpha/one#low\n", CATALOG, "alpha/one")
  assert.match(text, /bug-fix: alpha\/one#low/)
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

test("setup writes real model refs, budget variants, and panel diversity", async () => {
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
    assert.ok(prompt.text.includes("current"))

    assert.ok(existsSync(target))
    const sheet = readFileSync(target, "utf8")
    assert.match(sheet, /feature, refactoring: alpha\/one#xhigh/)
    assert.match(sheet, /judgment and prose: beta\/two#high/)
    assert.match(sheet, /arena runners: alpha\/one#high, beta\/two#high, gamma\/three/)
    assert.match(sheet, /arena cross-judge pool: beta\/two#high, gamma\/three/)
    assert.match(sheet, /swarm workers: alpha\/one#high/)
    assert.ok(!/^[a-z][a-z, -]*: inherit-parent$/m.test(sheet))

    const poteto = registered.agents.find((agent) => agent.id === "pstack:poteto-agent")
    assert.deepEqual(poteto.model, { providerID: "alpha", id: "one", variant: "xhigh" })
    const sicko = registered.agents.find((agent) => agent.id === "pstack:comment-sicko")
    assert.deepEqual(sicko.model, { providerID: "beta", id: "two", variant: "high" })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("normalization keeps valid choices, fills missing roles, and rejects Cursor slugs", () => {
  const sheet = `# budget: large (xhigh)
feature, refactoring: alpha/one
bug-fix: claude-opus-5-5-xhigh-fast
judgment and prose: beta/two#high
`
  const text = normalizeSheet(sheet, CATALOG, "alpha/one")
  assert.match(text, /feature, refactoring: alpha\/one#xhigh/)
  assert.match(text, /bug-fix: alpha\/one#xhigh/)
  assert.match(text, /judgment and prose: beta\/two#high/)
  assert.match(text, /perf-issue: alpha\/one#xhigh/)
  assert.ok(!text.includes("claude"))
})

test("a generated sheet replaces inherit-parent with real refs", () => {
  const sheet = `# pstack model configuration for OpenCode. Generated from the models configured on this machine.
# budget: large (xhigh)
feature, refactoring: inherit-parent
bug-fix: inherit-parent
`
  const text = normalizeSheet(sheet, CATALOG, "alpha/one")
  assert.match(text, /feature, refactoring: alpha\/one#xhigh/)
  assert.match(text, /bug-fix: alpha\/one#xhigh/)
})

test("recommended sheet uses real refs and never writes inherit-parent", () => {
  const sheet = recommendedSheet(CATALOG, "alpha/one#high")
  assert.ok(sheet.includes("alpha/one"))
  assert.ok(!/^[a-z][a-z, -]*: inherit-parent$/m.test(sheet))
})

test("session hook off is honored", () => {
  assert.equal(hookEnabled("# session hook: off\n"), false)
  assert.equal(hookEnabled("# defaults: 3\n"), true)
})

test("ensureModelSheet updates an existing sheet in place", () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-sheet-"))
  const target = join(directory, "pstack-models.md")
  try {
    writeFileSync(target, "# budget: large (xhigh)\nfeature, refactoring: claude-opus-5-5-xhigh-fast\n")
    const result = ensureModelSheet(target, CATALOG, "alpha/one")
    assert.equal(result.created, false)
    assert.equal(result.updated, true)
    const text = readFileSync(target, "utf8")
    assert.match(text, /feature, refactoring: alpha\/one#xhigh/)
    assert.ok(!text.includes("claude"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("root sessions receive mapping, routing, and the normalized model sheet", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-hook-"))
  const target = join(directory, "pstack-models.md")
  try {
    writeFileSync(target, "# budget: large (xhigh)\nfeature, refactoring: alpha/one\n")
    const { ctx, registered } = mockContext({ modelsPath: target })
    await plugin.setup(ctx)

    const event = { sessionID: "root", system: [] }
    await registered.hooks.find((hook) => hook.name === "context").callback(event)

    const text = event.system.map((part) => part.text).join("\n")
    assert.ok(text.includes("<pstack_opencode_mapping>"))
    assert.ok(text.includes("pstack-translated"))
    assert.ok(text.includes(MANDATE))
    assert.ok(text.includes("<pstack_model_sheet>"))
    assert.ok(text.includes("feature, refactoring: alpha/one#xhigh"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("child sessions receive mapping but not routing", async () => {
  const { ctx, registered } = mockContext()
  registered.session = { parentID: "root" }
  await plugin.setup(ctx)

  const event = { sessionID: "child", system: [] }
  await registered.hooks.find((hook) => hook.name === "context").callback(event)

  const text = event.system.map((part) => part.text).join("\n")
  assert.ok(text.includes("<pstack_opencode_mapping>"))
  assert.ok(!text.includes(MANDATE))
})

test("context uses the current sheet after setup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-role-"))
  const target = join(directory, "pstack-models.md")
  try {
    writeFileSync(target, "# budget: large (xhigh)\nbug-fix: alpha/one\n")
    const { ctx, registered } = mockContext({ modelsPath: target })
    await plugin.setup(ctx)

    writeFileSync(target, "# budget: large (xhigh)\nbug-fix: beta/two#high\n")
    const event = { sessionID: "root", system: [] }
    await registered.hooks[0].callback(event)

    const text = event.system.map((part) => part.text).join("\n")
    assert.ok(text.includes("bug-fix: beta/two#high"))
    assert.ok(!text.includes("bug-fix: alpha/one#xhigh"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("resolve hook switches within a provider and leaves explicit or cross-provider models", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-resolve-"))
  const target = join(directory, "pstack-models.md")
  try {
    writeFileSync(target, "# budget: large (xhigh)\nbug-fix: alpha/one#low\n")
    const { ctx, registered } = mockContext({ modelsPath: target })
    registered.session = { parentID: "root" }
    await plugin.setup(ctx)
    const resolve = registered.hooks.find((hook) => hook.name === "experimental.model.resolve")

    const same = {
      sessionID: "child",
      agent: "pstack:poteto-agent",
      kind: "primary",
      model: { providerID: "alpha", id: "one", variant: "xhigh" },
      system: [],
    }
    await resolve.callback(same)
    assert.equal(same.model.variant, "low")

    writeFileSync(target, "# budget: large (xhigh)\nbug-fix: beta/two#high\n")
    const cross = {
      sessionID: "child",
      agent: "pstack:poteto-agent",
      kind: "primary",
      model: { providerID: "alpha", id: "one", variant: "high" },
      system: [],
    }
    await resolve.callback(cross)
    assert.deepEqual(cross.model, { providerID: "alpha", id: "one", variant: "high" })

    writeFileSync(target, "# budget: large (xhigh)\nbug-fix: alpha/one#low\n")
    registered.sessions = { parent: { model: { providerID: "gamma", id: "three" } } }
    registered.session = { parentID: "parent", model: { providerID: "beta", id: "two" } }
    const explicit = {
      sessionID: "child",
      agent: "pstack:poteto-agent",
      kind: "primary",
      model: { providerID: "beta", id: "two", variant: "high" },
      system: [],
    }
    await resolve.callback(explicit)
    assert.deepEqual(explicit.model, { providerID: "beta", id: "two", variant: "high" })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("agents are subagents and read-only agents deny writes and subagents", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  for (const agent of registered.agents) assert.equal(agent.mode, "subagent")

  for (const id of ["pstack:readonly", "pstack:comment-sicko"]) {
    const agent = registered.agents.find((item) => item.id === id)
    assert.ok(agent, `${id} must exist`)
    assert.ok(agent.permissions.some((rule) => rule.action === "*" && rule.effect === "deny"))
    for (const action of ["read", "grep", "glob", "webfetch", "external_directory"]) {
      assert.ok(agent.permissions.some((rule) => rule.action === action && rule.effect === "allow"))
    }
    for (const action of ["subagent", "edit", "shell", "write", "patch"]) {
      assert.ok(!agent.permissions.some((rule) => rule.action === action && rule.effect === "allow"))
    }
  }
})

test("mapping covers subagent fields and Cursor paths without a fake background field", () => {
  for (const needle of [
    "There is no `background` field",
    "pstack:readonly",
    "pstack:comment-sicko",
    "sessionID",
    ".opencode/agents/",
    ".opencode/commands/",
    "opencode session export",
    "/loop",
  ]) {
    assert.ok(MAPPING.includes(needle), `mapping is missing ${needle}`)
  }
  assert.ok(!MAPPING.includes("`background: true`"))
})

test("catalog reports cost, context, status, and the current model", async () => {
  const { ctx } = mockContext()
  const catalog = await modelCatalog(ctx)
  const text = formatCatalog(catalog, "alpha/one")
  assert.ok(text.includes("context 1,000,000"))
  assert.ok(text.includes("$1/$2 per Mtok"))
  assert.ok(text.includes("[current]"))
  assert.ok(text.includes("[beta]"))
  assert.ok(text.includes("family alpha"))
  assert.ok(text.includes("family beta"))
})
