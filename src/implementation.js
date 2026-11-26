import { isAbsolute, posix, relative, resolve } from "node:path"
import { portable } from "./paths.js"
import { currentTurn, loadedSources, missingLoad, pastStep, TODO_TOOL, toolCalls } from "./workflow.js"

const pathKey = (path) => process.platform === "win32" ? path.toLowerCase() : path
const payload = (response) => response?.data ?? response

function relativeFile(path, directory) {
  if (typeof path !== "string" || !path || /[\x00-\x1f<>*?]/.test(path)) return
  if (isAbsolute(path)) {
    if (!directory) return
    path = relative(directory, path)
  }
  const file = posix.normalize(portable(path))
  if (/^(?:\.{1,2}|\.git)(?:\/|$)|^(?:\/|[a-z]:)|\/$/i.test(file)) return
  return pathKey(file)
}

export const isMutation = (tool) => ["write", "edit", "patch", "apply_patch"].includes(tool)

export function mutationTargets(tool, input, directory) {
  if (!isMutation(tool)) return []
  const path = input?.path ?? input?.filePath
  const patch = typeof input === "string" ? input : input?.patchText ?? input?.patch ?? input?.text
  const paths = typeof path === "string" ? [path]
    : typeof patch === "string" ? [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((match) => match[1])
    : []
  return paths.map((path) => relativeFile(path, directory)).filter(Boolean)
}

function snapshotFiles(message) {
  const { start, end, files } = message.snapshot ?? {}
  return new Set(start && end && start !== end && Array.isArray(files)
    ? files.map((file) => relativeFile(file)).filter(Boolean) : [])
}

const datedCalls = (messages) => messages.flatMap((message) => toolCalls([message]).map((call) => ({
  call, message, at: call.time?.ran ?? message.time?.created,
  completed: call.time?.completed ?? message.time?.completed,
})))

export function workerChanges(messages, directory) {
  return datedCalls(messages).flatMap(({ call, message, at }) => {
    if (call.state?.status !== "completed" || !isMutation(call.name) || !Number.isFinite(at)) return []
    const files = call.state.metadata?.files
    // Edit/patch results can carry their own diff. A plain write needs
    // corroboration from the snapshot and must address that exact file.
    const changes = Array.isArray(files)
      ? new Set(files.filter((file) => file.additions > 0 || file.deletions > 0 || ["added", "deleted"].includes(file.status))
        .map((file) => relativeFile(file.file, directory)))
      : snapshotFiles(message)
    return mutationTargets(call.name, call.state.input, directory)
      .filter((path) => changes.has(path)).map((path) => ({ path, at }))
  })
}

const scopePaths = (item) => (item?.paths ?? []).map((path) => relativeFile(path))

function declarations(messages, source, step) {
  const paths = new Map()
  let workflow = source.name
  for (const { call, completed } of datedCalls(messages)) {
    const input = call.state?.input
    if (call.name !== TODO_TOOL || call.state.status !== "completed" || !Array.isArray(input?.todos)) continue
    workflow = input.workflow ?? workflow
    if (workflow !== source.name || !Number.isFinite(completed)) continue
    const item = input.todos.find((item) => item.step === step.id)
    if (item?.status === "pending") paths.clear()
    if (item?.status !== "in_progress") continue
    for (const path of scopePaths(item)) {
      if (path && !paths.has(path)) paths.set(path, completed)
    }
  }
  return paths
}

function mentionsFile(brief, path, directory) {
  if (typeof brief !== "string") return false
  const names = directory ? [path, pathKey(portable(resolve(directory, path)))] : [path]
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp("(?:^|[\\s`'\"(\\[=:]|\\./)" + escaped + "(?=$|[\\s`'\"),;:\\]!?]|\\.(?:\\s|$))")
      .test(pathKey(portable(brief)))
  })
}

