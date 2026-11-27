# Parity record

This file records what "the same pstack" means here, and how each claim is checked.

## Content

The vendored snapshot is the original pstack v0.15.48, copied without edits. The local `AGENTS.md` was removed because it is not upstream.

- 1,980 files, 7,929,026 bytes
- 59 vendored skills, 126 skill Markdown files, 338,896 bytes
- 2 vendored agents
- 22 playbooks, 24 principles
- Manifest root: `65133c0e4de2f3e17682f49562f2b94b3489add3299388388c129269c1bacb30`

`npm run verify` hashes every vendored file against `vendor/MANIFEST.json`. A single changed byte fails it.

## Translation

Registered content comes from a translated cache under `~/.local/share/opencode/pstack-translated/<key>`. The vendor tree stays untouched. The cache is rebuilt when the vendor manifest or the translation version changes, and it includes playbooks and references so relative reads are translated too.

Substitutions:

- Cursor paths to OpenCode paths, including `.opencode/skills`, `.opencode/agents`, `.opencode/commands`
- `~/.cursor/rules/pstack-models.mdc` to `~/.config/opencode/pstack-models.md`
- Cursor transcripts to `opencode session list` and `opencode session export`
- `Task`/`Agent` to `subagent`, `AskUserQuestion` to `question`, `TodoWrite` to `todowrite`
- `subagent_type`, `generalPurpose`, bare `poteto-agent` and `comment-sicko`, `readonly`
- `run_in_background` removed because OpenCode subagents always run in the background
- worktree-backed worker requests to a registered OpenCode worktree and `pstack_worktree_worker`; `cloud_base_branch` to worktree base
- Cursor model defaults to `inherit-parent` or the role sheet
- Arena family rules to provider-prefix rules
- `/loop` to OpenCode automation instructions
- `how`'s general-purpose + readonly pair to one `pstack:readonly` subagent
- Cursor transcript paths to `opencode session list` and `opencode session export`
- `~/.cursor/plugins/` to the translated cache root, so the `poteto-agent` fallback is a real path
- relative references made absolute: `../<name>/SKILL.md`, `../playbooks/`, `../references/`, the backticked `<path>` placeholder, and `this file's absolute path` all resolve to the translated cache, so a model can open a playbook or `worker.md` to reach the delegation step
- `cursor-team-kit` names to project tooling; `/deslop` stays project tooling, not `/unslop`
- `docs/guide` and `README.md` copied into the cache so `/poteto-help` links resolve

`npm run audit` checks both the registered bodies and all 126 cached Markdown files for leftover `.cursor`, `claude-`, `gemini-`, `environment: "cloud"`, `subagent_type`, `/loop`, `background: true`, and `readonly: true`.

## Delivery

The adapter adds:

- 60 skills: 59 vendored plus the `/loop` adapter
- 60 commands: one per skill
- 3 subagents: `pstack:poteto-agent`, `pstack:comment-sicko`, `pstack:readonly`
- a session context block with the tool, subagent, path, and model mapping
- gated session routing: nothing for a plain OpenCode session, the mapping for a `pstack:*` subagent, and the mapping plus a controlling methodology (or routing) plus the sheet for a session that activated a pstack skill
- an action layer for `/poteto-mode` sessions: the original `SKILL.md` owns routing, including `figure-it-out` when indicated. The main agent is instructed to load the selected workflow in full and report a load failure instead of proceeding. The adapter neither selects a route nor duplicates its steps.
- a session-scoped `pstack_todowrite` checklist for every active pstack session. It saves model-authored todos as session instructions, with a `blocked` status and an OpenCode permission check. Native `todowrite` is hidden for the session because it cannot carry `workflow`, step IDs, or implementation `paths`; using one structured tool keeps prerequisite and handoff validation identical on every host.
- checklist validation at the todo boundary. The main agent names its selected source. Numbered playbook steps and phase headings come from the vendored text. Steps that mandate a skill (`use`/`run`/`apply` the **x** skill, or `per **x**`) require a successful in-turn load before the checklist advances past them; conditional clauses (`if`, `when`, `unless`, `optional`) are never promoted. A failed check names the missing entry or load and leaves the saved checklist unchanged.
- mandatory implementation handoff for playbooks whose steps delegate code to a subagent (feature, bug-fix, perf-issue, refactoring, hillclimb). A spawn or a worker's self-report is not an implementation change. The checklist requires the step to be saved in progress with distinct project-relative implementation `paths`, the mandatory principle leaf loaded, and the files named in the worker's brief; an attributable worker edit/write/patch whose diff (or matching snapshot for a plain write) touches a declared path satisfies it.
- a main-session `tool.execute.before` checkpoint for direct mutation, new delegation, and recognized Git/forge commands. Once a structured checklist is accepted, follow-up turns use its selected workflow and scope; a new route requires a successfully validated checklist. Handoff proof still comes from the available transcript for that workflow, not from a saved `completed` label. Explicitly required worker principles must have a successful load before the first attributable implementation change. A shell or Code Mode step whose shared snapshot shows workspace changes is reported as an observation in the next context, never attributed to a writer or blocked.
- a compaction hook that records the active mode so the post-compaction summary stays grounded
- session activation recorded in a session instruction entry, so the mode survives a plugin reload mid-session
- a model sheet preserved as saved, with a preview and confirmation before setup writes
- a model catalog with cost, context, status, and current-model marker

