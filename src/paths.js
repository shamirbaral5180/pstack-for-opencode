import { homedir } from "node:os"
import { dirname, isAbsolute, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

// src/index.js -> package root
export const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const vendorRoot = join(root, "vendor", "pstack")
export const modelsPath = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "opencode",
  "pstack-models.md",
)

export const portable = (path) => path.replaceAll("\\", "/")

const nativePath = (path) => process.platform === "win32" ? portable(path) : path
export function absolutePathKey(path) {
  if (typeof path !== "string" || path.includes("\0") || !isAbsolute(nativePath(path))) return
  const key = normalize(nativePath(path))
  return process.platform === "win32" ? portable(key).toLowerCase() : key
}
