# Parity record

This file records what "the same pstack" means here, and how each claim is checked.

## Content

The vendored snapshot is the original pstack v0.15.48, copied without edits.

- 1,981 files, 7,929,374 bytes
- 59 skills, 126 skill Markdown files, 338,896 bytes
- 2 vendored agents
- 22 playbooks, 24 principles
- Manifest root: `e123a54f34403fb3941006b9842b47cae9c43c6fc382289240f90fc362d2abc3`

`npm test` hashes every registered vendored skill body and agent system prompt against the vendored file. `npm run verify` hashes every vendored file against `vendor/MANIFEST.json`. A single changed byte fails both. The adapter-only `pstack:readonly` agent is code, not vendored content.

## Delivery

The adapter never rewrites skill or agent content. It adds only:

- registration of the 59 skills, 59 commands, and 3 subagents
- a slash command per skill, which attaches that skill to the prompt
- a session context block with the tool, subagent, path, and model mapping
- root-session routing to `pstack-poteto-mode`
- the model sheet path `~/.config/opencode/pstack-models.md`
- an OpenCode override and model catalog for `/setup-pstack`

Agent frontmatter is not copied. `model` and `is_background` are Cursor fields; `mode: subagent`, the description, and the body are registered instead. `pstack:readonly` is an adapter agent with `edit`, `write`, `shell`, and `question` denied.

## Subagent fields

| Claude | OpenCode |
| --- | --- |
| `subagent_type` | `agent` |
| `generalPurpose` | `agent: "general"` |
| `readonly: true` | `agent: "pstack:readonly"` |
| `resume` | pass the returned `sessionID` |
| `run_in_background: true` | `background: true` |
| `isolation: "worktree"` | no field; create the worktree first |
| `model` plus effort | `provider/model#variant` |

OpenCode evaluates permission rules last-match-wins, so the readonly denials override the default allow rule.

## Setup and models

`/setup-pstack` now:

1. reads the real configured models from `ctx.model.list()`
2. injects them as `<pstack_model_catalog>` with `provider/model` and variant refs
3. writes a recommended sheet from those models, with real refs
4. asks the model to confirm or change roles with the `question` tool

The recommended sheet uses the current or first chat model for code roles, a different provider for judgment and prose, and a panel of up to three distinct providers. An existing sheet is never overwritten.

Live result on this machine:

```
feature, refactoring: opencode/tidepool-alpha-free
judgment and prose: ollama-cloud/inkling-2-small
arena runners: opencode/tidepool-alpha-free, ollama-cloud/inkling-2-small, opencode/hy4-flash-free
arena cross-judge pool: ollama-cloud/inkling-2-small, ollama-cloud/hy4
swarm workers: opencode/tidepool-alpha-free#low
```

Every ref was validated against `/api/model`, and the catalog reached the model prompt.

## Paths and transcripts

Cursor paths and their OpenCode equivalents are in the injected mapping and in `references/opencode-tools.md`. The important ones:

- `.cursor/rules/*.mdc` model sheet to `~/.config/opencode/pstack-models.md`
- `.cursor/skills/` to `.opencode/skills/`
- `.cursor/settings.json` to `opencode.jsonc`
- `~/.cursor/projects/*/agent-transcripts/` to `opencode session list` and `opencode session export`, or `GET /api/experimental/session/{id}/export`

The mapping tells the model never to read `~/.cursor/projects` or `~/.claude/projects` on OpenCode.

## Frontmatter

`scripts/frontmatter.mjs` parses the shapes the vendored files use: scalars, quoted values, inline lists, nested `metadata`, literal and folded block scalars, comments, CRLF, and a BOM. Tests cover each shape and parse all 61 vendored skill and agent files.

## Packaging

- `npm pack` produces 577 files, 3.3 MB packed, 6.8 MB unpacked.
- Nested `node_modules` under `statechart/scripts` is excluded by npm; `postinstall` reinstalls it with `scripts/ensure-statechart-deps.mjs`.
- `prepack` regenerates data and runs the parity gate.
- `main` points at `index.js`, which re-exports `src/index.js`. There is no `exports` map, because OpenCode's local-directory resolution falls back to the root entry.
- `npm run check` runs the parity gate and all tests.

## Known gaps

- OpenCode has no marketplace or `/add-plugin`. Install is `opencode plugin add` or the `plugins` array.
- OpenCode has no Custom Modes. The session hook and the slash command cover the intent.
- Reasoning effort is a model variant, not a separate field. Where no variant exists, the effort suffix is dropped.
- Bugbot and Cursor's managed cloud agents need external integrations and are out of scope.
- `benny` automations are vendored but not installed yet.