`pstack:readonly` and `pstack:comment-sicko` start from `*:deny` and allow only `read`, `grep`, `glob`, and `webfetch`. They cannot edit, write, run shell, ask the user, or spawn a subagent.

## Subagent fields

| Claude | OpenCode |
| --- | --- |
| `subagent_type` | `agent` |
| `generalPurpose` | `agent: "general"` |
| bare `poteto-agent` | `agent: "pstack:poteto-agent"` |
| bare `comment-sicko` | `agent: "pstack:comment-sicko"` |
| `readonly: true` | `agent: "pstack:readonly"` |
| `resume` | pass the returned `sessionID` |
| `run_in_background: true` | no field; subagents always run in the background |
| `isolation: "worktree"` | select a registered OpenCode worktree and start the child with `pstack_worktree_worker` |
| `model` plus effort | `provider/model#variant` |

## Setup and models

`/setup-pstack` reads the saved sheet and the current model catalog without writing. The proposal tool previews the exact new sheet. Only `/setup-pstack apply <token>` in the session that staged it saves the proposal; it rejects one based on an older version of the sheet.

- A missing sheet gets recommended refs, with diverse providers for panels when available.
- An existing sheet keeps its literal refs, variants, role omissions, panel order and aliases unless the proposal edits them explicitly. Missing catalog entries are flagged, not replaced.
- The budget selects the starting effort for recommendations: `large` uses xhigh for code, `medium` high, `small` medium. Recommendations take the nearest available variant at or below the target.
- `# session hook: off` disables routing and sheet injection.
- The context hook reads the sheet on every request, so `/setup-pstack` changes apply without a restart.
- The selected workflow passes its chosen model to native `subagent` or, for a worktree assignment, `pstack_worktree_worker`. The plugin does not rewrite agent defaults or override model resolution. `inherit-parent` and `auto` keep the parent model.

Live result on this machine:

```
# budget: large (xhigh)
feature, refactoring: opencode/tidepool-alpha-free#xhigh
judgment and prose: ollama-cloud/inkling-2-small#high
arena runners: opencode/tidepool-alpha-free#high, ollama-cloud/inkling-2-small#high, opencode/flint-40b-free#high
arena cross-judge pool: ollama-cloud/inkling-2-small#high, opencode/flint-40b-free#high
swarm workers: opencode/tidepool-alpha-free#high
```

A child session with `agent: pstack:poteto-agent` ran on `opencode/tidepool-alpha-free#xhigh`, measured from the assistant message.

## Paths and transcripts

- `.cursor/rules/*.mdc` model sheet to `~/.config/opencode/pstack-models.md`
- `.cursor/skills/` to `.opencode/skills/`
- `.cursor/agents/` to `.opencode/agents/`
- `.cursor/commands/` to `.opencode/commands/`
- `.cursor/settings.json` to `opencode.jsonc`
- `.cursor/automations/` to OpenCode automations
- `~/.cursor/projects/*/agent-transcripts/` to `opencode session list` and `opencode session export`, or the export API

## Automations

