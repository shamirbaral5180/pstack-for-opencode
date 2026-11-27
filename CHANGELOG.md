# Changelog

## 0.1.0-beta.3

Unpublished candidate. The final Gate 4 matrix did not pass.

### Adapter changes

- Arena candidates use the saved runner seats rather than the enclosing playbook's implementation model.
- The coordinator still chooses the route using the upstream rule. The adapter validates the chosen workflow without classifying the task.
- Full reads through equivalent absolute paths now count without relaxing principle-read chronology. A verified rollback retires discarded implementation evidence without treating an earlier late read as valid.
- Local review is tracked separately from PR delivery. A worktree review transfers only when every changed file was read in full and the reviewed and final Git changes match. Unmerged changes and subsequent unreviewed edits are rejected.
- PR delivery requires observed ready PR creation and completed upstream steps. A blocked delivery step must be reopened before completion.

### Verification

84 adapter tests passed. A clean installation on OpenCode 2.4.1 from a private registry passed the installed regressions, including matching and stale worktree reviews. All 1,980 vendored files remained byte-identical.

| Final Gate 4 case | DeepSeek | GLM |
| --- | --- | --- |
| Bug fix | 7/7 CLI checks; correct route and independent review | 7/7; correct route and independent review |
| Coupled feature | 12/12; reviewed, but skipped Arena despite identifying alternatives | 8/12; timed out after rolling back the implementation |
| Cross-cutting | 14/14; reviewed, but selected Bug Fix | 14/14; selected Bug Fix and timed out with local review open |

Five of six product cases passed. No run falsely completed PR delivery. Neither timeout counts as a pass. See [known limitations](docs/parity.md#known-gaps), including `/deslop` and Cursor's verification drivers.
