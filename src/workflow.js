import { readFileSync, readdirSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { absolutePathKey, portable, vendorRoot } from "./paths.js"

export const TODO_TOOL = "pstack_todowrite"
export const TODO_KEY = "pstack-workflow-todos"

function requiredSkill(text, registered) {
  if (/\b(if|when|unless|only|optional|otherwise|or)\b/i.test(text)) return
  const match = /^`([\w-]+)` for [^.!?]+[.!?]?$/.exec(text)
    ?? /^(?:Run|Use) the \*\*([\w-]+)\*\* skill[.!?]?$/.exec(text)
    ?? /^Log [^.!?]+ via the \*\*([\w-]+)\*\* skill[.!?]?$/.exec(text)
  return registered.get(match?.[1])
}

function stepEvidence(line, step, registered) {
  for (const sentence of line.trim().replace(/^- /, "").split(/(?<=[.!?])\s+/)) {
    if (/\b(?:if|when|unless|optional|otherwise)\b/i.test(sentence)) continue
    const handoff = /^(?:Delegate (?:code-writing|implementation|the mechanical edits)|Hand the change) to a subagent\b/.test(sentence)
    if (handoff) step.handoff ??= []
    const invoked = /^(?:Use|Apply|Run) the \*\*([\w-]+)\*\* (principle )?skill\b/.exec(sentence)
    const references = [
      ...(invoked ? [invoked[2] && !invoked[1].startsWith("principle-") ? `principle-${invoked[1]}` : invoked[1]] : []),
      ...[...sentence.matchAll(/\bper \*\*(principle-[\w-]+)\*\*/g)].map((match) => match[1]),
    ]
    const seeded = /^Seed them with .+ and the \*\*([\w-]+)\*\* skill\b/.exec(sentence)
    if (seeded) references.push(seeded[1])
    for (const name of references) {
      const id = registered.get(name)
      const required = handoff ? step.handoff : step.skills
      if (id && !required.includes(id)) required.push(id)
    }
  }
}

export function workflowRequirements(text, registered, isPlaybook = false) {
  const lines = text.split(/\r?\n/)
  const steps = []
  if (isPlaybook) {
    let step
    for (const line of lines) {
      const item = /^(\d+)\. (.+)$/.exec(line)
      if (item) {
        const skill = requiredSkill(item[2], registered)
        step = { id: item[1], title: item[2], skills: skill ? [skill] : [] }
        steps.push(step)
        stepEvidence(item[2], step, registered)
      } else if (step && line.startsWith(" ")) {
        stepEvidence(line, step, registered)
      } else if (line) step = undefined
    }
    if (new Set(steps.map((step) => step.id)).size !== steps.length) return []
  } else if (/^Open a todolist\b/m.test(text)) {
    let step
    for (const line of lines) {
      const heading = /^## (Start|Phase ([A-Z]))(?:[.:] .+)?$/.exec(line)
      if (heading) {
        step = { id: heading[2] ?? "start", title: line.slice(3), skills: [] }
        steps.push(step)
      } else if (line.startsWith("## ")) {
        step = undefined
      } else if (step && !step.skills.length) {
        const id = requiredSkill(line.split(/(?<=[.!?])\s/)[0], registered)
        if (id) step.skills.push(id)
      }
    }
  }
  return steps
}

export function workflowSources(root, skills) {
  const byName = new Map(skills.map((skill) => [skill.name, { id: skill.id, source: skill.source }]))
  const registered = new Map(skills.map((skill) => [skill.name, skill.id]))
  const playbooks = "skills/poteto-mode/playbooks"
  const copySteps = /\bCopy its steps into the todolist tool first\b/.test(
    readFileSync(join(vendorRoot, "skills/poteto-mode/SKILL.md"), "utf8"),
  )
  for (const file of readdirSync(join(vendorRoot, playbooks))) {
    if (file.endsWith(".md")) byName.set(`playbooks/${file}`, { source: `${playbooks}/${file}`, playbook: true })
  }
  const lookup = new Map()
  for (const [name, item] of byName) {
    const text = readFileSync(join(vendorRoot, item.source), "utf8")
    const path = portable(join(root, item.source))
    const lineCount = readFileSync(path, "utf8").trimEnd().split(/\r?\n/).length
    const steps = !item.playbook || copySteps ? workflowRequirements(text, registered, item.playbook) : []
    lookup.set(name, { ...item, name, path, lineCount, steps, text })
  }
  return lookup
}

const workflowKey = (value) => typeof value === "string" ? portable(value.trim()).toLowerCase() : ""
const workflowSlug = (key) => key.split("/").at(-1).replace(/^pstack-/, "").replace(/\.md$/, "")
const workflowLabel = (source) => source.id ?? source.name

export function upstreamRouteRule(sources) {
  const mode = sources.get("poteto-mode")
  const routing = mode?.text.split(/^## Playbooks\s*$/m)[1]?.split(/^## /m)[0]
  return routing?.match(/^Match the task to a playbook[^\r\n]+/m)?.[0]
}

function nameDistance(left, right) {
  let row = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < right.length; j++) {
      next.push(Math.min(row[j + 1] + 1, next[j] + 1, row[j] + Number(left[i] !== right[j])))
    }
    row = next
  }
  return row.at(-1)
}

