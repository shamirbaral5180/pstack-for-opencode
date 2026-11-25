export default [
  {
    "name": "architect",
    "description": "Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use for /architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape.",
    "skillId": "pstack-architect"
  },
  {
    "name": "arena",
    "description": "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape.",
    "skillId": "pstack-arena"
  },
  {
    "name": "automate-me",
    "description": "Use for \"automate me\", \"create/update/refresh my -mode skill\", \"turn/capture my preferences or working style into a skill\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via create-skill + unslop, optionally pulling fresh evidence from recent transcripts.",
    "skillId": "pstack-automate-me"
  },
  {
    "name": "benchmark-checklist",
    "description": "Vet a perf measurement (limiter, tuning, limits, errors, repeatability, relevance, and whether the work happened) before you report or act on it. Use when you run a benchmark or report a speedup or regression you measured.",
    "skillId": "pstack-benchmark-checklist"
  },
  {
    "name": "blast-radius",
    "description": "Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust.",
    "skillId": "pstack-blast-radius"
  },
  {
    "name": "bro",
    "description": "Restate the last message in plain human language, with no jargon.",
    "skillId": "pstack-bro"
  },
  {
    "name": "correct",
    "description": "Find the mistakes agents keep repeating in this repo and make each one impossible. Try architecture first, then types, then a lint whose error names the fix, then a test, and write docs last. Prove each check fails on a real past mistake. Repeat this each time the operator corrects you. Use for /correct.",
    "skillId": "pstack-correct"
  },
  {
    "name": "create-formal-verification-skill",
    "description": "Generate a project-local skill that formally verifies the code where a bug costs the most and tests reach the least, in any language, with whichever verification tool fits. Use for /create-formal-verification-skill, \"model-check this race\", \"prove this invariant\", or when concurrency, retries, state machines, parsers, or unsafe code need more than tests.",
    "skillId": "pstack-create-formal-verification-skill"
  },
  {
    "name": "create-verification-skill",
    "description": "Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform. Use for /create-verification-skill, \"make a control skill for this repo\", or when a project has no scripted way to prove UI/CLI/service behavior.",
    "skillId": "pstack-create-verification-skill"
  },
  {
    "name": "figure-it-out",
    "description": "Design an auditable playbook when no narrower one fits: a large migration, an ambitious multi-part change, or work a human reviews after stepping away. Scales rigor to the task, runs a hypothesis loop, and logs decisions. Use for /figure-it-out or 'figure it out'.",
    "skillId": "pstack-figure-it-out"
  },
  {
    "name": "how",
    "description": "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation.",
    "skillId": "pstack-how"
  },
  {
    "name": "in-your-own-words",
    "description": "Restate in your own words what you think the user's goals are and what problem they're trying to solve. Use for /in-your-own-words.",
    "skillId": "pstack-in-your-own-words"
  },
  {
    "name": "interrogate",
    "description": "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive.",
    "skillId": "pstack-interrogate"
  },
  {
    "name": "ketchup",
    "description": "Catch the user up on what changed in this chat since their last message, in plain words and small visuals. List every item waiting on them with what they need to decide it from the reply alone. Use for /ketchup.",
    "skillId": "pstack-ketchup"
  },
  {
    "name": "ketchup-video",
    "description": "Catch the user up like /ketchup, with a short subtitled video of slides for what happened and the waiting calls as text under it. Use for /ketchup-video.",
    "skillId": "pstack-ketchup-video"
  },
  {
    "name": "maintain-formal-verification-skill",
    "description": "Bring a project's formal verification back in line with the code after the code changes: find the commits that touched verified code, update the model, harness, or properties to describe the code as it is now, rerun, and say whether each failure is drift in the verification or a bug in the code. Use for /maintain-formal-verification-skill, \"is the model still true to the code\", or after merges and refactors that touched verified code without rechecking it.",
    "skillId": "pstack-maintain-formal-verification-skill"
  },
  {
    "name": "maintain-verification-skill",
    "description": "Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill or \"audit the verify skill\".",
    "skillId": "pstack-maintain-verification-skill"
  },
  {
    "name": "make-bot-ui",
    "description": "Use when building a custom UI (page, dashboard, buttons) that should wake a Grok Bot over a webhook, when the user must provide a webhook sender key, or when exposing that UI on Tailscale.",
    "skillId": "pstack-make-bot-ui"
  },
  {
    "name": "no-comments",
    "description": "Spawn Comment Sicko, fix accepted findings, and offer encodings for claimed constraints.",
    "skillId": "pstack-no-comments"
  },
  {
    "name": "poteto-help",
    "description": "Guides users through pstack setup, /poteto-mode, and picking the skill, playbook, or principle for a task. Type /poteto-help with a question.",
    "skillId": "pstack-poteto-help"
  },
  {
    "name": "poteto-mode",
    "description": "poteto's agent style for concise, detailed responses, deliberate subagents, unslopped prose, simple code, and verified work. Use for poteto, /poteto-mode, or requests to work in this style.",
    "skillId": "pstack-poteto-mode"
  },
  {
    "name": "principle-attack-the-premise",
    "description": "Apply when two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it.",
    "skillId": "pstack-principle-attack-the-premise"
  },
  {
    "name": "principle-boundary-discipline",
    "description": "Apply when wiring validation, error handling, or framework adapters. Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions.",
    "skillId": "pstack-principle-boundary-discipline"
  },
  {
    "name": "principle-build-the-lever",
    "description": "Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun.",
    "skillId": "pstack-principle-build-the-lever"
  },
  {
    "name": "principle-encode-lessons-in-structure",
    "description": "Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text.",
    "skillId": "pstack-principle-encode-lessons-in-structure"
  },
  {
    "name": "principle-exhaust-the-design-space",
    "description": "Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing.",
    "skillId": "pstack-principle-exhaust-the-design-space"
  },
  {
    "name": "principle-experience-first",
    "description": "Apply when product, UX, or feature-scope tradeoffs come up. Choose user delight over implementation convenience; ship fewer polished features over more rough ones.",
    "skillId": "pstack-principle-experience-first"
  },
  {
    "name": "principle-explain-the-number",
    "description": "Apply before you measure, and before you trust, report, or act on a number you measured: a speedup, a regression, a throughput, a latency, or an eval result. Find what limits it, and rule out that it measured something other than the work you think.",
    "skillId": "pstack-principle-explain-the-number"
  },
  {
    "name": "principle-fix-root-causes",
    "description": "Apply when debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.",
    "skillId": "pstack-principle-fix-root-causes"
  },
  {
    "name": "principle-foundational-thinking",
    "description": "Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious.",
    "skillId": "pstack-principle-foundational-thinking"
  },
  {
    "name": "principle-guard-the-context-window",
    "description": "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads.",
    "skillId": "pstack-principle-guard-the-context-window"
  },
  {
    "name": "principle-laziness-protocol",
    "description": "Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward deletion and the smallest change that solves the problem.",
    "skillId": "pstack-principle-laziness-protocol"
  },
  {
    "name": "principle-make-operations-idempotent",
    "description": "Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs.",
    "skillId": "pstack-principle-make-operations-idempotent"
  },
  {
    "name": "principle-migrate-callers-then-delete-legacy-apis",
    "description": "Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers.",
    "skillId": "pstack-principle-migrate-callers-then-delete-legacy-apis"
  },
  {
    "name": "principle-minimize-reader-load",
    "description": "Apply when reviewing or shaping code that's hard to trace. Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope.",
    "skillId": "pstack-principle-minimize-reader-load"
  },
  {
    "name": "principle-model-the-domain",
    "description": "Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files.",
    "skillId": "pstack-principle-model-the-domain"
  },
  {
    "name": "principle-never-block-on-the-human",
    "description": "Apply when tempted to ask 'should I do X?' on reversible work.",
    "skillId": "pstack-principle-never-block-on-the-human"
  },
  {
    "name": "principle-outcome-oriented-execution",
    "description": "Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code.",
    "skillId": "pstack-principle-outcome-oriented-execution"
  },
  {
    "name": "principle-prove-it-works",
    "description": "Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'",
    "skillId": "pstack-principle-prove-it-works"
  },
  {
    "name": "principle-redesign-from-first-principles",
    "description": "Apply when integrating a new requirement into an existing design.",
    "skillId": "pstack-principle-redesign-from-first-principles"
  },
  {
    "name": "principle-separate-before-serializing-shared-state",
    "description": "Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant.",
    "skillId": "pstack-principle-separate-before-serializing-shared-state"
  },
  {
    "name": "principle-sequence-verifiable-units",
    "description": "Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer.",
    "skillId": "pstack-principle-sequence-verifiable-units"
  },
  {
    "name": "principle-subtract-before-you-add",
    "description": "Apply when sequencing an addition, refactor, or rewrite. Remove dead code, redundant validators, and stub references first, then build on the simpler base.",
    "skillId": "pstack-principle-subtract-before-you-add"
  },
  {
    "name": "principle-test-behavior-not-implementation",
    "description": "Apply when you write, change, or keep a test. Assert what the code's users can observe, so that the test fails when that behavior breaks and keeps passing when only the internals change.",
    "skillId": "pstack-principle-test-behavior-not-implementation"
  },
  {
    "name": "principle-type-system-discipline",
    "description": "Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, exhaust variants, derive from authoritative schemas.",
    "skillId": "pstack-principle-type-system-discipline"
  },
  {
    "name": "recall",
    "description": "Reconstruct your recent working context from your own chat history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work.",
    "skillId": "pstack-recall"
  },
  {
    "name": "reflect",
    "description": "Mine the active transcript for durable learnings and route each to a concrete edit on an existing skill. Use when the user says reflect.",
    "skillId": "pstack-reflect"
  },
  {
    "name": "reframe",
    "description": "Teach the expert words for what the operator is building, borrow words from neighboring fields that solved the same problem, then rewrite their description with them. Use for /reframe.",
    "skillId": "pstack-reframe"
  },
  {
    "name": "setup-pstack",
    "description": "Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for /setup-pstack, \"configure pstack models\", \"pstack budget\", or changing pstack's model choices.",
    "skillId": "pstack-setup-pstack"
  },
  {
    "name": "sharpen",
    "description": "Make a task deeper, not bigger, then rewrite the prompt. Use for /sharpen.",
    "skillId": "pstack-sharpen"
  },
  {
    "name": "show-me-your-work",
    "description": "Keep a reviewable decision trail for long-running or unattended work: a TSV log with one row per decision (what, why, evidence, result). Local by default; commit it when a reviewer needs the trail to trust the result. Use for /show-me-your-work, autonomous or multi-phase runs, or work a human reviews after stepping away.",
    "skillId": "pstack-show-me-your-work"
  },
  {
    "name": "statechart",
    "description": "Check a TLA+ model of a system that moves between states, such as a product flow, a protocol, or a service, and draw it as a Mermaid statechart. The report gives the shortest path to each state that breaks a rule. Use for /statechart, or to show a bug as a path through states.",
    "skillId": "pstack-statechart"
  },
  {
    "name": "swarm",
    "description": "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration.",
    "skillId": "pstack-swarm"
  },
  {
    "name": "tdd",
    "description": "Use only when the user explicitly asks for TDD, a failing test, or a regression test, OR when the bug has an obvious cheap local test target. Skip when the test path is unclear, expensive, integration-heavy, or not requested.",
    "skillId": "pstack-tdd"
  },
  {
    "name": "teach",
    "description": "Explain a body of work plainly so a person actually understands it. Runs the `how` and `why` skills and weaves what they find into one clear explanation. Use for 'teach me this', 'help me really understand X', 'explain this change or subsystem to me'.",
    "skillId": "pstack-teach"
  },
  {
    "name": "technical-writing",
    "description": "Layered technical-writing standard: Diátaxis structure, Google developer style sentences, STE instruction rules, Global English syntax. Use for /technical-writing or when writing or reviewing docs, RFCs, readmes, PR descriptions, or commit messages.",
    "skillId": "pstack-technical-writing"
  },
  {
    "name": "typescript-best-practices",
    "description": "TypeScript best practices. Use when reading or editing any .ts or .tsx file.",
    "skillId": "pstack-typescript-best-practices"
  },
  {
    "name": "unslop",
    "description": "Cut AI tells from any writing.",
    "skillId": "pstack-unslop"
  },
  {
    "name": "why",
    "description": "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Returns a cited read on decisions and tradeoffs. Use how for runtime behavior.",
    "skillId": "pstack-why"
  }
]
