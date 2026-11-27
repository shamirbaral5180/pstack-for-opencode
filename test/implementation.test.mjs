import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import test from "node:test"
import { registerCompliance } from "../src/compliance.js"
import skills from "../src/data/skills.js"
import { mutationTargets, workerChanges } from "../src/implementation.js"
import { registerTodos, TODO_TOOL } from "../src/todos.js"
import { ensureTranslated } from "../src/translate.js"
import { workflowSources } from "../src/workflow.js"

const sources = workflowSources(ensureTranslated().root, skills)
const directory = resolve("handoff-fixture")
const feature = sources.get("playbooks/feature.md")
const file = "src/feature.js"
const tests = "test/feature.test.js"
const leaf = "principle-model-the-domain"

const user = (created) => ({ type: "user", time: { created } })
const load = (name, created) => ({ type: "skill", skill: `pstack-${name}`, time: { created } })
const tool = (name, input, at, { status = "completed", metadata, files } = {}) => ({
  type: "assistant", time: { created: at - 1, completed: at + 2 },
  content: [{ type: "tool", id: `call-${name}-${at}`, name, time: { ran: at, completed: at + 1 }, state: { status, input, metadata } }],
  ...(files && { snapshot: { start: "before", end: "after", files } }),
})
const readFeature = () => {
  const msg = tool("read", { path: feature.path }, 4, { metadata: { truncated: false } })
  msg.content[0].state.content = [{ type: "text", text: `Read file ${feature.path}, lines 1-${feature.lineCount}\n...` }]
  return msg
}
const sheet = (status, paths = [file]) => ({
  workflow: feature.name,
  todos: feature.steps.map(({ id, handoff }) => ({
    step: id, content: `Track step ${id}`, status: handoff ? status : "pending", ...(handoff && { paths }),
  })),
})

const spawn = (id = "worker", prompt = `Implement \`${file}\`.`, at = 20, status = "completed") =>
  tool("subagent", { agent: "general", prompt }, at, { status, metadata: { sessionID: id } })
const write = (path, at, files = [path]) => tool("write", { path: join(directory, path) }, at, { files })
const report = (text, at) => ({ type: "assistant", time: { created: at }, content: [{ type: "text", text }] })

async function fixture() {
  const messages = [user(1), readFeature(), load("architect", 7), load(leaf, 9)]
  const children = new Map()
  const state = []
  const parent = { id: "main", projectID: "project", location: { directory } }
  let before, todo
  const ctx = {
    session: {
      context: async ({ sessionID }) => ({ data: sessionID === parent.id ? messages : children.get(sessionID)?.messages }),
      get: async ({ sessionID }) => ({ data: sessionID === parent.id ? parent : children.get(sessionID)?.meta }),
      instructions: { entry: {
        list: async () => state,
        put: async ({ key, value }) => state.splice(0, 1, { key, value }),
      } },
    },
    tool: {
      hook: async (name, fn) => { assert.equal(name, "execute.before"); before = fn },
      transform: async (fn) => fn({ add: (def) => { todo = def } }),
    },
    permission: { assert: async () => {} },
  }
  const notice = await registerCompliance(ctx, async (id) => id === parent.id, sources)
  await registerTodos(ctx, async (id) => id === parent.id ? "pstack-poteto-mode" : undefined, sources)
  return {
    messages, parent, state,
    worker(id, history, meta = {}) {
      children.set(id, { meta: { ...parent, id, parentID: parent.id, ...meta }, messages: history })
    },
    before: (name, input, extras) => before({ tool: name, input, sessionID: parent.id, agent: "build", ...extras }),
    notice: () => notice(parent.id),
    async save(input, at) {
      await todo.execute(input, { sessionID: parent.id, agent: "build", messageID: "msg", id: "call" })
      messages.push(tool(TODO_TOOL, input, at))
    },
  }
}

