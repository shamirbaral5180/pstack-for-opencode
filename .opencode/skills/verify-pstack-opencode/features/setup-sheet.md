# Setup sheet

`/setup-pstack` writes `pstack-models.md` next to `opencode.jsonc` in the OpenCode config directory. The command handler writes the file itself before it hands a prompt to the model, so the sheet exists as soon as the command returns. Every role gets a real ref from the instance's catalog, with a budget variant where the model has variants.

## Sub-features

- `setup-create` writes a full sheet when none exists, with one line per role in `src/sheet.js` `ROLES`.
- `setup-budget` writes the `# budget: <label> (<effort>)` line. With no sheet to read, the label is `large` and the code effort is `xhigh`.
- `setup-panels` gives panel roles more than one entry, drawn from different providers when the catalog has them.
- `setup-location` writes to `$XDG_CONFIG_HOME/opencode/pstack-models.md`, so an isolated instance writes into its scratch directory.

## How to get to it (user POV)

- Run `/setup-pstack` in any session.
- Read the sheet at `~/.config/opencode/pstack-models.md`.
- Run `/setup-pstack` again after editing the sheet, to normalize choices that the current catalog no longer offers.

## Driving it with harness.mjs

Preconditions:

- `doctor` reported `ok: true`.
- No `pstack-models.md` exists in the scratch config directory yet. A fresh `launch` guarantees this.

- **Run the command.** Run `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs run-command setup-pstack`. It returns `{}` and exits 0.
- **Read the sheet.** Run `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs sheet --out .verify/artifacts/<run>/pstack-models.md`. The file exists and the command prints its path.
- **Check the budget line.** The fourth-to-last header line reads `# budget: large (xhigh)`.
- **Check every role.** The file has exactly these keys, in this order: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `judgment and prose`, `arena runners`, `arena cross-judge pool`, `swarm workers`, `interrogate reviewers`.
- **Check the refs.** Every value matches `provider/model` or `provider/model#variant`, and every ref appears in the instance catalog. With no saved credentials the catalog is the free `opencode/*` set, so expect refs such as `opencode/big-pickle` and `opencode/deepseek-v4.1-flash-free#high`.
- **Check panel shape.** `arena runners` and `interrogate reviewers` hold comma-separated lists of three entries; `arena cross-judge pool` holds two.
- **Proof.** Keep the sheet file and quote its `# budget` line and two role lines, including one panel list.

## Gotchas

- The catalog comes from the instance, so an unauthenticated instance never yields the user's paid refs. A sheet of free models here is correct behavior, not a regression.
- `pstack-models.md` in the scratch directory is the only sheet this run may touch. Writing the user's real sheet requires the real config directory and is out of scope for verification.
- The command handler also enqueues a prompt with the setup override and the model catalog. The queued prompt needs a model turn to run, and this instance has a free model available; you do not need that turn to prove the sheet, and waiting on it slows the run.
- `feature, refactoring` contains a comma inside the role name. Split role lines on the first `: `, never on commas.
- An existing sheet is normalized in place, not replaced. Verifying the create path after a previous run means launching a new instance, because the scratch config persists until you delete it.
