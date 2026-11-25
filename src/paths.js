import { homedir } from "node:os"
import { dirname, join } from "node:path"
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
