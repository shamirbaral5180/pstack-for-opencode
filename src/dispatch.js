import { modelCatalog, parseRef } from "./models.js"
import { availableRef, isModelAlias, parseSheet, ROLES } from "./sheet.js"
import { loadedSources, savedChecklist, workflowHistory, workflowStart } from "./workflow.js"
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

export function arenaPhase(source, todos, arena) {
  if (!arena || !Array.isArray(todos)) return
  const phase = arena.steps.find(({ title }) => /^Phase [A-Z]: Fan out$/i.test(title))
  if (!phase) return
  const nested = source !== arena
  const prefix = `${arena.name}:`
  const namespaced = nested && todos.some(({ step }) => step?.startsWith(prefix))
  const stepId = (id) => namespaced ? `${prefix}${id}` : id
  if (!arena.steps.every(({ id }) => todos.some(({ step }) => step === stepId(id)))) return
  return todos.find(({ step }) => step === stepId(phase.id))?.status
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

export async function arenaAssignment(ctx, input, sheet) {
  const saved = parseSheet(sheet).roles["arena runners"]
  if (!saved) return input
  const seats = saved.split(",").map((ref) => ref.trim()).filter(Boolean)
  const given = typeof input.model === "string" && input.model ? input.model : undefined
  if (given === undefined || isModelAlias(given)) {
    if (!seats.some(isModelAlias)) throw new Error("pstack Arena: choose an explicit model from arena runners for this candidate. Omission is only for an inherit-parent or auto seat.")
    const { model: _model, ...rest } = input
    return rest
  }
  const catalog = await modelCatalog(ctx)
  if (!availableRef(given, catalog)) throw new Error(`pstack Arena: ${given} is not available. Choose a configured seat or follow Arena's fallback.`)
  const available = catalog.find(({ ref }) => ref === key(given))
  const fits = seats.some((seat) => given === seat || (!availableRef(seat, catalog) &&
    (key(seat) === key(given) || catalog.find(({ ref }) => ref === key(seat))?.family === available.family)))
  if (fits) return input
  throw new Error(`pstack Arena: ${given} does not match a configured arena runners seat. Use the seat's listed model and variant; leave a blocked seat out only as the upstream skill directs.`)
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
    const source = sources.get(saved?.workflow) ?? [...sources.values()].find(({ id }) => id === mode)
    const arena = sources.get("arena")
    const phase = ["general", "pstack:poteto-agent"].includes(input.agent) && arenaPhase(source, saved?.todos, arena)
    if (phase === "in_progress") {
      const messages = data(await ctx.session.context({ sessionID }))
      const history = workflowHistory(messages ?? [], workflowStart(messages ?? [], source ?? arena, saved))
      if (loadedSources(history, sources).has(arena.name)) {
        event.input = await arenaAssignment(ctx, input, sheet())
        return
      }
    }
    if (assignedRole(source, saved?.todos, input.agent)) {
      event.input = await roleAssignment(ctx, { sessionID, input, source, todos: saved?.todos, sheet: sheet() })
    }
  })
}
