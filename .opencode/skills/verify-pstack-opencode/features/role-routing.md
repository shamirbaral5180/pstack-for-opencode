# Role routing

The sheet is not documentation. When it changes, the plugin assigns each pstack subagent a default model from the sheet: `pstack:poteto-agent` takes `bug-fix` (falling back to `feature, refactoring`), and the two review agents take `judgment and prose`. The plugin also forces the read-only agents into a permission mode that denies writes, shell, and spawning.

## Sub-features

- `routing-agent-models` sets each `pstack:*` agent's `model` to the sheet's ref for its role.
- `routing-permissions` gives `pstack:readonly` and `pstack:comment-sicko` a deny-all base with `read`, `grep`, `glob`, and `webfetch` allowed.
- `routing-subagent-mode` keeps all three agents at `mode: "subagent"`.

## How to get to it (user POV)

- Write or change `~/.config/opencode/pstack-models.md`, then run `/setup-pstack` or reload OpenCode.
- Spawn a pstack subagent and inspect which model answers.
- Try to edit a file from a `pstack:readonly` reviewer and watch the write get denied.

## Driving it with harness.mjs

Preconditions:

- `doctor` reported `ok: true`.
- You ran `run-command setup-pstack` so a sheet exists in the scratch config directory.

- **Read the agents.** Run `node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs get /api/agent --out .verify/artifacts/<run>/agents-after-setup.json`.
- **Check the code agent.** `pstack:poteto-agent` has `model.providerID` and `model.id` equal to the sheet's `bug-fix` ref, with `model.variant` when that ref carries `#variant`.
- **Check the review agents.** `pstack:comment-sicko` and `pstack:readonly` carry the sheet's `judgment and prose` ref.
- **Check permissions.** `pstack:readonly` and `pstack:comment-sicko` each list a rule with `action: "*"`, `effect: "deny"`, then allow `read`, `grep`, `glob`, and `webfetch`, and deny `question`. Neither lists an allow rule for `edit`, `write`, `shell`, or `subagent`.
- **Check mode.** All three have `mode: "subagent"`.
- **Proof.** Keep `agents-after-setup.json` and quote the three `model` objects and the deny base rule.

## Gotchas

- The agents' models are applied when the plugin loads and again when the setup command runs. A fresh instance with no sheet leaves the pstack agents without a `model` field, which is the documented fallback, not a failure.
- `opencode/big-pickle` has no variants, so `model.variant` is absent. Absence of a variant on a model with no variants is correct.
- The `experimental.model.resolve` hook can only switch a subagent within its selected provider. A cross-provider change needs an explicit `model` on the spawn call or a plugin reload. Do not read a cross-provider mismatch as a routing bug.
- `pstack:readonly` denies `question` on purpose, so a reviewer cannot stall a run on a prompt.
- Reading `/api/agent` before the location has a session returns an empty list. `launch` creates the session.
