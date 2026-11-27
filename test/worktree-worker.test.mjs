import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import test from "node:test"
import { registerWorktreeWorker, WORKTREE_WORKER_TOOL } from "../src/worktree-worker.js"

const parentDirectory = resolve("worktree-fixture", "parent")
const directory = resolve("worktree-fixture", "worker")
const input = { directory, agent: "general", description: "Implement lane A", prompt: "Implement src/lane.js in the assigned checkout." }
const context = { sessionID: "parent", agent: "build", messageID: "message", id: "call" }

async function fixture({ moved = true, fail, active = true, parentID, inventory = [{ directory }] } = {}) {
  const calls = []
  const native = {}
  const record = (name, fn) => async (arg, options) => {
    calls.push([name, arg])
    if (fail === name) throw new Error(`${name} failed`)
    return fn(arg, options)
  }
  const parent = { id: "parent", parentID, projectID: "project", location: { directory: parentDirectory },
    model: { providerID: "provider", id: "main" }, permissions: [{ action: "shell", resource: "*", effect: "deny" }] }
  const child = { id: "child", parentID: parent.id, projectID: parent.projectID, location: parent.location }
  const session = {
    get: record("get", ({ sessionID }) => ({ data: sessionID === parent.id ? parent : child })),
    create: record("create", () => child),
    move: record("move", () => { if (moved) child.location = { directory } }),
    wait: record("wait", () => {}),
    prompt: record("prompt", () => {}),
    remove: record("remove", () => {}),
  }
  await registerWorktreeWorker({
    session,
    tool: { transform: (apply) => apply({ add: (tool) => { native.tool = tool } }) },
    agent: { get: record("agent", () => ({ mode: "subagent" })) },
    worktree: { list: record("list", () => ({ data: inventory })) },
    permission: { assert: record("permission", () => {}) },
  }, async () => active)
  assert.equal(native.tool.name, WORKTREE_WORKER_TOOL)
  return { execute: native.tool.execute, calls, parent }
}

test("links the child, waits for and verifies placement, then sends its first prompt", async () => {
  const { execute, calls, parent } = await fixture()
  const result = await execute({ ...input, model: "other/model#low" }, context)
  assert.deepEqual(calls, [
    ["permission", {
      sessionID: "parent", agent: "build", source: { type: "tool", messageID: "message", id: "call" },
      action: "subagent", resources: ["general"], save: ["general"],
    }],
    ["get", { sessionID: "parent" }],
    ["agent", { agentID: "general" }],
    ["list", { projectID: "project" }],
    ["create", { parentID: "parent", agent: "general", title: input.description,
      model: { providerID: "other", id: "model", variant: "low" }, permissions: parent.permissions }],
    ["move", { sessionID: "child", directory }],
    ["wait", { sessionID: "child" }],
    ["get", { sessionID: "child" }],
    ["prompt", { sessionID: "child", text: input.prompt }],
  ])
  assert.deepEqual(result.metadata, { sessionID: "child", directory })
})

test("a failed move or unconfirmed placement removes only the idle child and never prompts it", async () => {
  for (const options of [{ fail: "move" }, { fail: "wait" }, { moved: false }]) {
    const { execute, calls, parent } = await fixture(options)
    await assert.rejects(execute(input, context), /Could not place .* No prompt was sent/)
    assert.deepEqual(calls.find(([name]) => name === "create")[1].model, parent.model)
    assert.equal(calls.some(([name]) => name === "prompt"), false)
    assert.deepEqual(calls.at(-1), ["remove", { sessionID: "child" }])
  }
})

test("both model aliases preserve the parent reference and variant in worktree workers", async () => {
  for (const model of ["inherit-parent", "auto"]) {
    const { execute, calls, parent } = await fixture()
    parent.model.variant = "high"
    await execute({ ...input, model }, context)
    assert.deepEqual(calls.find(([name]) => name === "create")[1].model, parent.model)
  }
})

test("ordinary or nested sessions, permission denials, and unrelated or parent directories cannot create a worker", async () => {
  for (const [options, target, expected] of [
    [{ active: false }, directory, /active pstack session/],
    [{ parentID: "another-session" }, directory, /active pstack coordinator/],
    [{ fail: "permission" }, directory, /permission failed/],
    [{ inventory: [] }, directory, /registered worktree/],
    [{ inventory: [{ directory: parentDirectory }] }, parentDirectory, /separate from the parent/],
  ]) {
    const { execute, calls } = await fixture(options)
    await assert.rejects(execute({ ...input, directory: target }, context), expected)
    assert.equal(calls.some(([name]) => name === "create"), false)
  }
})
