# Parity record

This file records what "the same pstack" means here, and how each claim is checked.

## Content

The vendored snapshot is the original pstack v0.15.48, copied without edits. The local `AGENTS.md` was removed because it is not upstream.

- 1,980 files, 7,929,026 bytes
- 59 vendored skills, 126 skill Markdown files, 338,896 bytes
- 2 vendored agents
- 22 playbooks, 24 principles
- Manifest root: `65133c0e4de2f3e17682f49562f2b94b3489add3299388388c129269c1bacb30`

`npm run verify` hashes every vendored file against `vendor/MANIFEST.json`. A single changed byte fails it.

## Translation

Registered content comes from a translated cache under `~/.local/share/opencode/pstack-translated/<key>`. The vendor tree stays untouched. The cache is rebuilt when the vendor manifest or the translation version changes, and it includes playbooks and references so relative reads are translated too.

Substitutions:

- Cursor paths to OpenCode paths, including `.opencode/skills`, `.opencode/agents`, `.opencode/commands`
- `~/.cursor/rules/pstack-models.mdc` to `~/.config/opencode/pstack-models.md`
- Cursor transcripts to `opencode session list` and `opencode session export`
- `Task`/`Agent` to `subagent`, `AskUserQuestion` to `question`, `TodoWrite` to `todowrite`
- `subagent_type`, `generalPurpose`, bare `poteto-agent` and `comment-sicko`, `readonly`
- `run_in_background` removed because OpenCode subagents always run in the background
- `environment: "cloud"` to git worktree instructions; `cloud_base_branch` to worktree base
- Cursor model defaults to `inherit-parent` or the role sheet
- Arena family rules to provider-prefix rules
- `/loop` to OpenCode automation instructions
- `how`'s general-purpose + readonly pair to one `pstack:readonly` subagent
- Cursor transcript paths to `opencode session list` and `opencode session export`
- `~/.cursor/plugins/` to the translated cache root, so the `poteto-agent` fallback is a real path
- relative references made absolute: `../<name>/SKILL.md`, `../playbooks/`, `../references/`, the backticked `<path>` placeholder, and `this file's absolute path` all resolve to the translated cache, so a model can open a playbook or `worker.md` to reach the delegation step
- `cursor-team-kit` names to project tooling; `/deslop` stays project tooling, not `/unslop`
- `docs/guide` and `README.md` copied into the cache so `/poteto-help` links resolve

`npm run audit` checks both the registered bodies and all 126 cached Markdown files for leftover `.cursor`, `claude-`, `gemini-`, `environment: "cloud"`, `subagent_type`, `/loop`, `background: true`, and `readonly: true`.

## Delivery

The adapter adds:

- 60 skills: 59 vendored plus the `/loop` adapter
- 60 commands: one per skill
- 3 subagents: `pstack:poteto-agent`, `pstack:comment-sicko`, `pstack:readonly`
- a session context block with the tool, subagent, path, and model mapping
- gated session routing: nothing for a plain OpenCode session, the mapping for a `pstack:*` subagent, and the mapping plus a controlling methodology (or routing) plus the sheet for a session that activated a pstack skill
- a controlling action layer for `/poteto-mode` sessions: it identifies the matching playbook, requires reading and following it in full, and fails explicitly if the playbook cannot be read — it does not duplicate, summarize, or modify the playbook's rules, so the vendored playbook stays the single source of truth
- a compaction hook that records the active mode so the post-compaction summary stays grounded
- session activation recorded in a session instruction entry, so the mode survives a plugin reload mid-session
- a normalized model sheet
- a model catalog with cost, context, status, and current-model marker

`pstack:readonly` and `pstack:comment-sicko` start from `*:deny` and allow only `read`, `grep`, `glob`, and `webfetch`. They cannot edit, write, run shell, ask the user, or spawn a subagent.

## Subagent fields

