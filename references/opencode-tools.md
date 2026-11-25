# OpenCode mapping for pstack

This file is the runtime mapping the plugin injects into every session. It exists so the vendored pstack skills and agents stay byte-identical to Lauren Tan's originals.

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
| `Task`, `Agent` | `subagent` |
| `AskUserQuestion` | `question` |
| `TaskCreate`, `TaskUpdate`, `TodoWrite` | `todowrite` |
| `run_in_background: true` | `subagent` with `background: true` |

## Skills and commands

- Skill IDs are `pstack-<directory name>`, for example `pstack-how` or `pstack-principle-prove-it-works`.
- Every skill also has a slash command with the directory name, for example `/how` or `/poteto-mode`.
- A command attaches its skill to the prompt directly, so the model does not have to discover it.
- `disable-model-invocation: true` maps to `autoinvoke: false`, which hides the skill from the automatic list while keeping it loadable.

## Subagents

- `pstack:poteto-agent` and `pstack:comment-sicko` are registered as subagents.
- The `subagent` tool takes `agent`, `prompt`, `description`, and optional `background`.
- OpenCode denies the `question` tool to these subagents, the same way a Claude Code subagent cannot ask the user.

## Models

- The model sheet is `~/.config/opencode/pstack-models.md`.
- OpenCode accepts `provider/model` or `provider/model#variant` in the `subagent` model field.
- There is no separate reasoning-effort field. Use a variant when the provider exposes one, otherwise omit the suffix. This is the one documented parity gap.

## Paths

- The vendored pstack root is the `vendor/pstack` directory next to this plugin.
- Cursor paths are not used. The plugin injects its root path into every session so agents can find `poteto-mode/SKILL.md` without searching `~/.cursor`.