`/loop` is an adapter skill that creates an OpenCode automation with an `every` or `cron` trigger and a prompt action with a predicate. The automation deletes itself when the predicate passes. This replaces Cursor's built-in `/loop`; exact wake semantics differ.

## Packaging

- `npm run pack:beta` builds the versioned npm archive from the package file list, then extracts and strictly verifies the whole vendored snapshot. `npm run pack:check` runs the same check without keeping the archive. A release uses the verified `.tgz`, not the output of npm's default directory packing.
- The archive includes the original Statechart dependencies. OpenCode can install it without a lifecycle hook or a separate dependency download. `scripts/verify.mjs --installed` also verifies all bytes after npm's extraction-time rename of the vendored `.gitignore` to `.npmignore`.
- `npm run check` runs source verification, the translation audit, and the unit suite.
- `npm run sync` excludes the workspace `AGENTS.md`, which is not upstream.

## Known gaps

- The adapter surfaces the upstream routing rule and validates the chosen workflow against registry loads. It does not classify tasks. The beta.2 cross-cutting transcripts explicitly chose narrower routes; `resolveWorkflow` canonicalized those choices rather than falling back to Bug Fix.
- Natural workflow fidelity depends on the coordinator and its delegates. On the same beta.3 candidate, both DeepSeek and GLM coordinators chose Bug Fix for the cross-cutting release fixture. In the isolated GPT-6.2 Sol comparison, one pairing chose `figure-it-out` and the other chose Bug Fix. A stronger coordinator can improve Arena use and review follow-through without making routing reliable. The adapter checks observed receipts; it does not override a model's route, guarantee compliance, or count a timeout as a completed run.
- Arena fan-out uses the saved Arena phase and runner seat, not the enclosing code role. For scoped implementation handoffs, local review is tracked separately from opening a PR. A blocked remote does not count as successful PR delivery; the checklist only accepts completion with an observed ready PR receipt, currently for standalone `gh pr create` or `origin pr create` with a returned PR URL.
- A review started in a registered Git worktree can count after integration only if the linked read-only reviewer read every changed file in full and reported. The review launch records the base and hashes the changed paths, modes, and bytes. At checklist or delivery validation, the worktree and final checkout must still match that record. A commit or fast-forward of the same content is allowed; a different patch, a missing file read, or an unsupported diff (such as a deletion, binary, or mixed index and working-tree versions of the same file) needs a fresh review in the final checkout.
- Prior acceptance runs observed delegation and output files, not complete methodology. The checkpoint now enforces the unconditional skill prerequisites and the implementation handoff a playbook states, but it still cannot prove a loaded skill was *applied*, that the selected route was the right one, or that verification matched the product surface.
- The pre-tool checkpoint is not a security boundary. It leaves ambiguous routing and unavailable transcript evidence undecided. It cannot attribute arbitrary shell, `execute`, or Code Mode writes to a specific writer (it reports those as observations, not violations), treat a read alone as a completed review, or detect work done outside observable tools. A model that never saves a checklist, never declares scope, or writes only to files outside the declared scope is out of its reach.
- Cursor's `control-ui`, `control-cli`, and `deslop` are not bundled. A project-provided equivalent can satisfy the corresponding step; when no equivalent exists, report it as blocked.

### Confirmed failure record

A real school-management run (the "Agriculture and livestock management system" session) exercised the port end to end and its own execution audit found the methodology delivered but ignored: the agent selected Feature instead of `figure-it-out`, wrote all product code in the main session instead of delegating, loaded `architect` only after implementation, loaded none of the principle leaves, and skipped the throughput checkpoint and comment review, while functional verification passed 29/29 and Poteto Mode stayed active. That run reproduced exactly the gaps this checkpoint now targets: mandatory handoff with worker ownership, unconditional prerequisite loads before product mutation, and principle-leaf reads over checklist self-report.

### Verified natural execution

Three organic DeepSeek V4.1 Flash feature runs against the running desktop service (private fixture repos) followed the methodology under the new build: each traced the subsystem, loaded `architect` and the principle leaves before code, saved a step-ID-and-paths checklist, made zero main-session product writes, delegated to a `poteto-agent` on the sheet's feature model, and passed the product check. A non-author `comment-sicko` reviewer on the judgment model ran in two of three. None reproduced the audit's failures.

