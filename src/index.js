import { join } from "node:path"
import { LOOP_COMMAND, LOOP_SKILL } from "./adapter.js"
import { registerCompliance } from "./compliance.js"
import agents from "./data/agents.js"
import commands from "./data/commands.js"
import skills from "./data/skills.js"
import { currentModelRef, formatCatalog, modelCatalog } from "./models.js"
import { MANDATE, SETUP_OVERRIDE, mapping, methodology } from "./overlay.js"
import { modelsPath, portable } from "./paths.js"
import { ensureModelSheet } from "./setup.js"
import { SETUP_SKILL_BODY } from "./setup-skill.js"
import { hookEnabled, normalizeSheet, readSheet, roleModel } from "./sheet.js"
import { registerTodos, TODO_TOOL, todoMapping } from "./todos.js"
import { ensureTranslated, translateText } from "./translate.js"
import { workflowSources } from "./workflow.js"

const SETUP = "setup-pstack"

const DENY = { action: "*", resource: "*", effect: "deny" }
const ALLOW = (action) => ({ action, resource: "*", effect: "allow" })
// Read-only agents may read outside the workspace (to review worktrees), but never
// write there: `external_directory` lets the read tools cross the location boundary,
// while the deny base still blocks edit/write/shell/subagent. A fixed worktree root
// would let this be scoped to one directory; the port has none, so it is `*`.
const READ_ONLY = [
  DENY,
  ALLOW("read"),
  ALLOW("grep"),
  ALLOW("glob"),
  ALLOW("webfetch"),
  ALLOW("external_directory"),
  { action: "question", resource: "*", effect: "deny" },
]
const COMMENT_SICKO = [...READ_ONLY, ALLOW("skill")]

// readonly: true has no OpenCode flag. It maps to this agent. The deny base hides
// every tool not allowed after it, including subagent, so it cannot spawn a writer.
const READONLY = {
  id: "pstack:readonly",
  description:
    "Read-only pstack reviewer. Inspects code, diffs, tests, and evidence, and reports findings without modifying files.",
  system:
    "You are a read-only reviewer. Inspect the code, diffs, tests, and evidence you are given. Do not modify files and do not run shell commands. Report findings with file paths and concrete evidence. Do not ask the user questions.",
  permissions: READ_ONLY,
}

const sameModel = (left, right) =>
  left?.providerID === right?.providerID &&
  left?.id === right?.id &&
  (left?.variant ?? undefined) === (right?.variant ?? undefined)

const MODE_KEY = "pstack-active"
const POTETO = "pstack-poteto-mode"

async function applyAgentModels(ctx, sheetText, catalog) {  const model =
    roleModel(sheetText, "bug-fix", catalog) ?? roleModel(sheetText, "feature, refactoring", catalog)
  const review = roleModel(sheetText, "judgment and prose", catalog)
  const wanted = [
    ["pstack:poteto-agent", model],
    ["pstack:comment-sicko", review],
    ["pstack:readonly", review],
  ].filter(([, ref]) => ref !== undefined)
  if (!wanted.length) return
  await ctx.agent?.transform((editor) => {
    for (const [id, ref] of wanted) {
      if (!editor.get(id)) continue
      editor.update(id, (entry) => {
        entry.model = ref
      })
    }
  })
  await ctx.agent?.reload?.()
}

async function commandText(ctx, command, input, sheetPath, catalog) {
  const task = input.prompt.text.trim() || `Run the ${command.name} skill.`
  if (command.name !== SETUP) return task

  const current = await currentModelRef(ctx, input.sessionID)
  const sheet = ensureModelSheet(sheetPath, catalog, current)
  await applyAgentModels(ctx, readSheet(sheetPath), catalog)
  const state = sheet.created
    ? `A model sheet was written to ${portable(sheet.path)} from the configured models.`
    : sheet.updated
      ? `The model sheet at ${portable(sheet.path)} was normalized and updated.`
      : `The model sheet at ${portable(sheet.path)} is current.`
  return [SETUP_OVERRIDE, formatCatalog(catalog, current), state, task].filter(Boolean).join("\n\n")
}

