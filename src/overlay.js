import { readFileSync, statSync } from "node:fs"
import { modelsPath, portable, vendorRoot } from "./paths.js"

const models = portable(modelsPath)

export function mapping(root) {
  const skills = portable(root)
  return `<pstack_opencode_mapping>
pstack content is installed unmodified from Lauren Tan's original pstack. Use this mapping only for tools, models, paths, and subagent fields.

Tools: Read -> read. Bash -> shell. Grep -> grep. Glob -> glob. Edit -> edit. Write -> write. WebFetch -> webfetch. Skill -> skill. AskUserQuestion -> question. TaskCreate/TaskUpdate/TodoWrite -> todowrite.

Subagents: call \`subagent\` with \`agent\`, \`description\`, \`prompt\`, and optional \`model\` or \`sessionID\`. There is no \`background\` field. Every subagent runs in the background.
- \`subagent_type\` becomes \`agent\`.
- \`generalPurpose\` becomes \`agent: "general"\`.
- A bare \`poteto-agent\` or \`comment-sicko\` becomes \`pstack:poteto-agent\` or \`pstack:comment-sicko\`.
- \`readonly: true\` becomes \`agent: "pstack:readonly"\`.
- \`resume\` means pass the \`sessionID\` returned by the earlier call.
- \`run_in_background: true\` adds no field. Omit it.
- \`environment: "cloud"\` has no field. Create a worktree and name its absolute path in the prompt.
- \`cloud_base_branch\` is the worktree base.
- \`isolation: "worktree"\` has no field. Create the worktree first.
- A model with effort becomes \`provider/model#variant\`.

Skills: load a skill with the skill tool and an id such as \`pstack-how\` or \`pstack-architect\`. A slash command such as \`/poteto-mode\` already attaches its skill to the message. Skill files live under \`${skills}/skills\`.

Automations: Cursor's \`/loop\` becomes an OpenCode automation. Create it with the automation tool, trigger \`every\` or \`cron\`, action \`prompt\` with the predicate check, and delete it when the predicate passes.

Paths:
- \`.cursor/rules/*.mdc\` model sheet becomes \`${models}\`. General rules go in \`AGENTS.md\`.
- \`.cursor/skills/\` becomes \`.opencode/skills/\` in a project, or \`~/.config/opencode/skills/\` for the user.
- \`.cursor/agents/\` becomes \`.opencode/agents/\`.
- \`.cursor/commands/\` becomes \`.opencode/commands/\`.
- \`.cursor/settings.json\` becomes \`opencode.jsonc\`.
- \`.cursor/automations/\` becomes an OpenCode automation. There is no file path.
- \`~/.cursor/plugins/\` becomes \`${skills}\`.
- \`~/.cursor/projects/<slug>/agent-transcripts/\` has no OpenCode equivalent. Never read it. Use \`opencode session list --format json\` and \`opencode session export <id>\`, or GET /api/experimental/session/{id}/export.
</pstack_opencode_mapping>`
}

export const MAPPING = mapping(vendorRoot)

export const MANDATE = `<pstack_routing>
pstack is installed. Invoke the \`pstack-poteto-mode\` skill and follow it when a task touches more than one file, changes a signature other files call, involves a design or architecture choice, or is a bug whose cause is not known or a performance issue. For a specific intent, load that skill directly, such as \`pstack-tdd\`, \`pstack-architect\`, \`pstack-how\`, \`pstack-why\`, \`pstack-arena\`, or \`pstack-interrogate\`. For a contained change to one file with an obvious test, a question, or a one-line edit, work directly and verify on the real artifact. The user's entry point is the \`/poteto-mode\` command. User instructions take precedence.
</pstack_routing>`

// The action layer injected into a session once `/poteto-mode` is triggered. It
// does NOT duplicate, summarize, or modify the playbook rules: it only identifies
// the matching playbook, requires reading and following it in full, and fails
// explicitly if the playbook cannot be read. The playbook remains the single
// source of truth; the skill holds the non-negotiables, principles, and subagent
// rules.
export function methodology(root) {
  const skills = portable(root)
  const dir = `${skills}/skills/poteto-mode`
  const playbooks = [
    "investigation", "bug-fix", "perf-issue", "hillclimb", "runtime-forensics",
    "trace-forensics", "feature", "refactoring", "prototype", "visual-parity",
    "authoring-a-skill", "eval", "babysit", "shipping", "autonomous-run",
    "autopilot-full", "autopilot-stack", "session-pickup", "pause-safely",
    "multi-phase-plan", "worktree-cleanup", "opening-a-pr",
  ].join(", ")
  return `<pstack_poteto_mode>
Poteto Mode is the controlling engineering methodology for this session. Where other guidance in this context conflicts, the poteto-mode playbooks control how you plan, delegate, review, and verify work. OpenCode's environment, tools, permissions, and security rules still apply unchanged.

Required before any implementation: match the task to one of the playbooks at \`${dir}/playbooks/\` — ${playbooks} — and read it in full. The playbook is the single source of truth for the task's steps. Copy its steps into the todo list and follow them exactly; do not skip, summarize, or substitute any step.

If you cannot read the matching playbook, stop and report the failure instead of proceeding without it.

The poteto-mode skill at \`${dir}/SKILL.md\` (also attached to your first message) holds the non-negotiables, the principles, and the subagent rules.
</pstack_poteto_mode>`
}

export const SETUP_OVERRIDE = `<pstack_opencode_setup>
OpenCode setup override. Write the model sheet to \`${models}\`, not to \`~/.cursor/rules/pstack-models.mdc\`. Write plain Markdown, not an \`.mdc\` rule with \`alwaysApply\`.

Use only the refs in the \`pstack_model_catalog\` below. They are the models actually configured in this OpenCode instance. Ask the user with the \`question\` tool which model to use for each role, offering those exact refs plus \`inherit-parent\`. Write a real ref for every code, prose, judgment, panel, and swarm role. Add the budget variant to each ref, for example \`#xhigh\` for the large budget. For each panel role, write a comma-separated list whose entries come from different providers when the catalog has them. Never write a Cursor slug or a ref that is not in the catalog. Skip Cursor-only steps, such as Bugbot, Custom Modes, and Cursor automations, with a one-line note. Keep the upstream sheet format otherwise: a \`# defaults: 3\` line, a \`# budget\` line, and one line per role.
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
