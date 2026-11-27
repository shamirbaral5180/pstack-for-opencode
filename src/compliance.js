import { implementationIssue, isMutation, mutationTargets, workspaceNotice } from "./implementation.js"
import { reviewIssue } from "./review.js"
import { checklistWorkflow, currentTurn, loadedSources, missingLoad, pastStep, savedChecklist, TODO_TOOL, toolCalls, workflowHistory, workflowStart } from "./workflow.js"
import { WORKTREE_WORKER_TOOL } from "./worktree-worker.js"

export function actionFor(tool, input) {
  if (isMutation(tool)) return "mutation"
  if (tool === WORKTREE_WORKER_TOOL || (tool === "subagent" && !input?.sessionID)) return "delegation"
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

function workflowState(messages, sources, saved) {
  const recent = currentTurn(messages)
  const persisted = sources.get(saved?.workflow)
  if (persisted?.steps.length && Array.isArray(saved.todos)) {
    const history = workflowHistory(messages, workflowStart(messages, persisted, saved))
    const seen = new Set([...loadedSources(history, sources), ...(saved.verified ?? [])])
    return { status: "observed", recent, history, seen, route: persisted, todos: saved.todos, native: false }
  }
  // If the ledger is incomplete, absence of an event is not evidence.
  if (recent[0]?.type !== "user") return { status: "unknown" }
  const seen = loadedSources(recent, sources)
  const calls = toolCalls(recent)
  const checklist = checklistFor(calls)
  const declaration = calls.findLast((call) => call.name === TODO_TOOL &&
    call.state?.status === "completed" && Array.isArray(call.state.input?.todos) && checklistWorkflow(call))
  const declared = declaration && checklistWorkflow(declaration)
  const checklistMessage = checklist && recent.findIndex((message) => message.type === "assistant" && message.content?.includes(checklist))
  const routingEvidence = !declared && checklistMessage > 0 ? loadedSources(recent.slice(0, checklistMessage), sources) : seen
  const choices = [...routingEvidence].map((name) => sources.get(name)).filter((source) => source.steps.length)
  const route = declared ? choices.find((source) => source.name === declared) : choices.length === 1 ? choices[0] : undefined
  if (!route) return { status: "ambiguous" }
  return { status: "observed", recent, history: recent, seen, route, todos: checklist?.state.input.todos, native: checklist?.name === "todowrite" }
}

export function inspectAction(action, messages, sources, saved) {
  const state = workflowState(messages, sources, saved)
  if (state.status !== "observed") return state
  const { history, seen, route, todos } = state
  const violation = (message) => ({ status: "violation", message })
  if (!todos?.length) {
    return violation(`Before ${action}, record the checklist required by ${route.path}. No successful non-empty checklist write is visible in this turn. Use the available todo tool first.`)
  }
  const indexed = new Set(todos.map((item) => item.step).filter(Boolean))
  // Native lists without source step IDs can establish that a list exists,
  // but cannot prove that a paraphrased entry covers an upstream step.
  if (indexed.size) {
    const omitted = route.steps.filter((step) => !indexed.has(step.id)).map((step) => step.id)
    if (omitted.length) return violation(`Before ${action}, add missing checklist entries ${omitted.join(", ")} from ${route.path}.`)
    for (const step of route.steps) {
      if (!pastStep(route, step, todos)) continue
      const skill = missingLoad(step.skills, seen, sources)
      if (skill) return violation(`Step ${step.id} of ${route.path} requires a successful load of ${skill.path} before advancing. Load and apply it, or report the blocker.`)
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
      const loadedAt = history.findIndex((message) => loadedSources([message], sources).has(review.name))
      const delegated = observedActions(history.slice(loadedAt + 1))
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
  return state
}

export async function registerCompliance(ctx, isActive, sources) {
  if (!ctx.session.context) return
  const context = async (sessionID) => {
    const response = await ctx.session.context({ sessionID }).catch(() => undefined)
    const messages = response?.data ?? response
    return Array.isArray(messages) ? messages : []
  }
  const checklist = (sessionID) => savedChecklist(ctx, sessionID).catch(() => undefined)
  if (ctx.tool?.hook) {
    await ctx.tool.hook("execute.before", async (event) => {
      const { sessionID, tool, input } = event
      const action = actionFor(tool, input)
      if (!action || event.agent?.startsWith("pstack:") || !(await isActive(sessionID))) return
      const [messages, saved] = await Promise.all([context(sessionID), checklist(sessionID)])
      const result = inspectAction(action, messages, sources, saved)
      if (result.status === "violation") throw new Error(`pstack workflow checkpoint: ${result.message}`)
      if (result.status !== "observed" || !result.route.steps.some((step) => step.handoff)) return
      const delivery = ["opening-pr", "push"].includes(action)
      if (!delivery && (action !== "mutation" || result.native)) return
      const response = await ctx.session.get?.({ sessionID }).catch(() => undefined)
      const session = response?.data ?? response
      if (session?.parentID) return
      const targets = delivery ? undefined : mutationTargets(tool, input, session?.location?.directory ?? ctx.location?.directory)
      const scope = {
        sessionID, session, source: result.route, todos: result.todos, messages: result.history, sources, targets, delivery, native: result.native,
      }
      const issue = await implementationIssue(ctx, scope)
      if (issue) throw new Error(`pstack workflow checkpoint: ${issue}`)
      if (delivery) {
        const review = await reviewIssue(ctx, { ...scope, directory: session?.location?.directory })
        if (review) throw new Error(`pstack workflow checkpoint: ${review}`)
      }
    })
  }

  return async (sessionID) => {
    const [messages, saved] = await Promise.all([context(sessionID), checklist(sessionID)])
    const state = workflowState(messages, sources, saved)
    return workspaceNotice(state.recent ?? currentTurn(messages), state.route, state.todos)
  }
}
