import { relative } from "node:path"
import { datedCalls, isMutation } from "./implementation.js"
import { portable } from "./paths.js"
import { loadedSources, toolCalls } from "./workflow.js"
import { isWorkerTool } from "./worktree-worker.js"

const data = (reply) => reply?.data ?? reply
const normalize = (file) => process.platform === "win32" ? portable(file).toLowerCase() : portable(file)

export function upstreamReview(sources) {
  const mode = sources.get("poteto-mode")
  const name = /\bBefore review → \*\*([\w-]+)\*\*/.exec(mode?.text ?? "")?.[1]
  const source = sources.get(name)
  const agent = /^\d+\. Spawn `Task` with `subagent_type: "([\w-]+)"`/m.exec(source?.text ?? "")?.[1]
  return source && agent ? { source, agent: `pstack:${agent}` } : undefined
}

export function deliveryReviewStep(source) {
  return source.steps.find(({ title }) => /\bRun \*\*Opening a PR\*\*/.test(title))
}

export async function reviewIssue(ctx, { sessionID, source, todos, messages, sources }) {
  if (!deliveryReviewStep(source)) return
  const paths = new Set(source.steps.filter(({ handoff }) => handoff)
    .flatMap(({ id }) => todos.find(({ step }) => step === id)?.paths ?? []).map(normalize))
  if (!paths.size) return
  const requirement = upstreamReview(sources)
  if (!requirement) return
  const { source: review, agent } = requirement
  if (!loadedSources(messages, sources).has(review.name)) {
    return `Before closing delivery, load and follow ${review.id}. No complete load of the upstream review skill was observed.`
  }

  const mainCalls = datedCalls(messages)
  const lastMainEdit = Math.max(0, ...mainCalls.filter(({ call }) => isMutation(call.name) && call.state.status === "completed")
    .map(({ completed, at }) => completed ?? at).filter(Number.isFinite))
  const start = mainCalls.filter(({ call, at }) =>
    isWorkerTool(call.name) && !call.state.input?.sessionID && call.state.status === "completed" &&
    at >= lastMainEdit && call.state.input?.agent === agent && loadedSources(messages, sources, at).has(review.name))

  for (const { call, at } of start) {
    const childID = call.state.metadata?.sessionID
    if (!childID || childID === sessionID) continue
    try {
      const child = data(await ctx.session.get({ sessionID: childID }))
      if (child?.parentID !== sessionID || child.agent !== agent || !child.location?.directory) continue
      const history = data(await ctx.session.context({ sessionID: childID }))
      if (!Array.isArray(history)) continue
      const turns = datedCalls(history)
      if (turns.some(({ call }) => isMutation(call.name) && call.state.status === "completed")) continue
      const reads = turns.filter(({ call, completed }) => {
        const path = call.state.input?.path
        if (call.name !== "read" || call.state.status !== "completed" || typeof path !== "string" || !(completed >= at)) return false
        return paths.has(normalize(path)) || paths.has(normalize(relative(child.location.directory, path)))
      })
      if (!reads.length) continue
      const report = history.findLast((message) => message.type === "assistant" && message.finish === "stop" &&
        message.time?.completed >= reads[0].completed &&
        message.content?.some((part) => part.type === "text" && part.text?.trim()))
      if (report) return
    } catch {
      // A missing or inaccessible child cannot prove completed review.
    }
  }
  return `Before closing delivery, delegate the current change using ${review.id} and wait for the independent ${agent} report. No completed, linked review with a read of an implementation file was observed. If blocked, report it and leave delivery open or blocked.`
}
