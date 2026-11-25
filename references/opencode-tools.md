# OpenCode mapping for pstack

The plugin injects this mapping into every session. It exists so the vendored pstack skills and agents stay byte-identical to Lauren Tan's originals.

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

`subagent` takes `agent`, `description`, `prompt`, and optional `background`, `sessionID`, or `model`.

| Claude field | OpenCode |
| --- | --- |
| `subagent_type: "pstack:poteto-agent"` | `agent: "pstack:poteto-agent"` |
| `subagent_type: "generalPurpose"` | `agent: "general"` |
| `subagent_type: "pstack:comment-sicko"` | `agent: "pstack:comment-sicko"` |
| `readonly: true` | `agent: "pstack:readonly"` |
| `resume` | pass the `sessionID` returned by the earlier `subagent` call |
| `run_in_background: true` | `background: true` |
| `isolation: "worktree"` | no field; create the worktree first and name its path in the prompt |
| `model` plus effort | `provider/model#variant`; there is no separate effort field |

`pstack:readonly` is an adapter agent, not a vendored one. It denies `edit`, `write`, `shell`, and `question`, because OpenCode has no `readonly` boolean.

## Skills and commands

- Skill IDs are `pstack-<directory name>`, for example `pstack-how` or `pstack-principle-prove-it-works`.
- Every skill also has a slash command with the directory name, for example `/how` or `/poteto-mode`.
- A command attaches its skill to the prompt directly, so the model does not have to discover it.
- `disable-model-invocation: true` maps to `autoinvoke: false`, which hides the skill from the automatic list while keeping it loadable.

## Models

- The model sheet is `~/.config/opencode/pstack-models.md`.
- `/setup-pstack` reads the real configured models from `ctx.model.list()`, injects them as a catalog, and writes refs such as `opencode/tidepool-alpha-free#high`.
- Panel roles get a comma-separated list. The setup command picks distinct providers for the default sheet when the catalog has them.
- OpenCode accepts `provider/model` or `provider/model#variant` in the `subagent` model field. There is no separate reasoning-effort field.

## Paths

| Cursor | OpenCode |
| --- | --- |
| `.cursor/rules/*.mdc` model sheet | `~/.config/opencode/pstack-models.md` |
| `.cursor/rules/*.mdc` general rules | `AGENTS.md` |
| `.cursor/skills/` (project) | `.opencode/skills/` |
| `.cursor/skills/` (user) | `~/.config/opencode/skills/` |
| `.cursor/agents/` | `.opencode/agent/` |
| `.cursor/commands/` | `.opencode/command/` |
| `.cursor/settings.json` | `opencode.jsonc` |
| `.cursor/automations/` | an OpenCode automation, no file path |
| `~/.cursor/plugins/` | the vendored pstack root next to this plugin |
| `~/.cursor/projects/<slug>/agent-transcripts/` | OpenCode sessions, see below |

## Transcripts

Never read `~/.cursor/projects` or `~/.claude/projects` on OpenCode. They either do not exist or hold another harness's history.

Use one of:

- `opencode session list --format json`, then `opencode session export <id> > <file>`.
- `GET /api/experimental/session/{sessionID}/export` with the server password.
- The live conversation in context when the history is short.

The export holds every message, including compacted turns. Redirect it to a file, because a pipe can cut it short. Add `--sanitize` to redact sensitive data.
