import { modelCatalog, parseRef } from "./models.js"
import { availableRef, isModelAlias, parseSheet, ROLES } from "./sheet.js"
import { savedChecklist } from "./workflow.js"
import { isWorkerTool } from "./worktree-worker.js"

const data = (value) => value?.data ?? value
const key = (value) => value.split("#", 1)[0]
const reviewerRole = "judgment and prose"
const reviewerAgent = "pstack:comment-sicko"
const codeRoles = ROLES.filter(({ kind }) => kind === "code")

export function skillId(request, registered, owned) {
  if (registered.some(({ id }) => id === request)) return request
  const matches = registered.filter(({ name }) => name === request)
  return matches.length === 1 && owned.has(matches[0].id) ? matches[0].id : request
}

export function assignedRole(source, todo, agent) {
  if (agent === reviewerAgent) return reviewerRole
  if (agent !== "pstack:poteto-agent" || !source?.playbook) return
  const roles = new Set()
  for (const { id, title, handoff } of source.steps) {
    if (!handoff || !todo?.some((item) => item.step === id && item.status === "in_progress")) continue
    const ref = /\busing your configured ([a-z-]+) model\b/i.exec(title)?.[1]
    const role = codeRoles.find(({ key }) => key.split(", ").includes(ref))
    if (role) roles.add(role.key)
  }
  return roles.size === 1 ? [...roles][0] : undefined
}

const namedByUser = (messages, ref) => messages.some((message) =>
  message.type === "user" && typeof message.text === "string" &&
  message.text.split(/[\s`"'(),;]+/).includes(ref))

export async function roleAssignment(ctx, { sessionID, input, source, todos, sheet }) {
  const role = assignedRole(source, todos, input.agent)
  const saved = role && parseSheet(sheet).roles[role]
  if (!saved) return input
  const wanted = saved.trim()
  const given = typeof input.model === "string" && input.model ? input.model : undefined
  if (given && given !== wanted && (isModelAlias(wanted) || key(given) !== key(wanted))) {
    const history = data(await ctx.session.context({ sessionID }))
    if (typeof given === "string" && parseRef(given) && namedByUser(history ?? [], given)) return input
    throw new Error(`pstack model assignment: the selected ${role} role is ${wanted}, not ${given}. Omit model to use the role, or report why it is blocked. A different model must be explicitly requested by the user.`)
  }
  if (isModelAlias(wanted)) {
    const { model: _model, ...rest } = input
    return rest
  }
  const ref = given ?? wanted
  if (!availableRef(ref, await modelCatalog(ctx))) {
    throw new Error(`pstack model assignment: ${ref} for ${role} is not in the available model catalog. No worker was started. Report the blocker or ask the user for an explicit alternative; no saved preference was changed.`)
  }
  return { ...input, model: ref }
}

export async function registerDispatch(ctx, { active, sources, skills, sheet }) {
  if (!ctx.tool?.hook) return
  const owned = new Set(skills.map(({ id }) => id))
  await ctx.tool.hook("execute.before", async (event) => {
    const { tool, sessionID, agent, input } = event
    if ((tool !== "skill" && !isWorkerTool(tool)) || !input || typeof input !== "object") return
    const mode = await active(sessionID)
    if (tool === "skill") {
      if ((!mode && !agent?.startsWith("pstack:")) || typeof input.id !== "string" || !ctx.skill.list) return
      const registered = data(await ctx.skill.list())
      if (Array.isArray(registered)) {
        const id = skillId(input.id, registered, owned)
        if (id !== input.id) event.input = { ...input, id }
      }
      return
    }
    if (!mode || agent?.startsWith("pstack:") || input.sessionID) return
    const saved = await savedChecklist(ctx, sessionID)
    const source = sources.get(saved?.workflow)
    if (assignedRole(source, saved?.todos, input.agent)) {
      event.input = await roleAssignment(ctx, { sessionID, input, source, todos: saved?.todos, sheet: sheet() })
    }
  })
}