export default {
  id: "pstack",

  async setup(ctx) {
    const sheetPath = typeof ctx.options?.modelsPath === "string" ? ctx.options.modelsPath : modelsPath
    const catalog = await modelCatalog(ctx)
    const sheetText = readSheet(sheetPath)

    // sessionID -> skill id, for sessions that have activated a pstack skill. This
    // is the fast in-memory signal; the durable source is the session instruction
    // entry set alongside it, so a plugin reload mid-session does not drop the mode.
    const activeModes = new Map()
    const setMode = async (sessionID, skillId) => {
      activeModes.set(sessionID, skillId)
      try {
        await ctx.session?.instructions?.entry?.put({ sessionID, key: MODE_KEY, value: skillId })
      } catch {
        // experimental instruction entries are a durability bonus, not a dependency
      }
    }
    const getMode = async (sessionID) => {
      const cached = activeModes.get(sessionID)
      if (cached) return cached
      try {
        const result = await ctx.session?.instructions?.entry?.list({ sessionID })
        const entries = result?.data ?? result ?? []
        const entry = entries.find((item) => item.key === MODE_KEY)
        if (entry?.value) {
          activeModes.set(sessionID, entry.value)
          return entry.value
        }
      } catch {
        // fall through: the in-memory signal is authoritative for the current process
      }
      return undefined
    }

    const translated = ensureTranslated()
    const MAPPING = mapping(translated.root)
    const METHODOLOGY = methodology(translated.root)
    const allSkills = [...skills, { ...LOOP_SKILL, path: join(translated.root, LOOP_SKILL.source) }]
    const allCommands = [...commands, LOOP_COMMAND]
    const activeTodoMode = async (sessionID) => hookEnabled(readSheet(sheetPath)) ? getMode(sessionID) : undefined
    const sources = workflowSources(translated.root, skills)
    await registerTodos(ctx, activeTodoMode, sources)
    const observeWorkspace = await registerCompliance(ctx, async (sessionID) => (await activeTodoMode(sessionID)) === POTETO, sources)

    await ctx.skill.transform((editor) => {
      for (const skill of allSkills) {
        if (editor.get(skill.id)) continue
        editor.add({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          path: join(translated.root, skill.source),
          content: skill.id === "pstack-setup-pstack" ? SETUP_SKILL_BODY : translateText(skill.content, translated.root),
          ...(skill.autoinvoke === undefined ? {} : { autoinvoke: skill.autoinvoke }),
        })
      }
    })

    await ctx.command.transform((editor) => {
      for (const command of allCommands) {
        editor.add({
          name: command.name,
          description: command.description,
          execute: async (input) => {
            if (command.skillId !== "pstack-setup-pstack" && (await getMode(input.sessionID)) !== POTETO) {
              await setMode(input.sessionID, command.skillId)
            }
            const attached = input.prompt.skills ?? []
            const already = attached.some((item) => item.id === command.skillId)
            await ctx.session.prompt({
              sessionID: input.sessionID,
              text: await commandText(ctx, command, input, sheetPath, catalog),
              files: input.prompt.files,
              agents: input.prompt.agents,
              skills: already ? attached : [{ id: command.skillId }, ...attached],
              delivery: input.delivery,
            })
          },
        })
      }
    })

    await ctx.agent?.transform((editor) => {
      const definitions = new Map(agents.map((agent) => [agent.id, agent]))
      definitions.set(READONLY.id, READONLY)
      const commentSicko = definitions.get("pstack:comment-sicko")
      if (commentSicko) definitions.set("pstack:comment-sicko", { ...commentSicko, permissions: COMMENT_SICKO })
      for (const agent of definitions.values()) {
        if (editor.get(agent.id)) continue
        editor.update(agent.id, (entry) => {
          entry.mode = "subagent"
          entry.description = agent.description
          entry.system = agent.source ? translateText(agent.system, translated.root) : agent.system
          for (const rule of agent.permissions ?? [
            { action: "*", resource: "*", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
          ]) {
            entry.permissions.push(rule)
          }
        })
      }
    })

    await applyAgentModels(ctx, sheetText, catalog)

    // Poteto Mode is controlling only for sessions that activated a pstack skill
    // (or pstack subagents). Every other session keeps OpenCode's default
    // behavior, so the plugin does not leak routing into unrelated work.
    await ctx.session.hook("context", async (event) => {
      const agent = String(event.agent ?? "")
      const isPstackAgent = agent.startsWith("pstack:")
      const mode = await getMode(event.sessionID)
      const currentSheet = mode ? readSheet(sheetPath) : ""
      const hookOn = hookEnabled(currentSheet)
      if (event.tools && (!mode || isPstackAgent || !hookOn)) delete event.tools[TODO_TOOL]
      if (!isPstackAgent && !mode) return

      const parts = [MAPPING]
      // The main session (a mode is set) gets the controlling methodology for
      // `/poteto-mode`, or routing for the other pstack skills, plus the sheet.
      if (mode && !isPstackAgent && hookOn) {
        parts.push(mode === POTETO ? METHODOLOGY : MANDATE, todoMapping(event.tools))
        if (mode === POTETO) {
          const observation = await observeWorkspace?.(event.sessionID)
          if (observation) parts.push(`<pstack_workspace_observation>\n${observation}\n</pstack_workspace_observation>`)
        }
        const normalized = currentSheet.trim() ? normalizeSheet(currentSheet, catalog) : ""
        if (normalized) parts.push(`<pstack_model_sheet>\n${normalized.trim()}\n</pstack_model_sheet>`)
      }
      const text = parts.filter(Boolean).join("\n\n")
      if (text) event.system.push({ type: "text", text })
    })

    // Keep the mode active across compaction: the summary must record that pstack
    // is the active methodology so the post-compaction transcript stays grounded.
    await ctx.session.hook("compaction", async (event) => {
      const mode = await getMode(event.sessionID)
      if (!mode) return
      const label = mode === POTETO ? "Poteto Mode (pstack)" : "pstack"
      try {
        if (Array.isArray(event.messages)) {
          event.messages.push({
            type: "synthetic",
            id: `msg_pstack_mode_${Date.now()}`,
            time: { created: Date.now() },
            text: `This session runs under ${label} methodology. Preserve in the summary that this methodology is active and note the current playbook and step.`,
          })
        }
      } catch {
        // The context hook re-injects the methodology after compaction regardless.
      }
    })

    await ctx.session.hook("experimental.model.resolve", async (event) => {
      if (event.kind !== "primary") return
      if (!["pstack:poteto-agent", "pstack:comment-sicko", "pstack:readonly"].includes(event.agent)) return
      const currentSheet = readSheet(sheetPath)
      if (!hookEnabled(currentSheet)) return
      let explicit = false
      try {
        const result = await ctx.session.get({ sessionID: event.sessionID })
        const session = result?.data ?? result
        if (session?.model) {
          if (session.parentID) {
            const parentResult = await ctx.session.get({ sessionID: session.parentID })
            const parent = parentResult?.data ?? parentResult
            explicit = parent?.model !== undefined && !sameModel(parent.model, session.model)
          } else {
            explicit = true
          }
        }
      } catch {}
      if (explicit) return
      const normalized = normalizeSheet(currentSheet, catalog)
      const role =
        event.agent === "pstack:poteto-agent"
          ? roleModel(normalized, "bug-fix", catalog) ?? roleModel(normalized, "feature, refactoring", catalog)
          : roleModel(normalized, "judgment and prose", catalog)
      // The resolve hook may only switch to a model from the same provider.
      if (role && role.providerID === event.model.providerID) event.model = role
    })
  },
}
