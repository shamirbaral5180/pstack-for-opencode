import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { portable, vendorRoot } from "./paths.js"

function requiredSkill(text, registered) {
  if (/\b(if|when|unless|only|optional|otherwise|or)\b/i.test(text)) return
  const match = /^`([\w-]+)` for [^.!?]+[.!?]?$/.exec(text)
    ?? /^(?:Run|Use) the \*\*([\w-]+)\*\* skill[.!?]?$/.exec(text)
    ?? /^Log [^.!?]+ via the \*\*([\w-]+)\*\* skill[.!?]?$/.exec(text)
  return registered.get(match?.[1])
}

export function workflowRequirements(text, registered, isPlaybook = false) {
  const lines = text.split(/\r?\n/)
  const steps = []
  if (isPlaybook) {
    for (const line of lines) {
      const item = /^(\d+)\. (.+)$/.exec(line)
      if (item) steps.push({ id: item[1], title: item[2], skill: requiredSkill(item[2], registered) })
    }
    if (new Set(steps.map((step) => step.id)).size !== steps.length) return []
  } else if (/^Open a todolist\b/m.test(text)) {
    let step
    for (const line of lines) {
      const heading = /^## (Start|Phase ([A-Z]))(?:[.:] .+)?$/.exec(line)
      if (heading) {
        step = { id: heading[2] ?? "start", title: line.slice(3) }
        steps.push(step)
      } else if (line.startsWith("## ")) {
        step = undefined
      } else if (step && !step.skill) {
        step.skill = requiredSkill(line.split(/(?<=[.!?])\s/)[0], registered)
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

export function currentTurn(messages) {
  const ordered = [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  return ordered.slice(Math.max(0, ordered.findLastIndex((message) => message.type === "user")))
}

export function loadedSources(messages, sources) {
  const paths = new Map([...sources.values()].map((item) => [item.path, item]))
  const byId = new Map([...sources.values()].filter((item) => item.id).map((item) => [item.id, item]))
  const evidence = new Set()
  for (const message of messages) {
    if (message.type === "skill" && byId.has(message.skill)) evidence.add(byId.get(message.skill).name)
    if (message.type !== "assistant") continue
    for (const call of message.content ?? []) {
      if (call.type !== "tool" || call.state?.status !== "completed") continue
      const input = call.state.input
      if (call.name === "read" && typeof input?.path === "string") {
        const item = paths.get(portable(input.path))
        const result = call.state.content?.find((part) => part.type === "text")?.text ?? ""
        const range = /^Read file [^\r\n]+, lines 1-(\d+)(?:\r?\n|$)/.exec(result)
        if (item && (input.offset ?? 1) === 1 && (input.limit ?? Infinity) >= item.lineCount &&
          Number(range?.[1]) >= item.lineCount && call.state.metadata?.truncated === false) {
          evidence.add(item.name)
        }
      } else if (call.name === "skill") {
        const item = byId.get(input?.id ?? input?.name) ?? sources.get(input?.name)
        if (item?.id) evidence.add(item.name)
      }
    }
  }
  return evidence
}

export function toolCalls(messages) {
  return messages.filter((message) => message.type === "assistant")
    .flatMap((message) => (message.content ?? []).filter((call) => call.type === "tool"))
}

export function workflowIssue(source, todos, messages, sources, verified = []) {
  // Older completed steps can be carried after compaction, but reads from an
  // earlier task do not count as evidence on a newly selected workflow.
  const loaded = loadedSources(currentTurn(messages), sources)
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

  const resolved = new Set(verified)
  resolved.add(source.name)
  const states = source.steps.map((step) => byStep.get(step.id).status)
  for (const [index, step] of source.steps.entries()) {
    if (!step.skill) continue
    if (states[index] !== "completed" && !states.slice(index + 1).some((status) => status === "in_progress" || status === "completed")) continue
    const skill = [...sources.values()].find((item) => item.id === step.skill)
    if (!(resolved.has(skill.name) || loaded.has(skill.name))) {
      return `Step ${step.id} of ${source.path} requires ${skill.name}. Load ${skill.path} in full and apply it before advancing; no successful full load is visible. If blocked, report the blocker and leave the step open.`
    }
    resolved.add(skill.name)
  }
  return { verified: [...resolved] }
}
