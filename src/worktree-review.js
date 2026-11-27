import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { promisify, TextDecoder } from "node:util"
import { absolutePathKey } from "./paths.js"

const run = promisify(execFile)
const maxFileBytes = 1024 * 1024
const git = async (cwd, ...args) => (await run("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
  cwd, windowsHide: true, timeout: 5000, maxBuffer: 4 * maxFileBytes, encoding: "buffer",
})).stdout
const decode = (bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
const text = async (cwd, ...args) => decode(await git(cwd, ...args)).trimEnd()
const entries = (bytes) => decode(bytes).split("\0").filter(Boolean)
const oid = (value) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const hash = (value) => createHash("sha256").update(value).digest("hex")
const fileKey = (path) => process.platform === "win32" ? path.toLowerCase() : path

async function commonGitDirectory(cwd) {
  if (absolutePathKey(await text(cwd, "rev-parse", "--show-toplevel")) !== absolutePathKey(cwd)) return
  return absolutePathKey(await realpath(await text(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")))
}

const diffFlags = ["--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none"]
async function changeSet(cwd, base) {
  const [raw, staged, unstaged, untracked, flags] = await Promise.all([
    git(cwd, "diff", "--raw", "-z", ...diffFlags, base, "--"),
    git(cwd, "diff", "--cached", "--name-only", "-z", ...diffFlags, base, "--"),
    git(cwd, "diff", "--name-only", "-z", ...diffFlags, "--"),
    git(cwd, "ls-files", "--others", "--exclude-standard", "-z"),
    git(cwd, "ls-files", "-v", "-z"),
  ])
  if (entries(flags).some((entry) => !entry.startsWith("H "))) return
  const differentFromIndex = new Set(entries(unstaged))
  if (entries(staged).some((name) => differentFromIndex.has(name))) return
  const changed = entries(raw)
  const modes = new Map(entries(untracked).map((name) => [name, undefined]))
  for (let i = 0; i < changed.length; i += 2) {
    const mode = /^:\d+ (100(?:644|755)) [a-f0-9]+ [a-f0-9]+ [AM]$/.exec(changed[i])?.[1]
    if (!mode || !changed[i + 1] || modes.has(changed[i + 1])) return
    modes.set(changed[i + 1], mode)
  }
  if (!modes.size || modes.size > 100) return
  const root = await realpath(cwd)
  const files = new Map()
  for (const [name, gitMode] of [...modes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (/[\\:\x00-\x1f]/.test(name) || name.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return
    const path = resolve(root, name)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > maxFileBytes || absolutePathKey(await realpath(path)) !== absolutePathKey(path)) return
    const bytes = await readFile(path)
    const after = await lstat(path)
    if (stat.ino !== after.ino || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs ||
      stat.size !== bytes.length || bytes.includes(0)) return
    const mode = gitMode ?? (process.platform !== "win32" && stat.mode & 0o111 ? "100755" : "100644")
    if (files.has(fileKey(name))) return
    files.set(fileKey(name), { name, mode, hash: hash(bytes), body: decode(bytes) })
  }
  const digest = hash(JSON.stringify([...files.values()].map(({ name, mode, hash }) => [name, mode, hash])))
  return { files, digest }
}

export async function worktreeReviewEvidence(parent, checkout) {
  try {
    const [parentGit, reviewGit, head] = await Promise.all([
      commonGitDirectory(parent), commonGitDirectory(checkout), text(checkout, "rev-parse", "HEAD"),
    ])
    if (!parentGit || parentGit !== reviewGit || !oid(head)) return
    const base = await text(parent, "merge-base", "HEAD", head)
    if (!oid(base)) return
    const changes = await changeSet(checkout, base)
    if (changes) return { base, digest: changes.digest }
  } catch {
    // A checkout without verifiable Git evidence must be reviewed in place.
  }
}

function fullRead(call, checkout, file) {
  const { input, content, metadata } = call.state
  if (metadata?.truncated !== false || (input.offset ?? 1) !== 1 || typeof input.path !== "string") return false
  const result = content?.find((part) => part.type === "text")?.text ?? ""
  const header = /^Read file ([^\r\n]+), lines 1-(\d+)\r?\n/.exec(result)
  const expected = absolutePathKey(resolve(checkout, file.name))
  const readKey = (path) => absolutePathKey(isAbsolute(path) ? path : resolve(checkout, path))
  if (!header || readKey(input.path) !== expected || readKey(header[1]) !== expected) return false
  const lines = file.body.replace(/\r?\n$/, "").split(/\r?\n/)
  return Number(header[2]) === lines.length && (input.limit ?? Infinity) >= lines.length &&
    result.slice(header[0].length) === lines.map((line, i) => `${i + 1}: ${line}`).join("\n")
}

export async function matchesWorktreeReview({ stamp, parent, checkout, paths, reads }) {
  if (!oid(stamp?.base) || !/^[a-f0-9]{64}$/.test(stamp?.digest ?? "")) return false
  const [parentGit, reviewGit, final, reviewed] = await Promise.all([
    commonGitDirectory(parent), commonGitDirectory(checkout), changeSet(parent, stamp.base), changeSet(checkout, stamp.base),
  ])
  if (!parentGit || parentGit !== reviewGit || final?.digest !== stamp.digest || reviewed?.digest !== stamp.digest) return false
  return [...paths].every((path) => final.files.has(fileKey(path))) &&
    [...final.files.values()].every((file) => reads.some((call) => fullRead(call, checkout, file)))
}
