import { readFileSync, statSync } from "node:fs"
import { modelsPath, portable, vendorRoot } from "./paths.js"

const vendor = portable(vendorRoot)
const models = portable(modelsPath)

export const MAPPING = `<pstack_opencode_mapping>
pstack content is installed unmodified from Lauren Tan's original pstack. Use this mapping only for tools, models, and paths.

Tools: Read -> read. Bash -> shell. Grep -> grep. Glob -> glob. Edit -> edit. Write -> write. WebFetch -> webfetch. Skill -> skill. Task/Agent -> subagent. AskUserQuestion -> question. TaskCreate/TaskUpdate/TodoWrite -> todowrite.

Skills: load a skill with the skill tool and an id such as \`pstack-how\` or \`pstack-architect\`. A slash command such as \`/poteto-mode\` already attaches its skill to the message. Skill files live under \`${vendor}/skills\`.

Subagents: the subagent tool takes \`agent: "pstack:poteto-agent"\` or \`agent: "pstack:comment-sicko"\`, plus \`prompt\`, \`description\`, and optional \`background: true\`. There is no separate effort field. When a model id accepts a variant, use \`provider/model#variant\`; otherwise omit the effort suffix.

Paths: the model sheet is \`${models}\`. Never read or write \`~/.cursor\` paths. Ignore instructions to open Cursor Custom Modes, Bugbot, or Cursor automations; use an available OpenCode feature or an external integration instead.
</pstack_opencode_mapping>`

export const MANDATE = `<pstack_routing>
pstack is installed. Invoke the \`pstack-poteto-mode\` skill and follow it when a task touches more than one file, changes a signature other files call, involves a design or architecture choice, or is a bug whose cause is not known or a performance issue. For a specific intent, load that skill directly, such as \`pstack-tdd\`, \`pstack-architect\`, \`pstack-how\`, \`pstack-why\`, \`pstack-arena\`, or \`pstack-interrogate\`. For a contained change to one file with an obvious test, a question, or a one-line edit, work directly and verify on the real artifact. The user's entry point is the \`/poteto-mode\` command. User instructions take precedence.
</pstack_routing>`

export const SETUP_OVERRIDE = `<pstack_opencode_setup>
OpenCode setup override. Write the model sheet to \`${models}\`, not to \`~/.cursor/rules/pstack-models.mdc\`. Write plain Markdown, not an \`.mdc\` rule with \`alwaysApply\`.

Detect the configured models with the \`models\` tool and the OpenCode configuration. Only write a model id you confirmed is available. A role may use \`inherit-parent\` or \`auto\`. Skip Cursor-only steps, such as Bugbot, Custom Modes, and Cursor automations, with a one-line note. Keep the upstream sheet format otherwise: a \`# defaults: 3\` line, a \`# budget\` line, and one line per role.
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
