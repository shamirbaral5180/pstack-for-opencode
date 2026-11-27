import { randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { currentModelRef, formatCatalog, modelCatalog } from "./models.js"
import { portable } from "./paths.js"
import { availableRef, isModelAlias, parseSheet, proposeSheet, recommendedSheet } from "./sheet.js"

export const SETUP_SKILL = "pstack-setup-pstack"
export const MODEL_PROPOSAL_TOOL = "pstack_propose_models"

function savedSheet(path) {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

function saveSheet(path, text) {
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temp, text, { flag: "wx" })
  try {
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
}

export async function registerModelSetup(ctx, path) {
  const sessions = new Map()
  const notice = (sessionID, text) => ctx.session.synthetic({ sessionID, text })
  const cancel = (sessionID) => sessions.delete(sessionID)

  if (ctx.tool?.transform) await ctx.tool.transform((editor) => editor.add({
    name: MODEL_PROPOSAL_TOOL,
    description: "Preview pstack model preferences without saving them. Pass only the budget and roles the user wants changed. The user must run the exact confirmation command to save.",
    options: { codemode: false },
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        budget: { type: "string", enum: ["large", "medium", "small"] },
        roles: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    execute: async (input, { sessionID, agent }) => {
      const state = sessions.get(sessionID)
      if (!state?.catalog || agent?.startsWith("pstack:")) throw new Error("Start /setup-pstack in this session before proposing changes.")
      const text = proposeSheet(state.saved, state.catalog, state.current, input)
      if (text === state.saved) {
        delete state.proposal
        return { content: "No changes to save. The existing model sheet is unchanged." }
      }
      const token = randomBytes(8).toString("hex")
      const preview = `Proposed model sheet for ${portable(path)} (not saved):\n\n${text}\nTo save this exact proposal, run \`/setup-pstack apply ${token}\`. To discard it, run \`/setup-pstack cancel\` or do nothing.`
      state.proposal = { token, text, preview }
      return { content: preview }
    },
  }))

  return {
    cancel,
    isActive: (sessionID) => !!sessions.get(sessionID)?.catalog,
    async command({ sessionID, prompt, delivery }) {
      const task = prompt.text.trim()
      if (/^(apply|preview|cancel)(?:\s|$)/.test(task)) {
        const state = sessions.get(sessionID)
        if (task === "cancel") {
          cancel(sessionID)
          return notice(sessionID, "Model setup canceled. No preferences were changed.")
        }
        if (task === "preview") return notice(sessionID, state?.proposal?.preview ?? "No pending model proposal. Run /setup-pstack first.")
        const token = /^apply ([a-f0-9]{16})$/.exec(task)?.[1]
        if (!token || token !== state?.proposal?.token) {
          return notice(sessionID, "No matching model proposal in this session. Run /setup-pstack preview to see the pending proposal.")
        }
        if (savedSheet(path) !== state.saved) {
          cancel(sessionID)
          return notice(sessionID, "The model sheet changed after this proposal. Nothing was saved. Rerun /setup-pstack to review current preferences.")
        }
        saveSheet(path, state.proposal.text)
        cancel(sessionID)
        return notice(sessionID, `Saved pstack model preferences to ${portable(path)}.`)
      }

      const saved = savedSheet(path)
      const state = { saved }
      sessions.set(sessionID, state)
      const [catalog, current] = await Promise.all([modelCatalog(ctx), currentModelRef(ctx, sessionID)])
      if (sessions.get(sessionID) !== state) return
      Object.assign(state, { catalog, current })
      const unavailable = Object.entries(parseSheet(saved ?? "").roles).flatMap(([role, value]) =>
        value.split(",").map((ref) => ref.trim()).filter((ref) => !isModelAlias(ref) && !availableRef(ref, catalog))
          .map((ref) => `- ${role}: ${ref || "(empty)"}`),
      )
      const context = [
        `Model sheet: ${portable(path)}. Setup has not written anything.`,
        formatCatalog(catalog, current),
        saved === undefined
          ? `No model sheet is saved. Suggested starting choices:\n\n${recommendedSheet(catalog, current)}`
          : `Current saved choices (preserve unless changed explicitly):\n\n${saved}`,
        unavailable.length && `Unavailable or unrecognized saved choices (keep unless the user chooses a replacement):\n${unavailable.join("\n")}`,
        task || "Run the setup-pstack skill.",
      ]
      const skills = prompt.skills ?? []
      await ctx.session.prompt({
        ...prompt, sessionID, delivery,
        text: context.filter(Boolean).join("\n\n"),
        skills: skills.some(({ id }) => id === SETUP_SKILL) ? skills : [{ id: SETUP_SKILL }, ...skills],
      })
    },
  }
}
