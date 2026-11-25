import { join } from "node:path"
import { LOOP_COMMAND, LOOP_SKILL } from "./adapter.js"
import agents from "./data/agents.js"
import commands from "./data/commands.js"
import skills from "./data/skills.js"
import { currentModelRef, formatCatalog, modelCatalog } from "./models.js"
import { MANDATE, SETUP_OVERRIDE, mapping } from "./overlay.js"
import { modelsPath, portable } from "./paths.js"
import { ensureModelSheet } from "./setup.js"
import { SETUP_SKILL_BODY } from "./setup-skill.js"
import { hookEnabled, normalizeSheet, readSheet, roleModel } from "./sheet.js"
import { ensureTranslated, translateText } from "./translate.js"

const SETUP = "setup-pstack"

const DENY = { action: "*", resource: "*", effect: "deny" }
const ALLOW = (action) => ({ action, resource: "*", effect: "allow" })
const READ_ONLY = [DENY, ALLOW("read"), ALLOW("grep"), ALLOW("glob"), ALLOW("webfetch"), { action: "question", resource: "*", effect: "deny" }]
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
    const translated = ensureTranslated()
    const MAPPING = mapping(translated.root)
    const allSkills = [...skills, { ...LOOP_SKILL, path: join(translated.root, LOOP_SKILL.source) }]
    const allCommands = [...commands, LOOP_COMMAND]

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

    await ctx.session.hook("context", async (event) => {
      const currentSheet = readSheet(sheetPath)
      if (!hookEnabled(currentSheet)) {
        event.system.push({ type: "text", text: MAPPING })
        return
      }
      let root = true
      let session
      try {
        const result = await ctx.session.get({ sessionID: event.sessionID })
        session = result?.data ?? result
        root = !session?.parentID
      } catch {}
      const normalized = currentSheet.trim() ? normalizeSheet(currentSheet, catalog) : ""
      const parts = [MAPPING, root ? MANDATE : ""]
      if (root && normalized) parts.push(`<pstack_model_sheet>\n${normalized.trim()}\n</pstack_model_sheet>`)
      const text = parts.filter(Boolean).join("\n\n")
      if (text) event.system.push({ type: "text", text })
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
