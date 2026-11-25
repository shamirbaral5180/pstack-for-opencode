# Plugin registration

An installed pstack plugin adds its whole delivery layer to a running OpenCode server: 60 skills, one slash command per skill, and three subagents. Registration is per location, and a location only builds its registry once it has a session.

## Sub-features

- `registration-skills` registers the 59 vendored skills plus the `/loop` adapter as `pstack-*` skills.
- `registration-commands` registers one command per skill, alongside OpenCode's built-in `init`, `review`, `goal`, and `automation`.
- `registration-agents` registers `pstack:poteto-agent`, `pstack:comment-sicko`, and `pstack:readonly` with `mode: "subagent"`.
- `registration-plugin-entry` loads the checkout through the `plugins` array in `opencode.jsonc`.

## How to get to it (user POV)

- Add the checkout path to `plugins` in `~/.config/opencode/opencode.jsonc`, then open a session.
- List skills from the TUI, or run `opencode api get /api/skill` against a running server.
- Start a session and type `/` to see the pstack commands in the command menu.

## Driving it with harness.mjs

Preconditions:

- `launch` printed a `port` and `sessionID` and exited 0.
- `doctor` reported `ok: true`.

- **Launch and register.** Run `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs launch`. It exits 0 only after `/api/skill` lists `pstack-poteto-mode`.
- **Capture the registry.** Run `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs snapshot --out .verify/artifacts/<run>`. The command prints `skills`, `commands`, and `agents` arrays and writes `info.json`, `skills.json`, `commands.json`, and `agents.json` into that directory.
- **Check skill registration.** In `skills.json`, expect 60 entries whose `id` starts with `pstack-`, including `pstack-poteto-mode`, `pstack-setup-pstack`, and `pstack-loop`.
- **Check command registration.** In `commands.json`, expect all 60 pstack names plus the built-ins `init`, `review`, `goal`, and `automation`. Each pstack command name matches a skill name without the `pstack-` prefix.
- **Check subagents.** In `agents.json`, expect `pstack:poteto-agent`, `pstack:comment-sicko`, and `pstack:readonly` with `mode: "subagent"`. OpenCode's own `build`, `plan`, `general`, `explore`, `compaction`, `title`, and `summary` agents are also present; they are not part of this plugin.
- **Proof.** Keep the three JSON files in `.verify/artifacts/<run>/` and quote the matching ids, not only the lengths.

## Gotchas

- Before any session exists, `/api/skill`, `/api/command`, and `/api/agent` return `{"location":{...},"data":[]}`. Empty is not a registration failure until a session exists. `launch` creates one for this reason.
- The plugin's `package.json` has no `exports` map. OpenCode falls back to `index.js` at the package root, which re-exports `src/index.js`. Adding an `exports` map without a `"."` server entry would stop the plugin from loading.
- If the checkout path in `opencode.jsonc` is wrong, `launch` still starts a server and then fails the readiness poll with a registry that has zero pstack skills.
- `opencode` is not on `PATH` on this machine. The harness uses the desktop app's `resources/opencode-cli.exe`; a shell command `opencode ...` fails unless you use `OPENCODE_CLI`.
- A plain `opencode debug agents` fails when the desktop app is running, because both try to own managed-service port 28894. Use the harness server instead.
