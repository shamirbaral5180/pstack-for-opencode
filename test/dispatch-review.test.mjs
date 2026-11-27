import assert from "node:assert/strict"
import test from "node:test"
import { dirname, resolve } from "node:path"
import { assignedRole, roleAssignment, skillId } from "../src/dispatch.js"
import skills from "../src/data/skills.js"
import { reviewIssue } from "../src/review.js"
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
