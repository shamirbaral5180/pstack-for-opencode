# pstack-for-opencode verification map

This directory is the maintained source for verifying the user-facing behavior of the pstack plugin. Read this index before driving the plugin, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch the instance with `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs launch` from the repository root. It prints `port`, `pid`, `sessionID`, and `scratch`.
- The instance is private: four `XDG_*` variables point at the scratch directory, so the user's `~/.config/opencode` and session database are not touched.
- Run `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs doctor` and require `ok: true` before any drive step.
- OpenCode is version 2.4.1 on this machine. A different version may register a different set of skills.
- The instance has no saved credentials, so its model catalog is the free `opencode/*` models. Ref selection in the sheet reflects that catalog, not the user's paid providers.
- Never drive the desktop app's service on port 28894, and never point a run at the user's real `pstack-models.md`.

## Driving conventions

- Start every recipe from a freshly launched instance unless its preconditions say otherwise.
- Treat every command as literal. Keep flags and paths unchanged.
- Pass `--out` on every read that is part of a proof, so the artifact lands in `.verify/artifacts/<run>/`.
- Use the harness for HTTP. Hand-rolled `fetch` calls need the Basic credential, and the password must not be printed or quoted in reports.
- One instance per run. `launch` refuses to start a second when `.verify/state.json` records a live pid.

## Proof and skip reporting

- Registration proof names the pstack ids present in `skills.json`, `commands.json`, and `agents.json`, not only the counts.
- Sheet proof includes the written file and the `# budget` line, because a bare role line cannot show which budget was applied.
- Routing proof reads the agent model after the sheet exists. An agent model that matches the sheet is the observable end state.
- Record the run id, the port, and the feature id with every artifact.
- Report an unreachable path with the command you ran and the precondition that failed. Do not substitute a different feature for it.
- A skipped check is not a pass. `npm test` alone never proves the plugin loads.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with harness.mjs`, and `Gotchas`.

## Features

- [Plugin registration](./registration.md) covers the skills, commands, and subagents an installed plugin adds to a live server.
- [Setup sheet](./setup-sheet.md) covers `/setup-pstack` writing and normalizing `pstack-models.md`.
- [Role routing](./role-routing.md) covers the sheet driving subagent models and the read-only permission boundary.
- [Translation](./translation.md) covers registered bodies coming from the translated cache with no Cursor-only text.
- [Parity gate](./parity-gate.md) covers the repository's own vendored-hash, translation-audit, and test checks.
