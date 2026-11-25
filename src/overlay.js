import { readFileSync, statSync } from "node:fs"
import { modelsPath, portable, vendorRoot } from "./paths.js"

const vendor = portable(vendorRoot)
const models = portable(modelsPath)

export const MAPPING = `<pstack_opencode_mapping>
pstack content is installed unmodified from Lauren Tan's original pstack. Use this mapping only for tools, models, paths, and subagent fields.

Tools: Read -> read. Bash -> shell. Grep -> grep. Glob -> glob. Edit -> edit. Write -> write. WebFetch -> webfetch. Skill -> skill. AskUserQuestion -> question. TaskCreate/TaskUpdate/TodoWrite -> todowrite.

Subagents: call \`subagent\` with \`agent\`, \`description\`, \`prompt\`, and optional \`background\`, \`sessionID\`, or \`model\`.
- A Claude \`subagent_type\` becomes \`agent\`.
- \`generalPurpose\` becomes \`agent: "general"\`.
- \`readonly: true\` becomes \`agent: "pstack:readonly"\`, which denies edit, write, and shell.
- \`resume\` means pass the \`sessionID\` that the earlier \`subagent\` call returned.
- \`run_in_background: true\` becomes \`background: true\`.
- \`isolation: "worktree"\` has no field. Create the worktree first, then name its path in the prompt.
- A model with effort becomes \`provider/model#variant\`. There is no separate effort field.

Skills: load a skill with the skill tool and an id such as \`pstack-how\` or \`pstack-architect\`. A slash command such as \`/poteto-mode\` already attaches its skill to the message. Skill files live under \`${vendor}/skills\`.

Paths:
- \`.cursor/rules/*.mdc\` model sheet becomes \`${models}\`. General rules go in \`AGENTS.md\`.
- \`.cursor/skills/\` becomes \`.opencode/skills/\` in a project, or \`~/.config/opencode/skills/\` for the user.
- \`.cursor/agents/\` becomes \`.opencode/agent/\`.
- \`.cursor/commands/\` becomes \`.opencode/command/\`.
- \`.cursor/settings.json\` becomes \`opencode.jsonc\`.
- \`.cursor/automations/\` becomes an OpenCode automation. There is no file path.
- \`~/.cursor/plugins/\` becomes \`${vendor}\`.
- \`~/.cursor/projects/<slug>/agent-transcripts/\` has no OpenCode equivalent. Never read it. Use \`opencode session list --format json\` and \`opencode session export <id>\`, or GET /api/experimental/session/{id}/export.
</pstack_opencode_mapping>`

export const MANDATE = `<pstack_routing>
pstack is installed. Invoke the \`pstack-poteto-mode\` skill and follow it when a task touches more than one file, changes a signature other files call, involves a design or architecture choice, or is a bug whose cause is not known or a performance issue. For a specific intent, load that skill directly, such as \`pstack-tdd\`, \`pstack-architect\`, \`pstack-how\`, \`pstack-why\`, \`pstack-arena\`, or \`pstack-interrogate\`. For a contained change to one file with an obvious test, a question, or a one-line edit, work directly and verify on the real artifact. The user's entry point is the \`/poteto-mode\` command. User instructions take precedence.
</pstack_routing>`

export const SETUP_OVERRIDE = `<pstack_opencode_setup>
OpenCode setup override. Write the model sheet to \`${models}\`, not to \`~/.cursor/rules/pstack-models.mdc\`. Write plain Markdown, not an \`.mdc\` rule with \`alwaysApply\`.

Use only the refs in the \`pstack_model_catalog\` below. They are the models actually configured in this OpenCode instance. Ask the user with the \`question\` tool which model to use for each role, offering those exact refs plus \`inherit-parent\`. Write real refs for the code, prose, and judgment roles. For each panel role, write a comma-separated list whose entries come from different providers when the catalog has them. Never write a ref that is not in the catalog. Skip Cursor-only steps, such as Bugbot, Custom Modes, and Cursor automations, with a one-line note. Keep the upstream sheet format otherwise: a \`# defaults: 3\` line, a \`# budget\` line, and one line per role.
</pstack_opencode_setup>`

let cache = { mtimeMs: -1, text: "" }

export function modelsBlock() {
  try {
    const stat = statSync(modelsPath)
    if (stat.mtimeMs !== cache.mtimeMs) {
      cache = { mtimeMs: stat.mtimeMs, text: readFileSync(modelsPath, "utf8").trim() }
    }
    if (!cache.text) return ""
    return `<pstack_model_sheet>\n${cache.text}\n</pstack_model_sheet>`
  } catch {
    return ""
  }
}
