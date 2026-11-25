import { join } from "node:path"
import agents from "./data/agents.js"
import commands from "./data/commands.js"
import skills from "./data/skills.js"
import { MANDATE, MAPPING, SETUP_OVERRIDE, modelsBlock } from "./overlay.js"
import { modelsPath, portable, vendorRoot } from "./paths.js"
import { ensureModelSheet } from "./setup.js"

const SETUP = "setup-pstack"

function commandText(command, text, sheetPath) {
  const task = text.trim() || `Run the ${command.name} skill.`
  if (command.name !== SETUP) return task
  const sheet = ensureModelSheet(sheetPath)
  const state = sheet.created
    ? `A default model sheet was written to ${portable(sheet.path)}.`
    : `The model sheet already exists at ${portable(sheet.path)}.`
  return `${SETUP_OVERRIDE}\n\n${state}\n\n${task}`
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
              text: commandText(command, input.prompt.text, sheetPath),
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
      for (const agent of agents) {
        if (editor.get(agent.id)) continue
        editor.update(agent.id, (entry) => {
          entry.mode = "subagent"
          entry.description = agent.description
          entry.system = agent.system
          entry.permissions.push({ action: "question", resource: "*", effect: "deny" })
        })
      }
    })

    await ctx.session.hook("context", async (event) => {
      let root = true
      try {
        const session = await ctx.session.get({ sessionID: event.sessionID })
        root = !session?.parentID
      } catch {}
      const parts = [MAPPING, root ? MANDATE : "", root ? modelsBlock() : ""].filter(Boolean)
      if (parts.length) event.system.push({ type: "text", text: parts.join("\n\n") })
    })
  },
}
