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
import { formatCatalog, modelCatalog, vendorFamily } from "../src/models.js"
import { MANDATE, SETUP_OVERRIDE, mapping, methodology } from "../src/overlay.js"
import { portable, vendorRoot } from "../src/paths.js"
import { ensureModelSheet } from "../src/setup.js"
import { hookEnabled, normalizeSheet, recommendedSheet } from "../src/sheet.js"
import { translateText } from "../src/translate.js"
import { TODO_TOOL } from "../src/todos.js"

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
    instructionEntries: {},
    tools: [],
    permissionRequests: [],
    messages: [],
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
    tool: {
      transform: async (fn) => fn({ add: (tool) => registered.tools.push(tool) }),
    },
    permission: {
      assert: async (request) => registered.permissionRequests.push(request),
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
      context: async () => ({ data: registered.messages }),
      prompt: async (input) => registered.prompts.push(input),
      instructions: {
        entry: {
          list: async (input) => ({ data: registered.instructionEntries[input?.sessionID] ?? [] }),
          put: async (input) => {
            const list = (registered.instructionEntries[input?.sessionID] ??= [])
            const existing = list.find((entry) => entry.key === input.key)
            if (existing) existing.value = input.value
            else list.push({ key: input.key, value: input.value })
          },
          remove: async () => {},
        },
      },
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
  assert.equal(registered.hooks.length, 3)
  assert.deepEqual(
    registered.hooks.map((hook) => hook.name).sort(),
    ["compaction", "context", "experimental.model.resolve"],
  )
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

test("poteto-mode resolves sibling, playbook, reference, and worker paths absolutely", () => {
  const skill = skills.find((item) => item.id === "pstack-poteto-mode")
  const text = translateText(skill.content, "ROOT")
  assert.ok(text.includes("`ROOT/skills/<name>/SKILL.md`"), "sibling skill path is absolute")
  assert.ok(text.includes("ROOT/skills/poteto-mode/worker.md"), "worker path is absolute")
  assert.ok(text.includes("ROOT/skills/poteto-mode/playbooks/"), "playbook path is absolute")
  assert.ok(!text.includes("<path>"), "no unresolved <path> placeholder")
  assert.ok(!text.includes("this file's absolute path"), "no unresolved relative phrase")
})

test("the action layer leaves routing and workflow rules to upstream", () => {
  const text = methodology("ROOT")
  assert.ok(text.includes("controlling engineering methodology"), "states precedence")
  assert.match(text, /Playbooks section of `ROOT\/skills\/poteto-mode\/SKILL\.md` to select the route/)
  assert.doesNotMatch(text, /\bfeature\b|bug-fix|refactoring|figure-it-out/i, "does not enumerate routes")
  assert.match(text, /Read the selected playbook or routed workflow skill in full before following its steps/)
  assert.ok(text.includes("single source of truth"), "delegates authority to the playbook")
  assert.match(text, /including any conditions or exceptions/, "preserves conditional steps")
  assert.match(text, /If you cannot load it, stop and report/, "fails explicitly on a missing resource")
  assert.ok(text.includes("ROOT/skills/poteto-mode/SKILL.md"), "points at the full skill")
  assert.match(translateText(skills.find((skill) => skill.name === "poteto-mode").content, "ROOT"),
    /playbooks\/<title>\.md[\s\S]*Large, cross-cutting, or unattended work[\s\S]*figure-it-out/)
  assert.ok(text.includes("non-negotiables") && text.includes("principles") && text.includes("subagent rules"), "points at the skill sections")
  // The action layer must NOT duplicate the playbook's rules.
  assert.ok(!text.includes("Mandatory: no skip-with-reason escape"), "does not copy the delegation mandate")
  assert.ok(!text.includes("Verify on the matching surface"), "does not copy the verification rule")
  assert.ok(!text.includes('agent: "pstack:poteto-agent"'), "does not copy the subagent field")
  assert.ok(!text.includes("Cursor"), "no Cursor references")
  assert.ok(text.trim().endsWith("</pstack_poteto_mode>"), "block is closed")
})

test("fallback todos are session-scoped, durable, and preserve native permission decisions", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)
  const run = (name) => registered.commands.find((item) => item.name === name)
    .execute({ sessionID: "active", prompt: { text: "work" }, delivery: "steer" })
  await run("poteto-mode")
  await run("arena")
  const context = registered.hooks.find((item) => item.name === "context").callback
  const tool = registered.tools.find((item) => item.name === TODO_TOOL)
  for (const [sessionID, native] of [["plain", false], ["active", true], ["active", false]]) {
    const tools = { read: {}, [TODO_TOOL]: {}, ...(native ? { todowrite: {} } : {}) }
    const event = { sessionID, agent: "build", system: [], tools }
    await context(event)
    // The structured fallback is the pstack checklist tool on every host: kept for
    // pstack sessions (native todowrite is hidden), removed for plain sessions.
    assert.equal(TODO_TOOL in tools, sessionID === "active")
    assert.equal("todowrite" in tools, false)
    assert.ok("read" in tools)
    if (sessionID === "plain") assert.deepEqual(event.system, [])
    else assert.match(event.system[0].text, /<pstack_poteto_mode>/)
  }
  const call = { sessionID: "active", agent: "build", messageID: "msg", id: "call" }
  await assert.rejects(tool.execute({ todos: [] }, { ...call, sessionID: "plain" }), /only available/)
  registered.messages.push({ type: "skill", skill: "pstack-figure-it-out" })
  const todos = ["start", "A", "B", "C", "D", "E"].map((step) => ({ step, content: `Track ${step}`, status: "pending" }))
  await assert.rejects(tool.execute({ workflow: "figure-it-out", todos: todos.slice(1) }, call), /missing upstream checklist entries.*start/)
  await assert.rejects(tool.execute({ workflow: "Feature", todos }, call), /Load .*playbooks\/feature\.md in full/)
  await tool.execute({ workflow: "figure-it-out", todos }, call)
  assert.equal(registered.permissionRequests[0].action, "todowrite")
  const reloaded = mockContext()
  reloaded.registered.instructionEntries = registered.instructionEntries
  await plugin.setup(reloaded.ctx)
  const saved = await reloaded.registered.tools.find((item) => item.name === TODO_TOOL).execute({}, call)
  assert.deepEqual(JSON.parse(saved.content), { workflow: "figure-it-out", todos, verified: ["figure-it-out"] })
  ctx.permission.assert = async () => { throw new Error("denied") }
  await assert.rejects(tool.execute({ todos: [] }, call), /denied/)
  assert.deepEqual(registered.instructionEntries.active.find((item) => item.key === "pstack-workflow-todos").value.todos, todos)
})

