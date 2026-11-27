// OpenCode-native body for the /setup-pstack skill. The vendored upstream skill
// is Cursor-specific (model families, `-fast` slugs, old-default normalization),
// so the port registers this body instead and writes it into the translated
// cache at the same path the registration points to.
export const SETUP_SKILL_BODY = `# Setup pstack

Configure the per-role model sheet at the path reported by \`/setup-pstack\`. If this skill was loaded on its own, first ask the user to run \`/setup-pstack\` to see the saved choices and available models. The sheet is read fresh on every pstack request.

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

1. Read the catalog and the saved choices in the setup prompt. Show the current roles and flag unavailable choices; do not replace them without asking. Offer confirmed \`provider/model\` and \`provider/model#variant\` refs, plus \`inherit-parent\` and \`auto\`.
2. Preserve the user's existing refs, variants, panel order and aliases unless the user asks to change them. The budget supplies target effort for recommendations; show any proposed change to an existing variant explicitly. For recommendations, take the nearest available variant at or below the target. A model with no suitable variant keeps its base ref.
3. Both aliases run on the parent chat model. They count as panel seats but cannot cross-judge. Prefer different model families on panels, and order the cross-judge pool by preference.

## Preview and confirm

Use \`pstack_propose_models\` with the requested budget and only the role overrides the user wants. Without a saved sheet, omitted roles start from the budget recommendations. On a rerun, omission keeps the saved value, or leaves the role unset if it was unset.

Show the proposed changes and relay the exact \`/setup-pstack apply <token>\` command returned by the tool. The user must run that command in this session to save. They can inspect the exact proposal with \`/setup-pstack preview\` or discard it with \`/setup-pstack cancel\`. Never edit the sheet directly, run the confirmation for the user, or say a preview was saved.

After setup, if the project lacks an app verification skill or harness, offer once to set one up. If it lacks formal verification, offer once to create a formal verification skill. Do not start either without agreement.
`
