# OpenCode mapping for pstack

The plugin injects this mapping into every session. pstack content is vendored unchanged and translated into an OpenCode cache before registration. The mapping covers what cannot be translated mechanically.

## Tools

| pstack (Cursor, Claude Code names) | OpenCode |
| --- | --- |
| `Read` | `read` |
| `Bash` | `shell` |
| `Grep` | `grep` |
| `Glob` | `glob` |
| `Edit` | `edit` |
| `Write` | `write` |
| `WebFetch` | `webfetch` |
| `Skill` | `skill` |
| `AskUserQuestion` | `question` |
| `TaskCreate`, `TaskUpdate`, `TodoWrite` | `todowrite` |

## Subagents

`subagent` takes `agent`, `description`, `prompt`, and optional `model` or `sessionID`. There is no `background` field. Every subagent runs in the background.

| Claude field | OpenCode |
| --- | --- |
| `subagent_type: "pstack:poteto-agent"` | `agent: "pstack:poteto-agent"` |
| bare `poteto-agent` | `agent: "pstack:poteto-agent"` |
| `subagent_type: "generalPurpose"` | `agent: "general"` |
| bare `comment-sicko` | `agent: "pstack:comment-sicko"` |
| `readonly: true` | `agent: "pstack:readonly"` |
| `resume` | pass the `sessionID` returned by the earlier call |
| `run_in_background: true` | no field; subagents always run in the background |
| `isolation: "worktree"` | create a git worktree first and name its path in the prompt |
| `environment: "cloud"` | a git worktree; there is no environment field |
| `cloud_base_branch` | the worktree base |
| `model` plus effort | `provider/model#variant`; there is no separate effort field |

`pstack:readonly` and `pstack:comment-sicko` start from `*:deny` and allow only `read`, `grep`, `glob`, and `webfetch`. They cannot edit, write, run shell, ask the user, or spawn a subagent.

## Skills, commands, and translation

- Skill IDs are `pstack-<directory name>`, for example `pstack-how` or `pstack-principle-prove-it-works`.
- Every skill has a slash command with the directory name, for example `/how` or `/poteto-mode`.
- A command attaches its skill to the prompt directly.
- `disable-model-invocation: true` maps to `autoinvoke: false`.
- Registered content comes from `~/.local/share/opencode/pstack-translated/<key>`. The cache includes playbooks and references, so relative reads are translated too.
- `/loop` is an adapter skill that creates an OpenCode automation with a predicate.

## Models

- The model sheet is `~/.config/opencode/pstack-models.md`.
- `/setup-pstack` reads `ctx.model.list()`, injects a catalog with cost, context, status, and the current model, then writes a normalized sheet.
- It applies the budget variant to every role: `large` uses xhigh for code, `medium` high, `small` medium, and each ref takes the nearest available variant at or below the target.
- Missing roles are filled. Cursor slugs and unknown refs are rejected. A generated sheet that still says `inherit-parent` is replaced with real refs.
- `# session hook: off` disables routing and sheet injection.
- The context hook sets the subagent request model from the sheet unless the session already has an explicit model.
- OpenCode accepts `provider/model` or `provider/model#variant` in the `subagent` model field.

## Paths

| Cursor | OpenCode |
| --- | --- |
| `.cursor/rules/*.mdc` model sheet | `~/.config/opencode/pstack-models.md` |
| `.cursor/rules/*.mdc` general rules | `AGENTS.md` |
| `.cursor/skills/` (project) | `.opencode/skills/` |
| `.cursor/skills/` (user) | `~/.config/opencode/skills/` |
| `.cursor/agents/` | `.opencode/agents/` |
| `.cursor/commands/` | `.opencode/commands/` |
| `.cursor/settings.json` | `opencode.jsonc` |
| `.cursor/automations/` | an OpenCode automation, no file path |
| `~/.cursor/plugins/` | the translated pstack root |
| `~/.cursor/projects/<slug>/agent-transcripts/` | OpenCode sessions, see below |

## Transcripts

Never read `~/.cursor/projects` or `~/.claude/projects` on OpenCode. Use one of:

- `opencode session list --format json`, then `opencode session export <id> > <file>`.
- `GET /api/experimental/session/{sessionID}/export` with the server password.
- The live conversation in context when the history is short.

The export holds every message, including compacted turns. Redirect it to a file, because a pipe can cut it short. Add `--sanitize` to redact sensitive data.

## Automations

Cursor's `/loop` becomes an OpenCode automation. Create it with an `every` or `cron` trigger and a prompt action carrying the predicate. Delete it when the predicate passes. Exact wake semantics differ from Cursor.
