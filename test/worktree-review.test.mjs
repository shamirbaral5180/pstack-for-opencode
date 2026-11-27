import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { reviewIssue } from "../src/review.js"
import { worktreeReviewEvidence } from "../src/worktree-review.js"

const agent = "pstack:comment-sicko"
const mode = { name: "poteto-mode", text: "Before review → **no-comments**" }
const review = { name: "no-comments", id: "pstack-no-comments", text: '1. Spawn `Task` with `subagent_type: "comment-sicko"`' }
const sources = new Map([[mode.name, mode], [review.name, review]])
const source = { steps: [{ id: "4", handoff: [] }] }
const todos = [{ step: "4", paths: ["cli.mjs"] }]
const assistant = (at, content, finish = "tool-calls") => ({
  type: "assistant", finish, time: { created: at, completed: at }, content,
})
const tool = (name, at, input, metadata, text) => ({
  type: "tool", name, time: { ran: at, completed: at },
  state: { status: "completed", input, metadata, ...(text && { content: [{ type: "text", text }] }) },
})
const read = (path, at, body, truncated = false) => {
  const lines = body.replace(/\r?\n$/, "").split(/\r?\n/)
  return tool("read", at, { path }, { truncated }, `Read file ${path}, lines 1-${lines.length}\n${lines
    .map((line, i) => `${i + 1}: ${line}`).join("\n")}`)
}

test("a linked worktree review transfers only when its full read receipts and the final Git delta agree", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pstack-review-"))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  const directory = join(root, "main")
  const checkout = join(root, "reviewed")
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" })
  git(root, "init", "-qb", "main", directory)
  git(directory, "config", "core.autocrlf", "false")
  git(directory, "config", "user.name", "pstack test")
  git(directory, "config", "user.email", "pstack@example.invalid")
  await writeFile(join(directory, "cli.mjs"), "console.log('before')\n")
  git(directory, "add", ".")
  git(directory, "commit", "-qm", "baseline")
  git(directory, "worktree", "add", "--detach", checkout)
  const code = "console.log('reviewed')\r\n"
  const tests = "import 'node:test'\n"
  await writeFile(join(checkout, "cli.mjs"), code)
  await writeFile(join(checkout, "cli.test.mjs"), tests)
  git(checkout, "add", "--", "cli.test.mjs")
  const stamp = await worktreeReviewEvidence(directory, checkout)
  assert.ok(stamp)
  const metadata = { sessionID: "review", directory: checkout, pstackWorktreeReview: stamp }
  const messages = [
    { type: "skill", skill: review.id, time: { created: 1 } },
    assistant(2, [tool("pstack_worktree_worker", 2, { agent, directory: checkout }, metadata)]),
  ]
  const placed = { type: "location-switched", time: { created: 3 }, location: { directory: checkout } }
  const prompt = { type: "user", time: { created: 4 } }
  const mainRead = read("cli.mjs", 5, code)
  const testRead = read("../reviewed/cli.test.mjs", 6, tests)
  const report = assistant(7, [{ type: "text", text: "Both files reviewed." }], "stop")
  let history = [placed, prompt, assistant(5, [mainRead]), assistant(6, [testRead]), report]
  const ctx = { session: {
    get: async () => ({ parentID: "parent", agent, location: { directory: checkout } }),
    context: async () => history,
  } }
  const check = () => reviewIssue(ctx, { sessionID: "parent", source, todos, messages, sources, directory })
  const reject = async () => assert.match(await check(), /No completed, linked review/)
  await reject() // Same filename, but this checkout still has the baseline version.
  git(checkout, "add", ".")
  git(checkout, "commit", "-qm", "reviewed changes")
  git(directory, "merge", "--ff-only", git(checkout, "rev-parse", "HEAD").toString().trim())
  assert.equal(await check(), undefined)

  history[3] = assistant(6, [read("cli.test.mjs", 6, "import 'wrong'\n")])
  await reject()
  history[3] = assistant(6, [read("cli.test.mjs", 6, tests, true)])
  await reject()
  history[3] = assistant(6, [testRead])
  history.splice(4, 1)
  await reject()
  history.push(report)
  history = [prompt, placed, ...history.slice(2)]
  await reject()
  history = [placed, prompt, ...history.slice(2)]
  await writeFile(join(directory, "unreviewed.mjs"), "export const surprise = true\n")
  await reject() // The extra file is absent from the declared scope.
  await rm(join(directory, "unreviewed.mjs"))
  await writeFile(join(directory, "cli.mjs"), code.replace("\r\n", "\n"))
  await reject() // The displayed lines are the same, but the bytes differ.
  await writeFile(join(directory, "cli.mjs"), code)
  assert.equal(await check(), undefined)
  await writeFile(join(checkout, "cli.test.mjs"), "import 'node:assert'\n")
  await writeFile(join(directory, "cli.test.mjs"), "import 'node:assert'\n")
  await reject() // Later identical edits in both trees cannot repurpose the original review.
})