test("workflow aliases are saved canonically only after a successful load and validation", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)
  await registered.commands.find((item) => item.name === "poteto-mode")
    .execute({ sessionID: "active", prompt: { text: "work" }, delivery: "steer" })
  const tool = registered.tools.find((item) => item.name === TODO_TOOL)
  const call = { sessionID: "active", agent: "build", messageID: "msg", id: "call" }
  const todos = Array.from({ length: 8 }, (_, i) => ({ step: String(i + 1), content: `Track ${i + 1}`, status: "pending" }))
  const route = "playbooks/feature.md"
  const root = registered.skills.find((skill) => skill.id === "pstack-poteto-mode").path.replace(/SKILL\.md$/, "")
  const path = `${root}${route}`
  const lines = readFileSync(path, "utf8").trimEnd().split(/\r?\n/).length
  const read = {
    type: "tool", name: "read", state: {
      input: { path }, status: "completed", metadata: { truncated: true },
      content: [{ type: "text", text: `Read file ${path}, lines 1-${lines}\n...` }],
    },
  }
  registered.messages.push({ type: "user" }, { type: "assistant", content: [read] })
  await assert.rejects(tool.execute({ workflow: "feature", todos }, call), /No successful full load/)
  read.state.metadata.truncated = false
  for (const workflow of ["feature", "feature.md", route, undefined]) {
    assert.deepEqual((await tool.execute({ workflow, todos }, call)).metadata, { pstackWorkflow: route })
  }
  await assert.rejects(tool.execute({ workflow: "featre", todos }, call), /Unknown workflow.*playbooks\/feature\.md/)
  await assert.rejects(tool.execute({ workflow: "bug-fix", todos }, call), /Load .*playbooks\/bug-fix\.md in full/)
  assert.deepEqual(JSON.parse((await tool.execute({}, call)).content), { workflow: route, todos, verified: [route] })
})

test("the adapter reports missing todo tooling instead of directing agents to a vanished tool", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)
  await registered.commands.find((item) => item.name === "poteto-mode")
    .execute({ sessionID: "active", prompt: { text: "work" }, delivery: "steer" })
  const event = { sessionID: "active", agent: "build", system: [], tools: { read: {} } }
  await registered.hooks.find((item) => item.name === "context").callback(event)
  assert.match(event.system[0].text, /No todo tool is available.*report that step as blocked/)
  assert.deepEqual(event.tools, { read: {} })
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

