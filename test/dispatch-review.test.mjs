import assert from "node:assert/strict"
import test from "node:test"
import { dirname, resolve } from "node:path"
import { arenaAssignment, arenaPhase, assignedRole, registerDispatch, roleAssignment, skillId } from "../src/dispatch.js"
import skills from "../src/data/skills.js"
import { deliveryIssue, reviewIssue } from "../src/review.js"
import { ensureTranslated } from "../src/translate.js"
import { loadedSources, workflowSources } from "../src/workflow.js"

const sources = workflowSources(ensureTranslated().root, skills)
const source = sources.get("playbooks/feature.md")
const todos = [{ step: "4", status: "in_progress", paths: ["src/feature.js"] }]
const sheet = "feature, refactoring: code/main#high\njudgment and prose: review/judge#low\n"
const catalog = [
  { providerID: "code", id: "main", variants: ["high", "low"] },
  { providerID: "review", id: "judge", variants: ["low"] },
]
const worker = { agent: "pstack:poteto-agent" }
const reviewer = { agent: "pstack:comment-sicko" }
const cfg = (input, selected = sheet) => ({ sessionID: "main", input, source, todos, sheet: selected })

test("only unambiguous registry names owned by pstack are resolved; native IDs win", () => {
  const owned = new Set(["registered-id"])
  const record = { id: "registered-id", name: "upstream-name" }
  assert.equal(skillId("upstream-name", [record], owned), record.id)
  assert.equal(skillId("upstream-name", [record, { id: "upstream-name", name: "other" }], owned), "upstream-name")
  assert.equal(skillId("upstream-name", [record, { id: "other", name: "upstream-name" }], owned), "upstream-name")
  assert.equal(skillId("unrelated", [record], owned), "unrelated")
})

test("the native tool's original alias counts only when its receipt resolves to the pstack skill", () => {
  const skill = sources.get("architect")
  const state = { status: "completed", input: { id: skill.name },
    metadata: { name: skill.name, directory: dirname(skill.path), truncated: false },
    content: [{ type: "text", text: "<skill_content>original skill</skill_content>" }] }
  const history = [{ type: "assistant", content: [{ type: "tool", name: "skill", state }] }]
  assert.ok(loadedSources(history, sources).has(skill.name))
  state.metadata.directory = resolve("project-local-skill")
  assert.ok(!loadedSources(history, sources).has(skill.name))
})

test("full reads of registered sources count through equivalent dot-segment paths without relaxing chronology", () => {
  const leaf = sources.get("principle-foundational-thinking")
  const path = leaf.path.replace("/principle-foundational-thinking/", "/poteto-mode/../principle-foundational-thinking/")
  const state = { status: "completed", input: { path }, metadata: { truncated: false }, content: [
    { type: "text", text: `Read file ${path}, lines 1-${leaf.lineCount}\n...` },
  ] }
  const history = [{ type: "assistant", content: [{ type: "tool", name: "read", state, time: { completed: 10 } }] }]
  assert.ok(loadedSources(history, sources, 11).has(leaf.name))
  assert.ok(!loadedSources(history, sources, 10).has(leaf.name))
  state.input.offset = 2
  assert.ok(!loadedSources(history, sources).has(leaf.name))
  state.input.offset = 1
  state.content[0].text = `Read file ${dirname(path)}/other.md, lines 1-${leaf.lineCount}\n...`
  assert.ok(!loadedSources(history, sources).has(leaf.name))
})

test("scoped roles come from selected handoff clauses, not from agent-wide code defaults", async () => {
  const ctx = { model: { list: async () => catalog }, session: { context: async () => [] } }
  assert.equal(assignedRole(source, [], worker.agent), undefined)
  assert.equal(assignedRole(sources.get("hillclimb"), todos, worker.agent), undefined)
  assert.equal((await roleAssignment(ctx, cfg(worker))).model, "code/main#high")
  assert.equal((await roleAssignment(ctx, cfg(reviewer))).model, "review/judge#low")
  assert.equal((await roleAssignment(ctx, cfg({ ...worker, model: "code/main#low" }))).model, "code/main#low")
  await assert.rejects(roleAssignment(ctx, cfg({ ...worker, model: "review/judge#low" })), /selected feature/)
  ctx.session.context = async () => [{ type: "user", text: "Use `review/judge#low` for this one." }]
  assert.equal((await roleAssignment(ctx, cfg({ ...worker, model: "review/judge#low" }))).model, "review/judge#low")
  for (const alias of ["auto", "inherit-parent"]) {
    assert.deepEqual(await roleAssignment(ctx, cfg({ ...worker, model: alias }, `feature, refactoring: ${alias}`)), worker)
  }
  await assert.rejects(roleAssignment(ctx, cfg(reviewer, "judgment and prose: unavailable/judge")), /No worker was started/)
})

