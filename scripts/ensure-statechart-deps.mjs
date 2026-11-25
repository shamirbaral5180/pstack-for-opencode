// npm omits nested node_modules from a package, and the statechart skill ships
// its own dependencies. Reinstall them after a package install so the skill's
// scripts keep working. A local checkout already has them, so this is a no-op.
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const scripts = join(root, "vendor", "pstack", "skills", "statechart", "scripts")
const modules = join(scripts, "node_modules")

if (!existsSync(join(scripts, "package.json"))) {
  console.log("statechart scripts not present, skipping dependency install")
  process.exit(0)
}

if (existsSync(modules)) {
  console.log("statechart dependencies already present")
  process.exit(0)
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const result = spawnSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: scripts,
  stdio: "inherit",
  shell: true,
})
process.exit(result.status ?? 1)
