import { join } from "node:path"
import agents from "./data/agents.js"
import commands from "./data/commands.js"
import skills from "./data/skills.js"
import { currentModelRef, formatCatalog, modelCatalog } from "./models.js"
import { MANDATE, MAPPING, SETUP_OVERRIDE, modelsBlock } from "./overlay.js"
import { modelsPath, portable, vendorRoot } from "./paths.js"
import { ensureModelSheet } from "./setup.js"

const SETUP = "setup-pstack"

// readonly: true has no OpenCode flag. It maps to this agent, whose deny rules
// come last in the ruleset, where OpenCode's last-match-wins evaluation applies.
const READONLY = {
  id: "pstack:readonly",
  description:
    "Read-only pstack reviewer. Inspects code, diffs, tests, and evidence, and reports findings without modifying files.",
  system:
    "You are a read-only reviewer. Inspect the code, diffs, tests, and evidence you are given. Do not modify files and do not run shell commands. Report findings with file paths and concrete evidence. Do not ask the user questions.",
  permissions: [
    { action: "*", resource: "*", effect: "allow" },
    { action: "edit", resource: "*", effect: "deny" },
    { action: "write", resource: "*", effect: "deny" },
    { action: "shell", resource: "*", effect: "deny" },
    { action: "question", resource: "*", effect: "deny" },
  ],
}

async function commandText(ctx, command, input, sheetPath) {
  const task = input.prompt.text.trim() || `Run the ${command.name} skill.`
  if (command.name !== SETUP) return task

  const catalog = await modelCatalog(ctx)
  const current = await currentModelRef(ctx, input.sessionID)
  const sheet = ensureModelSheet(sheetPath, catalog, current)
  const state = sheet.created
    ? `A model sheet was written to ${portable(sheet.path)} from the configured models.`
    : `The model sheet already exists at ${portable(sheet.path)}.`
  return [SETUP_OVERRIDE, formatCatalog(catalog), state, task].filter(Boolean).join("\n\n")
}

export default {
  id: "pstack",

  async setup(ctx) {
    const sheetPath = typeof ctx.options?.modelsPath === "string" ? ctx.options.modelsPath : modelsPath

    await ctx.skill.transform((editor) => {
      for (const skill of skills) {
        if (editor.get(skill.id)) continue
        editor.add({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          path: join(vendorRoot, skill.source),
          content: skill.content,
          ...(skill.autoinvoke === undefined ? {} : { autoinvoke: skill.autoinvoke }),
        })
      }
    })

    await ctx.command.transform((editor) => {
      for (const command of commands) {
        editor.add({
          name: command.name,
          description: command.description,
          execute: async (input) => {
            const attached = input.prompt.skills ?? []
            const already = attached.some((item) => item.id === command.skillId)
            await ctx.session.prompt({
              sessionID: input.sessionID,
              text: await commandText(ctx, command, input, sheetPath),
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
      for (const agent of [...agents, READONLY]) {
        if (editor.get(agent.id)) continue
        editor.update(agent.id, (entry) => {
          entry.mode = "subagent"
          entry.description = agent.description
          entry.system = agent.system
          for (const rule of agent.permissions ?? [
            { action: "*", resource: "*", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
          ]) {
            entry.permissions.push(rule)
          }
        })
      }
    })

    await ctx.session.hook("context", async (event) => {
      let root = true
      try {
        const result = await ctx.session.get({ sessionID: event.sessionID })
        const session = result?.data ?? result
        root = !session?.parentID
      } catch {}
      const parts = [MAPPING, root ? MANDATE : "", root ? modelsBlock() : ""].filter(Boolean)
      if (parts.length) event.system.push({ type: "text", text: parts.join("\n\n") })
    })
  },
}
