import assert from "node:assert/strict"
import test from "node:test"
import { actionFor, inspectAction, observedActions, registerCompliance } from "../src/compliance.js"
import skills from "../src/data/skills.js"
import { ensureTranslated } from "../src/translate.js"
import { loadedSources, workflowIssue, workflowRequirements, workflowSources } from "../src/workflow.js"

const sources = workflowSources(ensureTranslated().root, skills)
const feature = sources.get("playbooks/feature.md")
const figure = sources.get("figure-it-out")
const checklist = (route, advancing) => route.steps.map(({ id }) => ({
  step: id,
  status: id === advancing ? "in_progress" : "pending",
}))
const skill = (name, created = 2) => ({ type: "skill", skill: `pstack-${name}`, time: { created } })
const read = (name, { truncated = false, offset = 1, status = "completed" } = {}) => {
  const { path, lineCount } = sources.get(name)
  return {
    type: "assistant",
    time: { created: 2 },
    content: [{
      type: "tool", name: "read", state: {
        status, input: { path, offset }, metadata: { truncated },
        content: [{ type: "text", text: `Read file ${path}, lines ${offset}-${lineCount}\n...` }],
      },
    }],
  }
}

test("skipping an unconditional upstream skill blocks checklist advancement, then a real load clears it", () => {
  const seen = [read(feature.name)]
  assert.deepEqual(feature.steps.find((step) => step.id === "2").skills, ["pstack-architect"])
  assert.equal(typeof workflowIssue(feature, checklist(feature, "2"), seen, sources), "object")
  assert.match(workflowIssue(feature, checklist(feature, "4"), seen, sources), /Step 2.*requires architect/)
  assert.deepEqual(workflowIssue(feature, checklist(feature, "4"), [...seen, skill("architect")], sources), {
    verified: [feature.name, "architect"],
  })
  assert.match(workflowIssue(feature, checklist(feature, "4").filter((step) => step.step !== "3"), seen, sources),
    /missing upstream checklist entries.*3/)
})

test("conditional skills are not promoted to unconditional prerequisites", () => {
  assert.deepEqual(figure.steps.find((step) => step.id === "B").skills, [])
  assert.deepEqual(figure.steps.find((step) => step.id === "D").skills, ["pstack-show-me-your-work"])
  assert.equal(typeof workflowIssue(figure, checklist(figure, "C"), [skill("figure-it-out")], sources), "object")
  assert.match(workflowIssue(figure, checklist(figure, "E"), [skill("figure-it-out")], sources), /requires show-me-your-work/)
  assert.match(workflowIssue(feature, checklist(feature, "8"), [read(feature.name), skill("architect")], sources),
    /requires principle-sequence-verifiable-units/)
  assert.equal(typeof workflowIssue(feature, checklist(feature, "8"), [
    read(feature.name), skill("architect"), skill("principle-sequence-verifiable-units"),
  ], sources), "object")
})

test("failed, partial, incidental, stale, and self-reported loads are not evidence for the selected workflow", () => {
  for (const event of [
    read(feature.name, { truncated: true }),
    read(feature.name, { offset: 2 }),
    read(feature.name, { status: "error" }),
    skill("figure-it-out"),
    { type: "assistant", content: [{ type: "text", text: `I read ${feature.path}` }] },
  ]) {
    assert.match(workflowIssue(feature, checklist(feature, "1"), [event], sources), /No successful full load/)
  }
  const user = { type: "user", time: { created: 3 } }
  assert.match(workflowIssue(feature, checklist(feature, "4"), [skill("architect", 1), user], sources, [feature.name]),
    /requires architect/)
  assert.equal(typeof workflowIssue(feature, checklist(feature, "4"), [user], sources, [feature.name, "architect"]), "object")
})

test("ambiguous numbering and optional prose do not create gates", () => {
  const registry = new Map([["architect", "pstack-architect"]])
  assert.deepEqual(workflowRequirements("1. Trace\n1. `architect` for the shape.", registry, true), [])
  assert.deepEqual(workflowRequirements("1. If contested, `architect` for the shape.", registry, true)[0].skills, [])
  assert.equal(workflowRequirements("1. Delegate implementation to a subagent if useful.", registry, true)[0].handoff, undefined)
  assert.deepEqual(workflowRequirements("1. If contested, `architect` first. Delegate implementation to a subagent.", registry, true)[0].handoff, [])
})

const user = { type: "user", time: { created: 1 } }
const action = (name, input, status = "completed", metadata) => ({
  type: "assistant", time: { created: 4 },
  content: [{ type: "tool", id: `call-${name}`, name, state: { status, input, metadata } }],
})

