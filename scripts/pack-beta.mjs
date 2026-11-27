import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = join(import.meta.dirname, "..")
const { name, version, files } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const checkOnly = process.argv[2] === "--check"
const destination = resolve(process.argv[2] ?? ".")
const run = (bin, args, cwd) => execFileSync(bin, args, { cwd, stdio: "inherit" })
run(process.execPath, ["scripts/generate.mjs"], root)
run(process.execPath, ["scripts/verify.mjs"], root)

const staging = mkdtempSync(join(tmpdir(), `${name}-pack-`))
const pkg = join(staging, "package")
const archive = join(destination, `${name}-${version}.tgz`)
try {
  mkdirSync(pkg)
  for (const file of [...files, "package.json"]) cpSync(join(root, file), join(pkg, file), { recursive: true })

  // npm's directory packlist omits parts of the verified vendored snapshot.
  const packed = join(staging, "release.tgz")
  run("tar", ["-czf", packed, "package"], staging)
  const verify = join(staging, "verify")
  mkdirSync(verify)
  run("tar", ["-xzf", packed], verify)
  run(process.execPath, ["scripts/verify.mjs"], join(verify, "package"))
  if (!checkOnly) {
    mkdirSync(destination, { recursive: true })
    cpSync(packed, archive, { force: false, errorOnExist: true })
    const integrity = createHash("sha512").update(readFileSync(archive)).digest("base64")
    console.log(`${archive}\nsha512-${integrity}`)
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}