export function resolveWorkflow(value, sources, messages = []) {
  const key = workflowKey(value)
  const available = [...sources.values()]
  const candidates = key ? available.filter((source) => {
    const name = workflowKey(source.name)
    if (key === name || key === workflowKey(source.id)) return true
    const file = name.split("/").at(-1)
    return source.playbook && (key === file || key === file.replace(/\.md$/, ""))
  }) : []
  if (candidates.length === 1) return { source: candidates[0] }
  if (candidates.length > 1) {
    return { error: `Ambiguous workflow ${JSON.stringify(value)}. Specify one explicitly: ${candidates.map(workflowLabel).join(", ")}.` }
  }

  const slug = workflowSlug(key)
  const close = slug && slug.length <= 100 ? available.map((source) => {
    const name = workflowSlug(workflowKey(source.name))
    return { source, distance: nameDistance(slug, name) }
  }).filter(({ distance }) => distance <= 2).sort((a, b) => a.distance - b.distance).map(({ source }) => source) : []
  const seen = loadedSources(currentTurn(messages), sources)
  const loaded = available.filter((source) => (source.playbook || source.steps.length) && seen.has(source.name))
  const suggestions = [...new Set([...close, ...loaded])].slice(0, 3).map(workflowLabel)
  const problem = key ? `Unknown workflow ${JSON.stringify(value)}.` : "Name the selected upstream workflow in `workflow`."
  return { error: `${problem}${suggestions.length ? ` Possible sources: ${suggestions.join(", ")}.` : ""} Use the selected playbook filename or workflow skill ID; the plugin does not choose the route.` }
}

export function checklistWorkflow(call) {
  return call.state.metadata?.pstackWorkflow ?? call.state.input?.workflow
}

const orderedMessages = (messages) => [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))

export function currentTurn(messages) {
  const ordered = orderedMessages(messages)
  return ordered.slice(Math.max(0, ordered.findLastIndex((message) => message.type === "user")))
}

export async function savedChecklist(ctx, sessionID) {
  const result = await ctx.session.instructions?.entry?.list?.({ sessionID })
  return (result?.data ?? result)?.find((entry) => entry.key === TODO_KEY)?.value
}

export function workflowStart(messages, source, saved) {
  const turn = currentTurn(messages)[0]
  const current = turn?.type === "user" ? turn.time?.created : undefined
  if (saved?.workflow !== source.name) return current
  if (Number.isFinite(saved.startedAt)) return saved.startedAt

  // Older checklists have no start time. Recover only the current run of the selected source.
  let turnStart, start
  for (const message of orderedMessages(messages)) {
    if (message.type === "user") turnStart = message.time?.created
    for (const call of toolCalls([message])) {
      if (call.name !== TODO_TOOL || call.state?.status !== "completed" || !Array.isArray(call.state.input?.todos)) continue
      const workflow = checklistWorkflow(call)
      if (workflow === source.name) start ??= turnStart
      else if (workflow) start = undefined
    }
  }
  return start ?? current
}

export function workflowHistory(messages, startedAt) {
  return Number.isFinite(startedAt)
    ? orderedMessages(messages).filter((message) => message.time?.created >= startedAt)
    : currentTurn(messages)
}

