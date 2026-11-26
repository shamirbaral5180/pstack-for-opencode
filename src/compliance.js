import { currentTurn, loadedSources, toolCalls } from "./workflow.js"
import { TODO_TOOL } from "./todos.js"

export function actionFor(tool, input) {
  if (["write", "edit", "patch", "apply_patch"].includes(tool)) return "mutation"
  if (tool === "subagent" && !input?.sessionID) return "delegation"
  if (tool !== "shell" || typeof input?.command !== "string") return
  const command = input.command.trim()
  // A script, pipeline or compound command is not a reliable indicator of intent.
  if (/[;&|<>`\r\n]/.test(command)) return
  if (/^(?:gh|origin) pr review(?:\s|$)/.test(command) && !/\s--(?:help|list)\b/.test(command)) return "review"
  if (/^(?:gh|origin) pr create(?:\s|$)/.test(command) && !/\s--(?:help|dry-run)\b/.test(command)) return "opening-pr"
  if (/^git push(?:\s|$)/.test(command) && !/\s(?:--dry-run|--help|-n)\b/.test(command)) return "push"
}

function checklistFor(calls) {
  return calls.findLast((call) =>
    [TODO_TOOL, "todowrite"].includes(call.name) && call.state?.status === "completed" &&
    Array.isArray(call.state.input?.todos),
  )
}

export function observedActions(messages) {
  return toolCalls(messages).flatMap((call) => {
    const action = actionFor(call.name, call.state?.input)
    if (!action || call.state.status !== "completed") return []
    const child = call.state.metadata?.sessionID
    if (action === "delegation" && !child) return []
    return [{ action, callID: call.id,
      ...(action === "delegation" ? { child, agent: call.state.input?.agent } : {}) }]
  })
}

export function inspectAction(action, messages, sources) {
  const recent = currentTurn(messages)
  // If the ledger is incomplete, absence of an event is not evidence.
  if (recent[0]?.type !== "user") return { status: "unknown" }
  const seen = loadedSources(recent, sources)
  const calls = toolCalls(recent)
  const checklist = checklistFor(calls)
  const declared = calls.findLast((call) => call.name === TODO_TOOL &&
    call.state?.status === "completed" && call.state?.input?.workflow && call.state.input.todos)?.state.input.workflow
  const checklistMessage = checklist && recent.findIndex((message) => message.type === "assistant" && message.content?.includes(checklist))
  const routingEvidence = !declared && checklistMessage > 0 ? loadedSources(recent.slice(0, checklistMessage), sources) : seen
  const choices = [...routingEvidence].map((name) => sources.get(name)).filter((source) => source.steps.length)
  const route = declared ? choices.find((source) => source.name === declared) : choices.length === 1 ? choices[0] : undefined
  const violation = (message) => ({ status: "violation", message })

  if (!route) return { status: "ambiguous" }
  const todos = checklist?.state.input.todos
  if (!todos?.length) {
    return violation(`Before ${action}, record the checklist required by ${route.path}. No successful non-empty checklist write is visible in this turn. Use the available todo tool first.`)
  }
  const indexed = new Set(todos.map((item) => item.step).filter(Boolean))
  // Native lists without source step IDs can establish that a list exists,
  // but cannot prove that a paraphrased entry covers an upstream step.
  if (indexed.size) {
    const omitted = route.steps.filter((step) => !indexed.has(step.id)).map((step) => step.id)
    if (omitted.length) return violation(`Before ${action}, add missing checklist entries ${omitted.join(", ")} from ${route.path}.`)
    const states = new Map(todos.map((item) => [item.step, item.status]))
    for (const [index, step] of route.steps.entries()) {
      if (!step.skill) continue
      if (states.get(step.id) !== "completed" &&
        !route.steps.slice(index + 1).some((item) => ["in_progress", "completed"].includes(states.get(item.id)))) continue
      const skill = [...sources.values()].find((item) => item.id === step.skill)
      if (!seen.has(skill.name)) return violation(`Step ${step.id} of ${route.path} requires a successful load of ${skill.path} before advancing. Load and apply it, or report the blocker.`)
    }
  }

  const poteto = sources.get("poteto-mode")
  const reviewName = /\bBefore review → \*\*([\w-]+)\*\*/.exec(poteto?.text ?? "")?.[1]
  const review = sources.get(reviewName)
  if (action === "review" && review && !seen.has(review.name)) {
    return violation(`Before review, load and apply ${review.path}, as directed by ${poteto.path}.`)
  }
  if (action === "review" && review) {
    const reviewer = /^\d+\. Spawn `Task` with `subagent_type: "([\w-]+)"`/m.exec(review.text)?.[1]
    if (reviewer) {
      const loadedAt = recent.findIndex((message) => loadedSources([message], sources).has(review.name))
      const delegated = observedActions(recent.slice(loadedAt + 1))
        .some((receipt) => receipt.action === "delegation" && receipt.agent === `pstack:${reviewer}`)
      if (!delegated) {
        return violation(`Before review, follow ${review.path}: no ${reviewer} child session is visible after the skill was loaded. Run the review step or report its blocker.`)
      }
    }
  }
  const pr = /^\d+\. Run \*\*(Opening a PR)\*\*\.$/m.exec(route.text)
  const prSource = pr && sources.get(`playbooks/${pr[1].toLowerCase().replaceAll(" ", "-")}.md`)
  if (action === "opening-pr" && prSource && !seen.has(prSource.name)) {
    return violation(`Before opening the PR, load and follow ${prSource.path} as directed by ${route.path}.`)
  }
  return { status: "observed" }
}

export async function registerCompliance(ctx, isActive, sources) {
  if (!ctx.tool?.hook || !ctx.session.context) return
  await ctx.tool.hook("execute.before", async (event) => {
    const action = actionFor(event.tool, event.input)
    if (!action || event.agent?.startsWith("pstack:") || !(await isActive(event.sessionID))) return
    const response = await ctx.session.context({ sessionID: event.sessionID }).catch(() => undefined)
    const messages = response?.data ?? response
    if (!Array.isArray(messages)) return
    const result = inspectAction(action, messages, sources)
    if (result.status === "violation") throw new Error(`pstack workflow checkpoint: ${result.message}`)
  })
}
