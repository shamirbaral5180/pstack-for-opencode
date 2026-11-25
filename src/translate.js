// Translates the vendored pstack content for OpenCode without editing the vendor
// snapshot. The cache holds a translated copy of the skill tree, so relative
// playbook and reference paths also resolve to translated text.
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { LOOP_SKILL } from "./adapter.js"
import { vendorRoot } from "./paths.js"
import { SETUP_SKILL_BODY } from "./setup-skill.js"

const CACHE_BASE = join(homedir(), ".local", "share", "opencode", "pstack-translated")
const TRANSLATION_VERSION = 17

const SWARM_ORIGINAL =
  'Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the step 3 model, left unset for `auto` or `inherit-parent`. Use `environment: "local"` only when the worker needs access to something on the user\'s computer.'
const SWARM_REPLACEMENT =
  'Create one git worktree per worker with `git worktree add`, then spawn all N workers in one message with `agent: "general"` and the step 3 model, left unset for `auto` or `inherit-parent`. Give each brief its worktree\'s absolute path and require commands to run there.'

// Cursor-only concepts that have no OpenCode equivalent. These run first, so the
// generic token replacements below cannot mangle the sentence around them.
const OPENCODE_CONCEPTS = [
  [
    "pstack is built for Cursor, and it also installs in Claude Code with `/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`. There, each command takes a `pstack:` prefix, such as `/pstack:poteto-mode`. The [Claude Code adapter](../../docs/harness/claude-code.md) maps the Cursor names, and a step that needs a Cursor-only feature, such as Bugbot or Automations, is skipped with a one-line note.",
    "This plugin installs pstack in OpenCode: add the plugin's path to `plugins` in `opencode.jsonc`. Commands have no prefix, such as `/poteto-mode`. A step that needs a Cursor-only feature, such as Bugbot, is skipped with a one-line note.",
  ],
  [
    "Other tools can read the skills, because they use the Agent Skills format. But most workflow skills, including `/poteto-mode`, `/how`, and `/teach`, spawn Cursor subagents, some with per-role models, and Custom Modes and `/loop` are Cursor features, so those parts may not work there.",
    "The skills use the Agent Skills format, so other tools can read them. Most workflow skills, including `/poteto-mode`, `/how`, and `/teach`, spawn `subagent`s, some with per-role models, so those parts need a harness that supports subagents.",
  ],
  [
    "give the user the file's public copy: `https://github.com/cursor/plugins/blob/main/pstack/` followed by its path.",
    "give the user the file's absolute path inside the installed plugin.",
  ],
  [
    "an inline mining pass (see step 1), Cursor's built-in `create-skill` (authoring), and the **unslop** skill",
    "an inline mining pass (see step 1), direct authoring (step 2), and the **unslop** skill",
  ],
  [
    "Cursor's `/loop` command (a built-in, not a pstack skill)",
    "an OpenCode automation (the automation tool, not a pstack skill)",
  ],
  ["Cursor's `/loop` command", "an OpenCode automation"],
  ["Each owner is a Cursor cloud agent", "Each owner is a local worker in its own worktree"],
  ["each a Cursor cloud agent", "each a local verifier in its own worktree"],
  [
    "the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`)",
    "the project's deslop tooling",
  ],
  [
    "- `/deslop`, `control-cli`, and `control-ui` ship in the `cursor-team-kit` plugin.",
    "- `/deslop` and the project's UI and CLI drivers are project tooling.",
  ],
  [
    "- `/loop` and `/create-skill` are Cursor built-ins.",
    "- The schedule is an OpenCode automation.",
  ],
  [
    "- Cursor's docs list Custom Modes in the Agents Window and the CLI. Elsewhere, start each new task with `/poteto-mode`.",
    "- Start each new task with `/poteto-mode`. There is no separate mode switcher.",
  ],
  [
    "Link [Cursor's skills docs](https://cursor.com/docs/skills) when this comes up.",
    "Link the OpenCode docs (https://opencode.ai/docs) when this comes up.",
  ],
  [
    "Use Cursor's built-in `create-skill` skill to author the skill.",
    "Write the SKILL.md directly, following the format below.",
  ],
  [
    "1. Use the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).",
    "1. Write the SKILL.md directly, following the authoring format in this playbook.",
  ],
  ["via create-skill + unslop", "via direct authoring + unslop"],
  ["follow `create-skill`'s YAML rules", "follow the YAML rules below"],
  ["`create-skill`'s writing guidelines", "the writing guidelines below"],
  [
    "A `create-skill`-style test/iterate benchmark loop",
    "A skill-authoring test/iterate benchmark loop",
  ],
  ["`create-skill` alone, no mining required", "write the skill directly, no mining required"],
  ["`create-skill`", "direct authoring"],
  ["not Cursor's built-in babysit skill", "not a built-in babysit skill"],
  [
    "can start Cursor's own skill for the same job instead",
    "can start another skill for the same job instead",
  ],
  ["Cursor's Plan Mode works alongside it.", "OpenCode's plan agent works alongside it."],
  ["If Cursor also exposes a models API or CLI", "If OpenCode exposes a models API or CLI"],
  ["~/Library/Application Support/Cursor", "~/Library/Application Support/OpenCode"],
  ["# Bugbot triage", "# Review-bot triage"],
  ["Triage Bugbot skeptically", "Triage review-bot comments skeptically"],
  ["Bugbot", "the review bot"],
]