async function attributableChanges(ctx, session, messages, declared) {
  const assignments = new Map()
  for (const { call, at } of datedCalls(messages)) {
    const id = call.state?.metadata?.sessionID
    if (call.name !== "subagent" || call.state.status !== "completed" ||
      typeof id !== "string" || id === session.id || !Number.isFinite(at)) continue
    const brief = call.state.input?.prompt
    if (typeof brief !== "string" || (declared && ![...declared.values()].some((time) => time <= at))) continue
    if (!assignments.has(id)) assignments.set(id, [])
    assignments.get(id).push({ at, brief })
  }

  const receipts = await Promise.all([...assignments].map(async ([id, briefs]) => {
    try {
      const meta = payload(await ctx.session.get({ sessionID: id }))
      if (!meta) return
      if (meta.parentID !== session.id || (session.projectID && meta.projectID !== session.projectID)) return []
      const history = payload(await ctx.session.context({ sessionID: id }))
      const dir = meta.location?.directory
      if (!Array.isArray(history) || !dir) return
      return workerChanges(history, dir).filter(({ path, at }) => briefs.some((brief) =>
        brief.at <= at && (!declared || (declared.get(path) ?? Infinity) <= brief.at) &&
        mentionsFile(brief.brief, path, dir)))
    } catch {
      return
    }
  }))
  return {
    paths: new Set(receipts.flatMap((changes) => changes?.map(({ path }) => path) ?? [])),
    unavailable: receipts.includes(undefined),
  }
}

export async function implementationIssue(ctx, { sessionID, session, source, todos, messages, sources, targets, delivery, native }) {
  if (session?.parentID) return
  const recent = currentTurn(messages)
  for (const step of source.steps.filter((step) => step.handoff)) {
    const item = todos.find((todo) => todo.step === step.id)
    const paths = scopePaths(item)
    const pastHandoff = pastStep(source, step, todos)
    const closing = delivery || (pastHandoff && (!targets || (targets.length && !paths.length)))
    const changing = item?.status !== "pending" && targets?.some((path) => paths.includes(path))
    if (!closing && !changing && (targets || item?.status !== "in_progress")) continue
    try {
      session ??= payload(await ctx.session.get({ sessionID }))
    } catch {}
    if (session?.parentID) return

    const prefix = `Step ${step.id} of ${source.path}`
    if (!native && (!paths.length || paths.some((path) => !path) || new Set(paths).size !== paths.length)) {
      return `${prefix} requires a scoped implementation handoff. Set paths on that step to distinct project-relative implementation files, not scratch work or artifacts from verification.`
    }
    const leaf = missingLoad(step.handoff, loadedSources(recent, sources), sources)
    if (leaf) return `${prefix}: read ${leaf.path} in full before the handoff. A checklist entry is not evidence of a leaf read.`
    if (!closing && !changing) continue

    const required = closing ? paths : targets.filter((path) => paths.includes(path))
    const declared = native ? undefined : declarations(recent, source, step)
    const undeclared = required.filter((path) => declared && !declared.has(path))
    if (undeclared.length) {
      return `${prefix}: save the implementation paths on an in-progress checklist before assigning them. No accepted scope is visible for: ${undeclared.join(", ")}.`
    }
    const receipts = await attributableChanges(ctx, session ?? { id: sessionID }, recent, declared)
    const missing = required.filter((path) => !receipts.paths.has(path))
    if (missing.length || !receipts.paths.size) {
      const detail = receipts.unavailable ? "Some child evidence was unavailable." : "A spawn or a worker's report is not an implementation change."
      return `${prefix}: no attributable worker change for ${missing.join(", ") || "the implementation"}. ${detail} Name the implementation files in the brief, let the assigned worker change them, then inspect the diff. If evidence is unavailable, report the blocker.`
    }
  }
}

export function workspaceNotice(recent, source, todos) {
  const last = recent.findLast((message) => message.type === "assistant" || message.type === "shell")
  if (!last) return
  const calls = toolCalls([last])
  const shell = last.type === "shell" || calls.some((call) =>
    ["shell", "execute"].includes(call.name) && ["completed", "error"].includes(call.state?.status))
  const steps = source?.steps.filter((step) => step.handoff) ?? []
  const scope = steps.flatMap((step) => scopePaths(todos?.find((item) => item.step === step.id))).filter(Boolean)
  const files = [...snapshotFiles(last)].filter((path) => !scope.length || scope.includes(path))
  if (!files.length) return
  const observed = files.slice(0, 5).join(", ") + (files.length > 5 ? ` and ${files.length - 5} more` : "")
  if (shell) {
    return `Workspace changes during the last shell or Code Mode step: ${observed}. The shared snapshot does not identify the writer or the purpose of the changes. Investigation, scaffolding, and verification can proceed.${steps.length ? " If these are implementation changes, verify the selected playbook's handoff from worker evidence." : ""}`
  }
  if (steps.length && !scope.length && calls.some((call) => isMutation(call.name) && call.state?.status === "completed")) {
    return `Workspace files changed without a scoped handoff: ${observed}. Preparation can proceed. If these are implementation files, follow the selected playbook's handoff before claiming the change.`
  }
}
