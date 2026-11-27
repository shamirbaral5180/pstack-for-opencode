import { modelsPath, portable, vendorRoot } from "./paths.js"
import { WORKTREE_WORKER_TOOL } from "./worktree-worker.js"

export function mapping(root, sheetPath = modelsPath) {
  const skills = portable(root)
  const models = portable(sheetPath)
  return `<pstack_opencode_mapping>
pstack content is installed unmodified from Lauren Tan's original pstack. Use this mapping only for tools, models, paths, and subagent fields.

Tools: Read -> read. Bash -> shell. Grep -> grep. Glob -> glob. Edit -> edit. Write -> write. WebFetch -> webfetch. Skill -> skill. AskUserQuestion -> question.

Subagents: call \`subagent\` with \`agent\`, \`description\`, \`prompt\`, and optional \`model\` or \`sessionID\`. There is no \`background\` field. Every subagent runs in the background.
- \`subagent_type\` becomes \`agent\`.
- \`generalPurpose\` becomes \`agent: "general"\`.
- A bare \`poteto-agent\` or \`comment-sicko\` becomes \`pstack:poteto-agent\` or \`pstack:comment-sicko\`.
- \`readonly: true\` becomes \`agent: "pstack:readonly"\`.
- \`resume\` means pass the \`sessionID\` returned by the earlier call.
- \`run_in_background: true\` adds no field. Omit it.
- For a worker assigned its own worktree by the workflow (including translated cloud workers), create or select a registered OpenCode worktree, then call \`${WORKTREE_WORKER_TOOL}\` with its absolute \`directory\` and the same agent, description, prompt, and optional model. If the tool is unavailable or placement fails, report the worker as blocked; do not fall back to native \`subagent\` in the parent checkout.
- \`cloud_base_branch\` is the worktree base.
- Ordinary delegation without a worktree still uses native \`subagent\`.
- For a scoped code handoff or Comment Sicko review, omit \`model\` to use that role's saved choice. Do not confuse the judgment role with the implementation role. Pass other workflow assignments as \`model: "provider/model#variant"\` (leave off \`#variant\` for a base ref). A different model explicitly named by the user takes precedence. For \`inherit-parent\` or \`auto\`, omit \`model\` and keep the workflow's agent and permissions. Keep panel order and alias seats; never use an alias as Arena's cross-judge. Report any assignment that is blocked; do not rewrite the sheet.

Skills: pass the registered ID or exact skill name to \`skill\`; use \`skill\` for a named skill rather than guessing a playbook filename. A slash command such as \`/poteto-mode\` already attaches its skill to the message. Skill files live under \`${skills}/skills\`.

Cursor's control-ui, control-cli, and deslop are not bundled. Use the matching project verification or review tooling when it exists. If a required capability is unavailable, report the blocked step and what could not be verified; do not mark it complete.

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

export function methodology(root) {
  return `<pstack_poteto_mode>
Poteto Mode is the controlling engineering methodology for this session. OpenCode's environment, tools, permissions, and security rules still apply unchanged.
The user can end it with \`/poteto-mode-exit\`.

Before implementation, use the Playbooks section of \`${portable(root)}/skills/poteto-mode/SKILL.md\` to select the route for the whole task, not just its first symptom. Use the attached skill or read the file if the attachment is no longer in context. That skill owns routing, non-negotiables, principles, and subagent rules.

Read the selected playbook or routed workflow skill in full before following its steps. It is the single source of truth for the task's steps, including any conditions or exceptions. If you cannot load it, stop and report the failure instead of proceeding without it.
</pstack_poteto_mode>`
}