test("only a complete skill tool result is evidence of a leaf load", () => {
  const leaf = "principle-model-the-domain"
  const input = { id: `pstack-${leaf}` }
  const result = (text, truncated) => {
    const msg = action("skill", input, "completed", { truncated })
    msg.content[0].state.content = [{ type: "text", text }]
    return msg
  }
  assert.equal(loadedSources([result("<skill_content>sample", false)], sources).has(leaf), false)
  assert.equal(loadedSources([result("<skill_content>sample</skill_content>", true)], sources).has(leaf), false)
  assert.equal(loadedSources([result("<skill_content>sample</skill_content>", false)], sources).has(leaf), true)
  assert.equal(loadedSources([read(leaf, { offset: 2 })], sources).has(leaf), false)
  assert.equal(loadedSources([read(leaf)], sources).has(leaf), true)
})

test("bug investigation cannot advance past the explicit why load; conditional architect stays conditional", () => {
  const bug = sources.get("playbooks/bug-fix.md")
  const todos = checklist(bug, "3")
  assert.match(workflowIssue(bug, todos, [user, read(bug.name)], sources), /requires why/)
  assert.equal(typeof workflowIssue(bug, todos, [user, read(bug.name), read("why")], sources), "object")
})

test("direct writes, new delegations, and delivery can catch checklist bypass before tool execution", async () => {
  let before
  let reads = 0
  let trace = [user, read(feature.name)]
  await registerCompliance({
    tool: { hook: async (name, fn) => { assert.equal(name, "execute.before"); before = fn } },
    session: { context: async () => { reads++; return { data: trace } } },
  }, async (id) => id === "poteto", sources)
  await before({ sessionID: "plain", tool: "write" })
  await before({ sessionID: "poteto", tool: "read" })
  await before({ sessionID: "poteto", agent: "pstack:poteto-agent", tool: "write" })
  assert.equal(reads, 0)
  for (const event of [
    { tool: "write" },
    { tool: "subagent", input: { agent: "pstack:poteto-agent" } },
    { tool: "shell", input: { command: "git push origin work" } },
  ]) await assert.rejects(before({ ...event, sessionID: "poteto" }), /No successful non-empty checklist/)
  trace = [...trace, action("todowrite", { todos: [{ content: "Trace the affected subsystem", status: "in_progress" }] })]
  await before({ sessionID: "poteto", tool: "write" })
})

test("rejects confirmed indexed checklist omissions and missing skills, not conditional or ambiguous routes", () => {
  const base = [user, read(feature.name)]
  assert.equal(inspectAction("mutation", [user, read(feature.name), skill("figure-it-out")], sources).status, "ambiguous")
  assert.equal(inspectAction("mutation", [read(feature.name)], sources).status, "unknown")
  assert.equal(inspectAction("mutation", [...base, action("todowrite", { todos: [] })], sources).status, "violation")
  const todos = checklist(feature, "4")
  assert.match(inspectAction("mutation", [...base, action("todowrite", { todos: todos.slice(1) })], sources).message, /missing checklist entries 1/)
  assert.match(inspectAction("mutation", [...base, action("todowrite", { todos })], sources).message, /requires a successful load.*architect/)
  assert.equal(inspectAction("mutation", [...base, skill("architect"), action("todowrite", { todos })], sources).status, "observed")
  const conditional = [user, skill("figure-it-out"), action("todowrite", { todos: checklist(figure, "C") })]
  assert.equal(inspectAction("mutation", conditional, sources).status, "observed")
})

test("review and PR creation check their source prerequisites without treating read-only commands as delivery", () => {
  const trace = [user, read(feature.name), skill("architect"), skill("principle-sequence-verifiable-units"),
    action("todowrite", { todos: checklist(feature, "8") })]
  assert.match(inspectAction("review", trace, sources).message, /no-comments/)
  assert.match(inspectAction("opening-pr", trace, sources).message, /opening-a-pr\.md/)
  assert.match(inspectAction("review", [...trace, skill("no-comments")], sources).message, /no comment-sicko child session/)
  assert.equal(inspectAction("review", [...trace, skill("no-comments"),
    action("subagent", { agent: "pstack:comment-sicko" }, "completed", { sessionID: "ses_review" })], sources).status, "observed")
  assert.equal(inspectAction("opening-pr", [...trace, read("playbooks/opening-a-pr.md")], sources).status, "observed")
  for (const command of ["gh pr view 5", "git push --dry-run", "gh pr create --help", "echo gh pr create", "git status && git push"]) {
    assert.equal(actionFor("shell", { command }), undefined)
  }
  assert.equal(actionFor("subagent", { sessionID: "existing" }), undefined)
})

test("recorded actions distinguish a completed write and actual child session from attempted calls", () => {
  const trace = [read(feature.name), skill("architect"), action("write", {}, "error"),
    action("subagent", {}), action("subagent", {}, "completed", { sessionID: "ses_child" }), action("write", {})]
  assert.deepEqual(observedActions(trace), [
    { action: "delegation", callID: "call-subagent", child: "ses_child", agent: undefined },
    { action: "mutation", callID: "call-write" },
  ])
})
