# pstack for OpenCode

Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack), packaged as a native OpenCode plugin.

The pstack content is vendored unmodified. This package adds only the OpenCode delivery layer: skill registration, a slash command per skill, the vendored subagents plus a read-only adapter agent, session routing, the model sheet path, and the Cursor-to-OpenCode mapping.

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
- `/setup-pstack` lists the real models configured in OpenCode, lets you assign one to each pstack role, and writes `~/.config/opencode/pstack-models.md`. If no sheet exists, it first writes a recommended sheet with real model IDs and distinct providers for panels. An existing sheet is never overwritten.
- `/how`, `/why`, `/architect`, `/tdd`, and the other pstack skills each have a command.
- Subagents are `pstack:poteto-agent`, `pstack:comment-sicko`, and `pstack:readonly`. `generalPurpose` maps to `general`, `readonly` maps to `pstack:readonly`, `resume` passes a `sessionID`, and `run_in_background` maps to `background: true`.

Cursor paths and transcripts are mapped to OpenCode equivalents in the injected context and in [references/opencode-tools.md](references/opencode-tools.md). Transcripts use `opencode session list` and `opencode session export`, not `~/.cursor/projects`.

Root sessions also receive pstack routing on every model step, so a qualifying task reaches poteto-mode even without the slash command. Set `session hook: off` in the model sheet to disable that.

## Parity

Content parity is enforced by `npm test` and `npm run verify`: every registered skill and agent body is hashed against the vendored original. See [docs/parity.md](docs/parity.md) for the measured record and the live checks.

What does not map exactly:

- OpenCode has no plugin marketplace or `/add-plugin`. Install is `opencode plugin add` or the config array.
- OpenCode has no Custom Modes. The session hook and the slash command cover the same intent.
- Reasoning effort is a model variant in OpenCode, not a separate field.
- Bugbot and Cursor's managed cloud agents need external integrations. They are out of scope for this package.

## Layout

```
vendor/pstack/      pinned original, never edited
vendor/MANIFEST.json sha256 of every vendored file
src/data/           generated registration data
src/index.js        the plugin
src/overlay.js      mapping, routing, setup override
src/models.js       real model catalog for setup
src/setup.js        model sheet writer
scripts/            hash, generate, verify, frontmatter
```

## Develop

```bash
npm run hash      # record vendor hashes
npm run generate  # rebuild src/data from vendor
npm test          # registration, frontmatter, and content-parity tests
npm run verify    # manifest, inventory, and path checks
npm run check     # verify plus tests
npm run pack:check
```

`postinstall` reinstalls the statechart skill's dependencies, because npm omits nested `node_modules` from the package. A local checkout already has them, so the script is a no-op there.