| Claude | OpenCode |
| --- | --- |
| `subagent_type` | `agent` |
| `generalPurpose` | `agent: "general"` |
| bare `poteto-agent` | `agent: "pstack:poteto-agent"` |
| bare `comment-sicko` | `agent: "pstack:comment-sicko"` |
| `readonly: true` | `agent: "pstack:readonly"` |
| `resume` | pass the returned `sessionID` |
| `run_in_background: true` | no field; subagents always run in the background |
| `isolation: "worktree"` | create a git worktree first |
| `model` plus effort | `provider/model#variant` |

## Setup and models

`/setup-pstack` reads the real models, injects a catalog, writes a normalized sheet, and applies the budget variant only to refs that have no chosen variant. A chosen `#low` or `#high` survives a budget change.

- A missing sheet gets real refs and distinct providers for panels.
- An existing sheet keeps valid choices, fills missing roles, rejects Cursor slugs and unknown refs, and rewrites atomically.
- A generated sheet that still says `inherit-parent` is replaced with real refs.
- The budget selects the target effort: `large` uses xhigh for code, `medium` high, `small` medium. Each ref takes the nearest available variant at or below the target.
- `# session hook: off` disables routing and sheet injection.
- The context hook reads the sheet on every request, so `/setup-pstack` changes apply without a restart.
- The `experimental.model.resolve` hook switches a subagent to the sheet's role model when the provider matches, unless the session has an explicit model. OpenCode only allows that hook to switch within the selected provider. A cross-provider role model must be passed in the `subagent` call's `model` field, which is what pstack's playbooks already ask for.

Live result on this machine:

```
# budget: large (xhigh)
feature, refactoring: opencode/tidepool-alpha-free#xhigh
judgment and prose: ollama-cloud/inkling-2-small#high
arena runners: opencode/tidepool-alpha-free#high, ollama-cloud/inkling-2-small#high, opencode/flint-40b-free#high
arena cross-judge pool: ollama-cloud/inkling-2-small#high, opencode/flint-40b-free#high
swarm workers: opencode/tidepool-alpha-free#high
```

A child session with `agent: pstack:poteto-agent` ran on `opencode/tidepool-alpha-free#xhigh`, measured from the assistant message.

## Paths and transcripts

- `.cursor/rules/*.mdc` model sheet to `~/.config/opencode/pstack-models.md`
- `.cursor/skills/` to `.opencode/skills/`
- `.cursor/agents/` to `.opencode/agents/`
- `.cursor/commands/` to `.opencode/commands/`
- `.cursor/settings.json` to `opencode.jsonc`
- `.cursor/automations/` to OpenCode automations
- `~/.cursor/projects/*/agent-transcripts/` to `opencode session list` and `opencode session export`, or the export API

## Automations

`/loop` is an adapter skill that creates an OpenCode automation with an `every` or `cron` trigger and a prompt action with a predicate. The automation deletes itself when the predicate passes. This replaces Cursor's built-in `/loop`; exact wake semantics differ.

## Packaging

- 580 files, 3.3 MB packed, 6.8 MB unpacked.
- Nested `node_modules` under `statechart/scripts` is excluded by npm; `postinstall` installs all dependencies and verifies `fast-check`.
- `prepack` regenerates data and runs the parity gate.
- `npm run check` runs verify, translation audit, and all 27 tests.
- `npm run sync` excludes the workspace `AGENTS.md`, which is not upstream.

## Known gaps

- OpenCode has no marketplace or `/add-plugin`. Install is `opencode plugin add` or the `plugins` array.
- OpenCode has no Custom Modes. The slash command activates the methodology for a session, the context hook injects it on every call, and a session instruction entry keeps it active through follow-ups, compaction, and plugin reloads.
- True per-subagent worktree isolation needs a custom spawn tool. The translated swarm skill uses `git worktree add` and absolute paths; the child session still starts in the parent's directory.
- Cursor `/loop` wake semantics are approximated with automations.
- Bugbot and Cursor's managed cloud agents need external integrations.
- Cursor model families only exist when those providers are configured. Panels use available providers.
- A cross-provider role change for a subagent needs an explicit `model` at spawn, or a plugin reload for the agent default. The resolve hook can only switch within the selected provider.
- `benny` automations are vendored but not installed.
