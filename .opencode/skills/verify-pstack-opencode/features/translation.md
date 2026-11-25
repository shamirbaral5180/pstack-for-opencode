# Translation

The vendored pstack content is Cursor's. The plugin never edits `vendor/pstack`; it writes a translated copy under `~/.local/share/opencode/pstack-translated/<key>` and registers skill bodies from that copy. A registered skill therefore has a cache path and no Cursor-only text in its body.

## Sub-features

- `translation-paths` registers every pstack skill with a `path` inside `pstack-translated/<key>`.
- `translation-bodies` replaces Cursor paths, slugs, tool names, and subagent fields in the registered content.
- `translation-cache` reuses one cache keyed by the vendored manifest root and a version number, so unchanged content is not recopied.

## How to get to it (user POV)

- Install the plugin and open a skill, such as `/poteto-mode`, from the TUI.
- Read the skill file the plugin reports: it lives under `pstack-translated`, not under `vendor/pstack`.
- Search an installed pstack skill for `~/.cursor` and find nothing.

## Driving it with harness.mjs

Preconditions:

- `doctor` reported `ok: true`.
- You ran `snapshot` into `.verify/artifacts/<run>/`.

- **Check the paths.** In `skills.json`, every entry whose `id` starts with `pstack-` has a `path` that contains `pstack-translated`. The path ends in `skills/<name>/SKILL.md`, except the adapter, which ends in `adapter/loop/SKILL.md`.
- **Check the bodies.** No `content` value in those entries contains `.cursor`, `claude-`, `gemini-`, `subagent_type`, or `environment: "cloud"`. Run `node scripts/audit-translation.mjs` for the same check against the cache on disk, including playbooks and references.
- **Check the adapter.** The skill `pstack-loop` has a description that mentions an OpenCode automation, and its content describes creating one with the automation tool.
- **Check a subagent body.** In `agents.json`, `pstack:poteto-agent` has a `system` string that contains no `.cursor` and no `subagent_type`.
- **Proof.** Keep `skills.json` and the stdout of the audit, and quote one skill path and the audit's counts.

## Gotchas

- The cache path is hardcoded to `~/.local/share/opencode/pstack-translated` in `src/translate.js`. It ignores `XDG_DATA_HOME`, so an isolated run still reads and refreshes the user's cache. Never delete that directory during cleanup.
- A stale cache is keyed by the manifest root, so changing a vendored file without running `node scripts/hash-vendor.mjs` leaves the old cache in place and the old text registered.
- The first registration on a cold cache copies about 126 Markdown files plus `node_modules` junctions, which takes a second or two. A slow first `launch` is not a hang.
- `skills.json` includes non-pstack skills such as `opencode` and `browser`. Filter by the `pstack-` prefix before asserting counts.
- Content checks are substring matches. A translated body can legitimately mention `claude-` inside a model-family discussion if a replacement was missed; treat any hit as a finding to investigate, not as proof by itself.
