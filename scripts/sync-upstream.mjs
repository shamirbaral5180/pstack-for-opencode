// Refreshes the vendored snapshot from a local pstack checkout, then rehashes
// and regenerates. Use when upstream changes. The adapter never edits vendor/.
import { cpSync, existsSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
const root = join(import.meta.dirname, "..")
const source = resolve(process.argv[2] ?? join(root, "..", "pstack"))
const destination = join(root, "vendor", "pstack")

if (!existsSync(join(source, "skills")) || !existsSync(join(source, "agents"))) {
  console.error(`Not a pstack checkout: ${source}`)
  console.error("Pass the path as the first argument, or place the original at ../pstack.")
  process.exit(1)
}

rmSync(destination, { recursive: true, force: true })
cpSync(source, destination, {
  recursive: true,
  filter: (path) => {
    const parts = path.split(/[\\/]/)
    if (parts.includes(".git")) return false
    // The local AGENTS.md is a workspace spec, not part of upstream pstack.
    return !(parts.at(-1) === "AGENTS.md" && resolve(path) === resolve(source, "AGENTS.md"))
  },
})

for (const script of ["hash-vendor.mjs", "generate.mjs"]) {
  const result = spawnSync(process.execPath, [join(root, "scripts", script)], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`synced ${source} -> ${destination}`)
