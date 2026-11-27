import { implementationIssue } from "./implementation.js"
import { deliveryIssue, deliveryReviewStep, LOCAL_REVIEW_STEP, reviewIssue, reviewPaths } from "./review.js"
import { resolveWorkflow, savedChecklist, TODO_KEY, TODO_TOOL, workflowHistory, workflowIssue, workflowStart } from "./workflow.js"

export { TODO_TOOL } from "./workflow.js"

export function registerTodos(ctx, activeMode, sources) {
  const entries = ctx.session.instructions?.entry
  if (!ctx.tool?.transform || !ctx.permission?.assert || !entries?.list || !entries?.put) return

  return ctx.tool.transform((editor) => {
    editor.add({
      name: TODO_TOOL,
      description: "Read or replace the pstack session's todo list. Omit todos to read it. Name the loaded workflow (playbook stem, filename, or playbooks/<file>.md; for a skill use its name or ID). Keep original step IDs and leave IDs off extra items. For a step requiring implementation delegation, save it in progress with paths set to the project-relative files to be implemented, and name those files in the worker's brief. Keep paths on updates. The worker must load explicitly required principles before its first implementation change. Advancing requires observed worker changes. Report blockers rather than closing unexecuted steps.",
      options: { codemode: false },
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          workflow: { type: "string" },
          todos: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["content", "status"],
              properties: {
                step: { type: "string", pattern: "^(start|local-review|[A-Z]|[0-9]+|[a-z][a-z-]*:[A-Z])$" },
                content: { type: "string", minLength: 1, maxLength: 250 },
                status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"] },
                paths: { type: "array", maxItems: 100, items: { type: "string", minLength: 1 } },
              },
            },
          },
        },
      },
      execute: async ({ workflow, todos }, { sessionID, agent, messageID, id }) => {
        const mode = await activeMode(sessionID)
        if (agent?.startsWith("pstack:") || !mode) {
          throw new Error("The pstack todo list is only available to the main agent in an active pstack session.")
        }
        await ctx.permission.assert({
          sessionID,
          agent,
          source: { type: "tool", messageID, id },
          action: "todowrite",
          resources: [TODO_KEY],
          save: [TODO_KEY],
        })
        const saved = await savedChecklist(ctx, sessionID) ?? []
        if (todos === undefined) return { content: JSON.stringify(saved) }
        let value = todos
        if (mode === "pstack-poteto-mode" || workflow !== undefined || saved.workflow !== undefined) {
          const context = await ctx.session.context({ sessionID })
          const messages = context?.data ?? context
          if (!Array.isArray(messages) || messages.length === 0) throw new Error("OpenCode did not supply session evidence. Checklist update could not be validated.")
          const persisted = workflow === undefined && sources.get(saved.workflow)
          const { source, error } = persisted ? { source: persisted } : resolveWorkflow(workflow, sources, messages)
          if (error) throw new Error(error)
          const startedAt = workflowStart(messages, source, saved)
          const check = workflowIssue(source, todos, messages, sources, source.name === saved.workflow ? saved.verified : undefined, startedAt)
          if (typeof check === "string") throw new Error(check)
          const scope = { sessionID, source, todos, messages: workflowHistory(messages, startedAt), sources }
          const handoff = await implementationIssue(ctx, scope)
          if (handoff) throw new Error(`pstack workflow checkpoint: ${handoff}`)
          const delivery = deliveryReviewStep(source)
          const remote = delivery && todos.find(({ step }) => step === delivery.id)?.status
          const local = todos.find(({ step }) => step === LOCAL_REVIEW_STEP)
          const scoped = reviewPaths(source, todos).length > 0
          const implemented = source.steps.filter(({ handoff }) => handoff)
            .every(({ id }) => todos.some(({ step, status }) => step === id && status === "completed"))
          const mustReview = remote === "completed" || remote === "blocked" && implemented && local?.status !== "blocked"
          if (scoped && (mustReview || local?.status === "completed")) {
            const parent = await ctx.session.get?.({ sessionID })
            const issue = await reviewIssue(ctx, { ...scope, directory: (parent?.data ?? parent)?.location?.directory })
            if (issue) throw new Error(`pstack workflow checkpoint: ${issue}`)
          }
          if (remote === "completed" && local?.status === "blocked") {
            throw new Error("pstack workflow checkpoint: Local review is blocked; reopen it after resolving the blocker before completing PR delivery.")
          }
          const premature = deliveryIssue(source, todos, saved.workflow === source.name ? saved.todos : undefined, scope.messages)
          if (premature) throw new Error(`pstack workflow checkpoint: ${premature}`)
          value = { workflow: source.name, todos, verified: check.verified, ...(Number.isFinite(startedAt) && { startedAt }) }
          if (scoped && !local) {
            value.todos = [...todos, { step: LOCAL_REVIEW_STEP, content: "Independent local review of the implementation", status: mustReview ? "completed" : "pending" }]
          } else if (scoped && mustReview) {
            value.todos = todos.map((item) => item === local ? { ...item, status: "completed" } : item)
          }
        }
        await entries.put({ sessionID, key: TODO_KEY, value })
        return value.workflow
          ? { content: `Saved ${todos.length} workflow todos for ${value.workflow}.`, metadata: { pstackWorkflow: value.workflow } }
          : { content: `Saved ${todos.length} workflow todos for this session.` }
      },
    })
  })
}

export function todoMapping(tools) {
  // Native `todowrite` carries no workflow, step-ID, or path fields, so it cannot
  // hold the structured record the pstack checklist needs. Keep the structured
  // fallback for pstack sessions and hide the native tool, so prerequisite and
  // handoff validation run identically on every host.
  if (tools?.todowrite) delete tools.todowrite
  if (tools?.[TODO_TOOL]) {
    return [
      `Use \`${TODO_TOOL}\` for the upstream checklist. Name the loaded playbook or skill in \`workflow\` and keep original step IDs; use \`start\` for a Start section.`,
      "Keep parent steps when tracking a nested workflow. Prefix nested phase IDs, for example `arena:B`, and wait for the fan-out phase checklist save to succeed before launching candidates.",
      "Save each implementation handoff in progress with concrete relative `paths` before delegation. Only attributable worker changes with the required early principle reads count.",
      "Complete `local-review` with a separate review of the implementation even if no remote is allowed. If review itself cannot run, record its own blocker. Mark PR delivery blocked, not completed, if no ready PR was opened.",
    ].join(" ")
  }
  return "No todo tool is available for this request. If the selected workflow requires a todolist, report that step as blocked; do not claim it was created."
}
