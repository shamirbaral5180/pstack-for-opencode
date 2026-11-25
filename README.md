# pstack for OpenCode

Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack), packaged as a native OpenCode plugin.

The pstack content is vendored unmodified. This package adds only the OpenCode delivery layer: skill registration, a slash command per skill, the two subagents, session routing, and the model sheet path.

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
- `/setup-pstack` to pick models. It writes `~/.config/opencode/pstack-models.md`. If no sheet exists, the command writes a default `inherit-parent` sheet first; an existing sheet is never overwritten.
- `/how`, `/why`, `/architect`, `/tdd`, and the other pstack skills each have a command.
- Subagents are `pstack:poteto-agent` and `pstack:comment-sicko`.

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
scripts/            hash, generate, verify
```

## Develop

```bash
npm run hash      # record vendor hashes
npm run generate  # rebuild src/data from vendor
npm test          # registration and content-parity tests
npm run verify    # manifest, inventory, and path checks
```
