import { isAbsolute, posix, relative, resolve } from "node:path"
import { portable } from "./paths.js"
import { checklistWorkflow, loadedSources, missingLoad, pastStep, TODO_TOOL, toolCalls } from "./workflow.js"
import { isWorkerTool, sameDirectory, WORKTREE_WORKER_TOOL } from "./worktree-worker.js"

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

export const datedCalls = (messages) => messages.flatMap((message) => toolCalls([message]).map((call) => ({
  call, message, at: call.time?.ran ?? message.time?.created,
  completed: call.time?.completed ?? message.time?.completed,
})))

export function workerChanges(messages, directory) {
  return datedCalls(messages).flatMap(({ call, message, at, completed }) => {
    if (call.state?.status !== "completed" || !isMutation(call.name) || !Number.isFinite(at)) return []
    const files = call.state.metadata?.files
    // Edit/patch results can carry their own diff. A plain write needs
    // corroboration from the snapshot and must address that exact file.
    const changes = Array.isArray(files)
      ? new Set(files.filter((file) => file.additions > 0 || file.deletions > 0 || ["added", "deleted"].includes(file.status))
        .map((file) => relativeFile(file.file, directory)))
      : snapshotFiles(message)
    return mutationTargets(call.name, call.state.input, directory)
      .filter((path) => changes.has(path))
      .map((path) => ({ path, at, completed: message.time?.completed ?? completed, snapshot: message.snapshot }))
  })
}

const scopePaths = (item) => (item?.paths ?? []).map((path) => relativeFile(path))

