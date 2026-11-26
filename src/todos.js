import { implementationIssue } from "./implementation.js"
import { TODO_TOOL, workflowIssue } from "./workflow.js"

export { TODO_TOOL } from "./workflow.js"

const TODO_KEY = "pstack-workflow-todos"

export function registerTodos(ctx, activeMode, sources) {
  const entries = ctx.session.instructions?.entry
  if (!ctx.tool?.transform || !ctx.permission?.assert || !entries?.list || !entries?.put) return

  return ctx.tool.transform((editor) => {
    editor.add({
      name: TODO_TOOL,
      description: "Read or replace the pstack session's todo list. Omit todos to read it. Name the selected upstream workflow and keep original step IDs. Leave IDs off extra items. For a step requiring implementation delegation, save it in progress with paths set to the project-relative files to be implemented, and name those files in the worker's brief. Keep paths on updates. Advancing requires observed worker changes. Report blockers rather than closing unexecuted steps.",
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
                step: { type: "string", pattern: "^(start|[A-Z]|[0-9]+)$" },
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
        const result = await entries.list({ sessionID })
        const list = result?.data ?? result
        const saved = list.find((entry) => entry.key === TODO_KEY)?.value ?? []
        if (todos === undefined) return { content: JSON.stringify(saved) }
        workflow ??= saved.workflow
        let value = todos
        if (mode === "pstack-poteto-mode" || workflow) {
          const source = sources.get(workflow)
          if (!source) {
            const example = [...sources.keys()].find((name) => name.startsWith("playbooks/")) ?? "playbooks/feature.md"
            const given = workflow === undefined ? "nothing" : JSON.stringify(workflow)
            throw new Error(`The \`workflow\` field must name the selected source exactly (received ${given}). Use the source name you loaded, such as \`${example}\` or \`figure-it-out\`. The plugin does not choose the route.`)
          }
          const context = await ctx.session.context({ sessionID })
          const messages = context?.data ?? context
          if (!Array.isArray(messages) || messages.length === 0) throw new Error("OpenCode did not supply session evidence. Checklist update could not be validated.")
          const check = workflowIssue(source, todos, messages, sources, workflow === saved.workflow ? saved.verified : undefined)
          if (typeof check === "string") throw new Error(check)
          const handoff = await implementationIssue(ctx, { sessionID, source, todos, messages, sources })
          if (handoff) throw new Error(`pstack workflow checkpoint: ${handoff}`)
          value = { workflow, todos, verified: check.verified }
        }
        await entries.put({ sessionID, key: TODO_KEY, value })
        return { content: `Saved ${todos.length} workflow todos for this session.` }
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
    return `TaskCreate, TaskUpdate, TodoWrite, todowrite, and todolist refer to \`${TODO_TOOL}\` on this host. After loading your selected workflow, name it in \`workflow\` and set the checklist with \`todos\` before advancing. Use original step numbers or phase letters as \`step\` IDs; for a Start section use \`start\`. Keep those IDs in updates. For a playbook step that delegates implementation, save that step in progress with its concrete project-relative \`paths\` before handing it off; a child must actually change each scoped file before you close the step. If the tool reports missing evidence, complete the upstream prerequisite or report the blocker.`
  }
  return "No todo tool is available for this request. If the selected workflow requires a todolist, report that step as blocked; do not claim it was created."
}