test("a loaded Arena fan-out uses the panel instead of the enclosing code role", async () => {
  const arena = sources.get("arena")
  const phases = arena.steps.map(({ id }) => ({ step: `arena:${id}`, status: id === "B" ? "in_progress" : "pending" }))
  const saved = { workflow: source.name, todos: [...todos, ...phases], startedAt: 1 }
  const messages = [{ type: "skill", skill: arena.id, time: { created: 2 } }]
  let dispatch
  const ctx = {
    tool: { hook: async (_name, fn) => { dispatch = fn } },
    model: { list: async () => catalog },
    session: { instructions: { entry: { list: async () => [{ key: "pstack-workflow-todos", value: saved }] } }, context: async () => messages },
  }
  const panel = `${sheet}arena runners: code/main#high, review/judge#low, auto\n`
  await registerDispatch(ctx, { active: async () => "pstack-poteto-mode", sources, skills, sheet: () => panel })
  assert.equal(arenaPhase(source, saved.todos, arena), "in_progress")
  const candidate = { tool: "pstack_worktree_worker", sessionID: "main", agent: "build", input: { ...worker, model: "review/judge#low" } }
  await dispatch(candidate)
  assert.equal(candidate.input.model, "review/judge#low")
  for (const alias of [undefined, "inherit-parent", "auto"]) {
    assert.deepEqual(await arenaAssignment(ctx, { ...worker, model: alias }, panel), worker)
  }
  await assert.rejects(arenaAssignment(ctx, worker, `${sheet}arena runners: code/main#high`), /explicit model/)
  assert.equal((await arenaAssignment(ctx, { ...worker, model: "code/main#low" }, "arena runners: code/main#retired")).model, "code/main#low")
  messages.length = 0
  await assert.rejects(dispatch(candidate), /selected feature/)
  messages.push({ type: "skill", skill: arena.id, time: { created: 2 } })
  phases.find(({ step }) => step === "arena:B").status = "completed"
  await assert.rejects(dispatch(candidate), /selected feature/)
})

test("blocked delivery and a local report cannot stand in for a successful ready PR", () => {
  const entries = source.steps.map(({ id }) => ({ step: id, status: "completed" }))
  const blocked = entries.map((item) => item.step === "8" ? { ...item, status: "blocked" } : item)
  const ready = [{ type: "assistant", content: [{ type: "tool", name: "shell", state: {
    status: "completed", input: { command: "gh pr create --title 'Ready'" }, metadata: { exit: 0 },
    content: [{ type: "text", text: "https://github.example/team/repo/pull/42" }],
  } }] }]
  assert.equal(deliveryIssue(source, blocked, entries, []), undefined)
  assert.match(deliveryIssue(source, entries, blocked, ready), /Reopen it/)
  assert.match(deliveryIssue(source, entries, entries, []), /no successful ready PR/)
  const pending = entries.map((item) => item.step === "5" ? { ...item, status: "pending" } : item)
  assert.match(deliveryIssue(source, pending, entries, ready), /finish upstream steps 5/)
  assert.equal(deliveryIssue(source, entries, entries, ready), undefined)
  ready[0].content[0].state.input.command += " --draft"
  assert.match(deliveryIssue(source, entries, entries, ready), /no successful ready PR/)
})

test("delivery distinguishes a loaded review, a launch, and an observed independent review", async () => {
  const directory = resolve("review-fixture")
  const assistant = (time, content, finish = "tool-calls") => ({ type: "assistant", time: { created: time, completed: time }, finish, content })
  const tool = (name, input, time, metadata) => ({
    type: "tool", name, time: { ran: time, completed: time },
    state: { status: "completed", input, metadata },
  })
  const messages = []
  let review = []
  const ctx = { session: {
    get: async () => ({ parentID: "main", agent: reviewer.agent, location: { directory } }),
    context: async () => review,
  } }
  const args = { sessionID: "main", source, todos, messages, sources }
  assert.match(await reviewIssue(ctx, args), /No complete load/)
  messages.push({ type: "skill", skill: "pstack-no-comments", time: { created: 1 } })
  messages.push(assistant(2, [tool("subagent", reviewer, 2, { sessionID: "review" })]))
  assert.match(await reviewIssue(ctx, args), /No completed, linked review/)
  const report = assistant(4, [{ type: "text", text: "Reviewed the feature; no comments to remove." }], "stop")
  review = [assistant(3, [tool("read", { path: resolve(directory, "src/feature.js") }, 3)]), report]
  assert.equal(await reviewIssue(ctx, args), undefined)
  messages.push(assistant(5, [tool("write", { path: "src/feature.js" }, 5)]))
  assert.match(await reviewIssue(ctx, args), /No completed, linked review/)
})
