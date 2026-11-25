import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { parseFrontmatter } from "../scripts/frontmatter.mjs"
import { vendorRoot } from "../src/paths.js"

test("parses scalars, booleans, and comments", () => {
  const { data, body } = parseFrontmatter("---\nname: how\ndisable-model-invocation: true # hidden\nicon: crown\n---\n# body\n")
  assert.equal(data.name, "how")
  assert.equal(data["disable-model-invocation"], true)
  assert.equal(data.icon, "crown")
  assert.equal(body, "# body\n")
})

test("parses quoted values with colons and hashes", () => {
  const text = '---\ndescription: "Use for X: Y # not a comment"\nother: \'it\'\'s\'\n---\nbody\n'
  const { data } = parseFrontmatter(text)
  assert.equal(data.description, "Use for X: Y # not a comment")
  assert.equal(data.other, "it's")
})

test("parses inline lists and nested metadata", () => {
  const text = "---\ntags: [a, 'b, c', d]\nmetadata:\n  opencode/autoinvoke: false\n  owner: team\n---\n"
  const { data } = parseFrontmatter(text)
  assert.deepEqual(data.tags, ["a", "b, c", "d"])
  assert.deepEqual(data.metadata, { "opencode/autoinvoke": false, owner: "team" })
})

test("parses literal and folded block scalars", () => {
  const literal = "---\ndescription: |\n  line one\n  line two\nname: x\n---\n"
  assert.equal(parseFrontmatter(literal).data.description, "line one\nline two\n")
  const folded = "---\ndescription: >-\n  line one\n  line two\n---\n"
  assert.equal(parseFrontmatter(folded).data.description, "line one line two")
})

test("handles CRLF and a BOM", () => {
  const text = "\uFEFF---\r\nname: crlf\r\nflag: false\r\n---\r\nbody\r\n"
  const { data, body } = parseFrontmatter(text)
  assert.equal(data.name, "crlf")
  assert.equal(data.flag, false)
  assert.equal(body, "body\r\n")
})

test("every vendored skill and agent parses with a name and description", () => {
  const files = []
  for (const directory of ["skills", "agents"]) {
    for (const entry of readdirSync(join(vendorRoot, directory), { withFileTypes: true })) {
      if (directory === "skills" && entry.isDirectory()) {
        files.push(join(vendorRoot, "skills", entry.name, "SKILL.md"))
      }
      if (directory === "agents" && entry.isFile() && entry.name.endsWith(".md")) {
        files.push(join(vendorRoot, "agents", entry.name))
      }
    }
  }
  assert.equal(files.length, 61)
  for (const file of files) {
    const { data, body } = parseFrontmatter(readFileSync(file, "utf8"), file)
    assert.equal(typeof data.name, "string", `name in ${file}`)
    assert.equal(typeof data.description, "string", `description in ${file}`)
    assert.ok(body.trim().length > 0, `body in ${file}`)
  }
})