test("poteto-mode sessions receive mapping, methodology, and the model sheet", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-hook-"))
  const target = join(directory, "pstack-models.md")
  try {
    writeFileSync(target, "# budget: large (xhigh)\nfeature, refactoring: alpha/one\n")
    const { ctx, registered } = mockContext({ modelsPath: target })
    await plugin.setup(ctx)

    const command = registered.commands.find((item) => item.name === "poteto-mode")
    await command.execute({ sessionID: "root", prompt: { text: "x" }, delivery: "steer" })

    const event = { sessionID: "root", agent: "build", system: [] }
    await registered.hooks.find((hook) => hook.name === "context").callback(event)

    const text = event.system.map((part) => part.text).join("\n")
    assert.ok(text.includes("<pstack_opencode_mapping>"))
    assert.ok(text.includes("<pstack_poteto_mode>"))
    assert.ok(text.includes("<pstack_model_sheet>"))
    assert.ok(text.includes("feature, refactoring: alpha/one#xhigh"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("pstack subagents receive mapping but not methodology or routing", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  const event = { sessionID: "child", agent: "pstack:poteto-agent", system: [] }
  await registered.hooks.find((hook) => hook.name === "context").callback(event)

  const text = event.system.map((part) => part.text).join("\n")
  assert.ok(text.includes("<pstack_opencode_mapping>"))
  assert.ok(!text.includes("<pstack_poteto_mode>"))
  assert.ok(!text.includes(MANDATE))
})

test("normal sessions receive no pstack injection", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  const event = { sessionID: "plain", agent: "build", system: [] }
  await registered.hooks.find((hook) => hook.name === "context").callback(event)

  assert.equal(event.system.length, 0)
})

test("context uses the current sheet after setup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pstack-role-"))
  const target = join(directory, "pstack-models.md")
  try {
    writeFileSync(target, "# budget: large (xhigh)\nbug-fix: alpha/one\n")
    const { ctx, registered } = mockContext({ modelsPath: target })
    await plugin.setup(ctx)

    const command = registered.commands.find((item) => item.name === "poteto-mode")
    await command.execute({ sessionID: "root", prompt: { text: "x" }, delivery: "steer" })

    writeFileSync(target, "# budget: large (xhigh)\nbug-fix: beta/two#high\n")
    const event = { sessionID: "root", agent: "build", system: [] }
    await registered.hooks.find((hook) => hook.name === "context").callback(event)

    const text = event.system.map((part) => part.text).join("\n")
    assert.ok(text.includes("bug-fix: beta/two#high"))
    assert.ok(!text.includes("bug-fix: alpha/one#xhigh"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("compaction records the active mode for a poteto-mode session", async () => {
  const { ctx, registered } = mockContext()
  await plugin.setup(ctx)

  const command = registered.commands.find((item) => item.name === "poteto-mode")
  await command.execute({ sessionID: "root", prompt: { text: "x" }, delivery: "steer" })

  const event = { sessionID: "root", messages: [] }
  await registered.hooks.find((hook) => hook.name === "compaction").callback(event)

  assert.equal(event.messages.length, 1)
  assert.match(event.messages[0].text, /Poteto Mode/)
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

test("vendorFamily collapses tier suffixes to one vendor", () => {
  const provider = "ollama-cloud"
  assert.equal(vendorFamily({ family: "deepseek-flash", providerID: provider }), "deepseek")
  assert.equal(vendorFamily({ family: "deepseek-flash-free", providerID: provider }), "deepseek")
  assert.equal(vendorFamily({ family: "deepseek-pro", providerID: provider }), "deepseek")
  assert.equal(vendorFamily({ family: "glm-flash", providerID: provider }), "glm")
  assert.equal(vendorFamily({ family: "glm", providerID: provider }), "glm")
  assert.equal(vendorFamily({ family: "minimax-m-flash", providerID: provider }), "minimax")
  assert.equal(vendorFamily({ family: "kimi-code", providerID: provider }), "kimi")
  assert.equal(vendorFamily({ family: "nemotron-lightning-free", providerID: provider }), "nemotron")
  assert.equal(vendorFamily({ family: "gpt-oss", providerID: provider }), "gpt-oss")
  assert.equal(vendorFamily({ family: "mistral-large", providerID: provider }), "mistral")
  // No family field falls back to the provider prefix.
  assert.equal(vendorFamily({ providerID: "opencode" }), "opencode")
})