test("implementation gates come from unconditional playbook clauses, not a route list", () => {
  const handoff = (name) => sources.get(`playbooks/${name}.md`).steps.filter((step) => step.handoff)
  assert.deepEqual(handoff("feature").map(({ id, handoff }) => [id, handoff]), [["4", [`pstack-${leaf}`]]])
  for (const name of ["bug-fix", "perf-issue", "refactoring", "hillclimb"]) assert.equal(handoff(name).length, 1)
  for (const name of ["investigation", "prototype", "multi-phase-plan"]) assert.equal(handoff(name).length, 0)
})

test("the fallback refuses to open a scoped handoff on a claimed, not observed, leaf read", async () => {
  const f = await fixture()
  f.messages.pop()
  f.messages.push({ type: "assistant", time: { created: 9 }, content: [{ type: "text", text: `I applied ${leaf}.` }] })
  await assert.rejects(f.save(sheet("in_progress"), 13), /read .*principle-model-the-domain.* in full/)
  assert.deepEqual(f.state, [])
  f.messages.push(load(leaf, 10))
  await f.save(sheet("in_progress"), 13)
  assert.deepEqual(f.state[0].value.todos, sheet("in_progress").todos)
})

test("writes to open implementation paths and closing the step both need real child changes", async () => {
  const f = await fixture()
  await f.save(sheet("pending"), 10)
  await f.before("write", { path: join(directory, file) }) // Preparation before assignment.
  await f.save(sheet("in_progress", [file, tests]), 14)
  const attempt = (path) => f.before("edit", { path: join(directory, path) })
  await assert.rejects(attempt(file), /no attributable worker change for src\/feature.js/)
  await f.before("write", { path: join(directory, "README.md") })
  await f.before("shell", { command: "git status --short" })
  await f.before("shell", { command: "node verify.mjs" })
  await f.before("write", { path: file }, { sessionID: "plain" })
  await f.before("write", { path: file }, { agent: "pstack:poteto-agent" })

  const close = () => f.save(sheet("completed", [file, tests]), 45)
  await assert.rejects(close(), /no attributable worker change/)
  f.messages.push(spawn("worker", `Implement ${file} and ${tests}.`))
  f.worker("worker", [tool("shell", { command: "git diff" }, 24, { files: [file, tests] })])
  await assert.rejects(close(), /no attributable worker change/)
  f.worker("worker", [load(leaf, 23), write(file, 24), write("notes.md", 26, [tests, "notes.md"])])
  await attempt(file)
  await assert.rejects(attempt(tests), /no attributable worker change for test\/feature.test.js/)
  await assert.rejects(close(), /no attributable worker change for test\/feature.test.js/)
  assert.equal(f.state[0].value.todos.find((todo) => todo.step === "4").status, "in_progress")
  f.worker("worker", [load(leaf, 23), write(file, 24), write(tests, 28)])
  await close()
  await attempt(tests)
})

test("an unrelated, failed, unassigned, or stale child can't satisfy the handoff", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  const close = () => f.save(sheet("completed"), 50)
  f.messages.push(spawn("review", "Review only.", 18), spawn("failed", `Implement ${file}.`, 19, "error"),
    spawn("other", `Implement ${file}.`, 20), spawn("worker", `Implement ${file}.`, 21))
  f.worker("review", [write(file, 26)])
  f.worker("failed", [write(file, 28)])
  f.worker("other", [write(file, 30)], { parentID: "another-session" })
  f.worker("worker", [write(file, 12), write(file, 25, []), tool("edit", { path: file }, 26, { status: "error", files: [file] })])
  await assert.rejects(close(), /no attributable worker change/)
  f.worker("worker", [load(leaf, 29), write(file, 30)])
  await close()
})

test("a follow-up preserves the scoped write gate and accepts earlier evidence from the same workflow", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  f.messages.push(spawn(), user(35), load("figure-it-out", 38))
  await assert.rejects(f.before("edit", { path: file }), /no attributable worker change/)
  await f.before("write", { path: "docs/note.md" })

  f.worker("worker", [load(leaf, 24), write(file, 25)])
  await f.before("edit", { path: file })
  await f.save(sheet("completed"), 40)
  assert.equal(f.state[0].value.startedAt, 1)
  assert.equal(f.state[0].value.workflow, feature.name)
})

