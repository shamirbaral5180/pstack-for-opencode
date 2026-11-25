// OpenCode-native body for the /setup-pstack skill. The vendored upstream skill
// is Cursor-specific (model families, `-fast` slugs, old-default normalization),
// so the port registers this body instead and writes it into the translated
// cache at the same path the registration points to.
export const SETUP_SKILL_BODY = `# Setup pstack

Write \`~/.config/opencode/pstack-models.md\`, the model sheet that sets pstack's model per role. The sheet is read fresh on every request, so changes apply without a restart.

## Roles

One line per role, in this order:

- \`feature, refactoring\`, \`bug-fix\`, \`perf-issue\`, \`hillclimb\` - the code roles.
- \`judgment and prose\` - prose and judgment.
- \`arena runners\` and \`interrogate reviewers\` - panels. Comma-separated lists; one subagent runs per entry, alias entries included, so the list length sets the count.
- \`arena cross-judge pool\` - a list, but Arena runs one judge. Order it by preference.
- \`swarm workers\` - the default model for every worker.

## Budget

Ask the user to pick a budget. Offer these three labels with this exact wording:

- \`large — xhigh reasoning\`
- \`medium — high reasoning\`
- \`small — medium reasoning\`

Name the current budget when the sheet records one. With no sheet, \`large\` matches the defaults.

## Assign models

1. Read the model catalog in this prompt. Use only those refs, written as \`provider/model\` or \`provider/model#variant\`.
2. For each role, pick a ref from the catalog. Prefer different providers for the panels and the judge pool. The judge must come from a provider other than the parent chat model's.
3. Apply the budget's target effort to each ref. The ladder is \`xhigh\` > \`high\` > \`medium\` > \`low\`. \`large\` keeps the default, \`medium\` lowers it one step, \`small\` lowers it two. Take the model's nearest variant at or below the target; a model with no variants keeps its base ref.
4. \`inherit-parent\` or \`auto\` means the role runs on the parent chat model. These never change with the budget.

## Write

Write \`~/.config/opencode/pstack-models.md\` as plain Markdown: a \`# defaults: 3\` line, a \`# budget: <label> (<effort>)\` line, and one line per role. Never write a ref that is not in the catalog. Overwrite the whole file so re-runs stay idempotent.
`
