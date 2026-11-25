---
name: verify-pstack-opencode
description: Drive the pstack-for-opencode plugin in a real OpenCode server and prove that skills, commands, subagents, the model sheet, and role routing work. Use after changing src/, the vendored snapshot, the translation, or the sheet logic, and before claiming a change works.
---

# Verify pstack-for-opencode

`pstack-for-opencode` is an OpenCode plugin. A user installs it, and OpenCode gains 60 slash commands, 60 skills, three subagents, a model sheet at `~/.config/opencode/pstack-models.md`, and a session context hook. Unit tests in `test/` drive a mock plugin context. This skill drives the real thing: a private OpenCode server that loads the plugin from this checkout.

## Launch

Run every command from the repository root.

```sh
node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs launch
```

`launch` does six things:

1. Picks a free port unless `--port N` is given.
2. Creates a scratch directory under the OS temp directory and writes `opencode.jsonc` there with `plugins: [<this checkout>]`.
3. Points `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` at that scratch directory, so the user's real config, session database, and model sheet are untouched.
4. Starts `opencode serve --port <port> --hostname 127.0.0.1` with the repository as the working directory, detached, with output in `<scratch>/serve.log`.
5. Reads the `server password <value>` line from that log and creates a session, because a location reports no skills, commands, or agents until it has one.
6. Polls `/api/skill` until `pstack-poteto-mode` appears, then prints JSON with `port`, `pid`, `sessionID`, `scratch`, and `state`.

Ready means the registry is populated, not that the port answers. A server that reports its password but registers nothing fails `launch`.

The harness finds the CLI at `%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`, then `opencode` on `PATH`. Pass `--exe PATH` or set `OPENCODE_CLI` to override.

Teardown:

```sh
node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs stop
```

`stop` kills the recorded pid only, deletes `.verify/state.json`, and prints the scratch path. Delete that scratch directory yourself when you no longer need the server log.

## Doctor

```sh
node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs doctor
```

Doctor is read-only. It fails unless the recorded pid is alive, the scratch directory and its `opencode.jsonc` still exist, `/api/info` reports the same pid on the recorded port, and `/api/skill` still lists `pstack-poteto-mode`. Run it first whenever a drive step looks wrong.

## Drive

Every call needs `Authorization: Basic base64("opencode:<password>")`. The harness reads the password from `.verify/state.json`; never print it, and never paste it into a report.

```sh
# Skills, commands, and agents as the instance sees them, saved as JSON
node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs snapshot --out .verify/artifacts/<run>

# Run the /setup-pstack command handler in the recorded session
node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs run-command setup-pstack

# Read the sheet the command wrote, inside the scratch config directory
node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs sheet --out .verify/artifacts/<run>/pstack-models.md

# Any GET endpoint, for example the agents after the sheet was applied
node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs get /api/agent --out .verify/artifacts/<run>/agents-after-setup.json
```

Expected shape on this checkout (OpenCode 2.4.1): `snapshot` reports 60 `pstack-*` skills, 60 pstack commands beside the built-ins, and the three subagents `pstack:poteto-agent`, `pstack:comment-sicko`, `pstack:readonly`.

## Evidence

Write proof to `.verify/artifacts/<run>/`. The directory is gitignored and survives `stop`; cleanup never deletes it.

A proof is complete when it shows the action and the resulting state:

- Registration: `skills.json`, `commands.json`, `agents.json` from `snapshot`, with the pstack ids present in each.
- Setup sheet: `pstack-models.md` written by the command handler, plus the `sheet` output, showing the `# budget` line and one line per role in `src/sheet.js` `ROLES`.
- Role routing: `agents-after-setup.json` where each `pstack:*` agent carries `model.providerID` and `model.id` from the sheet's `bug-fix` or `judgment and prose` line.
- Translation: skill entries in `skills.json` whose `path` contains `pstack-translated` and whose `content` has none of the strings the audit rejects.
- Parity gate: the stdout of `node scripts/verify.mjs`, `node scripts/audit-translation.mjs`, and `node --test test/`.

Do not accept a passing mock-only test or a passing `npm test` alone as proof that the plugin loads in OpenCode. Those tests never call `opencode serve`.

## Cleanup

1. `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs stop`.
2. Delete the scratch directory `stop` printed.
3. Leave `.verify/artifacts/` in place.

Never kill by process name. The desktop app runs its own OpenCode service on port 28894; killing by image name takes the user's editor with it.

Do not delete `~/.local/share/opencode/pstack-translated`. Every run reuses that cache, and it is outside the isolation because `src/translate.js` hardcodes its location.

## Helpers

`scripts/harness.mjs` is the only helper. Its subcommands are `launch`, `doctor`, `snapshot`, `get`, `run-command`, `sheet`, and `stop`, each documented at the top of the file.

Start with [features/README.md](./features/README.md) for the feature map.
