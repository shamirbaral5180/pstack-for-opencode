# Parity record

This file records what "the same pstack" means here, and how each claim is checked.

## Content

The vendored snapshot is the original pstack v0.15.48, copied without edits.

- 1981 files, 7,929,374 bytes
- 59 skills, 126 skill Markdown files, 338,896 bytes
- 2 agents
- 22 playbooks, 24 principles
- Manifest root: `e123a54f34403fb3941006b9842b47cae9c43c6fc382289240f90fc362d2abc3`

`npm test` hashes every registered skill body and agent system prompt against the vendored file. `npm run verify` hashes every vendored file against `vendor/MANIFEST.json`. A single changed byte fails both.

## Delivery

The adapter never rewrites skill or agent content. It adds only:

- registration of the 59 skills, 59 commands, and 2 subagents
- a slash command per skill, which attaches that skill to the prompt
- a session context block with the tool and model mapping
- root-session routing to `pstack-poteto-mode`
- the model sheet path `~/.config/opencode/pstack-models.md`
- an OpenCode override text for `/setup-pstack`

Agent frontmatter is not copied. `model` and `is_background` are Cursor fields; `mode: subagent`, the description, and the body are registered instead.

## Verified live

Against OpenCode 2.4.1:

- `/api/skill` reports 59 `pstack-*` skills, with paths under `vendor/pstack`
- `/api/command` reports the 59 commands, including `poteto-mode` and `setup-pstack`
- `/api/agent` reports `pstack:poteto-agent` and `pstack:comment-sicko`
- `/poteto-mode` attaches `pstack-poteto-mode` (12,644 bytes of prepared skill content) to the user message
- the assistant's reasoning cites `pstack_routing`, which proves the context hook runs
- a child session created with `agent: pstack:poteto-agent` runs and reads vendored files
- `/setup-pstack` wrote `~/.config/opencode/pstack-models.md` with `# budget: large` and every role set to `inherit-parent`
- a later root session quoted the sheet's `# budget` line back, which proves the model sheet is injected

The setup handler also writes a default `inherit-parent` sheet when none exists, so setup cannot silently leave the role sheet missing. An existing sheet is never overwritten.

## Known gaps

- OpenCode has no marketplace or `/add-plugin`. Install is `opencode plugin add` or the `plugins` array.
- OpenCode has no Custom Modes. The session hook and the slash command cover the intent.
- Reasoning effort is a model variant, not a separate field. Where no variant exists, the effort suffix is dropped.
- Bugbot and Cursor's managed cloud agents need external integrations and are out of scope.
- Cursor's `/loop` maps to OpenCode automations. The `benny` pack is not installed by this plugin yet.