const TEXT_REPLACEMENTS = [
  ...OPENCODE_CONCEPTS,
  [SWARM_ORIGINAL, SWARM_REPLACEMENT],
  [
    "Spawn one Task subagent with `subagent_type: generalPurpose` and `readonly: true` that explores and explains in one pass.",
    'Spawn one `subagent` with `agent: "pstack:readonly"` that explores and explains in one pass.',
  ],
  ["every Task spawn", "every `subagent` spawn"],
  [
    "Transcripts live at `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and other slashes replaced with hyphens. Read only the current workspace's history unless the user asks for another workspace.",
    "Transcripts are OpenCode sessions. Use `opencode session list --format json` to list this workspace's sessions, then `opencode session export <id>` to read one. Read only the current workspace's history unless the user asks for another workspace.",
  ],
  [
    "~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl",
    "OpenCode session exports (`opencode session list --format json`; `opencode session export <id>`)",
  ],
  ["`agent-transcripts/` directory", "OpenCode session history"],
  ["agent-transcripts/", "OpenCode session history"],
  ["~/.cursor/rules/pstack-models.mdc", "~/.config/opencode/pstack-models.md"],
  ["~/.cursor/skills/", "~/.config/opencode/skills/"],
  ["~/.cursor/agents/", "~/.config/opencode/agents/"],
  ["~/.cursor/commands/", "~/.config/opencode/commands/"],
  [".cursor/skills/", ".opencode/skills/"],
  [".cursor/agents/", ".opencode/agents/"],
  [".cursor/commands/", ".opencode/commands/"],
  [".cursor/automations/", "OpenCode automations"],
  [".cursor/settings.json", "opencode.jsonc"],
  [".cursor/rules/", "AGENTS.md"],
  ["~/.cursor/", "~/.config/opencode/"],
  [".cursor/", ".opencode/"],
  ["https://api2.cursor.sh/", "https://<your-automation-host>/"],
  [".cursor-plugin/plugin.json", "plugin.json"],
  ["subagent_type: generalPurpose", 'agent: "general"'],
  ['subagent_type: "poteto-agent"', 'agent: "pstack:poteto-agent"'],
  ["subagent_type: poteto-agent", 'agent: "pstack:poteto-agent"'],
  ['subagent_type: "comment-sicko"', 'agent: "pstack:comment-sicko"'],
  ["subagent_type: comment-sicko", 'agent: "pstack:comment-sicko"'],
  ["subagent_type", "agent"],
  ["readonly: true", 'agent: "pstack:readonly"'],
  ["run_in_background: true", "background work"],
  ["readonly strips MCP", "read-only mode has no MCP tools"],
  ["`background work`", "background (subagents always run in the background)"],
  ["is_background: true", ""],
  ["is_background: false", ""],
  ['environment: "cloud"', "a worktree"],
  ['environment: "local"', "the local checkout"],
  ["cloud_base_branch", "worktree base"],
  ['isolation: "worktree"', "a worktree"],
  ["`Task`", "`subagent`"],
  ["AskUserQuestion", "question"],
  ["TaskCreate", "todowrite"],
  ["TaskUpdate", "todowrite"],
  ["TodoWrite", "todowrite"],
  ["`/deslop` from cursor-team-kit", "the project's deslop tooling"],
  ["cursor-team-kit", "the project tooling"],
  ["control-ui", "the project verification skill"],
  ["control-cli", "the project verification skill"],
  ["/loop", "an OpenCode automation"],
  ["An `auto` or `inherit-parent` entry is the parent model, so omit `model` and spawn `generalPurpose`.", 'An `auto` or `inherit-parent` entry runs on the parent model, so omit `model` and use `agent: "general"`.'],
  ["spawn `generalPurpose`", 'spawn `agent: "general"`'],
  ["`generalPurpose`", '`agent: "general"`'],
  ["generalPurpose", 'agent: "general"'],
  ["Task tool", "subagent tool"],
  ["vendor check", "family check"],
  ["same family", "same family"],
  ["spawn one readonly judge", 'spawn one judge with `agent: "pstack:readonly"`'],
  ["by default `inherit-parent`, `inherit-parent`", "using the sheet line"],
  ["by default `inherit-parent`", "using the sheet line"],
  ["claude-opus-5-5-xhigh-fast", "inherit-parent"],
  ["claude-opus-5-5-high-fast", "inherit-parent"],
  ["claude-fable-5-2-high", "inherit-parent"],
  ["gemini-4-neon-xhigh", "inherit-parent"],
  ["claude-opus-*", "inherit-parent"],
  ["claude-fable-*", "inherit-parent"],
  ["gemini-*", "inherit-parent"],
  ["claude-*", "inherit-parent"],
  ["Opus 5.5", "the code role model"],
  ["Fable 5.2", "the strongest configured model"],
  ["Gemini", "the configured provider"],
  ["another vendor's model", "a model from a different family"],
  [
    "Families go by prefix, and the longest match wins: `inherit-parent`, `inherit-parent`, and `inherit-parent`, after dropping a leading `cursor-`. Any other slug's family is its text before the first hyphen.",
    "A family is the model's `family` from the catalog (the vendor, such as deepseek or glm); a model with no family uses its provider prefix.",
  ],
  [
    "The judge is never from the parent's vendor, and Fable counts as Claude for that check, so use the first entry from another vendor.",
    "The judge is never from the parent's family, so use the first entry whose family differs.",
  ],
  [
    "by default `inherit-parent`, `inherit-parent`, and `inherit-parent`",
    "from the sheet line; never hardcode a model",
  ],
]

