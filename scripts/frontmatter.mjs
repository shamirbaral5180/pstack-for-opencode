// A small YAML frontmatter parser for pstack's SKILL.md and agent files.
// It covers the shapes these files use: scalars, quotes, inline lists, nested
// metadata, block scalars, comments, CRLF, and a BOM. It is not a full YAML
// implementation, and it fails loudly when the frontmatter is missing.
const DELIMITER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function parseFrontmatter(text, file = "<input>") {
  const source = text.replace(/^\uFEFF/, "")
  const match = DELIMITER.exec(source)
  if (!match) throw new Error(`Missing frontmatter: ${file}`)
  return { data: parseBlock(match[1], file), body: source.slice(match[0].length) }
}

function parseBlock(block, file) {
  const lines = block.split(/\r?\n/)
  const root = {}
  const stack = [{ indent: -1, map: root }]

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue
    const indent = raw.length - raw.trimStart().length
    const line = stripComment(raw.trim())

    const pair = /^([^:]+):(.*)$/.exec(line)
    if (!pair) throw new Error(`Unparseable frontmatter line in ${file}: ${raw}`)
    const key = pair[1].trim()
    let value = pair[2].trim()

    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop()
    const map = stack.at(-1).map

    if (value === "") {
      const child = {}
      map[key] = child
      stack.push({ indent, map: child })
      continue
    }

    if (/^[|>][+-]?$/.test(value)) {
      const collected = []
      let cursor = index + 1
      let blockIndent = undefined
      for (; cursor < lines.length; cursor += 1) {
        const next = lines[cursor]
        const nextIndent = next.length - next.trimStart().length
        if (next.trim() && nextIndent <= indent) break
        if (!next.trim()) {
          collected.push("")
          continue
        }
        if (blockIndent === undefined) blockIndent = nextIndent
        collected.push(next.slice(Math.min(blockIndent, nextIndent)))
      }
      index = cursor - 1
      map[key] = blockScalar(collected, value)
      continue
    }

    map[key] = parseScalar(value)
  }

  return root
}

function blockScalar(lines, indicator) {
  while (lines.length && lines.at(-1) === "") lines.pop()
  const folded = indicator.startsWith(">")
  const text = folded ? fold(lines) : lines.join("\n")
  return indicator.endsWith("-") ? text : text + "\n"
}

function fold(lines) {
  let output = ""
  for (const line of lines) {
    if (line === "") output += "\n"
    else if (output === "" || output.endsWith("\n")) output += line
    else output += " " + line
  }
  return output
}

function parseScalar(value) {
  if (value.startsWith("[") && value.endsWith("]")) return parseList(value)
  if (value.startsWith('"') && value.endsWith('"')) return unescapeDouble(value.slice(1, -1))
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null" || value === "~") return null
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  return value
}

function parseList(value) {
  const inner = value.slice(1, -1).trim()
  if (!inner) return []
  return splitList(inner).map((item) => parseScalar(item.trim()))
}

function splitList(inner) {
  const items = []
  let current = ""
  let quote = undefined
  for (const character of inner) {
    if (quote) {
      current += character
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if (character === ",") {
      items.push(current)
      current = ""
      continue
    }
    current += character
  }
  items.push(current)
  return items
}

function stripComment(value) {
  let quote = undefined
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === "\\" && quote === '"') index += 1
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === "#" && (index === 0 || value[index - 1] === " ")) return value.slice(0, index).trimEnd()
  }
  return value
}

function unescapeDouble(value) {
  return value.replace(/\\(["\\/nrtbf])/g, (_, escape) => {
    const table = { '"': '"', "\\": "\\", "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }
    return table[escape] ?? escape
  })
}