test("a linked worktree worker counts only with observed changes in its confirmed checkout", async () => {
  const f = await fixture()
  const checkout = resolve("separate-worktree")
  const input = { directory: checkout, agent: "general", prompt: `Implement ${file}.` }
  await assert.rejects(f.before("pstack_worktree_worker", { ...input, sessionID: "ignored" }), /No successful non-empty checklist/)
  await f.save(sheet("in_progress"), 14)
  await f.before("pstack_worktree_worker", input)
  f.messages.push(tool("pstack_worktree_worker", input, 20, { metadata: { sessionID: "worker", directory: checkout } }))
  f.worker("worker", [load(leaf, 24), write(file, 25)])
  await assert.rejects(f.save(sheet("completed"), 30), /no attributable worker change/)
  f.worker("worker", [load(leaf, 24), tool("write", { path: file }, 25, { files: [file] })], { location: { directory: checkout } })
  await f.save(sheet("completed"), 40)
})

test("a retrospective declaration can't turn an earlier child change into assigned implementation", async () => {
  const f = await fixture()
  f.messages.push(spawn("worker", `Implement ${file}.`, 13))
  f.worker("worker", [write(file, 15)])
  await f.save(sheet("in_progress"), 18)
  await assert.rejects(f.save(sheet("completed"), 30), /no attributable worker change/)
})

test("a legacy claimed completion without a scope does not authorize parent product writes", async () => {
  const f = await fixture()
  const stale = sheet("completed", [])
  f.messages.push(tool(TODO_TOOL, stale, 14))
  await assert.rejects(f.before("write", { path: file }), /requires a scoped implementation handoff/)
})

test("shell effects are reported as observations without blocking the shell or rewarding a shell-only bypass", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  const command = "node scaffold.mjs"
  await f.before("shell", { command })
  f.messages.push(tool("shell", { command }, 20, { files: ["generated.log", file] }))
  const notice = await f.notice()
  assert.match(notice, /src\/feature.js.*does not identify the writer/)
  assert.doesNotMatch(notice, /generated.log/)
  await f.before("shell", { command: "node verify.mjs" })
  await assert.rejects(f.save(sheet("completed"), 30), /no attributable worker change/)
})

test("an ambiguous route does not suppress observed file changes or turn them into a violation", async () => {
  const f = await fixture()
  f.messages.push(load("figure-it-out", 10),
    tool("shell", { command: "node scaffold.mjs" }, 20, { files: [file], status: "error" }))
  assert.match(await f.notice(), /Workspace changes.*src\/feature.js/)
  await f.before("shell", { command: "node verify.mjs" })
  await f.before("edit", { path: file })
})

test("a reset handoff does not borrow the previous worker's edits", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  f.messages.push(spawn())
  f.worker("worker", [load(leaf, 24), write(file, 25)])
  await f.save(sheet("completed"), 30)
  f.messages.push(user(34))
  await f.save(sheet("pending"), 35)
  await f.save(sheet("in_progress"), 40)
  await assert.rejects(f.save(sheet("completed"), 50), /no attributable worker change/)
})

test("native checklist remains usable and detected delivery still needs a substantive child result", async () => {
  const f = await fixture()
  f.messages.push(tool("todowrite", { todos: [{ content: "Implement", status: "in_progress" }] }, 14),
    spawn("worker", `Implement ${file}.`))
  const deliver = () => f.before("shell", { command: "git push origin work" })
  await f.before("write", { path: "docs/note.md" })
  await assert.rejects(deliver(), /no attributable worker change/)
  f.worker("worker", [load(leaf, 24), write(file, 25)])
  await deliver()
})