const PROSE_REPLACEMENTS = [
  [/`cursor-[a-z0-9-]+`/gi, "`inherit-parent`"],
  [/\bclaude-[a-z0-9-*]+/gi, "inherit-parent"],
  [/\bgemini-[a-z0-9-*]+/gi, "inherit-parent"],
  [/`Task`/g, "`subagent`"],
  [/`Agent`/g, "`subagent`"],
  [/by default `inherit-parent`(?:, `inherit-parent`)+/g, "using the sheet line"],
  [/`an OpenCode automation`/g, "an automation"],
  [
    /the code role model always runs its `-fast` slug\./g,
    "the code role model always runs its fastest available variant.",
  ],
  [
    /A the configured provider seat runs at `inherit-parent` unless its line names another level\./g,
    "A seat with no named level runs at its provider's top variant.",
  ],
]

export function translateText(text, root = vendorRoot) {
  let output = text.replaceAll("~/.cursor/plugins/", `${root.replaceAll("\\", "/")}/`)
  for (const [from, to] of TEXT_REPLACEMENTS) output = output.replaceAll(from, to)
  for (const [pattern, to] of PROSE_REPLACEMENTS) output = output.replace(pattern, to)
  output = output.replace(
    /~\/\.cursor\/projects\/[^\s`]+\/agent-transcripts\/[^\s`]+/g,
    "OpenCode session exports (`opencode session list --format json`; `opencode session export <id>`)",
  )
  output = output.replace(/~\/\.config\/opencode\/projects\/[^\s`]+/g, "OpenCode session history")
  output = output.replace(
    /Transcripts live at `[^`]+`[^\n]*/g,
    "Transcripts are OpenCode sessions. Use `opencode session list --format json` to list this workspace's sessions, then `opencode session export <id>` to read one. Every export holds the full message history.",
  )
  return output
}

function walk(directory) {
  const entries = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) entries.push(...walk(path))
    else if (entry.isFile()) entries.push(path)
  }
  return entries
}

function copyTree(source, destination, root, { translate }) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        try {
          symlinkSync(from, to, "junction")
        } catch {
          copyTree(from, to, root, { translate: false })
        }
        continue
      }
      copyTree(from, to, root, { translate })
      continue
    }
    if (!entry.isFile()) continue
    if (translate && entry.name.endsWith(".md")) {
      writeFileSync(to, translateText(readFileSync(from, "utf8"), root))
    } else {
      copyFileSync(from, to)
    }
  }
}

function writeAdapter(root) {
  const destination = join(root, "adapter", "loop")
  mkdirSync(destination, { recursive: true })
  writeFileSync(join(destination, "SKILL.md"), LOOP_SKILL.content)
}

export function ensureTranslated() {
  const manifest = JSON.parse(readFileSync(join(vendorRoot, "..", "MANIFEST.json"), "utf8"))
  const key = createHash("sha256").update(`${manifest.root}:${TRANSLATION_VERSION}`).digest("hex").slice(0, 12)
  const root = join(CACHE_BASE, key)
  mkdirSync(root, { recursive: true })
  writeAdapter(root)
  if (existsSync(join(root, ".complete"))) return { root, fresh: false }

  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  writeAdapter(root)
  copyTree(join(vendorRoot, "skills"), join(root, "skills"), root, { translate: true })
  writeFileSync(join(root, "skills", "setup-pstack", "SKILL.md"), SETUP_SKILL_BODY)
  copyTree(join(vendorRoot, "agents"), join(root, "agents"), root, { translate: true })
  if (existsSync(join(vendorRoot, "docs", "guide"))) {
    copyTree(join(vendorRoot, "docs", "guide"), join(root, "docs", "guide"), root, { translate: true })
  }
  if (existsSync(join(vendorRoot, "README.md"))) {
    writeFileSync(join(root, "README.md"), translateText(readFileSync(join(vendorRoot, "README.md"), "utf8"), root))
  }
  writeFileSync(join(root, ".complete"), manifest.root)
  return { root, fresh: true }
}