export function loadedSources(messages, sources, before = Infinity) {
  const paths = new Map([...sources.values()].filter((item) => absolutePathKey(item.path))
    .map((item) => [absolutePathKey(item.path), item]))
  const byId = new Map([...sources.values()].filter((item) => item.id).map((item) => [item.id, item]))
  const evidence = new Set()
  for (const message of messages) {
    if (message.type === "skill" && byId.has(message.skill) &&
      (before === Infinity || message.time?.created < before)) evidence.add(byId.get(message.skill).name)
    if (message.type !== "assistant") continue
    for (const call of message.content ?? []) {
      if (call.type !== "tool" || call.state?.status !== "completed") continue
      if (before !== Infinity && !((call.time?.completed ?? message.time?.completed) < before)) continue
      const input = call.state.input
      if (call.name === "read" && typeof input?.path === "string") {
        const result = call.state.content?.find((part) => part.type === "text")?.text ?? ""
        const range = /^Read file ([^\r\n]+), lines 1-(\d+)(?:\r?\n|$)/.exec(result)
        const key = absolutePathKey(input.path)
        const item = paths.get(key)
        if (item && key === absolutePathKey(range?.[1]) && (input.offset ?? 1) === 1 &&
          (input.limit ?? Infinity) >= item.lineCount && Number(range?.[2]) >= item.lineCount &&
          call.state.metadata?.truncated === false) {
          evidence.add(item.name)
        }
      } else if (call.name === "skill") {
        const requested = input?.id ?? input?.name
        const canonical = byId.get(requested)
        const item = canonical ?? sources.get(requested)
        const { directory, name, truncated } = call.state.metadata ?? {}
        const resolvedHere = typeof directory === "string" && typeof item?.path === "string" &&
          relative(dirname(item.path), directory) === "" && name === item.name
        if (item?.id && (resolvedHere || canonical && directory === undefined) && truncated === false &&
          call.state.content?.some((part) => part.type === "text" && part.text.includes("</skill_content>"))) {
          evidence.add(item.name)
        }
      }
    }
  }
  return evidence
}

export function toolCalls(messages) {
  return messages.filter((message) => message.type === "assistant")
    .flatMap((message) => (message.content ?? []).filter((call) => call.type === "tool"))
}

export function pastStep(source, step, todos) {
  const status = new Map(todos.map((item) => [item.step, item.status]))
  return status.get(step.id) === "completed" || source.steps.slice(source.steps.indexOf(step) + 1).some((later) =>
    ["in_progress", "completed"].includes(status.get(later.id)))
}

export function missingLoad(ids, seen, sources) {
  return [...sources.values()].find((source) => ids.includes(source.id) && !seen.has(source.name))
}

export function workflowIssue(source, todos, messages, sources, verified = [], startedAt) {
  // Carry verified prerequisites on the same workflow; a newly selected
  // workflow must be grounded in its own turn's evidence.
  const loaded = loadedSources(workflowHistory(messages, startedAt), sources)
  if (!verified.includes(source.name) && !loaded.has(source.name)) {
    return `Load ${source.path} in full before saving its checklist. No successful full load is visible in this turn.`
  }
  const byStep = new Map()
  for (const item of todos) {
    if (!item.step) continue
    if (byStep.has(item.step)) return `Step ${item.step} appears twice; use a distinct upstream step ID for each tracked step.`
    byStep.set(item.step, item)
  }
  const missing = source.steps.filter((step) => !byStep.has(step.id))
  if (missing.length) return `Add the missing upstream checklist entries from ${source.path}: ${missing.map((step) => `${step.id} (${step.title.slice(0, 90)})`).join(", ")}.`

  const resolved = new Set([...verified, ...loaded])
  for (const step of source.steps) {
    if (!pastStep(source, step, todos)) continue
    const skill = missingLoad(step.skills, resolved, sources)
    if (skill) {
      return `Step ${step.id} of ${source.path} requires ${skill.name}. Load ${skill.path} in full and apply it before advancing; no successful full load is visible. If blocked, report the blocker and leave the step open.`
    }
  }
  const required = new Set(source.steps.filter((step) => pastStep(source, step, todos)).flatMap((step) => step.skills))
  return { verified: [source.name, ...[...sources.values()]
    .filter((item) => required.has(item.id) && resolved.has(item.name)).map((item) => item.name)] }
}
