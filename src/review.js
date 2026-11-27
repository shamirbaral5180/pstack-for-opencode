import { relative } from "node:path"
import { datedCalls, isMutation } from "./implementation.js"
import { portable } from "./paths.js"
import { loadedSources } from "./workflow.js"
import { matchesWorktreeReview } from "./worktree-review.js"
import { isWorkerTool, sameDirectory, WORKTREE_WORKER_TOOL } from "./worktree-worker.js"

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
  let step
  for (const line of (source.text ?? "").split(/\r?\n/)) {
    const id = /^(\d+)\. /.exec(line)?.[1]
    if (id) step = source.steps.find((entry) => entry.id === id)
    else if (line.trim() && !/^\s/.test(line)) step = undefined
    if (step && /\bRun \*\*Opening a PR\*\*/.test(line)) return step
  }
}

export function deliveryIssue(source, todos, previous, messages) {
  const delivery = deliveryReviewStep(source)
  if (!delivery || !todos.some(({ step, status }) => step === delivery.id && status === "completed")) return
  if (previous?.some(({ step, status }) => step === delivery.id && status === "blocked")) {
    return `Step ${delivery.id} is blocked. Reopen it as in_progress when the blocker is resolved; do not mark it completed directly.`
  }
  const unfinished = source.steps.slice(0, source.steps.indexOf(delivery))
    .filter(({ id }) => todos.find(({ step }) => step === id)?.status !== "completed")
  if (unfinished.length) return `Before completing PR delivery, finish upstream steps ${unfinished.map(({ id }) => id).join(", ")}.`
  if (!openedPR(messages)) return "PR delivery is not complete: no successful ready PR creation was observed. Local commits, a PR description, or a blocked report are not a PR. If no remote or forge is allowed, mark the PR step blocked."
}

export const LOCAL_REVIEW_STEP = "local-review"

export function reviewPaths(source, todos) {
  return source.steps.filter(({ handoff }) => handoff)
    .flatMap(({ id }) => todos.find(({ step }) => step === id)?.paths ?? [])
}

export function openedPR(messages) {
  return datedCalls(messages).some(({ call }) => {
    const { status, input, content, metadata } = call.state
    if (call.name !== "shell" || status !== "completed" || (metadata?.exit != null && metadata.exit !== 0)) return false
    const command = input?.command?.trim()
    return /^(?:gh|origin) pr create(?:\s|$)/.test(command ?? "") && !/[;&|<>`\r\n]/.test(command) &&
      !/\s(?:--dry-run|--help|--draft|-d)(?=[=\s]|$)/.test(command) &&
      content?.some(({ text }) => /^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pulls?\/\d+\s*$/m.test(text ?? ""))
  })
}

export async function reviewIssue(ctx, { sessionID, source, todos, messages, sources, directory }) {
  const paths = new Set(reviewPaths(source, todos).map(normalize))
  if (!paths.size) return
  const requirement = upstreamReview(sources)
  if (!requirement) return
  const { source: review, agent } = requirement
  if (!loadedSources(messages, sources).has(review.name)) {
    return `Before marking local review complete, load and follow ${review.id}. No complete load of the upstream review skill was observed.`
  }

  const mainCalls = datedCalls(messages)
  const lastMainEdit = Math.max(0, ...mainCalls.filter(({ call }) => isMutation(call.name) && call.state.status === "completed")
    .map(({ completed, at }) => completed ?? at).filter(Number.isFinite))
  const workers = new Set(mainCalls.flatMap(({ call }) => {
    const id = call.state.metadata?.sessionID
    return isWorkerTool(call.name) && call.state.status === "completed" && call.state.input?.agent !== agent && id && id !== sessionID ? [id] : []
  }))
  const lastImplementation = await Promise.all([...workers].map(async (id) => {
    try {
      const reply = await ctx.session.get({ sessionID: id })
      const child = data(reply)
      if (child?.parentID !== sessionID || (directory && !sameDirectory(directory, child.location?.directory))) return 0
      const history = data(await ctx.session.context({ sessionID: id })) ?? []
      return Math.max(0, ...datedCalls(history).filter(({ call }) => isMutation(call.name) && call.state.status === "completed")
        .map(({ completed, at }) => completed ?? at).filter(Number.isFinite))
    } catch {
      return 0
    }
  }))
  const changedAt = Math.max(lastMainEdit, ...lastImplementation)
  const start = mainCalls.filter(({ call, at }) =>
    isWorkerTool(call.name) && !call.state.input?.sessionID && call.state.status === "completed" &&
    Number.isFinite(at) && call.state.input?.agent === agent && loadedSources(messages, sources, at).has(review.name))

  for (const { call, at } of start) {
    const childID = call.state.metadata?.sessionID
    if (!childID || childID === sessionID) continue
    try {
      const child = data(await ctx.session.get({ sessionID: childID }))
      const checkout = child?.location?.directory
      if (child?.parentID !== sessionID || child.agent !== agent || !checkout) continue
      const inWorktree = call.name === WORKTREE_WORKER_TOOL
      if (!inWorktree && (at < changedAt || (directory && !sameDirectory(directory, checkout)))) continue
      if (inWorktree && (!directory || sameDirectory(directory, checkout) ||
        !sameDirectory(call.state.metadata?.directory, checkout))) continue
      const history = data(await ctx.session.context({ sessionID: childID }))
      if (!Array.isArray(history)) continue
      const turns = datedCalls(history)
      if (turns.some(({ call }) => isMutation(call.name) && call.state.status === "completed")) continue
      const reads = turns.filter(({ call, completed }) => {
        const path = call.state.input?.path
        if (call.name !== "read" || call.state.status !== "completed" || typeof path !== "string" || !(completed >= at)) return false
        return inWorktree || paths.has(normalize(path)) || paths.has(normalize(relative(checkout, path)))
      })
      if (!reads.length) continue
      const report = history.findLast((message) => message.type === "assistant" && message.finish === "stop" &&
        message.time?.completed >= reads[0].completed &&
        message.content?.some((part) => part.type === "text" && part.text?.trim()))
      if (!report) continue
      if (!inWorktree) return
      const placement = history.findLast(({ type }) => type === "location-switched")
      const firstPrompt = history.find(({ type }) => type === "user")
      if (!sameDirectory(placement?.location?.directory, checkout) ||
        !(placement.time?.created <= firstPrompt?.time?.created) || !(firstPrompt.time.created >= at) ||
        history.indexOf(placement) >= history.indexOf(firstPrompt)) continue
      if (await matchesWorktreeReview({
        stamp: call.state.metadata?.pstackWorktreeReview, parent: directory, checkout, paths,
        reads: reads.filter(({ completed }) => completed <= report.time.completed).map(({ call }) => call),
      })) return
    } catch {
      // A missing or inaccessible child cannot prove completed review.
    }
  }
  const worktreeHint = start.some(({ call }) => call.name === WORKTREE_WORKER_TOOL)
    ? " For a worktree review, integrate the exact reviewed changes and verify that the reviewer read all changed files in full, or run a fresh review in the final checkout." : ""
  return `Delegate the current local change using ${review.id} and wait for the independent ${agent} report. No completed, linked review with a read of an implementation file was observed.${worktreeHint} Record a local-review blocker separately if the review cannot run.`
}