test("native edit diff is stronger than a shared snapshot; patchText includes renamed paths", () => {
  const patchText = `*** Begin Patch\r\n*** Update File: ${file}\r\n*** Move to: src/new.js\r\n*** End Patch`
  assert.deepEqual(mutationTargets("patch", { patchText }, directory), [file, "src/new.js"])
  assert.deepEqual(mutationTargets("write", { path: join(directory, "..", "outside.js") }, directory), [])
  assert.deepEqual(workerChanges([
    tool("edit", { path: file }, 23, { metadata: { files: [{ file, additions: 1, deletions: 1 }] } }),
    tool("edit", { path: tests }, 24, { metadata: { files: [] }, files: [tests] }),
    tool("shell", { command: "git diff" }, 25, { files: [file, tests] }),
  ], directory), [{ path: file, at: 23 }])
})

test("worker principle verification: the required leaf must be loaded by the worker, not just the main agent", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  f.messages.push(spawn("worker", `Implement ${file}.`))
  f.worker("worker", [write(file, 25)]) // worker implemented but never read the leaf
  await assert.rejects(f.save(sheet("completed"), 30), /worker did not load the required principle-model-the-domain/)
  assert.equal(f.state[0].value.todos.find((todo) => todo.step === "4").status, "in_progress")
  f.worker("worker", [load(leaf, 24), write(file, 25)])
  await f.save(sheet("completed"), 40)
})

test("worker principle verification: a cited principle must be loaded in the worker session", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  f.messages.push(spawn("worker", `Implement ${file}.`))
  const cited = report("I applied **prove-it-works** and verified the output.", 26)
  f.worker("worker", [load(leaf, 24), write(file, 25), cited])
  await assert.rejects(f.save(sheet("completed"), 30), /cited principle-prove-it-works without loading/)
  f.worker("worker", [load(leaf, 24), load("principle-prove-it-works", 26), write(file, 25), cited])
  await f.save(sheet("completed"), 40)
})

test("worker principle verification ignores natural-language prose and non-implementer children", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  f.messages.push(spawn("worker", `Implement ${file}.`), spawn("review", "Review only.", 18))
  // Natural-language claims are not principle citations, so they trigger nothing.
  f.worker("worker", [load(leaf, 24), write(file, 25),
    report("I proved it works end to end and the domain is modeled cleanly.", 26)])
  // A reviewer with no file changes is never required to load a principle.
  f.worker("review", [report("I applied **prove-it-works** while reading.", 30)])
  await f.save(sheet("completed"), 40)
})

test("worker principle verification: an explicit brief requirement is enforced even when the playbook names none", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  f.messages.push(spawn("worker", `Implement ${file} and follow the **prove-it-works** principle.`))
  f.worker("worker", [load(leaf, 24), write(file, 25)])
  await assert.rejects(f.save(sheet("completed"), 30), /worker did not load the required principle-prove-it-works/)
  f.worker("worker", [load(leaf, 24), load("principle-prove-it-works", 23), write(file, 25)])
  await f.save(sheet("completed"), 40)
})

test("a read completed after the first scoped edit does not validate it, even across a follow-up", async () => {
  const f = await fixture()
  await f.save(sheet("in_progress"), 14)
  f.messages.push(spawn())
  const source = sources.get(leaf)
  const read = tool("read", { path: source.path }, 22, { metadata: { truncated: false } })
  read.content[0].state.content = [{ type: "text", text: `Read file ${source.path}, lines 1-${source.lineCount}\n...` }]
  read.content[0].time.completed = 26
  f.worker("worker", [read, write(file, 25), write(file, 28)])
  f.messages.push(user(34))
  await assert.rejects(f.save(sheet("completed"), 40), /loaded principle-model-the-domain too late/)
  await assert.rejects(f.before("edit", { path: file }), /loaded principle-model-the-domain too late/)
  assert.equal(f.state[0].value.todos.find((todo) => todo.step === "4").status, "in_progress")
})
