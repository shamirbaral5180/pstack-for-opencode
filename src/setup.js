import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { modelsPath } from "./paths.js"
import { normalizeSheet, recommendedSheet } from "./sheet.js"

export function ensureModelSheet(target = modelsPath, catalog = [], currentRef) {
  if (existsSync(target)) {
    const current = readFileSync(target, "utf8")
    const next = normalizeSheet(current, catalog, currentRef)
    if (next === current) return { created: false, updated: false, path: target }
    writeFileSync(target, next)
    return { created: false, updated: true, path: target }
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, recommendedSheet(catalog, currentRef))
  return { created: true, updated: false, path: target }
}