After the native-`todowrite` fix, two further runs with `experimental.todo: true` both kept the structured checklist (native `todowrite` was hidden in the main session), carried step IDs and implementation `paths`, made zero main-session writes, delegated on the sheet model, and passed the product. One showed three gate recoveries without loops (`workflow` name corrected, missing throughput items added, implementation `paths` declared); the other completed clean on the first try. The two earlier failures of the same scenario were a test-harness defect (the product was checked the moment the parent first went idle after delegating, before the child integrated), not a plugin failure.

Those earlier runs predate the beta.3 review checkpoint. In beta.3 the assistant must provide independent review evidence before closing scoped local review; the adapter does not launch the reviewer on its behalf. Plugin tool input schemas are advisory: the structured checklist accepts extra step IDs outside its declared pattern because OpenCode does not enforce plugin input schemas server-side.

- OpenCode has no marketplace or `/add-plugin`. Install is `opencode plugin add` or the `plugins` array.
- OpenCode has no Custom Modes. The slash command activates the methodology for a session and a session instruction entry keeps it active through follow-ups, compaction, and plugin reloads. `/poteto-mode-exit` removes that session's pstack entries and restores native behavior without changing preferences, conversation history, or other sessions.
- Native `subagent` still starts in the parent's directory. For worktree-backed delegation the adapter creates a linked child, moves it, waits for OpenCode to confirm its directory, and only then sends the brief. If placement fails, it never sends the brief or falls back to the parent checkout. This is placement, not a sandbox for absolute paths or arbitrary shell commands. The calling coordinator still chooses the agent, model, scope, and whether the upstream workflow calls for separate worktrees.
- Cursor `/loop` wake semantics are approximated with automations.
- Bugbot and Cursor's managed cloud agents need external integrations.
- Cursor model families only exist when those providers are configured. Panels use available providers.
- A concrete role assignment, including a different provider, uses OpenCode's explicit `model` at spawn.
- `benny` automations are vendored but not installed.

### Proposed OpenCode-native `/deslop`

[`deslop`](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/deslop/SKILL.md) is a separate Cursor Team Kit skill, not an alias for pstack's prose-focused `unslop` or its independent `no-comments` review. [The pstack guide](../vendor/pstack/docs/guide/05-build-and-clean.md) explicitly allows asking for the same cleanup in plain words when the tool is unavailable.

Port the linked MIT-licensed skill as an opt-in OpenCode skill and slash command, retaining Cursor Team Kit credit and its license outside `vendor/pstack/`. Give it the branch diff (including intended staged or worktree changes) against the intended base. Before committing, remove only diff-introduced noise: narrating comments, unsupported guards and catches, type escapes such as casts to `any`, unnecessary nesting, dead compatibility paths, and unrelated edits. Keep behavior unchanged, rerun the affected checks, and report what changed or why no cleanup was needed. A formatter, green tests, or a comment sweep alone does not satisfy it. Review the resulting implementation independently; cleanup is not a substitute for that review. This command is not yet implemented or counted in acceptance.

## Workflow acceptance

Run cases individually with a hard deadline for each case and its requests. Save the parent and child evidence before interrupting only sessions created by that case. Distinguish confirmed compliance failures from ambiguous route selection, missing capabilities, and execution timeouts. A deadline after delegation but before review is not a workflow pass.

A scripted OpenCode 2.4.1 regression tested a real follow-up prompt without re-reading the selected playbook. The parent write to a scoped file was blocked, as was checklist completion after a child wrote the files and only then loaded the required leaf. A fresh worker read the leaf before changing either file and the handoff was accepted. The resulting behavior passed an independent `node --test`; a plain session was unaffected. This is evidence for the checkpoints, not a full methodology acceptance run.

A separate scripted OpenCode 2.4.1 fixture dispatched two linked worktree workers in one turn. Each child transcript recorded the location change before its first prompt; `pwd` and a relative write agreed with that location. The coordinator received both background results and its handoff accepted the two changes. Independent Git and file checks found only the assigned write in each worktree and a clean, unchanged parent checkout. A third, stale worktree entry failed placement before any worker prompt or model request. This verifies the adapter sequence, not natural workflow selection or filesystem sandboxing.

