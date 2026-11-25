# pstack for OpenCode

Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack), packaged as a native OpenCode plugin.

The pstack content is vendored unmodified. This package adds only the OpenCode delivery layer: translated skill registration, a slash command per skill, three subagents, session routing, a normalized model sheet, a `/loop` adapter, and the Cursor-to-OpenCode mapping. See [docs/parity.md](docs/parity.md) for the exact substitution list.

## Install

From a local checkout, add the absolute path to `~/.config/opencode/opencode.jsonc`:

```json
{
  "plugins": ["C:/path/to/pstack-for-opencode"]
}
```

Or install the Git package:

```bash
opencode plugin add 'github:<you>/pstack-for-opencode#main'
```

Restart OpenCode after changing the plugin.

## Use

- `/poteto-mode <task>` for rigorous work. The command attaches the `pstack-poteto-mode` skill.
- `/setup-pstack` lists the real models configured in OpenCode, lets you assign one to each pstack role, and writes `~/.config/opencode/pstack-models.md`. It normalizes an existing sheet, fills missing roles, rejects Cursor slugs, and applies the budget only to refs with no chosen variant. The context hook reads the sheet fresh on every request.
- `/how`, `/why`, `/architect`, `/tdd`, and the other pstack skills each have a command.
- `/loop <interval> <task>` creates an OpenCode automation that checks a predicate and deletes itself when it passes.
- Subagents are `pstack:poteto-agent`, `pstack:comment-sicko`, and `pstack:readonly`. `generalPurpose` maps to `general`, bare names get the `pstack:` prefix, `readonly` maps to `pstack:readonly`, and `resume` passes a `sessionID`. There is no `background` field; subagents always run in the background.

Cursor paths and transcripts are translated before registration and mapped in [references/opencode-tools.md](references/opencode-tools.md). Transcripts use `opencode session list` and `opencode session export`, not `~/.cursor/projects`.

Root sessions receive pstack routing on every model step. Set `# session hook: off` in the model sheet to disable routing and sheet injection.

## Parity

Vendor parity is enforced by `npm run verify`; translation parity is enforced by `npm run audit`, which checks the registered bodies and every cached playbook for leftover Cursor paths, slugs, and fields. `npm test` covers registration, setup normalization, and agent permissions. See [docs/parity.md](docs/parity.md) for the measured record and the live checks.

What does not map exactly:

- OpenCode has no plugin marketplace or `/add-plugin`. Install is `opencode plugin add` or the config array.
- OpenCode has no Custom Modes. The session hook and the slash command cover the same intent.
- True per-subagent worktree isolation needs a custom spawn tool. The swarm skill creates git worktrees and passes absolute paths; the child session still starts in the parent directory.
- OpenCode's model-resolve hook can switch a subagent only within its selected provider. A cross-provider role model must be passed in the `subagent` call, or the agent default needs a plugin reload.
- Cursor `/loop` wake semantics are approximated with OpenCode automations.
- Bugbot and Cursor's managed cloud agents need external integrations. They are out of scope for this package.

## Layout

```
vendor/pstack/      pinned original, never edited
vendor/MANIFEST.json sha256 of every vendored file
src/data/           generated registration data
src/index.js        the plugin
src/overlay.js      mapping, routing, setup override
src/models.js       real model catalog for setup
src/sheet.js        sheet parsing, normalization, role models
src/setup.js        model sheet writer
src/translate.js    translated cache for skills and playbooks
src/adapter.js      the /loop adapter skill
scripts/            hash, generate, verify, frontmatter, audit
```

## Develop

```bash
npm run hash      # record vendor hashes
npm run generate  # rebuild src/data from vendor
npm test          # registration, frontmatter, setup, and permission tests
npm run verify    # manifest, inventory, and path checks
npm run audit     # translated content contains no Cursor-only text
npm run check     # verify, audit, and tests
npm run pack:check
```

`postinstall` installs the statechart skill's dependencies, including `fast-check`, and verifies it resolves. npm omits nested `node_modules` from the package; a local checkout already has them, so the script is a no-op there.
