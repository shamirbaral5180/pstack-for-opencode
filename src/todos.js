import { workflowIssue } from "./workflow.js"

export const TODO_TOOL = "pstack_todowrite"
const TODO_KEY = "pstack-workflow-todos"

export function registerTodos(ctx, activeMode, sources) {
  const entries = ctx.session.instructions?.entry
  if (!ctx.tool?.transform || !ctx.permission?.assert || !entries?.list || !entries?.put) return

  return ctx.tool.transform((editor) => {
    editor.add({
      name: TODO_TOOL,
      description: "Read or replace the current pstack session's workflow todo list. Omit todos to read it. For Poteto Mode, set workflow to the selected playbook (playbooks/<title>.md) or the selected workflow skill's name, after loading it. Use the original numbered step or phase letter as each item's step ID (start for a Start section). Leave IDs off extra items. Report blockers rather than closing unexecuted steps.",
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
          if (!source) throw new Error("Name the upstream playbook or routed workflow skill selected by Poteto Mode before saving the checklist. The plugin does not choose the route.")
          const context = await ctx.session.context({ sessionID })
          const messages = context?.data ?? context
          if (!Array.isArray(messages) || messages.length === 0) throw new Error("OpenCode did not supply session evidence. Checklist update could not be validated.")
          const check = workflowIssue(source, todos, messages, sources, workflow === saved.workflow ? saved.verified : undefined)
          if (typeof check === "string") throw new Error(check)
          value = { workflow, todos, verified: check.verified }
        }
        await entries.put({ sessionID, key: TODO_KEY, value })
        return { content: `Saved ${todos.length} workflow todos for this session.` }
      },
    })
  })
}

export function todoMapping(tools) {
  if (tools?.todowrite) {
    delete tools[TODO_TOOL]
    return "TaskCreate, TaskUpdate, TodoWrite, and todolist refer to the native `todowrite` tool."
  }
  if (tools?.[TODO_TOOL]) {
    return `TaskCreate, TaskUpdate, TodoWrite, todowrite, and todolist refer to \`${TODO_TOOL}\` on this host. After loading your selected workflow, name it in \`workflow\` and set the checklist with \`todos\` before advancing. Use original step numbers or phase letters as \`step\` IDs; for a Start section use \`start\`. Keep those IDs in updates. If the tool reports missing evidence, complete the upstream prerequisite or report the blocker.`
  }
  return "No todo tool is available for this request. If the selected workflow requires a todolist, report that step as blocked; do not claim it was created."
}
