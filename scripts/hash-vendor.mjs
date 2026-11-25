// Records a sha256 for every vendored pstack file, so the adapter can prove
// it delivers the original content without editing it.
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

const root = join(import.meta.dirname, "..")
const vendor = join(root, "vendor", "pstack")
const out = join(root, "vendor", "MANIFEST.json")

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const files = walk(vendor).sort()
const manifest = { files: {}, fileCount: files.length, bytes: 0 }
const combined = createHash("sha256")

for (const file of files) {
  const key = relative(vendor, file).split(sep).join("/")
  const bytes = readFileSync(file)
  const hash = createHash("sha256").update(bytes).digest("hex")
  manifest.files[key] = hash
  manifest.bytes += statSync(file).size
  combined.update(key).update("\0").update(hash).update("\n")
}

manifest.root = combined.digest("hex")
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n")
console.log(`hashed ${manifest.fileCount} files, ${manifest.bytes} bytes, root ${manifest.root}`)
