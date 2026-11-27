import { join } from "node:path"
import { LOOP_COMMAND, LOOP_SKILL } from "./adapter.js"
import { registerCompliance } from "./compliance.js"
import agents from "./data/agents.js"
import commands from "./data/commands.js"
import skills from "./data/skills.js"
import { registerDispatch } from "./dispatch.js"
import { MANDATE, mapping, methodology } from "./overlay.js"
import { modelsPath } from "./paths.js"
import { MODEL_PROPOSAL_TOOL, registerModelSetup, SETUP_SKILL } from "./setup.js"
import { SETUP_SKILL_BODY } from "./setup-skill.js"
import { hookEnabled, readSheet } from "./sheet.js"
import { registerTodos, TODO_TOOL, todoMapping } from "./todos.js"
import { ensureTranslated, translateText } from "./translate.js"
import { TODO_KEY, workflowSources } from "./workflow.js"
import { registerWorktreeWorker, WORKTREE_WORKER_TOOL } from "./worktree-worker.js"

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

const MODE_KEY = "pstack-active"
const POTETO = "pstack-poteto-mode"
const EXIT = "poteto-mode-exit"

function removeModeSnapshot(system) {
  // OpenCode can keep the initial instruction entries in the request's system snapshot.
  const owned = new RegExp(`<context key="(?:${MODE_KEY}|${TODO_KEY})">\\r?\\n[\\s\\S]*?\\r?\\n</context>`, "g")
  for (const part of system ?? []) {
    if (part.type === "text") part.text = part.text.replace(owned, "")
  }
}

export default {
  id: "pstack",

  async setup(ctx) {
    const sheetPath = typeof ctx.options?.modelsPath === "string" ? ctx.options.modelsPath : modelsPath
    const setup = await registerModelSetup(ctx, sheetPath)

    const entries = ctx.session.instructions?.entry
    const activeModes = new Map()
    const setMode = async (sessionID, skillId) => {
      activeModes.set(sessionID, skillId)
      try {
        await entries?.put?.({ sessionID, key: MODE_KEY, value: skillId })
      } catch {
        // experimental instruction entries are a durability bonus, not a dependency
      }
    }
    const getMode = async (sessionID) => {
      try {
        if (entries?.list) {
          const result = await entries.list({ sessionID })
          const value = (result?.data ?? result).find((item) => item.key === MODE_KEY)?.value
          if (value) activeModes.set(sessionID, value)
          else activeModes.delete(sessionID)
          return value
        }
      } catch {}
      return activeModes.get(sessionID)
    }
    const exitMode = async (sessionID) => {
      if (entries?.list) {
        const result = await entries.list({ sessionID })
        const saved = result?.data ?? result
        for (const key of [TODO_KEY, MODE_KEY]) {
          if (saved.some((item) => item.key === key)) await entries.remove({ sessionID, key })
        }
      }
      activeModes.delete(sessionID)
      setup.cancel(sessionID)
      await ctx.session.synthetic({
        sessionID,
        text: "Poteto Mode is off for this session. Continue with normal OpenCode behavior. Run /poteto-mode to start a new workflow.",
      })
    }

    const translated = ensureTranslated()
    const MAPPING = mapping(translated.root, sheetPath)
    const METHODOLOGY = methodology(translated.root)
    const allSkills = [...skills, { ...LOOP_SKILL, path: join(translated.root, LOOP_SKILL.source) }]
    const allCommands = [...commands, LOOP_COMMAND]
    const activeTodoMode = async (sessionID) => hookEnabled(readSheet(sheetPath)) ? getMode(sessionID) : undefined
    const sources = workflowSources(translated.root, skills)
    await registerTodos(ctx, activeTodoMode, sources)
    await registerWorktreeWorker(ctx, activeTodoMode)
    await registerDispatch(ctx, { active: activeTodoMode, sources, skills: allSkills, sheet: () => readSheet(sheetPath) })
    const observeWorkspace = await registerCompliance(ctx, async (sessionID) => (await activeTodoMode(sessionID)) === POTETO, sources)

    await ctx.skill.transform((editor) => {
      for (const skill of allSkills) {
        if (editor.get(skill.id)) continue
        editor.add({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          path: join(translated.root, skill.source),
          content: skill.id === SETUP_SKILL ? SETUP_SKILL_BODY : translateText(skill.content, translated.root),
          ...(skill.autoinvoke === undefined ? {} : { autoinvoke: skill.autoinvoke }),
        })
      }
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: EXIT,
        description: "Exit Poteto Mode and restore normal OpenCode behavior for this session.",
        execute: ({ sessionID }) => exitMode(sessionID),
      })
      for (const command of allCommands) {
        editor.add({
          name: command.name,
          description: command.description,
          execute: async (input) => {
            if (command.skillId === SETUP_SKILL) return setup.command(input)
            if ((await getMode(input.sessionID)) !== POTETO) {
              await setMode(input.sessionID, command.skillId)
            }
            const attached = input.prompt.skills ?? []
            const already = attached.some((item) => item.id === command.skillId)
            await ctx.session.prompt({
              sessionID: input.sessionID,
              text: input.prompt.text.trim() || `Run the ${command.name} skill.`,
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

    // Poteto Mode is controlling only for sessions that activated a pstack skill
    // (or pstack subagents). Every other session keeps OpenCode's default
    // behavior, so the plugin does not leak routing into unrelated work.
    await ctx.session.hook("context", async (event) => {
      const agent = String(event.agent ?? "")
      const isPstackAgent = agent.startsWith("pstack:")
      const mode = await getMode(event.sessionID)
      const currentSheet = mode ? readSheet(sheetPath) : ""
      const hookOn = hookEnabled(currentSheet)
      if (event.tools && (isPstackAgent || !setup.isActive(event.sessionID))) delete event.tools[MODEL_PROPOSAL_TOOL]
      if (event.tools && (!mode || isPstackAgent || !hookOn)) delete event.tools[TODO_TOOL]
      if (event.tools && (!mode || isPstackAgent || !hookOn || !event.tools.subagent)) delete event.tools[WORKTREE_WORKER_TOOL]
      if (!mode) removeModeSnapshot(event.system)
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
        if (currentSheet.trim()) parts.push(`<pstack_model_sheet>\n${currentSheet.trim()}\n</pstack_model_sheet>`)
      }
      const text = parts.filter(Boolean).join("\n\n")
      if (text) event.system.push({ type: "text", text })
    })

    // Keep the mode active across compaction: the summary must record that pstack
    // is the active methodology so the post-compaction transcript stays grounded.
    await ctx.session.hook("compaction", async (event) => {
      const mode = await getMode(event.sessionID)
      if (!mode) {
        removeModeSnapshot(event.system)
        return
      }
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

  },
}