The OpenCode 2.4.1 model and exit fixture kept the saved sheet byte-for-byte through preview and a confirmation attempted from another session. A matching confirmation changed only the requested budget and role. Child sessions and their assistant messages recorded distinct Feature and Bug Fix models. Perf Issue (`inherit-parent`), Hillclimb (`auto`), and an explicit request for the parent's model all kept the parent model and variant. After `/poteto-mode-exit`, the next request had the same tools as a plain session and native `todowrite` succeeded. The pstack entries were removed, an unrelated instruction survived, another Poteto session remained active, and re-entry began without the previous checklist. These are scripted integration checks, not evidence of uncoached workflow selection.

| Case | Evidence to require |
| --- | --- |
| Plain session | A completed normal response; neither the action layer nor the fallback todo tool in its model context |
| Focused feature | The selected playbook and applicable skills loaded before their steps; a workflow todo list; scoped delegation and model routing; a reviewed diff and matching-surface verification |
| Large, cross-cutting work | Evidence for the selected upstream route, then a definition of done and verification baseline where required. Inspect actual phase, Swarm, Arena, and review evidence where that route calls for them. Do not assume `figure-it-out` for every complex prompt. |
| Delivery and persistence | Required review and delivery evidence for an authorized task; tell a cold service restart apart from a plugin reload and require evidence from a new turn after compaction |

Repeat the workflow cases with more than one main model. Evaluate delegation counts against the chosen workflow and decomposition, not a constant. Use the trace of completed tool calls, child sessions, and artifacts rather than agent summaries or the presence of instructions alone. Classify missing external tooling separately from skipped steps.

For a beta, verify the exact archive through a clean one-command install and installed positive and negative adapter regressions. In the six uncoached bug, coupled-feature, and cross-cutting runs, score product checks separately from upstream workflow fidelity. Record model misroutes and skips as workflow misses, not successful workflows. A documented model miss is not by itself an adapter defect. False completion, lost valid evidence, product failures, or an unverified or timed-out case are not beta acceptance passes.

On OpenCode 2.4.1, the plain-session probe and an explicit fallback-todo smoke test passed. The separate cross-cutting planning probes on DeepSeek V4.1 Flash and DeepSeek V4 Pro both timed out at 85 seconds. Both opened `multi-phase-plan.md` first. Flash later read `figure-it-out/SKILL.md`; Pro did not in that run. Neither wrote a workflow todo before the deadline. These runs do not establish reliable initial routing or workflow tracking without an explicit request.

After adding the checklist checkpoint, a guided live test on DeepSeek V4.1 Flash observed two tool errors and a recovery: an incomplete Feature checklist was rejected; an update past step 2 without an `architect` load was rejected; the same update was saved after a completed full read of `architect/SKILL.md`. This was a dry run of the checkpoint, not a completed Feature playbook.

A guided `figure-it-out` dry run advanced to phase C without loading the conditional `architect` skill. The plain-session control also passed. In the repeated organic planning prompt, Flash read and selected `figure-it-out` and saved a checklist, but timed out at 85 seconds before completing the task. Pro completed in 62 seconds and saved a `multi-phase-plan.md` checklist but did not load `figure-it-out`, so it failed the probe's expected-route check. That result does not adjudicate which route is valid for every plan-only prompt.

For the pre-tool checkpoint, the OpenCode 2.4.1 hook probe confirmed that `execute.before` can reject a write with a model-visible error while a subsequent read still succeeds. The live boundary regression then read Feature, rejected a direct write before any todo call, accepted the checklist after a full `architect` read, and verified the successful retry on disk. A plain-session control wrote its fixture without a pstack checkpoint.

A local review dry run read `no-comments` successfully but was blocked from running the review command because it had not created the child session named by that skill. After a successful Comment Sicko spawn with a child session ID, the same command reached the local shell stub. No external review was posted. This proves the spawn prerequisite is observable; it does not certify the quality of the review or that every finding was acted on.

The new cross-cutting planning runs did not prescribe a route. Both Flash and Pro chose `figure-it-out` and saved checklists, but neither reached completion within 85 seconds. Pro's first checklist omitted phases C–E and was rejected; it added them and wrote a planning artifact before the deadline. The run outcomes are timeouts, not routing failures or workflow passes.