function declarations(messages, source, step) {
  const paths = new Map()
  let workflow = source.name
  for (const { call, completed } of datedCalls(messages)) {
    const input = call.state?.input
    if (call.name !== TODO_TOOL || call.state.status !== "completed" || !Array.isArray(input?.todos)) continue
    const selected = checklistWorkflow(call)
    if (selected && selected !== workflow) paths.clear()
    workflow = selected ?? workflow
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

function retainedWorkers(children, messages, directory) {
  const local = children.filter((child) => sameDirectory(child.directory, directory))
  const changes = local.flatMap((child) => child.changes).sort((a, b) => a.at - b.at)
  let restoredAt = -Infinity
  for (const message of messages) {
    const files = snapshotFiles(message)
    const at = message.time?.created
    const done = message.time?.completed
    if (!files.size || !(done > at) || at < restoredAt || !toolCalls([message]).some((call) =>
      call.state.status === "completed" && (call.name === "shell" || isMutation(call.name)))) continue

    // Use the host's same-checkout snapshots, not a command string or a
    // claim of reversion. An exact rollback must bracket every scoped edit.
    const prior = changes.filter((change) => change.at >= restoredAt && change.at < done)
    if (!prior.length || !prior.every((change) => change.completed < at && files.has(change.path))) continue
    const last = prior.reduce((a, b) => a.completed >= b.completed ? a : b)
    if (message.snapshot.end === prior[0].snapshot?.start && message.snapshot.start === last.snapshot?.end) {
      restoredAt = done
    }
  }
  return children.map((child) => local.includes(child)
    ? { ...child, changes: child.changes.filter((change) => change.at >= restoredAt) }
    : child)
}

async function attributableChanges(ctx, session, messages, declared) {
  const assignments = new Map()
  for (const { call, at } of datedCalls(messages)) {
    const id = call.state?.metadata?.sessionID
    if (!isWorkerTool(call.name) || call.state.status !== "completed" ||
      typeof id !== "string" || id === session.id || !Number.isFinite(at)) continue
    const brief = call.state.input?.prompt
    const directory = call.name === WORKTREE_WORKER_TOOL ? call.state.metadata?.directory : undefined
    if (call.name === WORKTREE_WORKER_TOOL && !directory) continue
    if (typeof brief !== "string" || (declared && ![...declared.values()].some((time) => time <= at))) continue
    if (!assignments.has(id)) assignments.set(id, [])
    assignments.get(id).push({ at, brief, directory })
  }

  const receipts = await Promise.all([...assignments].map(async ([id, briefs]) => {
    try {
      const meta = payload(await ctx.session.get({ sessionID: id }))
      if (!meta) return
      if (meta.parentID !== session.id || (session.projectID && meta.projectID !== session.projectID)) return { changes: [] }
      const history = payload(await ctx.session.context({ sessionID: id }))
      const dir = meta.location?.directory
      if (!Array.isArray(history) || !dir) return
      const changes = workerChanges(history, dir).filter(({ path, at }) => briefs.some((brief) =>
        (!brief.directory || sameDirectory(brief.directory, dir)) &&
        brief.at <= at && (!declared || (declared.get(path) ?? Infinity) <= brief.at) &&
        mentionsFile(brief.brief, path, dir)))
      const report = history.filter((message) => message.type === "assistant")
        .flatMap((message) => (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text)).join("\n")
      const firstChangeAt = Math.min(...changes.map(({ at }) => at))
      return { changes, firstChangeAt, history, report, directory: dir, brief: briefs.map((brief) => brief.brief).join("\n") }
    } catch {
      return
    }
  }))
  const unavailable = receipts.includes(undefined)
  const observed = receipts.filter(Boolean)
  const children = unavailable ? observed : retainedWorkers(observed, messages, session.location?.directory)
  return {
    paths: new Set(children.flatMap((child) => child.changes.map(({ path }) => path))),
    unavailable,
    children,
  }
}

function principleSources(sources) {
  return [...sources.values()].filter((entry) => entry.id?.startsWith("pstack-principle-"))
}

// A principle is "referenced" only when a text names it explicitly: the leaf name
// `principle-<title>`, the skill id `pstack-principle-<title>`, or the bolded title
// `**<title>**` used by the playbooks. Natural-language prose is never inferred.
function referencedPrinciples(text, principles) {
  if (typeof text !== "string" || !text) return new Set()
  const ids = new Set()
  for (const principle of principles) {
    const title = principle.name.replace(/^principle-/, "")
    if (!title) continue
    if (text.includes(`principle-${title}`) || text.includes(`pstack-principle-${title}`) || text.includes(`**${title}**`)) {
      ids.add(principle.id)
    }
  }
  return ids
}

function workerPrincipleIssue(source, step, receipts, sources) {
  const principles = principleSources(sources)
  if (!principles.length) return
  // Only the worker(s) that actually changed the assigned files are checked; a
  // reviewer or other non-implementer child is not required to load anything.
  for (const child of receipts.children.filter((entry) => entry.changes.length)) {
    const loaded = loadedSources(child.history, sources)
    // A resumed worker keeps its original chronology even after its work was discarded.
    const beforeImplementation = loadedSources(child.history, sources, child.firstChangeAt)
    const required = new Set(step.handoff ?? [])
    for (const id of referencedPrinciples(child.brief, principles)) required.add(id)
    for (const id of required) {
      const principle = principles.find((entry) => entry.id === id)
      if (!principle || beforeImplementation.has(principle.name)) continue
      const retry = " To retry, restore the checkout to its pre-attempt contents without discarding unrelated work, then delegate to a fresh worker with the required leaf read first."
      if (loaded.has(principle.name)) {
        return `Step ${step.id} of ${source.path}: the assigned worker loaded ${principle.name} too late. The leaf must be read before its first attributable implementation change; a later read cannot validate that change.${retry}`
      }
      return `Step ${step.id} of ${source.path}: the assigned worker did not load the required ${principle.name}. Load ${principle.path} in the worker before it implements; a main-session read does not satisfy the worker's principle load.${retry}`
    }
    for (const id of referencedPrinciples(child.report, principles)) {
      const principle = principles.find((entry) => entry.id === id)
      if (!principle || loaded.has(principle.name)) continue
      return `Step ${step.id} of ${source.path}: the assigned worker cited ${principle.name} without loading ${principle.path}. Cite only principles whose leaf was actually read in the worker session.`
    }
  }
}

export async function implementationIssue(ctx, { sessionID, session, source, todos, messages, sources, targets, delivery, native }) {
  if (session?.parentID) return
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
    const leaf = missingLoad(step.handoff, loadedSources(messages, sources), sources)
    if (leaf) return `${prefix}: read ${leaf.path} in full before the handoff. A checklist entry is not evidence of a leaf read.`
    if (!closing && !changing) continue

    const required = closing ? paths : targets.filter((path) => paths.includes(path))
    const declared = native ? undefined : declarations(messages, source, step)
    const undeclared = required.filter((path) => declared && !declared.has(path))
    if (undeclared.length) {
      return `${prefix}: save the implementation paths on an in-progress checklist before assigning them. No accepted scope is visible for: ${undeclared.join(", ")}.`
    }
    const receipts = await attributableChanges(ctx, session ?? { id: sessionID }, messages, declared)
    const missing = required.filter((path) => !receipts.paths.has(path))
    if (missing.length || !receipts.paths.size) {
      const detail = receipts.unavailable ? "Some child evidence was unavailable." : "A spawn or a worker's report is not an implementation change."
      return `${prefix}: no attributable worker change for ${missing.join(", ") || "the implementation"}. ${detail} Name the implementation files in the brief, let the assigned worker change them, then inspect the diff. If evidence is unavailable, report the blocker.`
    }
    const principleIssue = workerPrincipleIssue(source, step, receipts, sources)
    if (principleIssue) return principleIssue
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
