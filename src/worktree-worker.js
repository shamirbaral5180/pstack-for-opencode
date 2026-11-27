import { isAbsolute, relative, sep } from "node:path"
import { isModelAlias } from "./sheet.js"

export const WORKTREE_WORKER_TOOL = "pstack_worktree_worker"
export const isWorkerTool = (name) => name === "subagent" || name === WORKTREE_WORKER_TOOL

const payload = (result) => result?.data ?? result
const absolute = (path) => typeof path === "string" && !path.includes("\0") && isAbsolute(path)
export const sameDirectory = (left, right) => absolute(left) && absolute(right) && relative(left, right) === ""

function within(root, path) {
  if (!absolute(root) || !absolute(path)) return false
  const subpath = relative(root, path)
  return subpath !== ".." && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath)
}

const modelRef = (model) => {
  if (model === undefined || isModelAlias(model)) return undefined
  const match = typeof model === "string" && /^([^/#\s]+)\/([^#\s]+)(?:#([^#\s]+))?$/.exec(model)
  if (!match) throw new Error("Specify a model as provider/model#variant, or omit it to inherit the parent's model.")
  const [, providerID, id, variant] = match
  return { providerID, id, ...(variant && { variant }) }
}

export function registerWorktreeWorker(ctx, isActive) {
  const { session } = ctx
  if (!ctx.tool?.transform || !ctx.worktree?.list || !ctx.agent?.get || !ctx.permission?.assert ||
    ![session.create, session.move, session.wait, session.get, session.prompt].every((method) => typeof method === "function")) return

  return ctx.tool.transform((editor) => editor.add({
    name: WORKTREE_WORKER_TOOL,
    description: "Start a linked pstack worker in a registered worktree of this project, only when the selected workflow calls for isolation. Pass the worktree's absolute directory and the same agent, brief and optional model as for subagent. If placement fails, the worker is not prompted. Do not retry the assignment in the parent checkout.",
    options: { codemode: false },
    input: {
      type: "object",
      additionalProperties: false,
      required: ["directory", "agent", "description", "prompt"],
      properties: {
        directory: { type: "string", description: "Absolute directory returned by OpenCode worktree creation or inventory." },
        agent: { type: "string" },
        description: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string", description: "provider/model#variant; omit, inherit-parent, or auto to use the parent's model." },
      },
    },
    execute: async ({ directory, agent, description, prompt, model }, { sessionID, agent: caller, messageID, id, signal }) => {
      if (!(await isActive(sessionID))) throw new Error("Worktree workers require an active pstack session.")
      if (!absolute(directory) || ![agent, description, prompt].every((value) => typeof value === "string" && value.trim())) {
        throw new Error("Provide an absolute worktree directory, an agent, a description, and a worker brief.")
      }
      const selectedModel = modelRef(model)
      await ctx.permission.assert({
        sessionID, agent: caller, source: { type: "tool", messageID, id },
        action: "subagent", resources: [agent], save: [agent],
      })
      const deadline = AbortSignal.timeout(30_000)
      const options = { signal: signal ? AbortSignal.any([signal, deadline]) : deadline }
      const parent = payload(await session.get({ sessionID }, options))
      if (!parent?.projectID || parent.parentID || !absolute(parent.location?.directory)) {
        throw new Error("Only an active pstack coordinator with a known project checkout can start a worktree worker.")
      }
      const target = payload(await ctx.agent.get({ agentID: agent }, options))
      if (target?.mode !== "subagent" || target.hidden) throw new Error(`${agent} is not an available subagent.`)
      const worktrees = payload(await ctx.worktree.list({ projectID: parent.projectID }, options))
      const checkout = Array.isArray(worktrees) && worktrees.find((item) => sameDirectory(item.directory, directory))?.directory
      if (!checkout || within(checkout, parent.location.directory)) {
        throw new Error("Use a registered worktree of this project that is separate from the parent checkout. No worker was started.")
      }

      let child
      try {
        options.signal.throwIfAborted()
        child = payload(await session.create({
          parentID: sessionID, agent, title: description, model: selectedModel ?? parent.model,
          ...(parent.permissions && { permissions: parent.permissions }),
        }, options))
        if (!child?.id || child.id === sessionID || child.parentID !== sessionID) throw new Error("OpenCode did not return a linked child.")
        const input = { sessionID: child.id }
        await session.move({ ...input, directory: checkout }, options)
        await session.wait(input, options)
        const placed = payload(await session.get(input, options))
        if (placed?.id !== child.id || placed.parentID !== sessionID || placed.projectID !== parent.projectID ||
          !sameDirectory(placed.location?.directory, checkout)) {
          throw new Error("OpenCode did not confirm the linked child in the assigned worktree.")
        }
        options.signal.throwIfAborted()
      } catch (cause) {
        if (child?.id && child.id !== sessionID && child.parentID === sessionID) {
          await session.remove?.({ sessionID: child.id }, { signal: AbortSignal.timeout(5_000) }).catch(() => {})
        }
        const detail = cause?.message?.trim()
        throw new Error(`Could not place the worker in ${checkout}. No prompt was sent; do not start it in the parent checkout.${detail ? ` ${detail}` : ""}`, { cause })
      }

      try {
        await session.prompt({ sessionID: child.id, text: prompt }, options)
      } catch (cause) {
        throw new Error(`Worker ${child.id} was placed in ${checkout}, but prompt delivery could not be confirmed. Inspect that child before retrying. ${cause.message}`, { cause })
      }
      return {
        content: `Worker started in ${checkout} (sessionID: ${child.id}). OpenCode will deliver its background result to this session.`,
        metadata: { sessionID: child.id, directory: checkout },
      }
    },
  }))
}
